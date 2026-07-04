# Modelo de dados do MVP

O schema Prisma está em `apps/api/prisma/schema.prisma` e usa PostgreSQL.

## Relações principais

```text
Asset
├── AssetAttribute ──> AssetEvidence (opcional)
├── AssetEvidence
│   ├── AssetEvent
│   ├── NetworkInterface
│   └── ConflictValue
├── AssetEvent
├── NetworkInterface
├── Conflict
│   └── ConflictValue
├── AuditLog
└── NetworkDiscoveryResult

NetworkDiscoveryProfile
└── NetworkDiscoveryRun
    └── NetworkDiscoveryResult ──> Asset (opcional)
```

## Semântica

- `AssetEvidence` preserva a observação bruta recebida de uma fonte.
- `AssetAttribute` mantém versões históricas e confirmações do valor atual.
- `AssetEvent` forma a timeline e pode apontar para uma evidência.
- `NetworkInterface` preserva identidade por MAC ou IP e histórico de observação.
- `Conflict` representa a divergência; `ConflictValue` preserva valores envolvidos.
- `AuditLog` registra decisões administrativas, tratamento de conflitos e execuções de discovery.
- `NetworkDiscoveryProfile` define modo, métodos, limites e CIDRs autorizados/negados.
- `NetworkDiscoveryRun` registra estado, duração, contadores e resumo da tentativa.
- `NetworkDiscoveryResult` registra a observação simulada e seu vínculo opcional com um ativo.

Valores de `confidenceScore` e `dataQualityScore` usam escala de 0 a 100 com até duas casas
decimais.

## Integridade e histórico

- Relações dependentes de ativos usam cascata quando o histórico não faz sentido sem o ativo.
- Resultados de discovery preservam o registro e removem apenas o vínculo quando o ativo é
  excluído.
- Runs de discovery são criados antes do processamento, permitindo persistir o estado `FAILED`.
- Migrations antigas não devem ser editadas depois de aplicadas; mudanças são feitas por
  migrations corretivas.

## Comandos

```powershell
corepack pnpm db:validate
corepack pnpm db:format
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:studio
```

O PostgreSQL local deve estar ativo antes de executar migrations ou o Prisma Studio.
