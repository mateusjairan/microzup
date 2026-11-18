"""Itens de contrato apontados pela UI (task-5):

1. `ConversationOut.archived_at` — o membro comum descobre canal arquivado
   antes do primeiro envio (composer read-only com explicação).
2. `last_read_seq` por conversa no GET /conversations — a UI posiciona a
   "primeira não lida" exatamente, sem heurística.
3. GET /conversations/{id}/members — lista real com papel e presença,
   autorização revalidada por ConversationAccessPolicy.
"""

from tests.api.test_search import _login, _open_dm, _seed, _send


def test_conversations_expose_archived_at_for_regular_member(client) -> None:
    seeded = _seed(client, "Contrato Arquivo", ("ana.souza",))
    ana = _login(client, "ana.souza")
    ana_h = {"Authorization": f"Bearer {ana}"}

    # O canal do setor nasce aberto: archived_at null no contrato.
    summaries = client.get("/conversations", headers=ana_h).json()
    channel = next(s for s in summaries if s["conversation"]["kind"] == "channel")
    assert channel["conversation"]["archived_at"] is None

    # Admin arquiva o canal; a listagem comum passa a expor o timestamp.
    channel_id = channel["conversation"]["id"]
    archived = client.patch(
        f"/admin/channels/{channel_id}", headers=seeded["admin"], json={"archived": True}
    )
    assert archived.status_code == 200, archived.text

    summaries = client.get("/conversations", headers=ana_h).json()
    channel = next(s for s in summaries if s["conversation"]["id"] == channel_id)
    assert channel["conversation"]["archived_at"] is not None


def test_conversations_expose_last_read_seq_of_requester(client) -> None:
    seeded = _seed(client, "Contrato Leitura", ("ana.souza", "bruno.lima"))
    ana = _login(client, "ana.souza")
    ana_h = {"Authorization": f"Bearer {ana}"}
    dm = _open_dm(client, ana, seeded["ids"]["bruno.lima"])

    _send(client, ana, dm["id"], "c1", "primeira mensagem")
    second = _send(client, ana, dm["id"], "c2", "segunda mensagem")

    summaries = client.get("/conversations", headers=ana_h).json()
    summary = next(s for s in summaries if s["conversation"]["id"] == dm["id"])
    assert summary["unread_count"] == 2
    assert summary["last_read_seq"] == 0  # nunca leu

    # Bruno marca tudo como lido: o campo dele (não o da Ana) muda.
    bruno = _login(client, "bruno.lima")
    read = client.post(
        f"/conversations/{dm['id']}/read",
        headers={"Authorization": f"Bearer {bruno}"},
        json={"last_read_seq": second["seq"]},
    )
    assert read.status_code == 204

    bruno_summaries = client.get(
        "/conversations", headers={"Authorization": f"Bearer {bruno}"}
    ).json()
    bruno_summary = next(s for s in bruno_summaries if s["conversation"]["id"] == dm["id"])
    assert bruno_summary["last_read_seq"] == second["seq"]
    assert bruno_summary["unread_count"] == 0

    # O campo é do solicitante: Ana continua não lendo nada.
    summaries = client.get("/conversations", headers=ana_h).json()
    summary = next(s for s in summaries if s["conversation"]["id"] == dm["id"])
    assert summary["last_read_seq"] == 0
    assert summary["unread_count"] == 2


def test_conversation_members_lists_real_membership_with_presence(client) -> None:
    seeded = _seed(client, "Contrato Membros", ("ana.souza", "bruno.lima", "carla.dias"))
    ana = _login(client, "ana.souza")
    bruno = _login(client, "bruno.lima")
    carla = _login(client, "carla.dias")
    ana_h = {"Authorization": f"Bearer {ana}"}

    dm = _open_dm(client, ana, seeded["ids"]["bruno.lima"])

    # Bruno conecta no WS e fica "available"; a presença aparece no endpoint.
    with client.websocket_connect(f"/ws?ticket={_ticket(client, bruno)}") as ws_bruno:
        _expect(ws_bruno, "hello")
        _expect(ws_bruno, "presence.changed")  # eco próprio

        members = client.get(f"/conversations/{dm['id']}/members", headers=ana_h).json()
        by_id = {m["user_id"]: m for m in members}
        assert set(by_id) == {seeded["ids"]["ana.souza"], seeded["ids"]["bruno.lima"]}
        assert by_id[seeded["ids"]["ana.souza"]]["username"] == "ana.souza"
        assert by_id[seeded["ids"]["bruno.lima"]]["presence"] == "available"
        assert by_id[seeded["ids"]["ana.souza"]]["role"] == "member"

    # DM basta o par — não há terceiro membro.
    # Canal de setor: lista materializada do setor inteiro.
    channels = client.get("/admin/channels", headers=seeded["admin"]).json()
    channel = next(c for c in channels if c["name"] == "Contrato Membros")
    channel_members = client.get(f"/conversations/{channel['id']}/members", headers=ana_h).json()
    assert {m["username"] for m in channel_members} == {
        "ana.souza",
        "bruno.lima",
        "carla.dias",
    }
    # Ninguém conectado agora: todos offline.
    assert all(m["presence"] == "offline" for m in channel_members)

    # Não-membro recebe 403 com o envelope de erro do contrato.
    outsider_h = {"Authorization": f"Bearer {carla}"}
    denied = client.get(f"/conversations/{dm['id']}/members", headers=outsider_h)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "access_denied"


def _ticket(client, token: str) -> str:
    response = client.post("/ws/ticket", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    return response.json()["ticket"]


def _expect(ws, message_type: str) -> dict:
    event = ws.receive_json()
    assert event["type"] == message_type, f"esperava {message_type}, veio {event}"
    return event
