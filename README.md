# Microzup

Chat corporativo para a indústria farmacêutica, operado na **rede local (LAN)** da
empresa: mensagens e arquivos entre equipes e setores, com autoria preservada,
exclusão lógica e trilha de auditoria.

Não é um mensageiro de consumo: o objetivo é comunicação interna densa,
silenciosa e rastreável — pressa de MSN, disciplina de ferramenta de trabalho
regulada.

## Status

**MVP (M0–M5) finalizado; piloto pendente de execução.** Backend completo em
`server/` (identidade, conversas, mensagens idempotentes, arquivos com dedupe e
prévia 480 px, busca full-text + nome de arquivo, auditoria append-only com
envelope de erro universal, estatísticas com disco, retenção opcional auditada)
e cliente desktop Electron em `desktop/` (login, 3 painéis, presença, envio
otimista, anexos, busca, WS com reconexão, painel admin). Pendências conhecidas:

- Assinatura de código: o piloto aceita build não assinado (aviso do SmartScreen
  documentado na seção 4.1 de [`docs/operacao.md`](docs/operacao.md)); o
  executável do servidor já foi validado (33,6 MB, health 200, envelope no 401);
- Piloto real com um setor (critérios de aceite no plano-mvp §9 — backup/restore
  já testado de ponta a ponta, ver a seção 3.3 de [`docs/operacao.md`](docs/operacao.md)).

## Stack

| Camada | Tecnologia |
|---|---|
| Banco | PostgreSQL 17 (`psycopg 3` async; extensões `citext`, `pg_trgm`, `unaccent`) |
| Backend | Python 3.13 · FastAPI · SQLAlchemy 2.0 async · Alembic · Pydantic v2 |
| Gerenciador Python | `uv` (`uv.lock` commitado) |
| Frontend | Electron · React 19 · TypeScript estrito · Vite · Tailwind 4 · Radix · Zustand |
| Testes backend | pytest (unit/integration/e2e contra Postgres real) |
| Testes frontend | Playwright + axe-core (Electron real, suíte em `desktop/e2e/`) |
| Empacotamento | PyInstaller + NSSM (servidor) · electron-builder/NSIS (cliente) |

Arquitetura em 4 camadas (`presentation → application → domain ← infrastructure`),
casos de uso com transação única, repositórios via ports e auditoria por eventos —
detalhes em [`docs/plano-mvp.md`](docs/plano-mvp.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/plano-mvp.md`](docs/plano-mvp.md) | Plano técnico (fonte de verdade): escopo, arquitetura, modelo de dados, API, segurança/operação |
| [`docs/plano-frontend.md`](docs/plano-frontend.md) | UI "MSN moderno": tokens, telas, interações, acessibilidade |
| [`docs/api.md`](docs/api.md) | **Manual da API**: REST + WebSocket com exemplos de request/response |
| [`docs/operacao.md`](docs/operacao.md) | **Operação**: instalação, serviço Windows, backup/restore (testado) + retenção, logs, troubleshooting, variáveis de ambiente |
| [`AGENTS.md`](AGENTS.md) | Regras para agentes de código e convenções do projeto |
| [`server/.env.example`](server/.env.example) | Contrato de configuração (sem segredos) |

## Estrutura

```
server/     API, domínio, aplicação, infraestrutura, migrations e testes
desktop/    app Electron (electron/) + renderer React (src/)
docs/       planos, manual da API e guia de operação
scripts/    dev.ps1 · backup.ps1 · restore.ps1 · install-server.ps1 · open-firewall.ps1
```

## Rodando em desenvolvimento

Requisitos: Python 3.13 + `uv`, Node 22, Docker Desktop, Git. Windows + PowerShell.

O Postgres de dev sobe na porta **55432** do host (a 5432 costuma estar ocupada
por um Postgres local). Scripts `.ps1` podem exigir
`powershell -NoProfile -ExecutionPolicy Bypass -File <script>` dependendo da
Execution Policy da máquina (detalhes na seção 7.5 de
[`docs/operacao.md`](docs/operacao.md)).

```powershell
# Banco + API em um comando (sobe o Postgres, espera o healthcheck, migra e inicia)
.\scripts\dev.ps1

# ...ou passo a passo, a partir da raiz:
docker compose -f server/docker-compose.yml up -d

cd server
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8666
```

API em `http://localhost:8666` (Swagger UI em `/docs`). O primeiro administrador
é criado por CLI, com senha lida interativamente (nunca em argumento):

```powershell
uv run python -m app.cli create-admin --username admin
```

> Os comandos acima são de **desenvolvimento** (`--reload`). Para produção use o
> executável PyInstaller + serviço NSSM, ou `uv run python -m app.run` — rodar
> `uvicorn app.main:app` sem `--reload` no Windows quebra o psycopg async
> (armadilha documentada na seção 7.10 de [`docs/operacao.md`](docs/operacao.md)).

Acesso de outras máquinas da LAN: `http://<IP-do-servidor>:8666` — libere a porta
TCP 8666 no firewall com `.\scripts\open-firewall.ps1` (PowerShell como
administrador) e informe o endereço no campo **Servidor** do cliente.

### Cliente desktop

```powershell
cd desktop
npm ci
npm run dev          # Vite + Electron (desenvolvimento)
npm run typecheck    # renderer + processo main (electron/)
npm run build        # renderer + main
npm run dist         # instalador NSIS em desktop\release
npm run gen:api      # regenera os tipos TS do contrato a partir do OpenAPI do servidor
npm run test:e2e     # E2E: login, retry, scroll, reconexão, upload 50 MB, atalhos, axe, visual
```

O painel de administração (usuários, setores, canais, auditoria, uso de disco)
fica no próprio cliente, visível apenas para papel `admin`.

### Qualidade e testes (server/)

```powershell
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest -q
```

## Backup, restore e retenção

```powershell
# Backup: dump lógico (pg_dump -Fc) + arquivos de data\
.\scripts\backup.ps1 -BackupDir "C:\backups\microzup"

# Restore completo com smoke test (papéis, grants, pg_restore, alembic, arquivos)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore.ps1 `
  -DumpFile "C:\backups\microzup\<timestamp>\microzup.dump" -OwnerPassword <senha-do-owner>
```

O restore foi **testado de verdade** contra o Postgres de dev (banco temporário,
smoke test com contagens + SHA-256 dos anexos e limpeza ao final) — passo a passo
e resultado na seção 3.3 de [`docs/operacao.md`](docs/operacao.md).

Retenção de mensagens/arquivos é opcional e auditada (`message.purge` /
`file.purge`, ator `system`; mensagens seguem sem DELETE físico): task por
intervalo no servidor (`RETENTION_INTERVAL_SECONDS`) ou CLI explícita —
detalhes e agendamento na seção 3.5 de [`docs/operacao.md`](docs/operacao.md).

## Princípios não negociáveis

- Sem criptografia ponta a ponta — incompatível com auditoria regulatória.
- Sem exclusão física de mensagens, usuários ou auditoria (soft delete / desativação).
- Autorização revalidada no servidor a cada acesso a conversa ou arquivo.
- Nenhuma dependência de CDN ou serviço externo em runtime: a instalação roda offline.
- Interface acessível (WCAG 2.1 AA) e silenciosa por padrão.
- Segredos só em variáveis de ambiente (`server/.env`, fora do Git).

## Licença

Uso interno. Todos os direitos reservados.
