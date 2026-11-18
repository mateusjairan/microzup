"""GET /search (plano §5/§6): full-text + nome de arquivo, contra Postgres real.

Cobre: termo em mensagem, filtro por conversa com revalidação de acesso,
ranking ordenado, termo no nome de arquivo e usuário sem acesso não vê resultado.
"""


def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _seed(client, sector_name: str, usernames: tuple[str, ...]) -> dict:
    admin_h = {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}
    sector = client.post("/admin/sectors", headers=admin_h, json={"name": sector_name}).json()
    ids: dict[str, str] = {}
    for username in usernames:
        created = client.post(
            "/admin/users",
            headers=admin_h,
            json={
                "username": username,
                "display_name": username.replace(".", " ").title(),
                "password": "senha-forte",
                "sector_id": sector["id"],
            },
        )
        assert created.status_code == 201, created.text
        ids[username] = created.json()["id"]
    return {"admin": admin_h, "ids": ids}


def _open_dm(client, token: str, other_user_id: str) -> dict:
    dm = client.post(
        "/conversations/dm",
        headers={"Authorization": f"Bearer {token}"},
        json={"user_id": other_user_id},
    )
    assert dm.status_code == 200, dm.text
    return dm.json()


def _send(client, token: str, conversation_id: str, client_id: str, body: str) -> dict:
    sent = client.post(
        "/messages",
        headers={"Authorization": f"Bearer {token}"},
        json={"conversation_id": conversation_id, "client_id": client_id, "body": body},
    )
    assert sent.status_code == 201, sent.text
    return sent.json()


def _upload(client, token: str, filename: str, content: bytes = b"conteudo do arquivo") -> str:
    upload = client.post(
        "/files",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (filename, content, "application/pdf")},
    )
    assert upload.status_code == 201, upload.text
    return upload.json()["id"]


def test_search_finds_message_term_in_own_conversations(client) -> None:
    seeded = _seed(client, "Busca Mensagens", ("ana.souza", "bruno.lima", "carla.dias"))
    ana = _login(client, "ana.souza")
    bruno = _login(client, "bruno.lima")
    carla = _login(client, "carla.dias")
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm_ana = _open_dm(client, ana, seeded["ids"]["bruno.lima"])
    dm_carla = _open_dm(client, carla, seeded["ids"]["bruno.lima"])
    _send(client, ana, dm_ana["id"], "c1", "Desvio de temperatura no reactor 3")
    _send(client, carla, dm_carla["id"], "c2", "Desvio de umidade no setor B")

    # Ana só vê o desvio da conversa dela; o da DM carla↔bruno não vaza.
    results = client.get("/search", headers=ana_h, params={"q": "desvio"}).json()
    assert len(results["messages"]) == 1
    assert "reactor" in results["messages"][0]["body"]
    assert results["files"] == []

    # Bruno, membro das duas, vê ambos.
    results_bruno = client.get(
        "/search", headers={"Authorization": f"Bearer {bruno}"}, params={"q": "desvio"}
    ).json()
    assert len(results_bruno["messages"]) == 2


def test_search_filters_by_conversation_and_revalidates_access(client) -> None:
    seeded = _seed(client, "Busca Filtro", ("ana.souza", "bruno.lima", "carla.dias"))
    ana = _login(client, "ana.souza")
    carla = _login(client, "carla.dias")
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm_a = _open_dm(client, ana, seeded["ids"]["bruno.lima"])
    dm_b = _open_dm(client, carla, seeded["ids"]["bruno.lima"])
    _send(client, ana, dm_a["id"], "c1", "protocolo de higienizacao semanal")
    _send(client, carla, dm_b["id"], "c2", "protocolo de calibracao anual")

    # Filtro por conversa do próprio usuário: só a conversa pedida.
    filtered = client.get(
        "/search", headers=ana_h, params={"q": "protocolo", "conversation_id": dm_a["id"]}
    ).json()
    assert [m["conversation_id"] for m in filtered["messages"]] == [dm_a["id"]]

    # Filtro por conversa ALHEIA: 403 revalidado no servidor.
    denied = client.get(
        "/search",
        headers=ana_h,
        params={"q": "protocolo", "conversation_id": dm_b["id"]},
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "access_denied"


def test_search_ranks_repeated_term_first(client) -> None:
    seeded = _seed(client, "Busca Ranking", ("ana.souza", "bruno.lima"))
    ana = _login(client, "ana.souza")
    ana_h = {"Authorization": f"Bearer {ana}"}
    dm = _open_dm(client, ana, seeded["ids"]["bruno.lima"])

    _send(client, ana, dm["id"], "c1", "Estabilidade é o assunto do dia")
    _send(client, ana, dm["id"], "c2", "Estabilidade, estabilidade: o estudo de estabilidade")

    results = client.get("/search", headers=ana_h, params={"q": "estabilidade"}).json()
    bodies = [m["body"] for m in results["messages"]]
    assert len(bodies) == 2
    # ts_rank_cd: a mensagem com o termo repetido vem primeiro.
    assert bodies[0].startswith("Estabilidade, estabilidade")


def test_search_finds_filename_with_conversation_context(client) -> None:
    seeded = _seed(client, "Busca Arquivos", ("ana.souza", "bruno.lima", "carla.dias"))
    ana = _login(client, "ana.souza")
    carla = _login(client, "carla.dias")
    bruno_id = seeded["ids"]["bruno.lima"]
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm_ana = _open_dm(client, ana, bruno_id)
    dm_carla = _open_dm(client, carla, bruno_id)

    # Conteúdos distintos: o dedupe por SHA-256 não pode colapsar os dois laudos.
    attachment_ana = _upload(client, ana, "laudo-qualidade-2026.pdf", b"conteudo do laudo QA")
    attachment_carla = _upload(
        client, carla, "laudo-manutencao.docx", b"conteudo do laudo de manutencao"
    )

    sent = client.post(
        "/messages",
        headers=ana_h,
        json={
            "conversation_id": dm_ana["id"],
            "client_id": "c1",
            "body": "Segue o laudo para revisão.",
            "attachment_ids": [attachment_ana],
        },
    )
    assert sent.status_code == 201, sent.text
    message_ana = sent.json()

    carla_h = {"Authorization": f"Bearer {carla}"}
    sent_carla = client.post(
        "/messages",
        headers=carla_h,
        json={
            "conversation_id": dm_carla["id"],
            "client_id": "c2",
            "body": "Laudo de manutenção anexado.",
            "attachment_ids": [attachment_carla],
        },
    )
    assert sent_carla.status_code == 201, sent_carla.text

    # Ana busca por parte do nome do arquivo: o anexo vem com o contexto.
    results = client.get("/search", headers=ana_h, params={"q": "laudo qualidade"}).json()
    files = results["files"]
    assert [f["filename"] for f in files] == ["laudo-qualidade-2026.pdf"]
    hit = files[0]
    assert hit["conversation_id"] == dm_ana["id"]
    assert hit["message_id"] == message_ana["id"]
    assert hit["message_seq"] == message_ana["seq"]

    # Sem acesso à outra conversa: o laudo de manutenção não vaza.
    results_ana_only = client.get("/search", headers=ana_h, params={"q": "manutencao"}).json()
    assert results_ana_only["files"] == []

    # Bruno vê os dois (membro das duas conversas).
    bruno = _login(client, "bruno.lima")
    results_bruno = client.get(
        "/search", headers={"Authorization": f"Bearer {bruno}"}, params={"q": "laudo"}
    ).json()
    assert len(results_bruno["files"]) == 2


def test_search_requires_authentication(client) -> None:
    response = client.get("/search", params={"q": "qualquer"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_search_empty_query_returns_empty_envelope(client) -> None:
    _seed(client, "Busca Vazia", ("ana.souza",))
    ana = _login(client, "ana.souza")

    results = client.get(
        "/search", headers={"Authorization": f"Bearer {ana}"}, params={"q": "  "}
    ).json()
    assert results == {"messages": [], "files": []}
