# ADR-005 — Prisma com escape hatch PostgreSQL

Status: Accepted

## Context

Produtividade tipada e semântica PostgreSQL são necessárias.

## Decision

Prisma por padrão; SQL nativo quando necessário, como `SELECT ... FOR UPDATE`.

## Alternatives Considered

ORM-only, query builder-only ou SQL-only.

## Consequences

Tipagem e flexibilidade; SQL exige parametrização, revisão e testes.

## Security / Operational Considerations

Queries nativas sempre parametrizadas, testadas e isoladas na camada de acesso a dados; quando
participarem de uma transação existente, devem usar o mesmo transaction client. Não espalhar SQL
bruto por controllers.

## Reconsider When

Queries complexas ou ingestão bulk justificarem camada complementar.

## Related Decisions

ADR-004, ADR-012.
