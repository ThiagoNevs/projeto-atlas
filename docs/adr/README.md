# Architecture Decision Records

Estas ADRs registram decisões do Atlas. `Accepted` descreve decisões implementadas ou princípios
adotados; `Proposed` registra direção ainda não implementada.

## Accepted decisions

- [ADR-001 — Monorepo TypeScript com pnpm](001-monorepo-typescript.md) — Accepted — estrutura do workspace e contratos compartilhados.
- [ADR-002 — Frontend Next.js](002-nextjs-frontend.md) — Accepted — UI App Router em português e self-hosted.
- [ADR-003 — Backend NestJS](003-nestjs-backend.md) — Accepted — backend modular, guards e testabilidade.
- [ADR-004 — PostgreSQL como system of record](004-postgresql-system-of-record.md) — Accepted — fonte de verdade transacional.
- [ADR-005 — Prisma com escape hatch PostgreSQL](005-prisma-native-sql.md) — Accepted — Prisma por padrão e SQL nativo controlado.
- [ADR-006 — OIDC Authorization Code + PKCE](006-oidc-pkce.md) — Accepted — autenticação humana e validação de tokens.
- [ADR-007 — Autorização baseada em permissões](007-permission-authorization.md) — Accepted — permissions autoritativas e default-deny.
- [ADR-008 — Atores tipados](008-typed-actors.md) — Accepted — distinção HUMAN, SERVICE e SYSTEM.
- [ADR-009 — Arquitetura evidence-first](009-evidence-first.md) — Accepted — evidência e proveniência antes de estado derivado.
- [ADR-010 — Eventos, AuditLog e Security Logs](010-events-audit-security-logs.md) — Accepted — separação de histórico, auditoria e telemetria.
- [ADR-011 — Deploy comercial Dedicated-first](011-dedicated-first.md) — Accepted — estratégia inicial de deployment dedicado.
- [ADR-013 — Autenticação de Service Actors](013-service-actor-authentication.md) — Accepted — OAuth 2.0 Client Credentials com JWT/JWKS, identidade SERVICE e RBAC explícito.
- [ADR-014 — Princípios de correlação de identidade](014-identity-correlation.md) — Accepted — matching explicável e sem forced match.
- [ADR-015 — Explicabilidade de confiança](015-trust-explainability.md) — Accepted — direção de avaliação explicável, não contrato final.
- [ADR-016 — Referências de segredo e propriedade externa](016-secret-references.md) — Accepted — material secreto externo e resolução interna allowlisted.

## Proposed decisions

- [ADR-012 — Execução de conectores](012-connector-execution.md) — Proposed — critérios para jobs duráveis, retry e workers.

## Decision backlog

- Gestão persistente, lifecycle e rotação operacional de credential references.
- Run IDs e sua relação futura com request/correlation IDs já implementados no contexto HTTP.
- Retenção e classificação de Evidence.
- Retenção de AuditLog.
- Segurança de saída e controles SSRF.
- Structured logging e convenções de observabilidade.
- Large payload storage.
- Estratégia de Edge Collector.
- Estratégia futura de multi-tenancy.
- Limites, rate limiting e readiness de futuras dependências externas.

## Architecture gates

- **Antes de implementar Service Actors:** secret scanning no CI, threat model operacional, registration e rotação no IdP, permissions explícitas de serviço e verificação da auditoria.
- **Antes do primeiro connector:** request/correlation/run IDs, structured logs, readiness/health, credential references, execução durável, retry/backoff/dead-letter, retenção, timeouts, controles outbound/SSRF e throttling.
- **Antes do piloto:** CSP/security headers, backup/restore, dependency/vulnerability scanning, secret scanning, container image scanning, SBOM, alertas/SLOs e runbook operacional.

Os gates são pré-condições de decisão e implementação; não promovem itens do backlog a decisões `Accepted`.
