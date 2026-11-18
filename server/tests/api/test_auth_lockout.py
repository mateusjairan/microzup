def _login(client, username: str, password: str) -> object:
    return client.post(
        "/auth/login", json={"username": username, "password": password, "device_name": "pytest"}
    )


def test_login_lockout_after_five_failures(client) -> None:
    # usuário existe com senha correta 'senha-forte'
    admin = client.post("/auth/login", json={"username": "admin", "password": "admin12345"})
    assert admin.status_code == 200
    token = admin.json()["access_token"]
    created = client.post(
        "/admin/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "username": "ana.souza",
            "display_name": "Ana Souza",
            "password": "senha-forte",
        },
    )
    assert created.status_code == 201, created.text

    for _ in range(5):
        wrong = _login(client, "ana.souza", "senha-errada")
        assert wrong.status_code == 401
        assert wrong.json()["error"]["code"] == "authentication_error"

    # 6ª tentativa, AGORA com a senha correta: bloqueio progressivo manda esperar.
    blocked = _login(client, "ana.souza", "senha-forte")
    assert blocked.status_code == 429, blocked.text
    body = blocked.json()
    assert body["error"]["code"] == "too_many_attempts"
    assert "segundos" in body["error"]["message"]

    # Sem login auditar durante o bloqueio (auth.login só no sucesso).
    audit = client.get(
        "/admin/audit",
        headers={"Authorization": f"Bearer {token}"},
        params={"action": "auth.login", "limit": 500},
    ).json()
    ana_logins = [entry for entry in audit if "ana" in str(entry.get("metadata", {}))]
    assert ana_logins == []


def test_login_lockout_does_not_leak_password_check(client) -> None:
    client.post("/auth/login", json={"username": "admin", "password": "admin12345"})

    # 5 falhas em um usuário INEXISTENTE também bloqueiam (anti-enumeração).
    for _ in range(5):
        wrong = _login(client, "fantasma.inexistente", "qualquer-coisa")
        assert wrong.status_code == 401

    blocked = _login(client, "fantasma.inexistente", "qualquer-coisa")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "too_many_attempts"


def test_message_send_rate_limited(client) -> None:
    admin = client.post("/auth/login", json={"username": "admin", "password": "admin12345"})
    token = admin.json()["access_token"]
    client.post(
        "/admin/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "username": "ana.souza",
            "display_name": "Ana Souza",
            "password": "senha-forte",
        },
    )
    bruno = client.post(
        "/admin/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "username": "bruno.lima",
            "display_name": "Bruno Lima",
            "password": "senha-forte",
        },
    ).json()

    ana = client.post(
        "/auth/login", json={"username": "ana.souza", "password": "senha-forte"}
    ).json()["access_token"]
    dm = client.post(
        "/conversations/dm",
        headers={"Authorization": f"Bearer {ana}"},
        json={"user_id": bruno["id"]},
    ).json()

    headers = {"Authorization": f"Bearer {ana}"}
    limit = 30  # RATE_LIMIT_MESSAGE_PER_MINUTE padrão
    for i in range(limit):
        sent = client.post(
            "/messages",
            headers=headers,
            json={
                "conversation_id": dm["id"],
                "client_id": f"c{i}",
                "body": f"mensagem {i}",
            },
        )
        assert sent.status_code == 201, sent.text

    overflow = client.post(
        "/messages",
        headers=headers,
        json={"conversation_id": dm["id"], "client_id": "c-overflow", "body": "a mais"},
    )
    assert overflow.status_code == 429, overflow.text
    assert overflow.json()["error"]["code"] == "rate_limited"
