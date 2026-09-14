# Exemplos da API

Com a infraestrutura e as aplicações em execução, a API fica disponível em
`http://localhost:3001`.

## Health check

```powershell
curl.exe http://localhost:3001/health
```

## Ingerir um ativo manualmente

```powershell
curl.exe -X POST http://localhost:3001/ingestion/assets `
  -H "Content-Type: application/json" `
  -d '{
    "source": "manual-lab",
    "sourceAssetId": "srv-atlas-001",
    "hostname": "atlas-db-01",
    "type": "SERVER",
    "category": "DATABASE",
    "serialNumber": "LAB-SN-001",
    "manufacturer": "Dell",
    "model": "PowerEdge R650",
    "operatingSystem": "Ubuntu Server",
    "osVersion": "24.04",
    "lastSeenAt": "2026-07-03T12:00:00.000Z",
    "ipAddresses": ["10.20.0.15"],
    "macAddresses": ["02:42:ac:11:00:15"],
    "confidenceScore": 92,
    "dataQualityScore": 95
  }'
```

A resposta contém `action` (`created`, `synced` ou `updated`), `eventType`, `changedFields`,
`evidenceId`, `eventId` e o ativo. `asset.atlasId` é o identificador amigável exibido na
interface; guarde o UUID interno em `asset.id` para montar as URLs dos exemplos seguintes.

## Eventos de ingestão

- `ASSET_DISCOVERED`: primeira observação da combinação `source + sourceAssetId`; cria o ativo.
- `ASSET_SYNCED`: nova confirmação sem mudança relevante. Uma evidência e um evento são
  criados, mas atributos e interfaces idênticos não são duplicados.
- `ASSET_UPDATED`: ao menos um campo relevante mudou, incluindo atributos ou estado de rede.
  A resposta informa os campos em `changedFields`.
- `ASSET_REAPPEARED`: um ativo com status administrativo encerrado (`DEACTIVATED`,
  `DISCARDED`, `LOST`, `STOLEN` ou `ARCHIVED`) voltou a produzir evidência técnica. O status
  administrativo é preservado, e a resposta inclui `lifecycleConflict` com o conflito aberto.

Para atributos sem mudança, o Atlas atualiza `lastConfirmedAt`, incrementa
`confirmationCount` e preserva o registro original. Para um MAC conhecido com novo IP, a
interface é atualizada sem duplicação. O mesmo IP observado em outro MAC abre um possível
conflito para resolução futura.

Repetições de evidência de um ativo encerrado atualizam o conflito `LIFECYCLE_CONFLICT` já
aberto e incrementam `occurrenceCount`; elas não criam conflitos abertos duplicados. A
reativação permanece uma decisão manual e auditável.

## Listar ativos

```powershell
curl.exe http://localhost:3001/assets
```

A listagem retorna `items`, `total`, `page`, `pageSize` e `totalPages`. Sem parâmetros, a
primeira página contém até 10 ativos, ordenados pela última evidência em ordem decrescente.

### Buscar ativos

```powershell
curl.exe "http://localhost:3001/assets?search=SRV-APP-01"
curl.exe "http://localhost:3001/assets?search=LAB-SN-001"
```

A busca considera hostname, chave canônica, tipo, série, fabricante, modelo, sistema
operacional, versão, IP e MAC.

### Filtrar ativos

```powershell
curl.exe "http://localhost:3001/assets?administrativeStatus=IN_USE&operationalStatus=SEEN_RECENTLY&type=SERVER"
curl.exe "http://localhost:3001/assets?minConfidenceScore=80&minDataQualityScore=70"
```

### Paginar ativos

```powershell
curl.exe "http://localhost:3001/assets?page=2&pageSize=5"
```

### Ordenar ativos

```powershell
curl.exe "http://localhost:3001/assets?sortBy=lastSeenAt&sortDirection=desc"
curl.exe "http://localhost:3001/assets?sortBy=evidenceCount&sortDirection=desc"
```

## Consultar o detalhe

```powershell
curl.exe http://localhost:3001/assets/ASSET_ID
```

## Consultar evidências

```powershell
curl.exe http://localhost:3001/assets/ASSET_ID/evidences
```

## Consultar timeline

```powershell
curl.exe http://localhost:3001/assets/ASSET_ID/timeline
```

## Alterar o status administrativo

Use o UUID interno do ativo em `ASSET_ID`. A alteração cria, na mesma transação, um evento
`ADMIN_STATUS_CHANGED` na timeline e um registro em `audit_logs` com os valores anterior e
novo, motivo, comentário e o `CurrentActor` derivado da identidade OIDC humana validada. Fixtures de
seed podem usar uma identidade técnica de demonstração, sem representar o comportamento produtivo.

```powershell
curl.exe -X PATCH http://localhost:3001/assets/ASSET_ID/administrative-status `
  -H "Content-Type: application/json" `
  -d '{
    "administrativeStatus": "DEACTIVATED",
    "reason": "Baixa patrimonial",
    "comment": "Equipamento recolhido pelo suporte e removido do uso corporativo."
  }'
```

Valores disponíveis para alteração manual: `IN_USE`, `IN_STOCK`, `MAINTENANCE`,
`DEACTIVATED`, `DISCARDED`, `LOST`, `STOLEN` e `ARCHIVED`. Enviar o status atual novamente
retorna HTTP `400` e não cria evento nem registro de auditoria.

## Resolution Center

### Listar conflitos

```powershell
curl.exe http://localhost:3001/conflicts
```

A resposta usa o mesmo envelope paginado das listagens de ativos.

### Buscar conflitos

```powershell
curl.exe "http://localhost:3001/conflicts?search=SRV-APP-01"
curl.exe "http://localhost:3001/conflicts?search=LIFECYCLE_CONFLICT"
```

A busca considera tipo, campo, sugestão/motivo, hostname e chave canônica do ativo.

### Filtrar conflitos

```powershell
curl.exe "http://localhost:3001/conflicts?status=OPEN&impact=HIGH&type=LIFECYCLE_CONFLICT"
```

### Paginar conflitos

```powershell
curl.exe "http://localhost:3001/conflicts?page=2&pageSize=5"
```

### Ordenar conflitos

```powershell
curl.exe "http://localhost:3001/conflicts?sortBy=updatedAt&sortDirection=desc"
curl.exe "http://localhost:3001/conflicts?sortBy=occurrenceCount&sortDirection=desc"
```

### Consultar um conflito

```powershell
curl.exe http://localhost:3001/conflicts/CONFLICT_ID
```

Substitua `CONFLICT_ID` pelo UUID retornado na listagem ou na resposta de uma ingestão que
tenha identificado `lifecycleConflict`.

### Alterar o status de um conflito

```powershell
curl.exe -X PATCH http://localhost:3001/conflicts/CONFLICT_ID/status `
  -H "Content-Type: application/json" `
  -d '{
    "status": "RESOLVED",
    "reason": "Ativo reativado manualmente.",
    "comment": "Validado com o time de suporte."
  }'
```

Os valores aceitos são `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED` e `EXCEPTION`. A mudança
cria um evento `CONFLICT_STATUS_CHANGED` na timeline do ativo e um `AuditLog` na mesma
transação. Repetir o status atual retorna HTTP `400` sem criar histórico adicional.

Para um `LIFECYCLE_CONFLICT`, o status `RESOLVED` só é aceito depois que o ativo deixa um
estado administrativo encerrado. Enquanto estiver `DEACTIVATED`, `DISCARDED`, `LOST`,
`STOLEN` ou `ARCHIVED`, use `IN_REVIEW`, `EXCEPTION` ou `IGNORED` com motivo e comentário.

Substitua `ASSET_ID` pelo UUID retornado pela ingestão. Toda repetição do POST cria uma nova
evidência. O conteúdo determina se o evento será `ASSET_SYNCED` ou `ASSET_UPDATED`.

## Executar os testes de idempotência

```powershell
corepack pnpm test
```

A suíte usa identificadores isolados, valida os cenários no PostgreSQL local e remove os dados
temporários ao final.

## Network Discovery Lite

Todos os métodos desta versão são simulados. Os endpoints abaixo não executam ping, ARP,
consulta DNS ou varredura real.

### Criar perfil de descoberta

```powershell
curl.exe -X POST http://localhost:3001/network-discovery/profiles `
  -H "Content-Type: application/json" `
  -d '{
    "name": "Rede administrativa de demonstração",
    "description": "Escopo privado e controlado para o laboratório local.",
    "enabled": true,
    "mode": "LIGHT",
    "allowedCidrs": ["10.20.0.0/24"],
    "deniedCidrs": ["10.20.0.128/25"],
    "rateLimitPerMinute": 10,
    "scheduleEnabled": false,
    "methods": ["ICMP_SIMULATED", "DNS_REVERSE_SIMULATED", "ARP_SIMULATED"]
  }'
```

O CIDR `0.0.0.0/0` e qualquer rede pública são recusados. No MVP, `allowedCidrs` aceita apenas
redes privadas RFC1918, e o limite máximo é 60 observações por minuto. O agendamento está
modelado, mas não executa automaticamente; quando habilitado, exige `scheduleExpression`.

### Listar perfis

```powershell
curl.exe http://localhost:3001/network-discovery/profiles
```

### Executar descoberta simulada

```powershell
curl.exe -X POST http://localhost:3001/network-discovery/profiles/PROFILE_ID/run
```

Substitua `PROFILE_ID` pelo UUID retornado na criação ou listagem. Perfis desabilitados não
podem ser executados.

### Listar execuções

```powershell
curl.exe http://localhost:3001/network-discovery/runs
```

### Consultar execução e resultados

```powershell
curl.exe http://localhost:3001/network-discovery/runs/RUN_ID
```

O detalhe inclui o perfil, o resumo da execução, resultados, IP, MAC, hostname, método,
confiança e o ativo relacionado.

## Auditoria

### Listar registros

```powershell
curl.exe "http://localhost:3001/audit-logs?page=1&pageSize=20&sortBy=occurredAt&sortDirection=desc"
```

### Buscar e filtrar

```powershell
curl.exe "http://localhost:3001/audit-logs?search=suporte&action=ADMIN_STATUS_CHANGED&actorType=USER&entityType=Asset&dateFrom=2026-07-01T00:00:00.000-03:00&dateTo=2026-07-31T23:59:59.999-03:00"
```

Também é possível filtrar por `entityId`. O valor deve ser um UUID válido.

### Consultar detalhe

```powershell
curl.exe http://localhost:3001/audit-logs/AUDIT_LOG_ID
```

Substitua `AUDIT_LOG_ID` pelo UUID retornado na listagem. O detalhe inclui valores anterior e
novo, metadados, ator, entidade, ação e data/hora.

## Qualidade dos dados

### Consultar resumo

```powershell
curl.exe http://localhost:3001/data-quality/summary
```

### Listar ativos com problemas de qualidade

```powershell
curl.exe "http://localhost:3001/data-quality/assets?page=1&pageSize=20&sortBy=dataQualityScore&sortDirection=asc"
```

A resposta separa `dataQualityScore` e `confidenceScore` e inclui `scoreAnalysis` com fatores
positivos, fatores negativos e evidências relacionadas quando disponíveis. Os scores são derivados
de evidências e completude dos dados; eles não representam decisão administrativa e não possuem
endpoint de edição direta.

Exemplo resumido:

```json
{
  "items": [
    {
      "id": "ASSET_ID",
      "dataQualityScore": 40,
      "confidenceScore": 45,
      "scoreAnalysis": {
        "quality": {
          "metric": "Qualidade dos dados",
          "score": 40,
          "note": "Score derivado de completude, rede e recência das evidências. Não representa decisão administrativa e não pode ser editado diretamente.",
          "positiveFactors": [],
          "negativeFactors": [
            {
              "code": "MISSING_SERIAL_NUMBER",
              "label": "Número de série ausente",
              "evidenceIds": []
            }
          ],
          "relatedEvidence": []
        },
        "confidence": {
          "metric": "Confiabilidade",
          "score": 45,
          "positiveFactors": [
            {
              "code": "TECHNICAL_EVIDENCE_PRESENT",
              "label": "Evidência técnica disponível",
              "evidenceIds": ["EVIDENCE_ID"]
            }
          ],
          "negativeFactors": [
            {
              "code": "LOW_CONFIDENCE_SCORE",
              "label": "Confiabilidade abaixo de 70",
              "evidenceIds": ["EVIDENCE_ID"]
            }
          ],
          "relatedEvidence": [
            {
              "id": "EVIDENCE_ID",
              "source": "manual-simulation",
              "evidenceType": "ASSET_INGESTION"
            }
          ]
        }
      }
    }
  ]
}
```

### Filtrar por problema e scores

```powershell
curl.exe "http://localhost:3001/data-quality/assets?issue=MISSING_OPERATING_SYSTEM&maxDataQualityScore=70&type=SERVER"
```

Os problemas aceitos incluem baixa qualidade ou confiança, ausência de série, fabricante,
modelo, sistema operacional, rede, status administrativo e evidência recente.

### Exportar CSV da qualidade dos dados

```powershell
curl.exe -OJ "http://localhost:3001/data-quality/assets/export?issue=LOW_CONFIDENCE&sortBy=dataQualityScore&sortDirection=asc"
```

O CSV usa delimitador `;`, cabeçalhos em português, labels amigáveis e aplica os mesmos filtros
principais da listagem. A exportação não usa paginação, possui limite de 5000 registros e protege
células contra execução acidental de fórmulas em planilhas.

## Importação de ativos

O endpoint CSV permanece compatível e também aceita conteúdo colado separado por TAB:

```powershell
curl.exe -X POST http://localhost:3001/assets/import/csv `
  -H "Content-Type: application/json" `
  -d '{
    "csv": "hostname;ipAddress;operatingSystem;osVersion;location;owner;department;type;administrativeStatus;comment\nNB-RH-001;10.20.1.15;Windows 11;23H2;Rio de Janeiro;Ana Silva;RH;Notebook;Em uso;Notebook da Ana / máquina do RH\nSRV-APP-01;10.30.1.20;Windows Server;2019;Datacenter;Infraestrutura;TI;Servidor;Em uso;Servidor de aplicação principal"
  }'
```

Nesta primeira versão, `hostname` e `ipAddress` são obrigatórios. O `hostname` é usado como
identificador principal da importação. O `ipAddress` é registrado como informação de rede do ativo,
mas não é identidade absoluta porque IP pode mudar ou ser reutilizado. Erros e duplicidades
localizados são informados por linha e não bloqueiam as demais: hostname duplicado é ignorado, linha
inválida não é criada e IP repetido gera warning sem impedir a importação.

Campos opcionais aceitos: `operatingSystem`, `osVersion`, `location`, `owner`, `department`,
`type`, `administrativeStatus`, `manufacturer`, `model`, `serialNumber`, `macAddress`,
`environment`, `criticality` e `comment`.

Todos os endpoints de domínio deste documento exigem `Authorization: Bearer <access-token>`, o gate
geral `atlas:access` e a permission granular declarada pelo handler. Somente `GET /health` é público.
A identidade, a autoria e as permissions são derivadas pelo backend do token validado; campos
`createdBy`, `actorId`, roles ou permissions enviados pelo cliente não escolhem o autor nem concedem
acesso. `GET /auth/me` exige `atlas:access` e retorna apenas `id`, `kind`, `displayName` opcional e
`permissions`; roles externas não fazem parte do contrato público.

### Importar XLSX ou XLSM

```powershell
curl.exe -X POST http://localhost:3001/assets/import/spreadsheet `
  -F "file=@C:\caminho\ativos.xlsx"
```

São aceitos `.xlsx` e `.xlsm`, com limite de 2 MB, 500 linhas úteis e 30 colunas. Somente a
primeira aba é lida. O arquivo é processado em memória e não é armazenado. Arquivos XLSM são
aceitos apenas para leitura tabular: macros nunca são executadas, fórmulas nunca são avaliadas e
somente o resultado já armazenado na célula é utilizado. Arquivos vazios, corrompidos, com MIME
incompatível ou que excedam os limites seguros de descompactação são rejeitados.

### Analisar antes de importar

Para CSV ou conteúdo colado, use o preview JSON:

```powershell
curl.exe -X POST http://localhost:3001/assets/import/preview `
  -H "Content-Type: application/json" `
  -d '{"csv":"hostname;ipAddress\nNB-RH-001;10.20.1.15"}'
```

Para XLSX ou XLSM, use o preview multipart:

```powershell
curl.exe -X POST http://localhost:3001/assets/import/preview/spreadsheet `
  -F "file=@C:\caminho\ativos.xlsx"
```

A resposta classifica cada linha como pronta, importável com aviso, duplicada ou inválida, incluindo
número da linha, hostname, IP, motivo e ativo existente quando aplicável.

### Confirmar importação parcial

O commit sempre repete a validação no backend e cria cada linha válida em transação própria:

```powershell
curl.exe -X POST http://localhost:3001/assets/import/commit `
  -H "Content-Type: application/json" `
  -d '{"csv":"hostname;ipAddress\nNB-RH-001;10.20.1.15"}'

curl.exe -X POST http://localhost:3001/assets/import/commit/spreadsheet `
  -F "file=@C:\caminho\ativos.xlsx"
```

A resposta de commit inclui a extensão aditiva `createdRows`, que correlaciona somente as linhas
realmente criadas com o número original da planilha e o ID do novo ativo:

```json
{
  "createdRows": [
    {
      "rowNumber": 2,
      "hostname": "NB-RH-001",
      "ipAddress": "10.20.1.15",
      "assetId": "00000000-0000-4000-8000-000000000000"
    }
  ]
}
```

Linhas duplicadas, inválidas ou com falha não aparecem em `createdRows`. Durante uma implantação
desacoplada, consumidores devem tolerar temporariamente a ausência desse campo. Nesse caso, o CSV
final continua sendo gerado e apenas o ID do ativo criado fica vazio, pois o frontend não tenta
correlacionar IDs por hostname nem pela ordem de criação.

Arquivo vazio, corrompido, sem headers obrigatórios, em formato incompatível ou acima dos limites
continua sendo rejeitado integralmente. Os endpoints anteriores `/assets/import/csv` e
`/assets/import/spreadsheet` permanecem compatíveis e usam a mesma lógica de commit parcial.

### Relatórios da importação

A página `/assets/import` permite baixar dois relatórios sem criar arquivos no servidor:

- **Relatório da análise:** inclui todas as linhas do preview, suas classificações, avisos, erros e
  referências ao ativo existente.
- **Relatório final:** correlaciona as linhas pelo número original e informa criações, duplicidades,
  invalidações, warnings e falhas, incluindo IDs quando disponíveis.

Os CSVs são gerados em memória no navegador, em UTF-8 com BOM, separador `;` e quebra de linha
CRLF. Valores potencialmente interpretáveis como fórmulas são neutralizados antes do download.

## Declaração manual de ativo

```powershell
curl.exe -X POST http://localhost:3001/assets/manual `
  -H "Content-Type: application/json" `
  -d '{
    "identifier": "NB-EST-001",
    "identifierType": "HOSTNAME",
    "type": "NOTEBOOK",
    "administrativeStatus": "IN_STOCK",
    "reason": "Compra nova ainda não entregue ao usuário",
    "hostname": "NB-EST-001",
    "serialNumber": "DEMO-BR123456",
    "manufacturer": "Fabricante de demonstração",
    "model": "Notebook corporativo",
    "operatingSystem": "Windows 11",
    "osVersion": "23H2",
    "location": "Rio de Janeiro",
    "owner": "TI",
    "department": "Infraestrutura",
    "environment": "Estoque",
    "criticality": "Baixa",
    "comment": "Cadastro fictício para demonstração"
  }'
```

A declaração cria o ativo com estado operacional desconhecido, confiança inicial moderada,
evidência `MANUAL_DECLARATION`, evento de timeline e `AuditLog`. Ela não representa confirmação
por fonte técnica. Identificador, tipo de identificador, tipo do ativo, status administrativo e
motivo são obrigatórios; duplicidades fortes retornam HTTP `409`.

## Enriquecimento manual de ativo

```powershell
curl.exe -X POST http://localhost:3001/assets/ASSET_ID/manual-enrichment `
  -H "Content-Type: application/json" `
  -d '{
    "reason": "Validado com o time de infraestrutura",
    "comment": "Informação confirmada em inventário interno",
    "attributes": {
      "operatingSystem": "Windows Server",
      "osVersion": "2012 R2",
      "manufacturer": "Dell",
      "model": "PowerEdge R740",
      "serialNumber": "DEMO-BR123456"
    }
  }'
```

O enriquecimento cria evidência `MANUAL_ENRICHMENT`, timeline e auditoria. Campos ausentes são
preenchidos; valores idênticos recebem nova confirmação sem duplicação; valores atuais diferentes
retornam HTTP `409` e nenhuma alteração é aplicada.

## Fontes de Dados

### Listar catálogo interno

```powershell
curl.exe http://localhost:3001/data-sources
```

O endpoint retorna um catálogo estático de fontes atuais e conectores planejados. Nesta etapa, ele
não consulta banco, não chama APIs externas, não armazena tokens e não configura autenticação de
conectores.

Exemplo resumido de resposta:

```json
{
  "items": [
    {
      "id": "manual-declaration",
      "name": "Cadastro manual",
      "category": "Manual",
      "status": "AVAILABLE",
      "description": "Permite declarar ativos que existem, mas ainda não possuem evidência técnica.",
      "evidenceType": "MANUAL_DECLARATION",
      "current": true
    }
  ],
  "summary": {
    "available": 4,
    "planned": 3,
    "future": 3,
    "total": 10
  }
}
```

Fonte de dados é qualquer origem controlada que gera evidências para o Atlas. Integração real é uma
implementação futura que conecta uma fonte externa, com autenticação, escopo e segurança próprios.

## Evidence Engine em modo sombra

### Consultar a proveniência dos atributos de um ativo

```powershell
curl.exe http://localhost:3001/assets/ASSET_ID/evidence-analysis
```

A resposta organiza, em memória, os valores atuais e históricos já persistidos para cada atributo.
`currentValue` representa um valor atual inequívoco persistido pelo modelo legado e permanece `null`
quando registros atuais divergem. `selectedCandidate` só é preenchido quando existe exatamente um
candidato atual, seu valor corresponde ao valor atual e a evidência vinculada está disponível. Ele
continua representando proveniência comprovada, não uma recomendação.

O bloco aditivo `shadowDecision` executa a política determinística `2026-07-v1` somente em memória.
`recommendedCandidate` representa um valor lógico consolidado que a política recomendaria; todos os
candidatos e IDs de evidência que sustentam esse valor permanecem listados. A resposta mantém
`mode: "SHADOW"`, `decisionsChanged: false` e `explanation.decisionApplied: false`: nenhuma decisão é
persistida ou aplicada.

Strings vazias ou contendo somente espaços são normalizadas como ausência de valor. O candidato
continua visível na avaliação, mas fica inelegível e não participa da recomendação. Evidências com
data de observação futura recebem zero ponto de recência e uma limitação explícita. Essas regras são
correções da elegibilidade já definida pela política `2026-07-v1` e não persistem decisões.

Exemplo resumido:

```json
{
  "attribute": "operatingSystem",
  "currentValue": "Windows 10",
  "selectedCandidate": {
    "attributeId": "atributo-atual"
  },
  "shadowDecision": {
    "mode": "SHADOW",
    "status": "RECOMMENDED",
    "recommendedCandidate": {
      "value": "Windows 11",
      "normalizedValue": "windows 11",
      "policyScore": 90,
      "supportingCandidateIds": ["atributo-tecnico"],
      "supportingEvidenceIds": ["evidencia-tecnica"]
    },
    "divergesFromCurrentValue": true,
    "policyVersion": "2026-07-v1"
  }
}
```

Os status possíveis são `RECOMMENDED`, `CURRENT_VALUE_CONFIRMED`, `TIED`,
`INSUFFICIENT_EVIDENCE`, `NO_CURRENT_VALUE` e `NO_CANDIDATES`. Em empate entre valores diferentes,
`recommendedCandidate` fica `null`: ID, posição e ordem do banco nunca resolvem o empate.

`supportingEvidenceCount` considera somente IDs distintos de evidências disponíveis cujo valor
normalizado corresponde ao `currentValue`. Evidências históricas conflitantes não são contadas como
suporte. Quando não existe um valor atual inequívoco, a contagem é zero.

Os timestamps possuem origens explícitas:

- `attributeObservedAt`: data persistida no `AssetAttribute`;
- `evidenceObservedAt`: data observada da `AssetEvidence` vinculada;
- `evidenceIngestedAt`: entrada dessa evidência no Atlas.

Uma data ausente permanece `null`; o endpoint não copia datas entre atributo e evidência.

`source.trustScore`, `persistedConfidenceScore` e `dataQuality` representam conceitos distintos. O
Trust Score da fonte ainda não é calculado e, portanto, é retornado como `null`.
`persistedConfidenceScore` apenas expõe o score legado do atributo atual: não é confiança de uma
decisão, não foi calculado pelo Evidence Engine e não altera dados persistidos. `policyScore` é
somente a prioridade da política versionada, não probabilidade, certeza, Trust Score ou Confidence
Score. Consulte `docs/evidence-engine.md` para os critérios e limitações completos.

## Análise de conflitos de identidade e rede

```powershell
curl.exe http://localhost:3001/assets/ASSET_ID/conflict-analysis
```

O endpoint executa a política determinística `2026-07-conflict-v1` em modo `SHADOW`. Ele procura
hostname normalizado repetido entre ativos, IP compartilhado por hostnames diferentes e divergência
de hostname dentro do mesmo ativo. A resposta contém somente achados derivados em memória:

```json
{
  "assetId": "ASSET_ID",
  "mode": "SHADOW",
  "policyVersion": "2026-07-conflict-v1",
  "summary": {
    "totalFindings": 1,
    "requiresHumanReview": 1
  },
  "findings": [
    {
      "type": "SHARED_IP_DIFFERENT_HOSTNAMES",
      "normalizedIp": "10.20.30.15",
      "requiresHumanReview": true,
      "reviewOptions": ["DIFFERENT_ASSETS", "IP_REUSED", "NEEDS_MORE_EVIDENCE"]
    }
  ],
  "decisionsChanged": false
}
```

IP não é identidade absoluta. A análise não cria um `Conflict`, não atualiza ativos e não aplica
nenhuma opção de revisão. Consulte `docs/identity-network-conflict-analysis.md`.

### Inventário agregado de achados

```powershell
curl.exe "http://localhost:3001/conflict-analysis/findings?page=1&pageSize=25"
```

Exemplos de filtros e ordenação:

```powershell
curl.exe "http://localhost:3001/conflict-analysis/findings?type=DUPLICATE_HOSTNAME_ACROSS_ASSETS&sortBy=observationCount&sortDirection=desc"
curl.exe "http://localhost:3001/conflict-analysis/findings?hostname=SRV-APP-01&hasLimitations=true"
curl.exe "http://localhost:3001/conflict-analysis/findings?ip=10.20.30.15&sourceType=TECHNICAL"
curl.exe "http://localhost:3001/conflict-analysis/findings?assetId=ASSET_UUID&temporalRelationship=DISTINCT_OBSERVATION_TIMES"
```

A resposta contém `mode: SHADOW`, a versão `2026-07-conflict-v1`, paginação, filtros normalizados,
resumo do conjunto filtrado antes da paginação e itens compactos deduplicados globalmente. O mesmo
achado aparece uma vez, ainda que envolva vários ativos. A consulta não cria conflito formal, fila,
auditoria, evento ou decisão e não altera o inventário. O detalhe permanece em
`GET /assets/:id/conflict-analysis`.

## Casos de revisão experimentais

A interface web equivalente está disponível em `http://localhost:3000/conflict-review-cases`. A criação
é iniciada explicitamente na tela `http://localhost:3000/conflict-findings`; o frontend gera uma
`Idempotency-Key` ASCII opaca e preserva o contrato de replay do backend.

Na interface, os filtros de ativo e datas usam o mesmo contrato da API. As datas informadas no horário
local do navegador são convertidas para ISO 8601 com timezone antes da consulta. Abrir um detalhe produz
um deep link com `caseId`, e Voltar/Avançar restaura filtros, paginação, ordenação e detalhe. Requisições
obsoletas são canceladas e respostas fora de ordem são ignoradas.

Se uma criação ultrapassar o timeout de dez segundos ou terminar com falha de rede, o resultado é tratado
como incerto. O frontend cria em memória um envelope versionado com `findingId`, chave idempotente,
criação e expiração no clique explícito, mas só o registra no `sessionStorage` da aba depois desse resultado
incerto. O envelope é válido por 15 minutos e reutilizado no retry, inclusive após remontagem, sem renovar
`createdAt` ou `expiresAt`. Todo retry revalida também a cópia em memória: antes dos 15 minutos reutiliza
a chave original e, quando `now >= expiresAt`, não envia POST. Registros expirados, inválidos, adulterados
ou de outro finding são removidos e encerram o gesto; somente um novo clique cria outra chave. Se o
`sessionStorage` estiver indisponível, a mesma montagem continua protegida pelo envelope completo em
memória e pelo TTL original; depois de uma remontagem, a tentativa não pode ser recuperada sem o storage.
A chave não é colocada na URL, no corpo ou em mensagens. Respostas conclusivas limpam somente o envelope
do finding correspondente, inclusive depois de unmount ou troca de finding.

O detalhe recebe foco programático em seu heading, com `tabIndex="-1"`, somente quando o carregamento
termina em sucesso ou erro. Frames pendentes são cancelados ao fechar, trocar de caso ou desmontar a tela;
o foco não é movido para um painel obsoleto.

A funcionalidade está desabilitada por padrão. Para testar em
desenvolvimento local, configure `FINDING_REVIEW_CASES_ENABLED=true` e reinicie a API.
Registros históricos podem continuar exibindo `atlas-mvp-user`; novas operações persistem o ID OIDC
namespaced do `CurrentActor`. As rotas de leitura exigem `review-case:read` e os comandos exigem
`review-case:manage`; a API permanece a autoridade mesmo quando o frontend oculta ações não permitidas.

A flag controla todo o fluxo implementado de Finding Review: criação, listagem, detalhe, comparação de
contexto, transições, decisão, resolução, reabertura e respectivos replays retornam HTTP 503 quando ela
estiver ausente, desabilitada ou inválida. Ao reabilitar a flag, os casos existentes voltam a ficar
acessíveis.

### Listar casos

```powershell
curl.exe "http://localhost:3001/conflict-review-cases?page=1&pageSize=25&sortBy=createdAt&sortDirection=desc"
curl.exe "http://localhost:3001/conflict-review-cases?status=OPEN&staleness=CURRENT&findingType=DUPLICATE_HOSTNAME_ACROSS_ASSETS"
curl.exe "http://localhost:3001/conflict-review-cases?assetId=ASSET_UUID&createdFrom=2026-07-01T00:00:00.000Z&createdTo=2026-07-31T23:59:59.999Z"
```

Parâmetros aceitos: `status`, `staleness`, `findingType`, `createdBy`, `assetId`, `findingId`,
`createdFrom`, `createdTo`, `page`, `pageSize`, `sortBy` e `sortDirection`. Os filtros temporais aceitam
somente timestamps ISO 8601 completos com timezone explícito (`Z` ou offset); datas sem horário e
horários sem timezone são rejeitados. Os dois limites são inclusivos e representam instantes UTC. Para
um dia inteiro, envie, por exemplo, `createdFrom=2026-07-20T00:00:00.000Z` e
`createdTo=2026-07-20T23:59:59.999Z`. Não existe expansão automática de date-only. Em uma query string,
o sinal `+` de um offset positivo deve ser codificado como `%2B`, como em
`2026-07-20T03:00:00%2B03:00`.

O filtro `assetId` usa a identidade histórica `assetIdAtCreation`, de modo que um caso continua
localizável quando o vínculo atual com o ativo deixa de existir. `findingId` usa comparação exata e o
formato `finding_` seguido de 24 caracteres hexadecimais minúsculos. `page` e `pageSize` aceitam apenas
decimais canônicos positivos, sem zeros à esquerda, whitespace ou notação científica; os valores e o
`skip` precisam ser inteiros seguros, e `pageSize` varia de 1 a 100. A ordenação aceita `createdAt`,
`updatedAt`, `status` e `staleness`, sempre com `id` como desempate estável.

A API usa paginação por offset. A ordem é determinística enquanto o conjunto de dados permanece
estável, mas inserções concorrentes entre chamadas podem deslocar itens entre páginas; a API não
promete uma fotografia imutável entre requisições. Cursor pagination permanece como evolução futura.

```json
{
  "items": [
    {
      "id": "CASE_UUID",
      "findingId": "finding_0123456789abcdef01234567",
      "findingType": "DUPLICATE_HOSTNAME_ACROSS_ASSETS",
      "policyVersion": "2026-07-conflict-v1",
      "status": "OPEN",
      "staleness": "CURRENT",
      "version": 1,
      "createdBy": "human:oidc:v1:<fingerprint>",
      "createdAt": "2026-07-20T00:00:00.000Z",
      "updatedAt": "2026-07-20T00:00:00.000Z",
      "assetCount": 2,
      "eventCount": 1
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

A listagem é resumida: não retorna snapshot, hash, fingerprint, chave ativa ou eventos completos.

### Consultar detalhe

```powershell
curl.exe http://localhost:3001/conflict-review-cases/CASE_UUID
```

O detalhe retorna o snapshot original e o hash exatamente como persistidos, relações com
`assetIdAtCreation` e disponibilidade atual do ativo, além dos eventos ordenados por versão, criação e
ID. A metadata é filtrada por whitelist e não inclui fingerprint, chave idempotente ou identificadores
internos do assunto. A leitura não recalcula o finding, não compara o snapshot com o estado atual, não
altera staleness, não cria `AuditLog` e não atualiza o inventário.

### Comparar contexto histórico e atual

```powershell
curl.exe http://localhost:3001/conflict-review-cases/CASE_UUID/context-comparison
```

A comparação é explícita e somente leitura. O backend deriva os findings atuais uma vez e procura o
mesmo assunto pela `reviewSubjectKey`, portanto um `findingId` diferente ainda pode representar o mesmo
caso. A resposta contém `caseId`, `caseVersion`, `comparedAt`, metadados do baseline original, o snapshot
atual e seu hash quando localizado, além de `result.staleness`, `result.reasons` e `result.diff`.

Os resultados possíveis são `CURRENT`, `CHANGED`, `NO_LONGER_DETECTED`, `ASSET_UNAVAILABLE`,
`POLICY_VERSION_CHANGED` e `REQUIRES_REFRESH`. Finding ausente retorna HTTP 200 com `current: null`;
versão de snapshot não suportada e correspondência atual ambígua retornam `REQUIRES_REFRESH`. ID inválido
retorna 400, caso inexistente retorna 404 e feature desabilitada retorna 503.

Sem mudança material, `result` é:

```json
{ "staleness": "CURRENT", "reasons": [], "diff": {} }
```

```json
{
  "caseId": "CASE_UUID",
  "caseVersion": 1,
  "comparedAt": "2026-08-31T12:00:00.000Z",
  "baseline": {
    "kind": "ORIGINAL",
    "findingId": "finding_0123456789abcdef01234567",
    "policyVersion": "2026-07-conflict-v1",
    "snapshotHash": "SNAPSHOT_SHA256"
  },
  "current": null,
  "result": {
    "staleness": "NO_LONGER_DETECTED",
    "reasons": ["FINDING_NO_LONGER_DETECTED"],
    "diff": {}
  }
}
```

`comparedAt` e o resultado não são persistidos. A chamada não modifica a versão, o `updatedAt`, o
`staleness` armazenado, o snapshot original, eventos, auditoria, decisões, inventário ou `Conflict`.
A adoção persistente de contexto por refresh permanece futura.

### Alterar estado operacional do caso

O endpoint aceita somente estados operacionais ativos e exige a versão atualmente apresentada ao
usuário:

```powershell
curl.exe -X PATCH http://localhost:3001/conflict-review-cases/CASE_UUID/status `
  -H "Content-Type: application/json" `
  -d '{"status":"IN_REVIEW","expectedVersion":1}'
```

Quando a transição entra ou sai de `WAITING_FOR_EVIDENCE`, `justification` é obrigatória:

```powershell
curl.exe -X PATCH http://localhost:3001/conflict-review-cases/CASE_UUID/status `
  -H "Content-Type: application/json" `
  -d '{"status":"WAITING_FOR_EVIDENCE","expectedVersion":1,"justification":"Aguardando confirmação da fonte técnica."}'
```

O campo aceita de 1 a 500 caracteres depois do trim das extremidades. Espaços internos e quebras de
linha são preservados. As quatro transições que exigem justificativa são
`OPEN → WAITING_FOR_EVIDENCE`, `IN_REVIEW → WAITING_FOR_EVIDENCE`,
`WAITING_FOR_EVIDENCE → OPEN` e `WAITING_FOR_EVIDENCE → IN_REVIEW`. Enviar `justification` em
`OPEN ↔ IN_REVIEW` retorna HTTP 400, em vez de descartar o conteúdo silenciosamente.

Resposta mínima em sucesso:

```json
{
  "id": "CASE_UUID",
  "status": "IN_REVIEW",
  "version": 2,
  "updatedAt": "2026-07-20T12:05:00.000Z"
}
```

São permitidas somente as seis transições distintas entre `OPEN`, `IN_REVIEW` e
`WAITING_FOR_EVIDENCE`. O mesmo estado e os destinos `RESOLVED`, `DISMISSED` e `CANCELLED` são
rejeitados por este PATCH. `RESOLVED` é alcançado somente pelo endpoint dedicado de resolução, e
`RESOLVED → IN_REVIEW` somente pelo endpoint dedicado de reabertura; `DISMISSED` e `CANCELLED` não
possuem comando atual. A atualização é condicionada por `expectedVersion`, incrementa a versão uma
vez e retorna HTTP 409 quando outra operação atualizou o caso primeiro. Em sucesso, o backend cria
`CASE_STATUS_CHANGED` e `AuditLog` na mesma transação PostgreSQL; nenhuma tabela do inventário é
alterada. Nas transições que entram ou saem da espera, a mesma justificativa normalizada é preservada
em `FindingReviewEvent.metadata.justification` e `AuditLog.metadata.justification`, e aparece no
histórico do caso e na Auditoria global. Essa informação pertence somente à transição e não representa
comentário ou colaboração. O recurso utiliza os campos JSONB existentes e não exige migration.

`FindingReviewCase.version` é persistida como PostgreSQL `INT4`. Como a operação grava
`expectedVersion + 1`, o maior valor aceito no request é `2147483646`. `2147483647` e valores
superiores retornam HTTP 400 durante a validação, antes de qualquer transação, evento ou `AuditLog`;
detalhes Prisma como `P2020` nunca fazem parte da resposta.

Esse PATCH não usa `Idempotency-Key` e não deve receber retry automático. Se a conexão falhar ou
expirar, o resultado pode ser incerto: consulte novamente o detalhe antes de oferecer outra alteração.
Na interface, a ação “Recarregar caso” trata tanto a versão obsoleta quanto essa verificação explícita.
O ator é derivado do access token OIDC validado, e o comando exige `review-case:manage`. Os comandos
para `DISMISSED` e `CANCELLED` permanecem futuros.

### Registrar a primeira decisão de identidade

Somente um caso em `IN_REVIEW`, sem decisão anterior, pode receber a primeira conclusão:

```powershell
curl.exe -X POST http://localhost:3001/conflict-review-cases/CASE_UUID/decisions `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: decisao-identidade-001" `
  -d '{
    "identityConclusion":"SAME_ASSET",
    "justification":"As evidências indicam que os registros representam o mesmo equipamento.",
    "expectedVersion":4
  }'
```

`identityConclusion` aceita `SAME_ASSET` ou `DIFFERENT_ASSETS`, desde que a opção esteja presente no
snapshot original e o caso possua ao menos dois ativos históricos. A justificativa é obrigatória,
recebe trim somente nas extremidades, preserva espaços e quebras de linha internos e aceita de 1 a
1.000 caracteres. Não use esse campo para credenciais, tokens, secrets ou dados sensíveis
desnecessários.

Uma criação nova retorna HTTP `201`:

```json
{
  "decision": {
    "id": "DECISION_UUID",
    "caseId": "CASE_UUID",
    "identityConclusion": "SAME_ASSET",
    "justification": "As evidências indicam que os registros representam o mesmo equipamento.",
    "caseVersion": 5,
    "createdBy": "human:oidc:v1:<fingerprint>",
    "createdAt": "2026-08-22T12:00:00.000Z"
  },
  "idempotentReplay": false
}
```

Repetir a mesma chave com o mesmo request semântico retorna HTTP `200`, a mesma decisão e
`idempotentReplay: true`, inclusive se a versão do caso avançou posteriormente. Reutilizar a chave
com outro caso, conclusão, justificativa ou `expectedVersion` retorna HTTP `409`. Uma chave nova para
um caso que já possui decisão também retorna `409`; correção e superseding ainda não existem.

A operação incrementa `FindingReviewCase.version`, grava `decision.caseVersion` com a versão
resultante e cria `CASE_DECISION_RECORDED` e `AuditLog` na mesma transação. O status permanece
`IN_REVIEW`. Nenhum ativo, evidência, interface, conflito ou evento de ativo é alterado.

O detalhe `GET /conflict-review-cases/:id` inclui de forma aditiva `currentDecision` e
`decisionHistory`. A decisão corrente é derivada pela maior `caseVersion`; casos sem decisão retornam
`currentDecision: null` e `decisionHistory: []`. O fingerprint e a chave idempotente não são expostos.

### Resolver logicamente um caso de revisão

Somente um caso `IN_REVIEW` com decisão corrente pode encerrar a investigação:

```powershell
curl.exe -X POST http://localhost:3001/conflict-review-cases/CASE_UUID/resolutions `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: resolucao-caso-001" `
  -d '{
    "expectedVersion":5,
    "justification":"Investigação concluída com base nas evidências."
  }'
```

Uma resolução nova retorna HTTP `201`; repetir a mesma chave, caso, versão original e justificativa
normalizada retorna HTTP `200` com `idempotentReplay: true`. A justificativa recebe trim somente nas
extremidades, preserva whitespace interno e aceita de 1 a 1.000 caracteres. O fingerprint é composto
por operação, ator provisório, `caseId` e chave opaca. Por isso, a idempotência é escopada por caso e a
mesma chave pode ser usada de forma independente em outro caso.

```json
{
  "idempotentReplay": false,
  "resolution": {
    "eventId": "EVENT_UUID",
    "caseId": "CASE_UUID",
    "decisionId": "DECISION_UUID",
    "identityConclusion": "SAME_ASSET",
    "justification": "Investigação concluída com base nas evidências.",
    "versionBefore": 5,
    "versionAfter": 6,
    "previousStatus": "IN_REVIEW",
    "status": "RESOLVED",
    "resolvedBy": "human:oidc:v1:<fingerprint>",
    "resolvedAt": "2026-08-23T12:00:00.000Z"
  }
}
```

O comando usa controle otimista por `expectedVersion`, altera o caso para `RESOLVED`, incrementa a
versão, libera `activeReviewSubjectKey` e cria `CASE_RESOLVED` e `AuditLog` atomicamente. `RESOLVED`
significa apenas que a investigação foi encerrada: o Atlas não recalcula ou corrige o finding, não
mescla ativos, não altera o inventário ou `Conflict`, não cria suppression e não executa remediation.
Correção e superseding de decisões continuam fora desta entrega.

### Reabrir logicamente um caso de revisão

Somente um caso `RESOLVED` pode voltar para `IN_REVIEW`:

```powershell
curl.exe -X POST http://localhost:3001/conflict-review-cases/CASE_UUID/reopens `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: reabertura-caso-001" `
  -d '{
    "expectedVersion":6,
    "justification":"Novas evidências exigem reavaliação da conclusão anterior."
  }'
```

Uma reabertura nova retorna HTTP `201`; o replay da mesma chave, caso, versão original e justificativa
normalizada retorna HTTP `200`. A justificativa é obrigatória, recebe trim somente nas extremidades,
preserva whitespace interno e aceita de 1 a 1.000 caracteres. Reutilizar a chave com conteúdo
diferente retorna `409 IDEMPOTENCY_KEY_REUSED`.

```json
{
  "idempotentReplay": false,
  "reopen": {
    "eventId": "EVENT_UUID",
    "caseId": "CASE_UUID",
    "justification": "Novas evidências exigem reavaliação da conclusão anterior.",
    "versionBefore": 6,
    "versionAfter": 7,
    "previousStatus": "RESOLVED",
    "status": "IN_REVIEW",
    "reopenedBy": "human:oidc:v1:<fingerprint>",
    "reopenedAt": "2026-08-24T12:00:00.000Z"
  }
}
```

O comando restaura `activeReviewSubjectKey` a partir da `reviewSubjectKey` persistida, incrementa a
versão e cria `CASE_REOPENED` e `AuditLog` na mesma transação. Se outro caso já estiver ativo para o
mesmo assunto, retorna `409 ACTIVE_REVIEW_CASE_EXISTS`. A decisão corrente e todo o histórico são
preservados, permitindo concluir novamente a investigação com a mesma decisão. `DISMISSED` e
`CANCELLED` não podem ser reabertos por este comando. A operação não altera inventário ou `Conflict`.

### Criar caso

Primeiro consulte o inventário agregado e copie um `findingId` atual. Depois envie:

```powershell
curl.exe -X POST http://localhost:3001/conflict-review-cases `
  -H "Content-Type: application/json" `
  -H "Idempotency-Key: demonstracao-caso-001" `
  -d '{"findingId":"finding_0123456789abcdef01234567"}'
```

Uma criação nova retorna HTTP 201 e uma representação resumida do caso:

```json
{
  "id": "CASE_UUID",
  "findingId": "finding_0123456789abcdef01234567",
  "findingType": "DUPLICATE_HOSTNAME_ACROSS_ASSETS",
  "policyVersion": "2026-07-conflict-v1",
  "reviewSubjectKey": "HASH_SHA256",
  "status": "OPEN",
  "staleness": "CURRENT",
  "version": 1,
  "affectedAssets": [],
  "createdBy": "human:oidc:v1:<fingerprint>",
  "idempotentReplay": false
}
```

Repetir exatamente a mesma chave e o mesmo `findingId` retorna o mesmo caso com HTTP 200 e
`idempotentReplay: true`, sem novo evento ou auditoria. Reutilizar a chave com outro `findingId`, ou
tentar abrir outro caso ativo para o mesmo assunto com uma chave diferente, retorna HTTP 409.

`Idempotency-Key` é case-sensitive, possui de 1 a 128 caracteres e aceita somente letras ASCII,
números e os caracteres `._~:+/=-`. Espaços e Unicode são rejeitados; não ocorre trim, conversão de
maiúsculas/minúsculas ou normalização Unicode. A chave é tratada como valor opaco: `ABC` e `abc` são
chaves diferentes. O nome HTTP `Idempotency-Key` é case-insensitive, conforme o protocolo, mas seu
valor não é. Headers duplicados são rejeitados com HTTP 400 depois que o transporte combina seus
valores em uma única string separada por vírgula.

O fingerprint é o SHA-256 hexadecimal da serialização canônica de uma estrutura que contém a operação
`CREATE_FINDING_REVIEW_CASE`, o ID estável do `CurrentActor` e o valor exato da chave. Um vetor
sintético ASCII fixo protege a compatibilidade dessa fórmula sem publicar dados reais.

O replay é procurado pelo fingerprint antes de o servidor recalcular o finding. Portanto, uma
repetição legítima continua retornando o mesmo caso mesmo quando o finding original deixou de ser
detectado. A serialização usada nos fingerprints e snapshots utiliza ordenação canônica independente
da localidade do sistema.

O contrato `snapshotVersion: 1` representa o algoritmo binário final deste PR: propriedades e
conjuntos aprovados são ordenados por comparação explícita com `<` e `>`, sem `localeCompare`, ICU ou
locale do sistema; listas cuja ordem possui significado são preservadas. O hash é SHA-256 hexadecimal
sobre a serialização canônica. Vetores literais com Unicode e um snapshot realista fixam texto e hash.
A implementação provisória anterior existiu somente no draft e não chegou à `main`; por isso não há
`snapshotVersion: 2`. Refresh e revalidação de snapshots permanecem fora do escopo.

O backend não aceita snapshot, hash, assunto, ativos, ator, estado ou decisão no body de criação.
Esses dados são recalculados e construídos no servidor. A chave idempotente bruta não é persistida nem
registrada em auditoria. O fluxo atual também possui GETs de lista e detalhe, frontend, primeira
decisão, resolução e reabertura lógicas. Nenhuma dessas operações integra implicitamente o caso com
`Conflict` ou altera o inventário.

Caso a criação falhe ao relacionar os ativos, criar o evento ou registrar o `AuditLog`, a transação
PostgreSQL é revertida integralmente. O fingerprint permanece disponível para uma nova tentativa.
