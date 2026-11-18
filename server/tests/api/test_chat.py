def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post(
        "/auth/login", json={"username": username, "password": password, "device_name": "pytest"}
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _admin_headers(client) -> dict:
    admin = client.post("/auth/login", json={"username": "admin", "password": "admin12345"})
    return {"Authorization": f"Bearer {admin.json()['access_token']}"}


def _create_user(client, headers: dict, username: str, sector_id=None) -> dict:
    response = client.post(
        "/admin/users",
        headers=headers,
        json={
            "username": username,
            "display_name": username,
            "password": "senha-forte",
            "role": "member",
            "sector_id": sector_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_full_direct_message_flow(client) -> None:
    headers = _admin_headers(client)

    sector = client.post("/admin/sectors", headers=headers, json={"name": "Qualidade"}).json()
    _create_user(client, headers, "ana.souza", sector["id"])
    bruno = _create_user(client, headers, "bruno.lima", sector["id"])

    ana_token = _login(client, "ana.souza")
    bruno_token = _login(client, "bruno.lima")
    ana_h = {"Authorization": f"Bearer {ana_token}"}
    bruno_h = {"Authorization": f"Bearer {bruno_token}"}

    # Ana abre DM com Bruno
    dm = client.post("/conversations/dm", headers=ana_h, json={"user_id": bruno["id"]})
    assert dm.status_code == 200
    conversation_id = dm.json()["id"]

    # Ana envia mensagem
    sent = client.post(
        "/messages",
        headers=ana_h,
        json={"conversation_id": conversation_id, "client_id": "c1", "body": "Bom dia!"},
    )
    assert sent.status_code == 201
    assert sent.json()["seq"] == 1

    # Bruno vê a conversa com 1 não lida
    summaries = client.get("/conversations", headers=bruno_h).json()
    dm_summary = next(s for s in summaries if s["conversation"]["id"] == conversation_id)
    assert dm_summary["unread_count"] == 1

    # Bruno lê as mensagens
    messages = client.get(f"/conversations/{conversation_id}/messages", headers=bruno_h).json()
    assert len(messages) == 1
    assert messages[0]["body"] == "Bom dia!"

    # Bruno marca como lida
    read = client.post(
        f"/conversations/{conversation_id}/read",
        headers=bruno_h,
        json={"last_read_seq": 1},
    )
    assert read.status_code == 204

    summaries = client.get("/conversations", headers=bruno_h).json()
    dm_summary = next(s for s in summaries if s["conversation"]["id"] == conversation_id)
    assert dm_summary["unread_count"] == 0


def test_outside_user_cannot_read_dm(client) -> None:
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": "Produção"}).json()
    _create_user(client, headers, "ana.souza", sector["id"])
    _create_user(client, headers, "bruno.lima", sector["id"])
    _create_user(client, headers, "carla.dias", sector["id"])

    ana_token = _login(client, "ana.souza")
    carla_token = _login(client, "carla.dias")

    dm = client.post(
        "/conversations/dm",
        headers={"Authorization": f"Bearer {ana_token}"},
        json={"user_id": bruno_id(client, headers)},
    ).json()

    response = client.get(
        f"/conversations/{dm['id']}/messages",
        headers={"Authorization": f"Bearer {carla_token}"},
    )
    assert response.status_code == 403


def bruno_id(client, headers: dict) -> str:
    users = client.get("/admin/users", headers=headers).json()
    return next(u["id"] for u in users if u["username"] == "bruno.lima")


def _setup_dm(client):
    """Cria dois usuários com DM aberta e devolve tokens + conversation_id."""
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": "Comercial"}).json()
    _create_user(client, headers, "ana.souza", sector["id"])
    _create_user(client, headers, "bruno.lima", sector["id"])
    ana_token = _login(client, "ana.souza")
    bruno_token = _login(client, "bruno.lima")
    dm = client.post(
        "/conversations/dm",
        headers={"Authorization": f"Bearer {ana_token}"},
        json={"user_id": bruno_id(client, headers)},
    ).json()
    return ana_token, bruno_token, dm["id"]


def test_messages_catchup_with_after_seq(client) -> None:
    """Lacuna de seq → refetch por after_seq (plano §7: catch-up por cursor)."""
    ana_token, _, conversation_id = _setup_dm(client)
    headers = {"Authorization": f"Bearer {ana_token}"}

    seqs = []
    for i in range(3):
        sent = client.post(
            "/messages",
            headers=headers,
            json={"conversation_id": conversation_id, "client_id": f"c{i}", "body": f"msg {i}"},
        )
        assert sent.status_code == 201
        seqs.append(sent.json()["seq"])
    assert seqs == [1, 2, 3]

    # Cliente caiu depois da msg 1: refetch com after_seq=1 traz só o que perdeu.
    catchup = client.get(
        f"/conversations/{conversation_id}/messages",
        headers=headers,
        params={"after_seq": 1},
    )
    assert catchup.status_code == 200
    body = catchup.json()
    assert [m["seq"] for m in body] == [2, 3]
    assert [m["body"] for m in body] == ["msg 1", "msg 2"]

    # Sem novidades depois da última: lista vazia, sem refetch infinito.
    up_to_date = client.get(
        f"/conversations/{conversation_id}/messages",
        headers=headers,
        params={"after_seq": 3},
    )
    assert up_to_date.json() == []


def test_conversations_summary_exposes_peer_active_state(client) -> None:
    ana_token, bruno_token, conversation_id = _setup_dm(client)
    ana_h = {"Authorization": f"Bearer {ana_token}"}
    headers = _admin_headers(client)
    bruno = bruno_id(client, headers)

    # Par ativo: peer_is_active True.
    summaries = client.get("/conversations", headers=ana_h).json()
    dm_summary = next(s for s in summaries if s["conversation"]["id"] == conversation_id)
    assert dm_summary["conversation"]["peer_id"] == bruno
    assert dm_summary["conversation"]["peer_is_active"] is True
    assert dm_summary["last_message"] is None  # ainda sem mensagens

    # Par desativado: peer_is_active False para a UI cinza + bloquear DM.
    client.patch(f"/admin/users/{bruno}", headers=headers, json={"is_active": False})
    summaries = client.get("/conversations", headers=ana_h).json()
    dm_summary = next(s for s in summaries if s["conversation"]["id"] == conversation_id)
    assert dm_summary["conversation"]["peer_is_active"] is False

    # DM NOVA com par desativado é bloqueada; a existente continua acessível
    # (histórico preservado, peer marcado como inativo para a UI).
    _create_user(client, headers, "carla.dias")
    carla_h = {"Authorization": f"Bearer {_login(client, 'carla.dias')}"}
    blocked = client.post("/conversations/dm", headers=carla_h, json={"user_id": bruno})
    assert blocked.status_code == 422
    assert "desativado" in blocked.json()["error"]["message"]

    reopened = client.post("/conversations/dm", headers=ana_h, json={"user_id": bruno})
    assert reopened.status_code == 200
    assert reopened.json()["peer_is_active"] is False

    existing = client.get(f"/conversations/{conversation_id}/messages", headers=ana_h)
    assert existing.status_code == 200


def test_archived_channel_is_read_only(client) -> None:
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": "Arquivamento"}).json()
    _create_user(client, headers, "ana.souza", sector["id"])

    channels = client.get("/admin/channels", headers=headers).json()
    channel = next(c for c in channels if c["sector_id"] == sector["id"])

    ana_h = {"Authorization": f"Bearer {_login(client, 'ana.souza')}"}
    sent = client.post(
        "/messages",
        headers=ana_h,
        json={"conversation_id": channel["id"], "client_id": "c1", "body": "antes de arquivar"},
    )
    assert sent.status_code == 201

    archived = client.patch(
        f"/admin/channels/{channel['id']}", headers=headers, json={"archived": True}
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived_at"] is not None

    # Somente leitura: histórico preservado, envio bloqueado.
    blocked = client.post(
        "/messages",
        headers=ana_h,
        json={"conversation_id": channel["id"], "client_id": "c2", "body": "depois"},
    )
    assert blocked.status_code == 403
    assert "arquivada" in blocked.json()["error"]["message"]

    history = client.get(f"/conversations/{channel['id']}/messages", headers=ana_h)
    assert history.status_code == 200
    assert len(history.json()) == 1


def test_moving_user_between_sectors_rematerializes_channel_members(client) -> None:
    headers = _admin_headers(client)
    sector_a = client.post("/admin/sectors", headers=headers, json={"name": "Setor Alfa"}).json()
    sector_b = client.post("/admin/sectors", headers=headers, json={"name": "Setor Beta"}).json()
    ana = _create_user(client, headers, "ana.souza", sector_a["id"])
    _create_user(client, headers, "bruno.lima", sector_a["id"])
    _create_user(client, headers, "carla.dias", sector_b["id"])

    channels = client.get("/admin/channels", headers=headers).json()
    channel_a = next(c for c in channels if c["sector_id"] == sector_a["id"])
    channel_b = next(c for c in channels if c["sector_id"] == sector_b["id"])
    assert channel_a["member_count"] == 2  # ana + bruno materializados na criação
    assert channel_b["member_count"] == 1  # carla

    # Ana muda de setor: sai do canal Alfa, entra no canal Beta.
    moved = client.patch(
        f"/admin/users/{ana['id']}",
        headers=headers,
        json={"sector_id": sector_b["id"]},
    )
    assert moved.status_code == 200, moved.text

    channels = client.get("/admin/channels", headers=headers).json()
    channel_a = next(c for c in channels if c["sector_id"] == sector_a["id"])
    channel_b = next(c for c in channels if c["sector_id"] == sector_b["id"])
    assert channel_a["member_count"] == 1  # só bruno
    assert channel_b["member_count"] == 2  # carla + ana

    # Ana não lê mais o canal antigo, lê o novo.
    ana_h = {"Authorization": f"Bearer {_login(client, 'ana.souza')}"}
    forbidden = client.get(f"/conversations/{channel_a['id']}/messages", headers=ana_h)
    assert forbidden.status_code == 403
    allowed = client.get(f"/conversations/{channel_b['id']}/messages", headers=ana_h)
    assert allowed.status_code == 200


def test_last_message_in_summary(client) -> None:
    ana_token, bruno_token, conversation_id = _setup_dm(client)
    ana_h = {"Authorization": f"Bearer {ana_token}"}
    bruno_h = {"Authorization": f"Bearer {bruno_token}"}

    client.post(
        "/messages",
        headers=ana_h,
        json={"conversation_id": conversation_id, "client_id": "c1", "body": "primeira"},
    )
    client.post(
        "/messages",
        headers=bruno_h,
        json={"conversation_id": conversation_id, "client_id": "c2", "body": "segunda"},
    )

    summaries = client.get("/conversations", headers=ana_h).json()
    dm_summary = next(s for s in summaries if s["conversation"]["id"] == conversation_id)
    assert dm_summary["last_message"]["body"] == "segunda"
    assert dm_summary["last_message"]["seq"] == 2
    assert dm_summary["unread_count"] == 2  # ana ainda não leu nenhuma
