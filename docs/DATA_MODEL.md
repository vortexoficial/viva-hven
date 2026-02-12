# Modelo de Dados (Firestore) — Ecossistema Condominial (multi-tenant)

Este documento descreve um **modelo completo** para o ecossistema de condomínio (App + Admin) e as **convenções necessárias** para as regras de segurança em `firestore.rules`.

Diretrizes:
- **Firebase Hosting multi-page** (HTML/JS estático), sem SPA rewrite.
- **RBAC via `memberships`** (nenhum privilégio vem de `users/{uid}.role`).
- **Sem Firebase Storage**: qualquer anexo é **URL opcional** (campo string ou objeto `{url,name}`), salvo no Firestore.

> Importante: Regras do Firestore não conseguem “procurar membership por campo” de forma segura (ex.: `where(uid==X && condoId==Y)`).
> Por isso usamos **IDs determinísticos** em `memberships` para autorizar com `get()`.

## Visão geral (coleções)

Raiz:
- `orgs/{orgId}` (administradoras/gestoras)
- `condos/{condoId}`
- `users/{uid}`
- `memberships/{membershipId}`

Por condomínio (subcoleções em `condos/{condoId}`):
- `blocks/{blockId}` (ou `towers/{towerId}`)
- `units/{unitId}`
- `parking/{spotId}`
- `auditLogs/{logId}` (create-only)
- `assets/{assetId}`
- `suppliers/{supplierId}`
- `contracts/{contractId}`
- `contracts/{contractId}/adjustments/{adjustmentId}`
- `contracts/{contractId}/evaluations/{evaluationId}`
- `contracts/{contractId}/services/{serviceId}`
- `employees/{employeeId}`
- `employees/{employeeId}/shifts/{shiftId}`
- `employees/{employeeId}/leaves/{leaveId}`
- `employees/{employeeId}/trainings/{trainingId}`
- `employees/{employeeId}/epiChecks/{checkId}`
- `employees/{employeeId}/occurrences/{occurrenceId}`
- `insurancePolicies/{policyId}` (alias compat: `insurances/{insuranceId}`)
- `riskMap/{riskId}` (alias compat: `risks/{riskId}`)
- `incidents/{incidentId}` (sinistros)
- `notices/{noticeId}` (alias compat: `announcements/{id}`)
- `polls/{pollId}` (+ `polls/{pollId}/votes/{uid}`)
- `assemblies/{assemblyId}` (+ `assemblies/{assemblyId}/minutes/{minuteId}`)
- `occurrences/{occurrenceId}`
- `gatebook/{entryId}`
- `visitors/{visitorId}`
- `providers/{providerId}`
- `accessEvents/{eventId}`
- `workOrders/{workOrderId}`
- `maintenancePlans/{planId}`
- `reservations/{reservationId}`
- `tickets/{ticketId}`
- `fines/{fineId}` (e opcional `warnings/{warningId}`)
- `billing/{billingId}` (ciclos/agregados)
- `charges/{chargeId}`
- `payments/{paymentId}`
- `budget/{budgetId}`
- `ledger/{entryId}`

Observações:
- `assemblies/{assemblyId}` (raiz) pode existir como **documento espelho** para hospedar `attendances/votes/minutes` (compat).

## Convenções (obrigatórias para as regras)

### 1) IDs de `memberships` (determinísticos)

Para permitir `exists()`/`get()` no documento correto via regras:

**Membership por condomínio (scope `condo`):**
- `membershipId = "{uid}_{condoId}"`
- Campos obrigatórios:
  - `uid` (string)
  - `orgId` (string)
  - `condoId` (string)
  - `scope = "condo"`
  - `role` (string) — ver “Papéis”
  - `permissions` (array de string, opcional)
  - `status` (string)
  - `createdAt` (timestamp)

**Membership por organização (escopo `org`) — para carteira/admin:**
- `membershipId = "{uid}_org_{orgId}"`
- Campos obrigatórios:
  - `uid` (string)
  - `orgId` (string)
  - `condoId = null`
  - `scope = "org"`
  - `role` (string)
  - `permissions` (array de string, opcional)
  - `status` (string)
  - `createdAt` (timestamp)

### 2) Campo `orgId` em `condos/{condoId}`

Cada condomínio deve ter `orgId` para permitir autorização por organização:
- `condos/{condoId}.orgId = "{orgId}"`

## Papéis e status

### Roles (`memberships.role`)

Papéis (canônicos) solicitados:
- `MORADOR`
- `PORTEIRO`
- `CONSELHO`
- `SUBSINDICO`
- `SINDICO`
- `GESTOR`
- `ADMINISTRADORA`
- `GESTOR_CARTEIRA`

Convenção prática:
- Armazenar em `memberships.role` **normalizado** (ex.: `morador`, `porteiro`, `gestor_carteira`).
- `memberships.permissions[]` é **aditivo** (exceções/poderes extras).

### Status (`memberships.status`)
Sugestão de enum mínimo:
- `active`
- `invited`
- `suspended`

As regras consideram **apenas** `status == "active"` como válido.

## Coleções e campos

## Permissões (strings)

Formato: `modulo.acao`.

Exemplos (conjunto recomendado):
- `condo.read`, `condo.manage`
- `people.read`, `people.manage`
- `finance.read`, `finance.write`, `finance.manage`
- `maintenance.read`, `maintenance.manage`
- `tickets.create`, `tickets.read`, `tickets.manage`
- `reservations.create`, `reservations.read`, `reservations.manage`
- `comms.read`, `comms.manage`
- `assemblies.read`, `assemblies.manage`
- `security.read`, `security.write`, `security.manage`
- `docs.read`, `docs.manage`
- `portfolio.view`, `portfolio.manage`
- `audit.read`

Mapa role → permissões (baseline; `permissions[]` adiciona):
- `MORADOR`: `condo.read`, `comms.read`, `assemblies.read`, `tickets.create`, `tickets.read`, `reservations.create`, `reservations.read`
- `PORTEIRO`: `condo.read`, `security.read`, `security.write`, `occurrences.manage`
- `CONSELHO`: `condo.read`, `finance.read`, `governance.read`, `assemblies.read`, `docs.read`, `audit.read`
- `SUBSINDICO`: `condo.read`, `maintenance.manage`, `tickets.manage`, `comms.manage`, `assemblies.read`
- `SINDICO`: `condo.read`, `condo.manage`, `people.manage`, `finance.read`, `finance.write`, `maintenance.manage`, `tickets.manage`, `comms.manage`, `assemblies.manage`, `security.manage`, `docs.manage`, `audit.read`
- `GESTOR`: `condo.read`, `condo.manage`, `people.manage`, `maintenance.manage`, `tickets.manage`, `comms.manage`, `assemblies.manage`, `security.manage`, `docs.manage`, `finance.read`, `audit.read`
- `ADMINISTRADORA` (org): `portfolio.view`, `portfolio.manage`, `finance.manage`, `people.manage`, `docs.manage`, `audit.read`, `condo.manage`
- `GESTOR_CARTEIRA` (org): `portfolio.view`, `portfolio.manage`, `finance.manage`, `audit.read`, `condo.manage`

> Observação: o Firestore Rules pode conter permissões adicionais/ajustes conforme necessidades reais de produto.

### `orgs/{orgId}`
Documento da organização (administradora/gestora).

Exemplo:
```json
{
  "name": "Admin XPTO",
  "legalName": "Admin XPTO LTDA",
  "cnpj": "00.000.000/0001-00",
  "status": "active",
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

Campos sugeridos:
- `name` (string)
- `status` (string) — ex.: `active`
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Acesso:
- Leitura por usuários com membership **org-scoped** ativa (`scope == "org"`) para este `orgId`.

### `condos/{condoId}`
Documento do condomínio.

Exemplo:
```json
{
  "orgId": "org_123",
  "name": "Condomínio Jardim",
  "address": {
    "street": "Rua A, 123",
    "city": "São Paulo",
    "state": "SP"
  },
  "status": "active",
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

Campos obrigatórios:
- `orgId` (string)

Campos sugeridos:
- `name` (string)
- `status` (string)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Acesso:
- Morador/gestor/síndico/admin: somente se tiver `memberships/{uid}_{condoId}` ativo.
- Carteira/admin: acesso a **todos os condos** da organização se tiver `memberships/{uid}_org_{orgId}` ativo.

### `condos/{condoId}/blocks/{blockId}`
Blocos/torres do condomínio.

Exemplo:
```json
{ "name": "Torre A", "order": 1 }
```

Campos sugeridos:
- `name` (string)
- `order` (number)

Acesso:
- Mesmo critério do `condos/{condoId}`.

### `condos/{condoId}/units/{unitId}`
Unidades (apartamentos/casas).

Exemplo:
```json
{
  "blockId": "A",
  "number": "101",
  "floor": 1,
  "status": "active",
  "owners": ["uid1"],
  "occupants": ["uid2"]
}
```

### `condos/{condoId}/parking/{spotId}`
Vagas.

Exemplo:
```json
{ "label": "V-12", "unitId": "unit_101", "type": "car", "status": "active" }
```

### `condos/{condoId}/assets/{assetId}`
Equipamentos (ex.: bomba, elevador).

Exemplo:
```json
{
  "name": "Bomba d'água",
  "category": "piscina",
  "type": "bomba",
  "location": "Casa de máquinas",
  "manufacturer": "Acme",
  "model": "XPTO-200",
  "serial": "SN-1234",
  "warrantyUntil": "<timestamp>",
  "contractId": "contract_1",
  "notes": "Revisar ruído a cada 3 meses",
  "createdAt": "<timestamp>",
  "createdBy": "uid",
  "updatedAt": "<timestamp>",
  "updatedBy": "uid"
}
```

### `condos/{condoId}/employees/{employeeId}`
Funcionários.

Exemplo:
```json
{ "name": "João", "role": "porteiro", "status": "active", "phone": "+55..." }
```

Subcoleções (cadastro/controle interno):
- `condos/{condoId}/employees/{employeeId}/shifts/{shiftId}` (turnos)
- `condos/{condoId}/employees/{employeeId}/leaves/{leaveId}` (afastamentos/férias)
- `condos/{condoId}/employees/{employeeId}/trainings/{trainingId}` (treinamentos)
- `condos/{condoId}/employees/{employeeId}/epiChecks/{checkId}` (EPI)
- `condos/{condoId}/employees/{employeeId}/occurrences/{occurrenceId}` (ocorrências internas)

### `condos/{condoId}/suppliers/{supplierId}`
Fornecedores.

Exemplo:
```json
{ "name": "Empresa XYZ", "category": "limpeza", "status": "active", "contacts": [{"name":"Fulano","phone":"+55..."}] }
```

### `condos/{condoId}/contracts/{contractId}`
Contratos.

Exemplo (sem upload; documento é URL):
```json
{
  "supplierId": "sup_1",
  "title": "Manutenção elevadores",
  "startsAt": "<timestamp>",
  "endsAt": "<timestamp>",
  "status": "active",
  "contractUrl": "https://..."
}
```

Subcoleções (histórico):
- `condos/{condoId}/contracts/{contractId}/adjustments/{adjustmentId}` (reajustes)
- `condos/{condoId}/contracts/{contractId}/evaluations/{evaluationId}` (avaliações)
- `condos/{condoId}/contracts/{contractId}/services/{serviceId}` (serviços, com vínculo opcional a `workOrderId`/`accountsPayableId`)

Observações:
- Para compatibilidade, alguns ambientes podem ter `attachmentUrl` no lugar de `contractUrl`.

### `condos/{condoId}/insurancePolicies/{policyId}` (alias: `insurances/{insuranceId}`)
Apólices de seguro (sem Storage; `policyUrl` é URL opcional).

### `condos/{condoId}/riskMap/{riskId}` (alias: `risks/{riskId}`)
Mapa de riscos (itens e controles; sem anexos locais).

### `condos/{condoId}/incidents/{incidentId}`
Sinistros (vinculáveis a uma apólice por `policyId`; laudo/comprovantes por URL).

### `condos/{condoId}/notices/{noticeId}`
Avisos/comunicados.

Exemplo:
```json
{
  "title": "Manutenção",
  "body": "...",
  "status": "publicado",
  "publishedAt": "<timestamp>",
  "channels": ["app", "email", "whatsapp"],
  "template": {"scope":"org","id":"tpl_123"},
  "createdAt": "<timestamp>"
}
```

Intenção de envio (MVP, sem disparo real):
- `condos/{condoId}/announcements/{announcementId}/deliveries/{channel}`

Exemplo (delivery):
```json
{
  "channel": "email",
  "status": "pendente",
  "provider": "mock",
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

Templates reutilizáveis:
- Por condomínio: `condos/{condoId}/commsTemplates/{templateId}`
- Por carteira (org): `orgs/{orgId}/commsTemplates/{templateId}`

### `condos/{condoId}/polls/{pollId}`
Enquetes.

Exemplo:
```json
{ "title": "Aprovar obra?", "options": ["Sim","Não"], "status": "open", "createdAt": "<timestamp>" }
```

Votos:
- `condos/{condoId}/polls/{pollId}/votes/{uid}` (1 voto por usuário)

### `condos/{condoId}/assemblies/{assemblyId}`
Assembleias.

Exemplo:
```json
{ "orgId": "org_123", "condoId": "condo_1", "title": "AGO 2026", "status": "called", "voteStatus": "open", "createdAt": "<timestamp>" }
```

Atas:
- `condos/{condoId}/assemblies/{assemblyId}/minutes/{minuteId}`

### `condos/{condoId}/occurrences/{occurrenceId}`
Ocorrências (segurança/portaria).

Campos típicos (MVP):
- `type` (ex.: `FURTO`, `VANDALISMO`, `BARULHO`, `EMERGENCIA`)
- `description` (string)
- `involved[]` (lista de `{name, note?}`)
- `evidenceUrls[]` (lista de URLs)
- `status` (ex.: `aberto`|`em_andamento`|`resolvido`|`fechado`)
- `conclusionText` (string, opcional)
- `concludedAt`, `concludedBy` (opcional; preenchido ao fechar)
- `createdBy`, `createdAt`, `updatedAt`

Exemplo:
```json
{
  "orgId": "org_123",
  "condoId": "condo_1",
  "createdBy": "uid",
  "type": "BARULHO",
  "description": "Som alto após 22h",
  "involved": [{"name":"Morador 801","note":null}],
  "evidenceUrls": ["https://exemplo.com/video"],
  "status": "aberto",
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

### `condos/{condoId}/gatebook/{entryId}`
Livro da portaria (feed cronológico).

Campos típicos:
- `text` (string)
- `createdBy`, `createdAt`

Exemplo:
```json
{ "orgId": "org_123", "condoId": "condo_1", "text": "14:32 — Entrega na unidade 402", "createdBy": "uid", "createdAt": "<timestamp>" }
```

### `condos/{condoId}/visitors/{visitorId}`
Visitantes autorizados (com check-in/out).

Campos típicos (MVP):
- `name`, `document?`, `phone?`
- `unitId?`, `unitLabel?`
- `expectedAt?` (opcional)
- `validFrom?`, `validTo?` (opcional)
- `status` (ex.: `autorizado`|`chegou`|`saiu`|`cancelado`|`negado`|`expirado`)
- `checkInAt?`, `checkOutAt?`
- `createdBy`, `createdAt`, `updatedAt`

### `condos/{condoId}/providers/{providerId}`
Prestadores (cadastro + check-in/out).

Campos típicos (MVP):
- `company`, `responsible?`, `serviceType?`
- `document?`, `phone?`
- `authorizedDays[]` (opcional)
- `status` (`ativo`|`inativo`)
- `checkInAt?`, `checkOutAt?`
- `createdBy`, `createdAt`, `updatedAt`

### `condos/{condoId}/accessEvents/{eventId}`
Eventos de acesso (histórico de entradas/saídas).

Campos típicos (MVP):
- `type` (`check_in`|`check_out`)
- `refKind?` (`visitor`|`provider`)
- `refId?`
- `personName?`, `document?`
- `note?`
- `at` (Date/timestamp)
- `createdBy`, `createdAt`

### `condos/{condoId}/workOrders/{workOrderId}`
Ordens de serviço.

Campos típicos:
- `title`, `description`
- `ticketId` (opcional)
- `assetId` (opcional)
- `unitId` (opcional)
- `location`
- `priority` (ex.: `baixa`|`media`|`alta`|`urgente`)
- `status` (ex.: `aberta`|`em_andamento`|`aguardando_fornecedor`|`concluida`|`cancelada`)
- `slaDueAt` (timestamp, opcional)
- `assignedTo` (uid, opcional)
- `supplierId`, `contractId` (opcional)
- `costCents` (number, opcional)
- `photosBefore[]`, `photosAfter[]` (URLs)
- `createdAt/By`, `updatedAt/By`

Exemplo (sem Storage: fotos/anexos por URL):
```json
{
  "title": "Consertar vazamento",
  "description": "Verificar sifão e tubulação",
  "ticketId": "ticket_1",
  "assetId": null,
  "unitId": "unit_101",
  "location": "Cozinha",
  "priority": "alta",
  "status": "aberta",
  "slaDueAt": "<timestamp>",
  "assignedTo": null,
  "supplierId": "sup_1",
  "contractId": "contract_1",
  "costCents": 12500,
  "photosBefore": ["https://exemplo.com/antes.jpg"],
  "photosAfter": ["https://exemplo.com/depois.jpg"],
  "createdAt": "<timestamp>",
  "createdBy": "uid"
}
```

### `condos/{condoId}/maintenancePlans/{planId}`
Planos preventivos.

Campos típicos:
- `title`
- `assetId`
- `assetType` (opcional)
- `year` (opcional)
- `frequency` (ex.: `mensal`|`trimestral`|`semestral`|`anual`)
- `checklist[]` (string)
- `alertDaysBefore` (number)
- `nextDueAt` (timestamp, opcional)
- `lastDoneAt`, `lastDoneBy` (opcional)
- `createdAt/By`, `updatedAt/By`

Exemplo:
```json
{
  "title": "Preventiva anual - Elevador",
  "assetId": "asset_1",
  "assetType": "elevador",
  "year": 2026,
  "frequency": "anual",
  "checklist": ["Testar freios", "Inspecionar cabos", "Revisar portas"],
  "alertDaysBefore": 10,
  "nextDueAt": "<timestamp>",
  "lastDoneAt": null,
  "lastDoneBy": null,
  "createdAt": "<timestamp>",
  "createdBy": "uid"
}
```

### `condos/{condoId}/maintenanceExecutions/{executionId}`
Execuções (histórico) de planos preventivos.

Exemplo:
```json
{
  "planId": "plan_1",
  "assetId": "asset_1",
  "executedAt": "<timestamp>",
  "nextDueAt": "<timestamp>",
  "notes": "Revisão OK; substituída vedação",
  "checklistDone": ["Testar freios", "Revisar portas"],
  "createdAt": "<timestamp>",
  "createdBy": "uid"
}
```

### `condos/{condoId}/projects/{projectId}`
Obras em áreas comuns (gestão).

Campos típicos (MVP + físico-financeiro):
- `title`, `description`
- `area` (ex.: `garagem`, `fachada`, `elevador`)
- `status` (ex.: `planejado`|`em_andamento`|`concluido`|`cancelado`)
- `budgetCents` (number, opcional)
- `startAt`, `endAt` (date/timestamp opcional)
- `contractor` (string, opcional)
- `attachments[]` (URLs/objetos `{url,name}`)

Rollups (atualizados automaticamente a partir de etapas e medições):
- `plannedCostCents` (soma de `stages[].plannedCostCents`)
- `actualCostCents` (soma de `measurements[].amountCents`)
- `physicalPercent` (percentual físico ponderado por `plannedWeightPercent` ou custo previsto)
- `financialPercent` (`actualCostCents / plannedCostCents`, em %)

Subcoleções:
- `projects/{projectId}/stages/{stageId}` (cronograma / etapas)
- `projects/{projectId}/measurements/{measurementId}` (medições físico-financeiras)

### `condos/{condoId}/projects/{projectId}/stages/{stageId}`
Etapas do cronograma físico-financeiro.

Campos típicos:
- `order` (number)
- `title`, `description`
- `plannedStartAt`, `plannedEndAt` (date/timestamp)
- `plannedCostCents` (number, opcional)
- `plannedWeightPercent` (number 0..100, opcional)
- `status` (`rascunho`|`submetido`|`aprovado`|`reprovado`)
- `decisionNote`, `decisionBy`, `decisionAt` (quando aprovado/reprovado)
- `attachments[]` (URLs/objetos `{url,name}`)
- `createdBy`, `createdAt`, `updatedAt`

### `condos/{condoId}/projects/{projectId}/measurements/{measurementId}`
Medições (lançamentos) para comparar previsto vs realizado.

Campos típicos:
- `stageId` (referência lógica para a etapa)
- `measuredAt` (date/timestamp)
- `physicalPercent` (number 0..100, opcional)
- `amountCents` (number, opcional)
- `note` (string, opcional)
- `attachments[]` (URLs/objetos `{url,name}`)
- `createdBy`, `createdAt`, `updatedAt`

### `condos/{condoId}/reservations/{reservationId}`
Reservas.

### `condos/{condoId}/tickets/{ticketId}`
Chamados.

Campos típicos:
- `title`, `description`
- `priority`, `status`
- `unitId`, `unitLabel` (opcional; quando aplicável a unidade)
- `photos[]` (URLs ou objetos `{url,name,...}`)
- `slaDueAt` (timestamp, opcional)
- `assignedTo` (uid, opcional)
- `convertedToWorkOrderId`, `convertedAt`, `convertedBy` (opcional)
- `createdAt/By`, `updatedAt/By`

Exemplo (fotos como URL):
```json
{
  "title": "Vazamento",
  "description": "Vazando na cozinha da unidade",
  "priority": "alta",
  "status": "aberto",
  "unitId": "unit_101",
  "unitLabel": "Bloco A / 101",
  "createdBy": "uid",
  "photos": ["https://exemplo.com/foto.jpg"],
  "convertedToWorkOrderId": null,
  "createdAt": "<timestamp>"
}
```

### `condos/{condoId}/fines/{fineId}`
Multas.

### Financeiro

Cobranças e recebimentos:
- `condos/{condoId}/billing/{billingId}`: ciclo/agregado (ex.: competência)
- `condos/{condoId}/charges/{chargeId}`: cobranças (boletos)
- `condos/{condoId}/payments/{paymentId}`: pagamentos (entradas/saídas, comprovante via URL)
- `condos/{condoId}/accountsPayable/{apId}`: contas a pagar (aprovação em 2 níveis)
- `condos/{condoId}/costCenters/{ccId}`: centros de custo
- `condos/{condoId}/budget/{budgetId}`: orçamento
- `condos/{condoId}/ledger/{entryId}`: lançamentos/balancete

Campos sugeridos:
- `blockId` (string)
- `number` (string)
- `floor` (number)
- `status` (string)

Acesso:
- Mesmo critério do `condos/{condoId}`.

### `condos/{condoId}/mandates/{mandateId}`
Mandatos de gestão do condomínio.

Campos sugeridos:
- `title` (string)
- `sindicoName` (string | null)
- `startsAt` (timestamp | null)
- `endsAt` (timestamp | null)
- `notes` (string | null)
- `status` (string)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Acesso:
- Mesmo critério do `condos/{condoId}`.

### `condos/{condoId}/assemblies/{assemblyId}`
Metadata da assembleia por condomínio (admin cria/edita/convoca; morador lê).

Campos sugeridos:
- `orgId` (string)
- `condoId` (string)
- `title` (string)
- `date` (timestamp | null)
- `location` (string | null)
- `status` (string: `draft` | `called` | `closed`)
- `voteStatus` (string: `open` | `closed`)
- `noticeText` (string | null)
- `calledAt` (timestamp | null)
- `calledBy` (string | null)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Acesso:
- Leitura: mesmo critério do `condos/{condoId}`.
- Escrita: gestão do condo (`gestor/sindico/admin`) ou `carteira/admin` da organização.

### `assemblies/{assemblyId}` (raiz)
Documento “espelho” da metadata para hospedar subcoleções (`attendances`, `votes`, `minutes`).

Observação:
- O app cria/atualiza este doc junto com `condos/{condoId}/assemblies/{assemblyId}` (mesmo `assemblyId`).

### `assemblies/{assemblyId}/attendances/{uid}`
Confirmação de presença (1 doc por usuário).

Campos sugeridos:
- `uid` (string)
- `condoId` (string)
- `confirmedAt` (timestamp)
- `updatedAt` (timestamp)

### `assemblies/{assemblyId}/votes/{uid}`
Voto do morador (1 doc por usuário).

Campos sugeridos:
- `uid` (string)
- `condoId` (string)
- `choice` (string: `sim` | `nao` | `abstencao`)
- `votedAt` (timestamp)
- `updatedAt` (timestamp)

Regra:
- Só permitir voto quando `assemblies/{assemblyId}.voteStatus == "open"`.

### `assemblies/{assemblyId}/minutes/{minuteId}`
Atas. No MVP, usamos `minuteId = latest`.

Campos sugeridos:
- `orgId` (string)
- `condoId` (string)
- `text` (string)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)
- `updatedBy` (string)

### `users/{uid}`
Perfil do usuário autenticado.

Campos sugeridos:
- `displayName` (string)
- `email` (string)
- `cpfNormalized` (string)
- `phone` (string)
- `photoURL` (string)
- `createdAt` (timestamp)
- `lastLoginAt` (timestamp)

Acesso:
- Cada usuário só pode ler/escrever o próprio documento.

Observação:
- `users/{uid}.role` pode existir por compat, mas **não concede privilégio**.

### `memberships/{membershipId}`
Vínculo do usuário com um condomínio e/ou organização.

Campos obrigatórios:
- `uid` (string)
- `orgId` (string)
- `condoId` (string | null)
- `scope` (string: `condo` | `org`)
- `role` (string)
- `status` (string)
- `createdAt` (timestamp)

Campos sugeridos:
- `permissions` (string[]) — permissões extras
- `updatedAt` (timestamp)

Acesso:
- Usuário lê apenas memberships onde `resource.data.uid == request.auth.uid`.

Anti-escalonamento:
- No MVP, **nenhum client** pode criar/editar/deletar `memberships`. Provisionamento deve ser feito via Admin SDK.

### `auditLogs/{logId}`
Log de auditoria.

Campos sugeridos:
- `orgId` (string)
- `condoId` (string | null)
- `actorUid` (string)
- `action` (string)
- `entityType` (string)
- `entityId` (string)
- `createdAt` (timestamp)
- `metadata` (map)

Acesso:
- Leitura: papéis de gestão (`gestor/sindico/admin`) do condomínio ou `carteira/admin` da organização.
- Escrita: permitido apenas criar logs “do próprio usuário” (actorUid igual ao uid autenticado) e, se `condoId` existir, somente para condo ao qual ele tem acesso.

Observação:
- `auditLogs` é **create-only** (sem update/delete) para garantir imutabilidade.

## Notas de consulta / índices

Com `memberships` usando IDs determinísticos (`{uid}_{condoId}` e `{uid}_org_{orgId}`), o app pode usar `getDoc()` direto — normalmente **sem necessidade** de índices compostos.

Os índices em `firestore.indexes.json` cobrem queries comuns do app:
- Listas por `status` + `createdAt` (tickets, reservas, ocorrências, ordens)
- Cobranças por vencimento (`billing.status` + `dueDate`)

Se novas telas exigirem ordenações/filtros diferentes, adicione índices pontualmente.
