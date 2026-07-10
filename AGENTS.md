# AGENTS.md — Projeto Atlas

Este arquivo orienta Codex, colaboradores e agentes de desenvolvimento sobre como trabalhar no Projeto Atlas sem desviar do conceito do produto.

## 1. Resumo do produto

Projeto Atlas é uma plataforma de inteligência de ativos baseada em evidências, qualidade, confiabilidade, histórico, conflitos, sinais de atenção e auditoria.

O Atlas não é apenas um inventário. O produto deve explicar de onde vieram as informações, o que mudou, qual é a qualidade dos dados, qual é o nível de confiança, onde existem divergências que exigem decisão e quais condições merecem revisão operacional.

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
- Não colocar `.env` ou credenciais no Git.

## 5. Fluxo de trabalho

- Criar branch por funcionalidade.
- Fazer implementação pequena e objetiva.
- Rodar lint, typecheck, testes e build.
- Atualizar documentação mínima necessária.
- Abrir PR com resumo técnico.

## 6. Como reportar entrega

- Arquivos criados.
- Arquivos alterados.
- Endpoints criados.
- Regras de negócio implementadas.
- Testes criados.
- Resultado de lint/typecheck/testes/build.
- Problemas encontrados e resolvidos.
