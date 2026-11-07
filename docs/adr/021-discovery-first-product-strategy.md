# ADR-021: Estratégia de produto Discovery-first

- Status: Accepted
- Data: 2026-11-06
- Decisores: Produto, Arquitetura e Engenharia do Atlas
- Relacionados: ADR-009, ADR-014, ADR-017, ADR-018 e ADR-020

## Contexto

O Atlas possui inventário, entrada e enriquecimento manuais, evidências, histórico, conflitos,
Finding Review, auditoria e uma fundação operacional de connectors. O Connector Framework oferece
definitions em código, instances e runs persistidos, observations em runtime, execução durável,
cancelamento, retry, DLQ, reconciliação e ingestão evidence-first compartilhada. O registry de
produção continua vazio: ainda não existe connector real nem credencial operacional.

A ADR-020 aceitou o contrato técnico para um futuro connector Active Directory Domain Services.
Esse contrato permanece válido, mas sua implementação exige ambiente AD DS controlado, LDAPS,
credencial e uma sequência operacional mais onerosa do que o necessário para provar o valor inicial
do produto.

O Atlas precisa primeiro demonstrar, de forma segura e utilizável, que consegue descobrir o que
existe em uma rede autorizada, preservar as observações, formar um inventário explicável e permitir
que pessoas adicionem contexto que a automação não conhece. Esta ADR altera a prioridade do roadmap;
ela não remove nem reverte a fundação existente.

## Decisão

### 1. Definição do produto

O Atlas é uma plataforma de inventário de ativos de infraestrutura que combina descoberta de rede
com contexto operacional e de negócio mantido por pessoas.

> Atlas is an infrastructure asset inventory platform that combines network discovery with
> human-maintained business and operational context.

A tese central é:

```text
Automação coleta evidências.
Pessoas registram decisões.
O Atlas preserva os dois.
```

O produto deve responder prioritariamente:

- o que existe;
- o que apareceu;
- o que deixou de ser observado;
- o que mudou;
- o que ainda não foi identificado;
- quem ou qual time é responsável;
- qual aplicação ou contexto de negócio o ativo suporta.

### 2. Progressão do produto

A progressão permanece:

```text
existence
→ identity
→ responsibility
→ application context
→ security posture
→ impact
```

Discovery-first começa por `existence` e `identity`. Enriquecimento manual adiciona
`responsibility` e `application context`. `security posture` e `impact` permanecem evoluções
posteriores.

### 3. Entradas primárias

O Atlas v1 possui duas fontes conceituais primárias:

1. **Network Discovery**, que produz observações técnicas;
2. **Manual Input**, que registra contexto administrativo e de negócio.

Cadastro e enriquecimento manuais são capacidades de primeira classe, não fallback. Poderão
registrar nome, asset tag, serial, fabricante, modelo, responsável, aplicação, ambiente,
criticidade, localização e notas usando os modelos e contratos que forem aprovados. Esta ADR não
altera schema nem define campos novos.

Uma fonte não apaga silenciosamente a outra. Por exemplo, uma observação pode registrar
`hostname = srv-fin-01`, enquanto uma pessoa registra `displayName = Finance ERP Server`. Ambos os
fatos coexistem. Divergências materiais preservam evidência, tornam o conflito visível e não
provocam overwrite silencioso.

### 4. Categorias semânticas

O produto distingue:

- **Observed facts:** IP, hostname, serviço TCP e outros sinais efetivamente observados;
- **Human-maintained context:** owner, application, criticality e demais decisões humanas;
- **Derived state:** unknown, stale, conflicting e outros estados calculados.

Essas categorias não devem ser misturadas semanticamente.

### 5. Pipeline de descoberta

Network Discovery reutilizará a fundação existente:

```text
ConnectorRun
→ ConnectorObservation
→ evidence-first ingestion
→ Asset / AssetEvidence
```

Não será criada uma segunda pipeline paralela de inventário. O Connector Framework, pg-boss,
retry, cancelamento, observabilidade de fila, reconciliador e `SecretReference` permanecem
infraestrutura estratégica. Esta decisão não registra uma `ConnectorDefinition` produtiva.

O primeiro connector planejado passa a ser Network Discovery, com nomenclatura e contrato final a
serem definidos em ADR técnica posterior.

### 6. Unknown / Unclassified Assets

Um dispositivo descoberto sem contexto suficiente permanece visível como unknown/unclassified.
Ele não é descartado porque a identidade ou o contexto de negócio ainda são incompletos. O fluxo
esperado é:

```text
discovery encontra dispositivo
→ Atlas preserva a observação
→ contexto permanece incompleto
→ operador classifica ou enriquece o ativo
```

Dashboard, Assets, Discovery, Unknown Assets, Conflicts e Audit são áreas futuras da experiência
do produto. Esta ADR não define rotas, APIs ou componentes de interface.

### 7. Identidade e correlação

Identidade de ativo é um problema técnico separado. IP e hostname são mutáveis; MAC pode estar
ausente ou ser ambíguo fora do escopo L2. Portanto, esta ADR não estabelece `IP = asset`,
`hostname = asset` nem `MAC = asset`.

Identidade, correlação, deduplicação, merge/split e confiança terão gate próprio. Até existir
contrato determinístico, observações ambíguas não podem provocar merge destrutivo. O Atlas deve
preservar evidência, sinalizar ambiguidade e exigir regra determinística ou decisão humana.

### 8. Ausência e lifecycle

Deixar de observar um ativo em uma execução não significa excluí-lo. O histórico permanece.
Conceitos futuros incluem:

```text
new
known
changed
not recently seen
returned
unknown/unclassified
```

O produto poderá destacar novo dispositivo, mudança de IP ou hostname, aparecimento ou
desaparecimento de serviço, retorno e ausência recente. Esta ADR não cria enums, migrations nem
detecção funcional.

### 9. Discovery inicial e limites

A primeira versão deve funcionar sem credenciais administrativas e enfatizar:

- presença e reachability;
- endereço IP;
- sinais de hostname/DNS;
- MAC somente onde legitimamente observável;
- reachability limitada de serviços TCP.

Discovery deve ser bounded, autorizado, observável, rate-limited, cancelável e auditável. Somente
escopos explicitamente autorizados podem ser consultados, por exemplo, CIDRs allowlisted, targets
explícitos e scan profiles limitados.

São proibidos por padrão Internet-wide scanning, faixas públicas arbitrárias, travessia implícita
de redes adjacentes e ranges ilimitados. Raw SYN scanning, fingerprint avançado de sistema
operacional, packet capture, enumeração credenciada e vulnerability scanning não são definidos por
esta decisão.

A primeira fase não introduz credenciais de domínio, SSH, WinRM, SNMP ou WMI.

### 10. Edge Collector

Network Discovery deverá normalmente executar em um pequeno Edge Collector dentro da rede
autorizada. O collector inicia comunicação outbound, criptografada e autenticada para o Atlas; não
exige inbound da Internet e não envia material secreto em observations.

Windows, Linux ou container permanecem opções de deployment. A tecnologia final ainda não foi
escolhida.

O collector é um componente distribuído e não é implicitamente confiável. Um ADR posterior deve
definir identidade, autenticação, autorização, registro, revogação, compatibilidade de versão,
heartbeat, atualização segura e protocolo de comunicação.

### 11. Autorização e auditoria

Autenticação, `atlas:access`, default-deny, RBAC e atores tipados permanecem. Discovery futuro
exigirá permissions explícitas para visualizar discovery, configurar escopo e solicitar execução.
O contrato exato pertence ao ADR técnico; nenhuma permission é adicionada agora.

Configuração de escopo, solicitação de discovery, mudança manual de ativo e alteração de
classificação deverão ser auditáveis. Nenhuma action de `AuditLog` é criada nesta ADR.

### 12. AD DS e demais connectors

A ADR-020 permanece `Accepted` como contrato técnico. Sua implementação fica `DEFERRED`, para
depois do Discovery-first MVP. O laboratório Windows AD DS no Azure também fica adiado e deixa de ser
requisito para o MVP.

Active Directory Domain Services, Microsoft Entra ID, Intune, Defender, SNMP, SSH, WinRM/WMI,
cloud providers, CMDB e integrações externas permanecem evoluções futuras. A mudança de prioridade
não remove nenhuma fundação necessária a esses connectors.

### 13. Dedicated-first e primeiro deployment

Dedicated-first permanece vigente e `tenant_id` continua intencionalmente ausente. O primeiro
deployment controlado deve provar:

- escopo de rede autorizado;
- execução de discovery;
- ingestão de observations;
- criação/correlação conservadora de ativos;
- enriquecimento manual;
- fluxo de unknown assets;
- visibilidade de mudanças;
- auditoria.

Esse deployment não depende de AD DS. Discovery-first remove a necessidade imediata de um ambiente
Windows AD DS pago, sem estabelecer estimativas financeiras voláteis neste ADR.

## Não objetivos

O Discovery-first MVP não é vulnerability scanner, EDR, NDR, SIEM, NAC, patch manager, plataforma
de administração remota, penetration testing ou Internet scanner. Ele não explora
vulnerabilidades nem executa comandos remotos em ativos.

Esta ADR também não implementa:

- Network Discovery real ou Edge Collector;
- API, UI, permissions, AuditLog actions ou scheduler;
- identity/correlation engine ou merge automático;
- lifecycle enums ou migrations;
- credenciais ou novos providers de `SecretReference`;
- multi-tenancy;
- connector AD DS ou qualquer connector empresarial.

## Consequências

O Atlas consegue concentrar o próximo ciclo em valor observável sem depender de credenciais
administrativas ou de um laboratório AD DS. A estratégia aumenta a importância de controles de
escopo, identidade conservadora, operação distribuída do collector e diferenciação rigorosa entre
observação, contexto humano e estado derivado.

A aceitação desta estratégia não declara Network Discovery, Edge Collector, Unknown Assets ou
mudanças de lifecycle implementados. O estado atual do produto permanece inalterado.

## Próximos gates

1. Network Discovery Architecture;
2. Edge Collector Trust & Communication;
3. Asset Identity / Correlation;
4. Discovery Safety & Scope Controls;
5. Network Discovery v1 Implementation;
6. Controlled Local Deployment.

A ordem pode ser refinada entre gates, mas AD DS não volta a bloquear o Discovery-first MVP.
