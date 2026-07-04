# Guia de desenvolvimento local

## 1. Configurar o ambiente

Entre na raiz `atlas/` pelo caminho completo e crie o arquivo local de ambiente:

```powershell
Set-Location 'C:\Users\jrthi\Documents\Codex\2026-07-02\vamos-iniciar-o-mvp-do-projeto\atlas'
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
corepack pnpm install
```

O arquivo `.env` não deve ser versionado. Os valores de exemplo destinam-se apenas ao
desenvolvimento local.

O frontend usa `NEXT_PUBLIC_API_URL` em `apps/web/.env.local` para localizar a API. Variáveis
com o prefixo `NEXT_PUBLIC_` são públicas no navegador e não devem conter segredos.

## 2. Iniciar o PostgreSQL

Confirme que o Docker Desktop está aberto e com o engine em execução. Depois rode:

```powershell
corepack pnpm infra:up
docker compose -f infra/docker-compose.yml ps
```

O volume `atlas_postgres_data` preserva os dados entre reinicializações.

## 3. Iniciar as aplicações

Primeiro aplique as migrations:

```powershell
corepack pnpm db:migrate
```

Depois carregue a massa fictícia de demonstração:

```powershell
corepack pnpm db:seed
```

O seed é repetível e limpa somente dados identificados pelo prefixo `atlas-demo:`. Consulte
[`demo-data.md`](demo-data.md) para conhecer os 15 cenários.

```powershell
corepack pnpm dev
```

Valide a API com:

```powershell
Invoke-RestMethod http://localhost:3001/health
```

Com as aplicações em execução, acesse:

- ativos: `http://localhost:3000/assets`;
- Resolution Center: `http://localhost:3000/conflicts`;
- Network Discovery Lite: `http://localhost:3000/network-discovery`.

O Network Discovery Lite é simulado e não envia tráfego real para a rede.

Para uma demonstração rápida, compare `SRV-APP-01`, `VM-WEB-02`, `NB-FIN-014` e os conflitos
de `NB-SUP-021`, `NB-DIR-003` e `VM-LEGACY-01`.

## 4. Verificações antes de contribuir

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Solução rápida de problemas

- Porta 5432 ocupada: altere `POSTGRES_PORT` no `.env`.
- Erro Prisma `P1001`: inicie o Docker Desktop e execute `corepack pnpm infra:up` antes da
  migration.
- Porta 3000 ou 3001 ocupada: encerre o processo existente ou ajuste a configuração local.
- Erro em `cd atlas`: use o caminho completo mostrado na primeira etapa.
- `pnpm.ps1` bloqueado: use `corepack pnpm <comando>`; não é necessário alterar a política de
  execução do PowerShell.
