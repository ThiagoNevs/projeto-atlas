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
mas não é identidade absoluta porque IP pode mudar ou ser reutilizado. Linhas sem `hostname`, sem
`ipAddress` ou com IP inválido retornam HTTP `400`; hostnames duplicados retornam HTTP `409`;
IP repetido gera warning/sinal de atenção e não bloqueia a importação.

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
