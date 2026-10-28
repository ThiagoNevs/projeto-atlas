# ADR-019: Estabilização de produção da execução de conectores

- Status: Accepted
- Data: 2026-10-28
- Decisores: Arquitetura e Engenharia do Atlas
- Relacionados: ADR-012, ADR-017 e ADR-018

## Contexto

O Atlas já possui a fundação de execução durável baseada em PostgreSQL e
pg-boss, o núcleo do Connector Framework e o plano de controle de conectores.
A implementação atual inclui:

- pg-boss fixado em `12.33.6`, com schema de infraestrutura `42`;
- migração explícita do schema do pg-boss, separada das migrations Prisma;
- workers iniciados com `migrate: false`;
- comando explícito `pnpm --filter @atlas/api connector-execution:migrate`;
- verificação fail-closed da versão e do drift do schema na inicialização;
- criação atômica de `ConnectorRun` e enqueue dentro da mesma transação PostgreSQL;
- retries, backoff, dead-letter queue e redrive explícito;
- profundidade da fila, contagens active/failed e timestamp/idade do job pronto mais antigo;
- duração dos jobs em logs estruturados;
- pool dedicado limitado, com padrão 2 e máximo 10 conexões por réplica;
- encerramento gracioso dos workers;
- estado operacional da fila sem leitura de payloads;
- fronteira `SecretReference != SecretMaterial`;
- autenticação, autorização e proveniência de ator preservadas pelo plano de controle.

Essas capacidades são necessárias, mas não são suficientes para declarar a execução de conectores
pronta para produção. Ainda é necessário formalizar o contrato de readiness, observabilidade,
retenção, capacidade, recuperação de runs abandonados e operação da DLQ.

Este ADR define esse contrato. Ele não declara o go-live concluído e não introduz um conector real.

## Decisão

### 1. Readiness técnico e saúde da carga

O readiness técnico da execução de conectores será positivo somente quando:

1. o PostgreSQL estiver alcançável;
2. o schema do pg-boss estiver inicializado;
3. a versão do schema for exatamente `42` para a versão fixada do pg-boss;
4. a detecção de drift não encontrar incompatibilidade.

O runtime deverá executar uma sondagem de compatibilidade limitada e com cache, para que o
readiness valide versão e drift sem fazer trabalho ilimitado a cada requisição. Falha, timeout ou
resultado ambíguo nessa sondagem falham fechado.

Backlog, jobs antigos ou presença de itens na DLQ são sinais de saúde da carga, mas não tornam o
processo tecnicamente indisponível. Esses sinais devem gerar alertas operacionais separados do
readiness, evitando que degradação operacional provoque loops de restart.

As únicas rotas públicas de saúde permanecem `/health`, `/health/live` e `/health/ready`. Nenhuma
rota pública adicional é criada por esta decisão.

### 2. Ordem obrigatória de implantação

Cada instalação Dedicated seguirá esta ordem:

1. executar o comando explícito de migração do pg-boss;
2. confirmar a versão esperada e a ausência de drift;
3. iniciar os workers com `migrate: false`;
4. aguardar readiness técnico positivo;
5. liberar tráfego e criação de runs.

Workers não assumem propriedade implícita sobre upgrades do schema. O schema do pg-boss permanece
infrastructure-owned e fora das migrations Prisma do Atlas.

O passo 1 usa `pnpm --filter @atlas/api connector-execution:migrate`, ou seu equivalente versionado
no repositório. O runtime normal não executa DDL.

### 3. Observabilidade operacional da fila

O snapshot operacional deve cobrir a fila de origem e sua DLQ, sem materializar payloads, e conter
no mínimo:

- quantidade `queued`/`created`;
- quantidade `active`;
- quantidade `retry`;
- quantidade `failed`;
- quantidade total relevante;
- instante de captura;
- job elegível mais antigo;
- idade, em milissegundos, do job elegível mais antigo;
- profundidade da DLQ.

O formato deve ser estruturado e seguro para logs. Este ADR não cria endpoint público de métricas,
nova permission, Prometheus, OpenTelemetry ou integração com SIEM.

Os limiares iniciais de warning são:

- job pronto mais antigo com idade maior ou igual a `300` segundos;
- profundidade da DLQ maior ou igual a `1`.

Os limiares serão configuráveis: idade entre 60 e 86400 segundos e profundidade entre 1 e 100000
jobs. Valores fora desses limites falham na validação da configuração. Eles não alteram o readiness
técnico.

Logs estruturados de início, conclusão e falha de execução devem incluir o contexto de retry
disponível, incluindo `retryCount` e `retryLimit`, além dos identificadores seguros de run, job e
connector. Quando aplicável, falhas podem expor somente classificações seguras e limitadas, como
`errorCode`, `errorType`, `retryCount`, `retryLimit`, `durationMs`, `runId`, `jobId`, `queueName` e
`correlationId`.

Esses logs não podem conter `Idempotency-Key`, `requestIdentity` ou identidade idempotente bruta
equivalente, `error.message` bruto do provider, mensagem bruta de exceção do provider, stack com
material do provider, diagnósticos brutos de credencial ou provider, configuração,
`SecretReference`, `logicalKey`, material secreto, resposta do provider, payload da fila ou
`DATABASE_URL`.

### 4. Retenção e limpeza

A retenção padrão será:

- fila de origem: `604800` segundos, ou 7 dias;
- DLQ: `2592000` segundos, ou 30 dias.

Ambas serão configuráveis, com valores inteiros entre 1 e 90 dias. A DLQ possui retenção maior por
padrão para permitir investigação e redrive controlado.

A limpeza permanece responsabilidade do pg-boss. Tabelas ou jobs do pg-boss não serão modelados
pelo Prisma do Atlas.

### 5. Capacidade e conexões

O pool dedicado do pg-boss permanece separado do pool Prisma, com padrão de 2 e máximo de 10
conexões por réplica, sujeito a configuração validada.

O orçamento de conexões de uma instalação deve considerar, no mínimo:

```text
conexões totais esperadas =
  réplicas da API × pool Prisma por réplica
  + réplicas de worker × pool pg-boss por réplica
  + conexões operacionais e margem de segurança
```

O número de réplicas e os limites de pool devem ser aprovados contra `max_connections` antes do
go-live. O Atlas não assume que o compartilhamento do mesmo PostgreSQL implica compartilhamento do
mesmo pool.

Para uma aplicação em que API e worker compartilham a réplica, a aproximação mínima é:

```text
(pool Prisma + pool Connector Execution) × número de réplicas
+ conexões operacionais + margem de segurança
```

A configuração efetiva não secreta do pool pode ser registrada no startup. `DATABASE_URL` nunca
pode ser registrada, e nenhum segundo pool pg-boss será introduzido por esta estabilização.

### 6. Política da DLQ

A DLQ não terá worker, claim automático, consumidor automático ou redrive automático. Ela é uma
superfície operacional passiva.

O redrive continuará sendo uma primitiva explícita de operador e deverá manter idempotência e
correlação. Este ADR não cria API pública, UI ou scheduler para redrive.

### 7. Semântica de entrega e efeitos externos

O claim e a entrega durável de um job não equivalem a efeito externo exatamente uma vez:

```text
garantia de claim/entrega do job
!=
efeito de negócio externo exatamente uma vez
```

Uma falha após o efeito externo e antes do acknowledgement pode causar nova execução. Handlers de
conectores devem ser idempotentes e usar chaves de idempotência quando o sistema externo permitir.

A proteção interna do Atlas contra replay continua usando os mecanismos existentes de deduplicação
de evidence e observation, incluindo fingerprint semântico da observation e
`connectorObservationKey`/deduplicação de evidence. Essa proteção reduz efeitos duplicados no estado
e nas evidências do Atlas quando o trabalho é repetido, mas não converte efeitos externos no provider
em semântica exatamente uma vez. A idempotência do handler continua obrigatória.

### 8. Correlação comprovada entre run, job e DLQ

Um spike controlado com PostgreSQL 17, pg-boss `12.33.6` e schema `42` comprovou:

- `singletonKey = ConnectorRun.id` correlaciona o job da fila de origem;
- o job de origem preserva o mesmo `id` e `singletonKey` durante retry e falha;
- a cópia na DLQ preserva `singletonKey` e expõe `sourceName`, `sourceId` e `sourceRetryCount`;
- o job de origem terminou com `retryCount = 1` e `retryLimit = 1` no cenário medido;
- a cópia na DLQ foi criada com referência ao job de origem;
- a correlação pode ser feita sem ler o payload.

As APIs públicas do pg-boss são preferidas. Contudo, a API pública que localiza jobs também
materializa `data` e não oferece uma projeção limitada adequada para reconciliação em lote sem
payload.

Por isso, uma consulta SQL somente leitura e version-coupled é permitida para a reconciliação, sob
todas estas condições:

- limitada ao schema de infraestrutura do pg-boss;
- compatível explicitamente com pg-boss `12.33.6`, schema `42` e PostgreSQL 17;
- projeção somente de metadados seguros, como `name`, `id`, `state`, `singletonKey`, `sourceName`,
  `sourceId`, `sourceRetryCount`, `startAfter`, `createdOn` e `completedOn`;
- nenhum payload recuperado;
- nenhuma escrita direta nas tabelas do pg-boss;
- nenhuma modelagem Prisma dessas tabelas;
- falha fechada se a compatibilidade de versão/schema não puder ser provada.

### 9. Reconciliação de ConnectorRun abandonado

Um reconciler não consumidor deverá detectar `ConnectorRun` persistido como `QUEUED` ou `RUNNING`
quando o estado durável da fila já é terminal ou quando o registro de fila deixou de existir após
sua janela de retenção.

O problema atual pode ocorrer após hard kill do processo, expiração de heartbeat, expiração do
worker ou interrupção de infraestrutura fora do `catch/finally` do handler. Nesses casos, o pg-boss
pode esgotar e terminalizar o job, ou copiá-lo para a DLQ, enquanto o domínio permanece `RUNNING`.

O reconciler:

- não executa jobs;
- não faz claim;
- não lê payloads;
- não resolve `SecretReference` nem material secreto;
- não acessa credenciais de provider;
- não invoca `ConnectorDefinition.collect()`;
- não faz chamadas de rede ou ao provider;
- não redrive automaticamente;
- não altera runs já terminais;
- não cria `AuditLog` por item reconciliado.

O reconciler não personifica o ator que disparou o run nem reutiliza proveniência `HUMAN` ou
`SERVICE` para executar ações. `ConnectorRun.triggerActorType` e `ConnectorRun.triggerActorId`
permanecem apenas como proveniência histórica. A reconciliação é reparo de lifecycle de
infraestrutura e não introduz ator humano ou de serviço artificial.

Estados vivos `created`, `retry` e `active` não podem provocar terminalização. Um job de origem em
estado terminal `failed`, ou uma cópia correlacionada na DLQ, constitui evidência durável suficiente
para reconciliar o run.

Quando houver evidência terminal, o run deverá terminar como:

- `PARTIAL`, se já houver observações duráveis associadas ao run;
- `FAILED`, caso contrário.

A reconciliação deverá registrar:

- `errorCode = CONNECTOR_EXECUTION_ABANDONED`;
- contagens duráveis atuais;
- `finishedAt`;
- incremento de versão;
- log estruturado seguro com a fonte da evidência.

A atualização deve ser condicional a `status IN (QUEUED, RUNNING)`. Essa condição é a barreira
final contra corrida entre worker e reconciler, inclusive com múltiplas réplicas; não haverá leader
election como requisito inicial.

Se não houver mais registro correlacionado na fila ou DLQ, a ausência só poderá ser tratada como
evidência depois de uma janela conservadora:

```text
instante de elegibilidade =
  max(createdAt do run, scheduledFor quando aplicável)
  + retenção configurada da fila de origem
  + grace period de ausência
```

O grace period padrão será 24 horas, configurável entre 1 hora e 7 dias. Runs agendados no futuro
não são elegíveis antes de seu instante de execução. A ausência dentro da retenção ou do grace
period permanece inconclusiva.

O processamento será limitado a no máximo 100 runs por ciclo, dos mais antigos elegíveis para os
mais novos. O intervalo padrão será 60 segundos, configurável entre 15 e 3600 segundos. Ciclos não
podem se sobrepor na mesma réplica.

Os eventos operacionais serão `connector_execution.reconciliation.started`,
`connector_execution.reconciliation.completed`, `connector_execution.run.reconciled` e
`connector_execution.reconciliation.failed`. Metadados permitidos se limitam a `runId`,
`queueName`, classificação segura do estado de infraestrutura, `durationMs`, quantidade inspecionada
e quantidade reconciliada. Configuração do connector, `logicalKey`, `SecretReference`, segredo,
resposta do provider, payload e erro bruto de banco não podem ser registrados.

### 10. Snapshot operacional interno

O modelo interno seguro terá forma equivalente a:

```text
execution:
  enabled
  ready
  status
  schemaVersion
  workerCount
  poolMax

queues[]:
  queueName
  queued
  active
  failed
  total
  oldestReadyAgeMs?
  deadLetterQueued?
```

O snapshot não contém payload, `SecretReference`, material secreto ou resposta de provider. Ele não
implica endpoint público.

### 11. Limites desta decisão

Esta decisão não implementa:

- reconciler, novos logs ou novas configurações;
- API, controller, UI ou permission de operação;
- scheduler de conectores;
- conector real ou definição de produção;
- redrive automático;
- Prometheus, OpenTelemetry ou SIEM;
- nova migration Prisma ou modelagem das tabelas do pg-boss;
- garantia de exatamente uma vez para efeitos externos.

O estado de go-live continua pendente até que os controles descritos aqui sejam implementados,
testados e validados operacionalmente. O ambiente permanece com zero ConnectorDefinitions de
produção e sem credencial operacional introduzida por esta decisão.

Nenhum connector AD DS, Entra ID, Intune, Defender ou Azure é introduzido. A quantidade de
ConnectorDefinitions de produção permanece zero.

## Consequências

### Positivas

- separa disponibilidade técnica de saúde da carga;
- torna explícita a propriedade operacional do schema do pg-boss;
- define retenção e orçamento de conexões antes do go-live;
- oferece uma recuperação conservadora e race-safe para runs abandonados;
- preserva a fronteira entre infraestrutura da fila e domínio Atlas;
- mantém payloads e segredos fora da observabilidade operacional.

### Custos e riscos

- a projeção SQL de metadados cria acoplamento explícito à versão/schema do pg-boss e exige
  revalidação em upgrades;
- o reconciler é eventualmente consistente e pode levar retenção mais grace period para concluir
  ausência;
- alertas baseados em logs dependem da plataforma operacional da instalação;
- a capacidade continua dependente de dimensionamento por implantação.

## Evidência necessária para implementação

A implementação futura deverá provar, no mínimo:

- readiness falha com versão incorreta ou drift e permanece positivo com backlog ou DLQ;
- snapshots não recuperam payload;
- limiares e retenções rejeitam valores fora dos limites;
- correlação funciona para source job, retry, failed e DLQ;
- estados vivos não terminalizam runs;
- reconciliação terminal é condicional, idempotente e segura sob corrida;
- ausência respeita retenção, grace period e agendamento futuro;
- múltiplas réplicas convergem por update condicional;
- shutdown e pools não vazam conexões;
- nenhum segredo aparece em logs, erros ou payloads de observabilidade.
