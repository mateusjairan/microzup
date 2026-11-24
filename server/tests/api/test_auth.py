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


def test_login_sets_httponly_cookie_and_hides_refresh_token(client) -> None:
    login = _login(client)

    # O refresh token nunca chega ao JavaScript: só no cookie HttpOnly.
    assert "refresh_token" not in login
    set_cookie = client.cookies.get("mz_refresh")
    assert set_cookie is not None
    raw = client.post("/auth/login", json={"username": "admin", "password": "admin12345"}).headers[
        "set-cookie"
    ]
    assert "httponly" in raw.lower()
    assert "samesite=strict" in raw.lower()
    assert "path=/auth" in raw.lower()


def test_login_without_remember_uses_session_cookie(client) -> None:
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "admin12345", "remember": False},
    )
    assert response.status_code == 200
    assert "max-age" not in response.headers["set-cookie"].lower()


def test_refresh_rotates_token(client) -> None:
    _login(client)
    old_cookie = client.cookies.get("mz_refresh")
    assert old_cookie is not None

    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    assert "access_token" in refreshed.json()
    new_cookie = client.cookies.get("mz_refresh")
    assert new_cookie is not None and new_cookie != old_cookie

    # O refresh antigo (cookie anterior) não funciona mais.
    client.cookies.set("mz_refresh", old_cookie, path="/auth")
    replay = client.post("/auth/refresh")
    assert replay.status_code == 401


def test_refresh_preserves_session_only_choice(client) -> None:
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "admin12345", "remember": False},
    )
    assert response.status_code == 200

    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    # Rotação NÃO promove a sessão do navegador a cookie persistente.
    assert "max-age" not in refreshed.headers["set-cookie"].lower()


def test_refresh_without_cookie_returns_401(client) -> None:
    response = client.post("/auth/refresh")
    assert response.status_code == 401


def test_refresh_rejects_cross_origin(client) -> None:
    _login(client)
    response = client.post("/auth/refresh", headers={"Origin": "http://evil.example"})
    assert response.status_code == 401


def test_logout_revokes_session(client) -> None:
    _login(client)
    cookie = client.cookies.get("mz_refresh")
    assert cookie is not None

    logout = client.post("/auth/logout")
    assert logout.status_code == 204
    assert client.cookies.get("mz_refresh") is None

    client.cookies.set("mz_refresh", cookie, path="/auth")
    replay = client.post("/auth/refresh")
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
