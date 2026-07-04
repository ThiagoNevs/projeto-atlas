# Arquitetura do MVP

## Visão geral

O Atlas é organizado como monorepo e separa apresentação, API, persistência, contratos e
infraestrutura local:

```text
Browser
  -> apps/web (Next.js)
  -> apps/api (NestJS)
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
transação. O ator ainda é simulado porque o MVP não possui autenticação.

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

Não existem autenticação, multi-tenant produtivo, conectores externos, filas, observabilidade
estruturada, Collector real ou descoberta ativa de rede. Consulte [technical-risks.md](technical-risks.md)
e [roadmap.md](roadmap.md).
