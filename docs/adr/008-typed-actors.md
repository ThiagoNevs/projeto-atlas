# ADR-008 — Atores tipados

Status: Accepted

## Context

Humanos, serviços e sistema têm riscos distintos.

## Decision

Atores são `HUMAN`, `SERVICE` ou `SYSTEM` em `CurrentActor` e auditoria. A autenticação HUMAN
está implementada via OIDC; autenticação SERVICE permanece planejada. `SYSTEM` é um conceito tipado
de domínio e não constitui bypass genérico de autorização.

## Alternatives Considered

Identificador textual sem tipo.

## Consequences

Least privilege e auditoria explícitos; autenticação SERVICE ainda não existe.

## Security / Operational Considerations

Connectors nunca reutilizam token humano.

## Reconsider When

Novo modelo de identidade exigir tipos adicionais.

## Related Decisions

ADR-006, ADR-007, ADR-013.
