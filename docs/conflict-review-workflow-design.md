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
O formulário atual permite alterar para `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED` ou `EXCEPTION`;
`DISMISSED` existe no schema, mas não está na lista editável do DTO.

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
- decisão atual tipada, motivo e comentário;
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
5. verifica se já existe caso ativo para a mesma identidade;
6. armazena snapshot e hash, relações com ativos e auditoria;
7. retorna o caso criado ou o caso já criado para a mesma chave idempotente.

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

### 9.1 Conclusões possíveis

- `SAME_ASSET`;
- `DIFFERENT_ASSETS`;
- `IP_REUSED`;
- `HOSTNAME_CHANGED`;
- `SOURCE_DATA_INCORRECT`.

Uma conclusão deverá ter uma decisão principal. Informações complementares poderão ser registradas
como tags ou ações futuras, sem criar múltiplas “verdades” concorrentes no mesmo caso.

`NEEDS_MORE_EVIDENCE` não deverá ser decisão terminal. Ele corresponde ao estado
`WAITING_FOR_EVIDENCE`, acompanhado de comentário sobre o que falta.

Toda decisão exige motivo, comentário, ator, timestamp e versão esperada do caso. Alterações de
decisão não sobrescreverão o histórico: o caso deverá ser reaberto, e um novo evento registrará
valor anterior e posterior.

### 9.2 Efeito da decisão

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

Cada evento deverá registrar caso, ator autenticado, timestamp, estado anterior/posterior, decisão
anterior/posterior, justificativa e metadata minimizada. `AuditLog` deverá receber uma cópia segura
dos eventos administrativos relevantes para consulta global. Uma tabela de eventos do caso também
é recomendada para garantir relação, ordenação, histórico e leitura eficiente.

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
- criação de evento e `AuditLog` ocorre na mesma transação do comando.

Isso evita resolução simultânea, sobrescrita silenciosa e decisão sobre versão antiga. Comentários
também deverão usar idempotência e versão, ou uma estratégia append-only que não substitua outros
comentários.

## 12. Idempotência

- **Criação:** exigir `Idempotency-Key`; uma chave repetida devolve o mesmo resultado.
- **Caso ativo duplicado:** manter uma chave única `activeFindingKey` para o mesmo finding/política.
- **Decisão/status:** mesma chave e payload retornam o resultado anterior; payload diferente com a
  mesma chave retorna `409`.
- **Comentário:** usar `requestId`/idempotency key para não duplicar em retry.
- **Refresh:** hash igual não cria snapshot duplicado; pode registrar somente a consulta, conforme
  política de auditoria aprovada.

Um novo `findingId` poderá representar mudança material e não deverá ser unido automaticamente ao
caso anterior. A relação deverá ser sugerida para revisão, nunca inferida silenciosamente.

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

## 14. Contratos de API propostos

Nenhum endpoint desta seção existe atualmente.

### 14.1 `POST /finding-review-cases`

- **Objetivo:** criar caso explicitamente a partir de finding recalculado.
- **Request:** `findingId`, `policyVersion`, `expectedFindingHash` opcional.
- **Headers:** autenticação e `Idempotency-Key` obrigatórios.
- **Response:** `201` com caso, snapshot resumido, `version` e ETag; `200` em replay idempotente.
- **Validações:** finding existe, paridade material, permissão e ausência de caso ativo duplicado.
- **Erros:** `400`, `401`, `403`, `404`, `409`, `422` e `503` controlado.
- **Efeitos:** cria caso, vínculos, snapshot, evento e `AuditLog`; não altera inventário.

### 14.2 `GET /finding-review-cases`

- **Objetivo:** listar casos com busca, filtros, ordenação e paginação.
- **Filtros propostos:** status, staleness, tipo, ativo, responsável e período.
- **Response:** `{ items, total, page, pageSize, totalPages }`.
- **Efeitos:** nenhum.

### 14.3 `GET /finding-review-cases/:id`

- **Objetivo:** consultar snapshot, análise atual conhecida, diferenças, estado, decisão e histórico.
- **Response:** contrato minimizado, `version` e ETag.
- **Erros:** `401`, `403`, `404`.
- **Efeitos:** nenhum; não recalcula implicitamente se isso alterar histórico.

### 14.4 `PATCH /finding-review-cases/:id/status`

- **Request:** `status`, `reason`, `comment`, `expectedVersion`.
- **Validações:** máquina de estados, campos obrigatórios e permissão.
- **Idempotência:** chave obrigatória.
- **Concorrência:** `409` em versão divergente.
- **Efeitos:** atualiza caso e cria eventos/auditoria na mesma transação.

### 14.5 `PATCH /finding-review-cases/:id/assignment`

- **Request:** `assignedTo`, `reason` e `expectedVersion`.
- **Autorização:** assumir o próprio caso exige permissão de revisão; atribuir a terceiros exige
  `Review Lead`.
- **Validações:** usuário de destino ativo, escopo compatível e caso não cancelado.
- **Idempotência:** chave obrigatória; atribuição já aplicada retorna o resultado anterior.
- **Concorrência:** update condicional por versão e `409` em divergência.
- **Efeitos:** altera apenas o responsável, incrementa versão e cria evento/AuditLog.

### 14.6 `POST /finding-review-cases/:id/comments`

- **Request:** `kind`, `comment`, referências técnicas opcionais e `expectedVersion`.
- **Tipos:** `REVIEW_COMMENT`, `HUMAN_PROVIDED_CONTEXT` ou
  `TECHNICAL_EVIDENCE_REFERENCE`.
- **Validações:** texto não vazio, limites, referência autorizada e conteúdo seguro.
- **Efeitos:** comentário append-only e auditoria; não cria `AssetEvidence`.

### 14.7 `POST /finding-review-cases/:id/decision`

- **Request:** decisão, motivo, comentário, `expectedVersion` e idempotency key.
- **Validações:** decisão compatível com o tipo, caso `IN_REVIEW`, finding/staleness apresentados ao
  usuário e permissão.
- **Response:** decisão registrada e nova versão.
- **Efeitos:** decisão e auditoria; não altera inventário nem cria `Conflict`.

### 14.8 `POST /finding-review-cases/:id/refresh`

- **Objetivo:** recalcular e comparar o finding.
- **Request:** `expectedVersion`.
- **Response:** staleness, snapshot atual e diff estruturado.
- **Efeitos:** preserva original, salva comparação, evento e auditoria; não muda decisão/status.

### 14.9 Regras transversais dos contratos

| Endpoint | Autorização | Idempotência | Concorrência | Auditoria |
| --- | --- | --- | --- | --- |
| criar caso | `case:create` | header obrigatório | constraint de caso ativo | caso criado |
| listar/detalhar | `case:read` | não aplicável | ETag no detalhe | leitura não auditada por padrão |
| mudar status | `case:transition` | header obrigatório | versão/`If-Match` | estado anterior e novo |
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
Anexos e upload permanecem fora da primeira implementação. Links deverão ser validados e não devem
permitir esquemas inseguros.

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

O pseudocódigo abaixo é apenas desenho; não deverá ser aplicado sem autorização explícita:

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

enum FindingReviewDecision {
  SAME_ASSET
  DIFFERENT_ASSETS
  IP_REUSED
  HOSTNAME_CHANGED
  SOURCE_DATA_INCORRECT
}

model FindingReviewCase {
  id                  String
  findingId           String
  findingType         String
  policyVersion       String
  activeFindingKey    String?  @unique
  status              FindingReviewCaseStatus
  staleness           FindingReviewStaleness
  decision            FindingReviewDecision?
  decisionReason      String?
  decisionComment     String?
  originalSnapshot    Json
  originalSnapshotHash String
  latestSnapshot      Json?
  latestSnapshotHash  String?
  version             Int
  createdBy           String
  assignedTo          String?
  formalConflictId    String?
  findingGeneratedAt  DateTime
  lastRefreshedAt     DateTime?
  resolvedAt          DateTime?
  createdAt           DateTime
  updatedAt           DateTime
  assets              FindingReviewCaseAsset[]
  comments            FindingReviewComment[]
  events              FindingReviewEvent[]
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
  id          String
  caseId      String
  kind        String
  body        String
  requestId   String
  createdBy   String
  createdAt   DateTime
}

model FindingReviewEvent {
  id          String
  caseId      String
  eventType   String
  actorId     String
  before      Json?
  after       Json?
  metadata    Json?
  occurredAt  DateTime
}
```

Índices recomendados:

- único em `activeFindingKey` quando não nulo;
- índice em `(status, updatedAt)`;
- índice em `(staleness, updatedAt)`;
- índice em `assignedTo`;
- índice em `(findingId, policyVersion)`;
- único em `(caseId, requestId)` para comentários;
- índices de relação por `assetId` e `caseId`.

Snapshots JSON preservam o contrato derivado com baixo acoplamento inicial, mas trazem riscos de
volume, validação, consulta e evolução de schema. Campos usados em filtros, constraints e relações
devem ser normalizados. O JSON deverá ser validado, versionado, minimizado e ter limite de tamanho.

## 21. Plano de migration futura

1. aprovar nomes, estados, decisões, retenção e autorização;
2. criar enums e tabelas novas sem alterar `Conflict` inicialmente;
3. criar índices e constraints, incluindo chave idempotente/ativa;
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

### Fase 1 — persistência mínima

- **Backend/Prisma:** caso, ativos, snapshot, evento, locking e idempotência.
- **Frontend:** nenhuma ação, ou feature flag interna.
- **Testes:** migration, criação explícita, duplicidade, concorrência e ausência de escrita no ativo.
- **Risco:** schema e autorização; depende de aprovação explícita.

### Fase 2 — consulta somente leitura

- **Backend:** lista e detalhe paginados/autorizados.
- **Frontend:** fila e detalhe somente leitura.
- **Testes:** contratos, filtros, segurança, acessibilidade e staleness inicial.
- **Dependência:** Fase 1 estável.

### Fase 3 — atribuição, comentários e estados

- **Backend:** comandos transacionais, comentários append-only e RBAC.
- **Frontend:** assumir/atribuir, comentar e transicionar.
- **Testes:** máquina de estados, autorização, idempotência e concorrência.

### Fase 4 — decisão sem ação no inventário

- **Backend:** decisão tipada e histórico.
- **Frontend:** formulário com motivo/comentário e aviso de não alteração.
- **Testes:** decisões por tipo, reabertura e nenhuma escrita no inventário/Conflict.

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
- duplicidade e retry controlados;
- `version` e concorrência protegidos com `409`;
- ator autenticado e autorizado;
- decisão e transição auditadas;
- nenhum finding persistido automaticamente;
- nenhum `Conflict` criado automaticamente;
- nenhuma alteração em ativo, atributo, interface, evidência ou status;
- testes negativos comprovam ausência de escrita no inventário;
- rollback e feature flag documentados;
- dados e metadata minimizados.

## 26. Decisões abertas

| Pergunta | Recomendação | Aprovação necessária |
| --- | --- | ---: |
| Reutilizar `Conflict`? | usar modelo híbrido com `FindingReviewCase` | sim |
| Uma decisão pode mudar? | somente após reabertura, preservando histórico | sim |
| Caso resolvido pode reabrir? | sim, com permissão e justificativa | sim |
| Quem pode dispensar? | `Review Lead` | sim |
| Um finding pode ter vários casos? | vários históricos, no máximo um caso ativo | sim |
| Um caso agrega vários findings? | não na primeira versão | sim |
| Retenção do snapshot? | política configurável; não definir prazo sem governança | sim |
| Quais decisões encerram? | todas as conclusivas; `NEEDS_MORE_EVIDENCE` não | sim |
| Quem aprova ação no inventário? | papel distinto do revisor quando possível | sim |
| Comentários terão anexos? | não na primeira versão | sim |
| Quando criar `Conflict` formal? | somente fluxo explícito futuro | sim |
| ETag ou `expectedVersion`? | oferecer ETag e aceitar precondição versionada | sim |

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
3. usar `FindingReviewCase` para snapshot, investigação, estado, decisão e histórico;
4. manter `Conflict` como conceito formal separado;
5. não alterar o inventário na primeira versão persistida;
6. exigir autenticação, autorização, idempotência e concorrência otimista antes de escrita;
7. implementar em fases pequenas, cada uma com testes de ausência de efeitos colaterais.

Qualquer schema, migration ou endpoint de escrita deverá ser objeto de autorização e PR futuros.
