# ADR-010 — Eventos, AuditLog e Security Logs

Status: Accepted

## Context

Histórico de domínio, responsabilidade e telemetria têm propósitos distintos.

## Decision

Manter `AssetEvent`, `FindingReviewEvent`, `AuditLog` e Security Log separados. Ação privilegiada concluída gera AuditLog; 401/403 e rejeições geram Security Log/telemetria.

## Alternatives Considered

Log único.

## Consequences

Retenção especializada; compliance futuro pode exigir storage tamper-resistant/SIEM.

## Security / Operational Considerations

Exportação sensível é fail-closed; nunca registrar tokens ou payload bruto.

## Reconsider When

Volume ou integração SIEM exigir pipeline dedicado.

## Related Decisions

ADR-004, ADR-008, ADR-013.
