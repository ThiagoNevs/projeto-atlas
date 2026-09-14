# ADR-009 — Arquitetura evidence-first

Status: Accepted

## Context

Confiança depende de origem, momento e contexto.

## Decision

Manter `source → evidence → identity → trust → current state` como direção arquitetural. As fundações
atuais de Source, Evidence e proveniência existem; Identity Engine e Trust Engine ainda são trabalho
planejado que consumirá essas fundações.

## Alternatives Considered

Asset como verdade primária ou sobrescrita direta por fonte.

## Consequences

Explicabilidade e histórico; payload JSONB e retenção exigem política futura.

## Security / Operational Considerations

Classificar e redigir dados sensíveis sem perder proveniência.

## Reconsider When

Escala exigir storage especializado ou Observation separada.

## Related Decisions

ADR-004, ADR-010, ADR-014, ADR-015.
