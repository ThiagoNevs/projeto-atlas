# Desenho do fluxo persistido de revisão de achados

## 1. Status da decisão

- **Status:** proposta arquitetural para aprovação.
- **Escopo:** desenho e documentação; nenhuma implementação funcional.
- **Política de origem:** `2026-07-conflict-v1`.
- **Estado atual:** findings derivados, recalculados em memória e somente leitura.
- **Recomendação:** modelo híbrido com uma entidade própria `FindingReviewCase`.
- **Regra central:** persistir a investigação e a decisão humana sem transformar a decisão em
  evidência técnica ou alteração automática do inventário.

Este documento não cria casos, fila, responsáveis, SLA, comentários, decisões, endpoints, tabelas
ou migrations. Todos os contratos e schemas abaixo são propostas para PRs futuros e dependem de
aprovação explícita, especialmente antes de qualquer alteração no Prisma.

## 2. Contexto e objetivo

O Atlas já deriva findings de identidade e rede por meio de:

- `GET /assets/:id/conflict-analysis`;
- `GET /conflict-analysis/findings`;
- política determinística `2026-07-conflict-v1`;
- interface somente leitura `/conflict-findings`.

Os findings possuem `findingId` determinístico, são explicáveis, permanecem em modo `SHADOW` e não
geram escrita. Eles podem desaparecer ou mudar quando as evidências, os ativos ou a política mudam.

O objetivo futuro é permitir que uma pessoa crie explicitamente um caso, preserve o contexto
analisado, registre a investigação e chegue a uma conclusão auditável. A primeira versão persistida
deverá continuar sem alterar hostname, IP, atributos, interfaces, evidências ou status do ativo.

## 3. Domínio atual inspecionado

### 3.1 Findings derivados

O módulo `conflict-analysis` projeta os ativos e suas observações de hostname e IP, normaliza os
valores e calcula em memória três tipos de finding:

- `DUPLICATE_HOSTNAME_ACROSS_ASSETS`;
- `SHARED_IP_DIFFERENT_HOSTNAMES`;
- `HOSTNAME_DIVERGENCE_ON_ASSET`.

Cada finding contém ativos afetados, observações, fontes, referências opcionais a evidências,
contexto temporal, explicações, limitações e opções de revisão. O `findingId` é um hash derivado do
tipo e do conteúdo material do finding. Portanto, uma mudança material pode produzir outro ID.

Não existe escrita em `Conflict`, `AuditLog`, `AssetEvent` ou no inventário durante a análise. A
listagem agregada também é recalculada em memória e deduplicada pelo `findingId`.

### 3.2 Entidade `Conflict`

`Conflict` representa hoje um conflito formal ligado a exatamente um `Asset`. Seus principais
campos são:

- `conflictType`, `attributeKey`, `status`, `severity` e `impact`;
- sugestão, motivo da sugestão, valor e nota de resolução;
- datas de detecção e resolução e contador de ocorrências;
- coleção `ConflictValue`, que pode referenciar `AssetEvidence`.

Os estados persistidos são `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED`, `EXCEPTION` e `DISMISSED`.
O DTO/API atual aceita alterações para `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED` ou `EXCEPTION`.
O formulário frontend oferece somente `IN_REVIEW`, `RESOLVED`, `IGNORED` e `EXCEPTION`;
`DISMISSED` existe no schema, mas não está na lista editável do DTO nem do formulário.

Conflitos são criados pela ingestão e pelo Network Discovery Lite para cenários formais de ciclo de
vida e identidade de rede. A deduplicação atual procura um conflito `OPEN` equivalente antes de
criar ou incrementar ocorrências. Não existe constraint única que elimine uma corrida entre duas
criações concorrentes.

### 3.3 Resolution Center

O Resolution Center opera sobre `Conflict`, não sobre findings derivados. Ele oferece:

- `GET /conflicts` com busca, filtros, ordenação e paginação;
- `GET /conflicts/:id` com ativo, valores e parte da timeline;
- `PATCH /conflicts/:id/status` com status, motivo e comentário obrigatórios.

A mudança de status é transacional: atualiza `Conflict`, cria `AssetEvent` do tipo
`CONFLICT_STATUS_CHANGED` e cria `AuditLog`. Para conflitos de ciclo de vida, a resolução é
bloqueada enquanto o ativo permanece administrativamente encerrado.

Limitações para o novo fluxo:

- vínculo com um único ativo;
- ausência de `findingId`, `policyVersion` e snapshot;
- ausência de responsável, comentários próprios e decisão tipada;
- ausência de staleness e comparação com o finding atual;
- ausência de versionamento ou precondição contra concorrência;
- nota de resolução única, que não preserva uma conversa estruturada;
- o `AssetEvent` mistura o tratamento do conflito com a timeline do ativo.

### 3.4 Auditoria, autenticação e concorrência

`AuditLog` é um registro genérico com ator, ação, entidade, estado anterior/posterior, metadata e
timestamp. Ele é adequado como trilha global, mas não substitui um histórico navegável e fortemente
relacionado ao caso.

O MVP não possui autenticação, autorização, guard, JWT ou RBAC. Ações atuais usam o ator simulado
`atlas-mvp-user`. Logo, a implementação persistida não deverá ser liberada como fluxo produtivo sem
identidade autenticada e autorização mínima.

As mudanças atuais usam transação, mas não usam `version`, ETag, `If-Match` ou update condicional.
Duas pessoas podem ler o mesmo estado e a última gravação prevalecer. Esse padrão não é suficiente
para decisões de revisão.

## 4. Alternativas arquiteturais

### 4.1 Alternativa A — reutilizar `Conflict`

**Vantagens**

- aproveita listagem, detalhe, status e auditoria existentes;
- reduz o número inicial de entidades e telas;
- integra-se diretamente ao Resolution Center atual.

**Desvantagens e riscos**

- mistura um indício derivado com um conflito já formalizado;
- força um finding multiativo a escolher um único `assetId` principal;
- estados atuais não representam espera por evidência ou staleness;
- exigiria muitos campos novos e mudaria a semântica de registros existentes;
- o Resolution Center poderia sugerir que todo finding já é conflito confirmado;
- retrocompatibilidade e migration seriam mais arriscadas;
- comentários, snapshots, decisões e locking continuariam artificiais no mesmo agregado.

**Conclusão:** não recomendada como entidade primária da investigação.

### 4.2 Alternativa B — nova entidade isolada

Uma entidade como `FindingReviewCase` separa o finding derivado do conflito formal, preserva
snapshot, suporta múltiplos ativos e permite estados próprios.

**Vantagens**

- semântica clara;
- evolução independente;
- histórico e concorrência adequados ao caso;
- não altera o comportamento de `Conflict` nem do Resolution Center.

**Desvantagens e riscos**

- adiciona tabelas, endpoints, tela e autorização próprios;
- pode duplicar conceitos de status e auditoria;
- sem uma regra de integração, casos e conflitos podem divergir.

**Conclusão:** boa base, mas precisa definir a relação futura com `Conflict`.

### 4.3 Alternativa C — modelo híbrido

O modelo híbrido usa `FindingReviewCase` para investigação e mantém `Conflict` como conflito formal.
Um caso poderá, após decisão explícita e autorização adequada, referenciar ou solicitar a criação de
um `Conflict`. Isso não ocorrerá automaticamente na primeira versão.

**Vantagens**

- preserva a distinção entre indício e conflito confirmado;
- protege os contratos existentes;
- permite múltiplos ativos, snapshot, decisão e staleness;
- permite integração gradual com o Resolution Center;
- mantém a execução de ações sobre o inventário em um fluxo separado.

**Desvantagens e riscos**

- exige governança para evitar duplicação de filas;
- aumenta o número de relações e estados;
- demanda UX clara para distinguir finding, caso e conflito.

### 4.4 Recomendação

Adotar a **alternativa C**, com `FindingReviewCase` como agregado de investigação. `Conflict` não
deverá ser criado na abertura do caso. Uma conclusão futura poderá propor a formalização de um
conflito, mas a criação deverá ser explícita, autorizada, idempotente e auditada.

## 5. Modelo de domínio recomendado

### 5.1 Conceitos separados

| Conceito | Natureza | Persistência | Pode alterar inventário |
| --- | --- | --- | --- |
| Finding | análise derivada e temporária | não | não |
| FindingReviewCase | investigação humana | sim, no futuro | não |
| ReviewDecision | conclusão humana contextual | sim, no futuro | não |
| Conflict | divergência formal do domínio atual | sim | não diretamente |
| InventoryChangeRequest | proposta futura de ação | futuro | somente após aprovação e execução |
| Evidência técnica | observação de uma fonte | sim | alimenta o estado técnico por regras existentes |

### 5.2 Agregado do caso

O caso proposto deverá conter:

- identidade e tipo do caso;
- `findingId`, `policyVersion` e tipo do finding na criação;
- snapshot imutável do finding original;
- hash e versão do snapshot;
- vínculos com todos os ativos afetados;
- estado do caso e estado de staleness;
- responsável opcional;
- conclusão de identidade atual e componentes estruturados, preservados em histórico próprio;
- justificativa da decisão e limitações explícitas;
- versão para concorrência otimista;
- timestamps e atores;
- histórico append-only de eventos;
- comentários humanos separados de referências técnicas;
- vínculo opcional futuro com `Conflict` formal.

## 6. Relação entre finding e caso

A criação deverá ocorrer somente pela ação explícita **Criar caso de revisão**.

Fluxo recomendado:

1. o cliente envia `findingId`, `policyVersion` visualizada e uma chave de idempotência;
2. o backend recalcula os findings usando a política atual;
3. o backend localiza o finding pelo ID e confirma a paridade material;
4. se ele não existe ou mudou, retorna `409 Conflict` com orientação para atualizar a análise;
5. calcula no servidor a `reviewSubjectKey` estável para o assunto investigado;
6. verifica se já existe caso ativo para a mesma `reviewSubjectKey`;
7. tenta criar o caso em transação, usando constraint como proteção final contra corrida;
8. armazena snapshot e hash, relações com ativos, evento versionado e auditoria;
9. retorna o caso criado, o resultado anterior da mesma chave idempotente ou `409` com o caso ativo
   existente, conforme autorização.

O snapshot original deverá preservar:

- `findingId`, `policyVersion`, tipo e `generatedAt`;
- ativos afetados;
- hostname e IP normalizados;
- observações relevantes e referências de evidência;
- fontes e tipos de fonte;
- contexto temporal;
- explicações, limitações e opções de revisão;
- contagem de observações;
- hash canônico do conteúdo.

O caso não dependerá de o finding continuar existindo. A referência ao finding atual, o snapshot
original, a análise recalculada e a decisão humana serão apresentados como conceitos distintos.

## 7. Staleness e atualização da análise

### 7.1 Estados propostos

- `CURRENT`: o finding recalculado corresponde materialmente ao snapshot mais recente.
- `CHANGED`: o finding ainda existe, mas ativos, observações ou contexto mudaram.
- `NO_LONGER_DETECTED`: a política atual não deriva mais o finding.
- `POLICY_VERSION_CHANGED`: a análise foi feita por outra versão de política.
- `ASSET_UNAVAILABLE`: ao menos um ativo necessário não está disponível.
- `REQUIRES_REFRESH`: não foi possível comparar com segurança ou a comparação nunca ocorreu.

Além do estado principal, o resultado de comparação deverá listar razões e diferenças. Quando mais
de uma condição ocorrer, recomenda-se a precedência:

1. `ASSET_UNAVAILABLE`;
2. `POLICY_VERSION_CHANGED`;
3. `NO_LONGER_DETECTED`;
4. `CHANGED`;
5. `CURRENT`.

`REQUIRES_REFRESH` representa ausência ou falha de comparação, não um resultado material.

### 7.2 Ação “Atualizar análise”

A atualização futura deverá:

- recalcular pela política corrente;
- preservar o snapshot original;
- armazenar novo snapshot de comparação e hash;
- mostrar ativos e observações adicionados/removidos;
- mostrar mudanças de hostname, IP, fonte, tempo e política;
- não apagar decisão ou comentário;
- não resolver, reabrir ou fechar o caso automaticamente;
- registrar `FINDING_REFRESHED` e, se aplicável, `FINDING_BECAME_STALE`.

Finding desaparecido não significa caso resolvido. Alteração de `findingId` também não deverá criar,
fechar ou reabrir casos sem regra explícita.

Quando o `findingId` mudar, mas a `reviewSubjectKey` permanecer igual, o caso deverá ser marcado como
alterado ou desatualizado, preservar o snapshot original e permitir refresh. Isso não criará outro
caso ativo automaticamente. Uma `reviewSubjectKey` diferente poderá representar outro assunto e
permitir novo caso; o caso anterior continuará histórico, sem relação ou mesclagem inferida.

Mudanças de hostname, IP, ativos afetados, observações ou contexto temporal resultam em `CHANGED`.
Ativo arquivado ou administrativamente encerrado continua referenciado e não encerra o caso. Se o
registro deixar de estar consultável, aplica-se `ASSET_UNAVAILABLE`. Uma futura mesclagem de ativos
deverá preservar os IDs do snapshot e produzir diferença explícita, sem redirecionamento silencioso.

## 8. Máquina de estados do caso

Estados recomendados:

- `OPEN`: criado e aguardando triagem;
- `IN_REVIEW`: investigação em andamento;
- `WAITING_FOR_EVIDENCE`: falta contexto técnico ou humano para concluir;
- `RESOLVED`: conclusão registrada com decisão válida;
- `DISMISSED`: o finding foi conscientemente dispensado com justificativa;
- `CANCELLED`: caso inválido ou criado indevidamente, com motivo administrativo.

### 8.1 Transições

| Origem | Destino permitido | Requisitos |
| --- | --- | --- |
| `OPEN` | `IN_REVIEW` | permissão de revisão; responsável recomendado |
| `OPEN` | `CANCELLED` | motivo obrigatório |
| `IN_REVIEW` | `WAITING_FOR_EVIDENCE` | contexto faltante e comentário obrigatório |
| `IN_REVIEW` | `RESOLVED` | decisão conclusiva, motivo e comentário |
| `IN_REVIEW` | `DISMISSED` | motivo e comentário; permissão de dispensa |
| `IN_REVIEW` | `CANCELLED` | motivo administrativo |
| `WAITING_FOR_EVIDENCE` | `IN_REVIEW` | nova informação ou retomada explícita |
| `WAITING_FOR_EVIDENCE` | `CANCELLED` | motivo administrativo |
| `RESOLVED` | `OPEN` | reabertura autorizada e justificativa |
| `DISMISSED` | `OPEN` | reabertura autorizada e justificativa |
| `CANCELLED` | `OPEN` | somente administrador/lead e justificativa |

`RESOLVED`, `DISMISSED` e `CANCELLED` são terminais até reabertura explícita. Staleness não muda o
status do caso automaticamente. `WAITING_FOR_EVIDENCE` deverá voltar a `IN_REVIEW` antes de uma
conclusão, evitando uma transição implícita sem retomada formal.

## 9. Decisões humanas

### 9.1 Conclusão de identidade

A conclusão principal responde somente se os registros investigados representam a mesma identidade:

- `SAME_ASSET`;
- `DIFFERENT_ASSETS`.

Esses valores são mutuamente exclusivos. Enquanto não houver evidência suficiente, a conclusão
permanecerá nula. **Recomendação:** não persistir `UNDETERMINED` como terceira verdade; ausência de
conclusão, combinada com o estado do caso e uma pendência estruturada, representa a indeterminação
sem confundi-la com decisão terminal.

A conclusão de identidade não altera ativos, vínculos, atributos ou qualquer outra informação do
inventário. Toda conclusão exige justificativa, ator, timestamp e versão esperada do caso.

### 9.2 Componentes estruturados da decisão

Uma decisão poderá conter zero ou mais componentes complementares, consultáveis e auditáveis:

- `HOSTNAME_CHANGED`;
- `IP_REUSED`;
- `SOURCE_DATA_INCORRECT`.

Os componentes podem coexistir entre si e com a conclusão de identidade. Regras mínimas:

- `SAME_ASSET` e `DIFFERENT_ASSETS` nunca coexistem;
- `HOSTNAME_CHANGED` pode qualificar `SAME_ASSET`;
- `IP_REUSED` normalmente qualifica `DIFFERENT_ASSETS`, mas não será inferido automaticamente;
- `SOURCE_DATA_INCORRECT` pode coexistir com qualquer conclusão;
- componentes não executam alterações no inventário ou na fonte;
- alterações de conclusão ou componentes incrementam a versão e preservam decisões anteriores.

Para `SOURCE_DATA_INCORRECT`, o componente deverá identificar o alvo quando o domínio fornecer uma
referência confiável: `sourceType`, `evidenceId`, referência de observação existente, atributo, valor
e justificativa. Nenhum ID será inventado. Quando não for possível identificar a fonte ou observação
exata, o componente deverá registrar uma limitação explícita, manter as referências opcionais nulas e
descrever somente o escopo conhecido na metadata minimizada.

### 9.3 Persistência recomendada da decisão

Recomenda-se uma entidade relacional imutável `FindingReviewDecision`, com uma coleção
`FindingReviewDecisionComponent`. A decisão registra a conclusão de identidade, justificativa, autor,
timestamp e versão do caso; cada componente registra seu tipo e referências opcionais seguras.

Essa alternativa permite índices, filtros, auditoria e referências a evidências sem depender de texto
livre. Um array ou JSON tipado exigiria menos tabelas, mas teria validação e índices mais fracos,
evolução de contrato mais arriscada e dificuldade para relacionar fonte, evidência ou observação.
Portanto, JSON poderá existir apenas como metadata complementar, não como representação primária dos
componentes.

Decisões anteriores não serão atualizadas nem apagadas. Uma mudança após reabertura criará nova
decisão e evento, mantendo a decisão anterior no histórico. Na fundação persistente inicial, a decisão
corrente é derivada deterministicamente pela maior `caseVersion`; não existe `currentDecisionId` no
caso. Um ponteiro explícito poderá ser introduzido futuramente se houver necessidade concreta, sem
substituir a coleção histórica.

### 9.4 Necessidade de mais evidências

`NEEDS_MORE_EVIDENCE` não é conclusão nem componente terminal. Ele corresponde a uma pendência
estruturada e à transição para `WAITING_FOR_EVIDENCE`, com descrição do contexto ausente. Não encerra
o caso e não compete com `SAME_ASSET` ou `DIFFERENT_ASSETS`.

### 9.5 Efeito da decisão

Na primeira implementação, nenhuma decisão deverá automaticamente:

- alterar `Asset.name` ou `AssetAttribute`;
- alterar ou remover IP/MAC;
- apagar evidência;
- mesclar ou excluir ativos;
- mudar status operacional ou administrativo;
- corrigir a fonte;
- criar `Conflict` formal.

O fluxo futuro de ação deverá separar:

1. registrar conclusão;
2. propor ação;
3. aprovar ação;
4. executar ação em transação própria;
5. auditar resultado e eventuais falhas.

Uma decisão humana é contexto administrativo e não evidência técnica.

## 10. Auditoria e histórico

Eventos mínimos recomendados, alinhados ao padrão em maiúsculas do Atlas:

- `FINDING_REVIEW_CASE_CREATED`;
- `FINDING_REVIEW_CASE_ASSIGNED`;
- `FINDING_REVIEW_STARTED`;
- `FINDING_REVIEW_COMMENT_ADDED`;
- `FINDING_REVIEW_DECISION_RECORDED`;
- `FINDING_REVIEW_DECISION_CHANGED`;
- `FINDING_REVIEW_CASE_RESOLVED`;
- `FINDING_REVIEW_CASE_DISMISSED`;
- `FINDING_REVIEW_CASE_CANCELLED`;
- `FINDING_REVIEW_CASE_REOPENED`;
- `FINDING_REVIEW_REFRESHED`;
- `FINDING_REVIEW_BECAME_STALE`.

Cada evento deverá registrar caso, ator autenticado, timestamp, `versionBefore`, `versionAfter`,
estado anterior/posterior, conclusão anterior/posterior, justificativa e metadata minimizada. Na
criação, `versionBefore` será nula e `versionAfter` será `1`. Em qualquer mutação, `versionAfter`
deverá corresponder exatamente à versão persistida ao final da transação. Os JSONs `before` e `after`
são complementares e não substituem os campos explícitos de versão.

`AuditLog` deverá receber uma cópia segura dos eventos administrativos relevantes para consulta
global, contendo `caseId`, `eventId`, `versionBefore`, `versionAfter`, `eventType` e `requestId` quando
aplicável. A tabela específica de eventos do caso será a fonte estruturada do fluxo; `AuditLog`
permanecerá a trilha transversal do produto.

Uma mutação futura deverá, na mesma transação:

1. validar `version` ou `If-Match`;
2. atualizar o caso e incrementar a versão atomicamente;
3. aplicar relações de decisão ou componentes, quando existirem;
4. criar `FindingReviewEvent` com as versões anterior e posterior;
5. criar `AuditLog`;
6. confirmar a transação.

Se a versão não corresponder, nada será persistido, nenhum evento ou `AuditLog` de sucesso será
criado e a API retornará `409`, podendo informar a versão atual de forma segura.

Não deverão ser armazenados tokens, credenciais, payloads brutos desnecessários nem dados pessoais
sem finalidade. Comentários não deverão ser copiados para logs de aplicação.

## 11. Concorrência

Recomendação: locking otimista com `version` inteiro e precondição HTTP.

- respostas de detalhe incluem `version` e ETag;
- comandos mutáveis exigem `If-Match` ou `expectedVersion`;
- o update usa `WHERE id = ? AND version = ?` dentro de transação;
- sucesso incrementa `version` uma vez;
- zero registros atualizados retorna `409 Conflict`;
- a resposta `409` informa que o caso mudou e deve ser recarregado;
- criação de evento com `versionBefore`/`versionAfter` e de `AuditLog` ocorre na mesma transação.

Isso evita resolução simultânea, sobrescrita silenciosa e decisão sobre versão antiga. Comentários
também deverão usar idempotência e versão, ou uma estratégia append-only que não substitua outros
comentários.

## 12. Idempotência e unicidade do assunto

- **Criação:** exigir `Idempotency-Key`; uma chave repetida com o mesmo payload devolve o mesmo
  resultado, e payload diferente com a mesma chave retorna `409`.
- **Decisão/status:** a mesma chave e payload retornam o resultado anterior; payload diferente retorna
  `409`.
- **Comentário:** usar `requestId`/idempotency key para não duplicar em retry.
- **Refresh:** hash igual não cria snapshot duplicado; pode registrar somente a consulta, conforme
  política de auditoria aprovada.

### 12.1 `reviewSubjectKey`

O caso deverá armazenar uma chave determinística e versionada que represente o assunto investigado,
e não uma execução específica do finding:

`sha256("finding-review-subject:v1|" + findingType + "|" + canonicalSubject)`.

O `canonicalSubject` será calculado exclusivamente no servidor:

- `DUPLICATE_HOSTNAME_ACROSS_ASSETS`: `normalizedHostname` canônico;
- `SHARED_IP_DIFFERENT_HOSTNAMES`: `normalizedIp` canônico;
- `HOSTNAME_DIVERGENCE_ON_ASSET`: `assetId`.

Observações, timestamps, `evidenceId`, hostname atual e conjunto variável de ativos não entram na
chave. No caso de IP compartilhado, a chave identifica o assunto da revisão e não transforma IP em
identidade de ativo. Tipos futuros deverão definir explicitamente seu `canonicalSubject`; sem regra
aprovada, a criação do caso será rejeitada de forma controlada.

`policyVersion` não fará parte da `reviewSubjectKey` por padrão. Mudança de política produzirá
`POLICY_VERSION_CHANGED`, preservando no snapshot a versão usada. Uma mudança materialmente
incompatível na definição do assunto exigirá nova versão da fórmula, como
`finding-review-subject:v2`, evitando casos ativos duplicados apenas porque a política mudou.

### 12.2 Caso ativo e constraint recomendada

São estados ativos: `OPEN`, `IN_REVIEW` e `WAITING_FOR_EVIDENCE`. São terminais/inativos:
`RESOLVED`, `DISMISSED` e `CANCELLED`.

Duas estratégias foram avaliadas:

- **Índice único parcial PostgreSQL:** unicidade de `reviewSubjectKey` somente nos estados ativos.
  Expressa diretamente a regra, mas provavelmente exige SQL específico na migration, cuidados de
  compatibilidade com Prisma, rollback e testes de corrida sobre o predicado.
- **Chave ativa anulável:** manter `reviewSubjectKey` histórica e
  `activeReviewSubjectKey String? @unique`. A chave ativa recebe o mesmo valor enquanto o caso está
  ativo, torna-se nula em estado terminal e é readquirida na reabertura, sempre na mesma transação.

**Recomendação:** usar a chave ativa anulável na primeira versão, por ser explícita no modelo e mais
simples de representar com Prisma. A regra de domínio continuará validando os estados; testes de
corrida deverão comprovar que a constraint única é a proteção final. Um índice parcial poderá ser
reavaliado por migration posterior se a operação demonstrar necessidade.

### 12.3 Criação concorrente, reabertura e histórico

A criação futura seguirá esta sequência:

1. recalcular o finding no servidor;
2. calcular a `reviewSubjectKey` no servidor;
3. consultar caso ativo existente;
4. tentar criar caso e chave ativa dentro de transação;
5. confiar na constraint única como proteção final, sem depender apenas de `findFirst`;
6. em colisão, retornar replay idempotente ou `409`, informando o caso ativo conforme autorização.

Podem existir vários casos históricos para a mesma `reviewSubjectKey`, mas no máximo um ativo. Ao
reabrir um caso terminal, a operação tentará readquirir `activeReviewSubjectKey` em transação. Se
outro caso já a possuir, a reabertura falhará com `409`; nenhum caso será mesclado automaticamente.
A tentativa rejeitada será auditada apenas conforme política de auditoria aprovada, sem evento de
sucesso.

Mesmo assunto e novo `findingId` atualizam staleness e permitem refresh, sem criar automaticamente
outro caso ativo. Assunto diferente poderá originar novo caso; nenhuma relação será presumida. A
reabertura é preferível quando a política aprovada considerar continuidade da mesma investigação;
novo caso histórico exigirá razão formal e auditável.

## 13. Autorização proposta

O mecanismo ainda não existe. Antes de comandos de escrita, recomenda-se RBAC mínimo:

| Permissão | Viewer | Reviewer | Review Lead | Inventory Operator |
| --- | ---: | ---: | ---: | ---: |
| visualizar findings/casos | sim | sim | sim | sim |
| criar caso | não | sim | sim | sim |
| assumir caso/comentar | não | sim | sim | sim |
| atribuir a terceiros | não | não | sim | não |
| registrar decisão | não | sim | sim | não |
| dispensar/reabrir/cancelar | não | não | sim | não |
| executar ação futura no inventário | não | não | aprovar | executar com aprovação |

Separação de funções é recomendada para ações futuras sobre inventário. O ator simulado não deverá
ser aceito como identidade produtiva.

## 14. Contratos de API

Os contratos mínimos de criação, leitura e transição operacional ativa foram implementados sob o
prefixo `/conflict-review-cases`. Os contratos de decisão, comentários, atribuição e refresh abaixo
permanecem propostos e fora do MVP atual.

### 14.1 `POST /conflict-review-cases` — implementado

- **Objetivo:** criar caso explicitamente a partir de finding recalculado.
- **Request:** somente `findingId`.
- **Headers:** `Idempotency-Key` obrigatória; autenticação ainda não existe.
- **Response:** `201` com resumo do caso; `200` em replay idempotente.
- **Validações:** finding existe, paridade material e cálculo servidor da
  `reviewSubjectKey` e ausência de caso ativo duplicado.
- **Erros:** `400`, `401`, `403`, `404`, `409`, `422` e `503` controlado.
- **Efeitos:** cria caso, vínculos, snapshot, evento e `AuditLog`; não altera inventário.

### 14.2 `GET /conflict-review-cases` — implementado

- **Objetivo:** listar casos com busca, filtros, ordenação e paginação.
- **Filtros:** status, staleness, tipo, ativo histórico, criador, finding e período.
- **Response:** `{ items, pagination: { page, pageSize, totalItems, totalPages } }`.
- **Efeitos:** nenhum.

### 14.3 `GET /conflict-review-cases/:id` — implementado

- **Objetivo:** consultar snapshot histórico, hash, estado, ativos históricos/atuais e eventos.
- **Response:** contrato minimizado com `version`; não existe ETag nesta etapa.
- **Erros:** `400`, `404` e `503` controlados.
- **Efeitos:** nenhum; não recalcula implicitamente se isso alterar histórico.

### 14.4 `PATCH /conflict-review-cases/:id/status` — implementado para estados ativos

- **Request:** somente `status` e `expectedVersion`.
- **Matriz atual:** as seis transições distintas entre `OPEN`, `IN_REVIEW` e
  `WAITING_FOR_EVIDENCE`; o mesmo estado e os estados terminais são rejeitados.
- **Idempotência:** não utiliza `Idempotency-Key`; uma resposta de rede incerta exige leitura do caso
  antes de nova tentativa.
- **Concorrência:** update condicional por ID, versão e estado atual; versão divergente retorna `409`.
- **Efeitos:** incrementa a versão e atualiza o estado e `updatedAt`, cria `CASE_STATUS_CHANGED` e
  `AuditLog` na mesma transação PostgreSQL. Não altera inventário.
- **Limitações:** ator `atlas-mvp-user` provisório; autenticação e RBAC ainda não existem. `RESOLVED`
  possui comando de domínio próprio; `DISMISSED` e `CANCELLED` continuam futuros.

### 14.5 `PATCH /conflict-review-cases/:id/assignment` — proposto

- **Request:** `assignedTo`, `reason` e `expectedVersion`.
- **Autorização:** assumir o próprio caso exige permissão de revisão; atribuir a terceiros exige
  `Review Lead`.
- **Validações:** usuário de destino ativo, escopo compatível e caso não cancelado.
- **Idempotência:** chave obrigatória; atribuição já aplicada retorna o resultado anterior.
- **Concorrência:** update condicional por versão e `409` em divergência.
- **Efeitos:** altera apenas o responsável, incrementa versão e cria evento/AuditLog.

### 14.6 `POST /conflict-review-cases/:id/comments` — proposto

- **Request:** `kind`, `comment`, referências técnicas opcionais e `expectedVersion`.
- **Tipos:** `REVIEW_COMMENT`, `HUMAN_PROVIDED_CONTEXT` ou
  `TECHNICAL_EVIDENCE_REFERENCE`.
- **Validações:** texto não vazio, limites, referência autorizada e conteúdo seguro.
- **Efeitos:** comentário append-only e auditoria; não cria `AssetEvidence`.

### 14.7 `POST /conflict-review-cases/:id/decisions` — implementado para a primeira decisão

- **Request:** `identityConclusion`, justificativa e `expectedVersion`, com `Idempotency-Key`
  obrigatória. A rota plural representa a criação de um recurso append-only, não um upsert.
- **Validações atuais:** caso `IN_REVIEW`, ausência de decisão anterior, conclusão presente em
  `originalSnapshot.reviewOptions`, ao menos dois ativos históricos e justificativa de 1 a 1.000
  caracteres após trim externo. `NEEDS_MORE_EVIDENCE` continua sendo transição de estado.
- **Idempotência:** o fingerprint usa operação, ator e chave opaca. Replay é resolvido antes do estado
  atual e retorna a decisão original mesmo se a versão avançou; reutilização com outro conteúdo
  retorna `409`.
- **Concorrência:** `expectedVersion`, update condicional e as constraints existentes garantem uma
  única decisão original. `caseVersion` representa a versão resultante.
- **Response:** decisão imutável registrada e indicador de replay. O detalhe expõe
  `currentDecision` e `decisionHistory`, sem fingerprint. A interface do detalhe consome esses campos,
  registra a primeira decisão em duas etapas e reutiliza a mesma chave idempotente em retries explícitos
  cujo resultado de transporte ficou incerto. O envelope temporário usa `sessionStorage`, TTL de 15
  minutos e é removido em respostas conclusivas. A decisão não resolve o caso nem altera o inventário;
  correção ou superseding continuam fora do fluxo disponível.
- **Efeitos:** incrementa somente versão/`updatedAt`, cria `CASE_DECISION_RECORDED` e `AuditLog` na
  mesma transação; não muda status, inventário ou `Conflict`.
- **Limites atuais:** não existem componentes de decisão, resolução terminal, correção ou superseding. Embora
  o schema seja 1:N, uma segunda decisão nova é rejeitada até existir fluxo explícito futuro.

### 14.8 `POST /conflict-review-cases/:id/resolutions` — implementado para resolução lógica

- **Request:** `expectedVersion` e justificativa obrigatória de 1 a 1.000 caracteres, com
  `Idempotency-Key` obrigatória.
- **Elegibilidade:** somente caso `IN_REVIEW` com decisão corrente; a decisão é derivada pela maior
  `caseVersion`. A operação não exige staleness atual e não recalcula o finding.
- **Idempotência:** fingerprint SHA-256 de operação, ator, `caseId` e chave opaca. O escopo é por caso:
  a mesma chave pode ser reutilizada em outro caso. Replay semântico precede estado e versão atuais,
  retorna HTTP `200` e representa a resolução original; uma resolução nova retorna HTTP `201`.
- **Concorrência:** update condicional por `expectedVersion`. A mesma chave converge para replay;
  chaves diferentes disputando a mesma versão produzem um vencedor e conflito de versão no perdedor.
- **Efeitos:** altera somente status para `RESOLVED`, versão, `updatedAt` e libera
  `activeReviewSubjectKey`; cria `CASE_RESOLVED` e `AuditLog` na mesma transação PostgreSQL.
- **Semântica:** `RESOLVED` encerra a investigação. Não corrige o finding derivado, não mescla ativos,
  não cria suppression, não altera `Conflict` e não executa remediation. Reabertura, correção e
  superseding continuam fora do escopo.
- **Interface:** o detalhe do caso oferece confirmação em duas etapas somente para `IN_REVIEW` com
  decisão corrente. Falhas de resultado incerto reutilizam explicitamente a mesma tentativa por até
  15 minutos no `sessionStorage`; respostas conclusivas removem o envelope. Após sucesso, a resposta
  da mutação é aplicada localmente antes do refresh, e a apresentação histórica é derivada do evento
  `CASE_RESOLVED`, sem modelar uma entidade de resolução inexistente.

### 14.9 `POST /conflict-review-cases/:id/refresh` — proposto

- **Objetivo:** recalcular e comparar o finding.
- **Request:** `expectedVersion`.
- **Response:** staleness, snapshot atual e diff estruturado.
- **Efeitos:** preserva original, salva comparação, evento e auditoria; não muda decisão/status.

### 14.10 Regras transversais dos contratos

| Endpoint | Autorização | Idempotência | Concorrência | Auditoria |
| --- | --- | --- | --- | --- |
| criar caso | `case:create` | header obrigatório | constraint por assunto ativo | caso criado |
| listar/detalhar | `case:read` | não aplicável | ETag no detalhe | leitura não auditada por padrão |
| mudar status ativo | futura `case:transition` | não usa chave idempotente | `expectedVersion` no body | estado e versão anteriores e novos |
| atribuir | `case:assign` | header obrigatório | versão/`If-Match` | responsável anterior e novo |
| comentar | `case:comment` | request ID único | append + versão esperada | metadata, sem copiar corpo em log técnico |
| decidir | `case:decide` | header obrigatório | versão/`If-Match` | decisão anterior e nova |
| atualizar análise | `case:refresh` | hash deduplicado | versão/`If-Match` | staleness e hashes, sem payload bruto |

Todos os comandos deverão usar DTOs com whitelist, limites de tamanho, transação e respostas de
erro controladas. `401` representa ausência de identidade, `403` falta de permissão, `404` recurso
inexistente, `409` concorrência/duplicidade ou finding alterado, e `422` transição ou decisão
semanticamente incompatível. Nenhum comando deverá produzir `AssetEvent` na primeira versão, pois
o evento pertence ao caso e não representa mudança técnica do ativo.

## 15. Comparação entre snapshots

O contrato de comparação proposto deverá conter:

- ativos adicionados e removidos;
- observações adicionadas e removidas;
- referências de evidência adicionadas ou indisponíveis;
- hostname/IP normalizado anterior e atual;
- mudança do contexto temporal;
- fontes adicionadas e removidas;
- versão de política anterior e atual;
- finding não localizado;
- limitações novas e removidas.

O diff deverá usar conjuntos ordenados e hashes canônicos para ser determinístico. O backend será a
única fonte dessa comparação; o frontend não deverá recalcular regras.

## 16. Comentários e contexto humano

O caso deverá distinguir:

- `REVIEW_COMMENT`: anotação operacional;
- `HUMAN_PROVIDED_CONTEXT`: declaração humana relevante;
- `TECHNICAL_EVIDENCE_REFERENCE`: link para uma evidência técnica já existente.

Contexto humano não deverá ser inserido em `AssetEvidence` nem apresentado como coleta técnica.
Links ou referências técnicas deverão ser identificados como referências fornecidas por pessoa, sem
se converterem em evidência técnica. Links deverão ser validados e não permitir esquemas inseguros.

Proposta inicial para a futura fase de comentários:

- comentários append-only em texto simples, sem HTML;
- sem anexos ou upload na primeira fase;
- autor, timestamp e `requestId`/idempotency key obrigatórios;
- tamanho máximo configurado e aprovado antes da implementação; não definir um número silencioso;
- nenhuma edição ou exclusão silenciosa;
- correções são registradas por novo comentário que referencia o anterior;
- ocultação administrativa exige permissão, motivo e evento de auditoria;
- o conteúdo original permanece preservado para auditoria com acesso restrito;
- retenção depende de política formal e deve minimizar dados pessoais;
- entrada validada e saída renderizada como texto para proteção contra XSS.

Recomenda-se que comentários sejam append-only e possuam versionamento/idempotência próprios, sem
incrementar a versão do caso. O evento de comentário registrará a versão atual do caso como
referência, com `versionBefore` e `versionAfter` iguais, distinguindo evento append-only de mutação do
agregado. Se um comentário também solicitar transição, serão comandos e eventos separados.

Essas definições são obrigatórias antes da fase funcional de comentários, mas não bloqueiam a
persistência mínima de casos sem comentários.

## 17. Interface futura

### 17.1 Inventário de findings

A interface atual poderá futuramente exibir **Criar caso de revisão**, apenas quando o usuário tiver
permissão. A listagem nunca criará casos automaticamente.

### 17.2 Lista de casos

Campos recomendados: status, tipo, ativos, responsável, criação, atualização, decisão, staleness e
limitações. A UI deverá diferenciar visualmente finding, caso e conflito formal.

### 17.3 Detalhe do caso

Seções recomendadas:

- snapshot original;
- análise atual e diferenças;
- histórico e auditoria;
- comentários/contexto humano;
- decisão e justificativa;
- eventual conflito formal relacionado.

Não existe código frontend dessas telas neste PR.

## 18. Compatibilidade com Resolution Center

O Resolution Center atual deverá coexistir com a futura fila de casos:

- Resolution Center continua tratando `Conflict` formal;
- lista de casos trata investigação de findings;
- um caso poderá apenas referenciar um conflito formal já criado explicitamente;
- a navegação cruzada deverá explicar a diferença sem fundir estados;
- nenhuma ação do caso deverá chamar implicitamente `PATCH /conflicts/:id/status`.

Reutilização integral ou substituição do Resolution Center não é recomendada. Integração parcial,
por links e referência auditável, preserva retrocompatibilidade.

## 19. Compatibilidade da entidade `Conflict`

| Necessidade futura | Campo atual | Atende | Alteração provável |
| --- | --- | ---: | --- |
| findingId | nenhum | não | permanecer em `FindingReviewCase` |
| policyVersion | nenhum | não | campo no caso/snapshot |
| snapshot | nenhum | não | snapshot versionado do caso |
| status de investigação | `status` de conflito | parcial | enum próprio do caso |
| decisão tipada | `resolutionValue` genérico | parcial | enum/campo próprio do caso |
| justificativa | `resolutionNote` | parcial | motivo e comentário separados |
| responsável | nenhum | não | `assignedTo` no caso |
| versionamento | `updatedAt` | não | `version` inteiro |
| timestamps | vários | parcial | datas específicas do caso |
| auditoria | `AuditLog` externo | parcial | evento do caso + AuditLog |
| staleness | nenhum | não | status e diff no caso |
| ativos múltiplos | `assetId` único | não | tabela de relação |
| hostname/IP | `attributeKey`/values | parcial | snapshot e campos normalizados |
| comentários | nota única | não | tabela append-only |
| evidências | `ConflictValue.evidenceId` | parcial | referências no snapshot/relação |

## 20. Proposta conceitual de schema

O pseudocódigo abaixo representa o agregado futuro. A fundação relacional mínima de
`FindingReviewDecision` foi autorizada e implementada separadamente; componentes, comentários,
ponteiro de decisão corrente e os demais campos continuam apenas conceituais:

```prisma
enum FindingReviewCaseStatus {
  OPEN
  IN_REVIEW
  WAITING_FOR_EVIDENCE
  RESOLVED
  DISMISSED
  CANCELLED
}

enum FindingReviewStaleness {
  CURRENT
  CHANGED
  NO_LONGER_DETECTED
  POLICY_VERSION_CHANGED
  ASSET_UNAVAILABLE
  REQUIRES_REFRESH
}

enum FindingReviewIdentityConclusion {
  SAME_ASSET
  DIFFERENT_ASSETS
}

enum FindingReviewDecisionComponentType {
  IP_REUSED
  HOSTNAME_CHANGED
  SOURCE_DATA_INCORRECT
}

model FindingReviewCase {
  id                    String
  findingId             String
  findingType           String
  policyVersion         String
  reviewSubjectKey      String
  activeReviewSubjectKey String? @unique
  status                FindingReviewCaseStatus
  staleness             FindingReviewStaleness
  originalSnapshot      Json
  originalSnapshotHash String
  latestSnapshot        Json?
  latestSnapshotHash    String?
  version               Int
  createdBy             String
  assignedTo            String?
  formalConflictId      String?
  findingGeneratedAt    DateTime
  lastRefreshedAt       DateTime?
  resolvedAt            DateTime?
  createdAt             DateTime
  updatedAt             DateTime
  assets                FindingReviewCaseAsset[]
  decisions             FindingReviewDecision[]
  comments              FindingReviewComment[]
  events                FindingReviewEvent[]
}

model FindingReviewCaseAsset {
  caseId       String
  assetId      String?
  assetIdAtCreation String
  assetNameAtCreation String?
  role         String
  createdAt    DateTime
}

model FindingReviewComment {
  id             String
  caseId         String
  kind           String
  body           String
  requestId      String
  createdBy      String
  createdAt      DateTime
  hiddenAt       DateTime?
  hiddenBy       String?
  hiddenReason   String?
}

model FindingReviewDecision {
  id                  String
  caseId              String
  identityConclusion  FindingReviewIdentityConclusion
  justification       String
  caseVersion         Int
  createdBy           String
  requestFingerprint  String
  createdAt           DateTime
  components          FindingReviewDecisionComponent[]
}

model FindingReviewDecisionComponent {
  id                    String
  decisionId            String
  componentType         FindingReviewDecisionComponentType
  sourceType            String?
  evidenceId            String?
  observationReference  String?
  attributeKey          String?
  observedValue         Json?
  justification         String
  limitation            String?
  metadata              Json?
  createdAt             DateTime
}

model FindingReviewEvent {
  id                           String
  caseId                       String
  eventType                    String
  versionBefore                Int?
  versionAfter                 Int
  actorId                      String
  requestId                    String?
  previousStatus               FindingReviewCaseStatus?
  nextStatus                   FindingReviewCaseStatus?
  previousIdentityConclusion   FindingReviewIdentityConclusion?
  nextIdentityConclusion       FindingReviewIdentityConclusion?
  previousDecisionId           String?
  nextDecisionId               String?
  justification                String?
  before                       Json?
  after                        Json?
  metadata                     Json?
  occurredAt                   DateTime
  createdAt                    DateTime
}
```

Índices recomendados:

- único em `activeReviewSubjectKey` quando não nulo;
- índice em `(status, updatedAt)`;
- índice em `(staleness, updatedAt)`;
- índice em `assignedTo`;
- índice em `(findingId, policyVersion)`;
- índice em `reviewSubjectKey` para histórico do mesmo assunto;
- índice em `(caseId, versionAfter)` para ordenação do histórico;
- índice em `(caseId, createdAt)` para decisões e comentários;
- índice em `componentType` e avaliação de índices por `evidenceId`/`sourceType` conforme consultas;
- único em `(caseId, requestId)` para comentários;
- índices de relação por `assetId` e `caseId`.

Para listagens por criação e paginação estável, deverão ser avaliados `(createdAt, id)`,
`(status, createdAt, id)` e, quando houver atribuição, `(assignedTo, createdAt, id)`. Eles não deverão
ser criados todos automaticamente: a escolha dependerá dos filtros e ordenações reais e deverá ser
validada com `EXPLAIN ANALYZE` antes da migration.

Eventos de mutação principal poderão ter unicidade em `(caseId, versionAfter)`, pois cada versão do
caso deve resultar de uma única mutação atômica. Eventos append-only, como comentário, referenciam a
versão atual sem incrementá-la e precisam de `requestId` próprio; por isso não podem compartilhar a
mesma constraint de unicidade dos eventos mutáveis. Ordenação usa versão e timestamp, com `id` como
desempate determinístico.

Snapshots JSON preservam o contrato derivado com baixo acoplamento inicial, mas trazem riscos de
volume, validação, consulta e evolução de schema. Campos usados em filtros, constraints e relações
devem ser normalizados. O JSON deverá ser validado, versionado, minimizado e ter limite de tamanho.

O bloco representa o agregado futuro completo. A primeira migration deverá criar somente as
estruturas autorizadas para a Fase 1; tabelas de decisão, componentes e comentários não deverão ser
antecipadas sem necessidade e aprovação específicas.

## 21. Plano de migration futura

1. aprovar nomes, estados, decisões, retenção e autorização;
2. criar enums e tabelas novas sem alterar `Conflict` inicialmente;
3. criar índices e constraints, incluindo `reviewSubjectKey`, chave ativa anulável e idempotência;
4. não fazer backfill de findings, pois não são persistidos hoje;
5. manter feature flag de escrita desabilitada até validação;
6. executar migration expand-only e deploy compatível;
7. validar rollback por desativação da feature e preservação das tabelas;
8. só remover campos/estruturas em migration posterior e explicitamente aprovada.

Não há dados existentes de casos a migrar. O vínculo opcional com `Conflict` deverá ser adicionado
apenas quando sua semântica e `onDelete` forem aprovados. A migration futura deverá ter plano de
backup, teste em base demo e rollback documentado.

## 22. Segurança e privacidade

Riscos e controles recomendados:

- **hostnames e usernames podem conter dados pessoais:** minimizar exibição e aplicar autorização;
- **comentários podem receber conteúdo sensível:** orientar usuários, limitar tamanho e não logar o
  corpo em logs técnicos;
- **snapshots podem reter dados antigos:** política de retenção e acesso deverá ser aprovada;
- **exportação:** fora da primeira versão; quando existir, deverá ser autorizada e auditada;
- **LGPD:** mapear finalidade, necessidade, retenção e atendimento administrativo, sem tratar este
  documento como parecer jurídico;
- **injeção e XSS:** validar DTOs e renderizar conteúdo como texto;
- **enumeração de IDs:** usar UUID e autorização por recurso/tenant no futuro;
- **logs:** registrar IDs e códigos controlados, não payloads completos;
- **segredos:** nunca aceitar ou persistir credenciais em comentários/snapshots.

## 23. Observabilidade futura

Métricas recomendadas:

- casos abertos e por estado;
- tempo até primeira revisão e até conclusão;
- findings sem caso;
- casos desatualizados e tempo desde o último refresh;
- reaberturas;
- decisões por tipo;
- conflitos `409` de concorrência;
- falhas de refresh;
- tentativas não autorizadas;
- duplicidades evitadas por idempotência.

Não deverão ser criadas métricas de desempenho individual de pessoas sem política formal. Logs,
métricas e traces deverão usar IDs de correlação e não expor comentários.

## 24. Plano incremental de implementação

### Fase 1 — persistência mínima e consulta somente leitura

- **Backend/Prisma:** migration expand-only, caso, relação com múltiplos ativos, snapshot original,
  `reviewSubjectKey`, chave ativa anulável, `version`, evento de criação com versões explícitas,
  idempotência, criação explícita atrás de feature flag e lista/detalhe somente leitura.
- **Frontend:** lista e detalhe somente leitura, ou nenhuma tela enquanto a feature flag estiver
  restrita internamente.
- **Auditoria:** somente criação do caso, sem ator simulado em uso produtivo.
- **Testes:** migration, corrida de criação, duplicidade, idempotência, autorização, contratos de
  leitura e ausência de escrita em `Asset`, atributos, interfaces, evidências e `Conflict`.
- **Fora:** atribuição, comentários, decisões, componentes, refresh, integração com `Conflict`,
  Resolution Center e ações sobre inventário.
- **Risco:** schema e autenticação; depende de aprovação documental e autorização explícita para
  Prisma/migration.

### Fase 2 — atribuição e estados

- **Backend:** atribuição e transições transacionais com RBAC e eventos versionados.
- **Frontend:** assumir/atribuir e transicionar.
- **Testes:** máquina de estados, autorização, idempotência e concorrência.

### Fase 3 — comentários

- **Backend:** comentários append-only conforme ciclo de vida aprovado.
- **Frontend:** comentar, corrigir por referência e ocultação administrativa autorizada.
- **Testes:** sanitização, retenção, idempotência, acesso e ausência de `AssetEvidence`.

### Fase 4 — decisão composta sem ação no inventário

- **Backend:** conclusão de identidade, componentes relacionais e histórico imutável.
- **Frontend:** formulário com motivo/comentário e aviso de não alteração.
- **Testes:** coexistência de componentes, exclusão mútua da conclusão, reabertura e nenhuma escrita
  no inventário/Conflict.

### Fase 5 — comparação com finding atual

- **Backend:** refresh e diff determinístico.
- **Frontend:** snapshot original versus análise atual.
- **Testes:** todos os estados de staleness e mudanças de política.

### Fase 6 — ações aprovadas sobre inventário

- **Backend:** proposta, aprovação, executor separado e compensação.
- **Frontend:** fluxo de aprovação distinto.
- **Testes:** autorização forte, auditoria, rollback e proteção contra evidência manual falsa.
- **Dependência:** decisão de produto e revisão de segurança específicas.

## 25. Critérios de aceite da futura primeira implementação

- caso criado somente por ação explícita;
- finding recalculado e validado na criação;
- snapshot original e hash preservados;
- todos os ativos afetados relacionados;
- `reviewSubjectKey` calculada no servidor e no máximo um caso ativo por assunto;
- duplicidade, corrida e retry controlados por constraint e `Idempotency-Key`;
- `version` e concorrência protegidos com `409`;
- ator autenticado e autorizado;
- evento de criação registra `versionBefore = null` e `versionAfter = 1`;
- criação e auditoria ocorrem na mesma transação;
- criação protegida por feature flag e lista/detalhe permanecem somente leitura;
- nenhum finding persistido automaticamente;
- nenhum `Conflict` criado automaticamente;
- nenhuma alteração em ativo, atributo, interface, evidência ou status;
- testes negativos comprovam ausência de escrita no inventário;
- rollback e feature flag documentados;
- dados e metadata minimizados.

## 26. Decisões arquiteturais e aprovações pendentes

### 26.1 Decisões fechadas por este documento

- arquitetura híbrida e entidade `FindingReviewCase` separada de `Conflict`;
- findings permanecem derivados e casos são criados somente por ação explícita;
- conclusão de identidade separada de componentes que podem coexistir;
- `NEEDS_MORE_EVIDENCE` é pendência/estado operacional, não decisão terminal;
- `reviewSubjectKey` representa assunto estável e não inclui `policyVersion` por padrão;
- no máximo um caso ativo por assunto;
- estados ativos são `OPEN`, `IN_REVIEW` e `WAITING_FOR_EVIDENCE`;
- primeira estratégia recomendada é `activeReviewSubjectKey` anulável e única;
- eventos mutáveis registram explicitamente `versionBefore` e `versionAfter`;
- decisões e componentes são relacionais, imutáveis e auditáveis;
- nenhuma decisão, componente, caso ou refresh altera inventário ou cria `Conflict` automaticamente.

### 26.2 Decisões que ainda exigem aprovação humana

| Pergunta | Recomendação | Impacto da aprovação |
| --- | --- | --- |
| Nomes definitivos das tabelas e enums? | validar os nomes conceituais antes do Prisma | contratos e migration |
| Autenticação mínima? | não liberar escrita com `atlas-mvp-user` | identidade, atribuição e auditoria |
| Retenção de snapshots? | política configurável, sem prazo silencioso | volume, privacidade e compliance |
| Tamanho máximo de comentário? | definir por produto/segurança antes da fase 3 | validação e UX |
| Política de ocultação? | somente papel autorizado, motivo e auditoria | governança e privacidade |
| Duração de `Idempotency-Key`? | definir janela e armazenamento antes da escrita | retries e capacidade |
| Feature flag? | iniciar desabilitada e com rollout controlado | deploy e rollback |
| Escopo exato do primeiro PR? | adotar a Fase 1 mínima desta seção | risco e revisabilidade |
| Quando criar `Conflict` formal? | somente fluxo explícito futuro | coexistência com Resolution Center |
| Quem aprova ação no inventário? | papel distinto do revisor quando possível | segregação de funções |
| Autorização para Prisma/migration? | exigir aprovação explícita após revisão | início da implementação |

Uma alternativa futura de índice parcial PostgreSQL permanece possível, mas não é decisão pendente
para a primeira versão: a chave ativa anulável é a estratégia recomendada. Qualquer troca exigirá
nova análise, migration própria e testes de corrida.

## 27. Riscos arquiteturais

- duplicação conceitual entre caso e `Conflict` se a interface não for clara;
- crescimento de snapshots JSON sem retenção e limites;
- ações de escrita sem autenticação real;
- corrida na criação do caso sem constraint/idempotência;
- decisão aplicada indevidamente ao inventário por acoplamento futuro;
- mudança da política tornando casos antigos difíceis de comparar;
- exclusão de ativo quebrando investigação histórica;
- comentários recebendo dados sensíveis;
- `AuditLog` genérico sem histórico específico suficiente;
- tentativa de usar `findingId` como identidade eterna do problema.

As mitigações propostas neste documento — agregado próprio, snapshot imutável, referências
históricas, locking, idempotência, RBAC e separação de execução — são requisitos da implementação,
não otimizações opcionais.

## 28. Fora do escopo desta proposta

- implementação de qualquer endpoint;
- alteração de Prisma ou migration;
- persistência automática de findings;
- criação automática de casos ou conflitos;
- alteração do Resolution Center;
- autenticação/RBAC funcional;
- anexos;
- SLA e notificações;
- merge, exclusão ou correção automática de ativos;
- ação automática sobre fontes externas;
- mudança nas políticas atuais.

## 29. Resultado da decisão

O desenho recomenda formalmente:

1. preservar findings como análises derivadas e não persistidas;
2. criar casos somente por ação explícita e após recálculo;
3. usar `FindingReviewCase` para snapshot, investigação, estado e histórico;
4. identificar o assunto pela `reviewSubjectKey` e limitar a um caso ativo por chave;
5. representar decisões futuras por conclusão de identidade e componentes relacionais coexistentes;
6. registrar versões anterior e posterior em todo evento de mutação;
7. manter `Conflict` como conceito formal separado;
8. não alterar o inventário na primeira versão persistida;
9. exigir autenticação, autorização, idempotência e concorrência otimista antes de escrita;
10. implementar em fases pequenas, cada uma com testes de ausência de efeitos colaterais.

Qualquer schema, migration ou endpoint de escrita deverá ser objeto de autorização e PR futuros.
