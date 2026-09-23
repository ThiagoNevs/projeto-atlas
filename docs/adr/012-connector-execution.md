# ADR-012 — Execução de conectores

Status: Accepted

## Context

Conectores futuros precisarão executar trabalho assíncrono durável com retry, backoff,
dead-letter, redrive, cancelamento limitado e recuperação após falhas. O deployment inicial do
Atlas é Dedicated-first e já possui PostgreSQL como system of record, Prisma como acesso de domínio
e uma fronteira explícita entre referência e material secreto.

O mecanismo inicial deve permitir que uma escrita de domínio e o enqueue correspondente sejam
confirmados ou revertidos na mesma transação PostgreSQL, sem transformar tabelas internas da fila em
modelos Prisma nem adicionar outra dependência stateful por instalação Dedicated.

## Decision

O Atlas usará pg-boss como mecanismo inicial de Connector Execution para deployments Dedicated.
Essa decisão cobre jobs de conectores que sejam limitados, duráveis, retryable e idempotentes. Ela
não transforma o Connector Framework em funcionalidade implementada nem promete semânticas de
checkpoint, replay de workflow ou saga comparáveis às do Temporal.

O desenho inicial será:

```text
PostgreSQL
├── dados de domínio do Atlas
└── schema de infraestrutura do pg-boss
```

Redis e Temporal não são requisitos para esse primeiro modelo.

### Fronteira transacional

A integração pública `fromPrisma(tx)` será usada quando uma escrita de domínio precisar criar um
job atomicamente:

```text
COMMIT:
escrita de domínio + enqueue persistem

ROLLBACK:
nenhuma das duas operações persiste
```

Essa integração foi validada com Prisma 7.8 e PostgreSQL 17 sem usar internals privados do Prisma.
Ela garante atomicidade entre dados no mesmo PostgreSQL, não atomicidade com sistemas externos.

### Semântica de entrega

```text
claim/entrega do job
!=
efeito de negócio externo exatamente uma vez
```

Uma falha após o efeito externo e antes do acknowledgement pode fazer o mesmo job ser entregue
novamente. Todo handler que produza efeito externo deve usar idempotency key, deduplicação no destino
ou reconciliação equivalente. A chave deve ser estável por operação lógica, não por tentativa.

### Política de versão

A arquitetura escolhe pg-boss, não uma versão permanente. A implementação de produção deverá:

- fixar uma versão exata, sem usar `latest` ou range flutuante;
- respeitar uma janela explícita de estabilização e revisão de supply chain;
- registrar integridade e árvore de dependências no lockfile;
- revalidar atomicidade, lifecycle, migrations e semântica de falha em cada upgrade material.

As versões 12.26.3 e 12.33.6 são evidência da decisão, não pins permanentes.

### Propriedade do schema

O schema do pg-boss pertence à infraestrutura de Connector Execution:

- o Prisma não modela tabelas do pg-boss;
- migrations Atlas não criam nem atualizam o schema do pg-boss;
- workers de produção iniciam com `migrate: false`;
- incompatibilidade entre binário e schema deve falhar fechada.

O upgrade seguirá uma etapa controlada:

```text
backup e maintenance gate
→ migration explícita do pg-boss com versão fixada
→ validação do schema
→ startup dos workers
```

O runtime normal não recebe permissão para executar DDL nem migra silenciosamente a fila durante o
startup. O deployment deve possuir runbook de upgrade, rollback e incompatibilidade de versões.

### Operação

Antes do primeiro conector, Connector Execution deve expor ou monitorar:

- health e readiness dos workers;
- queue depth e idade do job mais antigo;
- jobs em retry e duração das execuções;
- jobs failed/DLQ e operação controlada de redrive;
- retenção e cleanup;
- orçamento e saturação de conexões;
- compatibilidade entre pacote e schema.

Backup e PITR incluem o schema do pg-boss no mesmo ponto de consistência do banco de domínio. Restore
e upgrades devem ocorrer com workers coordenados pelo runbook operacional.

### Segurança

`SecretReference != SecretMaterial` permanece obrigatório. Payloads não podem persistir credenciais
resolvidas, access tokens, passwords, client secrets, private keys ou respostas brutas de providers.
Payloads futuros precisam de schema validado, versionamento, limite de tamanho e tratamento redigido
de erros.

## Alternatives Considered

- **Processo Nest in-memory:** rejeitado por não oferecer durabilidade suficiente em restart, crash
  ou indisponibilidade do processo.
- **BullMQ + Redis:** adiado porque adicionaria outra dependência stateful, backup, monitoramento e
  operação por deployment Dedicated sem necessidade comprovada no modelo inicial.
- **Temporal:** adiado porque seu modelo e custo operacional são desproporcionais para jobs iniciais
  limitados; volta a ser candidato se checkpoint/replay e sagas se tornarem centrais.
- **Fila PostgreSQL própria:** rejeitada porque reproduzir claim concorrente, retry, DLQ, scheduling,
  retenção e migrations aumentaria risco e custo sem vantagem demonstrada.

## Consequences

- O Atlas reutiliza PostgreSQL e preserva uma fronteira transacional única para domínio e enqueue.
- Dedicated ganha simplicidade operacional por não introduzir Redis ou um orquestrador separado.
- A fila compartilha capacidade, backup e blast radius com o banco de domínio; pool, retenção e
  contenção precisam de limites explícitos.
- Jobs externos continuam obrigados a ser idempotentes.
- O schema da fila exige ownership e upgrade independentes das migrations Prisma.
- Connector Execution, Connector Framework e conectores reais continuam exigindo PRs próprios.

## Security / Operational Considerations

Workers devem operar com least privilege. A role normal precisa apenas das permissões DML e de
execução necessárias; uma role operacional separada executa migrations do pg-boss. Jobs carregam
identificadores, referências e contexto mínimo, nunca material secreto.

Retenção não substitui backup. Métricas não devem expor payloads. Redrive é operação privilegiada e
deve preservar correlation/run IDs, idempotência e auditoria quando for implementado.

## Reconsider When

- contenção do PostgreSQL se tornar material;
- pressão de conexões se tornar inaceitável;
- a fila precisar de scaling ou isolamento independente do banco de domínio;
- checkpoint e replay de workflow se tornarem necessários;
- sagas complexas se tornarem parte central do produto;
- Redis se tornar dependência obrigatória por outra decisão arquitetural;
- uma fila gerenciada externa se tornar requisito;
- o acoplamento de upgrade, backup ou disaster recovery se tornar inaceitável.

## Related Decisions

ADR-004, ADR-005, ADR-010, ADR-011, ADR-013 e ADR-016.
