# Evidência do spike — Connector Execution com pg-boss

Data da validação final: 2026-09-23

Status: evidência arquitetural; não é implementação do Connector Framework

ADR relacionado: ADR-012 — Accepted

## Objetivo e escopo

O spike avaliou se pg-boss pode sustentar o mecanismo inicial de Connector Execution no deployment
Dedicated do Atlas. Os experimentos ocorreram em PostgreSQL descartável e não criaram endpoints,
workers de produção, contratos públicos, credenciais operacionais ou migrations Prisma.

O runtime experimental e as alterações de dependência não fazem parte da decisão documental. Este
registro preserva somente as conclusões reproduzíveis que fundamentaram o ADR.

## Versões e ambientes validados

| Componente          | Primeira validação         | Validação final     |
| ------------------- | -------------------------- | ------------------- |
| pg-boss             | 12.26.3 / schema 37        | 12.33.6 / schema 42 |
| Node.js             | baseline Atlas `>=22.13.0` | 22.22.0             |
| PostgreSQL          | 17.11                      | 17.11               |
| Prisma / adapter-pg | 7.8.0                      | 7.8.0               |
| NestJS              | 11.x                       | 11.x                |

A versão 12.33.6 foi instalada por pin exato a partir do registry configurado, com integridade
registrada no lockfile. O frozen install offline preservou o mesmo hash do lockfile. Como a versão
era recém-publicada, uma implementação de produção deve aplicar a janela de estabilização aprovada
antes de escolher seu pin definitivo.

## Evidência funcional

| Propriedade                | Resultado             | Limite observado                                                                   |
| -------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| Lifecycle Nest             | Passou                | Start e stop integrados ao lifecycle.                                              |
| Coexistência de schema     | Passou                | Schema pg-boss separado; Prisma permaneceu com 11 migrations.                      |
| Commit domínio + enqueue   | Passou                | Registro de domínio e job persistiram juntos.                                      |
| Rollback domínio + enqueue | Passou                | Registro de domínio e job foram revertidos juntos.                                 |
| Integração Prisma          | Passou                | API pública `fromPrisma(tx)`, sem internals privados.                              |
| Claim concorrente          | Passou                | Duas instâncias não trataram simultaneamente o mesmo claim.                        |
| Retry e backoff            | Passou                | Falha transitória foi reentregue conforme configuração.                            |
| DLQ e redrive              | Passou                | Exaustão moveu o job e redrive retornou ao fluxo.                                  |
| Expiração e heartbeat      | Passou                | Claim abandonado foi recuperado e heartbeat foi observado.                         |
| Reconexão PostgreSQL       | Passou                | Nova operação funcionou após interrupção das sessões.                              |
| Shutdown gracioso          | Passou                | Handler ativo curto terminou antes do encerramento.                                |
| Cancelamento               | Parcialmente passou   | Job não reclamado foi cancelado; efeito externo ativo não é cancelado magicamente. |
| Scheduling                 | Passou                | Cron foi exercitado deterministicamente na versão atual.                           |
| Retenção e cleanup         | Passou                | Job concluído foi removido após a retenção configurada.                            |
| Payload sem segredo        | Passou como fronteira | Somente `SecretReference`; material secreto foi rejeitado.                         |

A revalidação da versão atual executou 16 cenários no Node 22. O Jest do Atlas hoje transforma
TypeScript para CommonJS; o teste isolado precisou de configuração ESM para carregar pg-boss no
Node 22. O runtime CommonJS e ESM funcionou, mas a futura implementação deve formalizar essa
fronteira de testes.

## Atomicidade transacional

```text
Prisma interactive transaction
→ escrita de domínio controlada
→ enqueue com db: fromPrisma(tx)
→ commit
→ domínio presente e job presente
```

```text
Prisma interactive transaction
→ escrita de domínio controlada
→ enqueue com db: fromPrisma(tx)
→ falha forçada
→ rollback
→ domínio ausente e job ausente
```

A conclusão vale para operações dentro do mesmo PostgreSQL. Ela não abrange efeitos em APIs ou
sistemas externos.

## Falhas e efeitos externos

Foi reproduzido o seguinte cenário:

```text
handler executa efeito externo simulado
→ processo falha antes do acknowledgement
→ pg-boss entrega novamente
→ o efeito externo ocorre uma segunda vez
```

Portanto:

```text
claim/entrega do job != efeito externo exatamente uma vez
```

Handlers futuros devem usar idempotency key estável, deduplicação no destino ou reconciliação.

## Upgrade e propriedade operacional

O upgrade experimental de schema 37 para 42 preservou o job e seu payload. Com `migrate: false`,
binário e schema incompatíveis falharam fechados. O comportamento padrão `migrate: true` atualizou o
schema no startup, motivo pelo qual ele não deve ser usado pelos workers de produção.

O modelo recomendado é:

```text
workers: migrate=false
role de runtime: sem DDL
role operacional: migration explícita do pg-boss
backup/maintenance gate
→ migration
→ validação de schema
→ workers
```

Rollback entre versões e restauração de jobs já ativos ainda precisam de ensaio no runbook antes do
primeiro deployment operacional.

## Backup e restore

Um dump custom-format do schema de infraestrutura foi restaurado em banco descartável. O restore
preservou:

- schema version 42;
- job atrasado;
- payload identificador do job.

O backup/PITR de produção deve incluir dados de domínio e pg-boss no mesmo ponto de consistência.
Workers precisam estar coordenados durante restore; o experimento não validou restore de job que
estivesse ativo no instante do backup.

## Conexões

A validação com duas instâncias e pool máximo 2 por instância observou:

```text
antes do start:    0
depois do start:   2
durante atividade: 2
depois do stop:    0
```

Não houve vazamento. O resultado não substitui capacity planning. Cada deployment deve orçar API,
Prisma, workers e manutenção. `LISTEN/NOTIFY` não foi adotado no spike; se habilitado, precisa de
conexão dedicada e validação própria.

## Rehearsals e gates restantes

Antes do primeiro conector operacional ainda são necessários:

- teste de carga, crescimento e retenção por período representativo;
- orçamento de conexões e limites de concorrência;
- SLOs, métricas e alertas para depth, oldest job, retry e DLQ;
- ensaio de rollback de schema e restore de jobs ativos;
- validação de failover no PostgreSQL alvo do deployment;
- contrato versionado e limitado para payloads;
- idempotência definida para cada destino externo;
- configuração ESM reproduzível na suíte que cobrir o runtime produtivo;
- validação específica de `LISTEN/NOTIFY`, caso ele seja habilitado.

## Disposição do spike

```text
runtime experimental incorporado: não
dependência experimental incorporada: não
migration Prisma incorporada: não
evidência arquitetural preservada: sim
```

Connector Execution, Connector Framework e qualquer conector real continuam sendo trabalhos
separados, sujeitos aos gates arquiteturais e de segurança existentes.
