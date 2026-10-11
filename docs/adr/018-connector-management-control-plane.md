# ADR-018 — Connector Management Control Plane

Status: Accepted

## Context

O Atlas já possui a execução durável definida pela ADR-012, atores humanos e Service Actors
autenticados conforme a ADR-013, referências de segredo sem material secreto conforme a ADR-016 e
o Connector Framework da ADR-017. O Core registra definitions em código, persiste instances e runs,
enfileira uma execução lógica na mesma transação PostgreSQL e converte observations em evidência.

Ainda não existe uma superfície de gestão para criar, consultar, configurar, habilitar ou executar
instances. Antes de expor essa superfície, é necessário separar duas versões que possuem propósitos
diferentes, formalizar optimistic concurrency, cercar execuções já enfileiradas contra mutações
posteriores e definir fronteiras seguras para configuração, referências de segredo, respostas HTTP,
RBAC e AuditLog.

Esta decisão constrói sobre ADR-012, ADR-013, ADR-016 e ADR-017. Ela não substitui essas decisões,
não implementa a API e não autoriza um connector real.

## Decision

O primeiro control plane de Connector Management será uma API REST autenticada e default-deny. Ele
gerenciará somente metadata não secreta, referências de segredo por slot semântico e solicitações
idempotentes de run. Toda mutação relevante será protegida por optimistic concurrency e auditada com
metadata segura.

### Version semantics

`ConnectorInstance.configurationVersion` é exclusivamente a versão do **schema de configuração**.
Ela expressa compatibilidade com `ConnectorDefinition.configurationSchemaVersion` e não é uma
revisão do conteúdo configurado.

Uma edição normal de valores não incrementa `configurationVersion`:

```text
definition.configurationSchemaVersion = 1
instance.configurationVersion = 1

endpointLabel A → endpointLabel B

instance.configurationVersion permanece 1
```

Somente uma migração explícita da configuração para um novo schema altera
`configurationVersion`.

`ConnectorInstance.version` é a revisão do aggregate no control plane. Ela serve simultaneamente
para:

```text
optimistic concurrency de mutações administrativas
execution fencing de ConnectorRuns já enfileirados
```

Toda mutação bem-sucedida da instance ou do conjunto de referências de segredo incrementa
`ConnectorInstance.version`, inclusive mudança de nome, configuração, estado enabled, set/change/
remove de SecretReference e futura mudança de schedule. Esse fence é deliberadamente conservador.

`ConnectorSecretReference` não recebe coluna própria de versão inicialmente. Sua mutação e o
incremento da versão da instance ocorrem na mesma transação. O modelo existente já possui os campos
necessários; esta decisão não requer migration 13.

### Queue snapshot and runtime fencing

Uma solicitação futura de run deverá enfileirar o snapshot mínimo:

```json
{
  "schemaVersion": 1,
  "connectorInstanceId": "<uuid>",
  "configurationVersion": 1,
  "instanceVersion": 7
}
```

Continuam proibidos no job: configuração JSON, `SecretReference`, `logicalKey`, `providerKind`,
material secreto, ator, resposta de provider e erro bruto.

Antes de validar configuração, resolver segredo ou invocar o provider, o worker deverá comparar:

```text
payload.instanceVersion == ConnectorInstance.version
```

Mismatch produz erro sanitizado `CONNECTOR_INSTANCE_CHANGED`, não retryable. Sem evidência durável,
o resultado terminal é `FAILED`; com evidência durável, é `PARTIAL`.

Depois, de forma independente, o worker verificará:

```text
payload.configurationVersion
== ConnectorInstance.configurationVersion
== ConnectorDefinition.configurationSchemaVersion
```

`instanceVersion` cerca uma revisão mutável; `configurationVersion` garante compatibilidade do
schema. Essas verificações não podem ser confundidas. O Core existente deverá ser atualizado para
carregar `instanceVersion` antes de qualquer mutation endpoint ser exposto.

### Optimistic concurrency

Toda mutation de uma instance ou de uma referência de segredo exigirá `expectedVersion` igual à
`ConnectorInstance.version` corrente. Uma versão obsoleta falha sem efeito administrativo:

```text
HTTP 409
code: CONNECTOR_INSTANCE_VERSION_CONFLICT
```

Não haverá last-write-wins.

## Authorization

O control plane adicionará exatamente estas permissions:

```text
connector:read
connector:configure
connector:execute
```

Mapping humano inicial:

```text
VIEWER  → connector:read
ANALYST → connector:read, connector:execute
ADMIN   → connector:read, connector:execute, connector:configure
```

Service Actors recebem permissions somente por registrations explícitas e separadas. Roles humanas
não os autorizam implicitamente. `atlas:access` permanece obrigatório e independente. Não existe
bypass SYSTEM, Admin, worker, rede interna ou connector.

## REST management surface v1

Nenhuma rota é pública. As únicas rotas públicas do Atlas permanecem `/health`, `/health/live` e
`/health/ready`.

```text
GET    /connectors/definitions                           connector:read
GET    /connectors/instances                             connector:read
POST   /connectors/instances                             connector:configure
GET    /connectors/instances/:id                         connector:read
PATCH  /connectors/instances/:id                         connector:configure

PUT    /connectors/instances/:id/secret-references/:slot connector:configure
DELETE /connectors/instances/:id/secret-references/:slot connector:configure

POST   /connectors/instances/:id/runs                    connector:execute

GET    /connectors/runs                                  connector:read
GET    /connectors/runs/:id                              connector:read
```

Não fazem parte de v1: hard delete de instance, cancelamento de run, API de redrive, reconciliação
ou gestão de schedules, teste de conexão e rotas específicas de connector. DLQ e redrive do pg-boss
continuam capacidades operacionais da fundação, não APIs públicas.

### Definitions

`GET /connectors/definitions` poderá retornar somente metadata segura do registry:

```text
connectorType
configurationSchemaVersion
capabilities
supportedObservationTypes
requiredSecretSlots
```

Não retornará tuning de retry, funções, registry de Secret Providers, estado do ambiente ou objetos
internos da fila. Como o registry de produção possui zero definitions reais, `[]` é uma resposta
inicial correta.

### Instance creation

`POST /connectors/instances` aceitará somente:

```text
connectorType
name
configuration
```

O backend definirá:

```text
enabled = false
version = 1
configurationVersion = ConnectorDefinition.configurationSchemaVersion
```

O caller não controla versions nem campos de schedule. O `connectorType` precisa existir no registry
do runtime; tipo desconhecido falha fechado. Com registry de produção vazio, nenhuma instance real
pode ser criada. Definitions sintéticas permanecem permitidas apenas em testes.

### Configuration safety

`configuration` contém somente JSON não secreto. Antes de persistir, o backend exigirá estrutura
JSON simples, tamanho serializado UTF-8 limitado a aproximadamente 64 KiB, números finitos, ausência
de ciclos/proxies e sucesso em `ConnectorDefinition.validateConfig()`.

A validação genérica rejeitará chaves equivalentes, independentemente de casing ou representação, a:

```text
password
token
secret
credential
apiKey
accessToken
refreshToken
clientSecret
privateKey
authorization
resolvedSecret
```

Também rejeitará objetos de locator equivalentes a `providerKind + logicalKey`.

```text
SecretReference != configuration
SecretReference != SecretMaterial
```

### Instance update and enablement

`PATCH /connectors/instances/:id` aceitará:

```text
expectedVersion
name?
configuration?
enabled?
```

Não aceitará `connectorType`, versions, schedules ou secret references. Cada mutation bem-sucedida
incrementará `version` uma vez. Uma edição normal de configuração será revalidada contra o mesmo
schema e não incrementará `configurationVersion`.

Na transição `enabled: false → true`, o backend exigirá definition existente, versões de schema
compatíveis, configuração válida e references configuradas para todos os slots obrigatórios. O
enable não resolverá material secreto nem testará conectividade; disponibilidade do provider e do
segredo continuam preocupações da execução até existir uma feature explícita de teste.

### SecretReference management

Os endpoints usarão slots semânticos declarados pela definition. O PUT aceitará somente:

```text
expectedVersion
providerKind
logicalKey
```

O backend aplicará o parser e a policy existentes. Inicialmente, somente `ENV` é suportado, salvo
aprovação separada de outro provider.

Respostas HTTP normais nunca retornarão `logicalKey`, locator `providerKind + logicalKey`, material
secreto ou valor resolvido. Poderão expor apenas estado seguro:

```json
{
  "slot": "bind-password",
  "configured": true
}
```

DELETE também exigirá `expectedVersion`. A remoção apagará a metadata do locator, incrementará a
versão da instance e criará AuditLog seguro na mesma transação. Se o slot for obrigatório e a
instance estiver enabled, a mesma transação também definirá `enabled = false`. Uma instance
estruturalmente inexequível não permanecerá habilitada.

### Safe instance response

Uma resposta de instance poderá conter somente:

```text
id
connectorType
name
enabled
configurationVersion
version
configuração não secreta validada
estado configured/unconfigured por slot
createdAt
updatedAt
```

Não conterá locator, material secreto, pg-boss job ID ou configuração interna da fila. Campos de
schedule permanecem fora de v1.

## Requested runs

`POST /connectors/instances/:id/runs` usa `connector:execute`, trigger `REQUESTED` e o ator HUMAN ou
SERVICE corrente. A identidade HTTP idempotente será preferencialmente o header `Idempotency-Key`,
validado no formato printable e limitado já usado pelo Atlas, e mapeado internamente para
`requestIdentity`.

Repetir a mesma solicitação lógica retorna o mesmo `ConnectorRun`, sem segundo job. Para uma criação
nova, a implementação estenderá a fronteira transacional segura do Core para que:

```text
ConnectorRun
+ enqueue pg-boss
+ CONNECTOR_RUN_REQUESTED AuditLog
```

sejam confirmados juntos. O formato TypeScript interno permanece detalhe de implementação e não
expõe Prisma à `ConnectorDefinition`. Replay idempotente não cria segundo AuditLog.

### Run responses

GET list/detail poderá retornar:

```text
run id
connector instance id
resumo seguro da instance
status
trigger
triggerActorType
triggerActorId
scheduledFor
startedAt
finishedAt
observedCount
ingestedCount
rejectedCount
safe errorCode
createdAt
updatedAt
```

Não retornará pg-boss job ID, payload da fila, referência ou material secreto, erro bruto de provider
ou resposta bruta. `requestFingerprint` permanece interno enquanto não existir requisito de API.

## AuditLog

Operações administrativas gerarão, no mínimo:

```text
CONNECTOR_INSTANCE_CREATED
CONNECTOR_INSTANCE_UPDATED
CONNECTOR_INSTANCE_ENABLED
CONNECTOR_INSTANCE_DISABLED
CONNECTOR_SECRET_REFERENCE_SET
CONNECTOR_SECRET_REFERENCE_REMOVED
CONNECTOR_RUN_REQUESTED
```

Uma operação usa a ação mais precisa aplicável, evitando ações duplicadas para o mesmo efeito. O
ator será registrado com `auditActorType(actor)` e `actor.id`; o worker não impersona o caller.

AuditLog nunca conterá material secreto, `logicalKey`, locator, dado bruto de provider ou
`Error.message`. Mudanças de configuração preferirão `changedFields`, versão do schema, revisão
before/after e SHA-256 da configuração não secreta canônica, em vez de copiar o JSON completo.
Operações de referência registrarão somente slot e estado configured before/after.

`CONNECTOR_RUN_REQUESTED` poderá registrar `connectorInstanceId`, `runId`, trigger `REQUESTED` e
`replayed = false`. Não registrará Idempotency-Key, configuração ou credential. Replay não cria
segundo run, job ou efeito administrativo auditado.

## Deferred capabilities

Permanecem explicitamente fora do management v1:

```text
hard delete de ConnectorInstance
cancelamento de run
API de redrive
schedule reconciliation e schedule-management API
connection test
connector-specific routes
connector real
```

Os campos persistidos de schedule continuam internos e sem escrita pública. O lifecycle normal da
instance é create, configure, enable e disable; runs e evidências históricos permanecem protegidos.

O registry de produção continua com zero `ConnectorDefinition`. Este ADR não implementa AD DS,
Microsoft Entra ID, Intune, Defender ou Azure. A limpeza do catálogo `active-directory-entra-id`
permanece finding P3 separado.

## Consequences

- O campo `version` existente evita migration adicional e fornece concurrency e fencing.
- Qualquer mutation administrativa invalida conservadoramente runs ainda não iniciados.
- References podem mudar sem expor locators e sem uma coluna própria de versão.
- A API pode iniciar vazia e segura enquanto não existe connector real.
- A atomicidade do run solicitado precisará incluir o AuditLog sem abrir gap entre domínio e fila.
- O runtime Core precisa aceitar e validar `instanceVersion` antes das mutations do control plane.
- Permissions e mappings serão implementados junto à API, não por este ADR.

## Production stabilization

O gate de estabilização do Connector Execution continua `PENDING` e o go-live continua `NOT YET`.
As APIs do control plane não autorizam credential operacional. Provisionar segredo real ou executar
AD DS em produção continua bloqueado até o fechamento explícito da estabilização.

## Related Decisions

ADR-012, ADR-013, ADR-016 e ADR-017.
