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


def _png_bytes() -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (1200, 700), "green").save(buffer, format="PNG")
    return buffer.getvalue()


def test_thumbnail_generated_and_served_to_authorized_member(client) -> None:
    ana, bruno, carla = _setup_users(client)
    ana_h = {"Authorization": f"Bearer {ana}"}
    bruno_h = {"Authorization": f"Bearer {bruno}"}
    carla_h = {"Authorization": f"Bearer {carla}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": _user_id(client, "bruno.lima")}
    )
    conversation_id = dm.json()["id"]

    upload = client.post(
        "/files",
        headers=ana_h,
        files={"file": ("grafico.png", _png_bytes(), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    attachment = upload.json()
    assert attachment["mime_type"] == "image/png"
    assert attachment["has_thumbnail"] is True

    sent = client.post(
        "/messages",
        headers=ana_h,
        json={
            "conversation_id": conversation_id,
            "client_id": "c1",
            "body": "veja o gráfico",
            "attachment_ids": [attachment["id"]],
        },
    )
    assert sent.status_code == 201

    # Prévia 480 px autorizada por participação (ConversationAccessPolicy).
    thumbnail = client.get(f"/files/{attachment['id']}/thumbnail", headers=bruno_h)
    assert thumbnail.status_code == 200, thumbnail.text
    assert thumbnail.headers["content-type"] == "image/jpeg"
    assert thumbnail.content[:3] == b"\xff\xd8\xff"

    from PIL import Image

    image = Image.open(__import__("io").BytesIO(thumbnail.content))
    assert max(image.size) <= 480

    # Download integral continua funcionando e auditado como file.download.
    download = client.get(f"/files/{attachment['id']}", headers=bruno_h)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/octet-stream"

    admin_h = _admin_headers(client)
    audit = client.get("/admin/audit", headers=admin_h, params={"action": "file.download"}).json()
    assert any(entry["entity_id"] == attachment["id"] for entry in audit)
    assert any(entry["actor_id"] is not None for entry in audit)

    # Não-membro não recebe a prévia nem o arquivo.
    assert client.get(f"/files/{attachment['id']}/thumbnail", headers=carla_h).status_code == 403
    assert client.get(f"/files/{attachment['id']}", headers=carla_h).status_code == 403


def test_thumbnail_404_for_non_image_files(client) -> None:
    ana, bruno, _ = _setup_users(client)
    ana_h = {"Authorization": f"Bearer {ana}"}
    bruno_h = {"Authorization": f"Bearer {bruno}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": _user_id(client, "bruno.lima")}
    )
    upload = client.post(
        "/files",
        headers=ana_h,
        files={"file": ("nota.txt", b"apenas um texto simples", "text/plain")},
    )
    assert upload.status_code == 201
    assert upload.json()["has_thumbnail"] is False

    client.post(
        "/messages",
        headers=ana_h,
        json={
            "conversation_id": dm.json()["id"],
            "client_id": "c1",
            "body": "nota",
            "attachment_ids": [upload.json()["id"]],
        },
    )

    thumbnail = client.get(f"/files/{upload.json()['id']}/thumbnail", headers=bruno_h)
    assert thumbnail.status_code == 404
    assert thumbnail.json()["error"]["code"] == "not_found"


def test_upload_rejects_executable_content_renamed_as_pdf(client) -> None:
    """MIME real por magic bytes: MZ disfarçado de .pdf é recusado."""
    ana, _, _ = _setup_users(client)
    mz = (
        b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00\xb8\x00\x00\x00"
        b"\x00\x00\x00\x00@\x00\x00\x00\x00\x00\x00\x00"
    )
    upload = client.post(
        "/files",
        headers={"Authorization": f"Bearer {ana}"},
        files={"file": ("relatorio.pdf", mz, "application/pdf")},
    )
    assert upload.status_code == 422
    assert "conteúdo" in upload.json()["error"]["message"]


def test_message_blocks_more_than_five_attachments(client) -> None:
    ana, bruno, _ = _setup_users(client)
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": _user_id(client, "bruno.lima")}
    )
    conversation_id = dm.json()["id"]

    attachment_ids = []
    for i in range(6):
        upload = client.post(
            "/files",
            headers=ana_h,
            files={"file": (f"doc{i}.txt", f"conteudo {i}".encode(), "text/plain")},
        )
        assert upload.status_code == 201
        attachment_ids.append(upload.json()["id"])

    overflow = client.post(
        "/messages",
        headers=ana_h,
        json={
            "conversation_id": conversation_id,
            "client_id": "c1",
            "body": "muitos anexos",
            "attachment_ids": attachment_ids,
        },
    )
    assert overflow.status_code == 422
    assert "5 anexos" in overflow.json()["error"]["message"]
