# AGENTS.md — Microzup

Instruções para agentes de código (OpenCode, Claude Code e afins) que trabalharem neste repositório.
Leia este arquivo antes de qualquer alteração. Ele prevalece sobre hábitos genéricos.

## 1. O que é o projeto

Microzup é um **chat corporativo farmacêutico** para uso na rede local (LAN) da empresa: mensagens e arquivos entre membros de equipe e setores. O produto prioriza rastreabilidade, autoria preservada e ruído baixo — não é um mensageiro de consumo.

**Estado atual:** M3 concluído — anexos (upload em streaming, dedupe por SHA-256, download autorizado, extensões bloqueadas, limpeza de órfãos). Próximo marco: M4 (cliente desktop).

**Fontes de verdade (leia antes de decidir arquitetura):**

- `docs/plano-mvp.md` — escopo, arquitetura em camadas, modelo de dados, API, roadmap.
- `docs/plano-frontend.md` — UI "MSN moderno", tokens, telas, interações, acessibilidade.

Se uma instrução do usuário contradizer os planos, **pergunte** antes de implementar e atualize o documento afetado na mesma entrega.

## 2. Stack decidida (não reabra sem pedido)

| Camada | Tecnologia |
|---|---|
| Banco | PostgreSQL 17 (`psycopg 3` async, extensões `citext`, `pg_trgm`, `unaccent`) |
| Backend | Python 3.13 + FastAPI + SQLAlchemy 2.0 async + Alembic + Pydantic v2 |
| Gerenciador Python | `uv` (com `uv.lock` commitado) |
| Frontend | Electron + React 19 + TypeScript estrito + Vite + Tailwind 4 + Radix + Zustand |
| Testes | pytest (unit/integration/e2e) + Playwright + axe-core |
| Empacotamento | PyInstaller + NSSM (servidor) · electron-builder/NSIS (cliente) |

Proibido sem aprovação explícita: SQLite, ORM síncrono, Django, Next.js, Redux, TanStack Query junto do Zustand, qualquer CDN em runtime, qualquer serviço externo (a instalação roda **offline**).

## 3. Estrutura alvo

```
server/app/{domain,application,infrastructure,presentation}/   # 4 camadas
desktop/{electron,src}/                                       # shell + renderer
docs/                                                          # planos
scripts/                                                       # dev.ps1, backup.ps1, install-server.ps1
```

Dentro de `domain`: `entities/`, `value_objects/`, `policies/`, `ports/`, `exceptions.py`.
Dentro de `application`: `use_cases/`, `dto.py`, `events.py`.

## 4. Comandos canônicos

> M0 ainda não foi implementado. Se um comando abaixo não existir, **crie-o exatamente assim** — não invente nomes alternativos.

```powershell
# Banco de desenvolvimento (a partir da raiz)
docker compose -f server/docker-compose.yml up -d

# Backend (a partir de server/)
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000

# Bootstrap do primeiro admin (senha via getpass, nunca em argumento)
uv run python -m app.cli create-admin --username admin

# Qualidade
uv run ruff check .
uv run ruff format --check .
uv run mypy app

# Testes
uv run pytest -q                     # tudo
uv run pytest tests/unit -q          # domínio + casos de uso (sem banco)
uv run pytest tests/integration -q   # repositórios contra Postgres real

# Frontend (a partir de desktop/)
npm ci
npm run dev
npm run typecheck
npm run test:e2e
npm run build
npm run dist
```

Portas: API `8000`, Vite `5173`, Postgres `55432` no host (container; 5432 costuma estar ocupada por um Postgres local).
Ambiente: Windows + PowerShell; não use sintaxe bash em scripts do repositório.

## 5. Regras de arquitetura (backend)

1. **Dependência só aponta para dentro:** `presentation → application → domain ← infrastructure`. `domain` não importa FastAPI, SQLAlchemy, `os` ou `requests`.
2. **ORM não é entidade.** `Message` (dataclass imutável) ≠ `MessageRow` (SQLAlchemy). Conversão em `infrastructure/db/mappers.py`.
3. **Toda operação é um caso de uso** em `application/use_cases/`, classe com `execute(cmd)`. Router só valida DTO, chama o caso de uso e traduz resposta/erro.
4. **Persistência só via repositório** (`Protocol` em `domain/ports`, implementação em `infrastructure/db/repositories`). Um caso de uso nunca abre sessão ou escreve SQL.
5. **Uma transação por caso de uso** via `UnitOfWork`; `commit` só no fim, `rollback` em exceção.
6. **Efeitos colaterais via `EventBus`** (`MessageCreated`, `UserDeactivated`). Nunca chame WebSocket, e-mail ou auditoria dentro da regra de negócio.
7. **Autorização revalidada no servidor** com `ConversationAccessPolicy` em toda leitura/escrita. Participar do canal é requisito, não cortesia.
8. **Nada de estado global mutável**; dependências entram pelo construtor e são montadas em `presentation/deps.py`.
9. **Tempo é injetado** (`Clock`) — proibido `datetime.now()` direto em domínio/caso de uso.
10. **Não existe `DELETE` físico** em `messages`, `users`, `audit_log` (soft delete / desativação). `audit_log` recebe apenas `INSERT`/`SELECT`.
11. **Dois papéis de banco:** Alembic usa `MIGRATION_DATABASE_URL` (`microzup_owner`); a aplicação usa `DATABASE_URL` (`microzup_app`), sem `UPDATE`/`DELETE` em `audit_log`. Nunca rode a aplicação como owner.

## 6. Regras de dados

- Migrações **somente** via Alembic, com `upgrade` e `downgrade` funcionais. Nunca edite migração já aplicada.
- Runtime conecta como `microzup_app`; migrations como `microzup_owner`. Tabela nova exige `GRANT` correspondente na migration.
- PK `uuid` (`gen_random_uuid()`); `timestamptz` em UTC; `messages.seq` é a ordem canônica (paginação e catch-up usam `seq`, nunca `created_at`).
- Não-lidas: `last_read_seq` × `messages.seq`. Não crie tabela de "lida por mensagem".
- Busca: `tsvector` gerado + GIN (`portuguese`). Não use `ILIKE` como busca principal.
- Toda ação sensível gera auditoria com `action` no formato `entidade.verbo` (`message.delete`, `file.download`, `user.create`).
- SQL bruto só quando o ORM não expressa (ex.: busca full-text), sempre parametrizado e acompanhado de teste de integração.

## 7. Regras de API e WebSocket

- Contrato gerado do OpenAPI (`openapi-typescript`); **não escreva tipo de API à mão** no frontend.
- Erro no formato `{"error": {"code": "...", "message": "...", "details": {}}}`; `DomainError` mapeado na borda (`AccessDeniedError → 403`, `NotFoundError → 404`, `ConflictError → 409`).
- Envio de mensagem exige `client_id` e é **idempotente** por `(conversation_id, client_id)`.
- WebSocket: autentique por **ticket de uso único** (`POST /ws/ticket`, TTL 30 s); o JWT nunca vai na query string. Envelope `{type, seq, ts, payload}`; reconexão com backoff; lacuna de `seq` obriga refetch por `after_seq`.
- Nunca inclua corpo de mensagem, token ou senha em log. Log estruturado em JSON.
- Segredos só em variáveis de ambiente lidas por `config.py`; commite apenas `.env.example`.

## 8. Regras de frontend

- **Tokens, não valores soltos:** cores, espaçamento e tipografia vêm de `styles/tokens.css`. Nada de hex no componente.
- **Zustand é a fonte única** do estado de chat; eventos WS mutam o store. Não duplique cache REST.
- Envio otimista obrigatório: `sending → sent → failed`, com retry usando o mesmo `client_id`.
- Scroll: só gruda no fim se o usuário já estava no fim; caso contrário, pill "N novas mensagens".
- Acessibilidade é requisito: foco visível, `aria-live` para mensagens, presença com texto (nunca só cor), `prefers-reduced-motion` respeitado.
- Sem CDN, sem fonte remota, sem analytics. Ícones via `lucide-react`; emoji estático curado — **nada animado**.
- Toda string visível em `src/i18n/pt-BR.ts`; componentes não contêm texto hardcoded.
- Segurança Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, IPC por allowlist, CSP sem origem remota, token só em `safeStorage`.
- WebSocket nunca usa o access token na URL: peça ticket em `POST /ws/ticket` antes de conectar ou reconectar.
- Uploads: valide extensão/tamanho no cliente **e** no servidor; nome de arquivo nunca vira caminho em disco.

## 9. Convenções de código e estilo

- **Idioma:** identificadores, tabelas, rotas e commits em inglês; UI e documentação em pt-BR.
- **Python:** `ruff` + `mypy --strict`; `async def` em toda I/O; type hints completos; dataclasses `frozen=True, slots=True` para entidades; sem herança além de exceções e `BaseRepository`.
- **TypeScript:** `strict`, sem `any` (use `unknown` + narrowing), sem `as` para calar o compilador; componentes funcionais; props explícitas.
- **Nomes:** `snake_case` (Python/DB), `camelCase` (TS), `PascalCase` (classes/componentes), `SCREAMING_SNAKE` (constantes).
- Sem comentário óbvio (`# incrementa i`). Comentário só para "por quê" não evidente.
- Não adicione dependência sem necessidade demonstrada; justifique no PR/entrega.

## 10. Testes (definição de pronto)

- Domínio e casos de uso: testes **sem banco**, com fakes em memória.
- Repositórios/busca: testes de integração contra Postgres real (`microzup_test`), nunca SQLite.
- API: `httpx` + banco transacional com rollback por teste.
- WebSocket: entrega, reconexão e catch-up por `seq`.
- Frontend: Playwright nos fluxos críticos (login, envio, upload, reconexão) + `axe` sem violação séria.
- Cobertura mínima: 80% em `domain` e `application`.
- Bug corrigido = teste que falha antes e passa depois.

## 11. O que NÃO fazer

- Não implementar criptografia ponta a ponta (incompatível com auditoria).
- Não adicionar threads, reações, menções, GIFs, stickers, chamadas ou enquetes no MVP.
- Não usar `localStorage` para token, nem logar credenciais.
- Não "consertar" algo removendo auditoria, soft delete ou checagem de permissão.
- Não trocar PostgreSQL por SQLite "para simplificar" nem em teste.
- Não expor `MessageRow`/`UserRow` na resposta HTTP.
- Não usar `window.fetch` direto em componente (passe por `lib/api`).
- Não criar endpoint público de cadastro/auto-registro: admin só via CLI `create-admin` ou `/admin/users` autenticado.
- Não alterar `docs/*.md` para refletir código divergente — o código deve seguir o plano; mudanças de decisão exigem confirmação.

## 12. Fluxo esperado do agente

1. Ler `AGENTS.md` + o documento relevante em `docs/` (arquitetura → `plano-mvp.md`; UI → `plano-frontend.md`).
2. Se o pedido for ambíguo ou mudar decisão registrada, perguntar antes de codar.
3. Implementar **uma fatia vertical** por vez (migração → entidade → porta → repositório → caso de uso → rota → teste), não camadas inteiras vazias.
4. Rodar `ruff`, `mypy`, testes afetados e, no frontend, `typecheck` + E2E do fluxo tocado.
5. Atualizar documentação/`.env.example` quando o contrato mudar.
6. Relatar: o que mudou, como foi verificado, o que ficou pendente.

## 13. Armadilhas conhecidas

- Windows: use `pathlib`, nunca concatene caminho com `/`; arquivos em UTF-8 sem BOM.
- Windows + psycopg async exige `SelectorEventLoop`; `configure_event_loop()` é chamado em `main.py`, `alembic/env.py` e `tests/conftest.py`. Não remova.
- `docker compose` precisa estar de pé **antes** de `alembic upgrade`; espere o healthcheck do Postgres.
- Teste de integração que "passa" sem banco está errado — falhe explicitamente se a conexão não existir.
- `messages.seq` vem do banco; não o simule no cliente.
- Não confie em `created_at` do cliente para ordenar nada.
- Sessão expirada deve preservar rascunho do composer.
- Não rode `npm run dist` em máquina sem certificado assinado esperando instalador "limpo" — o piloto aceita build não assinado, mas registre o aviso do SmartScreen.

## 14. Git

- Commits pequenos, em inglês, Conventional Commits: `feat(server): add message pagination`, `fix(desktop): keep draft on reconnect`, `docs: update mvp roadmap`.
- Escopos: `server`, `desktop`, `docs`, `infra`.
- Não commite `.env`, `node_modules`, `data/`, `dist/`, `*.db`, tokens nem certificados.
- Não reescreva histórico nem faça force-push em branch compartilhada.
