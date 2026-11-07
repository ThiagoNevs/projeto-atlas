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
- tela de auditoria (entregue e em estabilização);
- narrativa visual de Fontes de Dados e conectores planejados;
- exportação CSV do inventário e conflitos;
- importação controlada de ativos por CSV, XLSX, XLSM e conteúdo colado;
- melhorias de usabilidade no Resolution Center;
- documentação visual e mensagens explícitas sobre funcionalidades simuladas;
- testes automatizados dos principais fluxos de frontend.

**Prioridade:** imediata.

**Dependências:** estabilização da Fase 1, definição da persona da demo e critérios comerciais.

## Fase 3 — Discovery-first operacional

**Objetivo:** provar o inventário operacional combinando descoberta autorizada, evidências e contexto
mantido por pessoas.

**Entregas:**

- arquitetura segura de Network Discovery e Edge Collector;
- escopos de rede explicitamente autorizados e bounded;
- observações processadas pela ingestão evidence-first compartilhada;
- fluxo de unknown/unclassified assets;
- correlação conservadora, sem merge destrutivo;
- enriquecimento manual de responsabilidade e application context;
- visibilidade de ativos novos, alterados, retornados e não observados recentemente;
- auditoria das configurações e execuções relevantes.

**Prioridade:** próximo ciclo arquitetural e de produto.

**Dependências:** contratos de discovery, trust/comunicação do Edge Collector, identidade e
correlação, controles de escopo e ambiente local controlado.

## Fase 4 — Connectors empresariais

**Objetivo:** ampliar evidências com fontes corporativas após o Discovery-first MVP.

**Entregas:**

- Active Directory Domain Services conforme ADR-020;
- Microsoft Entra ID, Intune e Defender em contratos separados;
- sincronização incremental e checkpoints quando aplicáveis;
- políticas de confiança por fonte;
- mapeamento versionado para atributos normalizados;
- credenciais de menor privilégio e gates produtivos específicos.

**Prioridade:** posterior ao Discovery-first MVP.

**Dependências:** contratos específicos por provider, ambiente controlado, credenciais de teste,
SecretReference e revisão de segurança.

## Fase 5 — Produto comercial

**Objetivo:** operar o Atlas com segurança, isolamento e suporte para múltiplos clientes.

**Entregas:**

- autenticação corporativa OIDC para atores humanos e autorização granular (entregues; Service Actors permanecem futuros);
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

## Roadmap técnico de arquitetura

O encadeamento técnico aprovado para as próximas fundações é:

```text
Architecture Decision Records
↓
Operational Context Foundation
↓
Secrets / Credential References       ✅ foundation interna ENV
↓
Trusted Service Actors
↓
Connector Execution Foundation
↓
Connector Framework
↓
Network Discovery Architecture
↓
Edge Collector Trust & Communication
↓
Asset Identity / Correlation
↓
Discovery Safety & Scope Controls
↓
Network Discovery v1
↓
Controlled Local Deployment
↓
Enterprise connectors (AD DS deferred, then provider-specific roadmap)
```

Essa sequência não implementa Network Discovery, Edge Collector ou connector por si só; cada
etapa depende de requisitos, threat model e autorização próprios. A ADR-020 permanece `Accepted`,
mas AD DS não bloqueia o Discovery-first MVP.

A foundation de secrets separa referência e material secreto, usa provisionamento out-of-band e não
inclui persistência, API, UI, rotação gerenciada, provider `FILE` ou cofre externo. Secret scanning no
CI permanece gate obrigatório antes da primeira credencial operacional.
