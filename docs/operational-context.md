# Contexto operacional da API

## Identificadores HTTP

Cada requisição recebe um `X-Request-ID` UUID v4 novo, gerado pelo servidor. Um valor de
`X-Request-ID` enviado pelo cliente é ignorado.

O cliente pode enviar um único `X-Correlation-ID` UUID v4. A API valida o valor integralmente e o
canonicaliza para letras minúsculas. Quando o header está ausente, repetido ou inválido, a API usa o
próprio request ID como correlation ID sem rejeitar a requisição. O valor inválido nunca é refletido
nem registrado. Ambos os IDs são devolvidos nos headers de todas as respostas, inclusive erros.

Esses identificadores são contexto técnico: não participam de autenticação, autorização ou
idempotência. Em particular, o `requestId` de `FindingReviewEvent` continua sendo um fingerprint de
idempotência com semântica distinta.

## Logging

A API mantém o contexto por cadeia assíncrona com `AsyncLocalStorage` e emite um único evento
operacional de conclusão por requisição. O record usa uma allowlist de campos: evento, IDs,
método, template da rota, status, duração, ator seguro, permission exigida e classificação interna
de erro quando aplicáveis. Em produção, o `ConsoleLogger` do NestJS 11 escreve JSON; o record pode
aparecer aninhado em `message`.

Não são copiados para esses logs URL completa, query string, body, headers, cookies, tokens,
credenciais, secrets ou claims OIDC. Falhas de autenticação e autorização geram telemetria segura,
mas não criam `AuditLog`. Operações privilegiadas concluídas preservam a auditoria de domínio já
existente.

## Health

- `GET /health` preserva o health check histórico e seu payload.
- `GET /health/live` confirma apenas que o processo HTTP está vivo e não consulta dependências.
- `GET /health/ready` executa `SELECT 1` via Prisma no PostgreSQL e responde `200` com
  `{"status":"ready"}` ou, após falha/timeout lógico de dois segundos, `503` com
  `{"status":"not_ready"}`.

A readiness mantém no máximo um probe real em andamento. Um timeout HTTP não cancela nem libera a
query subjacente; chamadas seguintes reutilizam o mesmo probe até ele encerrar. O IdP OIDC e serviços
externos não fazem parte da readiness.

As três rotas de health são públicas. Sucessos são telemetria de nível `DEBUG`; falhas de readiness
geram `WARN` sanitizado, sem detalhes de conexão.

## Limites atuais

Esta fundação não implementa métricas, tracing distribuído, W3C Trace Context, OpenTelemetry, SIEM,
Service Actors, conectores ou filas. Uma execução futura poderá carregar um `connectorRunId`, mas ele
não integra o contexto HTTP atual e deverá manter distinção entre request, correlation, run, trace e
span IDs.
