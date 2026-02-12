# ARCHITECTURE — Viva Haven (APP + Painel Web com Firebase)

Objetivo: evoluir o projeto atual (HTML/CSS/JS estático) para **APP do Morador** + **Painel Web** (síndico/gestor/admin/carteira) usando **Firebase**, **sem reescrever o layout existente**.

## Princípios (para não quebrar o que já existe)

- **Não reescrever o layout atual**: as páginas existentes continuam válidas como “primeiras telas”.
- **Tema preservado**: manter `localStorage["condoflow-theme"]` e o atributo `data-theme` no `document.documentElement`.
- **Separar contextos**: Landing (institucional), App (morador), Admin (painel) com rotas/pastas claras.
- **Evolução incremental**: migrar por etapas (primeiro organização e roteamento, depois auth, depois dados).

## 1) Estrutura mínima de pastas (estático + Firebase)

Estrutura sugerida para manter simples e escalável:

```
/
├─ index.html                 # Landing (existente)
├─ login.html                 # Login (existente) — porta de entrada
├─ perfil.html                # Tela do morador (existente) — virar /app/perfil
│
├─ app/                       # Rotas do App do Morador (mobile-first)
│  ├─ index.html              # (futuro) Home do morador
│  ├─ perfil.html             # (futuro) mover/espelhar o atual
│  ├─ chamados.html
│  ├─ reservas.html
│  ├─ financeiro.html
│  └─ comunicados.html
│
├─ admin/                     # Rotas do Painel Web (desktop)
│  ├─ index.html              # (futuro) dashboard
│  ├─ moradores.html
│  ├─ unidades.html
│  ├─ portaria.html
│  ├─ chamados.html
│  ├─ comunicados.html
│  ├─ financeiro.html
│  ├─ carteira.html
│  └─ configuracoes.html
│
├─ assets/                    # Imagens, SVGs, fontes, arquivos estáticos
│  ├─ icons.svg
│  ├─ familia.png
│  └─ ...
│
├─ css/                       # CSS compartilhado + específicos
│  ├─ styles.css              # (existente) base atual
│  ├─ app.css                 # (novo, futuro) apenas app
│  └─ admin.css               # (novo, futuro) apenas painel
│
├─ js/
│  ├─ app.js                  # (existente) lógica do site
│  ├─ icons-sprite.js          # (existente)
│  ├─ core-init.js            # (novo) init global (erros/UX) para todas as páginas
│  ├─ firebase.js             # (novo) core Firebase (Auth + Firestore, sem Storage)
│  ├─ firebase-init.js        # (compat) wrapper para não quebrar imports antigos
│  ├─ auth-guard.js           # (novo) proteção de rotas (multi-page)
│  ├─ route-guard.js          # (compat) wrapper para proteção de rotas
│  ├─ rbac.js                 # (novo) helpers de RBAC (memberships determinísticos)
│  ├─ ui.js                   # (novo) toast/loading/handlers globais
│  ├─ forms.js                # (novo) normalização/validação simples
│  └─ router-links.js         # (novo) helpers opcionais de navegação declarativa
│
├─ icons/                     # (opcional) favicons, PWA icons
├─ docs/                      # documentação
│  ├─ ROUTES.md               # mapa inicial de rotas (já existe)
│  └─ ARCHITECTURE.md         # este documento
│
└─ firebase.json              # (futuro) config hosting/rewrites
```

Notas:
- A pasta `/app` e `/admin` podem começar **vazias** e ir recebendo telas conforme o roadmap.
- O projeto permanece **100% estático** no front (sem build) e usa Firebase como backend.

## 2) Mapa de Rotas

### 2.1 Rotas públicas
- `/` → Landing institucional (página atual)
- `/login` → Login unificado (página atual)

### 2.2 APP do Morador (prefixo `/app`)
Rotas focadas em mobile e autoatendimento.

- `/app` → Home do morador (atalhos + status)
- `/app/perfil` → Perfil e preferências (mantém tema e dados)
- `/app/chamados` → Abrir/acompanhamento de chamados
- `/app/reservas` → Reservas de áreas comuns
- `/app/financeiro` → Boletos/2ª via/histórico
- `/app/comunicados` → Mural/avisos/enquetes
- `/app/portaria` → Autorizações de acesso / visitantes (se aplicável)

### 2.3 Painel Web (prefixo `/admin`)
Rotas focadas em desktop e operação.

- `/admin` → Dashboard (KPIs + alertas)
- `/admin/moradores` → Gestão de moradores
- `/admin/unidades` → Gestão de unidades, blocos, vagas
- `/admin/portaria` → Controle de entradas/encomendas
- `/admin/chamados` → Triagem e fluxo de atendimento
- `/admin/comunicados` → Publicações e notificações
- `/admin/financeiro` → Contas, cobranças, exportações
- `/admin/carteira` → Conciliação/repasse/gestão de recebíveis
- `/admin/configuracoes` → Regras do condomínio, permissões, integrações

### 2.4 Regras de acesso (alto nível)
- Rotas `/app/*` exigem sessão válida com role `MORADOR` (ou role superior quando aplicável).
- Rotas `/admin/*` exigem sessão válida com role de painel (SINDICO/GESTOR/ADMINISTRADORA/CARTEIRA/PORTEIRO/CONSELHO) conforme módulo.

## 3) Papéis / Roles (RBAC)

Roles solicitadas:
- **MORADOR**: acesso ao App (perfil, boletos, reservas, chamados, comunicados)
- **SINDICO**: gestão do condomínio (visão macro, comunicados, chamados, aprovações)
- **GESTOR**: operação do dia-a-dia (cadastros, chamados, comunicados)
- **ADMINISTRADORA**: gestão multi-condomínios (financeiro, cadastros, auditoria)
- **CARTEIRA**: foco financeiro (cobrança, conciliação, repasse)
- **PORTEIRO**: portaria digital (acessos, encomendas, autorização)
- **CONSELHO**: leitura/validação (transparência, relatórios, aprovações)

Sugestão RBAC (mínimo viável):
- Modelar permissões por **módulo** (ex.: `financeiro:read`, `financeiro:write`, `chamados:triage`).
- Cada usuário tem `role` principal e uma lista de `permissions` (para exceções pontuais).

## 4) Estratégia Firebase (Auth + Firestore + Hosting)

### 4.1 Firebase Auth
Uso:
- Login (email/senha) inicialmente.
- Evolução: telefone/OTP e/ou SSO (se necessário).

Como usar no app estático:
- `signInWithEmailAndPassword` no `login.html` (etapa futura)
- Persistência de sessão via SDK do Firebase.

Controle de acesso (RBAC):
- **Não usar `users/{uid}.role` como privilégio**.
- Privilégios vêm de `memberships` (IDs determinísticos) + `permissions[]`.
- `memberships` não é editável pelo client (anti-escalonamento); provisionar via Admin SDK/Console.

### 4.2 Firestore
Uso:
- Banco principal do sistema: unidades, moradores, chamados, reservas, comunicados, cobranças.
- Consultas por condomínio e por unidade.

Estratégia de modelagem:
- Multi-tenant por `condos/{condoId}` com subcoleções para entidades do condomínio.
- Organizações em `orgs/{orgId}` (administradoras/gestoras).
- Auditoria imutável em `auditLogs/{logId}` (create-only).

Sugestão de collections (rascunho):
- `orgs/{orgId}`
- `condos/{condoId}`
- `condos/{condoId}/blocks|towers` / `units` / `parking`
- `condos/{condoId}/assets` / `maintenancePlans` / `workOrders`
- `condos/{condoId}/tickets` / `reservations` / `occurrences`
- `condos/{condoId}/notices` / `polls` / `assemblies` (+ `minutes`)
- `condos/{condoId}/billing` / `charges` / `payments` / `budget` / `ledger`
- `users/{uid}` / `memberships/{membershipId}` / `auditLogs/{logId}`

Indexação:
- Criar índices compostos só quando as queries reais surgirem (evitar over-design).

Regras de segurança (Firestore Rules):
- Baseadas em `request.auth` + `memberships` (scope condo/org) + permissões.
- Leituras/escritas sempre escopadas por `condoId`/`orgId`.
- Proteção contra escalonamento: client não pode alterar `memberships`.

### 4.3 Storage (não usado no MVP)
Diretriz do projeto:
- **Não usar Firebase Storage** no MVP.
- Qualquer "upload" deve virar **campo de URL** salvo no Firestore (ex.: `tickets.photos[]`, `attachments[]`, `payments.receipt`, `expenses.attachment`).

### 4.4 Hosting
Uso:
- Hospedar o front estático em Firebase Hosting.

Estratégia simples (sem SPA router):
- Manter páginas por arquivo (`/app/perfil.html`, `/admin/index.html`).
- Criar `firebase.json` com `public` apontando para a pasta do site.

Observação:
- O projeto **não** usa rewrites de SPA; as rotas são por URL/arquivo com `cleanUrls`.

## 5) Preservação do tema (obrigatório)

O tema atual já usa:
- `localStorage["condoflow-theme"]`
- `document.documentElement.setAttribute("data-theme", theme)`

Diretriz:
- **Não mudar a chave** nem o contrato do tema.
- Centralizar a leitura/escrita em um `js/core/theme.js` (etapa futura) para que `index.html`, `login.html`, `/app/*` e `/admin/*` compartilhem o mesmo comportamento.

## 6) Roadmap incremental (sem implementar agora)

1. Criar pastas `/app` e `/admin` e começar a espelhar telas existentes (sem redesign).
2. Adicionar `js/core/firebase.js` e configurar o projeto Firebase.
3. Implementar login com Firebase Auth e redirecionamento por role.
4. Criar guards simples para impedir acesso sem autenticação.
5. Implementar primeiros módulos (Chamados e Comunicados) com Firestore.

