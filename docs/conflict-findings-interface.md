# Interface do inventário de achados

## Objetivo

A rota `/conflict-findings` apresenta o inventário agregado de achados de identidade e rede em uma
interface operacional somente leitura. Ela ajuda a localizar e compreender dados potencialmente
incompatíveis, sem confirmar um conflito e sem alterar o inventário.

O aviso de modo sombra permanece visível: nenhum `Conflict`, `AuditLog`, `AssetEvent` ou decisão é
criado pela consulta.

## Conteúdo da página

- resumo do conjunto filtrado, calculado pelo backend antes da paginação;
- contagem total, ativos afetados, achados com limitações e distribuição por tipo;
- filtros por tipo, ativo, hostname, IP, fonte, contexto temporal e presença de limitações;
- ordenação pelos campos suportados pelo endpoint agregado;
- paginação com preservação dos filtros na URL;
- cards com todos os ativos afetados, fontes, contexto temporal, contagens e opções de revisão
  meramente informativas;
- limitações globais retornadas pela política;
- análise individual aberta sob demanda.

## Análise detalhada

O detalhe não é pré-carregado. Ao selecionar **Ver análise detalhada**, o frontend usa o primeiro ID
já ordenado pelo backend apenas como referência técnica para consultar
`GET /assets/:id/conflict-analysis`. Em seguida, localiza o mesmo `findingId` e confirma a paridade do
tipo, conjunto de ativos e contexto antes de apresentar observações, origens, valores, evidências,
datas, explicações e limitações.

Se o achado não estiver mais presente ou tiver mudado, a interface pede a atualização da listagem e
não reconstrói o detalhe com dados antigos.

## Segurança e comportamento de rede

- a listagem realiza somente `GET /conflict-analysis/findings`;
- nenhuma consulta individual é feita por card, por hover ou no carregamento inicial;
- o detalhe realiza um `GET` somente após ação do usuário;
- requisições possuem timeout e `AbortController`;
- respostas antigas não substituem o estado mais recente;
- campos desconhecidos, payload bruto, fingerprint e objetos internos são descartados pelo parser;
- links para ativos são construídos somente com UUIDs validados;
- todo conteúdo da API é renderizado como texto.

## Limitações

A página não é uma fila persistida e não possui responsável, SLA, prioridade, severidade ou status
de tratamento. As opções de revisão não são controles e não podem ser selecionadas, salvas,
ignoradas ou resolvidas. As limitações semânticas e de escala descritas em
`docs/conflict-findings-inventory.md` continuam válidas.
