# Connector Framework Core

## Estado e escopo

O Connector Framework implementa a fronteira interna definida pela ADR-017 e o control plane v1
definido pela ADR-018. Ele registra tipos de connector em código, administra instances autenticadas,
cria uma execução lógica durável e processa observações provider-neutral pela ingestão
evidence-first compartilhada. O registro de produção permanece deliberadamente vazio: ainda não há
connector real, UI ou scheduler.

## Fluxo

```text
caller interno autorizado no futuro
→ ConnectorRunService.create()
→ ConnectorRun(QUEUED) + enqueue na mesma transação PostgreSQL
→ worker do ConnectorDefinition
→ RUNNING
→ validação da configuração versionada
→ resolução em memória de SecretReference por slot semântico
→ stream de ConnectorObservation
→ validação, redação e chave semântica
→ ingestão normalizada compartilhada
→ AssetEvidence + reconciliação evidence-first
→ COMPLETED | PARTIAL | FAILED
```

Retry do pg-boss preserva o mesmo `runId`. O fingerprint da solicitação é canônico e o replay da
mesma criação lógica não enfileira outro job. O `connectorObservationKey` impede que o replay exato
da mesma observação no mesmo run duplique evidence.

O payload registra tanto `configurationVersion` (versão do schema da configuração) quanto
`instanceVersion` (revisão mutável e token de concorrência da instance). Antes de validar a
configuração, resolver secrets ou chamar o provider, o worker verifica, nesta ordem, se a instance
está habilitada, se a revisão permanece corrente e se as versões de schema do payload, instance e
definition são compatíveis. Uma revisão alterada termina sem retry com
`CONNECTOR_INSTANCE_CHANGED`, como `FAILED` ou `PARTIAL` quando já existe evidence durável.

Uma edição normal de valores da configuração incrementa apenas `version`; ela não altera
`configurationVersion`. Toda mutation do aggregate, inclusive uma troca de SecretReference,
incrementa `version` exatamente uma vez e invalida jobs enfileirados sob a revisão anterior.

## Control plane v1

As rotas autenticadas são:

```text
GET    /connectors/definitions
GET    /connectors/instances
POST   /connectors/instances
GET    /connectors/instances/:id
PATCH  /connectors/instances/:id
PUT    /connectors/instances/:id/secret-references/:slot
DELETE /connectors/instances/:id/secret-references/:slot
POST   /connectors/instances/:id/runs
GET    /connectors/runs
GET    /connectors/runs/:id
```

`connector:read` protege as consultas; `connector:configure`, as mutations administrativas; e
`connector:execute`, a solicitação de runs. VIEWER recebe read, ANALYST recebe read/execute e ADMIN
recebe as três. Service Actors continuam recebendo somente permissions explicitamente registradas,
e `atlas:access` permanece obrigatório e independente.

Todas as mutations usam `expectedVersion` e lock de linha; conflito retorna
`CONNECTOR_INSTANCE_VERSION_CONFLICT`. Configuração é JSON não secreto limitado a 65.536 bytes,
validado primeiro pela fronteira genérica e depois pela definition. Chaves com forma de segredo e
objetos locator são rejeitados recursivamente. Respostas refletem apenas configuração já validada;
AuditLog recebe somente fingerprint SHA-256 e metadados administrativos seguros.

Secret locators entram exclusivamente pelo PUT administrativo e nunca voltam em respostas ou
AuditLog. Apenas slots declarados podem ser configurados. Remover um slot obrigatório de uma
instance habilitada também a desabilita na mesma transação e incrementa a revisão uma única vez.
Management não resolve material nem testa conectividade.

Runs `REQUESTED` exigem `Idempotency-Key` ASCII seguro. A criação do `ConnectorRun`, o enqueue no
pg-boss e `CONNECTOR_RUN_REQUESTED` são atômicos. Replay da mesma solicitação devolve o mesmo run e
não duplica job nem AuditLog. O valor bruto da chave, seu fingerprint e o ID interno do job não são
expostos.

## Fronteiras

- `ConnectorDefinition` é code-owned, imutável após o registro e não é persistida.
- `ConnectorObservation` existe somente no runtime; não há staging genérico no banco.
- O contexto do connector contém configuração não secreta validada, IDs, `AbortSignal`, relógio,
  logger seguro e resolução limitada aos slots declarados.
- O connector não recebe Prisma, pg-boss, request HTTP, ator, token nem registry de secrets.
- `SecretReference != SecretMaterial`: locator e valor resolvido não entram em job, observation,
  evidence, AuditLog ou log operacional.
- O worker não impersona o trigger actor. A proveniência segura já persistida permanece no
  `ConnectorRun`.
- Claim/entrega do job não garante efeito externo exatamente uma vez. Connectors que vierem a
  produzir efeitos externos continuarão obrigados a implementar idempotência no destino.

## Ingestão compartilhada

`IngestionService.ingestNormalizedAsset()` concentra a reconciliação existente de Asset,
AssetEvidence, atributos, interfaces, conflitos e timeline. O endpoint manual apenas converte seu
DTO para esse contrato interno; o Core converte uma observation validada para o mesmo contrato.

Observações individuais não criam `AuditLog` de alto volume. A evidence recebe `connectorRunId` e
`connectorObservationKey`, preservando a rastreabilidade até a instance por meio do run.
O `source` de connector é estável e instance-scoped no formato
`connector:<connectorType>:<connectorInstanceId>`, sem nome de exibição, endpoint ou locator.

O payload source-faithful preserva `observedAt`, mas o semantic fingerprint usa uma representação
separada que exclui tempo de observação, run e instance. Assim, a mesma semântica observada em outro
instante dentro do mesmo run mantém a mesma chave, enquanto outro run ou conteúdo materialmente
alterado produz a separação apropriada.

## Lifecycle e contadores

```text
QUEUED → RUNNING → COMPLETED | PARTIAL | FAILED | CANCELLED
```

- todas as observations aceitas: `COMPLETED`;
- pelo menos uma aceita e outra rejeitada, ou falha final após evidence durável: `PARTIAL`;
- nenhuma aceita e rejeição/falha terminal: `FAILED`;
- falha antes da última tentativa mantém `RUNNING` para o retry do mesmo run;
- run já terminal é idempotente e não é processado novamente.

Erros determinísticos do framework e erros de secret não transitórios são não retryable e
terminalizam imediatamente como `FAILED` ou `PARTIAL`. Indisponibilidade do secret provider e falhas
genéricas de coleta continuam retryable; nas tentativas intermediárias o run permanece `RUNNING`, e
na tentativa final o estado terminal é persistido antes de relançar a falha ao pg-boss.

Os contadores persistidos são recalculados a partir das evidences duráveis sempre que possível,
reduzindo duplicação após falha entre ingestão e acknowledgement.

Quando o próprio handler observa a tentativa final, ele persiste `FAILED` ou `PARTIAL` e o erro
sanitizado antes de relançar a falha para que o pg-boss faça o roteamento normal. O Core não
registra worker, não reivindica jobs e não altera itens da DLQ; a fila permanece disponível para
inspeção, alertas, retenção e redrive operacional.

Falhas de infraestrutura que impedem o handler de persistir o estado terminal — como hard kill,
expiração, perda de heartbeat ou fencing por partição de rede — podem deixar o `ConnectorRun` em
`RUNNING` mesmo após o pg-boss esgotar o job. O reconciliador do ADR-019 observa somente metadados
correlacionados por `singletonKey = runId`, sem claim, payload ou consumo da DLQ. Trabalho source
`created`, `retry` ou `active` sempre vence evidência terminal antiga; falha source comprovadamente
esgotada ou cópia correlacionada na DLQ autoriza reparo. Ausência só autoriza reparo após retenção da
source mais a janela de graça. Estados ambíguos falham fechados.

O reparo recalcula `ingestedCount` por `AssetEvidence`, preserva rejeições persistidas e usa update
condicional sobre `QUEUED|RUNNING`, permitindo no máximo uma transição terminal entre réplicas ou
na corrida com o worker. Ele não cria `AuditLog`, não altera o trigger actor e não inventa
`startedAt`; persiste somente `PARTIAL|FAILED` com `CONNECTOR_EXECUTION_ABANDONED`.

Neste candidato de estabilização, readiness técnico valida continuamente schema 42 e drift com
probe limitada, cacheada e single-flight. Snapshots internos agregados distinguem `created`, `retry`, `active`, `failed`, idade
do item pronto mais antigo e profundidade da DLQ, sem ler payload. Backlog e DLQ geram warnings, mas
não tornam `/health/ready` indisponível. Retenções source e DLQ são independentes e configuráveis.

## Itens futuros explícitos

- scheduler real e reconciliação de schedules;
- cancelamento/redrive administrativos e AuditLog correspondente;
- teste de conexão;
- primeiro connector AD DS;
- checkpoint/cursor persistente;
- exportação de métricas/telemetria externa e runbooks operacionais de produção.
