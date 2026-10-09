# ADR-017 — Connector Framework

Status: Accepted

## Context

O Atlas já possui uma fundação de execução durável baseada em pg-boss, autenticação separada para
atores humanos e Service Actors, referências de segredo resolvidas por providers controlados e uma
arquitetura evidence-first. Ainda falta a fronteira de domínio que represente integrações externas
configuradas, suas execuções lógicas e os fatos coletados de providers sem acoplar o inventário a
LDAP, Microsoft Graph ou qualquer outro protocolo específico.

O primeiro connector real deverá validar o desenho com Active Directory Domain Services (AD DS),
mas o framework não pode incorporar conceitos próprios de LDAP ou Microsoft. Ele também não deve
transformar tentativas internas do pg-boss em identidade de negócio, confundir credenciais de
provider com Service Actors nem permitir que connectors gravem estado autoritativo do ativo sem
evidência.

## Decision

O Connector Framework adotará quatro conceitos separados:

```text
ConnectorDefinition — tipo suportado em código
ConnectorInstance   — integração configurada e persistida
ConnectorRun        — uma execução lógica persistida
ConnectorObservation — fato de provider em stream de runtime
```

O framework produzirá observações provider-neutral que entram em uma fronteira compartilhada de
ingestão evidence-first. Ele não substituirá o catálogo de Data Sources, não migrará Network
Discovery neste estágio e não criará uma tabela genérica de observações intermediárias.

### ConnectorDefinition

`ConnectorDefinition` pertence ao runtime e inicialmente não será persistida. Ela representa um
tipo de connector suportado e possui identidade estável em `connectorType`, por exemplo:

```text
active-directory-domain-services
```

Uma definition é responsável por:

- versão do schema de configuração;
- capabilities;
- tipos de observação suportados;
- política do worker;
- validação de configuração não secreta;
- implementação provider-neutral do contrato de coleta.

IDs de apresentação do catálogo de Data Sources não se tornam automaticamente `connectorType`. Em
particular, o agrupamento atual `active-directory-entra-id` não representa um único connector de
runtime; AD DS e Microsoft Entra ID deverão usar tipos separados.

### ConnectorInstance

`ConnectorInstance` será persistida e representará uma integração externa configurada em uma
instalação Dedicated do Atlas. Sua identidade estável será um UUID `connectorInstanceId`, nunca IP,
hostname, nome de exibição ou ID de job da fila.

Uma instance separará:

```text
configuração não secreta validada
metadata de SecretReference por slot semântico
configuração de schedule
lifecycle operacional
```

O lifecycle normal será criar, configurar, habilitar e desabilitar. Hard delete não será a operação
normal e não haverá API geral de delete no framework inicial. Uma instance que possua runs ou
evidence históricos não poderá ser removida de forma destrutiva.

### ConnectorRun

`ConnectorRun` será persistido e representará uma execução lógica. Sua identidade estável será um
UUID `runId`.

O lifecycle aceito é:

```text
QUEUED
→ RUNNING
→ COMPLETED | PARTIAL | FAILED | CANCELLED
```

Um retry do pg-boss não cria outro `ConnectorRun`. O mesmo `runId` sobrevive às tentativas da fila.
ID de job, attempt, processo ou worker não são identidade de negócio.

O trigger persistido será:

```text
REQUESTED
SCHEDULE
INTERNAL
```

`REQUESTED` representa uma solicitação explícita tanto de ator `HUMAN` quanto `SERVICE`. A
proveniência fica separada em `triggerActorType` e `triggerActorId`, permitindo:

```text
REQUESTED + HUMAN
REQUESTED + SERVICE
SCHEDULE + SYSTEM
INTERNAL + SYSTEM
```

O tipo de trigger nunca concede autorização.

### ConnectorObservation

`ConnectorObservation` será um stream de runtime e não uma tabela genérica. Ela representa um fato
coletado de um provider durante um run. Sua identidade semântica deriva de:

```text
connectorInstanceId
runId
observationType
providerRecordId
semantic fingerprint
```

A observation será validada, normalizada e entregue à reconciliação evidence-first compartilhada.
O framework inicial não criará tabelas `connector_observations`, `source_records` ou
`discovered_objects`.

`ConnectorResult` também não será um modelo persistido separado. Estado terminal, contadores e
classificação segura de erro pertencem ao `ConnectorRun`; os fatos aceitos tornam-se evidência.

## Actor and credential boundaries

O framework mantém três identidades distintas:

```text
trigger actor:
ator Atlas HUMAN ou SERVICE autenticado, ou identidade SYSTEM namespaced explícita para schedule
ou ação interna

worker:
infraestrutura de execução, sem impersonation e sem bypass SYSTEM, Admin, RBAC ou de rede

provider credential:
credencial outbound que o Atlas usa para acessar a fonte externa; não é um Atlas Service Actor
```

O trigger actor seguro e estável será persistido no run. O worker executa o run, mas não assume a
identidade nem as permissões do solicitante. Credenciais do provider são resolvidas em memória a
partir de slots semânticos da instance.

## SecretReference boundary

Metadata de `SecretReference` poderá ser persistida para uma `ConnectorInstance`, conforme a emenda
ao ADR-016. A metadata contém somente:

```text
slot
providerKind
logicalKey
```

O invariante permanente é:

```text
SecretReference != SecretMaterial
```

Material resolvido nunca será persistido, enfileirado, auditado ou logado. A metadata de locator é
interna e não será copiada para respostas HTTP normais, `AuditLog`, logs operacionais, payloads do
pg-boss, `ConnectorObservation` ou `AssetEvidence`. APIs futuras poderão informar apenas estado
seguro, como slot configurado ou não configurado, sem retornar `logicalKey`.

## Connector contract

O contrato de runtime será provider-neutral e aproximadamente equivalente a:

```ts
interface ConnectorDefinition<TConfig> {
  readonly type: string;
  readonly configurationSchemaVersion: number;
  readonly capabilities: readonly string[];

  validateConfig(input: unknown): TConfig;

  collect(context: ConnectorCollectionContext<TConfig>): AsyncIterable<ConnectorObservation>;
}
```

O formato TypeScript exato permanece detalhe de implementação. O contexto poderá oferecer somente:

- `connectorInstanceId` e `runId`;
- configuração não secreta já validada;
- `AbortSignal`;
- resolução de segredo limitada a slots semânticos;
- logger seguro;
- clock.

O connector não receberá Prisma, PgBoss, conexão bruta de banco, acesso irrestrito ao ambiente ou
ao registry completo de Secret Providers.

Cursor/checkpoint persistente permanece adiado até que um provider real demonstre o requisito.
Microsoft Graph delta queries poderão motivar uma decisão futura.

## Execution and scheduling

O fluxo aceito é:

```text
trigger autenticado ou scheduler
→ criar ConnectorRun(QUEUED)
→ enqueue via Connector Execution
→ confirmar ambos na mesma transação PostgreSQL
→ worker reivindica o job
→ mesmo ConnectorRun passa a RUNNING
→ carregar ConnectorInstance e validar configuração/versão
→ resolver slots necessários em memória
→ Connector.collect()
→ stream de ConnectorObservation
→ validação e normalização
→ ingestão evidence-first compartilhada
→ atualização de contadores seguros
→ estado terminal
```

Criação do run e enqueue usarão a fronteira `fromPrisma(tx)` aceita no ADR-012.

O Atlas será a fonte de verdade de schedules. Uma instance persistirá futuramente
`scheduleEnabled`, `scheduleExpression` e `scheduleTimeZone`; registros internos de schedule do
pg-boss serão infraestrutura derivada e reconciliável, não configuração de negócio autoritativa.

## Idempotency and partial execution

`requestFingerprint` será um SHA-256 canônico da criação lógica do run. O design de implementação
deverá formalizar a serialização e incluir contexto estável suficiente, como:

- connector instance;
- classe do trigger;
- trigger actor quando aplicável;
- identidade semântica da request ou ocorrência de schedule;
- horário agendado quando aplicável.

Ele não dependerá de job ID, retry attempt, process ID ou nonce aleatório. Repetir a mesma criação
lógica reutiliza o run existente.

`connectorObservationKey` protegerá o replay exato de uma observation no mesmo run e incluirá:

```text
runId
connectorInstanceId
observationType
providerRecordId
semantic fingerprint
```

Assim, retry do mesmo run não duplica evidence idêntica. O mesmo objeto observado em outro run pode
gerar nova evidence, e conteúdo semanticamente alterado não é suprimido apenas porque o
`providerRecordId` permaneceu igual.

Cada observation ou batch limitado será confirmado independentemente. Não haverá uma única
transação para todo o run:

```text
retry eventualmente conclui                 → COMPLETED
retry esgota após alguma observation aceita → PARTIAL
retry esgota sem observation aceita         → FAILED
```

Entrega ou claim do job não significa efeito externo exatamente uma vez. Handlers com efeitos
externos continuam obrigados a implementar idempotência, deduplicação ou reconciliação.

## Normalized ingestion and evidence

O Connector Framework não usará permanentemente o DTO HTTP de ingestão nem duplicará reconciliação.
Uma fronteira interna normalizada será compartilhada:

```text
HTTP/manual ingestion ─┐
                       ├─ normalized asset-observation boundary
Connector Framework ───┘
                              ↓
                   shared evidence-first reconciliation
```

Essa reconciliação será responsável por identificação/criação de Asset, `AssetEvidence`, atributos,
interfaces de rede, conflitos e timeline/current state.

`AssetEvidence` receberá futuramente:

```text
connectorRunId
connectorObservationKey
```

`connectorRunId` ligará evidence à execução lógica. A instance será derivada pelo run, sem FK
duplicada. `sourceRecordId` continuará sendo o identificador do objeto no provider.

Payload de evidence de provider significa conteúdo source-faithful, allowlisted, redigido,
versionado e limitado — inicialmente com alvo aproximado de 64 KiB. Ele não significa armazenar a
resposta bruta irrestrita. São proibidos headers de autorização, tokens, passwords, private keys,
segredos resolvidos, locators de SecretReference e corpos irrestritos de provider.

## Network Discovery and Data Sources

A decisão para Network Discovery é `SHARE PRIMITIVES`. `NetworkDiscoveryProfile`,
`NetworkDiscoveryRun` e `NetworkDiscoveryResult` permanecem estruturalmente independentes no
framework inicial. Uma evolução futura poderá compartilhar ingestão normalizada, modelo seguro de
erros e convenções de execução sem migrar comportamento estável agora.

O catálogo de Data Sources continua sendo informação de produto sobre capabilities suportadas ou
planejadas. `ConnectorDefinition` é uma capability executável em código e `ConnectorInstance` é uma
integração efetivamente configurada. O catálogo não é o modelo de persistência de instances.

## Authorization and audit

APIs futuras deverão adicionar permissões distintas:

```text
connector:read
connector:configure
connector:execute
```

`connector:read` permitirá list/detail de instances e runs. `connector:configure` cobrirá criação,
configuração, enable/disable, schedule e slots de credential. `connector:execute` cobrirá run
solicitado, cancelamento e redrive controlado.

Um mapping humano inicial poderá conceder read ao Viewer, read/execute ao Analyst e as três ao
Admin. Service Actors terão mappings explícitos e separados. `atlas:access` continuará sendo gate
independente e obrigatório; nenhum ator ou worker terá bypass.

Operações administrativas relevantes gerarão `AuditLog`, incluindo configuração da instance,
enable/disable, solicitação manual, cancelamento e redrive. Observações individuais e telemetria de
worker não serão transformadas em AuditLog de alto volume.

## Persistence intent

O Connector Framework requer mudança futura no Prisma, mas esta ADR não autoriza migration.

Serão persistidos futuramente:

```text
ConnectorInstance
ConnectorSecretReference
ConnectorRun
```

Não serão persistidos inicialmente:

```text
ConnectorDefinition
ConnectorObservation
ConnectorResult
```

### ConnectorInstance

Intenção de campos:

```text
id UUID PK
connectorType required
name required
enabled false by default
configurationVersion default 1
configuration JSONB
scheduleEnabled false
scheduleExpression nullable
scheduleTimeZone default UTC
version default 1
createdAt
updatedAt
```

### ConnectorSecretReference

Intenção de campos:

```text
connectorInstanceId UUID
slot string
providerKind string
logicalKey string
createdAt
updatedAt
```

Sua identidade será `(connectorInstanceId, slot)`. Não haverá coluna de valor secreto.

### ConnectorRun

Intenção de campos:

```text
id UUID
connectorInstanceId
status
trigger
triggerActorType
triggerActorId
requestFingerprint
scheduledFor
startedAt
finishedAt
observedCount
ingestedCount
rejectedCount
errorCode
version
createdAt
updatedAt
```

Relações deverão preservar histórico de run e evidence.

### Migration intent

```text
current migration count: 11
future proposed count: 12
backfill: none
existing evidence connectorRunId: NULL
existing evidence connectorObservationKey: NULL
existing assets affected: no
authorization: not yet granted
```

Migration 12 exige autorização explícita em uma tarefa posterior. Esta decisão não contém SQL, não
altera o schema Prisma e não cria migration.

## Production stabilization

O gate de estabilização produtiva de Connector Execution permanece pendente. Arquitetura e
implementação do framework podem continuar, mas o gate deverá estar encerrado antes de provisionar
uma credencial real de AD DS ou executar AD DS em produção.

Esse gate inclui observabilidade, limites de pool e capacidade, backup/PITR do schema pg-boss,
runbook de upgrade/rollback, operação de DLQ/redrive, testes de shutdown/reconnect/falha, retenção,
paginação/load, provisioning/rotation de segredo, TLS e revisão de segurança.

## Alternatives Considered

- Persistir todas as definitions: rejeitado por duplicar metadata que pertence ao release e exigir
  sincronização entre banco e runtime.
- Chamar diretamente o DTO HTTP de ingestão: rejeitado por acoplar o framework ao transporte e à
  semântica manual.
- Permitir que cada connector escreva Asset diretamente: rejeitado por violar evidence-first e
  duplicar reconciliação.
- Criar staging genérico de observations/source records: adiado porque a ingestão transacional já
  pode identificar/criar Asset e evidence sem outra camada persistida.
- Usar o job ID do pg-boss como run ID: rejeitado por confundir attempt de infraestrutura com
  identidade lógica.
- Persistir secret material com a instance: rejeitado por ampliar a superfície de ataque e violar o
  ADR-016.
- Migrar Network Discovery imediatamente: rejeitado por expandir risco sem necessidade para o
  primeiro connector.

## Consequences

- Connector types permanecem desacoplados de instances configuradas.
- A execução preserva proveniência do trigger sem impersonation pelo worker.
- Evidence pode ser rastreada até o run e, por relação, até a instance.
- Retries de fila preservam um run lógico e observations idênticas são deduplicadas no mesmo run.
- Metadata de SecretReference passa a exigir persistência interna controlada, sem material secreto.
- O framework requer uma migration expand-only futura, autorizada separadamente.
- Network Discovery continua estável enquanto primitives comuns evoluem.
- O primeiro connector poderá validar o desenho sem introduzir LDAP no contrato genérico.

## Security / Operational Considerations

- `SecretReference != SecretMaterial` permanece obrigatório.
- Nenhum segredo resolvido pode entrar em PostgreSQL, pg-boss, logs, `AuditLog` ou evidence.
- O worker não é o trigger actor e não recebe autorização implícita.
- Provider credential não é Service Actor.
- Configuração JSONB será versionada, limitada, allowlisted e validada antes de persistência e uso.
- Erros persistidos serão apenas classificações sanitizadas.
- Exatamente uma vez para efeitos externos não é garantido.
- Default-deny e permissions explícitas permanecem obrigatórios.

## Reconsider When

- Um provider real exigir checkpoint ou cursor durável.
- Volume de evidence justificar staging ou batch persistido próprio.
- Isolamento de execução exigir workers ou bancos separados.
- Configuração JSONB deixar de oferecer integridade suficiente.
- Lifecycle/rotation de secret references exigir novo provider ou API administrativa sensível.
- Network Discovery e connectors demonstrarem semânticas suficientemente equivalentes para
  convergência.

## Related Decisions

ADR-009, ADR-010, ADR-011, ADR-012, ADR-013 e ADR-016.
