# ADR-007 — Autorização baseada em permissões

Status: Accepted

## Context

Roles externas variam por cliente.

## Decision

Permissions são autoritativas; roles são mapping; `atlas:access` é independente; default-deny é obrigatório.

## Alternatives Considered

Autorização somente por role.

## Consequences

Granularidade e evolução melhores; resource-level e tenant scope são futuros.

## Security / Operational Considerations

Cada handler declara permissões e nega por padrão.

## Reconsider When

Multi-tenancy exigir autorização por recurso.

## Related Decisions

ADR-006, ADR-008, ADR-013.
