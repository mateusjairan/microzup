"""E2E de WebSocket (AGENTS.md §10): entrega, reconexão e catch-up por seq.

Contra o servidor uvicorn REAL em porta livre (ver conftest): httpx para o
REST, cliente `websockets` para o socket. Nada de TestClient.
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import websockets

from tests.e2e.conftest import SERVER_PASSWORD

RECV_TIMEOUT = 10.0


async def _ticket(base_url: str, token: str) -> str:
    async with httpx.AsyncClient(base_url=base_url, timeout=10.0) as http:
        response = await http.post("/ws/ticket", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200, response.text
        return response.json()["ticket"]


@contextlib.asynccontextmanager
async def _ws(base_url: str, token: str) -> AsyncIterator[Any]:
    ticket = await _ticket(base_url, token)
    async with websockets.connect(
        f"ws://{base_url.removeprefix('http://')}/ws?ticket={ticket}",
        open_timeout=10,
        close_timeout=5,
    ) as connection:
        yield connection


async def _expect(connection, message_type: str) -> dict:
    """Recebe o próximo evento e exige o tipo (fila determinística)."""
    raw = await asyncio.wait_for(connection.recv(), RECV_TIMEOUT)
    event = json.loads(raw)
    assert event["type"] == message_type, f"esperava {message_type}, veio {event}"
    return event


async def _skip_presence(connection) -> None:
    """Consome o eco de presença da própria conexão (se ainda pendente)."""
    raw = await asyncio.wait_for(connection.recv(), RECV_TIMEOUT)
    event = json.loads(raw)
    assert event["type"] in ("hello", "presence.changed"), event


async def test_message_created_is_delivered_to_online_members(seeded: dict) -> None:
    base = seeded["base_url"]
    async with (
        _ws(base, seeded["ana"]) as ana_ws,
        _ws(base, seeded["bruno"]) as bruno_ws,
    ):
        hello_ana = await _expect(ana_ws, "hello")
        assert hello_ana["payload"]["user"]["username"] == "ana.souza"
        assert seeded["dm_id"] in hello_ana["payload"]["subscriptions"]
        await _expect(ana_ws, "presence.changed")  # eco próprio

        await _expect(bruno_ws, "hello")
        await _expect(bruno_ws, "presence.changed")  # eco próprio
        await _expect(ana_ws, "presence.changed")  # bruno conectou

        # Envio via REST: o EventBus entrega aos membros online.
        async with httpx.AsyncClient(base_url=base, timeout=10.0) as http:
            sent = await http.post(
                "/messages",
                headers={"Authorization": f"Bearer {seeded['ana']}"},
                json={
                    "conversation_id": seeded["dm_id"],
                    "client_id": "e2e-1",
                    "body": "olá do E2E",
                },
            )
            assert sent.status_code == 201, sent.text
            message = sent.json()

        ana_event = await _expect(ana_ws, "message.created")
        assert ana_event["seq"] == message["seq"]
        assert ana_event["payload"]["body"] == "olá do E2E"
        assert ana_event["payload"]["conversation_id"] == seeded["dm_id"]
        assert ana_event["ts"]

        bruno_event = await _expect(bruno_ws, "message.created")
        assert bruno_event["seq"] == message["seq"]
        assert bruno_event["payload"]["sender_id"] == seeded["ids"]["ana.souza"]


async def test_reconnect_requires_fresh_ticket_and_catch_up_loses_nothing(seeded: dict) -> None:
    base = seeded["base_url"]
    async with _ws(base, seeded["ana"]) as ana_ws:
        await _expect(ana_ws, "hello")
        await _expect(ana_ws, "presence.changed")  # eco próprio

        async with _ws(base, seeded["bruno"]) as bruno_ws:
            await _expect(bruno_ws, "hello")
            await _expect(bruno_ws, "presence.changed")  # eco próprio
            await _expect(ana_ws, "presence.changed")  # bruno conectou

            # Ana vê a mensagem 1 ao vivo.
            async with httpx.AsyncClient(base_url=base, timeout=10.0) as http:
                first = await http.post(
                    "/messages",
                    headers={"Authorization": f"Bearer {seeded['ana']}"},
                    json={
                        "conversation_id": seeded["dm_id"],
                        "client_id": "e2e-c1",
                        "body": "primeira",
                    },
                )
            assert first.status_code == 201
            seen = await _expect(ana_ws, "message.created")
            last_seq = seen["seq"]
            await _expect(bruno_ws, "message.created")

            # Ana cai da rede (o socket fecha de verdade).
            await ana_ws.close()

            # Enquanto Ana está fora, duas mensagens são enviadas.
            async with httpx.AsyncClient(base_url=base, timeout=10.0) as http:
                second = await http.post(
                    "/messages",
                    headers={"Authorization": f"Bearer {seeded['bruno']}"},
                    json={
                        "conversation_id": seeded["dm_id"],
                        "client_id": "e2e-c2",
                        "body": "durante a queda 1",
                    },
                )
                third = await http.post(
                    "/messages",
                    headers={"Authorization": f"Bearer {seeded['bruno']}"},
                    json={
                        "conversation_id": seeded["dm_id"],
                        "client_id": "e2e-c3",
                        "body": "durante a queda 2",
                    },
                )
            assert second.status_code == 201 and third.status_code == 201

            # O ticket usado pela conexão caída já foi consumido: reusar → 4401.
            stale_ticket = await _ticket(base, seeded["ana"])
            stale_url = f"ws://{base.removeprefix('http://')}/ws?ticket={stale_ticket}"
            async with websockets.connect(stale_url, open_timeout=10) as consumed_once:
                await _expect(consumed_once, "hello")
            reconnect = await websockets.connect(stale_url, open_timeout=10)
            with pytest.raises(websockets.exceptions.ConnectionClosedError) as closed:
                await asyncio.wait_for(reconnect.recv(), RECV_TIMEOUT)
            assert closed.value.rcvd is not None and closed.value.rcvd.code == 4401
            with contextlib.suppress(websockets.exceptions.ConnectionClosed):
                await reconnect.close()

            # Reconexão com ticket NOVO funciona e entrega o snapshot do hello.
            async with _ws(base, seeded["ana"]) as ana_ws2:
                hello = await _expect(ana_ws2, "hello")
                assert hello["payload"]["user"]["username"] == "ana.souza"
                await _expect(ana_ws2, "presence.changed")  # eco próprio
                await _expect(bruno_ws, "presence.changed")  # ana voltou

                # O hello não repõe o histórico: lacuna de seq → o cliente
                # refaz por after_seq e nada se perde (plano §7).
                async with httpx.AsyncClient(base_url=base, timeout=10.0) as http:
                    catch_up = await http.get(
                        f"/conversations/{seeded['dm_id']}/messages",
                        headers={"Authorization": f"Bearer {seeded['ana']}"},
                        params={"after_seq": last_seq},
                    )
                assert catch_up.status_code == 200, catch_up.text
                missed = catch_up.json()
                assert [m["seq"] for m in missed] == [
                    second.json()["seq"],
                    third.json()["seq"],
                ]
                assert [m["body"] for m in missed] == ["durante a queda 1", "durante a queda 2"]

                # E o canal segue ao vivo: mensagem nova chega na hora.
                async with httpx.AsyncClient(base_url=base, timeout=10.0) as http:
                    fourth = await http.post(
                        "/messages",
                        headers={"Authorization": f"Bearer {seeded['bruno']}"},
                        json={
                            "conversation_id": seeded["dm_id"],
                            "client_id": "e2e-c4",
                            "body": "depois da reconexão",
                        },
                    )
                assert fourth.status_code == 201
                live = await _expect(ana_ws2, "message.created")
                assert live["seq"] == fourth.json()["seq"]
                await _expect(bruno_ws, "message.created")


async def test_ws_without_ticket_is_refused(seeded: dict) -> None:
    url = f"ws://{seeded['base_url'].removeprefix('http://')}/ws"
    connection = await websockets.connect(url, open_timeout=10)
    with pytest.raises(websockets.exceptions.ConnectionClosedError) as closed:
        await asyncio.wait_for(connection.recv(), RECV_TIMEOUT)
    assert closed.value.rcvd is not None and closed.value.rcvd.code == 4401
    with contextlib.suppress(websockets.exceptions.ConnectionClosed):
        await connection.close()


async def test_login_via_rest_against_real_server(seeded: dict) -> None:
    """Prova ponta a ponta do REST contra o servidor real (não TestClient)."""
    async with httpx.AsyncClient(base_url=seeded["base_url"], timeout=10.0) as http:
        response = await http.post(
            "/auth/login",
            json={"username": "ana.souza", "password": SERVER_PASSWORD},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user"]["username"] == "ana.souza"
        me = await http.get("/me", headers={"Authorization": f"Bearer {body['access_token']}"})
        assert me.status_code == 200, me.text
        assert me.json()["username"] == "ana.souza"
