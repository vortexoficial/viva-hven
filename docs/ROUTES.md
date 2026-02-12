# Estrutura e Rotas do Projeto (atual)

Este projeto é um **site estático multi-page** hospedado em **Firebase Hosting**, com **Firebase Auth + Firestore** no client (ES Modules).

- Não é SPA.
- Não usa Firebase Storage no MVP (documentos/anexos ficam como **URLs** no Firestore).
- O app é multi-tenant (condomínio/organização) via **contexto ativo**.

## 1. Estrutura de Pastas (real)

Principais diretórios/arquivos:

```
/
├── index.html
├── login.html
├── register.html
├── perfil.html
├── offline.html
├── app/
│   ├── home.html
│   └── assembleias.html
├── admin/
│   ├── dashboard.html
│   ├── condominio.html
│   ├── pessoas.html
│   ├── memberships.html
│   ├── logs.html
│   └── (outras páginas MVP)
├── css/
│   └── styles.css
├── js/
│   ├── firebase-init.js
│   ├── auth.js
│   ├── route-guard.js
│   ├── active-context.js
│   ├── admin-access.js
│   ├── admin-shell.js
│   └── modules/
└── firestore.rules
```

## 2. Mapa de Rotas

### Públicas

| Rota | Arquivo | Observação |
|------|---------|------------|
| `/` | `/index.html` | Landing |
| `/login.html` | `/login.html` | Login Firebase |
| `/register.html` | `/register.html` | Cadastro Firebase |
| `/offline.html` | `/offline.html` | Fallback PWA |

### App do Morador

| Rota | Arquivo | Proteção |
|------|---------|----------|
| `/app/home.html` | `/app/home.html` | `route-guard` + contexto (condo) |
| `/app/boletos.html` | `/app/boletos.html` | `route-guard` + contexto (condo) |
| `/app/chamados.html` | `/app/chamados.html` | `route-guard` + contexto (condo) |
| `/app/reformas.html` | `/app/reformas.html` | `route-guard` + contexto (condo) |
| (módulos) | `/js/modules/*` | Consultas/CRUD por `condoId` |

### Painel Administrativo

Perfis alvo: **ADMINISTRADORA / GESTOR / SINDICO** (com permissões).

| Rota | Arquivo | Proteção (UX) |
|------|---------|---------------|
| `/admin/dashboard.html` | `/admin/dashboard.html` | `setupAdminPage()` |
| `/admin/condominio.html` | `/admin/condominio.html` | `setupAdminPage({ permsAny: ['condo.manage', ...] })` |
| `/admin/pessoas.html` | `/admin/pessoas.html` | `setupAdminPage({ permsAny: ['people.manage', ...] })` |
| `/admin/memberships.html` | `/admin/memberships.html` | `setupAdminPage({ permsAny: ['people.manage', ...] })` |
| `/admin/logs.html` | `/admin/logs.html` | `setupAdminPage({ permsAny: ['audit.read', ...] })` |
| `/admin/financeiro.html` | `/admin/financeiro.html` | `route-guard` (roles) + `finance.*` nas Rules |
| `/admin/manutencao.html` | `/admin/manutencao.html` | `route-guard` (roles) + `maintenance.*`/`tickets.*` nas Rules |
| `/admin/obras.html` | `/admin/obras.html` | `route-guard` (roles) + `maintenance.manage` nas Rules |
| `/admin/seguranca.html` | `/admin/seguranca.html` | `route-guard` (roles) + `security.*`/`occurrences.manage` nas Rules |

Observação: a **segurança real** é aplicada pelas **Firestorm Rules**; o guard no client é para UX.

## 3. Autenticação, Contexto e RBAC

### Autenticação

- Firebase Auth (email/senha).
- As páginas protegidas usam `route-guard`/`admin-access` para aguardar sessão.

### Contexto ativo (condo/org)

- O usuário escolhe um condomínio/organização e isso vira o **contexto ativo**.
- O contexto é propagado via `localStorage` e evento `vh:context`.
- Coleções seguem o padrão: `condos/{activeCondoId}/...`.

### RBAC por memberships (Firestore)

- Membership de condomínio (determinístico): `memberships/{uid}_{condoId}`
- Espelho (para listagem no admin): `condos/{condoId}/memberships/{uid}`
- Campos típicos: `role`, `permissions[]`, `status`, `unitId`/`unitLabel`.

Regras importantes:

- `users/{uid}.role` é legado/compat e **não concede privilégio**.
- Sem escalonamento: escrita de memberships deve ser restrita pelas Rules (e, em produção, idealmente por processo controlado).

## 4. Navegação padrão do Admin

- O menu do admin é injetado por `/js/admin-shell.js` em todas as páginas em `/admin`.
- O shell inclui links para: Dashboard, Condomínio, Pessoas, Manutenção, Obras, Segurança, Financeiro, Memberships e Logs.
