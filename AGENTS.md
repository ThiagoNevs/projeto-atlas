# AGENTS.md — Projeto Atlas

Este arquivo orienta Codex, colaboradores e agentes de desenvolvimento sobre como trabalhar no
Projeto Atlas sem desviar do conceito, dos princípios arquiteturais e das regras do produto.

## 1. Resumo do produto

O Projeto Atlas é uma plataforma de inteligência de ativos baseada em evidências, qualidade,
confiabilidade, histórico, conflitos e auditoria.

O Atlas não é apenas um inventário. O produto deve explicar de onde vieram as informações, o que
mudou, qual é a qualidade dos dados, qual é o nível de confiança e onde existem divergências que
exigem análise ou decisão humana.

## 2. Leitura obrigatória antes de implementar

Antes de iniciar qualquer implementação, leia:

1. `docs/prd-v2.md`
2. `docs/architecture-principles.md`
3. `docs/requirements.md`
4. `docs/mvp-status.md`
5. `docs/roadmap.md`

Em caso de divergência entre uma tarefa e esses documentos, interrompa a implementação e solicite
orientação antes de alterar o conceito do produto.

## 3. Princípios obrigatórios

- **Evidence-first:** informações técnicas devem ser rastreáveis até suas evidências.
- **Histórico preservado:** mudanças não devem apagar o estado anterior nem quebrar a timeline.
- **Manual não sobrescreve técnico:** declarações e enriquecimentos manuais devem ter origem clara
  e não podem substituir silenciosamente valores técnicos atuais.
- **Status operacional é derivado de evidências:** uma decisão humana, por si só, não comprova que
  um ativo está operacional.
- **Status administrativo representa decisão humana:** uso, estoque, manutenção, baixa e demais
  estados administrativos refletem decisões organizacionais auditáveis.
- **Qualidade e confiabilidade são métricas diferentes:** qualidade mede completude e consistência;
  confiabilidade mede o grau de confiança na informação e em sua origem.
- **Conectores ajudam, mas não são obrigatórios:** o Atlas deve produzir valor mesmo sem todas as
  integrações disponíveis.
- **Empresas pequenas também devem conseguir usar o Atlas:** recursos essenciais não devem depender
  exclusivamente de infraestrutura corporativa complexa.
- **Segurança por padrão:** reduzir escopo, validar entradas, limitar operações e evitar exposição de
  dados sensíveis.
- **Interface em português:** textos, mensagens, labels e orientações ao usuário devem estar em
  português.
- **Enums técnicos apenas no backend/API/banco:** a interface principal deve exibir labels amigáveis,
  mantendo os códigos técnicos nos contratos internos.

## 4. Restrições

- Não alterar o schema Prisma ou migrations sem autorização explícita.
- Não criar migrations corretivas, editar migrations antigas ou regenerar o banco sem autorização.
- Não refatorar áreas fora do escopo da tarefa.
- Não sobrescrever `docs/requirements.md` ou `docs/architecture-principles.md` sem autorização.
- Não remover, desabilitar ou degradar funcionalidades existentes.
- Não alterar contratos existentes da API sem necessidade e avaliação de compatibilidade.
- Não executar mudanças destrutivas em código, banco, arquivos, histórico Git ou ambiente.
- Não coletar, registrar, exibir ou incluir segredos em logs, documentação ou respostas.
- Não adicionar `.env`, credenciais, tokens, chaves, senhas ou dados sensíveis ao Git.
- Preservar alterações existentes do usuário e confirmar o estado do workspace antes de editar.

## 5. Fluxo de trabalho

1. Leia os documentos obrigatórios e confirme o escopo.
2. Verifique o estado atual do Git e preserve alterações preexistentes.
3. Crie uma branch específica para cada funcionalidade ou correção.
4. Faça uma implementação pequena, objetiva e limitada ao escopo aprovado.
5. Reutilize módulos, presenters, labels e padrões existentes antes de criar novas abstrações.
6. Adicione ou atualize testes proporcionais às regras alteradas.
7. Rode a validação final:

   ```powershell
   corepack pnpm lint
   corepack pnpm typecheck
   corepack pnpm test
   corepack pnpm build
   ```

8. Atualize somente a documentação mínima necessária.
9. Revise o diff para confirmar que não existem mudanças acidentais, segredos ou arquivos fora do
   escopo.
10. Abra um pull request com um resumo técnico claro.

## 6. Como reportar a entrega

O relatório de entrega deve informar, quando aplicável:

1. Arquivos criados.
2. Arquivos alterados.
3. Endpoints criados ou modificados.
4. Regras de negócio implementadas.
5. Testes criados ou atualizados.
6. Resultado de lint, typecheck, testes e build.
7. Problemas encontrados e como foram resolvidos.

Informe também explicitamente quando Prisma, migrations, contratos existentes ou documentos
protegidos não foram alterados.
