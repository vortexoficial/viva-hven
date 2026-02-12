# Go-live Checklist — Viva Haven

Data base: 12/02/2026

## 1) Pré-requisitos de ambiente

- [ ] Node.js LTS instalado
- [ ] Firebase CLI instalado (`firebase --version`)
- [ ] Login ativo na CLI (`firebase login:list`)
- [ ] Projeto Firebase correto selecionado (`firebase use`)
- [ ] Arquivo `js/firebase-config.js` configurado para o projeto de produção

## 2) Segurança e dados (obrigatório)

- [ ] Revisar `firestore.rules` e confirmar RBAC por `memberships`
- [ ] Deploy de rules e índices antes do deploy final:
  - [ ] `npm run deploy:rules`
- [ ] Confirmar que não há dados sensíveis em documentos públicos
- [ ] Confirmar que `users/{uid}.role` não é usado como privilégio
- [ ] Validar memberships determinísticos:
  - [ ] condo: `{uid}_{condoId}`
  - [ ] org: `{uid}_org_{orgId}`

## 3) Qualidade de front e rotas

- [ ] Executar auditoria estrutural:
  - [ ] `npm run checkup`
- [ ] Validar páginas críticas no navegador:
  - [ ] Login (`/login.html`)
  - [ ] Perfil (`/perfil.html`)
  - [ ] App do morador (`/app/*`)
  - [ ] Painel admin (`/admin/*`)
- [ ] Validar troca de contexto (condomínio ativo)
- [ ] Validar fluxo offline/online e toasts globais
- [ ] Validar que o tema persiste (`condoflow-theme`)

## 4) Teste com perfis reais (smoke test)

- [ ] Morador
  - [ ] Visualiza avisos/enquetes
  - [ ] Abre e acompanha chamado próprio
  - [ ] Reserva/cancela área comum
- [ ] Gestão (síndico/gestor)
  - [ ] Acessa painéis admin
  - [ ] Gerencia tickets, manutenção e comunicação
  - [ ] Consulta financeiro conforme permissão
- [ ] Organização (administradora/carteira)
  - [ ] Acessa carteira multi-condomínio
  - [ ] Consulta auditoria

## 5) Deploy de produção

- [ ] Deploy completo:
  - [ ] `npm run deploy:prod`
- [ ] Validar domínio `web.app` e `firebaseapp.com`
- [ ] Validar cache e headers no navegador (aba Network):
  - [ ] HTML com `no-cache, no-store, must-revalidate`
  - [ ] Assets com cache curto
  - [ ] Headers de segurança (`nosniff`, `SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`)

## 6) Pós-go-live (primeiras 24h)

- [ ] Monitorar erros de autenticação e permissão
- [ ] Monitorar operações críticas (chamados, reservas, financeiro)
- [ ] Monitorar inconsistências de contexto ativo
- [ ] Coletar feedback de 1 gestor + 1 morador e registrar ajustes

## 7) Comandos úteis

- Emulador de hosting (na raiz do projeto):
  - `npm run emulators:hosting`
- Checkup estrutural:
  - `npm run checkup`
- Deploy de regras/índices:
  - `npm run deploy:rules`
- Deploy de hosting:
  - `npm run deploy:hosting`
- Deploy completo:
  - `npm run deploy:prod`
