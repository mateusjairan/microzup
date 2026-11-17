def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _admin_headers(client) -> dict:
    return {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}


def _seed(client) -> dict:
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": "QA"}).json()
    ids = {}
    for username in ("ana.souza", "bruno.lima"):
        user = client.post(
            "/admin/users",
            headers=headers,
            json={
                "username": username,
                "display_name": username,
                "password": "senha-forte",
                "role": "member",
                "sector_id": sector["id"],
            },
        ).json()
        ids[username] = user["id"]
    return ids


def test_search_finds_own_conversation_message(client) -> None:
    ids = _seed(client)
    ana = _login(client, "ana.souza")
    bruno = _login(client, "bruno.lima")
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm = client.post("/conversations/dm", headers=ana_h, json={"user_id": ids["bruno.lima"]}).json()
    client.post(
        "/messages",
        headers=ana_h,
        json={"conversation_id": dm["id"], "client_id": "c1", "body": "Relatório de desvio 045"},
    )

    results = client.get("/search", headers=ana_h, params={"q": "desvio"}).json()
    assert len(results) == 1
    assert "desvio" in results[0]["body"]

    # Bruno também encontra (participa da conversa).
    results_bruno = client.get(
        "/search", headers={"Authorization": f"Bearer {bruno}"}, params={"q": "desvio"}
    ).json()
    assert len(results_bruno) == 1


def test_audit_and_stats_endpoints(client) -> None:
    _seed(client)
    headers = _admin_headers(client)

    audit = client.get("/admin/audit", headers=headers).json()
    assert isinstance(audit, list)
    assert len(audit) > 0
    assert {"action", "entity_type", "created_at"} <= set(audit[0].keys())

    stats = client.get("/admin/stats", headers=headers).json()
    assert stats["users"] >= 2
    assert stats["sectors"] >= 1
