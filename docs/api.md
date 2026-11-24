# Microzup — Manual da API

> Contrato REST + WebSocket do servidor Microzup, conforme `docs/plano-mvp.md` §5–§7.
> Estado: **final do MVP**, revisado para o cliente web em 2026-11-24 (auth por
> cookie `HttpOnly`, SPA servida em `/`); a cobertura está na seção 8.
>
> Referência viva: o OpenAPI é gerado pelo próprio servidor em `GET /docs`
> (Swagger UI) e `GET /openapi.json` quando a API está no ar.

- **Base URL (dev):** `http://localhost:8666` (o mesmo host serve o SPA em `/`)
- **Autenticação:** `Authorization: Bearer <access_token>` (JWT, 15 min por padrão).
  O refresh token **não** trafega no corpo: vive em cookie `HttpOnly` +
  `SameSite=Strict`, `Path=/auth`, emitido por `/auth/login` e rotacionado por
  `/auth/refresh`. O JavaScript do cliente nunca o vê.
- **Conteúdo:** `application/json`, exceto `POST /files` (multipart/form-data) e downloads (binário)
- **Datas:** ISO 8601 em UTC (ex.: `2026-11-18T14:02:11.123456+00:00`)
- **IDs:** UUID v4

---

## 1. Convenções

### 1.1 Envelope de erro

Todo erro de regra de negócio responde no formato único:

```json
{
  "error": {
    "code": "access_denied",
    "message": "Você não participa desta conversa.",
    "details": {}
  }
}
```

### 1.2 Mapeamento DomainError → HTTP

| Erro de domínio | `code` | HTTP |
|---|---|---|
| `ValidationError` | `validation_error` | 422 |
| `AuthenticationError` | `authentication_error` | 401 |
| `InvalidTokenError` | `invalid_token` | 401 |
| `AccessDeniedError` | `access_denied` | 403 |
| `InactiveUserError` | `inactive_user` | 403 |
| `NotFoundError` | `not_found` | 404 |
| `ConflictError` (ex.: `user_already_exists`, `sector_already_exists`) | `conflict`, `user_already_exists`, `sector_already_exists` | 409 |
| `RateLimitedError` | `rate_limited` | 429 |
| `TooManyAttemptsError` (bloqueio progressivo de login) | `too_many_attempts` | 429 |
| Outros `DomainError` | `domain_error` | 400 |

O envelope é **universal** — também nas bordas que não são erro de domínio:

- **Guardas HTTP** (401 sem token, 403 de não-admin, 404 de rota etc.): mesmo
  envelope com `code` derivado do status (`unauthorized`, `forbidden`,
  `not_found`, `method_not_allowed`, `payload_too_large`, …);
- **Erros de validação de request** (JSON inválido, campo com tipo errado):
  `422` `validation_error` com `details.errors` = lista de `{loc, msg, type}`;
- **Erro inesperado** (500): `internal_error` sem detalhe interno no corpo —
  o stack fica apenas no log estruturado.

Exemplo de 422 com detalhes:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Dados inválidos.",
    "details": {
      "errors": [{ "loc": ["body", "body"], "msg": "Field required", "type": "missing" }]
    }
  }
}
```

### 1.3 Regras transversais

- **Idempotência de envio:** `POST /messages` exige `client_id` (até 64 chars);
  reenviar o mesmo `(conversation_id, client_id)` devolve a mensagem original,
  sem duplicar nem reauditar. Retry de rede nunca gera mensagem dupla.
- **`seq` é a ordem canônica:** paginação (`before_seq`) e catch-up (`after_seq`)
  usam o `seq` da mensagem, nunca `created_at`. `seq` vem do banco — o cliente
  nunca o inventa.
- **Autorização revalidada por conversa:** toda leitura/escrita de mensagens e
  arquivos checa participação no servidor (`ConversationAccessPolicy`).
- **Rate limit em memória** (1 processo): login (10/min por IP + bloqueio
  progressivo por IP+usuário), envio de mensagem (30/min por usuário) e upload
  (20/min por usuário). Exceder responde `429` com `code: "rate_limited"`.
- **Auditoria append-only:** ações sensíveis geram `audit_log` (§6.5) com
  `action = "entidade.verbo"`.

---

## 2. Autenticação e sessão

### 2.1 `POST /auth/login`

Credenciais locais (Argon2id). Cria uma **sessão por dispositivo** (refresh token
opaco, hash no banco). 5 falhas seguidas por IP+usuário bloqueiam a conta
progressivamente (base 5 min, dobrando a cada ciclo até 1 h —
`LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_SECONDS`); enquanto bloqueado, o login
responde `429` `too_many_attempts` com o tempo de espera na mensagem.

**Request**

```json
POST /auth/login
{
  "username": "ana.souza",
  "password": "senha-forte",
  "device_name": "Edge/Windows",
  "remember": true
}
```

`username` é case-insensitive (`citext`). `device_name` (opcional, 120 chars)
aparece no log de auditoria da sessão. `remember` (default `true`) controla o
cookie: `true` = persistente por `REFRESH_TOKEN_TTL_DAYS`; `false` = cookie de
sessão do navegador (some ao fechar).

**Response 200** (+ dois `Set-Cookie`)

```http
Set-Cookie: mz_refresh=<token>; HttpOnly; SameSite=strict; Path=/auth; Max-Age=2592000
Set-Cookie: mz_remember=1;     HttpOnly; SameSite=strict; Path=/auth; Max-Age=2592000
```

```json
{
  "access_token": "eyJhbGciOi...",
  "user": {
    "id": "39b25253-7779-4545-b794-dcd8adcf9802",
    "username": "ana.souza",
    "display_name": "Ana Souza",
    "role": "member",
    "sector_id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1",
    "is_active": true
  }
}
```

**Erros:** `401` `authentication_error` (usuário ou senha inválidos) · `403`
`inactive_user` (desativado) · `429` `too_many_attempts` (bloqueio progressivo
em efeito) · `429` `rate_limited` (limite por IP/min).

### 2.2 `POST /auth/refresh`

Rotaciona o refresh token (o anterior é revogado) e devolve um novo access. O
cliente faz isso **silenciosamente** quando o access expira (15 min) — sem
perder o rascunho do composer.

**Request:** sem corpo. O cookie `mz_refresh` (path `/auth`) é obrigatório.
Respostas incluem o novo cookie; `mz_remember` preserva a escolha de
"manter conectado" feita no login.

**Response 200**

```json
{ "access_token": "eyJhbGciOi..." }
```

**Erros:** `401` `invalid_token` (cookie ausente, revogado ou expirado — cliente
deve voltar ao login). Requisições com `Origin` de outro host também recebem
`401`.

### 2.3 `POST /auth/logout`

Revoga a sessão atual e apaga os cookies de refresh.

**Request:** sem corpo (lê o cookie `mz_refresh`).

**Response:** `204 No Content` (idempotente, mesmo sem cookie).

> **Cookies de sessão:** `Secure` é controlado por `COOKIE_SECURE` (ligue ao
> adotar TLS). Como o SPA é servido pela própria API, tudo é mesma origem e não
> há CORS no fluxo normal — a defesa contra CSRF é `SameSite=Strict` + recusa de
> `Origin` divergente em `refresh`/`logout`.

### 2.4 `POST /ws/ticket`

Emite um **ticket opaco de uso único** (TTL 30 s, `WS_TICKET_TTL_SECONDS`) para
abrir o WebSocket. O JWT nunca vai na query string do WS (vazaria em log de
acesso/proxy). Requer `Authorization: Bearer`.

**Response 200**

```json
{ "ticket": "wKd8...urlsafe", "expires_in": 30 }
```

### 2.5 `GET /me`

Perfil do usuário autenticado.

**Response 200**

```json
{
  "id": "39b25253-7779-4545-b794-dcd8adcf9802",
  "username": "ana.souza",
  "display_name": "Ana Souza",
  "role": "member",
  "sector_id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1",
  "is_active": true
}
```

---

## 3. Dados (diretório, setores, conversas)

### 3.1 `GET /users`

Diretório de usuários **ativos** com presença (para iniciar DMs e ver quem está
online). Não requer papel admin.

**Response 200**

```json
[
  {
    "id": "4724460c-3d79-4b4d-98e8-149c38b9364e",
    "username": "leo",
    "display_name": "Leo Martins",
    "role": "member",
    "sector_id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1",
    "is_active": true,
    "presence": "available"
  }
]
```

`presence`: `available` · `busy` · `away` · `dnd` · `offline` (invisível aparece
como `offline`).

### 3.2 `GET /sectors`

Setores visíveis a qualquer usuário autenticado (para exibir a sidebar e o
diretório por setor).

**Response 200**

```json
[
  {
    "id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1",
    "name": "Qualidade e Assuntos Regulatórios",
    "slug": "qualidade-e-assuntos-regulatorios",
    "description": "QA e regulatory affairs"
  }
]
```

### 3.3 `GET /conversations`

Canais de setor + DMs do usuário, com resumo para montar a sidebar.

**Response 200**

```json
[
  {
    "conversation": {
      "id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
      "kind": "channel",
      "name": "Qualidade e Assuntos Regulatórios",
      "sector_id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1",
      "archived_at": null,
      "peer_id": null,
      "peer_is_active": null
    },
    "unread_count": 3,
    "last_read_seq": 1039,
    "last_message": {
      "id": "c5940f4c-d2fc-47a4-902e-2f8f0cb6b1d3",
      "seq": 1042,
      "conversation_id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
      "sender_id": "4724460c-3d79-4b4d-98e8-149c38b9364e",
      "client_id": "abc-123",
      "body": "Segue o desvio 045 em anexo.",
      "created_at": "2026-11-18T14:02:11.123456+00:00",
      "edited_at": null,
      "deleted_at": null
    }
  },
  {
    "conversation": {
      "id": "0f1a2b3c-...",
      "kind": "dm",
      "name": null,
      "sector_id": null,
      "archived_at": null,
      "peer_id": "d0926f3a-2058-48ee-8f08-d3306f1a6795",
      "peer_is_active": true
    },
    "unread_count": 0,
    "last_read_seq": 0,
    "last_message": null
  }
]
```

- `unread_count`: mensagens com `seq > last_read_seq` do usuário na conversa;
  `last_read_seq` é devolvido junto (o cursor do usuário).
- `archived_at`: preenchido quando o canal foi arquivado pelo admin (§5.3) —
  conversa arquivada é somente leitura.
- `peer_id`/`peer_is_active`: presentes apenas em DMs (o "outro" participante);
  peer desativado deve aparecer como contato inativo com DM bloqueada.

### 3.4 `POST /conversations/dm`

Abre (ou reaproveita) uma DM 1:1. Idempotente: a DM entre dois usuários é única
(`dm_key`). Não é possível abrir DM consigo mesmo nem com usuário inexistente.

**Request**

```json
{ "user_id": "d0926f3a-2058-48ee-8f08-d3306f1a6795" }
```

**Response 200**

```json
{
  "id": "0f1a2b3c-4d5e-6f70-8a91-b2c3d4e5f607",
  "kind": "dm",
  "name": null,
  "sector_id": null,
  "peer_id": "d0926f3a-2058-48ee-8f08-d3306f1a6795",
  "peer_is_active": true
}
```

**Erros:** `422` (DM consigo mesmo) · `404` `not_found` (usuário inexistente).

### 3.5 `GET /conversations/{conversation_id}/members`

Membros reais da conversa com papel (owner/member) e presença — alimenta o
painel de detalhes ("Membros" com contagem de online). Autorização revalidada
pela mesma policy de leitura: não-membro recebe `403`.

**Response 200**

```json
[
  {
    "user_id": "4724460c-3d79-4b4d-98e8-149c38b9364e",
    "username": "leo",
    "display_name": "Leo Martins",
    "role": "member",
    "presence": "available"
  },
  {
    "user_id": "d0926f3a-2058-48ee-8f08-d3306f1a6795",
    "username": "teste",
    "display_name": "Usuário de Teste",
    "role": "owner",
    "presence": "offline"
  }
]
```

**Erros:** `403` `access_denied` (não é membro) · `404` (conversa inexistente).

### 3.6 `GET /conversations/{conversation_id}/messages`

Histórico paginado por cursor `seq`. Membros apenas.

| Query | Default | Descrição |
|---|---|---|
| `before_seq` | — | mensagens **anteriores** a este `seq` (paginação para trás) |
| `after_seq` | — | mensagens **posteriores** a este `seq` (catch-up de reconexão) |
| `limit` | `50` | 1–200 |

**Exemplo:** `GET /conversations/e1b2e99-.../messages?before_seq=1042&limit=50`

**Response 200** — lista de `MessageOut` (mesmo formato do `last_message` acima),
ordem crescente de `seq`.

**Erros:** `403` `access_denied` (não é membro) · `404` (conversa inexistente).

### 3.7 `POST /conversations/{conversation_id}/read`

Marca a leitura até `last_read_seq`. Dispara `read.updated` no WS (§7) para os
membros da conversa.

**Request**

```json
{ "last_read_seq": 1042 }
```

**Response:** `204 No Content`

### 3.8 `GET /search?q=`

Busca unificada: **mensagens** por full-text (`websearch_to_tsquery` com
dicionário `portuguese`, ranqueada por `ts_rank_cd`) e **arquivos** por
semelhança de nome (`pg_trgm` sobre `attachments.filename`). Sempre restrita às
conversas do usuário — nunca resultados de conversas alheias. Query vazia
devolve listas vazias.

| Query | Default | Descrição |
|---|---|---|
| `q` | (obrigatório) | texto livre; sintaxe `websearch` (`"frase exata"`, `OR`, `-excluir`) |
| `conversation_id` | — | filtra em uma conversa (o `Ctrl+F` do cliente); **revalida acesso** — não-membro recebe `403` |
| `limit` | `30` | 1–50, aplicado a cada lista |

**Exemplo:** `GET /search?q=desvio+045&conversation_id=e1b22e99-...`

**Response 200**

```json
{
  "messages": [
    {
      "id": "c5940f4c-d2fc-47a4-902e-2f8f0cb6b1d3",
      "seq": 1042,
      "conversation_id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
      "sender_id": "4724460c-3d79-4b4d-98e8-149c38b9364e",
      "client_id": "abc-123",
      "body": "Segue o desvio 045 em anexo.",
      "created_at": "2026-11-18T14:02:11.123456+00:00",
      "edited_at": null,
      "deleted_at": null
    }
  ],
  "files": [
    {
      "id": "82b9ee0f-bad0-4c03-96de-178b27b0b843",
      "filename": "desvio-045.pdf",
      "mime_type": "application/pdf",
      "size_bytes": 2200000,
      "sha256": "4ccc5de8e6ca8d8258e12fb3f2258be4e39aefadbf6b4bc7424550bea6cd991f",
      "has_thumbnail": false,
      "message_id": "c5940f4c-d2fc-47a4-902e-2f8f0cb6b1d3",
      "conversation_id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
      "message_seq": 1042,
      "message_created_at": "2026-11-18T14:02:11.123456+00:00"
    }
  ]
}
```

Cada item de `files` traz o contexto (conversa, mensagem e `seq`) para o
resultado abrir a conversa na posição da mensagem; só anexos **vinculados** a
mensagem são devolvidos.

---

## 4. Mensagens e arquivos

### 4.1 `POST /messages`

Envia mensagem (texto + anexos já enviados via `POST /files`). **Idempotente por
`(conversation_id, client_id)`** — o cliente gera o `client_id` antes do envio
otimista e o reutiliza em retries.

**Request**

```json
POST /messages
{
  "conversation_id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
  "client_id": "abc-123",
  "body": "Segue o desvio 045 em anexo.",
  "attachment_ids": ["82b9ee0f-bad0-4c03-96de-178b27b0b843"]
}
```

**Response 201**

```json
{
  "id": "c5940f4c-d2fc-47a4-902e-2f8f0cb6b1d3",
  "seq": 1,
  "conversation_id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
  "sender_id": "4724460c-3d79-4b4d-98e8-149c38b9364e",
  "client_id": "abc-123",
  "body": "Segue o desvio 045 em anexo.",
  "created_at": "2026-11-18T14:02:11.123456+00:00",
  "edited_at": null,
  "deleted_at": null
}
```

**Erros:** `403` (não é membro / conversa arquivada) · `404` · `422`
(mensagem vazia, `> MESSAGE_MAX_CHARS` caracteres, `> MAX_ATTACHMENTS_PER_MESSAGE`
anexos, anexo de outro usuário, anexo já vinculado) · `429` (rate limit).

O `seq` da resposta é a ordem canônica; o cliente reconcilia a mensagem otimista
pelo `client_id`.

### 4.2 `PATCH /messages/{message_id}`

Edita o corpo. **Apenas o autor** (mensagem de outro usuário responde `404` — não
vaza existência). O corpo original fica preservado no `metadata` da auditoria
(`message.edit`). A janela de edição de 15 min é opcional no plano (§6) e hoje
não está aplicada — o autor pode editar a qualquer momento.

**Request**

```json
{ "body": "Segue o desvio 045 em anexo (rev. 2)." }
```

**Response 200** — `MessageOut` com `edited_at` preenchido.

**Erros:** `404` · `422` (vazia/longa demais; mensagem removida não pode ser editada).

### 4.3 `DELETE /messages/{message_id}`

**Soft delete** — apenas o autor. O corpo é substituído por `Mensagem removida`,
`deleted_at`/`deleted_by` preenchidos; o original fica na auditoria
(`message.delete`). Não existe `DELETE` físico.

**Response:** `204 No Content`

**Erros:** `404` (inexistente, já removida ou de outro autor).

### 4.4 `POST /files` (multipart)

Upload em streaming. Devolve um **anexo órfão** (`message_id = null`) que vive
`ORPHAN_ATTACHMENT_TTL_HOURS` (24 h) até ser vinculado por `POST /messages`;
um worker remove órfãos vencidos (bloco + registro).

**Request**

```http
POST /files
Content-Type: multipart/form-data; boundary=...

--...
Content-Disposition: form-data; name="file"; filename="desvio-045.pdf"
Content-Type: application/pdf

<bytes>
--...--
```

**Response 201**

```json
{
  "id": "82b9ee0f-bad0-4c03-96de-178b27b0b843",
  "message_id": null,
  "filename": "desvio-045.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 2200000,
  "sha256": "4ccc5de8e6ca8d8258e12fb3f2258be4e39aefadbf6b4bc7424550bea6cd991f",
  "has_thumbnail": false
}
```

**Regras no servidor:**

- Limite: `MAX_UPLOAD_MB` (100 MB). Exceder → `422` com mensagem do limite.
- Extensões bloqueadas: `.exe .bat .cmd .ps1 .scr .msi .com .vbs .js .jar .dll .reg .hta`.
- **MIME real por magic bytes** (libmagic) — executável disfarçado é rejeitado
  mesmo com extensão limpa.
- **Deduplicação por SHA-256:** o mesmo conteúdo reaproveita o blob existente
  (retorna o anexo original).
- Nome de arquivo original **nunca** vira caminho em disco (blob em
  `files/AAAA/MM/<uuid>`; prévia em `thumbs/AAAA/MM/<uuid>.jpg`).
- Imagens ganham **thumbnail 480 px** (`has_thumbnail: true`), usada pelo
  `GET /files/{id}/thumbnail`.
- Ao finalizar o processamento o uploader recebe `attachment.ready` no WS.

**Erros:** `422` (tipo/limite) · `429` (rate limit 20/min).

### 4.5 `GET /files/{attachment_id}`

Download do arquivo original. Autorização por participação na conversa da
mensagem vinculada (anexo órfão não é baixável — `404`). Auditado como
`file.download` (nome, sha256, conversa, IP).

**Response 200**

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="desvio-045.pdf"

<bytes>
```

### 4.6 `GET /files/{attachment_id}/thumbnail`

Prévia de imagem (JPEG, borda maior 480 px) para renderizar na conversa sem
baixar o arquivo inteiro. Mesma autorização por membro; não gera auditoria de
download (é renderização inline). Sem prévia disponível → `404`.

**Response 200**

```http
Content-Type: image/jpeg

<bytes>
```

### 4.7 `GET /messages/{message_id}/attachments`

Lista os anexos de uma mensagem (para o painel "Arquivos compartilhados" da
conversa). Membros apenas.

**Response 200** — lista de `AttachmentOut` (formato do §4.4, com `message_id`
preenchido e `has_thumbnail`).

---

## 5. Administração (requer papel `admin`)

Todas as rotas abaixo exigem `Authorization: Bearer` de um usuário com
`role = "admin"`; caso contrário `403`. Ações auditadas (§6.6).

### 5.1 Usuários

**`GET /admin/users?include_inactive=true`** — lista usuários (default: só
ativos). Response: lista de `UserOut` (§2.1, sem `presence`).

**`POST /admin/users`**

```json
{
  "username": "bruno.lima",
  "display_name": "Bruno Lima",
  "password": "senha-inicial-forte",
  "role": "member",
  "sector_id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1"
}
```

**Response 201** — `UserOut`. O usuário entra automaticamente no canal do setor.
**Erros:** `409` `user_already_exists` · `404` (setor inexistente).

**`PATCH /admin/users/{user_id}`** — altera papel, setor (com `clear_sector:
true` para remover), ativa/desativa.

```json
{ "role": "admin", "sector_id": "33271776-...", "clear_sector": false, "is_active": true }
```

Desativar revoga as sessões do usuário e fecha seus sockets WS (close `4403`).
**Response 200** — `UserOut` atualizado. Auditado como `user.update`.

**`POST /admin/users/{user_id}/password`** — reset de senha pelo admin (revoga
as sessões do usuário). Auditado como `user.password_reset`.

```json
{ "new_password": "nova-senha-forte" }
```

**Response 200** — `UserOut`.

### 5.2 Setores

**`GET /admin/sectors`** — lista `SectorOut` (§3.2).

**`POST /admin/sectors`**

```json
{ "name": "Produção", "description": "Linhas de envase" }
```

**Response 201** — `SectorOut` (slug gerado do nome). **Erros:** `409`
`sector_already_exists`.

**`PATCH /admin/sectors/{sector_id}`** — renomeia/descreve (body com `name`
obrigatório e `description` opcional). Auditado como `sector.update`.

### 5.3 Canais

**`GET /admin/channels?sector_id=&include_archived=true`** — lista canais com
setor, contagem de membros e situação de arquivo (formato `ChannelOut`).

**Response 200**

```json
[
  {
    "id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
    "name": "Qualidade",
    "sector_id": "33271776-eb46-4fa2-9b9b-d3adba2f08a1",
    "sector_name": "Qualidade e Assuntos Regulatórios",
    "member_count": 12,
    "archived_at": null
  }
]
```

**`PATCH /admin/channels/{channel_id}`** — renomeia e arquiva/desarquiva,
auditado como `channel.update`.

```json
{ "name": "Qualidade (arquivo 2025)", "archived": true }
```

**Response 200** — `ChannelOut` com `archived_at` preenchido. Canal arquivado
vira somente leitura para os membros.

### 5.4 Auditoria

**`GET /admin/audit?limit=100&offset=0&action=&actor_id=`** — log append-only,
mais recente primeiro (`limit` 1–500). Filtros por `action` exata e `actor_id`.

**Response 200**

```json
[
  {
    "id": 10,
    "actor_id": "39b25253-7779-4545-b794-dcd8adcf9802",
    "action": "message.send",
    "entity_type": "message",
    "entity_id": "c5940f4c-d2fc-47a4-902e-2f8f0cb6b1d3",
    "metadata": { "conversation_id": "e1b22e99-...", "client_id": "abc-123" },
    "ip": "192.168.0.21",
    "created_at": "2026-11-18T14:02:11.123456+00:00"
  }
]
```

**Ações registradas:** `auth.login` · `auth.refresh` · `auth.logout` ·
`user.create` · `user.bootstrap` (CLI create-admin) · `user.update` ·
`user.password_reset` · `sector.create` · `sector.update` · `channel.update` ·
`message.send` · `message.edit` · `message.delete` · `message.nudge` ·
`message.purge` · `file.purge` (retenção, ator `system`) · `file.download`.

`audit_log` é INSERT/SELECT apenas — nem o admin altera ou apaga registros pelo
API (nem existe rota para isso).

### 5.5 Estatísticas (inclui disco)

**`GET /admin/stats`**

```json
{
  "users": 3,
  "sectors": 1,
  "conversations": 1,
  "messages": 1,
  "attachments": 1,
  "storage_bytes": 81,
  "storage_files": 1,
  "disk_free_bytes": 512000000000,
  "disk_total_bytes": 1000204886016
}
```

`storage_*` soma o `STORAGE_DIR`; `disk_*` vem do volume onde ele vive — base
para o painel "uso de disco" do admin (plano §2.10).

---

## 6. Health

- **`GET /health`** → `200 {"status": "ok", "version": "0.1.0"}` (sem banco).
- **`GET /health/db`** → `200` se `SELECT 1` funciona; `503` se o banco caiu.

O cliente web não tem campo **Servidor**: ele é servido pelo mesmo host da API,
então o login já fala com a origem correta. `/health` é usado para diagnóstico e
monitoramento (e para o app exibir a versão do servidor).

---

## 7. WebSocket

### 7.1 Handshake

1. `POST /ws/ticket` (Bearer) → `{"ticket": "...", "expires_in": 30}`.
2. Abrir `GET /ws?ticket=<ticket>` — **um único uso**, consumido no handshake.
   Ticket ausente/expirado/reutilizado → close **`4401`**.
3. O servidor responde `hello` e emite `presence.changed` do usuário para todos.

### 7.2 Envelope único

```json
{ "type": "message.created", "seq": 1042, "ts": "2026-11-18T14:02:11Z", "payload": { } }
```

- `type` — nome do evento (§7.4);
- `seq` — quando relacionado a mensagem, o `seq` canônico; `0` caso contrário;
- `ts` — timestamp UTC do servidor;
- `payload` — dados do evento.

### 7.3 Keepalive

- Servidor manda **`ping`** a cada 25 s quando não há tráfego; cliente responde
  (qualquer mensagem do cliente renova o heartbeat, inclusive `ping` próprio).
- **60 s sem atividade → close `4408`.**
- Cliente: heartbeat a cada 30 s (plano-frontend §8.3); queda de socket →
  `offline` em 60 s.
- Reconexão com backoff 1-2-4-8-15 s; **sempre com ticket novo**.

### 7.4 Eventos

| Evento | Direção | Payload |
|---|---|---|
| `hello` | S→C | `{"version", "user": {"id","username","display_name"}, "subscriptions": ["<conversation_id>"], "presence": {"<user_id>": "available"}, "status_messages": {"<user_id>": "Em auditoria até 14h"}, "status_message_expires_in": {"<user_id>": 28800.0}}` — snapshot inicial; substitui o estado de presença do cliente |
| `message.created` | S→C | mensagem completa (`MessageOut`) + `"attachment_ids": ["<uuid>"]`; membros da conversa |
| `message.updated` | S→C | mensagem completa com `edited_at` |
| `message.deleted` | S→C | `{"conversation_id", "message_id"}` — corpo substituído por "Mensagem removida" |
| `attachment.ready` | S→C | `{"attachment_id", "has_thumbnail"}` — upload processado (blob + prévia); uploader |
| `typing` | C→S→C | envio: `{"conversation_id", "is_typing"}`; difusão: `{"conversation_id", "user_id", "is_typing"}` — apenas membros da conversa |
| `presence.set` | C→S | `{"status": "available\|busy\|away\|dnd\|invisible", "status_message": "..."}`; o servidor valida e reemite `presence.changed` |
| `presence.changed` | S→C | `{"user_id", "status"}` + `status_message` quando há recado ativo (ver semântica abaixo) — invisível é divulgado como `offline` |
| `read.updated` | S↔C | `{"conversation_id", "user_id", "last_read_seq"}` — membros da conversa |
| `nudge` | C→S→C | envio: `{"conversation_id"}`; entrega: `{"conversation_id", "sender_id", "sender_name"}` aos membros elegíveis |
| `nudge.refused` | S→C | `{"conversation_id", "reason": "throttled\|unavailable\|dnd"}` — 1 nudge/5 min por conversa; membros em `dnd`/offline não recebem |
| `ping` / `pong` | S↔C | `{}` vazio; keepalive 25 s |
| `error` | S→C | `{"code": "invalid_status\|status_message_too_long", "message"}` — erro de mensagem WS (não derruba a conexão) |

**Semântica do recado de status (`status_message`):** o campo nunca é `null` —
ele é **presente** no payload apenas quando há recado ativo e **ausente**
quando não há. No `presence.set` (C→S): omitido = mantém o recado atual;
**string vazia** = limpa o recado; > 120 chars = evento `error`
(`status_message_too_long`). O recado expira em 8 h no servidor; quando ativo,
`presence.changed` e `hello` também trazem `status_message_expires_in`
(segundos restantes, para o cliente agendar a expiração local).

### 7.5 Exemplos

**Cliente seta status com recado:**

```json
{ "type": "presence.set", "status": "busy", "status_message": "Em auditoria até 14h" }
```

**Servidor difunde:**

```json
{
  "type": "presence.changed",
  "seq": 0,
  "ts": "2026-11-18T14:03:01.000000+00:00",
  "payload": {
    "user_id": "4724460c-3d79-4b4d-98e8-149c38b9364e",
    "status": "busy",
    "status_message": "Em auditoria até 14h",
    "status_message_expires_in": 28799.4
  }
}
```

(Sem recado ativo, o payload traz apenas `user_id` e `status`.)

**Mensagem nova (S→C):**

```json
{
  "type": "message.created",
  "seq": 2,
  "ts": "2026-11-18T14:05:12.000000+00:00",
  "payload": {
    "id": "7d2c9e31-...",
    "seq": 2,
    "conversation_id": "e1b22e99-047f-457d-9c86-e5565d7dd68d",
    "sender_id": "d0926f3a-2058-48ee-8f08-d3306f1a6795",
    "client_id": "def-456",
    "body": "Recebido. Vou conferir com o QA.",
    "created_at": "2026-11-18T14:05:12.000000+00:00",
    "edited_at": null,
    "deleted_at": null,
    "attachment_ids": []
  }
}
```

### 7.6 Catch-up após queda

WebSocket **não garante entrega** de mensagens emitidas durante a desconexão.
Ao reconectar:

1. `POST /auth/refresh` se necessário; `GET /conversations` (contadores).
2. Para cada conversa ativa: `GET /conversations/{id}/messages?after_seq=<último seq visto>`.
3. Abrir WS com ticket novo; `hello` substitui o snapshot de presença.

O cliente detecta lacuna se recebe `message.created` com `seq` > esperado →
refetch por `after_seq`.

### 7.7 Códigos de fechamento

| Código | Motivo |
|---|---|
| `1000` | fechamento normal |
| `4401` | ticket ausente, expirado, inválido ou já usado (pegue ticket novo) |
| `4403` | usuário desativado pelo admin |
| `4408` | idle > 60 s sem heartbeat |

---

## 8. Cobertura do plano (estado final, 2026-11-18)

Itens previstos no plano-mvp §6 e **confirmados implementados** no código: ticket
WS de uso único, envelope WS, eventos `read.updated` / `attachment.ready` /
`nudge` (+ `nudge.refused`), typing restrito aos membros, keepalive 25 s/idle
60 s, recado de status (120 chars / 8 h com expiração divulgada), thumbnail
480 px, MIME por magic bytes, dedupe SHA-256, bloqueio progressivo de login,
rate limits, **envelope de erro universal** (inclusive guardas 401/403 e
validação 422), `GET /search` com `conversation_id` + ranking `ts_rank_cd` +
busca de arquivo por `pg_trgm`, `GET /conversations/{id}/members`,
`archived_at`/`last_read_seq` no resumo de conversas, auditoria com corpo
original preservado (+ `message.purge`/`file.purge` da retenção, ator `system`),
`/admin/stats` com disco, `GET /sectors` público e `GET/PATCH /admin/channels`
(gerência de canais).

Nota de comportamento: a **janela de edição de 15 min** é opcional no plano
(§6) e não está aplicada — o autor pode editar a própria mensagem a qualquer
momento (sempre autor-only, com o corpo original preservado na auditoria).
