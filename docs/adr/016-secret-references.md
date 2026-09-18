# ADR-016 — Referências de segredo e propriedade externa

Status: Accepted

## Context

Service Actors e conectores futuros precisarão autenticar-se sem transformar o PostgreSQL, a API ou
o frontend do Atlas em superfícies de armazenamento e transporte de material secreto. Uma referência
identifica como o runtime pode obter um segredo, mas não é o próprio segredo.

## Decision

O Atlas não é um cofre de segredos. O material secreto permanece sob propriedade de um provider
externo e é provisionado fora do Atlas. A aplicação trabalha com referências estruturadas,
imutáveis e validadas, resolvidas apenas por providers registrados explicitamente em código.

O primeiro provider é `ENV`. Ele aceita somente uma chave lógica no formato
`^[A-Z][A-Z0-9_]{0,127}$` e lê a variável derivada `ATLAS_SECRET_<logicalKey>`. O caller não fornece
o nome completo da variável e não pode acessar configurações fora desse namespace.

Não há cache de segredo em nível de aplicação. Cada resolução lê o provider no momento do uso. O
valor é entregue por um wrapper que exige consumo deliberado e apresenta representação redigida em
serialização e inspeção. Esse wrapper reduz cópias acidentais, mas não constitui uma fronteira de
segurança absoluta.

Locators são metadata interna e não pertencem a respostas HTTP, logs operacionais ou `AuditLog`.
Falhas usam códigos sanitizados, sem refletir locator, valor ou resposta bruta do provider.

Providers `FILE`, Azure Key Vault e HashiCorp Vault permanecem futuros. Providers remotos deverão
usar endpoints controlados pelo deployment, nunca pela referência. O Atlas não persiste segredo nem
segredo criptografado no PostgreSQL.

## Alternatives Considered

- Aceitar segredos por API e gravá-los em provider externo.
- Persistir segredos criptografados no PostgreSQL com uma master key.
- Usar referências livres em formato URI.
- Implementar imediatamente providers `FILE` e de cofre externo.

Essas alternativas ampliam prematuramente a superfície de ataque, exigem decisões de lifecycle,
criptografia, bootstrap, rotação e autorização ainda sem consumidor concreto.

## Consequences

- O provisionamento inicial é operacional e out-of-band.
- Rotacionar `ATLAS_SECRET_<logicalKey>` preserva a referência lógica, mas reload/restart depende do
  mecanismo usado pelo deployment.
- Backups do banco não se tornam backups de segredos.
- Service Actors e conectores futuros podem depender da abstração sem acoplá-la a senha, Microsoft ou
  um cofre específico.
- JavaScript strings não podem ser zeroizadas de forma confiável. As mitigações reais são reduzir o
  lifetime e as cópias, não persistir, não logar e não manter valores em objetos long-lived.
- Secret scanning continua sendo gate obrigatório antes da primeira credencial operacional.

## Security / Operational Considerations

O namespace `ATLAS_SECRET_` impede leitura arbitrária de `DATABASE_URL`, `AUTH_*`, `NEXT_PUBLIC_*`,
`PATH` e outras configurações. Não existe listagem, teste de existência, API, UI, RBAC específico ou
auditoria de resolução. Uma indisponibilidade de provider afeta somente a operação consumidora e não
torna o readiness global indisponível por padrão.

Um provider `FILE` futuro deverá usar raiz fixa e chave lógica, bloquear traversal, paths absolutos e
symlinks. Cofres remotos deverão preferir workload/managed identity e resolver explicitamente o
problema de bootstrap sem circularidade.

## Reconsider When

Um primeiro Service Actor ou connector exigir referências persistentes, lifecycle administrativo,
provider adicional, version pinning ou uma API de metadata. Qualquer API que receba material secreto
exigirá novo threat model e decisão arquitetural.

## Related Decisions

ADR-006, ADR-007, ADR-008, ADR-010, ADR-011, ADR-012 e ADR-013.
