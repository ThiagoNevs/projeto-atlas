# ADR-003 — Backend NestJS

Status: Accepted

## Context

Domínio modular, controllers, decorators, guards, transações e APIs testadas em PostgreSQL.

## Decision

Manter NestJS sobre Node.js LTS e TypeScript.

## Alternatives Considered

Fastify direto, ASP.NET Core, Spring Boot e Go.

## Consequences

DI, testabilidade e suporte a testes unitários/E2E; CPU-bound e jobs longos devem sair do request.

## Security / Operational Considerations

Guards default-deny, validação, limites, timeouts e logs estruturados futuros.

## Reconsider When

CPU-bound dominar ou throughput exigir outro runtime.

## Related Decisions

ADR-004, ADR-006, ADR-007, ADR-012.
