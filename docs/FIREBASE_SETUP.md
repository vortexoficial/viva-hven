# Firebase Setup (Viva Haven)

Este projeto é **estático (HTML/CSS/JS)** e não usa bundler. A integração do Firebase aqui é feita com **SDK modular via ESM** usando URLs do `gstatic`.

## 1) Criar projeto no Firebase

1. Acesse o Firebase Console: https://console.firebase.google.com/
2. Clique em **Add project**
3. Defina um nome e conclua o assistente

## 2) Criar um app Web

1. No projeto, vá em **Project settings** (ícone de engrenagem) → **General**
2. Em **Your apps**, clique em **</> (Web)**
3. Registre o app (ex.: `viva-haven-web`)
4. Copie o objeto de configuração (apiKey, authDomain, etc.)

## 3) Configurar `firebase-config.js` (sem commit)

1. Copie o arquivo:
   - de: `/js/firebase-config.example.js`
   - para: `/js/firebase-config.js`
2. Cole o config do seu app Web dentro de `firebaseConfig`.
3. Garanta que **não será commitado** (já está ignorado no `.gitignore`).

## 4) Ativar Authentication (Email/Senha)

1. Firebase Console → **Build** → **Authentication**
2. Aba **Sign-in method**
3. Habilite **Email/Password**

## 5) Criar Firestore

1. Firebase Console → **Build** → **Firestore Database**
2. **Create database**
3. Escolha o modo (para desenvolvimento pode ser “test mode”, mas ajuste as rules depois)
4. Selecione uma região

## 6) Criar Storage

1. Firebase Console → **Build** → **Storage**
2. **Get started**
3. Selecione a região

> Observação: alguns projetos/planos podem exigir upgrade para habilitar o Storage. Se você não for usar upload de arquivos no MVP, pode pular esta etapa.

## 7) Instalar Firebase CLI

Requer Node.js instalado.

- Instalar globalmente:
  - `npm i -g firebase-tools`
- Login:
  - `firebase login`

## 7.1) Definir o projeto padrão (`.firebaserc`)

Na raiz do projeto, edite o arquivo `.firebaserc` e substitua `SEU_FIREBASE_PROJECT_ID` pelo `projectId` do seu Firebase.

Alternativa via CLI:

- `firebase use --add` (seleciona e grava o alias no `.firebaserc`)

## 8) Inicializar Hosting (public root = ./)

Na raiz do projeto (onde está `firebase.json`):

1. `firebase init hosting`
2. Selecione o projeto criado
3. Responda:
   - **Public directory**: `.`
   - **Configure as a single-page app**: `Yes` (mantemos rewrite para `/index.html` como fallback)
   - **Set up automatic builds and deploys with GitHub**: `No` (vamos usar o workflow já incluído)

Depois, para testar local:
- `firebase emulators:start --only hosting`

## 8.1) Deploy completo (Hosting + Rules + Indexes + Storage)

Na raiz do projeto:

- `firebase deploy --only hosting,firestore:rules,firestore:indexes,storage`

Se você **não** habilitou Storage:

- `firebase deploy --only hosting,firestore:rules,firestore:indexes`

## 9) Como usar o init do Firebase no site

O arquivo `/js/firebase-init.js` exporta `initFirebase()`.

Exemplo (em qualquer HTML):

```html
<script type="module">
  import { initFirebase } from '/js/firebase-init.js';
  const { auth, db, storage } = await initFirebase();
  console.log('Firebase ok', { auth, db, storage });
</script>
```

Se você quiser integrar ao login real (Email/Senha), normalmente você usará:
- `signInWithEmailAndPassword(auth, email, password)`

## 10) Deploy no Firebase Hosting via GitHub Actions

1. Gere um token de CI:
   - `firebase login:ci`
2. No GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - `FIREBASE_TOKEN` = token gerado
   - `FIREBASE_PROJECT_ID` = o `projectId` do Firebase
3. Em push na branch `main`, o workflow fará deploy.
