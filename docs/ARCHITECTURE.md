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
│  └─ core/                   # (novo, futuro) base comum
│     ├─ firebase.js          # init Firebase (Auth/Firestore/Storage)
│     ├─ auth.js              # guard de rota + helpers
│     ├─ roles.js             # mapa de roles e permissões
│     ├─ api.js               # camada de acesso aos dados (Firestore)
│     └─ theme.js             # preserva condoflow-theme
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

## 4) Estratégia Firebase (Auth + Firestore + Storage + Hosting)

### 4.1 Firebase Auth
Uso:
- Login (email/senha) inicialmente.
- Evolução: telefone/OTP e/ou SSO (se necessário).

Como usar no app estático:
- `signInWithEmailAndPassword` no `login.html` (etapa futura)
- Persistência de sessão via SDK do Firebase.

Controle de acesso (roles):
- Usar **Custom Claims** (ex.: `role: "MORADOR"`, `condos: ["condoId1"]`).
- Atribuição de claims via Admin SDK (Cloud Functions) **(não implementar nesta etapa)**.

### 4.2 Firestore
Uso:
- Banco principal do sistema: unidades, moradores, chamados, reservas, comunicados, cobranças.
- Consultas por condomínio e por unidade.

Estratégia de modelagem (mínimo e escalável):
- Multi-tenant por condomínio (um `condoId` por documento) ou coleção raiz por condomínio.

Sugestão de collections (rascunho):
- `condos/{condoId}`
- `condos/{condoId}/units/{unitId}`
- `condos/{condoId}/residents/{residentId}`
- `condos/{condoId}/tickets/{ticketId}`
- `condos/{condoId}/reservations/{reservationId}`
- `condos/{condoId}/notices/{noticeId}`
- `condos/{condoId}/billing/{billingId}`

Indexação:
- Criar índices compostos só quando as queries reais surgirem (evitar over-design).

Regras de segurança (Firestore Rules):
- Baseadas em `request.auth` + custom claims + `condoId`.
- Ex.: morador só lê docs da própria unidade/condomínio.

### 4.3 Storage
Uso:
- Upload de anexos de chamados (fotos), documentos (atas, comunicados), imagens de perfil.

Boas práticas:
- Pastas por condomínio: `condos/{condoId}/...`
- Regras de acesso alinhadas às roles.

### 4.4 Hosting
Uso:
- Hospedar o front estático em Firebase Hosting.

Estratégia simples (sem SPA router):
- Manter páginas por arquivo (`/app/perfil.html`, `/admin/index.html`).
- Criar `firebase.json` com `public` apontando para a pasta do site.

Se no futuro virar “SPA-like”:
- Usar rewrites para servir um `app/index.html` e fazer roteamento client-side.

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

