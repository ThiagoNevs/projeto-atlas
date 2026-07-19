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
novo, motivo, comentário e o ator simulado do MVP.

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

## Criação experimental de caso de revisão

A criação está desabilitada por padrão e ainda não possui autenticação ou RBAC reais. Para testar em
desenvolvimento local, configure `FINDING_REVIEW_CASES_ENABLED=true` e reinicie a API. O ator
`atlas-mvp-user` é somente uma identificação provisória do MVP.

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
  "createdBy": "atlas-mvp-user",
  "idempotentReplay": false
}
```

Repetir exatamente a mesma chave e o mesmo `findingId` retorna o mesmo caso com HTTP 200 e
`idempotentReplay: true`, sem novo evento ou auditoria. Reutilizar a chave com outro `findingId`, ou
tentar abrir outro caso ativo para o mesmo assunto com uma chave diferente, retorna HTTP 409.

O backend não aceita snapshot, hash, assunto, ativos, ator, estado ou decisão no body. Esses dados são
recalculados e construídos no servidor. A chave idempotente bruta não é persistida nem registrada em
auditoria. Esta entrega não possui endpoints GET de casos, frontend, decisões ou integração com
`Conflict`, e não altera o inventário.
