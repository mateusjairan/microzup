# Suíte E2E do cliente desktop (plano-frontend §14)

Playwright contra o **Electron real** (`_electron`) e o **backend real**
(FastAPI + Postgres 17 do container `microzup-db`, porta 55432). Nada de mock.

## Como rodar

```powershell
# a partir de desktop/ (o Chromium do Playwright já está baixado)
npm run build                 # gera dist/ + electron/dist/
npm run test:e2e              # suíte completa (backend sobe/desce sozinho)
```

Requisitos de ambiente:

- container `microzup-db` no ar (healthy) na 55432 — `docker compose -f
  server/docker-compose.yml up -d` antes da suíte;
- porta 8666 livre (a suíte falha explicitamente se estiver ocupada — ela
  nunca reutiliza um backend que não subiu ela mesma);
- `uv` disponível no PATH (backend é spawnado como `uv run python -m app.run`
  a partir de `server/`, com log em `e2e/.tmp/backend.log`).

Baseline visual (primeira geração / regeneração):

```powershell
npx playwright test visual --update-snapshots
```

Os PNGs ficam em `e2e/visual.spec.ts-snapshots/` (5 telas × 3 resoluções
1024×680/1280×800/1440×900 × tema claro/escuro = 30 imagens). As telas
espelham o banco de dev (diretório de usuários, canais) — após mudanças de
dados ou de tokens visuais, regenere a baseline.

## Fixtures (idempotentes, criadas no globalSetup)

| Usuário | Papel | Origem |
|---|---|---|
| `e2eadmin` | admin | CLI `create-admin` (senha via stdin) |
| `e2e.alice` / `e2e.bruno` | member | `POST /admin/users` no setor "E2E Qualidade" |

Senha de fixture (dev DB, não é segredo do produto): `Microzup-E2E-2026`.
Rodadas seguintes: 409 `user_already_exists` → reset de senha pelo admin.
O banco de dev NÃO é limpo por esta suíte (sem DELETEs; fixtures ficam).

## Decisões de ambiente (por que o launch é como é)

1. **Electron real, não browser.** A casca (IPC `window.microzup`,
   safeStorage/DPAPI, bandeja, bloqueio de sessão, diálogo de salvar) só
   existe no app de verdade; o renderer também é o `dist/` de produção.
2. **`ELECTRON_RUN_AS_NODE` é removido do env do launch.** O host desta
   sessão define `ELECTRON_RUN_AS_NODE=1` para os filhos e o Electron checa a
   *presença* da variável — sem isso o main.js morre em
   `app.requestSingleInstanceLock` (Electron rodando como Node puro).
3. **`--user-data-dir` dentro do workspace.** Nesta máquina o binário
   electron.exe recebe EPERM para gravar sob `%APPDATA%`/`%TEMP%`
   (restrição por reputação de binário que não afeta node.exe/pwsh), então o
   userData é redirecionado para `e2e/.tmp/` — onde a gravação funciona e
   cada teste ganha um perfil limpo (primeira execução de verdade).
   Bônus: o lock de instância única é por user-data-dir, então duas janelas
   coexistem na spec de presença.
4. **`--no-sandbox`.** O sandbox do Chromium quebra nesta máquina
   (STATUS_BREAKPOINT nos processos filhos — mesma restrição de gravação
   atingindo o broker). Sem a flag o app não sobe; com ela, o webPreferences
   `sandbox: true` do app fica desligado apenas nos testes. Documentado no
   relatório da task-7.
5. **workers=1.** Uma janela Electron por vez (foco de janela real, backend
   compartilhado, specs que matam/religam o servidor).

## Peculiaridades de fluxo

- **`message-flags` roda sem Electron:** valida em Node puro a lógica de divisor
  de dia / agrupamento por autor (`src/features/messages/itemFlags.ts`) — é a
  spec mais rápida da suíte e trava a regressão do "Hoje" repetido entre
  mensagens do mesmo dia; `day-divider` cobre o mesmo requisito na UI real
  (exatamente um divisor por dia).
- **Resiliência:** as specs `send-retry` e `reconnect` MATAM o backend no meio
  do teste (taskkill da árvore do PID gravado em `e2e/.tmp/backend.pid`) e o
  religam; o globalTeardown mata o que estiver no ar e apaga os temporários
  (incluindo o arquivo de 50 MB do `upload.spec`).
- **Rate limit de login (10/min por IP no servidor):** o setup emagrecido e o
  cache de token por processo mantêm a suíte abaixo do limite; quando uma
  janela encosta nele, o helper de login detecta o estado "bloqueado por
  tentativas" do app e espera a janela rolar (65 s) em vez de falhar.
- **axe-core:** todas as telas (login, conversa, palette, settings, admin,
  overlays de sessão bloqueada e expirada) rodam com as tags WCAG 2.x A/AA;
  meta ZERO serious/critical. O wrapper `@axe-core/playwright` abre uma
  página auxiliar no contexto (operação que o Electron não suporta), então o
  MESMO motor axe-core roda direto na página via `page.evaluate` (imune ao
  CSP do app) com animações congeladas para o contraste ser determinístico.
- **Overlay de sessão expirada:** a condição (401 em chamada autenticada +
  refresh recusado) é simulada por interceptação de rota — o TTL real do
  access token é 15 min — e a REAUTENTICAÇÃO é real, com rascunho
  preservado (§9). O overlay "bloqueada" (Ctrl+Shift+L) é real via IPC.
- **Upload/download de 50 MB:** o arquivo tem bytes aleatórios e é gerado em
  `e2e/.tmp/`; o throughput é limitado via CDP para o progresso ser
  observável; o diálogo nativo de salvar é substituído por um caminho
  automático via `evaluate()` no processo main (sem alterar o app).
- **Ctrl+O** abre o seletor nativo de arquivos do Windows — modal de SO que o
  Playwright não dirige sem mudar o app; o fluxo de anexar é coberto pelo
  `upload.spec` via `setInputFiles` (mesmo input disparado pelo atalho).
