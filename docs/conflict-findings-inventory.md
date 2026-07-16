# Inventário agregado de achados de identidade e rede

## Objetivo

O endpoint `GET /conflict-analysis/findings` apresenta, em modo `SHADOW`, uma visão global dos
achados derivados pela política `2026-07-conflict-v1`. Ele permite localizar situações que precisam
de revisão humana sem abrir cada ativo individualmente.

O recurso é um inventário recalculado e somente leitura. Ele ainda não é uma fila operacional: não
possui atribuição, responsável, SLA, status de tratamento ou resolução persistida.

## Correlação e deduplicação

A API carrega em uma única consulta apenas IDs, nomes persistidos, atributos de hostname,
interfaces, IPs, referências de evidência, fontes e timestamps necessários. Em memória, ela:

1. cria os mesmos snapshots usados pela análise individual;
2. indexa hostnames e IPs normalizados;
3. seleciona os ativos candidatos aos três tipos de achado;
4. executa a mesma política de conflito;
5. deduplica globalmente pelo `findingId` determinístico;
6. aplica filtros e ordenação;
7. pagina o resultado final.

Um achado envolvendo vários ativos, evidências ou interfaces aparece uma única vez. Os ativos não
são paginados antes da correlação, portanto relações entre ativos diferentes não são ocultadas por
páginas intermediárias.

## Parâmetros

- `page`: inteiro positivo, padrão `1`;
- `pageSize`: inteiro entre `1` e `100`, padrão `25`;
- `type`: um dos três tipos definidos pela política;
- `assetId`: UUID de qualquer ativo afetado;
- `hostname`: hostname válido, normalizado pela mesma regra da política;
- `ip`: IPv4 ou IPv6 válido e normalizado;
- `sourceType`: `MANUAL`, `TECHNICAL`, `SIMULATED` ou `UNKNOWN`;
- `temporalRelationship`: relação temporal real do achado;
- `hasLimitations`: `true` ou `false`;
- `sortBy`: `type`, `findingId`, `affectedAssets`, `observationCount`, `firstObservedAt` ou
  `lastObservedAt`;
- `sortDirection`: `asc` ou `desc`.

Nome curto e FQDN não são considerados equivalentes. Não existe filtro de gravidade, confiança,
prioridade, risco ou SLA porque a política não calcula esses conceitos.

## Resposta

Cada item contém o identificador do achado, tipo, ativos afetados, hostname ou IP normalizado,
contexto temporal, categorias de fonte, contagens de observações, explicação resumida, quantidade de
limitações e opções de revisão sem seleção.

O detalhe completo, incluindo todas as observações e explicações, continua disponível em
`GET /assets/:id/conflict-analysis` para qualquer ativo envolvido.

`summary` representa o conjunto após os filtros e antes da paginação. Ele contém:

- total de achados;
- contagem por tipo;
- quantidade de ativos distintos afetados;
- quantidade de achados com limitações.

## Ordenação e paginação

A ordenação padrão é por tipo em ordem crescente, com desempate determinístico pela identidade do
achado. A paginação ocorre somente depois da geração, deduplicação, filtros e ordenação. Chamadas
repetidas com os mesmos dados e parâmetros mantêm a mesma ordem e os mesmos `findingId`.

## Garantias

- `mode` permanece `SHADOW`;
- `decisionsChanged` permanece `false`;
- achados e opções de revisão não são persistidos;
- nenhum `Conflict`, `AuditLog` ou `AssetEvent` é criado;
- nenhum ativo, atributo, interface, hostname, IP ou status é alterado;
- payload bruto, fingerprint, objetos Prisma e dados administrativos desnecessários não são expostos;
- o endpoint individual e o agregado usam a mesma política e a mesma criação de snapshots.

## Limitações e escala

A consulta usa uma leitura de banco e processamento em memória. A criação dos índices é linear no
número de observações. A política é executada apenas para ativos candidatos; no pior caso, seu custo
aproximado pode chegar a `O(C × N × O)`, em que `C` é o número de ativos candidatos, `N` o número de
ativos e `O` a quantidade média de observações. A memória cresce proporcionalmente à projeção global
e aos achados antes da paginação. Para inventários grandes, serão necessárias projeções normalizadas,
índices adequados e possivelmente processamento incremental ou materializado — fora do escopo deste
MVP.

Permanecem limitações conhecidas: IPv6 legado em representações persistidas diferentes pode não ser
alcançado pela consulta individual dirigida; nome curto e FQDN são distintos; FQDN absoluto
terminado em ponto é rejeitado; timestamps não comprovam simultaneidade; e identificadores técnicos
adicionais ainda não participam da política.
