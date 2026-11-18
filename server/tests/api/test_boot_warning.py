def _login(client, username: str, password: str) -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_boot_warns_when_no_active_admin(client, capsys) -> None:
    """Plano §8: WARNING no boot enquanto não houver admin ativo."""
    headers = {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}
    users = client.get("/admin/users", headers=headers, params={"include_inactive": True}).json()
    admins = [user for user in users if user["role"] == "admin"]
    assert admins, "o seed deveria criar um admin"

    for admin in admins:
        deactivated = client.patch(
            f"/admin/users/{admin['id']}", headers=headers, json={"is_active": False}
        )
        assert deactivated.status_code == 200, deactivated.text

    capsys.readouterr()  # descarta logs do boot anterior

    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as second_client:
        health = second_client.get("/health")
        assert health.status_code == 200
        assert health.json()["version"] == "0.1.0"

    out = capsys.readouterr().out
    assert "boot_without_active_admin" in out
    assert "create-admin" in out


def test_boot_does_not_warn_with_active_admin(client, capsys) -> None:
    from app.main import create_app
    from fastapi.testclient import TestClient

    capsys.readouterr()
    with TestClient(create_app()) as second_client:
        assert second_client.get("/health").status_code == 200
    assert "boot_without_active_admin" not in capsys.readouterr().out
