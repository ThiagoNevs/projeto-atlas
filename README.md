# Projeto Atlas

O Atlas é uma plataforma de inteligência de ativos baseada em evidências. Seu objetivo é
transformar observações técnicas e decisões administrativas em uma visão consolidada,
rastreável e útil para times de infraestrutura, segurança, suporte e sustentação.

O MVP atual demonstra o ciclo completo de um ativo: ingestão, consolidação, evidências,
timeline, avaliação de confiança e qualidade, decisões administrativas auditáveis e tratamento
de conflitos.

## Funcionalidades atuais

- Dashboard executivo e operacional com indicadores, saúde do inventário, distribuição por sistema operacional, atividade recente e ações recomendadas.
- Inventário pesquisável de ativos de infraestrutura.
- Busca, filtros, ordenação e paginação de ativos e conflitos.
- Detalhe do ativo com identificação, atributos, interfaces, scores e estado atual.
- Evidências e timeline rastreável.
- Ingestão manual/simulada idempotente.
- Histórico de atributos e interfaces sem duplicações indevidas.
- Status operacional derivado de evidência.
- Alteração manual e auditável do status administrativo.
- Detecção de ativo administrativamente encerrado que voltou a aparecer.
- Conflitos de ciclo de vida e identidade de rede.
- Resolution Center com mudança auditável de status.
- Tela de auditoria com busca, filtros, resumo, paginação e detalhe dos registros.
- Tela operacional de qualidade dos dados com lacunas, scores e prioridades de correção.
- Massa fictícia com 15 cenários de demonstração.
- Network Discovery Lite simulado, escopado a redes privadas e auditável.
- Interface em português com tratamento de loading, erro e hydration.
- Suíte E2E integrada ao PostgreSQL.

## Arquitetura resumida

```text
Navegador
   |
   v
Next.js + React (apps/web)
   |
   | HTTP/JSON
   v
NestJS (apps/api)
   |
   v
Prisma ORM
   |
   v
PostgreSQL em Docker
```

O monorepo também contém `packages/shared` para contratos compartilhados, `infra` para a
infraestrutura local e `docs` para decisões e documentação do produto.

## Tecnologias

- Node.js 22+
- pnpm 11 via Corepack
- Next.js 16, React 19 e TypeScript
- NestJS 11 e TypeScript
- Prisma 7
- PostgreSQL 17
- Docker Compose
- Jest e Supertest
- ESLint e Prettier

## Estrutura

```text
atlas/
├── apps/
│   ├── api/              # NestJS, Prisma e testes E2E
│   └── web/              # Next.js com App Router
├── docs/                 # Produto, arquitetura, operação e demo
├── infra/
│   └── docker-compose.yml
├── packages/
│   └── shared/
├── package.json
└── pnpm-workspace.yaml
```

## Pré-requisitos

- Node.js 22.13 ou superior.
- Corepack habilitado.
- Docker Desktop com engine em execução.
- Portas locais 3000, 3001 e 5432 disponíveis.

## Como rodar localmente

### 1. Preparar o projeto

```powershell
Set-Location 'C:\Users\jrthi\Documents\Codex\2026-07-02\vamos-iniciar-o-mvp-do-projeto\atlas'
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
corepack pnpm install
```

Em outro computador, ajuste apenas o caminho usado no `Set-Location`. O frontend usa
`NEXT_PUBLIC_API_URL` para localizar a API. Variáveis `NEXT_PUBLIC_*` são públicas e nunca devem
conter segredos.

### 2. Iniciar o PostgreSQL

```powershell
corepack pnpm infra:up
docker compose -f infra/docker-compose.yml ps
```

O PostgreSQL fica disponível em `localhost:5432`. O volume `atlas_postgres_data` preserva os
dados entre reinicializações.

### 3. Aplicar migrations

```powershell
corepack pnpm db:migrate
```

Para apenas aplicar migrations existentes em um ambiente não interativo:

```powershell
corepack pnpm --filter @atlas/api exec prisma migrate deploy
```

### 4. Carregar a massa demo

```powershell
corepack pnpm db:seed
```

O seed pode ser repetido e limpa somente os dados identificados como demonstração. Consulte
[docs/demo-data.md](docs/demo-data.md) para conhecer os cenários.

### 5. Iniciar API e frontend

```powershell
corepack pnpm dev
```

Também é possível iniciar separadamente:

```powershell
corepack pnpm dev:api
corepack pnpm dev:web
```

## URLs principais

- Dashboard: [http://localhost:3000](http://localhost:3000)
- Inventário: [http://localhost:3000/assets](http://localhost:3000/assets)
- Resolution Center: [http://localhost:3000/conflicts](http://localhost:3000/conflicts)
- Network Discovery Lite: [http://localhost:3000/network-discovery](http://localhost:3000/network-discovery)
- Auditoria: [http://localhost:3000/audit](http://localhost:3000/audit)
- Qualidade dos dados: [http://localhost:3000/data-quality](http://localhost:3000/data-quality)
- API: [http://localhost:3001](http://localhost:3001)
- Health check: [http://localhost:3001/health](http://localhost:3001/health)
- Resumo do dashboard: [http://localhost:3001/dashboard/summary](http://localhost:3001/dashboard/summary)

## Comandos úteis

```powershell
corepack pnpm dev           # inicia web, API e shared em modo watch
corepack pnpm dev:web       # inicia apenas o Next.js
corepack pnpm dev:api       # inicia apenas o NestJS
corepack pnpm infra:up      # inicia o PostgreSQL
corepack pnpm infra:logs    # acompanha os logs do PostgreSQL
corepack pnpm infra:down    # encerra a infraestrutura local
corepack pnpm db:migrate    # aplica/cria migrations em desenvolvimento
corepack pnpm db:seed       # recria a massa fictícia de demonstração
corepack pnpm db:studio     # abre o Prisma Studio
corepack pnpm test          # executa a suíte E2E
corepack pnpm lint          # executa o lint
corepack pnpm typecheck     # verifica os tipos TypeScript
corepack pnpm build         # gera os builds de produção
corepack pnpm format:check  # verifica a formatação
```

Usar `corepack pnpm` evita o bloqueio de `pnpm.ps1` em instalações do PowerShell com política
de execução restrita.

## Aviso sobre descoberta de rede

O Network Discovery Lite é exclusivamente simulado no MVP. Ele não executa ping, DNS reverso,
ARP, scan de portas, Nmap, autenticação, SSH, WMI, WinRM, SNMP ou comandos remotos. Os métodos
simulados geram observações determinísticas em CIDRs privados para validar o fluxo do produto
sem produzir tráfego real de rede.

## Documentação

- [Estado do MVP](docs/mvp-status.md)
- [Roadmap](docs/roadmap.md)
- [Riscos técnicos](docs/technical-risks.md)
- [Preparação para demo](docs/demo-readiness.md)
- [Roteiro de demo](docs/demo-script.md)
- [Guia local](docs/getting-started.md)
- [Arquitetura](docs/architecture.md)
- [Modelo de dados](docs/data-model.md)
- [Escopo de produto](docs/product-scope.md)
- [Exemplos da API](docs/api-examples.md)
- [Massa demo](docs/demo-data.md)
- [Network Discovery Lite](docs/network-discovery-lite.md)
