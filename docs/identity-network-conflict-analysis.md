# Análise de conflitos de identidade e rede

## Objetivo

O Atlas analisa, em modo `SHADOW`, observações que podem representar divergências de identidade ou
rede. A política `2026-07-conflict-v1` responde quais observações precisam de revisão e por quê. Ela
não determina qual dado está correto e não altera o inventário.

## Escopo da política

A política detecta três tipos de achado derivado e não persistido:

- `DUPLICATE_HOSTNAME_ACROSS_ASSETS`: o mesmo hostname normalizado aparece em ativos diferentes;
- `SHARED_IP_DIFFERENT_HOSTNAMES`: o mesmo IP aparece associado a hostnames distintos;
- `HOSTNAME_DIVERGENCE_ON_ASSET`: um ativo possui valores normalizados diferentes de hostname.

Hostname é tratado como um forte sinal de identidade. IP é informação de rede e nunca é usado, por
si só, para unir, remover ou substituir a identidade de ativos.

## Dados analisados

- `Asset.name`: nome persistido do ativo, usado hoje como hostname corrente pelos fluxos de
  ingestão/importação, mas mantido separado das observações de atributo;
- `AssetAttribute`: valores atuais e históricos de hostname e seus vínculos opcionais a evidências;
- `NetworkInterface`: IPv4 e IPv6 atuais ou históricos;
- `AssetEvidence`: fonte, tipo da evidência, `observedAt` e `ingestedAt`, sem expor payload bruto.

`Asset.name` não recebe automaticamente a mesma semântica de uma observação técnica. Quando ele não
possui evidência ou timestamp observacional, essa ausência aparece como limitação.

## Normalização

Hostnames são aparados, convertidos para caixa minúscula e validados por labels DNS. Nome curto e
FQDN continuam distintos; não existe equivalência automática. Valores vazios ou inválidos não geram
achado por hostname.

IPv4 é validado e normalizado por octetos. IPv6 equivalente é convertido para representação
canônica. Hostname, CIDR, string vazia e endereço malformado não são tratados como IP individual.

## Contexto temporal

A resposta apresenta primeiro e último timestamp, diferença em milissegundos e uma relação
descritiva: `SAME_OBSERVATION_TIME`, `DISTINCT_OBSERVATION_TIMES`, `PARTIAL_TEMPORAL_CONTEXT` ou
`NO_TEMPORAL_CONTEXT`.

Não existe janela arbitrária de minutos, horas ou dias. A distância temporal não confirma
simultaneidade nem reutilização de IP.

## Determinismo e deduplicação

O `findingId` é derivado por hash do tipo, ativos ordenados, valores normalizados e observações
ordenadas. UUID aleatório, horário da consulta e ordem do banco não participam do identificador.
Observações equivalentes podem permanecer como contexto, mas nunca inflam o número de achados.

## Fontes e histórico

As categorias `MANUAL`, `TECHNICAL`, `SIMULATED` e `UNKNOWN` são preservadas. Fontes simuladas e
desconhecidas geram limitações explícitas. Observações históricas continuam visíveis e são marcadas
como possíveis mudanças legítimas ao longo do tempo; sua quantidade não define um vencedor.

## Revisão humana futura

Os achados listam opções conceituais sem seleção ou recomendação automática: `SAME_ASSET`,
`DIFFERENT_ASSETS`, `IP_REUSED`, `HOSTNAME_CHANGED`, `SOURCE_DATA_INCORRECT` e
`NEEDS_MORE_EVIDENCE`.

A fila operacional e a aplicação auditada de uma decisão serão implementadas em etapas futuras.

## Garantias e limitações

- consulta exclusivamente em memória e somente leitura;
- nenhum `Conflict`, `AuditLog` ou `AssetEvent` é criado;
- nenhum hostname, IP, atributo, interface ou status é alterado;
- nenhuma mesclagem, exclusão ou recomendação é aplicada;
- nenhum payload bruto, fingerprint ou objeto Prisma é exposto;
- as consultas são direcionadas por hostname/IP do ativo e não carregam todo o inventário;
- buscas textuais normalizadas dependem dos índices atuais e podem exigir índice funcional futuro;
- representações IPv6 antigas não normalizadas podem limitar a busca dirigida entre ativos;
- ausência de serial, agentId, cloudId ou outro identificador técnico reduz o contexto disponível.
