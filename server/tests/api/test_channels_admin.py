def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _admin_headers(client) -> dict:
    return {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}


def _seed(client, sector_name: str, members: tuple[str, ...]) -> dict:
    headers = _admin_headers(client)
    sector = client.post("/admin/sectors", headers=headers, json={"name": sector_name}).json()
    for username in members:
        created = client.post(
            "/admin/users",
            headers=headers,
            json={
                "username": username,
                "display_name": username,
                "password": "senha-forte",
                "sector_id": sector["id"],
            },
        )
        assert created.status_code == 201, created.text
    return sector


def test_admin_lists_channels_by_sector_with_member_count(client) -> None:
    headers = _admin_headers(client)
    quality = _seed(client, "Qualidade", ("ana.souza", "bruno.lima"))
    _seed(client, "Produção", ("carla.dias",))

    response = client.get("/admin/channels", headers=headers, params={"sector_id": quality["id"]})
    assert response.status_code == 200, response.text
    channels = response.json()
    assert len(channels) == 1
    channel = channels[0]
    assert channel["sector_id"] == quality["id"]
    assert channel["sector_name"] == "Qualidade"
    assert channel["member_count"] == 2
    assert channel["archived_at"] is None
    assert channel["name"] == "Qualidade"

    all_channels = client.get("/admin/channels", headers=headers).json()
    assert {c["sector_name"] for c in all_channels} >= {"Qualidade", "Produção"}

    # Filtro por setor vazio quando o id não bate.
    empty = client.get(
        "/admin/channels",
        headers=headers,
        params={"sector_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert empty.json() == []


def test_admin_renames_channel(client) -> None:
    headers = _admin_headers(client)
    sector = _seed(client, "Regulatório", ("ana.souza",))

    channels = client.get("/admin/channels", headers=headers).json()
    channel_id = next(c["id"] for c in channels if c["sector_id"] == sector["id"])

    renamed = client.patch(
        f"/admin/channels/{channel_id}", headers=headers, json={"name": "Assuntos Regulatórios"}
    )
    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert body["name"] == "Assuntos Regulatórios"
    assert body["archived_at"] is None
    assert body["member_count"] == 1

    # Persistiu.
    channels = client.get("/admin/channels", headers=headers).json()
    assert any(c["name"] == "Assuntos Regulatórios" for c in channels)

    audit = client.get("/admin/audit", headers=headers, params={"action": "channel.update"}).json()
    assert any(entry["entity_id"] == channel_id for entry in audit)


def test_admin_archives_and_reopens_channel(client) -> None:
    headers = _admin_headers(client)
    sector = _seed(client, "Arquivo Morto", ("ana.souza",))
    channels = client.get("/admin/channels", headers=headers).json()
    channel_id = next(c["id"] for c in channels if c["sector_id"] == sector["id"])

    archived = client.patch(
        f"/admin/channels/{channel_id}", headers=headers, json={"archived": True}
    )
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    # Só os não arquivados quando include_archived=False.
    active_only = client.get(
        "/admin/channels", headers=headers, params={"include_archived": False}
    ).json()
    assert all(c["id"] != channel_id for c in active_only)

    reopened = client.patch(
        f"/admin/channels/{channel_id}", headers=headers, json={"archived": False}
    )
    assert reopened.status_code == 200
    assert reopened.json()["archived_at"] is None


def test_admin_stats_includes_storage_disk_usage(client) -> None:
    headers = _admin_headers(client)
    _seed(client, "Estatística", ("ana.souza",))

    # Um arquivo para dar volume ao STORAGE_DIR.
    ana = _login(client, "ana.souza")
    upload = client.post(
        "/files",
        headers={"Authorization": f"Bearer {ana}"},
        files={"file": ("dados.bin", b"x" * 4096, "application/octet-stream")},
    )
    assert upload.status_code == 201, upload.text

    response = client.get("/admin/stats", headers=headers)
    assert response.status_code == 200, response.text
    stats = response.json()

    assert stats["users"] >= 2
    assert stats["attachments"] >= 1
    assert stats["storage_bytes"] >= 4096
    assert stats["storage_files"] >= 1
    assert stats["disk_total_bytes"] > 0
    assert 0 < stats["disk_free_bytes"] < stats["disk_total_bytes"]


def test_channels_require_admin(client) -> None:
    _seed(client, "Acesso", ("ana.souza",))
    member_h = {"Authorization": f"Bearer {_login(client, 'ana.souza')}"}

    response = client.get("/admin/channels", headers=member_h)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
