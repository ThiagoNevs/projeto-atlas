# Estado atual do MVP

## Visão geral

O MVP técnico do Atlas está funcional de ponta a ponta em ambiente local. Ele demonstra como
evidências técnicas, histórico e decisões administrativas podem produzir uma visão confiável e
auditável dos ativos de infraestrutura.

O produto ainda não é uma plataforma pronta para produção. Autenticação, multi-tenant,
conectores e descoberta real permanecem fora do estado atual.

## Funcionalidades concluídas

- Dashboard inicial com Saúde do Inventário, distribuições, atividade recente, recomendações e Sinais de Atenção para sistemas obsoletos, ativos sem evidência há 45+ dias e outros riscos operacionais.
- Monorepo com Next.js, NestJS, Prisma, PostgreSQL e tipos compartilhados.
- Ingestão manual/simulada idempotente.
- Criação e atualização conservadora de ativos.
- Evidência criada a cada ingestão.
- Atributos históricos e confirmação de valores já conhecidos.
- Interfaces de rede sem duplicação de IP/MAC iguais.
- Timeline com descoberta, sincronização, atualização e reaparecimento.
- Status operacional e administrativo.
- Alteração administrativa transacional com motivo, comentário e `AuditLog`.
- Detecção de ativos encerrados que voltaram a gerar evidência.
- Conflitos de ciclo de vida e identidade de rede.
- Resolution Center com listagem, detalhe e mudança auditável de status.
- Regras que impedem resolução indevida de conflito de ciclo de vida.
- Busca, filtros, ordenação e paginação em ativos e conflitos.
- Interface em português, responsiva e com estados de loading e erro.
- Correções preventivas de hydration para datas relativas.
- Massa demo com 15 ativos e cenários variados.
- Network Discovery Lite seguro e integralmente simulado.
- Persistência e auditoria de execuções concluídas, rejeitadas e com falha.
- Consulta visual dos registros de auditoria com filtros, resumo e detalhe.
- Visão operacional de qualidade, confiança, campos ausentes, rede e recência das evidências.
- Exportação CSV da tela de Qualidade dos Dados com filtros aplicados, labels em português e proteção contra fórmulas em planilhas.
- Importação de ativos por CSV, XLSX, XLSM ou conteúdo colado, com pré-validação por linha, importação parcial controlada e identificação detalhada de duplicidades, inválidos e avisos; macros e fórmulas nunca são executadas.
- Download dos relatórios CSV da análise e do resultado final da importação, gerados em memória e protegidos contra CSV Injection.
- Declaração manual auditável de ativos ainda sem confirmação por fonte técnica.
- Enriquecimento manual auditável de atributos ausentes, com proteção contra sobrescrita.
- Seção de Proveniência dos dados no detalhe do ativo, com modo sombra, origem, candidatos, histórico, timestamps separados, limitações explícitas e recomendação simulada apresentada sem alterar o valor persistido.
- Catálogo de Fontes de Dados para apresentar origens atuais e conectores planejados sem integração real.
- Suíte E2E integrada ao PostgreSQL.

## Funcionalidades parciais

### Network Discovery Lite

Perfis, escopos, execução simulada, histórico, resultados e auditoria existem. Os modos
`PASSIVE`, `LIGHT` e `CONTROLLED` documentam intenção, mas ainda usam o mesmo comportamento
simulado. O agendamento está modelado, porém não há scheduler.

### Resolution Center

Permite analisar e mudar o status de conflitos com justificativa. Ainda não há workflow de
aprovação, atribuição de responsável, SLA, comentários encadeados ou resolução em lote.

### Auditoria

Eventos críticos geram `AuditLog` e podem ser consultados na tela dedicada. Exportação e
política de retenção ainda não fazem parte do MVP. O ator continua simulado porque não há
autenticação. A tela reconhece a criação e as mudanças operacionais dos casos de revisão,
apresenta seus estados em português e oferece acesso ao caso relacionado quando o identificador
persistido é válido.

### Qualidade e confiança

Os scores são armazenados e exibidos separadamente. A tela de Qualidade dos Dados apresenta
fatores positivos e negativos para qualidade e confiabilidade, além de evidências relacionadas
quando disponíveis. Os scores são derivados, não representam decisão administrativa e não podem ser
editados diretamente. Os critérios ainda são simples e não configuráveis por fonte ou política
organizacional.

### Evidence Engine

O núcleo inicial organiza em memória a proveniência dos atributos e expõe uma consulta somente
leitura em modo sombra. Ele separa os contratos de Trust Score da fonte, Confidence Score da decisão
e Data Quality. A política determinística e versionada `2026-07-v1` agora simula qual valor lógico
seria recomendado, explica critérios, inelegibilidades, empates e divergências, sem persistir decisão,
recalcular scores legados ou alterar o valor atual. `selectedCandidate` só é informado quando existe um único candidato atual
com evidência disponível e valor correspondente; ausência de evidência ou múltiplos atuais produzem
`null` e uma limitação explícita. Evidências históricas conflitantes não aumentam a contagem de
suporte. Datas de observação do atributo e da evidência são expostas separadamente, e o score legado
é identificado como `persistedConfidenceScore`. Trust Score permanece `null`. A página de detalhe do
ativo representa a proveniência em português, sem recalcular regras no frontend: valor atual,
proveniência comprovada e recomendação simulada aparecem como conceitos distintos. A interface
apresenta status, empates, inelegibilidades, critérios, explicações e a pontuação apenas como
prioridade da política, nunca como confiança ou probabilidade. Fontes manuais, simuladas, técnicas e
desconhecidas recebem identificação explícita, e falhas da análise permanecem isoladas das demais
informações do ativo. A recomendação continua somente leitura e nenhuma decisão é persistida.

### Análise de conflitos de identidade e rede

O backend expõe `GET /assets/:id/conflict-analysis` com a política determinística
`2026-07-conflict-v1`. Em modo sombra, a consulta identifica possíveis hostnames duplicados, IP
compartilhado por hostnames diferentes e divergência de hostname no mesmo ativo. Os achados são
explicáveis, temporários e somente leitura: nenhum conflito formal, decisão, mesclagem ou alteração
do inventário é persistida. `GET /conflict-analysis/findings` acrescenta uma visão global paginada,
filtrável, ordenável e deduplicada, calculada com uma leitura de banco e a mesma política. A interface,
disponível em `/conflict-findings`, apresenta resumo, filtros, paginação, limitações e detalhe sob
demanda sem persistir decisões. Uma fila operacional e a resolução humana auditada permanecem futuras.
O desenho aprovado para essa evolução está documentado em
`docs/conflict-review-workflow-design.md`. A fundação de persistência foi criada por uma migration
inicial expand-only. Uma segunda migration corretiva, também não destrutiva para os dados, relaxou a
constraint global de versão dos eventos e a substituiu por índice não único, permitindo eventos
append-only futuros na mesma versão sem usar a tabela de eventos como mecanismo de locking.

O fluxo funcional mínimo de criação agora existe atrás de `FINDING_REVIEW_CASES_ENABLED`, desabilitada
por padrão. `POST /conflict-review-cases` aceita somente `findingId` e exige `Idempotency-Key`. O
servidor recalcula o finding pela política `2026-07-conflict-v1`, calcula a `reviewSubjectKey`, constrói
e serializa canonicamente o snapshot original, calcula seu hash, relaciona todos os ativos afetados e
cria o evento `CASE_CREATED` e o `AuditLog` na mesma transação. A chave bruta não é
persistida: `creationRequestFingerprint` identifica operação, ator provisório e chave opaca validada; o
payload semântico é comparado pelo `findingId` persistido. Replay legítimo não cria novas escritas e
reutilização da chave com outro finding retorna conflito. A chave ativa única continua sendo a
proteção final contra dois casos ativos concorrentes para o mesmo assunto.

A `Idempotency-Key` é opaca, case-sensitive, limitada a 128 caracteres ASCII seguros e não recebe
normalização Unicode. O replay é resolvido pelo fingerprint persistido antes do recálculo do finding,
continuando disponível quando o achado deixa de ser detectado. A feature flag controla o módulo
funcional inteiro: quando desabilitada ou inválida, criação, replay, listagem e detalhe retornam HTTP 503. A serialização canônica
não depende de locale, e testes com PostgreSQL real comprovam rollback integral em falhas nas relações,
no evento ou no `AuditLog`.

Vetores sintéticos fixos protegem a serialização, o fingerprint ASCII e o hash do snapshot. O contrato
final `snapshotVersion: 1` usa comparação binária com `<` e `>`, normaliza explicitamente somente os
arrays tratados como conjuntos, preserva listas semanticamente ordenadas e calcula SHA-256 hexadecimal.
A versão provisória com `localeCompare` permaneceu apenas no draft e não integrou a `main`, portanto
não exige uma versão 2. O nome do header é case-insensitive, o valor é case-sensitive e duplicidades
são rejeitadas; refresh e revalidação continuam fora do escopo.

A criação registra a investigação e a auditoria sem alterar `Asset`, `AssetAttribute`,
`NetworkInterface`, `AssetEvidence`, `Conflict`, `ConflictValue` ou `AssetEvent`. O ator
`atlas-mvp-user` é provisório e não fornece autenticação, isolamento entre usuários ou RBAC; por isso a
feature deve permanecer desabilitada fora da validação local controlada.

Agora existem consultas somente leitura em `GET /conflict-review-cases` e
`GET /conflict-review-cases/:id`. A listagem é paginada, filtrável e usa ordenação estável com contagens
relacionais sem N+1; ela não carrega snapshots. O detalhe apresenta exatamente o snapshot e o hash
persistidos, ativos históricos e atuais e eventos com metadata explicitamente filtrada. O filtro por
ativo usa `assetIdAtCreation`, preservando casos mesmo após a remoção do vínculo atual. Nenhuma leitura
recalcula findings, atualiza `updatedAt`, cria evento ou `AuditLog`, ou altera o inventário.

Os filtros temporais exigem timestamps completos com timezone explícito e aplicam limites inclusivos
ao instante UTC. A paginação aceita somente decimais canônicos positivos e protege tanto os valores
quanto o cálculo de offset contra perda de precisão. O filtro de finding usa o formato canônico
`finding_` seguido de 24 caracteres hexadecimais minúsculos.

Esta etapa reutiliza os índices existentes e não altera o schema. Em volumes produtivos maiores, os
filtros por `findingType`, `createdBy` e `assetIdAtCreation` devem ser acompanhados por métricas e planos
de execução; índices adicionais podem ser avaliados futuramente, por migration explicitamente autorizada.
Como a paginação atual é baseada em offset, inserções concorrentes podem deslocar registros entre
chamadas; cursor pagination permanece uma evolução futura e nenhuma fotografia imutável é prometida.

O frontend agora disponibiliza `/conflict-review-cases` com listagem, filtros, paginação e detalhe sob
demanda. O detalhe apresenta snapshot histórico, hash, ativos na criação, vínculos atuais disponíveis e
eventos. Em `/conflict-findings`, o usuário pode iniciar explicitamente a criação de um caso. A interface
trata criação, replay idempotente, caso ativo existente, indisponibilidade da feature e achado que deixou
de existir. Nenhum caso é criado automaticamente e nenhuma dessas ações altera o inventário.

A tela expõe todos os filtros de leitura, inclusive ativo e intervalo de criação, converte datas locais
para timestamps ISO 8601 completos e mantém filtros, paginação, ordenação e `caseId` sincronizados com o
histórico do navegador. Listagem e detalhe cancelam requisições obsoletas e validam as respostas em
runtime. A criação possui timeout de dez segundos, bloqueio síncrono contra clique duplo e preserva no
`sessionStorage` um envelope versionado somente depois que timeout ou falha de rede tornam o resultado
incerto. O envelope conserva `createdAt` e `expiresAt` originais durante todos os retries e expira em 15
minutos sem renovação silenciosa. Cada retry revalida inclusive a tentativa mantida na mesma aba: antes
do limite reutiliza a chave e, quando `now >= expiresAt`, bloqueia o POST. Se o registro estiver expirado,
adulterado ou associado a outro finding, ele é removido e nenhum POST ocorre nesse gesto; uma nova chave
exige outro clique explícito. Se o `sessionStorage` não puder ser lido ou escrito, o envelope completo em
memória preserva chave e TTL durante a montagem atual, mas não pode ser recuperado após remontagem.
Respostas conclusivas removem somente o registro correspondente mesmo quando o componente já foi
desmontado ou a interface mudou de finding. O detalhe direciona o foco ao heading após sucesso ou erro e
cancela frames pendentes em fechamento, troca de caso e unmount.

O detalhe agora permite as seis transições operacionais distintas entre `OPEN`, `IN_REVIEW` e
`WAITING_FOR_EVIDENCE`. O backend usa `expectedVersion`, update condicional e incremento atômico;
concorrência obsoleta retorna HTTP 409. Caso, evento append-only `CASE_STATUS_CHANGED` e `AuditLog`
participam da mesma transação PostgreSQL, sem alterar o inventário. A interface oferece somente destinos
válidos, bloqueia envio duplo, valida a resposta em runtime e exige recarregamento em conflito ou
resultado de rede incerto. O endpoint não usa `Idempotency-Key`.
O `expectedVersion` é limitado a `2147483646`: a coluna é PostgreSQL `INT4` e o próximo valor precisa
continuar persistível após o incremento. Valores fora desse intervalo retornam HTTP 400 antes da
transação e não alteram caso, evento ou auditoria.

Ainda não existem atribuição, comentários, decisões, refresh, estados terminais operacionais,
reabertura, integração com `Conflict` ou Resolution Center. O ator `atlas-mvp-user` é provisório e não
representa autenticação ou RBAC. O finding derivado não passa a ser persistido como fonte de verdade.

### Tipos compartilhados

Existe `packages/shared`, mas alguns enums e contratos ainda são reproduzidos manualmente no
frontend.

## Fora do escopo atual

- Autenticação corporativa e autorização por papéis.
- Multi-tenant produtivo e isolamento por organização.
- Conectores reais para Microsoft Intune, Defender, Entra ID ou CMDBs.
- Collector instalado na infraestrutura do cliente.
- Ping, DNS, ARP, Nmap, SNMP, SSH, WMI ou WinRM reais.
- Descoberta automática de redes locais ou OT/IoT.
- Coleta e gestão de credenciais.
- Scheduler de descoberta.
- Notificações, alertas externos e integrações com ITSM/SIEM.
- Aplicativo móvel.
- Operação em alta disponibilidade.

## Limitações conhecidas

- Ambiente orientado a desenvolvimento local.
- Ausência de autenticação e usuários reais.
- `actorUserId` simulado em decisões auditáveis.
- Listagens de Network Discovery sem paginação.
- Sem observabilidade estruturada, métricas ou tracing distribuído.
- Sem testes E2E reais do frontend em navegador no pipeline.
- Sem CI/CD configurado.
- Sem gestão produtiva de secrets.
- Ausência de camada de domínio mais forte entre controllers, services e persistência.
- Sem política formal de backup, retenção e recuperação.
- Fontes de Dados ainda é um catálogo estático; conectores reais, credenciais e sincronização continuam fora do escopo.

## O que já pode ser demonstrado

1. Inventário com 15 ativos de infraestrutura.
2. Pesquisa por hostname, série, fabricante, modelo, sistema operacional, IP ou MAC.
3. Filtros e ordenação por estado, tipo, confiança, qualidade e datas.
4. Detalhe de ativo com atributos, interfaces, evidências e timeline.
5. Ativo atualizado sem duplicação indevida de atributos ou interfaces.
6. Alteração administrativa com motivo, comentário, timeline e auditoria.
7. Ativo encerrado que reaparece e abre conflito de ciclo de vida.
8. Resolution Center com conflitos abertos, em análise e em exceção.
9. Bloqueio de resolução incoerente enquanto o ativo continua encerrado.
10. Perfil de descoberta simulado limitado a CIDRs privados.
11. Execução simulada com resultados, ativos, evidências e histórico.
12. Rejeição e auditoria de configurações inseguras ou perfis desabilitados.
13. Fontes de Dados mostrando cadastro manual, enriquecimento manual, descoberta simulada e conectores futuros.
14. Inventário de achados de identidade e rede em modo sombra, com filtros, contexto, limitações e detalhe somente leitura.
