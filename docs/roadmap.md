# Roadmap do Projeto Atlas

O roadmap organiza a evolução do protótipo técnico até um produto comercial. Datas e esforço
devem ser definidos após validação com usuários e priorização de mercado.

## Fase 1 — MVP técnico atual

**Objetivo:** comprovar o modelo de inteligência de ativos baseada em evidências.

**Entregas:**

- inventário, detalhe, evidências e timeline;
- ingestão simulada idempotente;
- estados operacional e administrativo;
- confiança e qualidade de dados;
- conflitos de ciclo de vida;
- Resolution Center básico;
- busca, filtros, ordenação e paginação;
- massa demo;
- Network Discovery Lite simulado;
- catálogo de Fontes de Dados e conectores planejados;
- auditoria das principais decisões;
- documentação técnica e testes E2E.

**Prioridade:** concluída e em estabilização.

**Dependências:** Node.js, Docker, PostgreSQL local e dados fictícios.

## Fase 2 — Demo vendável

**Objetivo:** transformar o MVP técnico em uma narrativa clara para clientes e patrocinadores.

**Entregas:**

- identidade visual e tela inicial orientada a valor;
- dashboard com indicadores executivos;
- roteiro e ambiente de demonstração reproduzível;
- tela de auditoria;
- narrativa visual de Fontes de Dados e conectores planejados;
- exportação CSV do inventário e conflitos;
- importação controlada de ativos por CSV, XLSX, XLSM e conteúdo colado;
- melhorias de usabilidade no Resolution Center;
- documentação visual e mensagens explícitas sobre funcionalidades simuladas;
- testes automatizados dos principais fluxos de frontend.

**Prioridade:** imediata.

**Dependências:** estabilização da Fase 1, definição da persona da demo e critérios comerciais.

## Fase 3 — Integrações reais

**Objetivo:** provar valor com fontes corporativas reais sem depender ainda de descoberta ativa.

**Entregas:**

- framework de conectores e credenciais;
- primeiro conector Microsoft, priorizando Intune ou Defender;
- sincronização incremental e checkpoints;
- políticas de confiança por fonte;
- tratamento de indisponibilidade, retry e dead-letter;
- observabilidade e auditoria de ingestões;
- mapeamento configurável para atributos normalizados.

**Prioridade:** alta após validação comercial.

**Dependências:** autenticação, gestão segura de secrets, modelo de tenants e ambiente de testes
Microsoft.

## Fase 4 — Collector real

**Objetivo:** coletar evidências autorizadas dentro da infraestrutura do cliente com segurança.

**Entregas:**

- arquitetura e empacotamento do Collector;
- registro e identidade segura do Collector;
- política explícita de escopo e redes negadas;
- descoberta passiva e leve com limites operacionais;
- comunicação autenticada e criptografada;
- atualização segura, health check e telemetria;
- proteção específica para redes sensíveis e OT/IoT;
- pilotos controlados antes de qualquer método ativo.

**Prioridade:** alta, mas posterior aos conectores.

**Dependências:** threat model, gestão de certificados/secrets, observabilidade, autorização por
tenant e revisão de segurança.

## Fase 5 — Produto comercial

**Objetivo:** operar o Atlas com segurança, isolamento e suporte para múltiplos clientes.

**Entregas:**

- autenticação corporativa e RBAC;
- multi-tenant com isolamento verificável;
- onboarding, planos e limites de uso;
- alta disponibilidade, backup e disaster recovery;
- CI/CD, ambientes e infraestrutura como código;
- monitoramento, alertas e SLOs;
- retenção, privacidade e governança de dados;
- integrações ITSM/SIEM e APIs versionadas;
- suporte operacional, documentação e processo de incidentes;
- requisitos legais, comerciais e de segurança.

**Prioridade:** estratégica.

**Dependências:** validação de mercado, arquitetura de tenants, operação cloud, segurança,
compliance e modelo comercial.
