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
    assert len(results["messages"]) == 1
    assert "desvio" in results["messages"][0]["body"]
    assert results["messages"][0]["conversation_id"] == dm["id"]
    assert results["files"] == []

    # Bruno também encontra (participa da conversa).
    results_bruno = client.get(
        "/search", headers={"Authorization": f"Bearer {bruno}"}, params={"q": "desvio"}
    ).json()
    assert len(results_bruno["messages"]) == 1


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


def test_admin_updates_sector_and_renames_channel(client) -> None:
    headers = _admin_headers(client)
    sector = client.post(
        "/admin/sectors", headers=headers, json={"name": "Qualidade", "description": "QA"}
    ).json()

    updated = client.patch(
        f"/admin/sectors/{sector['id']}",
        headers=headers,
        json={"name": "Qualidade Regulatória", "description": "Assuntos regulatórios"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["name"] == "Qualidade Regulatória"
    assert body["slug"] == "qualidade-regulatoria"

    detail = client.get("/admin/sectors", headers=headers).json()
    assert any(s["id"] == sector["id"] and s["name"] == "Qualidade Regulatória" for s in detail)


def test_admin_lists_inactive_and_reactivates_user(client) -> None:
    ids = _seed(client)
    headers = _admin_headers(client)
    ana_id = ids["ana.souza"]

    deactivated = client.patch(f"/admin/users/{ana_id}", headers=headers, json={"is_active": False})
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["is_active"] is False

    active_only = client.get("/admin/users", headers=headers).json()
    assert all(user["id"] != ana_id for user in active_only)

    everyone = client.get("/admin/users", headers=headers, params={"include_inactive": True}).json()
    ana = next(user for user in everyone if user["id"] == ana_id)
    assert ana["is_active"] is False

    reactivated = client.patch(f"/admin/users/{ana_id}", headers=headers, json={"is_active": True})
    assert reactivated.json()["is_active"] is True


def test_admin_clears_user_sector(client) -> None:
    ids = _seed(client)
    headers = _admin_headers(client)
    ana_id = ids["ana.souza"]

    cleared = client.patch(f"/admin/users/{ana_id}", headers=headers, json={"clear_sector": True})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["sector_id"] is None


def test_admin_resets_password_and_revokes_sessions(client) -> None:
    ids = _seed(client)
    headers = _admin_headers(client)

    login = client.post(
        "/auth/login", json={"username": "ana.souza", "password": "senha-forte"}
    ).json()

    reset = client.post(
        f"/admin/users/{ids['ana.souza']}/password",
        headers=headers,
        json={"new_password": "senha-renovada"},
    )
    assert reset.status_code == 200, reset.text

    old_refresh = client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert old_refresh.status_code == 401

    old_login = client.post(
        "/auth/login", json={"username": "ana.souza", "password": "senha-forte"}
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/auth/login", json={"username": "ana.souza", "password": "senha-renovada"}
    )
    assert new_login.status_code == 200

    audit = client.get(
        "/admin/audit", headers=headers, params={"action": "user.password_reset"}
    ).json()
    assert any(entry["entity_id"] == ids["ana.souza"] for entry in audit)


def test_member_cannot_use_admin_endpoints(client) -> None:
    _seed(client)
    member_token = _login(client, "ana.souza")
    headers = {"Authorization": f"Bearer {member_token}"}

    response = client.get("/admin/users", headers=headers)
    assert response.status_code == 403
