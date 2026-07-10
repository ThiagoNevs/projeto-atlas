# AGENTS.md — Projeto Atlas

Este arquivo orienta Codex, colaboradores e agentes de desenvolvimento sobre como trabalhar no Projeto Atlas sem desviar do conceito do produto.

## 1. Resumo do produto

Projeto Atlas é uma plataforma de inteligência de ativos baseada em evidências, qualidade, confiabilidade, histórico, conflitos, sinais de atenção e auditoria.

O Atlas não é apenas um inventário. O produto deve explicar:

- De onde vieram as informações.
- O que mudou.
- Qual é a qualidade dos dados.
- Qual é o nível de confiança.
- Onde existem divergências que exigem decisão.
- Quais condições merecem revisão operacional.

## 2. Documentos obrigatórios de leitura antes de implementar

Antes de iniciar qualquer implementação, leia:

- `docs/prd-v2.md`
- `docs/architecture-principles.md`
- `docs/requirements.md`
- `docs/mvp-status.md`
- `docs/roadmap.md`

Em caso de divergência entre uma tarefa e esses documentos, interrompa a implementação e solicite orientação antes de alterar o conceito do produto.

## 3. Princípios obrigatórios

- Evidence-first.
- Histórico preservado.
- Manual não sobrescreve técnico.
- Status operacional é derivado de evidências.
- Status administrativo representa decisão humana.
- Qualidade e confiabilidade são métricas diferentes.
- Conflitos são divergências que exigem decisão.
- Sinais de Atenção são condições que merecem revisão operacional.
- Conectores ajudam, mas não são obrigatórios.
- Empresas pequenas também devem conseguir usar o Atlas.
- Segurança por padrão.
- Interface em português.
- Enums técnicos apenas no backend/API/banco.

## 4. Restrições

- Não alterar Prisma/migrations sem autorização explícita.
- Não refatorar fora do escopo da tarefa.
- Não sobrescrever `docs/requirements.md` e `docs/architecture-principles.md` sem autorização.
- Não remover funcionalidades existentes.
- Não alterar contratos existentes sem necessidade.
- Não executar mudanças destrutivas.
- Não coletar segredos.
- Não colocar `.env`, tokens, senhas ou credenciais no Git.
- Não implementar funcionalidades grandes sem dividir em etapas menores.
- Não criar nova feature se houver erro crítico conhecido no MVP. Primeiro estabilizar.

## 5. Fluxo de trabalho

- Criar branch por funcionalidade.
- Fazer implementação pequena e objetiva.
- Manter o escopo da tarefa.
- Atualizar documentação mínima necessária.
- Rodar validações antes de finalizar.
- Abrir Pull Request com resumo técnico.

Exemplo de branch:

```bash
git checkout main
git pull
git checkout -b feat/nome-da-funcionalidade
```

## 6. Comandos padrão de validação

Antes de finalizar uma entrega, rodar:

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Para rodar o projeto localmente:

```powershell
corepack pnpm infra:up
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev
```

## 7. Como reportar entrega

Ao final de uma tarefa, reportar:

- Arquivos criados.
- Arquivos alterados.
- Endpoints criados ou alterados.
- Regras de negócio implementadas.
- Testes criados ou ajustados.
- Resultado de lint.
- Resultado de typecheck.
- Resultado dos testes.
- Resultado do build.
- Problemas encontrados e resolvidos.

## 8. Direção atual do produto

O MVP atual já possui:

- Dashboard.
- Saúde do Inventário.
- Sinais de Atenção.
- Inventário de ativos.
- Detalhe de ativos.
- Evidências.
- Timeline.
- Conflitos.
- Resolution Center.
- Network Discovery Lite.
- Auditoria.
- Qualidade dos dados.
- Declaração manual de ativo.
- Enriquecimento manual de ativo existente.

Próximas evoluções devem preservar o conceito do Atlas como uma plataforma de inteligência de ativos baseada em evidências.
