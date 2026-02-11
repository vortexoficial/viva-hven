# Estrutura e Rotas do Projeto CondoFlow

Este documento descreve a nova arquitetura proposta para separar as responsabilidades do projeto em: Site Institucional, App do Morador (Mobile-First) e Painel Administrativo (Desktop/Web).

## 1. Estrutura de Pastas Sugerida

A estrutura visa organizar o código existente (estático) e preparar para a lógica dinâmica, mantendo a compatibilidade com o layout atual.

```
/
├── public/                 # Site Institucional (Landing Page)
│   ├── index.html          # (Antigo root/index.html)
│   └── recover.html        # Recuperação de senha
│
├── app/                    # APP do Morador (Mobile View)
│   ├── index.html          # Dashboard/Home do morador
│   ├── perfil.html         # (Antigo root/perfil.html)
│   ├── servicos/           # Módulos: Reservas, Chamados, etc.
│   └── auth/               # Login específico do App
│
├── admin/                  # Painel de Gestão (Web View)
│   ├── dashboard.html      # Visão geral do síndico
│   ├── portaria/           # Interface do porteiro
│   ├── financeiro/         # Gestão de boletos/contas
│   └── cadastros/          # Unidades, Moradores, Veículos
│
├── assets/                 # Imagens, Fontes, Ícones (Compartilhado)
│   ├── img/
│   └── icons.svg
│
├── css/                    # Estilos (Compartilhado & Específico)
│   ├── main.css            # Variáveis globais, reset, tipografia
│   ├── landing.css         # Específico do site
│   ├── app.css             # Estilos mobile-first (App)
│   └── admin.css           # Estilos desktop (Painel)
│
├── js/                     # Lógica (Compartilhado & Específico)
│   ├── core/               # Auth, API Client, Utils
│   ├── app/                # Lógica do App Morador
│   └── admin/              # Lógica do Painel
│
└── login.html              # Gateway de entrada único (Redireciona para App ou Admin)
```

## 2. Mapa de Rotas

### 🌐 Públicas (Site & Auth)
| Rota | Descrição | Arquivo |
|------|-----------|---------|
| `/` | Landing Page Institucional | `/public/index.html` |
| `/login` | Tela de Login Unificada | `/login.html` |
| `/recuperar-senha` | Flow de recuperação | `/public/recover.html` |

### 📱 App do Morador (Contexto Mobile)
*Prefixo: `/app`*

| Rota | Descrição | Funcionalidade |
|------|-----------|----------------|
| `/app/home` | Dashboard | Atalhos, Avisos Recentes, QR Code Acesso |
| `/app/perfil` | Meu Perfil | Dados Pessoais, Configurações (Arquivo atual `perfil.html`) |
| `/app/financeiro` | Financeiro | 2ª Via de Boletos, Nada Consta |
| `/app/chamados` | Service Desk | Abrir chamado, Acompanhar status |
| `/app/reservas` | Áreas Comuns | Agenda, Disponibilidade, Reservar |
| `/app/portaria` | Autorizações | Liberar visitantes, Encomendas |
| `/app/chat` | Comunicação | Chat direto com Adm/Portaria |

### 💻 Painel Administrativo (Contexto Desktop)
*Prefixo: `/admin`*

| Rota | Descrição | Perfis de Acesso |
|------|-----------|------------------|
| `/admin/dashboard` | Visão Geral | Síndico, Admin |
| `/admin/operacional` | Portaria Digital | Porteiro, Zelador |
| `/admin/moradores` | Gestão de Pessoas | Síndico, Admin |
| `/admin/financeiro` | Gestão Financeira | Síndico, Contador |
| `/admin/comunicacao` | Mural & Notificações | Síndico, Admin |

## 3. Estratégia de Autenticação

Para manter a simplicidade inicial sem necessidade de infraestrutura complexa de servidor (SSR), utilizaremos uma abordagem **Client-Side (SPA-like)** com API.

### Fluxo
1.  **Login:** Usuário insere credenciais em `/login.html`.
2.  **API Request:** `POST /api/auth/login`.
3.  **Resposta:** Retorna Token JWT + `role` (user_type: 'resident' | 'admin' | 'doorman').
4.  **Armazenamento:**
    *   **Token Main:** `localStorage.setItem('condoflow_token', token)`
    *   **User Info:** `localStorage.setItem('condoflow_user', JSON.stringify(user))`
    *   **Theme:** `localStorage.getItem('condoflow-theme')` (Já existente)
5.  **Redirecionamento:**
    *   Se `role === 'resident'` -> `window.location.href = '/app/home'`
    *   Se `role === 'admin'` -> `window.location.href = '/admin/dashboard'`

### Segurança (Etapas Futuras)
*   Implementar *Refresh Token* via HttpOnly Cookie para evitar XSS.
*   Adicionar *Route Guard* em JS: Verificar validade do token antes de carregar o conteúdo de qualquer página dentro de `/app` ou `/admin`.

## 4. Próximos Passos (Sugestão de Execução)

1.  Mover `index.html` atual para `/public` (ajustando referências de assets).
2.  Mover `perfil.html` ajustado para `/app/perfil.html`.
3.  Criar estrutura base de `/admin`.
4.  Refatorar CSS para separar o que é "Site" do que é "App".
