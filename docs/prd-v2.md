# PRD v2 — Projeto Atlas

## 1. Visão geral

O Projeto Atlas é uma plataforma de inteligência de ativos baseada em evidências, qualidade,
confiabilidade, histórico, conflitos, sinais de atenção e auditoria.

O Atlas não pretende ser apenas uma lista de inventário. A proposta é consolidar observações
técnicas e decisões administrativas em uma visão explicável, rastreável e acionável para times de
infraestrutura, segurança, suporte, sustentação, governança de TI e gestão de ativos.

O produto deve responder perguntas como:

- Quais ativos existem?
- De onde veio cada informação?
- Quando o ativo foi visto pela última vez?
- Quais dados são completos, atuais e confiáveis?
- O que mudou ao longo do tempo?
- Quais ativos encerrados voltaram a aparecer?
- Quais conflitos precisam de decisão humana?
- Quem tomou uma decisão administrativa, quando e por quê?

## 2. Problema

Empresas costumam manter informações de ativos espalhadas entre ferramentas técnicas, planilhas,
cadastros administrativos, fontes de segurança, soluções de endpoint, CMDBs e conhecimento informal
dos times.

Essa fragmentação gera problemas recorrentes:

- inventários incompletos ou desatualizados;
- ativos vistos tecnicamente, mas encerrados administrativamente;
- ativos cadastrados manualmente sem confirmação técnica;
- dados conflitantes entre ferramentas;
- baixa confiança sobre fabricante, modelo, sistema operacional, IP, MAC e número de série;
- dificuldade para explicar a origem de uma informação;
- falta de histórico para entender mudanças;
- decisões administrativas sem auditoria suficiente;
- dificuldade para priorizar correções de qualidade de dados.

O Atlas parte da premissa de que ausência de evidência não é prova de inexistência, e que cadastro
administrativo, sozinho, não comprova estado operacional.

## 3. Proposta de valor

O Atlas transforma dados técnicos e administrativos dispersos em inteligência operacional sobre
ativos.

A proposta de valor central é:

- consolidar ativos a partir de múltiplas fontes;
- preservar evidências e histórico;
- separar estado técnico de decisão administrativa;
- medir qualidade e confiança dos dados;
- identificar conflitos e condições que exigem revisão;
- apoiar decisão humana com contexto auditável;
- permitir uso gradual, começando por cadastro manual e descoberta controlada;
- preparar evolução para conectores reais e collector seguro, sem depender deles no MVP.

## 4. Público-alvo

O público principal do Atlas inclui:

- infraestrutura;
- segurança da informação;
- suporte;
- sustentação;
- governança de TI;
- gestão de ativos;
- operações e times responsáveis por inventário técnico.

O produto deve funcionar tanto para empresas pequenas, que podem começar com cadastro manual e
descoberta controlada, quanto para organizações mais maduras, que futuramente poderão conectar
fontes corporativas já existentes.

## 5. Princípios do produto

- **Evidence-first:** informações relevantes devem apontar para evidências, origem e data de
  observação.
- **Histórico preservado:** mudanças importantes não devem apagar o estado anterior.
- **Manual não sobrescreve técnico:** informação manual complementa ou declara contexto, mas não
  deve substituir silenciosamente uma evidência técnica atual.
- **Status operacional é derivado de evidências:** representa observação técnica.
- **Status administrativo representa decisão humana:** reflete uso, estoque, manutenção,
  desativação, descarte, perda ou arquivamento.
- **Qualidade e confiabilidade são métricas diferentes:** qualidade mede completude e consistência;
  confiabilidade mede credibilidade da informação e da fonte.
- **Conflitos exigem decisão:** o Atlas detecta divergências, mas não deve resolvê-las
  automaticamente sem decisão humana.
- **Sinais de Atenção orientam revisão operacional:** nem todo sinal é conflito, mas todo sinal deve
  ajudar o time a priorizar investigação.
- **Segurança por padrão:** nenhuma coleta agressiva, segredo, token ou ação destrutiva deve ser
  introduzida sem desenho explícito.
- **Interface em português:** a experiência principal deve ser clara para times brasileiros de TI.
- **Enums técnicos ficam no backend/API/banco:** a interface deve priorizar linguagem amigável.

## 6. Fontes de dados e conectores

No Atlas, uma fonte de dados é qualquer origem controlada que gera evidências sobre ativos.
Conector é uma forma de integrar uma dessas fontes ao Atlas. API é apenas um dos meios possíveis.

Fontes atuais ou planejadas:

- cadastro manual;
- enriquecimento manual;
- Network Discovery Lite;
- importação CSV futura;
- Microsoft Intune futuro;
- Microsoft Defender futuro;
- Active Directory / Entra ID futuro;
- ferramentas de vulnerabilidade futuras;
- cloud providers futuros;
- CMDB / ITSM futuras;
- conectores customizados futuros.

O MVP deve deixar claro que:

- o Atlas não depende exclusivamente de conectores;
- conectores ajudam, mas não são obrigatórios para gerar valor inicial;
- empresas pequenas podem começar com entrada manual e descoberta simulada/controlada;
- empresas maduras podem evoluir conectando ferramentas existentes;
- conectores reais exigirão autenticação, autorização, gestão segura de secrets, observabilidade,
  controle de escopo e auditoria.

Nesta etapa, fontes planejadas não devem ser apresentadas como integrações reais.

## 7. Funcionalidades atuais do MVP

O MVP atual já demonstra:

- dashboard com Saúde do Inventário, atividade recente, ações recomendadas e Sinais de Atenção;
- inventário de ativos;
- detalhe de ativo;
- evidências;
- timeline;
- status operacional;
- status administrativo;
- alteração manual auditável de status administrativo;
- ingestão manual/simulada idempotente;
- detecção de ativo encerrado que voltou a aparecer;
- conflitos de ciclo de vida e identidade de rede;
- Resolution Center;
- busca, filtros, ordenação e paginação;
- auditoria;
- tela de qualidade dos dados;
- declaração manual de ativo;
- enriquecimento manual de ativo existente;
- Network Discovery Lite simulado e seguro;
- catálogo de Fontes de Dados e conectores planejados;
- massa demo realista;
- interface em português;
- testes E2E integrados ao PostgreSQL local.

## 8. Roadmap

### Fase 1 — MVP técnico atual

Objetivo: comprovar o modelo de inteligência de ativos baseada em evidências.

Entregas:

- inventário, detalhe, evidências e timeline;
- ingestão simulada idempotente;
- status operacional e administrativo;
- qualidade e confiança de dados;
- conflitos e Resolution Center;
- auditoria;
- Network Discovery Lite simulado;
- Fontes de Dados;
- massa demo;
- documentação e testes.

### Fase 2 — Demo vendável

Objetivo: transformar o MVP técnico em narrativa clara para clientes e patrocinadores.

Entregas esperadas:

- refinamento visual;
- dashboard mais executivo;
- roteiro de demonstração;
- exportação CSV;
- melhorias no Resolution Center;
- documentação visual;
- testes automatizados de frontend.

### Fase 3 — Integrações reais

Objetivo: provar valor com fontes corporativas reais sem depender ainda de descoberta ativa.

Entregas esperadas:

- framework de conectores;
- primeiro conector Microsoft, priorizando Intune ou Defender;
- sincronização incremental;
- checkpoints;
- políticas de confiança por fonte;
- auditoria e observabilidade de ingestões;
- gestão segura de secrets.

### Fase 4 — Collector real

Objetivo: coletar evidências autorizadas dentro da infraestrutura do cliente com segurança.

Entregas esperadas:

- arquitetura do Collector;
- identidade segura do Collector;
- controle explícito de escopo;
- descoberta passiva e leve;
- comunicação autenticada e criptografada;
- telemetria, health check e atualização segura.

### Fase 5 — Produto comercial

Objetivo: operar o Atlas com segurança, isolamento e suporte para múltiplos clientes.

Entregas esperadas:

- autenticação corporativa;
- autorização por papéis;
- multi-tenant;
- CI/CD;
- observabilidade;
- backup e disaster recovery;
- privacidade, retenção e governança de dados;
- integrações ITSM/SIEM;
- operação comercial.

## 9. Fora de escopo atual

Ainda não fazem parte do MVP atual:

- autenticação real;
- autorização por perfil;
- multi-tenant produtivo;
- conectores reais com Microsoft Intune, Defender, Entra ID, cloud, CMDB ou ITSM;
- armazenamento de tokens, senhas ou secrets;
- gestão produtiva de credenciais;
- Collector real;
- discovery real de rede;
- ping, DNS, ARP, Nmap, SNMP, SSH, WMI ou WinRM reais;
- execução remota;
- resolução automática de conflitos;
- reativação automática de ativos;
- scheduler real de descoberta;
- observabilidade estruturada;
- CI/CD completo;
- operação produtiva com dados reais.

O MVP deve continuar sendo demonstrado como uma base segura e explicável para inteligência de ativos,
não como solução produtiva completa de discovery, conectores ou governança corporativa.
