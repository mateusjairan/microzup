# E2E do cliente web

Playwright contra o **build real** (`web/dist`) servido pelo **backend real**
(`uv run python -m app.run`, porta 8666) e o Postgres de dev. Não há shell
nativo, janela Electron nem diálogo de sistema.

## Como rodar

```powershell
# a partir de web/
npm run test:e2e     # compila (vite build) e roda a suíte
npx playwright test  # usa o dist existente
```

Requisitos: Postgres de dev no ar e `server/` sincronizado (`uv sync`). O
`globalSetup` sobe o backend, cria as fixtures idempotentes (`e2eadmin`,
`e2e.alice`, `e2e.bruno`, setor "E2E Qualidade") e falha explicitamente se algo
não subir — a suíte nunca "passa" sem servidor.

## O que a suíte cobre

| Spec | Foco |
|---|---|
| `login.spec.ts` | login sem campo de servidor, erro do envelope, sessão preservada por cookie `HttpOnly` |
| `upload.spec.ts` | upload de 50 MB com progresso + download íntegro (SHA-256) via Blob |
| `send-retry.spec.ts` | envio otimista, falha e retry com o mesmo `client_id` |
| `scroll.spec.ts` | aderência ao fim e pill de novas mensagens |
| `reconnect.spec.ts` | reconexão e catch-up por `seq` (mata/religa o backend) |
| `presence.spec.ts` | presença entre duas sessões (dois contextos isolados) |
| `shortcuts.spec.ts` | atalhos de teclado |
| `axe.spec.ts` | acessibilidade (zero violação séria) |
| `day-divider.spec.ts` | divisores Hoje/Ontem |

## Isolamento

Cada `launchApp()` cria um **contexto Chromium** próprio (cookies e storage
separados), equivalente às janelas Electron antigas. `closeApp(context)` fecha o
contexto. O navegador compartilhado da suíte é encerrado no `globalTeardown`.

## Diagnóstico

- Log do backend: `e2e/.tmp/backend.log` (preservado em `.results/` ao final).
- Falha de login por rate limit (10/min por IP) é esperada em rajadas: a suíte
  aguarda a janela em vez de falhar.
- Baselines de regressão visual do Electron foram removidos junto com o shell;
  a regressão visual será regerada no navegador.
