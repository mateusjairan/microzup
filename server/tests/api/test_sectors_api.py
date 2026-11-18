def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _admin_headers(client) -> dict:
    return {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}


def _seed_sector(client, name: str) -> dict:
    return client.post("/admin/sectors", headers=_admin_headers(client), json={"name": name}).json()


def test_sectors_requires_authentication(client) -> None:
    response = client.get("/sectors")
    assert response.status_code == 401
    # Envelope uniforme, inclusive nos guards de auth.
    body = response.json()
    assert set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == "unauthorized"
    assert body["error"]["details"] == {}


def test_sectors_listed_for_common_users(client) -> None:
    _seed_sector(client, "Qualidade")
    _seed_sector(client, "Produção")

    member = client.post(
        "/admin/users",
        headers=_admin_headers(client),
        json={
            "username": "ana.souza",
            "display_name": "Ana Souza",
            "password": "senha-forte",
        },
    ).json()
    assert member["role"] == "member"

    response = client.get(
        "/sectors", headers={"Authorization": f"Bearer {_login(client, 'ana.souza')}"}
    )
    assert response.status_code == 200, response.text

    sectors = {s["slug"]: s for s in response.json()}
    assert set(sectors) >= {"qualidade", "producao"}
    assert sectors["qualidade"]["name"] == "Qualidade"


def test_error_envelope_on_admin_guard_403(client) -> None:
    client.post(
        "/admin/users",
        headers=_admin_headers(client),
        json={"username": "ana.souza", "display_name": "Ana", "password": "senha-forte"},
    )
    member_headers = {"Authorization": f"Bearer {_login(client, 'ana.souza')}"}

    response = client.get("/admin/users", headers=member_headers)
    assert response.status_code == 403
    body = response.json()
    assert set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == "forbidden"
    assert "admin" in body["error"]["message"].lower()


def test_error_envelope_on_validation_422(client) -> None:
    response = client.post("/auth/login", json={"username": ""})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"]["errors"][0]["loc"][0] == "body"


def test_error_envelope_on_domain_404(client) -> None:
    from uuid import uuid4

    headers = _admin_headers(client)
    response = client.patch(f"/admin/users/{uuid4()}", headers=headers, json={"is_active": False})
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"


def test_error_envelope_on_expired_or_invalid_token(client) -> None:
    response = client.get("/users", headers={"Authorization": "Bearer token-invalido"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
