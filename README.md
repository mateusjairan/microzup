# Microzup

Chat corporativo para a indústria farmacêutica, operado na **rede local (LAN)** da empresa: mensagens e arquivos entre equipes e setores, com autoria preservada, exclusão lógica e trilha de auditoria.

Não é um mensageiro de consumo: o objetivo é comunicação interna densa, silenciosa e rastreável.

## Status

**Planejamento concluído — implementação inicia no M0.**

O repositório ainda não contém código executável. Os planos abaixo são a fonte de verdade até a primeira entrega.

## Stack

| Camada | Tecnologia |
|---|---|
| Banco | PostgreSQL 17 (`psycopg 3` async) |
| Backend | Python 3.13 · FastAPI · SQLAlchemy 2.0 async · Alembic · Pydantic v2 |
| Frontend | Electron · React 19 · TypeScript · Vite · Tailwind 4 · Zustand |
| Testes | pytest · Playwright · axe-core |

## Documentação

- [`docs/plano-mvp.md`](docs/plano-mvp.md) — escopo, arquitetura em camadas, modelo de dados, API, roadmap.
- [`docs/plano-frontend.md`](docs/plano-frontend.md) — UI "MSN moderno", tokens, telas, interações, acessibilidade.
- [`AGENTS.md`](AGENTS.md) — regras para agentes de código e convenções do projeto.

## Estrutura

```
server/     API, domínio, infraestrutura e migrations
desktop/    app Electron + renderer React
docs/       planos técnicos
scripts/    dev.ps1, backup.ps1, install-server.ps1
```

## Desenvolvimento (a partir do M0)

Requisitos: Python 3.13, `uv`, Node 22, Docker Desktop e Git.

```powershell
docker compose -f server/docker-compose.yml up -d
cd server
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

O primeiro administrador é criado por CLI, com senha lida de forma interativa:

```powershell
uv run python -m app.cli create-admin --username admin
```

Contrato de configuração: [`server/.env.example`](server/.env.example).

## Princípios não negociáveis

- Sem criptografia ponta a ponta — incompatível com auditoria.
- Sem exclusão física de mensagens, usuários ou auditoria.
- Autorização revalidada no servidor a cada acesso a conversa ou arquivo.
- Nenhuma dependência de CDN ou serviço externo em runtime: a instalação roda offline.
- Interface acessível (WCAG 2.1 AA) e silenciosa por padrão.

## Licença

Uso interno. Todos os direitos reservados.
