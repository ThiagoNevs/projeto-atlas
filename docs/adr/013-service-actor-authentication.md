# ADR-013 — Autenticação de Service Actors

Status: Proposed

## Context

Connectors não podem usar identidade humana.

## Decision

Service Actor terá identidade, autenticação, permissões, auditoria, revogação e rotação próprias; mecanismo final aberto.
Service Actors nunca reutilizarão tokens humanos e operarão com least privilege e identidade
auditable. No deployment Dedicated, serão avaliados mecanismos compatíveis com o ambiente isolado; em
um futuro Cloud, workload identity, federation, mTLS ou identidade nativa do provedor poderão ser
considerados. Nenhum mecanismo foi selecionado.

## Alternatives Considered

Client credentials OIDC, mTLS, workload identity e federation.

## Consequences

Dedicated e Cloud podem divergir; machine-to-machine ainda não existe.

## Security / Operational Considerations

Least privilege, secrets manager, rotação e threat model são gates.

## Reconsider When

O primeiro connector e deployment definirem requisitos concretos.

## Related Decisions

ADR-006, ADR-007, ADR-008, ADR-012.
