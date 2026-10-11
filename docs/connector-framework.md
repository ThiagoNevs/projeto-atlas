# Connector Framework Core

## Estado e escopo

O Core do Connector Framework implementa a fronteira interna definida pela ADR-017. Ele registra
tipos de connector em código, cria uma execução lógica durável e processa observações
provider-neutral pela ingestão evidence-first compartilhada.

Este incremento não expõe API, controller, permission, UI ou scheduler e não contém connector real.
O registro inicial da aplicação é deliberadamente vazio.

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

O payload mínimo registra a `configurationVersion` aceita no enqueue. Antes de validar configuração,
resolver secrets ou chamar o provider, o worker confirma que a instance continua habilitada e que a
versão enfileirada ainda corresponde à versão corrente. Instance desabilitada, configuração alterada
ou versão não suportada terminam o run de forma fail-closed e sem retry determinístico.

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
`RUNNING` mesmo após o pg-boss esgotar o job. Reconciliação não consumidora para esses runs não é
implementada neste incremento e permanece uma limitação do gate de estabilização do Connector
Execution. O gate continua `PENDING` e o Core ainda não estabelece prontidão para go-live.

## Itens futuros explícitos

- API/controllers e permissions `connector:*`;
- scheduler real e reconciliação de schedules;
- cancelamento/redrive administrativos e AuditLog correspondente;
- primeiro connector AD DS;
- checkpoint/cursor persistente;
- observabilidade produtiva, runbooks e fechamento do gate de estabilização da execução.
