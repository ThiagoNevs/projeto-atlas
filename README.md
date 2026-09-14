# Projeto Atlas

O Atlas é uma plataforma de inteligência de ativos baseada em evidências. Seu objetivo é
transformar observações técnicas e decisões administrativas em uma visão consolidada,
rastreável e útil para times de infraestrutura, segurança, suporte e sustentação.

O MVP atual demonstra o ciclo completo de um ativo: ingestão, consolidação, evidências,
timeline, avaliação de confiança e qualidade, decisões administrativas auditáveis e tratamento
de conflitos.

## Funcionalidades atuais

- Dashboard executivo e operacional com saúde do inventário, sinais de atenção, sistemas operacionais obsoletos, atividade recente e ações recomendadas.
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
- Finding Review com achados derivados, casos persistidos, transições operacionais, primeira decisão de identidade, resolução e reabertura lógicas, timeline e auditoria.
- Tela de auditoria com busca, filtros, resumo, paginação e detalhe dos registros.
- Tela operacional de qualidade dos dados com lacunas, scores e prioridades de correção.
- Declaração manual de ativos ainda não observados por fontes técnicas, com evidência e auditoria.
- Enriquecimento manual de campos ausentes sem sobrescrever valores técnicos atuais.
- Fontes de Dados com catálogo de origens atuais e conectores planejados, sem integrações reais.
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
- Portas locais 3000, 3001, 3199 e 5432 disponíveis.

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

O baseline agora exige autenticação OIDC Authorization Code + PKCE. Para desenvolvimento local
isolado, o repositório oferece um issuer descartável e exclusivamente test-only:

```powershell
corepack pnpm dev:oidc:test
```

Inicie-o antes da API e do frontend quando usar os valores dos arquivos `.env.example`. Em qualquer
ambiente compartilhado ou produtivo, substitua-o por um issuer OIDC administrado. O Atlas não possui
tabela `User`, formulário de senha ou client secret no browser. A API protege os endpoints de domínio
por padrão; somente `GET /health`, `GET /health/live` e `GET /health/ready` são públicos.
`GET /auth/me` retorna a projeção segura do ator validado.
O access token fica somente em memória e desaparece em reload/logout; apenas state, nonce e PKCE
transitórios do redirect podem usar o namespace `atlas:oidc:transaction:` no `sessionStorage`.

A autorização granular é derivada de roles externas do token OIDC e aplicada pela API com política
explícita em cada handler. O gate `atlas:access` permanece independente: possuir uma role granular não
concede acesso ao Atlas. Configure valores externos exatos e case-sensitive em
`AUTH_VIEWER_ROLE_VALUES`, `AUTH_ANALYST_ROLE_VALUES` e `AUTH_ADMIN_ROLE_VALUES`; um mesmo valor em
mais de uma lista impede a inicialização. Para Microsoft Entra ID, prefira App Roles emitidas na claim
`roles` e configure `AUTH_ROLE_CLAIM=roles`; a implementação permanece genérica e não consulta o
Microsoft Graph.

Os controllers dependem somente das 16 permissions tipadas, nunca de nomes de roles. Viewer possui
leituras de inventário, análises, conflitos, casos e discovery. Analyst acrescenta manutenção manual,
exportação, tratamento de conflitos e casos, execução de discovery e auditoria. Admin acrescenta
alteração administrativa, importação, configuração de discovery e ingestão. Admin não possui bypass.
Handlers autenticados sem `@RequirePermissions(...)` falham fechados com HTTP 403, e um teste de
completude protege os 44 handlers autenticados atuais. O frontend consome apenas as permissions de
`/auth/me`, oculta navegação e comandos não autorizados e apresenta “Acesso negado” em deep links; a
API continua sendo a autoridade. HTTP 403 não encerra a sessão, enquanto HTTP 401 preserva o fluxo de
reautenticação existente.

```text
atlas:access
inventory:read | inventory:maintain | inventory:status:update | inventory:import | inventory:export
analysis:read
conflict:read | conflict:manage
review-case:read | review-case:manage
discovery:read | discovery:configure | discovery:execute
ingestion:execute
audit:read
```

A funcionalidade experimental de casos de revisão permanece desabilitada por padrão. Para validá-la
apenas em desenvolvimento local, defina `FINDING_REVIEW_CASES_ENABLED=true` antes de iniciar a API. A
flag controla o fluxo implementado de Finding Review: criação, listagem, detalhe, transições,
decisão, resolução, reabertura e respectivos replays. A autoria de novas operações vem do
`CurrentActor` derivado exclusivamente do access token validado; registros históricos com
`atlas-mvp-user` não são reescritos. Com a flag desabilitada ou inválida, todos esses
endpoints retornam HTTP 503, inclusive em tentativas de replay. A `Idempotency-Key` é case-sensitive,
aceita somente caracteres ASCII seguros e nunca é persistida em formato bruto. O nome HTTP do header
não diferencia maiúsculas de minúsculas, mas o valor diferencia; headers duplicados são rejeitados.

O fingerprint usa SHA-256 sobre uma estrutura canônica com operação, ator provisório e chave exata.
O contrato `snapshotVersion: 1` usa comparação binária com `<` e `>`, independente de locale e ICU:
conjuntos aprovados são normalizados explicitamente, listas semanticamente ordenadas são preservadas
e o hash é SHA-256 hexadecimal. Vetores sintéticos fixos protegem esses contratos; refresh e
revalidação de snapshots continuam fora do escopo.

`GET /conflict-review-cases` oferece paginação, filtros e ordenação estável sem carregar snapshots na
lista. `GET /conflict-review-cases/:id` retorna o snapshot original persistido, seu hash, identidades
históricas dos ativos e eventos seguros. As leituras não recalculam findings, não criam auditoria e não
alteram casos ou inventário. A interface em `/conflict-review-cases` lista, filtra e detalha casos e
permite iniciar a criação a partir de um achado atual. No detalhe, estados operacionais ativos podem ser
alterados entre Aberto, Em análise e Aguardando evidências. O PATCH usa `expectedVersion`, retorna 409
quando outra operação vence a concorrência e registra evento e `AuditLog` na mesma transação. Essa
operação não usa `Idempotency-Key`; em resultado de rede incerto, a interface exige recarregar o caso.
Como a versão é um PostgreSQL `INT4` e a transição sempre incrementa o valor, o maior
`expectedVersion` aceito é `2147483646`. Valores superiores retornam HTTP 400 antes da transação,
sem escrita e sem exposição de erro Prisma.
A primeira decisão de identidade, a resolução lógica para `RESOLVED` e a reabertura lógica para
`IN_REVIEW` estão implementadas e preservam o histórico sem alterar inventário ou `Conflict`.
Comandos para `DISMISSED`/`CANCELLED`, comentários, atribuição, refresh e adoção persistente de novo
contexto continuam fora do escopo.

Filtros, paginação, ordenação e o detalhe compartilhável por `caseId` acompanham a URL e o histórico do
navegador. O frontend cancela leituras obsoletas, valida respostas em runtime e trata como incerto um
POST de criação que ultrapasse dez segundos ou termine com falha de rede. A tentativa nasce em memória
no clique explícito e só é persistida no `sessionStorage` quando o resultado fica incerto. Seu envelope
versionado mantém criação e expiração fixas por 15 minutos: retries reutilizam a mesma chave sem renovar
o TTL. Todo retry revalida o envelope: antes dos 15 minutos reutiliza a chave original; quando
`now >= expiresAt`, a tentativa é expirada. Conteúdo inválido ou expirado é removido e interrompe o
clique sem enviar POST. Uma nova chave só nasce em outra ação explícita. Se o `sessionStorage` estiver
indisponível, o envelope completo em memória ainda protege a montagem atual e aplica o mesmo TTL; uma
remontagem não consegue recuperar essa tentativa sem o storage. Respostas conclusivas limpam somente o
envelope correspondente, mesmo se a tela já tiver sido desmontada, e a chave nunca é exposta na URL.

No detalhe, o foco é direcionado ao título somente após sucesso ou erro concluir o carregamento. O frame
pendente é cancelado ao fechar, trocar de caso ou desmontar a tela, evitando foco em conteúdo obsoleto.

Os filtros temporais aceitam somente timestamps ISO 8601 completos com `Z` ou offset explícito; datas
sem horário e horários sem timezone são rejeitados. `page` e `pageSize` usam representação decimal
canônica, sem whitespace ou notação científica, e o backend protege inteiros e offsets numericamente
seguros. O filtro `findingId` exige `finding_` seguido de 24 caracteres hexadecimais minúsculos.

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
corepack pnpm dev:oidc:test
```

Frontend e backend autenticados devem ser publicados atomicamente. Rollback também deve restaurar os
dois juntos; não existe fallback anônimo nem `AUTH_ENABLED=false`. Em implantação separada, só é
seguro publicar primeiro um frontend já compatível com Bearer e imediatamente depois ativar o backend
default-deny, dentro da mesma janela controlada.

## URLs principais

- Dashboard: [http://localhost:3000](http://localhost:3000)
- Inventário: [http://localhost:3000/assets](http://localhost:3000/assets)
- Importação de ativos (CSV, XLSX, XLSM e conteúdo colado): [http://localhost:3000/assets/import](http://localhost:3000/assets/import)
- Resolution Center: [http://localhost:3000/conflicts](http://localhost:3000/conflicts)
- Achados de identidade e rede: [http://localhost:3000/conflict-findings](http://localhost:3000/conflict-findings)
- Casos de revisão: [http://localhost:3000/conflict-review-cases](http://localhost:3000/conflict-review-cases)
- Network Discovery Lite: [http://localhost:3000/network-discovery](http://localhost:3000/network-discovery)
- Auditoria: [http://localhost:3000/audit](http://localhost:3000/audit)
- Qualidade dos dados: [http://localhost:3000/data-quality](http://localhost:3000/data-quality)
- Fontes de dados: [http://localhost:3000/data-sources](http://localhost:3000/data-sources)
- API: [http://localhost:3001](http://localhost:3001)
- Health check: [http://localhost:3001/health](http://localhost:3001/health)
- Resumo do dashboard: [http://localhost:3001/dashboard/summary](http://localhost:3001/dashboard/summary)
- Catálogo de fontes de dados: [http://localhost:3001/data-sources](http://localhost:3001/data-sources)
- Importação CSV de ativos: [http://localhost:3001/assets/import/csv](http://localhost:3001/assets/import/csv)
- Importação de planilhas XLSX/XLSM: [http://localhost:3001/assets/import/spreadsheet](http://localhost:3001/assets/import/spreadsheet)
- Pré-validação de importação: [http://localhost:3001/assets/import/preview](http://localhost:3001/assets/import/preview)
- Confirmação parcial da importação: [http://localhost:3001/assets/import/commit](http://localhost:3001/assets/import/commit)
- Exportação CSV de qualidade: [http://localhost:3001/data-quality/assets/export](http://localhost:3001/data-quality/assets/export)

Na tela de importação, o resultado da análise e o resultado final podem ser baixados em CSV. Os
relatórios são gerados em memória no navegador, não são armazenados e neutralizam valores que
poderiam ser interpretados como fórmulas por Excel ou LibreOffice.

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
- [Contexto operacional da API](docs/operational-context.md)
- [Modelo de dados](docs/data-model.md)
- [Escopo de produto](docs/product-scope.md)
- [Exemplos da API](docs/api-examples.md)
- [Massa demo](docs/demo-data.md)
- [Network Discovery Lite](docs/network-discovery-lite.md)
- [Desenho do fluxo de revisão de achados](docs/conflict-review-workflow-design.md)
