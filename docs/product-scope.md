# Escopo do produto

## Objetivo

Dar uma visão confiável, histórica e explicável dos ativos de infraestrutura com base nas
evidências disponíveis e nas decisões administrativas registradas.

## Conceitos do MVP

- **Ativo:** entidade de infraestrutura consolidada pelo Atlas.
- **Evidência:** observação originada por uma fonte em determinado instante.
- **Timeline:** sequência de fatos e mudanças relevantes do ativo.
- **Status operacional:** condição técnica observada ou derivada.
- **Status administrativo:** decisão de gestão ou ciclo de vida.
- **Conflito:** contradição que exige investigação ou decisão humana.
- **Confiança:** credibilidade atribuída à observação ou ao ativo consolidado.
- **Qualidade dos dados:** completude, atualidade, consistência e validade.
- **Auditoria:** registro de quem ou qual processo realizou uma ação relevante.
- **Perfil de descoberta:** escopo seguro para uma simulação de descoberta de rede.

## Dentro do MVP atual

- ingestão manual e simulada;
- inventário, detalhe, evidências e timeline;
- status e scores;
- alteração administrativa auditável;
- conflitos de ciclo de vida e identidade de rede;
- Resolution Center básico;
- busca, filtros, ordenação e paginação;
- massa de demonstração;
- Network Discovery Lite simulado em redes privadas.

## Fora do escopo atual

- conectores reais com ferramentas externas;
- descoberta ou varredura real de rede;
- Collector ou agentes instaláveis;
- resolução automática de conflitos;
- autenticação e autorização corporativas;
- multi-tenant produtivo;
- dashboards executivos completos;
- operação em produção, alta disponibilidade e compliance.

O Network Discovery Lite atual valida os contratos, controles de segurança e experiência do
produto. Ele não comprova coleta real e não deve ser apresentado como scanner de rede.
