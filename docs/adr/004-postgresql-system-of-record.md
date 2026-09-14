# ADR-004 — PostgreSQL como system of record

Status: Accepted

## Context

Assets, Evidence, conflitos, decisões, histórico e auditoria exigem consistência.

## Decision

PostgreSQL permanece como fonte de verdade.

## Alternatives Considered

Document database, event store ou múltiplos bancos.

## Consequences

Transações, constraints, JSONB e locks simplificam Dedicated; volume futuro exigirá retenção e tuning.

## Security / Operational Considerations

Backups, restore, least privilege, TLS e retenção precedem dados reais.

## Reconsider When

Volume ou analytics excederem limites comprovados.

## Related Decisions

ADR-005, ADR-009, ADR-010, ADR-011.
