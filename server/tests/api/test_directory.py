def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _admin_headers(client) -> dict:
    return {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}


def _seed(client) -> dict:
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": "Compras"}).json()
    ids = {}
    for username, display_name in (("ana.souza", "Ana Souza"), ("bruno.lima", "Bruno Lima")):
        user = client.post(
            "/admin/users",
            headers=headers,
            json={
                "username": username,
                "display_name": display_name,
                "password": "senha-forte",
                "role": "member",
                "sector_id": sector["id"],
            },
        ).json()
        ids[username] = user["id"]
    return ids


def test_directory_requires_authentication(client) -> None:
    assert client.get("/users").status_code == 401


def test_directory_lists_active_users_with_presence_for_members(client) -> None:
    ids = _seed(client)
    headers = _admin_headers(client)
    client.patch(f"/admin/users/{ids['bruno.lima']}", headers=headers, json={"is_active": False})

    member_headers = {"Authorization": f"Bearer {_login(client, 'ana.souza')}"}
    response = client.get("/users", headers=member_headers)
    assert response.status_code == 200, response.text

    users = {user["username"]: user for user in response.json()}
    assert "ana.souza" in users
    assert "admin" in users
    assert "bruno.lima" not in users
    assert users["ana.souza"]["presence"] == "offline"
    assert users["ana.souza"]["display_name"] == "Ana Souza"


def test_dm_conversation_exposes_the_other_participant(client) -> None:
    ids = _seed(client)
    ana_headers = {"Authorization": f"Bearer {_login(client, 'ana.souza')}"}
    bruno_headers = {"Authorization": f"Bearer {_login(client, 'bruno.lima')}"}

    dm = client.post("/conversations/dm", headers=ana_headers, json={"user_id": ids["bruno.lima"]})
    assert dm.status_code == 200, dm.text
    assert dm.json()["peer_id"] == ids["bruno.lima"]

    ana_summary = client.get("/conversations", headers=ana_headers).json()
    ana_dm = next(item for item in ana_summary if item["conversation"]["kind"] == "dm")
    assert ana_dm["conversation"]["peer_id"] == ids["bruno.lima"]

    bruno_summary = client.get("/conversations", headers=bruno_headers).json()
    bruno_dm = next(item for item in bruno_summary if item["conversation"]["kind"] == "dm")
    assert bruno_dm["conversation"]["peer_id"] == ids["ana.souza"]
