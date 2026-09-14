# ADR-001 — Monorepo TypeScript com pnpm

Status: Accepted

## Context

API, Web e contratos compartilhados evoluem juntos.

## Decision

Manter monorepo pnpm com `apps/api`, `apps/web` e `packages/shared`.

## Alternatives Considered

Repositórios separados, Nx ou Turborepo.

## Consequences

Compartilhamento simples; o build graph deve permanecer explícito.

## Security / Operational Considerations

Lockfile congelado, boundaries e CI determinística.

## Reconsider When

CI ou número de pacotes justificar cache/orquestração dedicada.

## Related Decisions

ADR-002, ADR-003, ADR-005.
