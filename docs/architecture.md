# Arquitetura do MVP

## Visão geral

O Atlas é organizado como monorepo e separa apresentação, API, persistência, contratos e
infraestrutura local:

```text
Browser
  -> OIDC Authorization Code + PKCE
  -> apps/web (Next.js; access token somente em memória)
  -> Bearer access token
  -> apps/api (NestJS; JWT/JWKS e default-deny)
  -> Prisma
  -> PostgreSQL
```

- `apps/web`: interface Next.js com App Router, páginas de ativos, conflitos e descoberta
  simulada de rede.
- `apps/api`: API NestJS organizada por módulos de ingestão, ativos, evidências, timeline,
  conflitos e Network Discovery Lite.
- `apps/api/prisma`: schema, migrations e seed de demonstração.
- `packages/shared`: contratos TypeScript independentes de framework.
- `infra`: PostgreSQL local via Docker Compose.

## Fluxos principais

### Ingestão de ativos

Uma observação simulada cria ou atualiza o ativo, registra evidência, reconcilia atributos e
interfaces e adiciona um evento à timeline. Repetições idênticas confirmam dados existentes sem
duplicá-los.

### Decisão administrativa

Mudanças de status administrativo atualizam o ativo, geram timeline e `AuditLog` na mesma
transação. A autoria vem do `CurrentActor` confiável derivado de `issuer + subject`; display name e
e-mail nunca são usados como identidade persistida.

### Autenticação e ator confiável

A SPA pública usa OIDC Authorization Code + PKCE com state e nonce gerenciados por
`oidc-client-ts`. O access token não é persistido em Web Storage e não há refresh token ou silent
renew. O Nest valida assinatura, issuer, audience, expiração, `nbf`, algoritmo allowlisted e JWKS com
`jose`. O guard global é default-deny; somente `GET /health`, `GET /health/live` e
`GET /health/ready` usam a exceção pública explícita.

O gate `atlas:access` controla a admissão geral e permanece independente das roles granulares.
Valores externos exatos da claim configurada são mapeados para Viewer, Analyst e Admin; essas roles
derivam permissions tipadas, exigidas explicitamente pelos controllers com default-deny. A API é a
autoridade e o frontend usa somente as permissions projetadas por `/auth/me` para navegação e UX.
Controllers recebem `CurrentActor` explicitamente e services não leem request/header. IDs persistidos
são hashes namespaced e estáveis de `{issuer, subject}`; atores humanos são convertidos para `USER` no
`AuditLog`. Não existe tabela `User`, sessão própria do Atlas ou backfill de autores históricos.

O issuer em `tests/auth/test-oidc-provider.mjs` usa `oidc-provider`, chaves e storage descartáveis e
serve apenas aos testes locais/CI. Não é componente de produção. O Browser E2E executa o redirect e
PKCE reais; os E2E de API usam tokens realmente assinados pelo mesmo boundary de verificação.

### Conflitos

Reaparecimento de ativos encerrados e identidades de rede contraditórias são representados como
conflitos explícitos. O Resolution Center permite mudar o estado do conflito com justificativa e
auditoria.

### Network Discovery Lite

Perfis limitam a simulação a CIDRs privados RFC1918. A execução gera observações determinísticas,
sem tráfego real, e usa o mesmo núcleo de ativos, evidências, interfaces, timeline e conflitos.

## Princípios

1. Evidências são a origem das afirmações sobre um ativo.
2. Estado derivado mantém rastreabilidade até as evidências.
3. Conflitos são explícitos e não sobrescritos silenciosamente.
4. Confiança e qualidade dos dados são dimensões distintas.
5. Decisões humanas relevantes são auditáveis.
6. Ambiguidade de identidade não provoca fusão automática.
7. Descoberta de rede é segura por padrão e permanece simulada no MVP.

## Limites atuais

O RBAC granular é configurado por mapping OIDC e não é persistido no banco. Ainda não existem
multi-tenant produtivo, service principals, conectores externos, filas, métricas, tracing distribuído,
Collector real ou descoberta ativa de rede. Também permanecem fora do escopo refresh token, BFF,
CSP geral e rate limiting. O contexto operacional HTTP, logging estruturado e readiness do PostgreSQL
estão descritos em [operational-context.md](operational-context.md). Consulte
[technical-risks.md](technical-risks.md) e [roadmap.md](roadmap.md).
