"""WebSocket: entrega, envelope com seq, catch-up e eventos do plano §6.

Cada teste consome a fila de eventos explicitamente e na ordem: ao conectar,
o hub emite `hello` e um `presence.changed` do próprio usuário; conexões de
outros usuários geram `presence.changed` adicionais nas filas de todos.
"""

import pytest
from starlette.websockets import WebSocketDisconnect


def _login(client, username: str, password: str = "senha-forte") -> str:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _seed(client, sector_name: str, members: tuple[str, ...]) -> dict:
    headers = {"Authorization": f"Bearer {_login(client, 'admin', 'admin12345')}"}
    sector = client.post("/admin/sectors", headers=headers, json={"name": sector_name}).json()
    ids: dict[str, str] = {}
    for username in members:
        created = client.post(
            "/admin/users",
            headers=headers,
            json={
                "username": username,
                "display_name": username.replace(".", " ").title(),
                "password": "senha-forte",
                "sector_id": sector["id"],
            },
        )
        assert created.status_code == 201, created.text
        ids[username] = created.json()["id"]
    return {"headers": headers, "ids": ids}


def _ticket(client, token: str) -> str:
    response = client.post("/ws/ticket", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return response.json()["ticket"]


def _open(client, token: str):
    return client.websocket_connect(f"/ws?ticket={_ticket(client, token)}")


def _expect(ws, message_type: str) -> dict:
    """Recebe o próximo evento e exige o tipo esperado (fila determinística)."""
    event = ws.receive_json()
    assert event["type"] == message_type, f"esperava {message_type}, veio {event}"
    return event


def test_hello_carries_version_user_subscriptions_and_presence(client) -> None:
    seeded = _seed(client, "Presença", ("ana.souza", "bruno.lima"))
    ana = _login(client, "ana.souza")
    bruno = _login(client, "bruno.lima")
    ana_id, bruno_id = seeded["ids"]["ana.souza"], seeded["ids"]["bruno.lima"]

    dm = client.post(
        "/conversations/dm",
        headers={"Authorization": f"Bearer {ana}"},
        json={"user_id": bruno_id},
    ).json()

    with _open(client, ana) as ana_ws:
        hello = _expect(ana_ws, "hello")
        payload = hello["payload"]
        assert payload["version"] == "0.1.0"
        assert payload["user"]["id"] == ana_id
        assert payload["user"]["username"] == "ana.souza"
        assert payload["user"]["display_name"] == "Ana Souza"
        assert dm["id"] in payload["subscriptions"]
        assert len(payload["subscriptions"]) == 2  # canal do setor + DM
        assert payload["presence"] == {ana_id: "available"}
        assert payload["status_messages"] == {}
        _expect(ana_ws, "presence.changed")  # eco da própria conexão

        # Recado de status: até 120 chars, transporte no payload de presence.
        ana_ws.send_json(
            {"type": "presence.set", "status": "busy", "status_message": "Em auditoria até 14h"}
        )
        changed = _expect(ana_ws, "presence.changed")["payload"]
        assert changed["user_id"] == ana_id
        assert changed["status"] == "busy"
        assert changed["status_message"] == "Em auditoria até 14h"

        with _open(client, bruno) as bruno_ws:
            bruno_hello = _expect(bruno_ws, "hello")
            bruno_payload = bruno_hello["payload"]
            # O snapshot do hello reflete status + recado dos outros membros.
            assert bruno_payload["presence"][ana_id] == "busy"
            assert bruno_payload["status_messages"][ana_id] == "Em auditoria até 14h"
            _expect(bruno_ws, "presence.changed")  # eco da própria conexão

            # A fila da Ana também vê a conexão do Bruno.
            bruno_seen = _expect(ana_ws, "presence.changed")["payload"]
            assert bruno_seen["user_id"] == bruno_id
            assert bruno_seen["status"] == "available"

            # Status inválido é recusado com envelope de erro.
            ana_ws.send_json({"type": "presence.set", "status": "online"})
            error = _expect(ana_ws, "error")["payload"]
            assert error["code"] == "invalid_status"

            # Recado acima de 120 chars é recusado.
            ana_ws.send_json(
                {"type": "presence.set", "status": "busy", "status_message": "x" * 121}
            )
            error = _expect(ana_ws, "error")["payload"]
            assert error["code"] == "status_message_too_long"

            # Limpar o recado funciona.
            ana_ws.send_json({"type": "presence.set", "status": "busy", "status_message": ""})
            cleared = _expect(ana_ws, "presence.changed")["payload"]
            assert "status_message" not in cleared
        # saída do with: bruno desconecta e todos recebem o offline
        offline = _expect(ana_ws, "presence.changed")["payload"]
        assert offline["user_id"] == bruno_id
        assert offline["status"] == "offline"


def test_message_created_envelope_has_seq_and_read_updated_broadcasts(client) -> None:
    seeded = _seed(client, "Tempo Real", ("ana.souza", "bruno.lima"))
    ana_id, bruno_id = seeded["ids"]["ana.souza"], seeded["ids"]["bruno.lima"]
    ana, bruno = _login(client, "ana.souza"), _login(client, "bruno.lima")
    ana_h, bruno_h = {"Authorization": f"Bearer {ana}"}, {"Authorization": f"Bearer {bruno}"}

    dm = client.post("/conversations/dm", headers=ana_h, json={"user_id": bruno_id}).json()

    with _open(client, ana) as ana_ws:
        _expect(ana_ws, "hello")
        _expect(ana_ws, "presence.changed")  # eco próprio

        with _open(client, bruno) as bruno_ws:
            _expect(bruno_ws, "hello")
            _expect(bruno_ws, "presence.changed")  # eco próprio
            _expect(ana_ws, "presence.changed")  # bruno conectou

            sent = client.post(
                "/messages",
                headers=ana_h,
                json={"conversation_id": dm["id"], "client_id": "c1", "body": "Olá!"},
            )
            assert sent.status_code == 201
            message = sent.json()

            # Envelope WS carrega o seq canônico: lacuna detectável no cliente.
            ana_event = _expect(ana_ws, "message.created")
            assert ana_event["seq"] == message["seq"]
            assert ana_event["payload"]["body"] == "Olá!"
            assert ana_event["payload"]["client_id"] == "c1"

            bruno_event = _expect(bruno_ws, "message.created")
            assert bruno_event["seq"] == message["seq"]
            assert bruno_event["payload"]["sender_id"] == ana_id

            # Bruno marca como lida: read.updated chega aos membros da conversa.
            read = client.post(
                f"/conversations/{dm['id']}/read",
                headers=bruno_h,
                json={"last_read_seq": message["seq"]},
            )
            assert read.status_code == 204

            ana_read = _expect(ana_ws, "read.updated")
            assert ana_read["payload"]["user_id"] == bruno_id
            assert ana_read["payload"]["last_read_seq"] == message["seq"]
            assert ana_read["seq"] == message["seq"]

            bruno_read = _expect(bruno_ws, "read.updated")
            assert bruno_read["payload"]["user_id"] == bruno_id

            # Ping/pong de keepalive responde no envelope.
            ana_ws.send_json({"type": "ping"})
            pong = _expect(ana_ws, "pong")
            assert pong["payload"] == {}


def test_typing_is_restricted_to_conversation_members(client) -> None:
    seeded = _seed(client, "Digitação", ("ana.souza", "bruno.lima", "carla.dias", "daniel.alves"))
    ana_id = seeded["ids"]["ana.souza"]
    daniel_id = seeded["ids"]["daniel.alves"]
    ana, bruno = _login(client, "ana.souza"), _login(client, "bruno.lima")
    carla, daniel = _login(client, "carla.dias"), _login(client, "daniel.alves")
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": seeded["ids"]["bruno.lima"]}
    ).json()

    with _open(client, carla) as carla_ws:
        _expect(carla_ws, "hello")
        _expect(carla_ws, "presence.changed")  # eco próprio

        with _open(client, ana) as ana_ws:
            _expect(ana_ws, "hello")
            _expect(ana_ws, "presence.changed")
            _expect(carla_ws, "presence.changed")  # ana conectou

            with _open(client, bruno) as bruno_ws:
                _expect(bruno_ws, "hello")
                _expect(bruno_ws, "presence.changed")
                _expect(ana_ws, "presence.changed")  # bruno conectou
                _expect(carla_ws, "presence.changed")  # bruno conectou

                # Ana digita na DM com Bruno: só os membros recebem.
                ana_ws.send_json({"type": "typing", "conversation_id": dm["id"], "is_typing": True})

                typing = _expect(bruno_ws, "typing")["payload"]
                assert typing["conversation_id"] == dm["id"]
                assert typing["is_typing"] is True
                assert typing["user_id"] == ana_id
                # O autor também recebe o eco (multi-dispositivo).
                _expect(ana_ws, "typing")

                # Carla (fora da conversa) não recebe: a próxima mensagem dela é
                # a presença da conexão do Daniel — prova de que o typing não vazou.
                with _open(client, daniel):
                    leaked = carla_ws.receive_json()
                    assert leaked["type"] == "presence.changed", leaked
                    assert leaked["payload"]["user_id"] == daniel_id
                # saída do with: daniel caiu → offline para todos
                offline = _expect(carla_ws, "presence.changed")["payload"]
                assert offline["user_id"] == daniel_id
                assert offline["status"] == "offline"

                # Não-membro tentando digitar na conversa: descartado, sem eco.
                carla_ws.send_json(
                    {"type": "typing", "conversation_id": dm["id"], "is_typing": True}
                )
                with _open(client, daniel):
                    after = carla_ws.receive_json()
                    assert after["type"] == "presence.changed", after
                    assert after["payload"]["user_id"] == daniel_id


def test_nudge_flow_dnd_refusal_delivery_and_throttle(client) -> None:
    seeded = _seed(client, "Atenção", ("ana.souza", "bruno.lima"))
    ana_id = seeded["ids"]["ana.souza"]
    ana, bruno = _login(client, "ana.souza"), _login(client, "bruno.lima")
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm = client.post(
        "/conversations/dm", headers=ana_h, json={"user_id": seeded["ids"]["bruno.lima"]}
    ).json()

    with _open(client, ana) as ana_ws:
        _expect(ana_ws, "hello")
        _expect(ana_ws, "presence.changed")

        with _open(client, bruno) as bruno_ws:
            _expect(bruno_ws, "hello")
            _expect(bruno_ws, "presence.changed")
            _expect(ana_ws, "presence.changed")  # bruno conectou

            # Bruno entra em DND.
            bruno_ws.send_json({"type": "presence.set", "status": "dnd"})
            dnd = _expect(ana_ws, "presence.changed")["payload"]
            assert dnd["status"] == "dnd"
            _expect(bruno_ws, "presence.changed")  # eco próprio do dnd

            # Nudge recusado: destinatário em DND.
            ana_ws.send_json({"type": "nudge", "conversation_id": dm["id"]})
            refused = _expect(ana_ws, "nudge.refused")["payload"]
            assert refused["reason"] == "dnd"
            assert refused["conversation_id"] == dm["id"]

            # Bruno volta ao available (a recusa não consumiu o cooldown).
            bruno_ws.send_json({"type": "presence.set", "status": "available"})
            _expect(ana_ws, "presence.changed")
            _expect(bruno_ws, "presence.changed")

            # Nudge entregue aos membros elegíveis.
            ana_ws.send_json({"type": "nudge", "conversation_id": dm["id"]})
            nudge = _expect(bruno_ws, "nudge")["payload"]
            assert nudge["conversation_id"] == dm["id"]
            assert nudge["sender_id"] == ana_id
            assert nudge["sender_name"] == "Ana Souza"

            # Segundo nudge na mesma conversa dentro de 5 min: throttled.
            ana_ws.send_json({"type": "nudge", "conversation_id": dm["id"]})
            throttled = _expect(ana_ws, "nudge.refused")["payload"]
            assert throttled["reason"] == "throttled"

            # Auditoria do nudge entregue.
            audit = client.get(
                "/admin/audit",
                headers=seeded["headers"],
                params={"action": "message.nudge"},
            ).json()
            assert len(audit) == 1
            assert audit[0]["entity_id"] == dm["id"]


def test_upload_notifies_attachment_ready_to_uploader(client) -> None:
    import io

    from PIL import Image

    _seed(client, "Anexos", ("ana.souza",))
    ana = _login(client, "ana.souza")

    with _open(client, ana) as ana_ws:
        _expect(ana_ws, "hello")
        _expect(ana_ws, "presence.changed")  # eco próprio

        buffer = io.BytesIO()
        Image.new("RGB", (600, 400), "red").save(buffer, format="PNG")
        upload = client.post(
            "/files",
            headers={"Authorization": f"Bearer {ana}"},
            files={"file": ("foto.png", buffer.getvalue(), "image/png")},
        )
        assert upload.status_code == 201, upload.text
        attachment = upload.json()

        # EventBus → hub: o uploader é avisado de que a prévia já está disponível.
        ready = _expect(ana_ws, "attachment.ready")
        assert ready["payload"]["attachment_id"] == attachment["id"]
        assert ready["payload"]["has_thumbnail"] is True


def test_deactivating_user_closes_open_websocket(client) -> None:
    seeded = _seed(client, "Desativação", ("ana.souza", "bruno.lima"))
    bruno_token = _login(client, "bruno.lima")
    bruno_id = seeded["ids"]["bruno.lima"]

    with _open(client, bruno_token) as bruno_ws:
        _expect(bruno_ws, "hello")
        _expect(bruno_ws, "presence.changed")

        response = client.patch(
            f"/admin/users/{bruno_id}",
            headers=seeded["headers"],
            json={"is_active": False},
        )
        assert response.status_code == 200, response.text

        # O hub fecha o socket aberto do usuário desativado (código 4403).
        with pytest.raises(WebSocketDisconnect) as exc_info:
            for _ in range(5):
                bruno_ws.receive_json()
        assert exc_info.value.code == 4403
