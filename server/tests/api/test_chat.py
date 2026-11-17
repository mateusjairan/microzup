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
