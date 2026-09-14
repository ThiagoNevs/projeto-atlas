# ADR-012 — Execução de conectores

Status: Proposed

## Context

Conectores exigirão jobs duráveis, retry, checkpoint, cancelamento e dead-letter.

## Decision

Ainda não escolher tecnologia; fila PostgreSQL-backed é candidata líder para Dedicated.
As alternativas serão avaliadas por durability, semântica de retry e backoff, scheduling, concorrência,
workers horizontais, cancelamento, checkpoint/recovery, dead-letter, simplicidade operacional, custo
no deployment Dedicated e observabilidade.

## Alternatives Considered

In-process Nest, pg-boss, BullMQ + Redis, Temporal e modelo PostgreSQL próprio.

## Consequences

Adiar evita complexidade; decisão ocorre antes do primeiro conector.

## Security / Operational Considerations

Exigir run/correlation ID, limites, credenciais isoladas e auditoria.

## Reconsider When

Workflows longos e compensações justificarem Temporal.

## Related Decisions

ADR-004, ADR-011, ADR-013.
