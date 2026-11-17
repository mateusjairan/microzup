def _login(client, username: str = "admin", password: str = "admin12345") -> dict:
    response = client.post(
        "/auth/login",
        json={"username": username, "password": password, "device_name": "pytest"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_login_and_me(client) -> None:
    tokens = _login(client)
    access = tokens["access_token"]

    me = client.get("/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["username"] == "admin"
    assert me.json()["role"] == "admin"


def test_login_wrong_password_returns_401(client) -> None:
    response = client.post("/auth/login", json={"username": "admin", "password": "errada"})
    assert response.status_code == 401


def test_protected_route_requires_token(client) -> None:
    response = client.get("/me")
    assert response.status_code == 401


def test_refresh_rotates_token(client) -> None:
    tokens = _login(client)

    refreshed = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != tokens["refresh_token"]

    # O refresh antigo não funciona mais.
    replay = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401


def test_logout_revokes_session(client) -> None:
    tokens = _login(client)

    logout = client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert logout.status_code == 204

    replay = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401


def test_admin_can_create_sector_and_user(client) -> None:
    tokens = _login(client)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    sector = client.post("/admin/sectors", headers=headers, json={"name": "Qualidade"})
    assert sector.status_code == 201
    sector_id = sector.json()["id"]

    user = client.post(
        "/admin/users",
        headers=headers,
        json={
            "username": "ana.souza",
            "display_name": "Ana Souza",
            "password": "senha-forte",
            "role": "member",
            "sector_id": sector_id,
        },
    )
    assert user.status_code == 201
    assert user.json()["sector_id"] == sector_id

    # A nova conta consegue logar.
    member = client.post("/auth/login", json={"username": "ana.souza", "password": "senha-forte"})
    assert member.status_code == 200


def test_member_cannot_create_user(client) -> None:
    tokens = _login(client)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    client.post(
        "/admin/users",
        headers=headers,
        json={"username": "ana", "display_name": "Ana", "password": "senha-forte"},
    )
    member = client.post("/auth/login", json={"username": "ana", "password": "senha-forte"})
    member_headers = {"Authorization": f"Bearer {member.json()['access_token']}"}

    forbidden = client.post(
        "/admin/users",
        headers=member_headers,
        json={"username": "x", "display_name": "X", "password": "senha-forte"},
    )
    assert forbidden.status_code == 403
