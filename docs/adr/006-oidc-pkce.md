# ADR-006 — OIDC Authorization Code + PKCE

Status: Accepted

## Context

Integração Enterprise sem persistir tokens no browser.

## Decision

OIDC Authorization Code + PKCE no Web e JWT/JWKS no API, com issuer, audience e algoritmos validados.
O `CurrentActor` é derivado da identidade humana validada, e o access token do browser permanece
somente em memória.

## Alternatives Considered

Sessão própria, OAuth implícito ou SAML direto.

## Consequences

Integração com Entra; revogação e disponibilidade de JWKS exigem operação.

## Security / Operational Considerations

Sem `offline_access`, refresh token no browser ou HTTP fora do ambiente local. A autenticação de
SERVICE actors não faz parte da implementação desta ADR Accepted.

## Reconsider When

Federação legada exigir outra fronteira.

## Related Decisions

ADR-007, ADR-008, ADR-013.
