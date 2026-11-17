def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _admin_headers(client) -> dict:
    return {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}


def _user_id(client, username: str) -> str:
    users = client.get("/admin/users", headers=_admin_headers(client)).json()
    return next(u["id"] for u in users if u["username"] == username)


def _setup_users(client) -> tuple[str, str, str]:
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": "Arquivos"}).json()
    for username in ("ana.souza", "bruno.lima", "carla.dias"):
        client.post(
            "/admin/users",
            headers=headers,
            json={
                "username": username,
                "display_name": username,
                "password": "senha-forte",
                "role": "member",
                "sector_id": sector["id"],
            },
        )
    return _login(client, "ana.souza"), _login(client, "bruno.lima"), _login(client, "carla.dias")


def test_upload_send_and_download_file(client) -> None:
    ana, bruno, _ = _setup_users(client)
    ana_h = {"Authorization": f"Bearer {ana}"}
    bruno_h = {"Authorization": f"Bearer {bruno}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": _user_id(client, "bruno.lima")}
    )
    conversation_id = dm.json()["id"]

    upload = client.post(
        "/files",
        headers=ana_h,
        files={"file": ("desvio.pdf", b"%PDF-1.4 conteudo", "application/pdf")},
    )
    assert upload.status_code == 201
    attachment_id = upload.json()["id"]

    sent = client.post(
        "/messages",
        headers=ana_h,
        json={
            "conversation_id": conversation_id,
            "client_id": "c1",
            "body": "Segue o desvio",
            "attachment_ids": [attachment_id],
        },
    )
    assert sent.status_code == 201

    download = client.get(f"/files/{attachment_id}", headers=bruno_h)
    assert download.status_code == 200
    assert download.content == b"%PDF-1.4 conteudo"


def test_outside_user_cannot_download(client) -> None:
    ana, _, carla = _setup_users(client)
    ana_h = {"Authorization": f"Bearer {ana}"}
    carla_h = {"Authorization": f"Bearer {carla}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": _user_id(client, "bruno.lima")}
    )
    upload = client.post(
        "/files", headers=ana_h, files={"file": ("x.pdf", b"dados", "application/pdf")}
    )
    attachment_id = upload.json()["id"]
    client.post(
        "/messages",
        headers=ana_h,
        json={
            "conversation_id": dm.json()["id"],
            "client_id": "c1",
            "body": "a",
            "attachment_ids": [attachment_id],
        },
    )

    download = client.get(f"/files/{attachment_id}", headers=carla_h)
    assert download.status_code == 403


def test_upload_blocks_executable(client) -> None:
    ana, _, _ = _setup_users(client)
    upload = client.post(
        "/files",
        headers={"Authorization": f"Bearer {ana}"},
        files={"file": ("virus.exe", b"MZ...", "application/octet-stream")},
    )
    assert upload.status_code == 422
