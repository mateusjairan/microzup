# Microzup — Chat corporativo farmacêutico

> Plano técnico do MVP — v1.3
> Escopo: mensagens e arquivos entre membros de equipe e setores, dentro da rede local (LAN) da empresa.
>
> **Revisão v1.3 (2026-11-24):** o cliente desktop Electron foi descartado. O front-end é
> uma SPA React servida pelo próprio FastAPI, acessada pelo navegador na LAN. O refresh
> token passou a viver em cookie `HttpOnly` + `SameSite=Strict` — decidido abaixo, em
> "Por que cliente web". As seções de stack, estrutura, segurança, deploy e roadmap já
> refletem o modelo web; referências ao Electron aparecem apenas como histórico.

---

## 1. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Cliente | SPA React (navegador) servida pelo backend, com painel de administração na própria SPA |
| Backend | Python 3.13 + FastAPI |
| Banco de dados | **PostgreSQL 17** |
| Autenticação | Contas locais (usuário + senha), criadas por admin |
| Organização | Canais por setor + mensagens diretas (DM 1:1) |
| Rede | Servidor único na LAN; clientes conectam via HTTP/WebSocket |
| Arquitetura | **Camadas (Clean/Hexagonal simplificada) + Repository + Service Layer + DI** |

### Por que cliente web (e não Electron/Tauri)

- **Um artefato só:** o `web/dist` é servido pelo mesmo processo FastAPI que expõe a API. Não há instalação, assinatura, auto-update nem prerequisito de Node nas estações — a TI só precisa liberar a porta 8666 na LAN.
- **Mesma origem:** sem CORS, sem configuração de servidor no primeiro acesso, sem `file://`. O usuário abre `http://<servidor>:8666`.
- **Auth mais segura:** access token em memória + refresh em cookie `HttpOnly`/`SameSite=Strict`. O JavaScript nunca vê o refresh token, então não depende de `safeStorage`/DPAPI.
- **Custo aceito:** sem bandeja nativa, sem janela frameless e sem "abrir arquivo" automático; notificações viram a Notification API, o badge vira `document.title`/`navigator.setAppBadge` e downloads passam pelo gerenciador do navegador.
- **Histórico:** Electron + React chegou a ser implementado e foi descartado em 2026-11-24; o renderer React foi integralmente reaproveitado, o shell (`electron/`) foi removido.

### Por que PostgreSQL

- Concorrência real de escrita (vários setores enviando ao mesmo tempo) sem o gargalo de um único writer.
- Full-text search nativo em português (`tsvector` + GIN) substitui o FTS5 do SQLite com muito mais qualidade.
- `jsonb` para metadados de auditoria, `citext` para usuários, `timestamptz` como cidadão de primeira classe.
- Caminho natural para réplica, PITR e ferramentas de backup maduras (`pg_dump`/`pg_restore`, WAL archiving).

---

## 2. Escopo do MVP

### Dentro

1. **Login** com usuário/senha (Argon2id), sessão persistente por dispositivo e logout.
2. **Setores** cadastrados pelo admin; cada usuário pertence a um setor.
3. **Canais de setor**: histórico compartilhado, todos os membros do setor participam.
4. **DMs 1:1** entre quaisquer usuários ativos.
5. **Mensagens de texto** em tempo real, com:
   - envio otimista e confirmação do servidor;
   - edição e exclusão **lógica** (soft delete, autoria preservada);
   - histórico paginado por cursor (`seq`);
   - contagem de não lidas por conversa.
6. **Arquivos** anexados a mensagens:
   - upload com progresso, limite configurável (padrão 100 MB);
   - download autorizado por conversa;
   - deduplicação por SHA-256;
   - extensões bloqueadas (`.exe`, `.bat`, `.cmd`, `.ps1`, `.scr`, `.msi`, `.js`).
7. **Presença** (online/offline/ausente) e indicador "digitando…".
8. **Notificações** do navegador + badge de não lidas no título da aba.
9. **Busca** full-text em mensagens, restrita às conversas do usuário.
10. **Painel admin mínimo**: usuários, setores, canais, uso de disco, log de auditoria.
11. **Auditoria append-only** de ações sensíveis (login, criação/edição/exclusão, download de arquivo, mudança de cadastro).
12. **Entrega**: build do SPA (`web/dist`) servido pelo backend + script de instalação do servidor como serviço do Windows.

### Fora (explicitamente)

- Chamadas de voz/vídeo, salas, transmissão de tela.
- Threads, reações, menções `@`, enquetes.
- App mobile nativo (há acesso web responsivo; app nativo é fase 2).
- Federação entre unidades / múltiplos servidores.
- Criptografia ponta a ponta — **incompatível com auditoria regulatória**; usar TLS na fase 2.
- Integrações (e-mail, ERP, eQMS), bots, webhooks.
- Conformidade formal 21 CFR Part 11 / ALCOA+ / RDC 301 — o MVP **prepara** o terreno (autoria, soft delete, auditoria, UTC), mas validação formal é fase 3.

---

## 3. Arquitetura em camadas

```
┌──────────────────────────── Presentation ─────────────────────────────┐
│  FastAPI routers (api/)          WebSocket hub (ws/)                  │
│  valida DTO · traduz erro · chama caso de uso · NÃO contém regra       │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ depende de
┌───────────────────────────────────▼───────────────────────────────────┐
│  Application — casos de uso (use_cases/)                              │
│  orquestra domínio + repositórios · abre transação · publica eventos   │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ depende de
┌───────────────────────────────────▼───────────────────────────────────┐
│  Domain — entidades, value objects, políticas, portas (Protocols)      │
│  regra de negócio pura · zero import de FastAPI/SQLAlchemy/Postgres    │
└───────────────────────────────────▲───────────────────────────────────┘
                                    │ implementa as portas
┌───────────────────────────────────┴───────────────────────────────────┐
│  Infrastructure — adapters                                            │
│  SQLAlchemy/Postgres · disco local · Argon2 · JWT · busca full-text    │
└───────────────────────────────────────────────────────────────────────┘

Regra de dependência: sempre para dentro. Domain não conhece ninguém.
Infrastructure depende de Domain; Presentation depende de Application.
```

### Por que servidor central e não P2P na LAN

Histórico único, auditoria confiável, autorização por conversa e arquivos deduplicados. P2P não entrega nenhum desses requisitos e explode a complexidade de permissão.

### Stack

**Servidor**
- FastAPI + Uvicorn (HTTP + WebSocket no mesmo processo)
- SQLAlchemy 2.0 **async** (`async_sessionmaker`) + `psycopg 3` async
- PostgreSQL 17 + extensões `pgcrypto`, `unaccent`, `pg_trgm`
- Alembic (migrações versionadas desde o dia 1)
- Pydantic v2 + pydantic-settings (`.env`)
- `argon2-cffi` (senhas) + `PyJWT` (access/refresh)
- `python-multipart` (uploads em streaming) + `python-magic` (MIME real)
- `pytest` + `httpx` (API), `pytest-asyncio` (WS), banco de teste dedicado
- `structlog` (logs JSON), `ruff` + `mypy` (qualidade)
- Empacotamento: PyInstaller → `microzup-server.exe`, instalado como serviço Windows via NSSM

**Cliente (web)**
- React 19 + TypeScript + Vite, build estático servido pelo FastAPI em `/`
- Tailwind CSS + Radix (componentes acessíveis, sem dependência de CDN)
- Zustand (estado) + `fetch` tipado a partir do OpenAPI (`openapi-typescript`)
- Sem shell nativo: notificações via `Notification`, badge via `document.title`/`navigator.setAppBadge`, download via Blob
- Auth: access token em memória; refresh token em cookie `HttpOnly` + `SameSite=Strict` (path `/auth`)

**Infra de desenvolvimento**
- `docker-compose.yml` com `postgres:17` (+ volume nomeado) e `adminer` opcional
- `dev.ps1`: sobe o banco, roda `alembic upgrade head`, inicia Uvicorn em `--reload` e o Vite

> **Rede isolada:** nenhuma dependência de CDN, fonte ou analytics em runtime. Build e dependências são gerados numa máquina com internet; a instalação final roda offline.

### Estrutura do repositório

```
microzup/
├─ docs/
│  ├─ plano-mvp.md
│  ├─ plano-frontend.md      # UI "MSN moderno", tokens, telas, componentes
│  ├─ api.md                 # contrato resumido + exemplos
│  └─ operacao.md            # instalação, backup, restore, troubleshooting
├─ server/
│  ├─ pyproject.toml
│  ├─ .env.example         # inventário de variáveis (sem segredos)
│  ├─ alembic/
│  ├─ app/
│  │  ├─ main.py             # app factory, lifespan, CORS restrito
│  │  ├─ config.py           # settings via env (pydantic-settings)
│  │  ├─ domain/
│  │  │  ├─ entities/        # User, Sector, Conversation, Message, Attachment
│  │  │  ├─ value_objects/   # MessageBody, FileName, FileSize, Sha256
│  │  │  ├─ policies/        # ConversationAccessPolicy, RetentionPolicy
│  │  │  ├─ ports/           # Protocols: repositórios, storage, hasher, event bus
│  │  │  └─ exceptions.py    # hierarquia de erros de domínio
│  │  ├─ application/
│  │  │  ├─ use_cases/       # Login, SendMessage, UploadFile, CreateSector...
│  │  │  ├─ dto.py           # comandos/resultados (dataclasses)
│  │  │  └─ events.py        # MessageCreated, UserDeactivated...
│  │  ├─ infrastructure/
│  │  │  ├─ db/
│  │  │  │  ├─ session.py    # engine, async_sessionmaker, UnitOfWork
│  │  │  │  ├─ models.py     # ORM (SQLAlchemy declarative)
│  │  │  │  ├─ mappers.py    # ORM <-> entidade de domínio
│  │  │  │  └─ repositories/ # UserRepo, ConversationRepo, MessageRepo...
│  │  │  ├─ storage/         # LocalDiskStorage (implementa FileStorage)
│  │  │  ├─ security/        # Argon2Hasher, JwtTokens
│  │  │  └─ search/          # PostgresFullTextSearch
│  │  ├─ presentation/
│  │  │  ├─ api/             # routers por recurso
│  │  │  ├─ ws/              # hub, conexões, roteamento de eventos
│  │  │  └─ deps.py          # composição do grafo de dependências
│  │  └─ core/               # erros HTTP, paginação, logging
│  ├─ tests/
│  │  ├─ unit/               # domínio + casos de uso com fakes (sem banco)
│  │  ├─ integration/        # repositórios contra Postgres real
│  │  └─ e2e/                # API + WebSocket
│  ├─ scripts/               # criar admin, seed, backup
│  └─ docker-compose.yml
├─ web/
│  ├─ package.json
│  ├─ src/                   # React (pages, components, lib, hooks)
│  ├─ public/                # ícones estáticos
│  ├─ e2e/                   # Playwright contra o build servido pelo backend
│  └─ dist/                  # build do SPA (não versionado)
├─ scripts/
│  ├─ install-server.ps1
│  ├─ backup.ps1
│  └─ dev.ps1
└─ README.md
```

---

## 4. Programação orientada a objetos e padrões de projeto

O sistema usa OOP de forma **pragmática**: classes onde há estado + comportamento ou ponto de substituição; funções puras onde OOP só adicionaria cerimônia. Não há hierarquias profundas, `BaseModel` mágico genérico nem ActiveRecord vazando para a API.

### 4.1 Onde cada tipo de classe aparece

| Conceito | Classe | Camada | Responsabilidade |
|---|---|---|---|
| Conta de usuário | `User` (`@dataclass(frozen=True, slots=True)`) | Domain | identidade, papel, setor, ativação |
| Conversa | `Conversation` + `Channel`/`DirectMessage` | Domain | participantes, tipo, ciclo de vida |
| Mensagem | `Message` | Domain | corpo, autoria, edição/exclusão |
| Validação de entrada | `MessageBody`, `FileName`, `Sha256` | Domain (VO) | invariantes no construtor |
| Autorização | `ConversationAccessPolicy` | Domain | `can_read`, `can_write`, `can_manage` |
| Caso de uso | `SendMessage`, `UploadFile`, `Login` | Application | orquestra uma operação inteira |
| Persistência | `SqlAlchemyMessageRepository` | Infrastructure | implementa `MessageRepository` (Protocol) |
| Armazenamento | `LocalDiskStorage` | Infrastructure | implementa `FileStorage` (Protocol) |
| Hash de senha | `Argon2PasswordHasher` | Infrastructure | implementa `PasswordHasher` |
| Tempo real | `WebSocketHub` | Presentation | conexões, fan-out, presença |
| Erros | `DomainError` → `NotFoundError`, `AccessDeniedError`, `ConflictError` | Domain | mapeados para HTTP na borda |

### 4.2 Padrões adotados (e por quê)

| Padrão | Onde | Por que |
|---|---|---|
| **Repository** | `domain/ports/repositories.py` + `infrastructure/db/repositories/` | isola SQL; casos de uso testáveis com fakes em memória, sem Postgres |
| **Unit of Work** | `UnitOfWork` embrulhando `AsyncSession` | uma transação por caso de uso; commit só no fim, rollback em erro |
| **Service Layer (Use Case)** | `application/use_cases/*` | cada operação é uma classe com `execute(cmd)`; `SendMessage` não sabe o que é HTTP nem WebSocket |
| **Dependency Injection** | `presentation/deps.py` + `Depends` | grafo explícito e substituível em teste; sem singleton global de sessão |
| **Strategy + Adapter** | `FileStorage` (disco hoje, NAS/S3 depois), `PasswordHasher`, `TokenIssuer` | trocar implementação sem tocar em regra de negócio |
| **Observer / Pub-Sub** | `EventBus` + `MessageCreated` | o caso de uso só publica o evento; o hub WS, a auditoria e o indexador de busca reagem — desacoplamento real |
| **Factory** | `ConversationFactory` | cria DM vs canal de setor aplicando regras de membros e `dm_key` |
| **Policy / Specification** | `ConversationAccessPolicy`, `RetentionPolicy` | condensa `if` de permissão em objeto nomeado e testável |
| **Template Method** | `BaseSqlAlchemyRepository` | paginação, `get_or_raise` e mapeamento comuns, sem duplicar |
| **Decorator** | `@audit("message.delete")`, `@rate_limited`, `@idempotent` | preocupações transversais aplicadas por composição |
| **DTO + Mapper** | Pydantic na borda, dataclasses no domínio, `mappers.py` | contrato HTTP evolui sem arrastar o ORM |
| **Null Object** | `NullEventBus` nos testes | evita `if bus is not None` espalhado |

Deliberadamente ausentes: **Singleton** (substituído por DI), **ActiveRecord** (o ORM não é a entidade), herança múltipla e "GenericCRUD" mágico.

### 4.3 Exemplo concreto do fluxo

```python
# domain/ports/repositories.py
class MessageRepository(Protocol):
    async def add(self, message: Message) -> None: ...
    async def page(self, conversation_id: UUID, before_seq: int | None, limit: int) -> list[Message]: ...
    async def find_by_client_id(self, conversation_id: UUID, client_id: str) -> Message | None: ...

# application/use_cases/send_message.py
class SendMessage:
    def __init__(
        self,
        messages: MessageRepository,
        conversations: ConversationRepository,
        access: ConversationAccessPolicy,
        events: EventBus,
        uow: UnitOfWork,
        clock: Clock,
    ) -> None: ...

    async def execute(self, cmd: SendMessageCommand) -> Message:
        conversation = await self.conversations.get(cmd.conversation_id)
        actor = await self.conversations.member(cmd.conversation_id, cmd.actor_id)
        self.access.ensure_can_write(actor, conversation)      # regra pura
        if existing := await self.messages.find_by_client_id(conversation.id, cmd.client_id):
            return existing                                     # idempotência
        message = Message.create(conversation, actor, MessageBody(cmd.body), self.clock.now())
        async with self.uow:                                    # uma transação
            await self.messages.add(message)
        await self.events.publish(MessageCreated(message))      # hub WS, auditoria
        return message

# presentation/deps.py — composição explícita
def send_message_uc(session: AsyncSession = Depends(get_session)) -> SendMessage:
    return SendMessage(
        messages=SqlAlchemyMessageRepository(session),
        conversations=SqlAlchemyConversationRepository(session),
        access=ConversationAccessPolicy(),
        events=container.event_bus,
        uow=UnitOfWork(session),
        clock=SystemClock(),
    )
```

O router fica só com transporte:

```python
@router.post("/messages", status_code=201, response_model=MessageOut)
async def send(body: SendMessageIn, uc: SendMessage = Depends(send_message_uc), me: User = Depends(current_user)):
    msg = await uc.execute(body.to_command(actor_id=me.id))
    return MessageOut.from_entity(msg)
```

### 4.4 Regras de estilo OOP do projeto

- Entidades de domínio **imutáveis** (`frozen=True`); mutação devolve nova instância (`message.edit(body, now)`), o que facilita auditoria e testes.
- `__init__` só atribui; validação em `__post_init__` ou classmethod `create`.
- Porta = `typing.Protocol` (structural typing), nunca herança de classe abstrata só para "parecer Java".
- Nada de `session` ou objeto de request dentro de entidade.
- Mapper explícito, sem `from_orm` implícito em regra de negócio.
- Dependências sempre recebidas no construtor — nada de import de módulo global para colaboradores.

---

## 5. Modelo de dados (PostgreSQL)

Timestamps em `timestamptz` (UTC na aplicação), PK `uuid` (`gen_random_uuid()`), `seq` monotonamente crescente para paginação e catch-up.

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE sectors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  slug         text NOT NULL UNIQUE,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','member')),
  sector_id     uuid REFERENCES sectors(id),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL,
  device_name        text,
  ip                 inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);

CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('channel','dm')),
  name        text,
  sector_id   uuid REFERENCES sectors(id),
  dm_key      text UNIQUE,               -- 'menor_uuid:maior_uuid' p/ DMs
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK ((kind = 'channel' AND sector_id IS NOT NULL) OR (kind = 'dm' AND dm_key IS NOT NULL))
);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender_id       uuid NOT NULL REFERENCES users(id),
  client_id       text NOT NULL,          -- idempotência do cliente
  body            text NOT NULL,
  reply_to_id     uuid REFERENCES messages(id),
  search_vector   tsvector GENERATED ALWAYS AS
                    (to_tsvector('portuguese', coalesce(body,''))) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES users(id),
  UNIQUE (conversation_id, client_id)
);
CREATE INDEX messages_conv_seq_idx ON messages (conversation_id, seq DESC);
CREATE INDEX messages_search_idx   ON messages USING gin (search_vector);

CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid REFERENCES messages(id),      -- NULL enquanto órfão
  uploader_id  uuid NOT NULL REFERENCES users(id),
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  sha256       text NOT NULL UNIQUE,
  storage_path text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_orphan_idx ON attachments (created_at) WHERE message_id IS NULL;
CREATE INDEX attachments_filename_trgm_idx
  ON attachments USING gin (filename gin_trgm_ops);

CREATE TABLE message_reads (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  last_read_seq   bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_actor_time_idx ON audit_log (actor_id, created_at DESC);

-- Papéis: migrations rodam como owner; a aplicação roda como app.
-- Sem papéis distintos, REVOKE é inócuo: o dono da tabela ignora as próprias revogações.
CREATE ROLE microzup_owner LOGIN PASSWORD :'owner_password';  -- DDL
CREATE ROLE microzup_app   LOGIN PASSWORD :'app_password';    -- runtime

GRANT USAGE ON SCHEMA public TO microzup_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO microzup_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO microzup_app;
REVOKE UPDATE, DELETE ON audit_log FROM microzup_app;

-- Tabelas criadas por migrations futuras herdam os mesmos grants
ALTER DEFAULT PRIVILEGES FOR ROLE microzup_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO microzup_app;
ALTER DEFAULT PRIVILEGES FOR ROLE microzup_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO microzup_app;
```

**Regras e decisões**
- `messages.seq` é a **ordem canônica**: paginação (`before_seq`) e catch-up (`after_seq`) usam `seq`, nunca `created_at` (empates e clock skew).
- Não-lidas: `SELECT count(*) FROM messages m JOIN message_reads r ... WHERE m.seq > r.last_read_seq` — com o índice composto é barato nos volumes do MVP (contador materializado só se medir necessidade).
- Canal de setor já nasce com `conversation_members` materializado quando o usuário é criado/movido de setor.
- Exclusão de mensagem = `deleted_at` + corpo substituído por "mensagem removida"; original preservado no `audit_log`.
- Sem `DELETE` físico em `users`; desativar via `is_active`.
- Busca: `websearch_to_tsquery('portuguese', :q)` + `ts_rank_cd`, filtrada por conversas do usuário; `pg_trgm` cobre busca por nome de arquivo.
- `citext` evita "Joao" ≠ "joao" no login.
- **Dois papéis de banco:** `microzup_owner` (DDL/Alembic) e `microzup_app` (runtime, sem `UPDATE`/`DELETE` em `audit_log`). A aplicação nunca conecta como owner.

---

## 6. API (resumo)

### Auth
| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | `{username, password, device_name, remember}` → access (15 min) no corpo + refresh (30 d) em cookie `HttpOnly` |
| POST | `/auth/refresh` | sem corpo: lê o cookie, rotaciona o refresh e devolve só o novo access |
| POST | `/auth/logout` | sem corpo: revoga a sessão do cookie e o apaga |
| POST | `/ws/ticket` | emite ticket opaco de uso único (30 s) para abrir o WebSocket |
| GET | `/me` | perfil + setor + papel |

### Dados
| Método | Rota | Descrição |
|---|---|---|
| GET | `/users` | diretório ativo (id, nome, setor, presença) |
| GET | `/sectors` | lista de setores |
| GET | `/conversations` | canais + DMs do usuário, com `last_message`, `unread_count` e `peer_id` nas DMs |
| POST | `/conversations/dm` | `{user_id}` → abre/reaproveita DM e devolve `peer_id` |
| GET | `/conversations/{id}/messages` | `?before_seq=&after_seq=&limit=50` |
| POST | `/conversations/{id}/read` | `{last_read_seq}` → marca lido |
| GET | `/search` | `?q=&conversation_id=` (full-text) |

### Mensagens e arquivos
| Método | Rota | Descrição |
|---|---|---|
| POST | `/messages` | `{conversation_id, client_id, body, attachment_ids[]}` |
| PATCH | `/messages/{id}` | edita corpo (autor, janela de 15 min opcional) |
| DELETE | `/messages/{id}` | soft delete |
| POST | `/files` | multipart; retorna `attachment_id` (órfão com TTL de 24 h) |
| GET | `/files/{id}` | download com `Content-Disposition` e checagem de participação |
| GET | `/files/{id}/thumbnail` | prévia de imagem (worker) |

### Admin
`GET /admin/users` (com `include_inactive`), `POST/PATCH /admin/users`, `POST /admin/users/{id}/password`, `GET/POST/PATCH /admin/sectors`, `GET /admin/audit` (com filtros por ação/ator), `GET /admin/stats`.

### WebSocket `GET /ws?ticket=<ticket>`

O cliente chama `POST /ws/ticket` (com `Authorization: Bearer`), recebe `{ "ticket": "...", "expires_in": 30 }` e usa o ticket **uma única vez** na URL do WS. O JWT nunca aparece na query string — ele vazaria em log de acesso, proxy ou histórico. O ticket é opaco, expira em 30 s, é vinculado ao usuário e consumido no handshake (reconexão exige ticket novo).

Envelope único, para evoluir sem quebrar clientes antigos:

```json
{ "type": "message.created", "seq": 1042, "ts": "2026-11-17T14:02:11Z", "payload": { } }
```

| Evento | Direção | Payload |
|---|---|---|
| `hello` | S→C | versão do servidor, usuário, inscrições e snapshot de presença |
| `message.created` | S→C | mensagem completa + `seq` |
| `message.updated` / `message.deleted` | S→C | id + patch |
| `attachment.ready` | S→C | id, thumbnail disponível |
| `typing` | C→S→C | `{conversation_id, is_typing}` |
| `presence.changed` | S→C | `{user_id, status}` (`available`, `busy`, `away`, `dnd`, `invisible` → `offline`, `offline`) |
| `presence.set` | C→S→C | `{status}`; o servidor valida e reemite `presence.changed` |
| `read.updated` | S↔C | `{conversation_id, user_id, last_read_seq}` |
| `ping` / `pong` | S↔C | keepalive 25 s |

Robustez: reconexão com backoff exponencial + **catch-up por cursor** (`after_seq`), pois WebSocket não garante entrega após queda.

---

## 7. Fluxos críticos

**Envio de mensagem**
1. Cliente valida tamanho/corpo, gera `client_id` (idempotência) e renderiza otimista.
2. `POST /messages` → `SendMessage` valida política, grava em uma transação, audita e publica `MessageCreated`.
3. `EventBus` entrega ao hub WS (membros online) e ao auditor; o autor reconcilia pelo `client_id` — retry nunca duplica.

**Upload de arquivo**
1. `POST /files` em streaming para `data/tmp/`, calculando SHA-256 no caminho.
2. `UploadFile` valida tamanho/extensão; se o SHA já existe, reutiliza o blob e descarta o temporário.
3. Move para `data/files/AAAA/MM/<uuid>` (nome original só em metadados, nunca no caminho — evita path traversal).
4. Retorna `attachment_id`; o envio da mensagem vincula os órfãos. Worker remove órfãos após 24 h.

**Offline → online**
1. Cliente abre, faz `refresh`, busca `GET /conversations` (contadores) e `?after_seq=` por conversa ativa.
2. Abre o WS; o `hello` traz o snapshot de presença e substitui o estado. Nada de "perder mensagem" por socket caído.
3. `GET /users` mantém o diretório da equipe (quem está online, setor e papel) para iniciar DMs.

---

## 8. Segurança e operação

- Senhas: Argon2id (parâmetros calibráveis), bloqueio progressivo após 5 falhas por IP+usuário.
- Tokens: access JWT curto (15 min) + refresh opaco (hash no banco, rotativo); `Authorization: Bearer`.
- Autorização **sempre** revalidada no servidor por conversa — nunca confiar no cliente.
- Uploads: nome sanitizado, MIME sniffing, extensões bloqueadas, sem execução no diretório de dados.
- Mesma origem: o SPA é servido pela API, então `CORS_ORIGINS` fica vazio por padrão. O refresh token é cookie `HttpOnly` + `SameSite=Strict` (path `/auth`); `refresh`/`logout` ainda recusam `Origin` de outro host. Em dev o Vite faz proxy para a API.
- Rate limit básico (login, upload, envio) em memória — suficiente para 1 processo.
- Logs estruturados em JSON, rotação diária, sem corpo de mensagem em log.
- **TLS**: MVP roda HTTP puro na LAN (decisão consciente e documentada). Fase 2: certificado interno + pinning no cliente.
- **Postgres**: dois papéis — `microzup_owner` (migrações/Alembic) e `microzup_app` (runtime, sem `UPDATE`/`DELETE` em `audit_log`); `statement_timeout` e `idle_in_transaction_session_timeout` configurados; pool `size=10, max_overflow=20, pool_pre_ping=True`.
- Backup: `pg_dump -Fc` diário + robocopy incremental de `data/files`; restore testado. PITR (WAL archiving) fica para a fase 2.
- Retenção: `MESSAGE_RETENTION_DAYS` e `FILE_RETENTION_DAYS` desligadas por padrão; `RetentionPolicy` aplica se configurada.

### Bootstrap do primeiro admin

Não existe endpoint HTTP de cadastro público nem auto-registro. O primeiro admin (e qualquer admin adicional) é criado por CLI, na máquina do servidor:

```powershell
cd server
uv run python -m app.cli create-admin --username admin
```

- Senha lida por `getpass` — nunca em argumento, variável de ambiente ou histórico do shell.
- Operação **idempotente**: usuário já existente é recusado com aviso, sem sobrescrever a senha.
- Registra `audit_log` com `actor_id = NULL` e `action = "user.bootstrap"`.
- O servidor emite `WARNING` enquanto não houver nenhum admin ativo.
- `--sector <slug>` é opcional; sem setor, o usuário não vê canais até ser alocado.

### Configuração (`.env`)

Contrato em `server/.env.example`; segredos reais nunca entram no Git.

| Variável | Padrão | Função |
|---|---|---|
| `APP_ENV` | `development` | `development` \| `production` |
| `HOST` / `PORT` | `0.0.0.0` / `8666` | bind do Uvicorn |
| `DATABASE_URL` | — | conexão como `microzup_app` |
| `MIGRATION_DATABASE_URL` | — | conexão como `microzup_owner`, usada só pelo Alembic |
| `STATEMENT_TIMEOUT_MS` | `15000` | `statement_timeout` por conexão no engine |
| `IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS` | `30000` | `idle_in_transaction_session_timeout` por conexão |
| `JWT_SECRET` | — | ≥ 32 bytes aleatórios; ausência impede o boot |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | validade do access token |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | validade do refresh |
| `WS_TICKET_TTL_SECONDS` | `30` | validade do ticket de WebSocket |
| `CORS_ORIGINS` | vazio | origens permitidas, separadas por vírgula; vazio = mesma origem (SPA servida pela API) |
| `WEB_DIST_DIR` | `web/dist` | build do SPA servido em `/`; sem ele o backend loga `web_build_missing` |
| `COOKIE_SECURE` | `false` | marca o cookie de refresh como `Secure` (ligue quando o piloto migrar para TLS) |
| `STORAGE_DIR` | `./data` | raiz de arquivos e temporários |
| `MAX_UPLOAD_MB` | `100` | limite por arquivo |
| `MAX_ATTACHMENTS_PER_MESSAGE` | `5` | limite por mensagem |
| `ORPHAN_ATTACHMENT_TTL_HOURS` | `24` | limpeza de uploads não vinculados |
| `MESSAGE_MAX_CHARS` | `8000` | limite de corpo |
| `MESSAGE_RETENTION_DAYS` | `0` | `0` = desligado |
| `FILE_RETENTION_DAYS` | `0` | `0` = desligado |
| `RETENTION_INTERVAL_SECONDS` | `3600` | intervalo da task de retenção no lifespan (`0` = desliga a task; a CLI `retention-run` segue disponível) |
| `LOGIN_MAX_ATTEMPTS` | `5` | bloqueio progressivo por IP+usuário |
| `LOGIN_LOCKOUT_SECONDS` | `300` | liberação do bloqueio progressivo (dobra a cada ciclo, até 1 h) |
| `RATE_LIMIT_LOGIN_PER_MINUTE` | `10` | rate limit em memória: logins/min |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | `20` | rate limit em memória: uploads/min |
| `RATE_LIMIT_MESSAGE_PER_MINUTE` | `30` | rate limit em memória: mensagens/min |
| `LOG_LEVEL` | `INFO` | nível de log |
| `LOG_DIR` | `./data/logs` | diretório do arquivo de log JSON com rotação diária |
| `LOG_RETENTION_DAYS` | `14` | dias de retenção dos arquivos de log rotacionados |

Regra: variável nova entra em `.env.example`, nesta tabela e em `config.py` na mesma alteração.

**Capacidade alvo do MVP:** 500 usuários cadastrados, pico de 100 conexões WS, 50 mil mensagens/dia, 100 GB de arquivos. Postgres + um processo Uvicorn atende; o gargalo passa a ser disco/rede do servidor. Escala horizontal de WS (múltiplos workers) usa `LISTEN/NOTIFY` ou Redis Pub/Sub na fase 2 — o `EventBus` já é a porta para isso.

---

## 9. Roadmap de execução

| Marco | Entrega | Estimativa |
|---|---|---|
| **M0 — Fundação** ✅ | Repo, `pyproject`, ruff/mypy, `docker-compose` Postgres 17, Alembic baseline, esqueleto em camadas, `dev.ps1`, healthcheck, testes unit/integration/api | 2–3 d |
| **M1 — Identidade** ✅ | `User`/`Session`/`AuditLog`, Argon2id, login/refresh/logout, `create-admin`, autorização admin, testes unit/integration/api | 3–4 d |
| **M2 — Conversas** ✅ | Canais por setor, DMs, `SendMessage` idempotente, paginação por `seq`, `EventBus` + WS (ticket, presença, typing), não lidas, testes unit/integration/api | 5–6 d |
| **M3 — Arquivos** ✅ | Upload streaming, dedupe por SHA-256, download autorizado, extensões bloqueadas, limpeza de órfãos, testes | 3–4 d |
| **M4 — Cliente web** ✅ | React/TS servido pelo FastAPI, login, 3 painéis, presença, envio otimista, anexos, busca, WS com reconexão (ver `plano-frontend.md`); build e typecheck verdes | 6–7 d |
| **M5 — Endurecimento** ✅ | Busca full-text (`/search`), auditoria e estatísticas no admin, `backup.ps1`, `install-server.ps1` + spec PyInstaller, scripts de operação | 3–4 d |

**Total: ~24–30 dias** até um piloto real, contando o front-end detalhado em `plano-frontend.md` (F0–F3 rodam em paralelo a M2/M3).

### Critérios de aceite do MVP (piloto)

- [ ] Admin cria setor, cria usuário e entrega credenciais.
- [ ] Dois usuários trocam mensagens em < 300 ms na LAN, em dois PCs distintos.
- [ ] Mensagem com destinatário offline aparece corretamente ao reconectar (catch-up por `seq`).
- [ ] Arquivo de 50 MB sobe com progresso e baixa íntegro (SHA-256 confere).
- [ ] Usuário de outro setor não acessa conversa nem arquivo alheio (teste de autorização).
- [ ] Matar o servidor/Postgres e reiniciar: nenhuma mensagem perdida, clientes reconectam sozinhos.
- [ ] Backup (`pg_dump` + arquivos) e restore em máquina limpa reproduzem o histórico.
- [ ] Servidor instalado como serviço do Windows entrega SPA + API em `http://<servidor>:8666`, sem Node na estação cliente.
- [ ] Cobertura de domínio e casos de uso > 80% (sem banco, com fakes).

---

## 10. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| TI não permite instalar `.exe` nas estações | Baixo | Resolvido: o cliente é o navegador; só o servidor recebe instalador |
| Antivírus bloqueia executável não assinado | Alto | Assinar com certificado interno ou liberar por GPO em M0 |
| Postgres indisponível derruba o chat | Alto | Serviço com restart automático, monitoramento de health, backup validado |
| Falta de DBA para operar Postgres | Médio | `docker-compose` versionado + `operacao.md`; rotina de backup automatizada |
| Crescimento de arquivos sem controle | Médio | Quota por setor, dedupe por SHA, relatório de uso no admin, retenção opcional |
| Vazamento de dados na LAN sem TLS | Médio | Documentar risco aceito; TLS na fase 2; VLAN/rede restrita |
| Escopo inflando (reações, threads, vídeo) | Alto | Lista "fora do escopo" é contratual para o MVP |
| Camadas virarem cerimônia (overengineering) | Médio | Regra do "uma camada, uma responsabilidade"; caso de uso simples pode chamar repositório direto |

---

## 11. Fase 2 (depois do piloto)

1. **SSO com Active Directory/LDAP** — nova `LdapAuthenticator` implementando a porta existente.
2. **TLS interno**, certificado distribuído por GPO.
3. Canais privados criados por usuários, menções `@`, threads.
4. Antivírus (ClamAV) nos uploads e quarentena.
5. App mobile/PWA com push.
6. Retenção e exportação formal (pacote de auditoria por período/usuário).
7. Escala horizontal: Redis Pub/Sub para o `EventBus`, read replica para busca.
8. Preparação para validação computadorizada (IQ/OQ/PQ, trilha de auditoria revisada).

---

## 12. Perguntas em aberto (não bloqueiam o M0)

1. Onde o PostgreSQL vai rodar: mesma máquina do app, VM dedicada ou instância gerenciada? Quem administra?
2. Versão do Postgres disponível na empresa (assumimos 17) e política de atualização.
3. O servidor vai rodar em qual máquina? (Windows Server, NAS, VM?) — define o script de serviço.
4. Qual antivírus/EDR e política de GPO? — define assinatura do instalador.
5. Lista inicial de setores (QA, Produção, Almoxarifado, RH, TI…).
6. Limite de tamanho de arquivo e cota total de disco.
7. Retenção exigida pelo jurídico/qualidade (mensagens e arquivos).
8. Destino do backup (NAS, disco externo, outro servidor).
