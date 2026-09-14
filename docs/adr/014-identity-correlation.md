# ADR-014 — Princípios de correlação de identidade

Status: Accepted

## Context

Fontes corporativas terão identificadores diferentes e evidência incompleta.

## Decision

Matching deve ser determinístico quando possível, explicável, versionado e preservar incerteza; nenhuma correlação é forçada.

## Alternatives Considered

Chave universal ou fusão automática.

## Consequences

Menor false match; algoritmo final ainda não foi definido.

## Security / Operational Considerations

Proveniência e revisão humana devem ser preservadas.

## Reconsider When

Dados reais justificarem algoritmo adicional versionado.

## Related Decisions

ADR-009, ADR-015.
