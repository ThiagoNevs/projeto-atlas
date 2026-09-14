# ADR-002 — Frontend Next.js

Status: Accepted

## Context

UI autenticada, acessível, em português e self-hosted.

## Decision

Usar Next.js App Router com React e TypeScript.

## Alternatives Considered

SPA tradicional, React Router e Remix-like.

## Consequences

Rendering híbrido e containerização; disciplina de cache e upgrades é necessária.

## Security / Operational Considerations

Tokens em memória, redirects relativos, HTTPS e CSP antes do piloto.

## Reconsider When

Outra estratégia trouxer benefício material comprovado.

## Related Decisions

ADR-001, ADR-006, ADR-007.
