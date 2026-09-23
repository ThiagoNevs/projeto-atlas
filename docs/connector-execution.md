# Connector Execution Foundation

## Estado e escopo

O Atlas usa `pg-boss@12.33.6`, fixado exatamente, como fundação de execução durável no deployment
Dedicated. Esta fundação oferece lifecycle, enqueue, enqueue transacional, workers limitados,
retry/backoff, DLQ/redrive, estado interno e integração de readiness.

Ela **não é o Connector Framework**. Não existem neste estágio conectores Microsoft, chamadas de
providers, API ou UI de connectors, credenciais operacionais ou modelos de domínio específicos.

```text
implementação da foundation: validável
go-live produtivo: bloqueado pelo gate explícito de estabilização/revisão
```

## Configuração

Connector Execution permanece desabilitado por padrão:

```dotenv
CONNECTOR_EXECUTION_ENABLED=false
CONNECTOR_EXECUTION_SCHEMA=pgboss
CONNECTOR_EXECUTION_POOL_MAX=2
CONNECTOR_EXECUTION_PAYLOAD_MAX_BYTES=65536
CONNECTOR_EXECUTION_SHUTDOWN_TIMEOUT_MS=30000
```

Quando desabilitado, nenhuma conexão pg-boss é aberta. Quando habilitado, `DATABASE_URL` é
obrigatória, a configuração é validada no startup e o processo falha fechado se o schema estiver
ausente, desatualizado ou incompatível. A URL nunca deve ser passada como argumento CLI nem escrita
em logs.

O pool pg-boss é separado do pool Prisma e limitado por `CONNECTOR_EXECUTION_POOL_MAX` (1–10). O
capacity planning de cada instalação deve reservar conexões para API/Prisma, workers e manutenção.
`LISTEN/NOTIFY` permanece desabilitado até validação operacional própria.

## Migration explícita

Workers sempre usam `migrate:false`. O schema pg-boss pertence à infraestrutura e não é modelado
nem versionado pelas migrations Prisma do Atlas.

O operador executa a migration com a mesma versão fixada no lockfile:

```powershell
corepack pnpm connector-execution:migrate
```

Fluxo obrigatório de deployment:

```text
backup e maintenance gate
→ migration explícita do pg-boss
→ validação de versão e drift do schema
→ habilitar/iniciar Connector Execution com migrate:false
```

O comando usa a API oficial do pacote, retorna código diferente de zero em falha e não contém cópia
manual do SQL interno do pg-boss. Upgrade e rollback exigem runbook e ensaio em banco descartável
antes de uso operacional.

## Contrato de execução

Callers dependem de `ConnectorExecutionService`, não de `PgBoss`. A interface Atlas fornece:

- enqueue normal e enqueue dentro de uma transação Prisma via `fromPrisma(tx)`;
- registro e parada de worker com concorrência limitada;
- retry/backoff, expiração/heartbeat e dead-letter configuráveis com limites;
- cancelamento antes/na semântica suportada pelo pg-boss e redrive controlado;
- estado seguro de fila para métricas futuras.

```text
claim/entrega do job != efeito externo exatamente uma vez
```

O envelope versionado carrega uma idempotency key da operação lógica. Essa chave permanece a mesma
em retries. Todo handler que cause efeito externo deverá implementar deduplicação no destino,
idempotência ou reconciliação; a foundation não promete exactly-once externo.

## Segurança e observabilidade

O payload é JSON validado e limitado. Versões desconhecidas, estruturas inválidas, payloads grandes
e chaves de material secreto falham fechadas. `SecretReference != SecretMaterial`: referências ENV
validadas podem ser transportadas, mas passwords, tokens, client secrets, private keys, respostas
brutas e segredos resolvidos não podem ser enfileirados.

Logs estruturados registram somente evento, queue/job IDs, correlation ID, duração e tipos/códigos de
erro sanitizados. Payload, `DATABASE_URL`, tokens, respostas de provider e material/referências de
segredo não são logados.

Readiness mantém o timeout e single-flight existentes. Desabilitado não muda a semântica atual;
habilitado exige startup bem-sucedido e versão de schema compatível. Nenhuma rota pública foi
adicionada: permanecem apenas `/health`, `/health/live` e `/health/ready`.
