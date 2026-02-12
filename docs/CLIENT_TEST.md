# CLIENT TEST — Viva Haven

Data: 11/02/2026

## Link do app

- Produção (Firebase Hosting): `https://SEU-PROJETO.web.app`
- Alternativo: `https://SEU-PROJETO.firebaseapp.com`
- Local (se estiver rodando via servidor local): `http://localhost:5000`

> Ajuste o link acima conforme o ambiente que vocês vão testar.

## Como instalar por atalho (PWA)

### Android (Chrome)

1) Abra o link do app no Chrome.
2) Toque no menu (⋮).
3) Toque em **Instalar app** ou **Adicionar à tela inicial**.
4) Confirme.

### iPhone/iPad (Safari)

1) Abra o link do app no Safari.
2) Toque no botão de **Compartilhar**.
3) Toque em **Adicionar à Tela de Início**.
4) Confirme.

## Como criar conta

1) Acesse `/register.html`.
2) Preencha nome, e-mail e senha.
3) Finalize o cadastro.

Observações:

- O login aceita **e-mail** ou **CPF** (quando o CPF estiver salvo no perfil e normalizado).
- O auto-cadastro cria usuário com perfil **MORADOR**.
- Para acesso administrativo completo (dados por condomínio/organização), é necessário **provisionar**: (1) `role` em `/users/{uid}` e (2) `memberships` no Firestore.

## Credenciais de testes (sugestão)

Crie estas contas no ambiente de teste (ou use nomes semelhantes). As senhas abaixo são apenas sugestão.

- Admin (organização)
  - E-mail: `admin.teste@exemplo.com`
  - Senha: `Senha@123`
  - Role em `/users/{uid}`: `ADMINISTRADORA` (ou `CARTEIRA`, conforme o cenário) — provisionar via console/rotina administrativa

- Gestor (condomínio)
  - E-mail: `gestor.teste@exemplo.com`
  - Senha: `Senha@123`
  - Role em `/users/{uid}`: `GESTOR` — provisionar via console/rotina administrativa

- Morador
  - E-mail: `morador.teste@exemplo.com`
  - Senha: `Senha@123`
  - Role em `/users/{uid}`: `MORADOR`

## Seed automático de contas (recomendado)

Para criar rapidamente uma conta de cada perfil (MORADOR, GESTOR, SINDICO, CARTEIRA, ADMINISTRADORA) + dados base (`organizations`, `condos` e `memberships`), use o script:

1) Crie uma Service Account no Google Cloud e baixe a chave JSON.
2) No PowerShell, na raiz do projeto:

- `npm i`
- `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\para\service-account.json"`
- `$env:FIREBASE_PROJECT_ID="vivahaven-2906a"`
- `npm run seed`

O script cria as contas com a senha padrão `Senha@123` (ou `SEED_PASSWORD` se você definir).

## Configuração mínima no Firestore (para liberar acesso)

### 1) Condomínio

- Documento: `condos/{condoId}`
  - Campos mínimos: `orgId`, `name`, `status`

### 2) Memberships (regras de acesso)

O app usa documentos determinísticos em `memberships`:

- Escopo **condo**:
  - ID: `{uid}_{condoId}`
  - Exemplo de campos:
    - `uid`: (uid do usuário)
    - `scope`: `condo`
    - `condoId`: (condoId)
    - `orgId`: (orgId do condo, opcional dependendo do padrão do seu modelo)
    - `role`: `morador` | `gestor` | `sindico` | `admin`
    - `status`: `active`

- Escopo **org** (carteira/administradora):
  - ID: `{uid}_org_{orgId}`
  - Exemplo de campos:
    - `uid`: (uid do usuário)
    - `scope`: `org`
    - `orgId`: (orgId)
    - `condoId`: `null`
    - `role`: `carteira` | `administradora` | `admin`
    - `status`: `active`

## Modo DEMO (somente localhost)

Na tela de login existe o botão **Entrar como demo**. Ele aparece somente quando o site está em `localhost`/`127.0.0.1`.

- O modo DEMO **não usa Firebase** (evita backend sensível).
- Ele serve para validar navegação/UI do dashboard sem dados reais.
