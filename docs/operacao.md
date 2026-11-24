# Microzup — Guia de operação

> Instalação, backup, restore, retenção, logs e troubleshooting do servidor
> Microzup na LAN. Complementa `docs/plano-mvp.md` §8 e o [`README.md`](../README.md).
> Estado: **final do MVP** (2026-11-18).

---

## 1. Requisitos

**Servidor (a máquina que roda a API):**

| Item | Requisito |
|---|---|
| SO | Windows 10/11 (Server também funciona) |
| Python | 3.13 + [`uv`](https://docs.astral.sh/uv/) (gerenciador; `uv.lock` commitado) |
| Banco | PostgreSQL 17 — container Docker (dev/piloto) ou instalação própria |
| Disco | `STORAGE_DIR` para anexos (planeje 100 GB no piloto) |
| Portas | **8666/TCP** (API, liberar no firewall p/ LAN) · **55432/TCP** (Postgres do container, **só localhost**) |

**Cliente (estações):** Windows 10/11 com navegador moderno (Edge/Chrome); nenhuma
dependência instalada — o SPA é servido pelo backend (§4).

> **Porta 55432 vs 5432:** o container do Postgres publica **55432 no host**
> (dentro do container é 5432). A 5432 costuma estar ocupada por um Postgres
> local da máquina — por isso o desvio. `DATABASE_URL`/`MIGRATION_DATABASE_URL`
> devem apontar para `localhost:55432` no dev; em produção com Postgres nativo,
> use a porta real do seu servidor.

> **Execution Policy (Windows PowerShell):** máquinas novas vêm com política
> `Restricted`, que bloqueia `.\scripts\*.ps1`. Rode os scripts assim:
> `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup.ps1`
> — ou, uma vez por máquina (admin): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

---

## 2. Instalação do servidor (dev → piloto)

### 2.1 Banco (Docker)

Na raiz do repo:

```powershell
docker compose -f server/docker-compose.yml up -d
```

- Cria o container **`microzup-db`** (postgres:17) com volume nomeado
  `microzup_pgdata`, healthcheck `pg_isready` e a publicação `55432->5432`.
- Na **primeira** inicialização, `server/infra/initdb/01-init.sql` cria o papel
  **`microzup_app`** e o banco `microzup_test` (papéis são cluster-wide; o dono
  `microzup_owner` vem do `POSTGRES_USER` do compose).
- **Espere o healthcheck ficar `healthy` antes de qualquer `alembic upgrade`**
  (veja §7.2 — o `scripts/dev.ps1` já espera sozinho):

```powershell
docker inspect --format "{{.State.Health.Status}}" microzup-db   # healthy
```

Credenciais de dev (commitadas em `server/docker-compose.yml` /
`server/infra/initdb/01-init.sql` — troque em produção):

| Papel | Senha de dev | Uso |
|---|---|---|
| `microzup_owner` | `microzup_dev_owner` | DDL/Alembic (superusuário do container) |
| `microzup_app` | `microzup_dev_app` | runtime (sem UPDATE/DELETE em `audit_log`) |

### 2.2 Aplicação

Em `server/`, com `.env` copiado de `.env.example` (§6):

```powershell
uv sync
uv run alembic upgrade head          # usa MIGRATION_DATABASE_URL (owner)
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8666
```

Atalho que faz tudo (sobe banco + espera healthcheck + sync + migrate + API):

```powershell
.\scripts\dev.ps1
```

> O comando com `--reload` acima é de **desenvolvimento**. Em produção use o
> exe do §2.4 ou `uv run python -m app.run` — subir `uvicorn app.main:app`
> sem `--reload` no Windows quebra o psycopg async (§7.10).

> **Dois papéis, sempre:** migrações rodam como `microzup_owner`
> (`MIGRATION_DATABASE_URL`); a aplicação conecta como `microzup_app`
> (`DATABASE_URL`), sem `UPDATE`/`DELETE` em `audit_log` (garantido por REVOKE
> nas migrations e re-aplicado no restore). Nunca rode a app como owner.

### 2.3 Primeiro administrador

Não existe auto-registro HTTP. Na máquina do servidor:

```powershell
cd server
uv run python -m app.cli create-admin --username admin
uv run python -m app.cli create-admin --username admin --sector qualidade-e-assuntos-regulatorios
```

- Senha lida por `getpass` no terminal (nunca em argumento, variável de ambiente
  ou histórico; em stdin não-interativo — automação — lê do pipe com aviso).
- Idempotente: usuário existente é recusado sem sobrescrever a senha.
- Registra auditoria `user.bootstrap` (ator nulo) — mesmo fora do servidor,
  o subscriber de auditoria grava o log.
- `--sector <slug>` aloca o admin em um setor na criação (**use o slug, não o
  nome**; setor inexistente aborta com aviso, sem criar o usuário). Sem setor,
  o admin não vê canais até ser alocado via `PATCH /admin/users/{id}`.
- Sem nenhum admin ativo o servidor loga `WARNING` (`boot_without_active_admin`)
  no boot — com dica do próprio comando acima.

A CLI também traz `retention-run` para aplicar a retenção explicitamente
(§3.5).

### 2.4 Serviço Windows (NSSM) + executável PyInstaller

Gera `dist\microzup-server.exe` (spec `server/microzup.spec`, entrada
`app/run.py`) e instala o serviço "Microzup":

```powershell
.\scripts\install-server.ps1            # build + serviço NSSM
.\scripts\install-server.ps1 -SkipBuild # só reinstala o serviço com o exe atual
```

O script:

1. `uv sync` + `alembic upgrade head` (banco precisa estar no ar — §2.1);
2. `pyinstaller --noconfirm --clean microzup.spec` → `server\dist\microzup-server.exe`;
3. com NSSM no PATH: `nssm install Microzup <exe>`, `AppDirectory = <repo>\server`
   (onde ficam `.env` e `data\`), stdout/stderr em `data\logs\service-*.log` com
   rotação por tamanho, e inicia o serviço.

Sem NSSM, o script imprime o comando para instalar manualmente
(`choco install nssm` ou baixar de nssm.cc). Verifique depois:

```powershell
nssm status Microzup        # SERVICE_RUNNING
Invoke-RestMethod http://localhost:8666/health
```

O serviço lê `HOST`/`PORT` do `.env` (default `0.0.0.0:8666`).

**Executável validado de verdade (2026-11-18):** `microzup-server.exe` com
**33,6 MB**, boot com `/health` → `200`, login sem credencial → `401` **já no
envelope** `{"error": {...}}`, sem dependência de Python/uv na máquina. O exe é
**não assinado** — o SmartScreen do §4.1 se aplica. Importante: o exe lê o
`.env` **do diretório de trabalho atual** (CWD), não do diretório do binário —
ao instalar manualmente, coloque o `.env` (e mantenha `STORAGE_DIR`) na pasta
de onde o serviço/executável roda; o `install-server.ps1` já resolve isso com
`AppDirectory`. O boot de produção do exe usa `app/run.py` (Selector event
loop — veja a armadilha em §7.10).

### 2.5 Firewall da LAN

Na máquina do servidor, PowerShell **como administrador**:

```powershell
.\scripts\open-firewall.ps1                       # TCP 8666, origem LocalSubnet
.\scripts\open-firewall.ps1 -Port 8666 -RemoteAddress 192.168.0.0/24
```

As estações abrem `http://<IP-do-servidor>:8666` no navegador — não há campo
**Servidor** nem descoberta automática: a página é servida pelo próprio backend.
Se o IP mudar, o endereço muda apenas no favorito/atalho. O plano é HTTP puro na
LAN (decisão documentada — TLS na fase 2); restrinja a regra à sub-rede
corporativa.

---

## 3. Backup, restore e retenção

### 3.1 Backup diário — `scripts/backup.ps1`

```powershell
# Modo 1: host com ferramentas do Postgres
$env:BACKUP_DSN = "postgresql://microzup_owner:senha@localhost:55432/microzup"
.\scripts\backup.ps1 -BackupDir "C:\backups\microzup"

# Modo 2: sem pg_dump no host — usa o do container (docker exec + docker cp)
.\scripts\backup.ps1 -BackupDir "C:\backups\microzup" -ContainerName microzup-db
```

O script escolhe o modo automaticamente (BACKUP_DSN + pg_dump no PATH ⇒ local;
senão Docker). Produz, em `C:\backups\microzup\<timestamp>\`:

- `microzup.dump` — dump lógico **completo** (`pg_dump -Fc`): schema, dados,
  grants e `alembic_version`. Papéis (CREATE ROLE) **não** vão no dump — o
  restore os recria;
- `files\` — cópia robocopy de `server\data` (anexos em `files/AAAA/MM/<uuid>`,
  prévias em `thumbs/`, logs em `logs/`).

Agendamento diário (ex.: 02:00), PowerShell como administrador:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"C:\caminho\microzup\scripts\backup.ps1`" -BackupDir C:\backups\microzup"
$trigger = New-ScheduledTaskTrigger -Daily -At 02:00
Register-ScheduledTask -TaskName "Microzup Backup" -Action $action -Trigger $trigger -RunLevel Highest
```

Retenção de backups: política manual (ex.: manter 14 diários + 4 semanais).
PITR/WAL archiving fica para a fase 2 (plano §8).

### 3.2 RESTORE — `scripts/restore.ps1`

Restaura um backup do §3.1 em 7 passos: **papéis** → **banco de destino** →
**pg_restore** (`--clean --if-exists --exit-on-error`) → **grants canônicos**
(os das migrations, idempotentes) → **alembic upgrade head** (no-op se o dump já
está no head; sobe migrations novas se o backup for mais velho) → **robocopy dos
arquivos** → **smoke test** (contagens do banco + existência, tamanho e SHA-256
de cada anexo no disco; com `-SourceDatabase`, compara origem × restore).

```powershell
# Restore padrão (mesmo nome de banco, mesma pasta de dados)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore.ps1 `
  -DumpFile "C:\backups\microzup\20261118-120231\microzup.dump" `
  -OwnerPassword <senha-do-owner>

# Restore para um banco de TESTE + comparação com a origem
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore.ps1 `
  -DumpFile "C:\backups\microzup\20261118-120231\microzup.dump" `
  -TargetDatabase microzup_restore_test -DropTarget `
  -DataDir C:\temp\microzup-data -SourceDatabase microzup `
  -OwnerPassword <senha-do-owner>
```

| Parâmetro | Default | Uso |
|---|---|---|
| `-DumpFile` | (obrigatório) | dump do backup.ps1 |
| `-FilesDir` | `<pasta do dump>\files` | pasta de arquivos do backup |
| `-DataDir` | `<repo>\server\data` | destino dos arquivos (STORAGE_DIR) |
| `-TargetDatabase` | `microzup` | banco de destino |
| `-SourceDatabase` | — | se informado, compara contagens origem × restore no smoke test |
| `-AdminDsn` | — | modo local: DSN do banco `postgres` com papel admin (ex.: `postgresql://microzup_owner:senha@localhost:55432/postgres`) |
| `-MigrationUrl` | derivada | URL do Alembic (papel owner + banco destino) |
| `-DbHost`/`-DbPort` | `localhost`/`55432` | base para URLs derivadas |
| `-OwnerRole`/`-OwnerPassword` | `microzup_owner`/— | papel DDL; senha necessária p/ alembic e p/ criar papel ausente |
| `-AppRole`/`-AppRolePassword` | `microzup_app`/— | papel runtime; senha só se precisar recriá-lo |
| `-ContainerName` | `microzup-db` | modo docker (auto quando faltam pg_restore/psql no host) |
| `-DropTarget` | off | apaga e recria o banco antes do restore (re-testes) |
| `-SkipMigrations` | off | pula `alembic upgrade head` |

**Modos de acesso:** local (`pg_restore`/`psql` no PATH + `-AdminDsn`) ou
Docker (`docker exec`/`docker cp` no container `microzup-db`, sem senha —
confiança local do container). A escolha é automática; o modo docker é o caminho
documentado para o dev (o host não tem as ferramentas pg).

**Fumaça:** o smoke test falha (exit 1, sem meia-vitória) se o banco restaurado
estiver sem usuários, se qualquer contagem divergir da origem
(`-SourceDatabase`) ou se qualquer anexo estiver ausente/tamanho ou SHA-256
divergente no disco.

### 3.3 Restore testado de verdade (2026-11-18, critério do piloto §9)

Cenário: dev real — container `microzup-db` healthy, banco `microzup` com
3 usuários, 1 canal, 2 membros, 1 mensagem, 1 anexo (`relatorio-restore.txt`,
81 bytes, sha256 `4ccc5de8…991f`) e arquivo físico em `server\data\files\2026\11\`.

Passos executados (PowerShell 5.1, sem ferramentas pg no host):

1. `.\scripts\backup.ps1 -BackupDir <repo>\tmp-restore-test\backups`
   → modo docker; gerou `20261118-120231\microzup.dump` (32.567 bytes) +
   `files\files\2026\11\<uuid>` (81 bytes).
2. `.\scripts\restore.ps1 -DumpFile ...\microzup.dump -TargetDatabase microzup_restore_test
   -DropTarget -DataDir <repo>\tmp-restore-test\restored-data -SourceDatabase microzup
   -OwnerPassword microzup_dev_owner`
   → passos 1–7 verdes: papéis já existiam; `CREATE DATABASE`; `pg_restore`;
   grants reaplicados (audit_log seguiu sem UPDATE/DELETE para `microzup_app`);
   **alembic subiu 0004 → 0005** (dump era do head anterior; backup mais velho
   que as migrations é exatamente o caso que o passo cobre); robocopy dos
   arquivos; smoke test OK.
3. Verificação independente fora do script: contagens conferem
   (3 usuários / 1 mensagem / 1 anexo); `has_table_privilege` confirma
   `microzup_app` INSERT em `messages` e **sem** UPDATE/DELETE em `audit_log`;
   `alembic_version = 0005`; arquivo restaurado com 81 bytes e SHA-256 idêntico
   ao registrado no banco e ao original.
4. **Limpeza:** `DROP DATABASE microzup_restore_test WITH (FORCE)` (restando só
   `microzup` e `microzup_test`), remoção da pasta `tmp-restore-test` e do
   `/tmp/microzup-restore` no container.

Resultado: **backup + restore reproduzem o histórico** — critério do piloto
"Backup e restore em máquina limpa reproduzem o histórico" validado neste
cenário (banco limpo de teste + pasta de dados vazia).

### 3.4 Notas de restore

- Se o Postgres de destino for um **cluster novo** (máquina limpa), o script
  cria os papéis que faltarem — forneça `-OwnerPassword`/`-AppRolePassword`
  para isso (ou suba o container com `server/docker-compose.yml`, que cria o
  `microzup_app` via initdb).
- Restaurar "na própria máquina" (`-TargetDatabase microzup`, default) não
  requer mudar `.env`; restaurar em outro banco exige ajustar
  `DATABASE_URL`/`MIGRATION_DATABASE_URL`.
- `-DropTarget` é destrutivo para o banco de destino (drop + recreate). Sem ele,
  o `pg_restore --clean --if-exists` recria os objetos do dump preservando
  objetos extras que por ventura existam.
- `docker cp` não cria diretórios intermediários no container — o script cria
  `/tmp/microzup-restore` antes (e limpa no final).

### 3.5 Retenção de mensagens e arquivos (opcional)

Desligada por padrão (`MESSAGE_RETENTION_DAYS=0`, `FILE_RETENTION_DAYS=0`).
Quando habilitada, aplica a política `RetentionPolicy` de duas formas:

**1) Task automática no próprio servidor** (recomendada): um lote por intervalo,
executado no lifespan. Controlada por `RETENTION_INTERVAL_SECONDS` (default
`3600` = 1 h; `0` **desliga a task** — a CLI continua disponível).

**2) CLI explícita**, para operação pontual ou agendamento externo:

```powershell
cd server
uv run python -m app.cli retention-run
```

- Roda em **lotes transacionais de 500** itens de cada tipo, repetindo até
  esgotar (até 400 rodadas ≈ 200 mil itens por execução; se atingir o limite,
  reexecute para continuar de onde parou — o comando avisa).
- Desligada (`0/0`), a CLI imprime orientação e sai sem tocar em nada.

**Regras de integridade** (rastreabilidade farmacêutica):

- **Mensagens nunca têm DELETE físico.** Retenção = *soft delete*
  (`deleted_at`, corpo substituído) com o **corpo original preservado na
  auditoria** — ação `message.purge`, ator `"system"`
  (`actor_id = NULL`, `metadata.actor = "system"`, com `retention_days` e
  `conversation_id`).
- **Anexos** são expurgados de verdade: blob **e** thumbnail removidos do
  disco e registro da tabela apagado — ação `file.purge` (ator `"system"`,
  com `filename`, `sha256`, `size_bytes`, `message_id`).
- Tudo auditado em `audit_log` (consultável em `GET /admin/audit`).

**Agendamento sugerido:** a task in-process (modo 1) já cobre o piloto — um
lote por hora com retenção diária é folga suficiente. Se preferir controle
explícito, desligue a task (`RETENTION_INTERVAL_SECONDS=0`) e agende a CLI no
Agendador do Windows (ou via NSSM com script wrapper), ex..: diária às 03:00,
`powershell -NoProfile -ExecutionPolicy Bypass -Command "cd C:\microzup\server; uv run python -m app.cli retention-run"`.
Com um único processo Uvicorn, nunca agende a CLI em paralelo à task —
escolha um dos dois modos.

---

## 4. Deploy do cliente web

O cliente é uma SPA React servida pelo próprio backend. Não há instalador de
cliente, assinatura de código, SmartScreen nem `node_modules` nas estações: a TI
só precisa liberar a porta **8666/TCP** e apontar o navegador para
`http://<IP-do-servidor>:8666`.

### 4.1 Build

Na máquina com internet (build), a partir de `web/`:

```powershell
npm ci
npm run typecheck
npm run build        # gera web/dist (HTML, JS, CSS, fontes, ícones)
```

Copie `web/dist` junto do servidor. O FastAPI detecta a pasta em `WEB_DIST_DIR`
(padrão `web/dist`, relativo à raiz do repositório) e a monta em `/`. Sem o
build, o backend sobe normalmente e `/` responde **404**, com o aviso
`web_build_missing` no log — sirva o SPA é parte do deploy, não um extra.

### 4.2 Atualização

Substituir `web/dist` e reiniciar o serviço entrega a versão nova a todas as
estações no próximo carregamento (F5); não há auto-update de cliente. Os assets
têm hash no nome, então o navegador não serve JS antigo depois da troca. O banner
"nova versão do servidor" continua funcionando pelo `server.hello` do WebSocket.

### 4.3 Cache e offline

- O SPA é estático; o backend envia `Cache-Control` padrão do `StaticFiles`.
- Não há service worker/PWA no MVP: sem rede, a página não abre. O rascunho e a
  fila de envio continuam no `localStorage` do navegador e são reenviados com o
  mesmo `client_id` ao reconectar.
- Limpar dados do site apaga preferências e outbox, mas **não** encerra a sessão
  se o cookie de refresh for preservado; "Sair" no app revoga a sessão no servidor.

### 4.4 Sessão e cookies

- `POST /auth/login` devolve o access na resposta e grava o refresh em cookie
  `HttpOnly` + `SameSite=Strict`, path `/auth`, 30 dias (ou cookie de sessão se
  "Manter conectado" estiver desmarcado).
- `POST /auth/refresh` e `POST /auth/logout` leem o cookie; nenhum token aparece
  no corpo dessas respostas nem no JavaScript.
- Em HTTP puro na LAN, `COOKIE_SECURE=false`. Ao migrar para TLS, defina
  `COOKIE_SECURE=true` e sirva o SPA pelo mesmo host HTTPS (o WebSocket vira `wss`).
- Navegador com cookies bloqueados ou modo restrito impede o login persistente:
  o app volta à tela de login a cada recarregamento.

### 4.5 Origens, proxy e firewall

- Produção: mesma origem, `CORS_ORIGINS` vazio.
- Dev: `npm run dev` sobe o Vite em `5173` e faz proxy de `/auth`, `/me`,
  `/users`, `/admin`, `/sectors`, `/conversations`, `/messages`, `/files`,
  `/search`, `/health` e `/ws` para `127.0.0.1:8666`. Caminho novo de API precisa
  entrar nessa lista para funcionar em dev.
- Firewall: `.\scripts\open-firewall.ps1` (PowerShell como administrador).


## 5. Logs e rotação

- **Formato:** JSON estruturado (structlog), uma linha por evento, UTC.
- **Saídas:** stdout (serviço NSSM redireciona para `data\logs\service-*.log`)
  **e** arquivo `data\logs\server.log` com **rotação diária à meia-noite**
  (`TimedRotatingFileHandler`, `backupCount = LOG_RETENTION_DAYS`).
- **Nunca** há corpo de mensagem, token ou senha em log.
- `LOG_LEVEL` controla verbosidade (`INFO` default; `DEBUG` só para investigar).

Verificar logs do serviço:

```powershell
Get-Content server\data\logs\server.log -Tail 50
nssm dump Microzup   # configuração do serviço (stdout/stderr/rotação)
```

---

## 6. Variáveis de ambiente (`server/.env`)

Contrato completo em [`server/.env.example`](../server/.env.example); segredos
nunca no Git. Regra do plano §8: variável nova entra em `.env.example`, na tabela
abaixo e em `config.py` **na mesma alteração**.

| Variável | Default | Função |
|---|---|---|
| `APP_ENV` | `development` | `development` \| `test` \| `production` (em production, `JWT_SECRET` default é recusado no boot) |
| `HOST` / `PORT` | `0.0.0.0` / `8666` | bind do Uvicorn |
| `LOG_LEVEL` | `INFO` | nível de log |
| `LOG_DIR` | `./data/logs` | arquivo `server.log` + rotação diária |
| `LOG_RETENTION_DAYS` | `14` | quantos dias de log girado manter |
| `DATABASE_URL` | — | conexão do runtime como `microzup_app` |
| `MIGRATION_DATABASE_URL` | — | conexão do Alembic como `microzup_owner` |
| `JWT_SECRET` | — | ≥ 32 bytes aleatórios; ausência (default dev) impede boot em produção |
| `ACCESS_TOKEN_TTL_MINUTES` | `15` | validade do access token |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | validade do refresh (rotativo) |
| `WS_TICKET_TTL_SECONDS` | `30` | validade do ticket de WebSocket (uso único) |
| `LOGIN_MAX_ATTEMPTS` | `5` | falhas antes do bloqueio progressivo |
| `LOGIN_LOCKOUT_SECONDS` | `300` | duração do bloqueio de login |
| `RATE_LIMIT_LOGIN_PER_MINUTE` | `10` | tentativas de login por IP/min |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | `20` | uploads por usuário/min |
| `RATE_LIMIT_MESSAGE_PER_MINUTE` | `30` | mensagens por usuário/min |
| `CORS_ORIGINS` | vazio | origens permitidas, separadas por vírgula; vazio = mesma origem (SPA servida pela API) |
| `WEB_DIST_DIR` | `web/dist` | build do SPA servido em `/` |
| `COOKIE_SECURE` | `false` | cookie de refresh com `Secure` (ligue ao migrar para TLS) |
| `STORAGE_DIR` | `./data` | raiz de anexos (`files/`), prévias (`thumbs/`) e logs |
| `MAX_UPLOAD_MB` | `100` | limite por arquivo |
| `MAX_ATTACHMENTS_PER_MESSAGE` | `5` | limite por mensagem |
| `ORPHAN_ATTACHMENT_TTL_HOURS` | `24` | limpeza de uploads não vinculados |
| `MESSAGE_MAX_CHARS` | `8000` | limite do corpo da mensagem |
| `MESSAGE_RETENTION_DAYS` | `0` | retenção de mensagens (`0` = desligado) |
| `FILE_RETENTION_DAYS` | `0` | retenção de anexos (`0` = desligado) |
| `RETENTION_INTERVAL_SECONDS` | `3600` | intervalo da task de retenção no servidor; `0` desliga a task (a CLI `retention-run` continua disponível — §3.5) |
| `STATEMENT_TIMEOUT_MS` | `15000` | timeout de statement por conexão (§8 do plano) |
| `IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS` | `30000` | timeout de transação ociosa |

Gerar um segredo: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

> A tabela acima inclui as variáveis novas de endurecimento (`LOG_DIR`,
> `LOG_RETENTION_DAYS`, `LOGIN_LOCKOUT_SECONDS`, `RATE_LIMIT_*`,
> `STATEMENT_TIMEOUT_MS`, `IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS`), já
> presentes em `config.py` **e** em `server/.env.example` (housekeeping
> sincronizado durante a sprint).

---

## 7. Troubleshooting

### 7.1 Windows + psycopg async (SelectorEventLoop)

psycopg async não funciona com `ProactorEventLoop` (default do Python no
Windows). A correção é `configure_event_loop()`
(`app/core/compat.py` → `WindowsSelectorEventLoopPolicy`), chamada em
`app/main.py`, `app/run.py`, `alembic/env.py` e `tests/conftest.py`.
**Sintoma sem ela:** `RuntimeError: no current event loop` / erros de
`add_reader` no primeiro acesso ao banco. Se um ponto de entrada novo surgir
(CLI extra, script), chame `configure_event_loop()` antes do `asyncio.run`.
Cuidado extra: rodar `uvicorn app.main:app` **sem** `--reload` tem uma pegadinha
própria — veja §7.10.

### 7.2 Alembic antes do Postgres pronto

`alembic upgrade head` falha com "connection refused"/timeout se o banco ainda
não aceita conexões — o healthcheck do container pode levar ~10 s.
**Sintoma:** `docker compose up -d && uv run alembic upgrade head` na mesma
linha. **Correção:** espere `docker inspect --format "{{.State.Health.Status}}"
microzup-db` → `healthy` (o `scripts/dev.ps1` faz isso; testes de integração
falham explicitamente sem banco, por decisão).

### 7.3 401 após ~15 minutos (token expirado)

Comportamento **esperado**: access token vale `ACCESS_TOKEN_TTL_MINUTES` (15).
O cliente web já trata isso sozinho: **refresh proativo** com margem antes
da expiração e, num eventual `401`, um único refresh + retry da chamada original
(uploads inclusos) — sem deslogar, sem perder o rascunho do composer. Só quando
o próprio refresh falha (`invalid_token`) a sessão expira de verdade e o cliente
mostra o overlay de sessão expirada (plano-frontend §9). Se usuários reportarem
"logo out a cada 15 min", verifique o relógio da máquina ou se o backend foi
reiniciado com outro `JWT_SECRET`.

### 7.4 Porta 55432 (container) vs 5432 (local)

`localhost:55432` é o Postgres do container `microzup-db`. Se você tem um
Postgres **nativo** na máquina, ele continua na 5432 — são bancos diferentes
(dados/divisões diferentes). Erros de autenticação "aleatória" costumam ser a
URL apontando para o Postgres errado. Confirme com:
`docker exec microzup-db psql -U microzup_owner -d microzup -c "SELECT 1"`.

### 7.5 Scripts .ps1 bloqueados ("não assinado digitalmente")

Execution Policy `Restricted` (default do Windows client) bloqueia scripts.
Rode `powershell -NoProfile -ExecutionPolicy Bypass -File <script>` ou ajuste a
política (§1). Os scripts do repo são texto puro, sem assinatura — em ambiente
com GPO restritivo, peça liberação por hash/GPO.

### 7.6 pg_dump/pg_restore não estão no host

Não é preciso instalá-los: `backup.ps1` e `restore.ps1` têm **modo docker**
(`docker exec` no container `microzup-db`, §3). O modo local (ferramentas no
PATH) é para quem prefere/tem PostgreSQL client instalado.

### 7.7 Acentos "quebrados" em .ps1 (mojibake)

Scripts do repo são **UTF-8 sem BOM**; o Windows PowerShell 5.1 lê arquivo sem
BOM como ANSI. Por isso os scripts usam **strings sem acento** — não "conserte"
adicionando acentos de volta, e preserve o arquivo sem BOM ao editar
(VS Code: "Save with encoding → UTF-8 (sem BOM)").

### 7.8 Acesso de outra estação não funciona

1. Firewall: `.\scripts\open-firewall.ps1` (TCP 8666, perfil correto —
   `Get-NetConnectionProfile` mostra se é Private/Public).
2. Bind: a API precisa subir com `HOST=0.0.0.0` (default), não `127.0.0.1`.
3. Teste na estação: `http://<IP-do-servidor>:8666/health` no navegador.
4. `docker ps` mostra `0.0.0.0:55432->5432` — a 55432 **não** precisa estar no
   firewall (só o servidor local acessa o banco).

### 7.9 Serviço não sobe após reboot

`nssm status Microzup` + logs em `server\data\logs\service-err.log`. Causas
comuns: `.env` ausente na `AppDirectory` (§2.4), Postgres ainda subindo (§7.2) —
configure dependência de serviço se o Postgres for nativo
(`nssm depend Microzup postgresql-x64-17`).

### 7.10 `uvicorn app.main:app` sem `--reload` no Windows (CRÍTICO)

**Sintoma:** o servidor sobe, `/health` responde `200`, mas **toda chamada que
toca o banco falha com 500** (`internal_error`); o boot loga
`boot_admin_check_failed` (a checagem de admin também não consegue conectar).

**Causa:** a partir do uvicorn 0.36, `uvicorn app.main:app` (sem `--reload`)
cria um **`ProactorEventLoop`** direto via `loop_factory` e **ignora** a
`WindowsSelectorEventLoopPolicy` definida por `configure_event_loop()` — e o
psycopg async não funciona com Proactor no Windows.

**Correção — em produção, NUNCA suba com `uvicorn app.main:app` direto:**

- use o **exe** (`dist\microzup-server.exe`, §2.4) — o boot dele é `app/run.py`;
- ou `uv run python -m app.run` — `run.py` serve o `uvicorn.Server` dentro de
  `asyncio.run`, que **honra** a policy Selector.

**Em dev não afeta:** com `--reload` o próprio uvicorn usa o modo subprocess e
escolhe Selector sozinho (por isso `scripts/dev.ps1` e o comando canônico do
README funcionam).

### 7.11 SPA responde 404 na raiz (`/`)

**Sintoma:** o navegador abre `http://<servidor>:8666` e recebe 404 (ou JSON de
erro), embora `/health` responda 200.

**Causa:** `web/dist` não existe ou `WEB_DIST_DIR` aponta para o lugar errado. O
backend sobe normalmente e registra `web_build_missing` no log.

**Correção:**

```powershell
cd web
npm run build
Test-Path dist\index.html   # precisa ser True
```

Reinicie o serviço. Em desenvolvimento, use o Vite (`npm run dev`, porta 5173)
ou compile antes de abrir a 8666.

### 7.12 Login não persiste: volta para a tela de login ao recarregar

**Sintoma:** o login funciona, mas F5 (ou uma nova aba) pede credenciais de novo.

**Causas prováveis:**

1. Cookie de refresh bloqueado pelo navegador (modo restrito, política de
   cookies de terceiros quebrada, extensão de privacidade);
2. `COOKIE_SECURE=true` com o piloto ainda em HTTP — o navegador descarta o
   cookie `Secure` em origem `http://`;
3. SPA e API em hosts diferentes (ex.: SPA em outro servidor estático): o cookie
   é do host da API e o navegador não o envia no `fetch`.

**Diagnóstico:** DevTools → Application → Cookies. Deve existir `mz_refresh` com
`HttpOnly`, `SameSite=Strict` e `Path=/auth`. O `document.cookie` **não** mostra
esse cookie (é o comportamento correto).

---

## 8. Capacidade e monitoramento (referência)

MVP alvo (plano §8): 500 usuários, pico 100 WS, 50 mil mensagens/dia, 100 GB de
arquivos — 1 processo Uvicorn + Postgres atende; gargalo passa a ser
disco/rede. Monitoramento básico no piloto:

- `GET /health/db` externo (uptime/Nagios/Zabbix) → 503 = agir;
- `GET /admin/stats` (painel) para disco (`disk_free_bytes`) e crescimento;
- backup diário verde (§3.1) + restore ensaiado (§3.3) a cada mudança relevante.
