# ADR-011 — Deploy comercial Dedicated-first

Status: Accepted

## Context

O primeiro produto comercial atende um cliente em um ambiente.

## Decision

Priorizar Atlas Dedicated em containers sobre VM/private cloud.

## Alternatives Considered

Kubernetes-first ou SaaS-first.

## Consequences

Menor custo; backup, restore, upgrades e isolamento precisam de operação.

## Security / Operational Considerations

TLS, secrets fora das imagens, health/readiness e runbooks.

## Reconsider When

Escala multi-cliente ou HA justificar orchestration layer.

## Related Decisions

ADR-004, ADR-012, ADR-013.
