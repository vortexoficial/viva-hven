# CondoFlow — Site (HTML/CSS/JS) + Express

Site 100% responsivo (mobile/tablet/desktop) para apresentar as funções do **CondoFlow**.

## Requisitos

- Node.js 18+ (recomendado)

## Como rodar

No PowerShell:

```bash
cd app-gestao-condominial-site
npm install
npm run dev
```

Abra:

- http://localhost:3000

Health-check:

- http://localhost:3000/health

## Estrutura

```
/app-gestao-condominial-site
  /public
    index.html
    /assets
      logo.svg
    /css
      styles.css
    /js
      app.js
  server.js
  package.json
  README.md
```

## O que está implementado

- Layout moderno (cards, blur sutil, gradientes discretos) e 100% responsivo
- Loader inicial com progresso e bloqueio de scroll
- Animações ao rolar (IntersectionObserver)
- Barra de progresso de rolagem no topo
- Botão flutuante “Voltar ao topo”
- Menu mobile (hamburger) com backdrop e acessibilidade (aria)
- Toggle de tema (dark mode opcional) com persistência
- Seção de módulos com:
  - Cards por módulo
  - Acordeão por módulo (acessível)
  - Busca que filtra funcionalidades em tempo real
  - Checklist visual (ícone de check por função)
- Formulário com validação no front-end e envio simulado com toast

> Observação: este projeto é um **site estático** servido via Express. Não há backend de negócio do aplicativo.

## Publicar no GitHub Pages

Este repositório está pronto para publicar automaticamente a pasta `public` no GitHub Pages via GitHub Actions.

1. Crie um repositório no GitHub (público, se quiser compartilhar o link).
2. Faça push da branch `main`.
3. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Aguarde o workflow finalizar.

A URL ficará no formato:

- `https://<seu-usuario>.github.io/<nome-do-repo>/`
