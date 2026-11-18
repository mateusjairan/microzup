# Microzup — Plano de front-end (desktop)

> Interface "MSN moderno" para uso corporativo farmacêutico — v1.0
> Complementa `docs/plano-mvp.md`. Alvo: Electron + React 19 + TypeScript, Windows 10/11.

---

## 1. Posicionamento

O MSN funcionava porque era **lista de contatos + presença + conversa imediata**, com personalidade. O que não funciona hoje é o excesso: janelas por todo lado, emoticons animados, nudge abusivo, fontes coloridas, status infantis.

**Diretriz:** recuperar a *sensação* (quem está online, quem está em qual setor, conversa rápida e leve) com a *disciplina* de uma ferramenta de trabalho — densa, silenciosa, previsível, auditável e acessível.

Adjetivos-guia: **profissional, silencioso, denso, rápido, teclado-primeiro**.

---

## 2. Princípios de design

1. **Presença é a espinha dorsal.** Status, setor e disponibilidade são visíveis sem abrir nada. É o "buddy list" repensado.
2. **Uma janela, três painéis.** Nada de 12 janelas soltas; a janela de conversa pode ser destacada sob demanda.
3. **Silêncio por padrão.** Sem som, sem animação chamativa, sem badge piscando. O usuário escolhe o que o interrompe.
4. **Informação > decoração.** Sem gradientes brilhantes, sem skeuomorfismo, sem mascotes. Uma cor de destaque só.
5. **Densidade com respiro.** 32 px por linha de contato, 14 px de corpo, agrupamento de mensagens para reduzir ruído.
6. **Teclado-primeiro.** Toda ação tem atalho; o mouse é opcional.
7. **Honestidade de estado.** Enviando, enviado, falhou, reconectando — sempre explícito, nunca "sumiu".
8. **Acessível por construção.** WCAG 2.1 AA, foco visível, presença nunca só por cor, respeita `prefers-reduced-motion`.

---

## 3. O que fica do MSN, o que morre

| MSN | Microzup | Racional |
|---|---|---|
| Lista de contatos com grupos | Sidebar com **setores** colapsáveis + conversas recentes | Mesma hierarquia mental, agora organizacional |
| Status (Online/Ocupado/Ausente/Invisível) | **Disponível / Ocupado / Ausente / Não perturbe / Invisível** + auto-ausente por inatividade | Direto do original, com DND que silencia de verdade |
| "Recado" (personal message) | **Recado de status** (120 chars, expira em 8 h) — "Em auditoria até 14h" | Contexto útil em fábrica/QA; sem frases de adolescente |
| Foto de perfil | Foto 256 px + fallback de iniciais com cor determinística | Mantém identidade visual, sem avatar animado |
| Janelas separadas por conversa | **Painel dividido** + "Abrir em janela" por conversa | MSN feel sem caos de janelas |
| Nudge (vibração) | **"Chamar atenção"**: 1×/5 min por conversa, flash na barra de tarefas + toast, nunca shake em `reduced-motion` | Mantém o gesto, remove o assédio |
| Emoticons animados | **48 emoticons estáticos curados** | Profissional e previsível |
| Sons icônicos | 2 sons discretos (mensagem, chamar atenção), **desligados por padrão** | Farmácia/escritório: silêncio é regra |
| Fontes coloridas / winks | Não existem | Ruído sem valor |
| "Fulano está digitando…" | Mantido, com throttle de 3 s | Custa pouco, ajuda muito |
| Bloquear contato | **Silenciar conversa** (+ admin pode desativar usuário) | Bloqueio social não é caso corporativo |

---

## 4. Arquitetura de informação

```
Microzup
├─ Login / conexão ao servidor
└─ Janela principal
   ├─ Barra de título (custom, 44 px): busca global · status · configurações
   ├─ Sidebar (280 px; 72 px colapsada)
   │  ├─ Meu cartão: foto, nome, status, recado
   │  ├─ Busca rápida (Ctrl+K)
   │  ├─ Setores (canais) — colapsável, com não-lidas
   │  ├─ Conversas diretas — ordenadas por atividade
   │  ├─ Equipe — colegas ativos com presença; clique abre a DM
   │  └─ Rodapé: estado da conexão
   ├─ Conversa (flex)
   │  ├─ Cabeçalho: nome, participantes online, silenciar, detalhes
   │  ├─ Lista de mensagens (virtualizada)
   │  └─ Composer: anexo, emoji, texto, enviar
   └─ Painel de detalhes (260 px, opcional)
      ├─ Membros com presença
      └─ Arquivos compartilhados
```

### Wireframe — janela principal (1200 × 780 mínimo 1024 × 680)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Microzup   ⌕ Buscar pessoas, setores, mensagens…        ▾ Disponível   ⚙  ─ □ ✕ │
├────────────────┬─────────────────────────────────────────────┬────────────────┤
│ (AS) Ana Souza │ # Qualidade e Assuntos Regulatórios         │ Detalhes    ✕  │
│ ● Disponível   │ 12 membros · 3 online · silenciado          │                │
│ "Em auditoria  │─────────────────────────────────────────────│ MEMBROS     6  │
│  até 14h"      │  ── Hoje ──                                 │ ● Ana Souza    │
├────────────────│  (AS) Ana Souza                    09:41    │ ● Bruno Lima   │
│ SETORES     3▾ │  Segue o desvio 045 em anexo.               │ ○ Carla Dias   │
│ # Qualidade  3 │  ┌───────────────────────────────────────┐  │ ○ Diego Reis   │
│ # Produção   5 │  │ 📄 desvio-045.pdf            2,1 MB  │  │                │
│ # Almoxarif. 1 │  └───────────────────────────────────────┘  │ ARQUIVOS   12  │
│                │                                             │ 📄 desvio-045  │
│ CONVERSAS    ▾ │  (BL) Bruno Lima                   09:43    │ 🖼 lote-22.png │
│ ● Ana Souza  2 │  Recebido. Vou conferir com o QA.           │ 📊 lote-22.xlsx│
│ ● Bruno Lima   │                                             │                │
│ ○ Carla Dias   │  Ana está digitando…                        │                │
│                │                                             │                │
│ + Nova conversa│                                             │                │
├────────────────┴─────────────────────────────────────────────┴────────────────┤
│  📎   😊   Escreva uma mensagem…                              Enter envia  ⏎    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe — login / primeira execução

```
┌──────────────────────────────────────────────┐
│                                              │
│   Microzup                                   │
│   Chat interno · rede local                  │
│                                              │
│   Servidor  [ 192.168.0.10:8666        ] ⟳   │
│   Usuário   [ ana.souza                ]     │
│   Senha     [ ••••••••••••             ] 👁  │
│                                              │
│   [ ] Manter conectado neste computador      │
│                                              │
│                    [ Entrar ]                │
│                                              │
│   Não conecta? Confirme o endereço com o TI. │
└──────────────────────────────────────────────┘
```

O campo **Servidor** é obrigatório no desktop (não há descoberta automática no MVP), com botão "testar conexão" que bate em `/health` antes de habilitar o login.

### Sidebar colapsada (72 px)

```
┌──────┐
│ (AS) │  avatar + dot
│  #   │  setor ativo
│  ●   │  Ana
│  ●   │  Bruno   ← badge numérico no canto
│  +   │
└──────┘
```

---

## 5. Telas e estados

| Tela | Conteúdo | Estados obrigatórios |
|---|---|---|
| **Conexão/login** | servidor, usuário, senha, manter conectado | carregando, credencial inválida, servidor inacessível, bloqueado por tentativas |
| **Shell principal** | sidebar + conversa + detalhes | carregando (skeleton), offline (banner), vazio ("escolha uma conversa") |
| **Conversa** | histórico, composer | sem mensagens, histórico carregando, novas mensagens ↓, falha de envio, reconectando |
| **Busca (Ctrl+K)** | palette com 3 grupos: conversas, pessoas, mensagens | vazio, sem resultado, carregando, erro |
| **Detalhes** | membros, arquivos | lista vazia, carregando, arquivo indisponível |
| **Visualizador de imagem** | lightbox com download | carregando, falha |
| **Configurações** | perfil, notificações, aparência, conexão, sobre | — |
| **Admin (desktop)** | usuários, setores, auditoria, uso | tabela vazia, erro, confirmação destrutiva |
| **Sessão bloqueada** | overlay após 15 min de inatividade (config) | reautenticar sem perder rascunho |

---

## 6. Design tokens

Tokens em CSS custom properties (`styles/tokens.css`), consumidos pelo Tailwind. Tema segue o SO por padrão, com troca manual.

### Cores — light

| Token | Valor | Uso |
|---|---|---|
| `--bg-app` | `#F5F6F8` | fundo da janela |
| `--bg-surface` | `#FFFFFF` | conversa, cards |
| `--bg-sidebar` | `#FBFBFC` | sidebar |
| `--bg-hover` | `#EEF1F5` | hover de linha |
| `--bg-selected` | `#E8F0FE` | conversa ativa |
| `--border` | `#E3E6EA` | divisores |
| `--text` | `#14181F` | texto principal |
| `--text-2` | `#5A6472` | secundário |
| `--text-3` | `#5F6B79` | meta, timestamps |
| `--accent` | `#2563EB` | ações, envio, links |
| `--accent-hover` | `#1D4ED8` | hover |
| `--accent-soft` | `#E8F0FE` | bolha própria |
| `--danger` | `#DC2626` | erro, ocupado |
| `--success` | `#16A34A` | disponível |
| `--success-text` | `#166534` | texto de estado positivo (ex.: chip "Ativo" do admin) |
| `--warning` | `#D97706` | ausente |
| `--dnd` | `#7C3AED` | não perturbe |

> **Nota de acessibilidade:** `--text-3` do tema claro foi ajustado de `#8A94A3` para `#5F6B79` — o valor original rendia ~3,0:1, abaixo do mínimo de 4,5:1 exigido pelo §10 (WCAG 2.1 AA). O novo valor mantém a família cinza-azulada da intenção original ("meta, timestamps") e garante ≥ 4,7:1 sobre **todos** os fundos claros onde o token assenta (`--bg-app` `#F5F6F8`, `--bg-surface` `#FFF`, `--bg-sidebar` `#FBFBFC`, `--bg-hover` `#EEF1F5` e a linha selecionada `--accent-soft` `#E8F0FE` — o pior caso).

> **Nota de acessibilidade (texto de estado):** `--success` `#16A34A` atende à regra de 3:1 apenas como cor **não-texto** (dot de presença); como cor de texto falha em qualquer fundo claro (~3,3:1 sobre branco). Para texto verde (chip "Ativo" do admin) usa-se o token dedicado `--success-text`: `#166534` no tema claro (≥ 6,2:1) e `#4ADE80` no escuro.

### Cores — dark

`--bg-app #0F1319` · `--bg-surface #161B23` · `--bg-sidebar #12171E` · `--bg-hover #1E2530` · `--border #242C38` · `--text #E6EAF0` · `--text-2 #A2ADBD` · `--text-3 #6E7A8C` · `--accent #4F8CFF` · `--accent-soft #1B2A45` · `--success-text #4ADE80` (texto de estado positivo; o `--success` do escuro segue reservado a dot/presença) · presença com os mesmos matizes, +8% de luminosidade.

### Presença (sempre dot + texto/aria, nunca só cor)

| Status | Cor | Comportamento |
|---|---|---|
| Disponível | `#16A34A` | recebe notificação |
| Ocupado | `#DC2626` | recebe, som off |
| Ausente | `#D97706` | auto após 10 min de inatividade |
| Não perturbe | `#7C3AED` | sem toast, sem som; badge só |
| Invisível | `#94A3B8` | aparece offline; continua recebendo |

### Tipografia

- **Inter Variable** (empacotada, `woff2`, ~100 KB) + fallback `Segoe UI`.
- Escala: 12 (meta) · 13 (linhas de lista) · 14 (corpo/mensagem) · 16 (título de painel) · 20 (título de tela) · 24 (login).
- Altura de linha 1.45 no corpo, 1.3 em títulos. Números tabulares em horários e tamanhos de arquivo.

### Espaço, raio, elevação, movimento

- Espaço: 4 · 8 · 12 · 16 · 24 · 32.
- Raio: 6 (chips) · 10 (cards) · 12 (janela) · full (avatares).
- Elevação: 3 níveis apenas (`0 1px 2px`, `0 6px 20px`, `0 16px 48px`).
- Movimento: 120 ms (hover) · 180 ms (painéis) · 240 ms (modal); `ease-out`. Com `prefers-reduced-motion`, tudo vira corte seco.

---

## 7. Biblioteca de componentes

`components/ui` (genéricos) e `components/chat` (domínio).

| Componente | Variações / estados |
|---|---|
| `Avatar` | foto, iniciais, tamanhos 20/24/32/40, presença embutida |
| `PresenceDot` | 5 status, com anel de contraste |
| `StatusSelector` | dropdown com recado, expiração, "invisível" |
| `SidebarGroup` | colapsado/expandido, contador, seta |
| `ContactRow` | 32 px, selecionado, não-lido, digitando, silenciado |
| `UnreadBadge` | 1–99, `99+` |
| `ConversationHeader` | canal / DM, presença agregada, ações |
| `MessageList` | virtualizada, agrupada por autor (5 min) e dia |
| `MessageBubble` | recebida, própria, agrupada, editada, apagada, falhou |
| `DayDivider` | Hoje, Ontem, data completa |
| `UnreadDivider` | "novas mensagens" |
| `TypingIndicator` | 1–3 pessoas, animação de 3 pontos |
| `Composer` | texto, anexo, emoji, arrastar-e-soltar, estado de envio |
| `FileCard` | ícone por tipo, nome, tamanho, progresso, falha, download |
| `ImageMessage` | thumbnail 480 px, lightbox |
| `AttachmentTray` | uploads pendentes antes de enviar |
| `SearchField` / `CommandPalette` | teclado, grupos, destaque de trecho |
| `ReconnectBanner` | tentativa n/∞, "tentar agora" |
| `Toast` | info, sucesso, erro, ação |
| `Modal` / `Dropdown` / `Tooltip` | Radix, foco preso, Esc fecha |
| `EmptyState` | ícone, frase, ação |
| `Skeleton` | lista, mensagem, detalhes |
| `NudgeOverlay` | flash sutil + toast, respeita reduced-motion |

---

## 8. Especificação de interação

### 8.1 Envio e ciclo de vida da mensagem

| Estado | Visual | Regra |
|---|---|---|
| `sending` | bolha a 60% + relógio | render otimista local |
| `sent` | bolha cheia | `message.created` com `seq`, reconcilia por `client_id` |
| `failed` | bolha + ícone de erro + "Reenviar" | sem internet ou 5xx; fila local persiste no disco |
| `edited` | marca "editada" | tooltip com data da edição |
| `deleted` | "Mensagem removida" | autoria preservada em auditoria |

Retry é sempre idempotente (`client_id`); o usuário nunca vê duplicata.

### 8.2 Scroll e leitura

- Se o usuário está a **< 120 px do fim**, novas mensagens mantêm o scroll colado.
- Fora disso, mostra pill **"3 novas mensagens ↓"** em vez de puxar o scroll.
- Abrir a conversa posiciona na **primeira não lida**, com divisor visível.
- Marca como lida após 1 s com a janela focada; ao desfocar, congela.
- Paginação para trás preserva a posição (âncora por `seq`), sem "pulo".

### 8.3 Presença e status

- Coração de presença a cada 30 s via WS; queda → `offline` em 60 s.
- Auto-ausente com `powerMonitor.getSystemIdleTime() ≥ 10 min`; volta a `Disponível` ao interagir.
- Recado expira em 8 h ou ao ser limpo; aparece em tooltip e no cabeçalho da conversa.
- `Não perturbe` suprime toast e som, inclusive de "chamar atenção".

### 8.4 "Chamar atenção" (nudge)

- Ícone de sino ao lado do anexo; **1 por conversa a cada 5 min**.
- Efeito: `flashFrame` na taskbar + toast "Ana chamou sua atenção"; sem tremer a janela.
- Bloqueado em `Não perturbe` e se o remetente estiver silenciado. Registrado em auditoria.

### 8.5 Notificações

| Situação | Toast | Som | Badge |
|---|---|---|---|
| Janela focada na conversa | não | não | limpa |
| Janela em outra conversa | sim (agrupado por conversa) | opcional | sim |
| Janela minimizada / bandeja | sim | opcional | sim + overlay na taskbar |
| `Não perturbe` | não | não | sim |
| Arquivo recebido | sim | opcional | sim |
| Reconexão | banner, não toast | não | — |

Clique no toast abre a conversa e marca lida. Máx. 3 toasts por minuto (agrupa o resto).

### 8.6 Arquivos

- Drag-and-drop na janela inteira + colar do clipboard + botão.
- Até 5 anexos por mensagem, 100 MB cada (limite do servidor exibido no erro).
- Card com progresso por arquivo, cancelar, remover antes de enviar.
- Imagem: thumbnail + lightbox (zoom, anterior/próxima, baixar, Esc).
- Download mostra progresso no card; arquivo aberto direto do disco após salvar.
- Extensão bloqueada: erro inline claro antes de subir (validação no cliente + servidor).

### 8.7 Busca

`Ctrl+K` abre palette sobre a interface:
1. **Conversas** e **pessoas** (filtro instantâneo local, < 50 ms);
2. **Mensagens** (debounce 300 ms → `/search`), com trecho destacado e remetente;
3. Enter abre; ↑/↓ navega; Esc fecha e devolve o foco ao composer.

Resultado de mensagem abre a conversa na posição da mensagem com destaque de 2 s.

---

## 9. Estados de borda (não opcionais)

| Situação | Tratamento |
|---|---|
| Sem conexão | banner persistente, mensagens entram em fila local, composer continua ativo |
| Servidor reiniciando | banner "reconectando (1/∞)" com backoff 1-2-4-8-15 s |
| Token expirado | refresh silencioso; se falhar, overlay "sessão expirada" sem perder rascunho |
| Conversa arquivada | somente leitura, composer desabilitado com explicação |
| Usuário desativado | contato cinza "inativo", DM bloqueada |
| Arquivo removido | card "arquivo indisponível" |
| Mensagem muito longa | limite 8.000 chars, contador a partir de 7.500 |
| Lista com 20 mil mensagens | virtualização, sem travar |
| Primeira execução | tela de servidor, sem tentar localhost silenciosamente |

---

## 10. Teclado e acessibilidade

### Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+K` | busca global |
| `Ctrl+N` | nova conversa direta |
| `Alt+↑ / ↓` | conversa anterior / próxima |
| `Ctrl+Shift+A` | marcar tudo como lido |
| `Enter` | enviar · `Shift+Enter` quebra linha |
| `Ctrl+O` | anexar arquivo |
| `Ctrl+F` | buscar dentro da conversa |
| `Ctrl+Shift+M` | silenciar conversa |
| `Ctrl+,` | configurações |
| `Ctrl+Shift+L` | bloquear sessão |
| `Esc` | fecha painel / lightbox / palette |
| `↑` no composer vazio | editar última mensagem enviada |

### Requisitos

- Foco visível de 2 px em tudo; ordem de tabulação lógica; sem armadilha de foco fora de modal.
- `aria-live="polite"` anuncia "Ana Souza: texto" quando a conversa não está focada; sem leitura duplicada.
- Presença comunicada por `aria-label` ("Disponível", "Não perturbe").
- Contraste ≥ 4,5:1 (texto) e ≥ 3:1 (ícones/limites).
- Áreas clicáveis ≥ 32 px no desktop, 44 px no build web/touch.
- Lista de mensagens navegável por teclado, sem roubar o foco do composer ao chegar mensagem nova.
- `prefers-reduced-motion` desliga typing dots, flash e transições de painel.
- Zoom do sistema até 200% sem quebra de layout.

---

## 11. Performance

| Métrica | Meta |
|---|---|
| Bundle do renderer (gz) | ≤ 350 KB |
| Primeira pintura | ≤ 800 ms |
| Interativo (janela utilizável) | ≤ 1,5 s |
| Inserir mensagem recebida | ≤ 50 ms |
| Scroll com 20 mil mensagens | 60 fps estáveis |
| Memória com 5 conversas abertas | ≤ 300 MB |
| Uso de CPU em idle | < 1% |

Táticas: virtualização (`react-virtuoso`), imagens lazy + thumbnail no servidor, cache em memória por conversa (LRU de 5), debounce de resize, `content-visibility` desnecessário com virtualização, sem bibliotecas de UI pesadas, ícones `lucide-react` tree-shaken, fonte única variável.

---

## 12. Stack e organização do código

- React 19 + TypeScript estrito + Vite
- Tailwind CSS 4 com tokens em CSS vars; Radix para primitivas (dialog, dropdown, tooltip, popover)
- **Zustand** com store normalizado (`messagesByConversation`, `entities`) — fonte única de verdade; eventos WS mutam o store
- REST apenas para bootstrap, paginação e backfill; sem cache duplicado (nada de TanStack Query junto do store no MVP)
- Cliente WS com reconexão, heartbeat e detecção de lacuna de `seq` → refetch automático
- `openapi-typescript` gera tipos do contrato; nenhum tipo de API escrito à mão
- `date-fns` com locale `pt-BR` (Hoje/Ontem, 24 h)

```
desktop/src/
├─ app/            # boot, router, providers
├─ features/
│  ├─ auth/        # login, conexão, sessão
│  ├─ presence/    # status, recado, idle
│  ├─ conversations/
│  ├─ messages/    # lista, bolhas, composer, envio otimista
│  ├─ files/       # upload, cards, lightbox
│  ├─ search/
│  ├─ settings/
│  └─ admin/       # painel administrativo (role admin)
├─ components/
│  ├─ ui/          # Avatar, Button, Dialog, Toast…
│  └─ chat/        # ContactRow, MessageList, Composer…
├─ lib/            # api, ws, keyboard, format, storage
├─ styles/         # tokens.css, tailwind.css
└─ i18n/           # pt-BR.ts (única língua no MVP)
```

---

## 13. Casca Electron

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, preload com allowlist de IPC.
- CSP sem origem remota; navegação externa bloqueada (links abrem no navegador padrão após confirmação).
- Barra de título customizada com `-webkit-app-region: drag`; botões nativos de minimizar/maximizar/fechar.
- Bandeja: ícone com badge, menu (Abrir, Status, Sair), fechar minimiza para a bandeja (configurável).
- Instância única; deep link `microzup://conversation/<id>` (fase 2).
- Refresh token em `safeStorage` (DPAPI), nunca em `localStorage`.
- Toast nativo via `Notification` com ação "Abrir"; respeita Assistente de Foco do Windows.
- Tela de bloqueio após inatividade configurável (padrão 15 min) — reautentica sem descartar rascunho.
- Atualização: verificação de versão no servidor + instalador disponibilizado em share; banner "nova versão disponível" (sem auto-update silencioso no MVP).

---

## 14. Testes e qualidade visual

- **Playwright** com screenshots de 1024×680, 1280×800 e 1440×900 (light e dark) como baseline de regressão visual.
- **axe-core** em todas as telas (zero violações sérias).
- Testes de interação: envio otimista + falha + retry; scroll com novas mensagens; reconexão; upload de 50 MB; atalhos.
- **Storybook** offline para os 20 componentes principais (estados vazios/erro incluídos).
- Checklist manual de teclado e leitor de tela (NVDA) antes do piloto.

---

## 15. Roadmap de front-end

| Etapa | Entrega | Estimativa |
|---|---|---|
| **F0 — Fundação visual** | tokens, tema claro/escuro, shell (titlebar, 3 painéis), componentes base, Storybook | 2 d |
| **F1 — Identidade e presença** | conexão/login, perfil, status + recado, auto-ausente, sidebar com setores | 2 d |
| **F2 — Conversa** | lista virtualizada, agrupamento, bolhas, composer, envio otimista, não lidas, scroll | 3 d |
| **F3 — Arquivos** | drag-drop, colar, progresso, cards, imagens/lightbox | 2 d |
| **F4 — Tempo real e avisos** | WS + reconexão, typing, presença ao vivo, toasts, bandeja, badge, "chamar atenção" | 2 d |
| **F5 — Busca e detalhes** | palette Ctrl+K, busca de mensagens, painel de membros/arquivos | 1,5 d |
| **F6 — Polimento** | estados de borda, a11y, atalhos, regressão visual, bloqueio de sessão, instalador | 2,5 d |

**~15 dias** de front-end. Sobrepondo F0–F2 com M2/M3 do backend (contrato OpenAPI + mocks MSW), o cronograma total do MVP fica em **~24–30 dias** — M4 concentra F4–F6 e o empacotamento.

---

## 16. Anti-escopo (para não virar brinquedo)

- GIFs, stickers, figurinhas, emoticons animados, temas coloridos.
- "Nudge" irrestrito, shake de janela, som de buzina.
- Gamificação (streaks, badges, rankings de mensagens).
- Status com música/atividade automática ("ouvindo Spotify").
- Reações, threads, enquetes no MVP.
- Markdown rico: apenas texto, links e emoji estático. (Negrito/itálico em fase 2, se pedido.)
- Recibos de leitura obrigatórios — em DM, opcionais e desligados por padrão no piloto.
- Auto-update silencioso (em ambiente validado, atualização é evento controlado).

---

## 17. Perguntas em aberto

1. Tema padrão no piloto: seguir o Windows ou fixar claro? (recomendo seguir o SO)
2. "Chamar atenção" fica habilitado no piloto ou só após avaliação de uso?
3. Foto de perfil é obrigatória (RH fornece) ou iniciais são aceitáveis?
4. Bloqueio de sessão por inatividade: 15 min é aceitável para os setores?
5. Marca: manter nome "Microzup" e paleta azul, ou há identidade visual da empresa a aplicar?
6. Densidade padrão: confortável (40 px) ou compacta (32 px)? (recomendo compacta para quem usa o dia todo)
