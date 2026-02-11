# Modelo de Dados (Firestore) — Multi-condomínios

Este documento descreve o **modelo mínimo** para multi-condomínios e as **convenções necessárias** para as regras de segurança em `firestore.rules`.

> Importante: Regras do Firestore **não conseguem consultar por campo** dentro de uma coleção (ex.: “buscar membership onde uid==X e condoId==Y”).
> Por isso, para autorizar acesso com base em `memberships`, precisamos de **IDs determinísticos** (ver seção “Convenções”).

## Visão geral

Coleções:
- `organizations/{orgId}`
- `condos/{condoId}`
- `condos/{condoId}/blocks/{blockId}`
- `condos/{condoId}/units/{unitId}`
- `condos/{condoId}/assemblies/{assemblyId}`
- `users/{uid}`
- `memberships/{membershipId}`
- `auditLogs/{logId}`
 - `assemblies/{assemblyId}`
 - `assemblies/{assemblyId}/attendances/{uid}`
 - `assemblies/{assemblyId}/votes/{uid}`
 - `assemblies/{assemblyId}/minutes/{minuteId}`

## Convenções (obrigatórias para as regras)

### 1) IDs de `memberships` (determinísticos)

Para permitir `exists()`/`get()` no documento correto via regras:

**Membership por condomínio (escopo `condo`):**
- `membershipId = "{uid}_{condoId}"`
- Campos obrigatórios:
  - `uid` (string)
  - `orgId` (string)
  - `condoId` (string)
  - `scope = "condo"`
  - `role` (string)
  - `status` (string)

**Membership por organização (escopo `org`) — para carteira/admin:**
- `membershipId = "{uid}_org_{orgId}"`
- Campos obrigatórios:
  - `uid` (string)
  - `orgId` (string)
  - `condoId = null`
  - `scope = "org"`
  - `role` (string)
  - `status` (string)

### 2) Campo `orgId` em `condos/{condoId}`

Cada condomínio deve ter `orgId` para permitir autorização por organização:
- `condos/{condoId}.orgId = "{orgId}"`

## Papéis e status

### Roles (`memberships.role`)
Sugestão de enum mínimo:
- `morador`
- `gestor`
- `sindico`
- `admin`
- `carteira` (acesso em nível de organização)

### Status (`memberships.status`)
Sugestão de enum mínimo:
- `active`
- `invited`
- `suspended`

As regras consideram **apenas** `status == "active"` como válido.

## Coleções e campos

### `organizations/{orgId}`
Documento da organização.

Campos sugeridos:
- `name` (string)
- `status` (string) — ex.: `active`
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Acesso:
- Leitura por usuários com membership **org-scoped** ativa (`scope == "org"`) para este `orgId`.

### `condos/{condoId}`
Documento do condomínio.

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

Campos sugeridos:
- `name` (string)
- `order` (number)

Acesso:
- Mesmo critério do `condos/{condoId}`.

### `condos/{condoId}/units/{unitId}`
Unidades (apartamentos/casas).

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

### `memberships/{membershipId}`
Vínculo do usuário com um condomínio e/ou organização.

Campos obrigatórios:
- `uid` (string)
- `orgId` (string)
- `condoId` (string | null)
- `scope` (string: `condo` | `org`)
- `role` (string)
- `status` (string)

Campos sugeridos:
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

Acesso:
- Usuário lê apenas memberships onde `resource.data.uid == request.auth.uid`.
- Escrita: apenas por `admin/carteira` no nível da organização, ou `admin/sindico/gestor` no nível do condomínio (conforme regras).

### `auditLogs/{logId}`
Log de auditoria.

Campos sugeridos:
- `orgId` (string)
- `condoId` (string | null)
- `actorUid` (string)
- `action` (string)
- `targetPath` (string)
- `createdAt` (timestamp)
- `metadata` (map)

Acesso:
- Leitura: papéis de gestão (`gestor/sindico/admin`) do condomínio ou `carteira/admin` da organização.
- Escrita: permitido apenas criar logs “do próprio usuário” (actorUid igual ao uid autenticado) e, se `condoId` existir, somente para condo ao qual ele tem acesso.

## Notas de consulta / índices

Com `memberships` usando IDs determinísticos (`{uid}_{condoId}` e `{uid}_org_{orgId}`), o app pode usar `getDoc()` direto — normalmente **sem necessidade** de índices compostos.

Se no futuro você fizer consultas do tipo:
- `memberships` filtrando por `uid` + `status`
- `units` filtrando por `blockId` + `orderBy`

…aí pode ser necessário adicionar índices (ver `firestore.indexes.json`).
