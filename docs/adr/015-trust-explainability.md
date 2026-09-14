# ADR-015 — Explicabilidade de confiança

Status: Accepted

## Context

Scores opacos não são auditáveis.

## Decision

Usar inicialmente `HIGH`, `MEDIUM`, `LOW`, `CONFLICTED` e `UNKNOWN` como direção de apresentação, não contrato definitivo.
Avaliações futuras devem preservar as fontes consideradas, frescor, corroboration, contradiction,
versão da policy e timestamp da avaliação.

## Alternatives Considered

Probabilidade única ou score sem fatores.

## Consequences

Evidências, frescor e contradições ficam explicáveis; calibração fica para depois.

## Security / Operational Considerations

Trust não altera inventário nem substitui decisão humana.

## Reconsider When

Dados suficientes permitirem modelo quantitativo governado.

## Related Decisions

ADR-009, ADR-014.
