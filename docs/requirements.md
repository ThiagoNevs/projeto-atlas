# Requisitos do Projeto Atlas

## 1. Visão geral

O Projeto Atlas é uma plataforma de inteligência de ativos baseada em evidências, criada para ajudar empresas a identificar, acompanhar e governar seus ativos de infraestrutura de forma confiável, auditável e acionável.

O Atlas não tem como objetivo ser apenas uma lista de inventário. A proposta é responder, com base em evidências técnicas e decisões administrativas registradas:

- Quais ativos existem?
- Quando foram vistos pela última vez?
- Qual fonte confirmou a existência do ativo?
- Quais informações são confiáveis?
- Quais ativos foram desativados, descartados, perdidos ou arquivados?
- Quais ativos encerrados voltaram a aparecer?
- Quais conflitos precisam ser tratados?
- Quem tomou uma decisão administrativa, quando e por quê?

O produto é voltado principalmente para times de infraestrutura, segurança da informação, suporte, sustentação, governança de TI e gestão de ativos.

---

## 2. Objetivo do MVP

O objetivo do MVP é validar o conceito central do Atlas:

> Transformar dados técnicos dispersos sobre ativos em uma visão consolidada, baseada em evidências, com histórico, auditoria e tratamento de inconsistências.

Nesta fase, o Atlas deve demonstrar:

- Inventário de ativos.
- Registro de evidências.
- Timeline de mudanças.
- Status operacional.
- Status administrativo auditável.
- Detecção de ativo encerrado que voltou a aparecer.
- Resolution Center para tratamento de conflitos.
- Busca, filtros, ordenação e paginação.
- Massa demo realista.
- Network Discovery Lite simulado e seguro.

---

## 3. Escopo atual do MVP

### Dentro do escopo

O MVP atual contempla:

- Ativos de infraestrutura.
- Evidências técnicas.
- Timeline de eventos.
- Status operacional.
- Status administrativo.
- Alteração manual auditável de status administrativo.
- Conflitos de ciclo de vida.
- Resolution Center.
- Busca, filtros, ordenação e paginação.
- Massa de dados demo.
- Network Discovery Lite simulado.
- Auditoria de ações relevantes.
- Interface em português.

### Fora do escopo atual

Ainda não fazem parte do MVP atual:

- Autenticação real.
- Autorização por perfil.
- Multi-tenant real.
- Conectores reais com Microsoft Intune, Defender ou Entra ID.
- Collector real instalado em ambiente de cliente.
- Discovery real de rede.
- Execução de ping real, DNS real, ARP real, SNMP real ou Nmap.
- Integração com CMDB externa.
- Integração com ITSM.
- Gestão segura de secrets.
- CI/CD completo.
- Observabilidade estruturada.
- Produção com dados reais.

---

## 4. Requisitos funcionais

### RF01 — Listar ativos

O sistema deve permitir listar ativos conhecidos pelo Atlas.

A listagem deve exibir, no mínimo:

- Hostname atual.
- Tipo do ativo.
- Status operacional.
- Status administrativo.
- Última evidência.
- Score de confiança.
- Score de qualidade dos dados.
- Quantidade de evidências.
- Quantidade de eventos.

---

### RF02 — Consultar detalhe de um ativo

O sistema deve permitir consultar o detalhe de um ativo.

A tela de detalhe deve exibir:

- Identificação do ativo.
- ID Atlas.
- Hostname atual.
- Tipo.
- Status operacional.
- Status administrativo.
- Scores.
- Atributos normalizados.
- Interfaces de rede.
- Evidências.
- Timeline.
- Conflitos relacionados, quando existirem.

---

### RF03 — Registrar evidências técnicas

O sistema deve registrar evidências associadas a ativos.

Cada evidência deve conter:

- Fonte.
- Tipo da evidência.
- Data de observação.
- Data de ingestão.
- Payload bruto ou resumido.
- Score de confiança, quando aplicável.
- Relação com o ativo.

---

### RF04 — Manter timeline do ativo

O sistema deve manter uma timeline de eventos relevantes do ativo.

Eventos esperados:

- Ativo descoberto.
- Ativo sincronizado.
- Ativo atualizado.
- Status administrativo alterado.
- Ativo encerrado reapareceu.
- Status do conflito alterado.
- Eventos de descoberta de rede.

---

### RF05 — Controlar status operacional

O sistema deve calcular ou atualizar o status operacional do ativo com base em evidências técnicas.

Exemplos de status operacional:

- Visto recentemente.
- Sem evidência recente.
- Provavelmente inativo.
- Fonte parou de reportar.
- Voltou a aparecer.

O status operacional representa a situação técnica observada do ativo.

---

### RF06 — Controlar status administrativo

O sistema deve permitir registrar o status administrativo do ativo.

Exemplos de status administrativo:

- Em uso.
- Em estoque.
- Em manutenção.
- Desativado.
- Descartado.
- Perdido.
- Roubado/Furtado.
- Arquivado.

O status administrativo representa a decisão ou classificação da empresa sobre o ativo.

---

### RF07 — Alterar status administrativo de forma auditável

O sistema deve permitir alterar manualmente o status administrativo de um ativo.

A alteração deve exigir:

- Novo status.
- Motivo.
- Comentário.

Ao alterar, o sistema deve:

- Atualizar o ativo.
- Criar evento na timeline.
- Criar registro de auditoria.
- Registrar status anterior.
- Registrar novo status.
- Registrar data/hora.
- Registrar ator responsável, ainda que simulado no MVP.

---

### RF08 — Detectar ativo encerrado que voltou a aparecer

O sistema deve detectar quando um ativo com status administrativo encerrado volta a gerar evidência técnica.

Status considerados encerrados:

- Desativado.
- Descartado.
- Perdido.
- Roubado/Furtado.
- Arquivado.

Quando isso ocorrer, o sistema deve:

- Manter o status administrativo atual.
- Atualizar o status operacional.
- Registrar nova evidência.
- Criar evento de reaparecimento.
- Criar ou atualizar conflito de ciclo de vida.
- Exibir alerta no detalhe do ativo.

---

### RF09 — Criar conflitos de ciclo de vida

O sistema deve criar conflito quando houver divergência entre uma decisão administrativa e uma evidência técnica.

Exemplo:

> Ativo administrativamente descartado voltou a gerar evidência técnica.

O conflito deve conter:

- Tipo.
- Campo relacionado.
- Status.
- Impacto.
- Ativo relacionado.
- Quantidade de ocorrências.
- Sugestão.
- Datas de criação e atualização.

---

### RF10 — Tratar conflitos no Resolution Center

O sistema deve permitir visualizar e tratar conflitos.

O Resolution Center deve permitir:

- Listar conflitos.
- Filtrar conflitos.
- Buscar conflitos.
- Consultar conflito relacionado a um ativo.
- Alterar status do conflito.
- Registrar motivo.
- Registrar comentário.
- Criar evento na timeline.
- Criar registro de auditoria.

Status de conflito esperados:

- Aberto.
- Em análise.
- Resolvido.
- Ignorado.
- Exceção.

---

### RF11 — Bloquear resolução indevida de conflito de ciclo de vida

O sistema não deve permitir marcar um conflito de ciclo de vida como resolvido se o ativo continuar administrativamente encerrado.

Nesse caso, o sistema deve orientar o usuário a:

- Reativar o ativo; ou
- Marcar o conflito como exceção; ou
- Marcar como ignorado; ou
- Colocar em análise.

---

### RF12 — Buscar, filtrar, ordenar e paginar ativos

O sistema deve permitir:

- Buscar ativos por texto.
- Filtrar por status operacional.
- Filtrar por status administrativo.
- Filtrar por tipo.
- Filtrar por score mínimo de confiança.
- Filtrar por score mínimo de qualidade.
- Ordenar por campos relevantes.
- Paginar resultados.

---

### RF13 — Buscar, filtrar, ordenar e paginar conflitos

O sistema deve permitir:

- Buscar conflitos por texto.
- Filtrar por status.
- Filtrar por impacto.
- Filtrar por tipo.
- Ordenar por campos relevantes.
- Paginar resultados.

---

### RF14 — Executar Network Discovery Lite simulado

O sistema deve permitir configurar e executar uma descoberta de rede simulada e controlada.

O MVP deve deixar claro que:

- Nenhum scan real é executado.
- Nenhum ping real é executado.
- Nenhum ARP real é executado.
- Nenhum DNS real é executado.
- Nenhuma tentativa de login é executada.
- Nenhum comando remoto é executado.

A descoberta simulada deve gerar evidências, resultados, timeline e auditoria.

---

### RF15 — Configurar perfis de descoberta de rede

O sistema deve permitir criar perfis de descoberta contendo:

- Nome.
- Descrição.
- Modo.
- CIDRs permitidos.
- CIDRs negados.
- Métodos simulados.
- Limite por minuto.
- Agendamento modelado.
- Status habilitado/desabilitado.

---

### RF16 — Bloquear escopos inseguros de descoberta

O sistema deve bloquear:

- `0.0.0.0/0`.
- CIDRs públicos.
- Escopos fora das redes privadas permitidas no MVP.

No MVP, devem ser aceitos apenas CIDRs privados RFC1918:

- `10.0.0.0/8`.
- `172.16.0.0/12`.
- `192.168.0.0/16`.

---

### RF17 — Registrar auditoria

O sistema deve registrar auditoria para ações relevantes, incluindo:

- Alteração de status administrativo.
- Alteração de status de conflito.
- Execução de descoberta de rede.
- Rejeição de execução de descoberta.
- Falha em execução de descoberta.

---

### RF18 — Disponibilizar massa demo

O sistema deve possuir uma massa de dados simulada para demonstração.

A massa demo deve conter:

- Ativos em uso.
- Ativos em manutenção.
- Ativos em estoque.
- Ativos encerrados.
- Ativos que reapareceram.
- Conflitos abertos.
- Conflitos em análise.
- Conflitos em exceção.
- Ativos com baixa qualidade de dados.
- Mudanças de hostname.
- Mudanças de IP.
- Dispositivo de rede.
- Impressora.

---

## 5. Requisitos não funcionais

### RNF01 — Segurança por padrão

O sistema deve ser construído com segurança como princípio base.

Isso inclui:

- Validação no backend.
- Validação no frontend.
- Auditoria de ações importantes.
- Não exposição de dados sensíveis.
- Não execução de ações perigosas por padrão.
- Network Discovery simulado e controlado no MVP.

---

### RNF02 — Security by Design

O Atlas deve seguir o princípio de security by design.

As decisões técnicas devem considerar segurança desde a concepção, incluindo:

- Menor privilégio.
- Read-only first.
- Auditoria.
- Isolamento futuro por cliente.
- Proteção de secrets.
- Validação de entradas.
- Tratamento seguro de erros.
- Prevenção de ações destrutivas ou agressivas.

---

### RNF03 — Read-only first

O Atlas deve priorizar observação, evidência e auditoria antes de qualquer ação ativa no ambiente do cliente.

No MVP, o produto não deve:

- Desativar ativos automaticamente.
- Alterar sistemas externos.
- Executar comandos remotos.
- Coletar secrets.
- Fazer scan real de rede.

---

### RNF04 — Idempotência

Ingestões repetidas do mesmo estado não devem duplicar indevidamente:

- Ativos.
- Atributos.
- Interfaces.
- Conflitos.

O sistema pode registrar nova evidência, mas só deve criar eventos de mudança quando houver alteração real.

---

### RNF05 — Histórico preservado

O sistema deve preservar histórico de mudanças relevantes.

Exemplos:

- Hostname anterior.
- IP anterior.
- Status anterior.
- Mudanças administrativas.
- Conflitos.
- Evidências.
- Timeline.

---

### RNF06 — Auditoria obrigatória

Ações administrativas relevantes devem gerar auditoria.

Cada auditoria deve conter:

- Ator.
- Ação.
- Entidade afetada.
- Valor anterior.
- Valor novo.
- Motivo.
- Comentário.
- Data/hora.

No MVP, o ator pode ser simulado. Em produção, deve ser associado a um usuário autenticado.

---

### RNF07 — Validação no backend

O backend deve validar todos os dados recebidos.

Deve rejeitar:

- Campos obrigatórios ausentes.
- Valores fora do enum.
- Campos extras não permitidos.
- Scores fora de 0 a 100.
- CIDRs inválidos.
- CIDRs públicos no MVP.
- Motivos e comentários vazios.
- Alterações sem mudança real.

---

### RNF08 — Validação no frontend

O frontend deve validar formulários antes do envio sempre que possível.

Deve exibir mensagens claras para:

- Campos obrigatórios.
- Valores inválidos.
- Erros da API.
- Erros de conexão.
- Estados vazios.
- Estados de carregamento.
- Ações concluídas com sucesso.

---

### RNF09 — Tratamento seguro de erros

O sistema deve evitar expor detalhes internos ao usuário final.

O backend não deve expor:

- Stack trace.
- Detalhes internos do Prisma.
- Secrets.
- Dados sensíveis.
- Mensagens técnicas excessivas.

O ideal é retornar erros padronizados, com mensagem segura e compreensível.

---

### RNF10 — Separação de ambientes

O projeto deve considerar três ambientes principais:

- Desenvolvimento.
- Homologação/QA.
- Produção.

Cada ambiente deve possuir configurações, dados e controles adequados ao seu objetivo.

---

### RNF11 — Modularidade

O sistema deve ser organizado por módulos de domínio.

Exemplos:

- Assets.
- Evidences.
- Timeline.
- Conflicts.
- Audit.
- Network Discovery.
- Connectors.
- Auth, futuramente.

Essa separação deve facilitar manutenção, evolução e testes.

---

### RNF12 — Baixo acoplamento

Os módulos devem evitar dependência excessiva entre si.

Quando um módulo precisar interagir com outro, deve fazê-lo por serviços bem definidos, evitando acesso direto e espalhado à lógica interna.

---

### RNF13 — Escalabilidade futura

O MVP não precisa nascer com arquitetura distribuída, mas deve permitir evolução futura para:

- Filas.
- Workers.
- Jobs agendados.
- Collector real.
- Multi-tenant.
- Observabilidade.
- Autenticação corporativa.
- Integrações reais.

---

### RNF14 — Observabilidade futura

O sistema deve ser preparado para futura observabilidade com:

- Logs estruturados.
- Métricas.
- Tracing.
- Request ID.
- Monitoramento de erros.
- Monitoramento de jobs.
- Monitoramento de integrações.

---

### RNF15 — Proteção de secrets

O sistema não deve armazenar secrets, tokens ou credenciais em texto puro.

Futuramente, integrações devem usar:

- Secret manager.
- Vault.
- Criptografia.
- Rotação de credenciais.
- Controle de acesso.

---

### RNF16 — Interface em português

A interface do Atlas deve ser apresentada em português para facilitar o uso por times de infraestrutura, segurança, suporte e sustentação.

Enums técnicos podem continuar existindo na API e no banco, mas não devem aparecer como informação principal na interface.

---

### RNF17 — Performance mínima para MVP

O MVP deve responder adequadamente para a massa demo e para volumes pequenos ou médios de dados.

Listagens principais devem possuir:

- Paginação.
- Filtros.
- Ordenação.
- Busca.

---

### RNF18 — Testabilidade

O sistema deve manter cobertura de testes para fluxos críticos, incluindo:

- Ingestão.
- Idempotência.
- Alteração de status administrativo.
- Conflitos.
- Resolution Center.
- Network Discovery Lite.
- Validações de segurança.

---

## 6. Ambientes

### 6.1 Desenvolvimento

Ambiente usado para desenvolvimento local e testes iniciais.

Características:

- Executado localmente.
- Usa PostgreSQL local via Docker.
- Usa seed demo.
- Pode conter dados fictícios.
- Pode ser reiniciado ou limpo sem impacto.
- Usado para criação de funcionalidades e validação rápida.

Uso esperado:

- Desenvolvimento de código.
- Testes locais.
- Execução de migrations.
- Execução de seed.
- Validação inicial de telas.

---

### 6.2 Homologação/QA

Ambiente controlado para testes, validação funcional e aprovação antes de produção.

Esse ambiente reúne os papéis de QA e homologação nesta fase do produto.

Características:

- Deve ser mais estável que desenvolvimento.
- Deve usar dados fictícios ou mascarados.
- Deve simular fluxos reais.
- Deve ser usado para validar correções.
- Deve ser usado para preparar demonstrações.
- Deve ser usado para testes de regressão.

Uso esperado:

- Validação funcional.
- Validação de fluxos de negócio.
- Validação visual.
- Testes de regressão.
- Simulação de demonstração.
- Aprovação antes de produção.

---

### 6.3 Produção

Ambiente real de uso do produto.

Características esperadas:

- Dados reais.
- Controle de acesso.
- Monitoramento.
- Backup.
- Auditoria.
- Segurança reforçada.
- Gestão de secrets.
- Observabilidade.
- Políticas de disponibilidade.

Uso esperado:

- Operação real do Atlas.
- Uso por clientes ou times internos.
- Integrações reais.
- Collector real, futuramente.
- Discovery real, futuramente e com controles adicionais.

---

## 7. Critérios de aceite do MVP

O MVP pode ser considerado funcional quando atender aos seguintes critérios:

### Inventário

- Deve listar ativos.
- Deve consultar detalhes de ativos.
- Deve exibir status operacional e administrativo.
- Deve exibir evidências.
- Deve exibir timeline.

### Governança

- Deve permitir alteração auditável de status administrativo.
- Deve registrar motivo e comentário.
- Deve criar timeline e audit log.

### Conflitos

- Deve detectar ativo encerrado que reaparece.
- Deve criar conflito de ciclo de vida.
- Deve exibir alerta no ativo.
- Deve permitir tratamento no Resolution Center.
- Deve impedir resolução indevida de conflito enquanto o ativo continua encerrado.

### Busca e navegação

- Deve permitir busca, filtros, ordenação e paginação em ativos.
- Deve permitir busca, filtros, ordenação e paginação em conflitos.

### Network Discovery Lite

- Deve permitir criar perfil de descoberta.
- Deve validar CIDRs privados.
- Deve bloquear CIDRs públicos.
- Deve executar descoberta simulada.
- Deve registrar run, resultado, evidência, timeline e auditoria.
- Deve deixar claro que não executa scan real.

### Demonstração

- Deve possuir massa demo.
- Deve possuir documentação mínima.
- Deve possuir roteiro de demo.
- Deve funcionar localmente com comandos documentados.

---

## 8. Limitações atuais

O MVP possui limitações conhecidas:

- Possui autenticação OIDC, mas não sessão persistente, refresh token ou silent renew.
- Possui autorização granular por permissions derivadas de roles OIDC Viewer/Analyst/Admin; o gate
  `atlas:access` permanece obrigatório e independente.
- Não possui multi-tenant real.
- Não possui conectores reais.
- Não possui Collector real.
- Network Discovery é simulado.
- Não executa scan real.
- Não possui gestão segura de secrets.
- Não possui observabilidade estruturada.
- Não possui CI/CD completo.
- Não possui tela dedicada de auditoria.
- Não possui exportação CSV.
- Não possui dashboard executivo.
- O ator de auditoria ainda é simulado.
- Algumas tipagens do frontend podem duplicar enums da API manualmente.

---

## 9. Premissas

O MVP parte das seguintes premissas:

- O foco inicial são ativos de infraestrutura.
- Usuários, contas, tokens e identidades podem aparecer como contexto futuro, mas não são o ativo primário nesta fase.
- O Atlas deve priorizar evidência e histórico.
- O sistema não deve reativar ativos automaticamente.
- O sistema não deve resolver conflitos automaticamente sem decisão humana.
- O discovery real só deve ser implementado com controles de segurança adicionais.
- O MVP deve ser demonstrável com dados fictícios.
- O produto deve evoluir de forma modular.

---

## 10. Fora de escopo para produção inicial

Antes de uma produção real, ainda será necessário implementar ou amadurecer:

- Autenticação.
- Autorização.
- Gestão de usuários.
- Multi-tenant.
- Hardening de segurança.
- Gestão de secrets.
- Backup e restore.
- Observabilidade.
- CI/CD.
- Deploy automatizado.
- Testes frontend e2e.
- Conectores reais.
- Collector real.
- Políticas de retenção de dados.
- Política de auditoria.
- Controles de privacidade e LGPD.
