# Evidence Engine — decisão simulada em modo sombra

## Objetivo

O Evidence Engine organiza a proveniência dos atributos e avalia candidatos concorrentes sem
alterar o inventário. A política responde qual valor seria recomendado pelas regras explícitas
atuais e por quê. Ela não afirma verdade, correção, certeza ou probabilidade.

O endpoint permanece:

```text
GET /assets/:id/evidence-analysis
```

A resposta é aditiva: os contratos existentes de `currentValue`, `candidates`,
`selectedCandidate`, `persistedConfidenceScore` e `explanation` são preservados, e cada atributo
recebe o bloco `shadowDecision`.

## Separação de conceitos

- `selectedCandidate`: vínculo comprovado entre o valor atual persistido e uma evidência disponível.
- `shadowDecision.recommendedCandidate`: valor lógico consolidado que a política recomendaria.
- `persistedConfidenceScore`: score legado do atributo; não participa da decisão simulada.
- `source.trustScore`: continua `null`; ainda não existe política de Trust Score por fonte.
- `policyScore`: prioridade interna da política, sem significado probabilístico.

Um valor recomendado pode possuir vários candidatos e evidências de suporte. Por isso,
`recommendedCandidate` não aponta silenciosamente para uma única evidência vencedora: ele preserva
`supportingCandidateIds` e `supportingEvidenceIds`.

## Política 2026-07-v1

A versão inicial é centralizada em código, determinística, sem configuração por ambiente e sem
aleatoriedade.

### Elegibilidade

Um candidato precisa possuir:

- valor normalizado válido;
- `evidenceId`;
- evidência vinculada disponível;
- fonte `TECHNICAL` ou `MANUAL` reconhecida.

Fontes `SIMULATED` permanecem visíveis, mas não podem recomendar alterações em dados reais. Fontes
`UNKNOWN` também são inelegíveis porque a política não presume sua autoridade. Registros quebrados
ou sem evidência ficam inelegíveis com limitação explícita.

Strings vazias ou compostas somente por espaços, tabs e quebras de linha são normalizadas como
ausência de valor. Esses candidatos permanecem visíveis nas avaliações individuais, mas são
inelegíveis, não recebem pontos e não participam da consolidação, de empates ou de recomendações.
Valores legítimos como `"0"`, `0`, `"false"` e `false` continuam válidos. A correção preserva a versão
`2026-07-v1` porque aplica a regra já declarada de que todo candidato precisa possuir valor
normalizado válido.

### Pontuação de prioridade

| Critério | Regra | Pontos |
| --- | --- | ---: |
| Tipo da fonte | `TECHNICAL` | 40 |
| Tipo da fonte | `MANUAL` | 20 |
| Evidência | vínculo disponível | 20 |
| Recência | até 30 dias | 30 |
| Recência | de 31 a 90 dias | 20 |
| Recência | de 91 a 180 dias | 10 |
| Recência | acima de 180 dias ou sem data válida | 0 |
| Estabilidade | candidato atual | 5 |
| Estabilidade | candidato histórico | 0 |
| Score legado | deliberadamente ignorado | 0 |

A recência usa exclusivamente `evidenceObservedAt`. `attributeObservedAt` e `evidenceIngestedAt`
continuam disponíveis para proveniência, mas não substituem a data observada da evidência. O instante
de referência é fornecido à política, permitindo testes estáveis nos limites de 30, 90 e 180 dias.
Evidências com data de observação futura recebem zero ponto de recência e uma limitação explícita,
pois não podem ser tratadas como observações recentes válidas.

## Consolidação e empates

Valores equivalentes conforme os normalizadores existentes são consolidados. A pontuação do valor
lógico é a maior pontuação individual entre seus candidatos; quantidade de registros não aumenta
automaticamente a prioridade. Todas as evidências de suporte permanecem na resposta.

Se valores lógicos diferentes empatam na maior pontuação:

- o status é `TIED`;
- `recommendedCandidate` é `null`;
- `divergesFromCurrentValue` é `null`;
- os valores empatados aparecem em `tiedValues`;
- ID, posição, data de ingestão e ordem do banco não resolvem o empate.

## Status da decisão

- `RECOMMENDED`: existe recomendação inequívoca diferente do atual ou não há valor atual.
- `CURRENT_VALUE_CONFIRMED`: a política recomendaria manter o valor atual; isso não comprova correção.
- `TIED`: valores diferentes empataram e nenhuma recomendação foi produzida.
- `INSUFFICIENT_EVIDENCE`: nenhum candidato é elegível; também cobre registros existentes cujos
  valores são todos ausentes após a normalização.
- `NO_CURRENT_VALUE`: não há valor atual nem candidato elegível.
- `NO_CANDIDATES`: não existem candidatos para avaliar.

## Ausência de efeitos colaterais

A análise ocorre em memória depois de uma única consulta de leitura. Ela não executa:

- `create`, `update`, `upsert` ou `delete`;
- transação de escrita;
- criação de `AuditLog`, `AssetEvent` ou `Conflict`;
- atualização de atributo, evidência, score ou status;
- ingestão, importação ou análise de interfaces de rede;
- serviço externo, machine learning ou IA generativa.

O resultado existe apenas na resposta HTTP. O modo permanece `SHADOW`, `decisionsChanged` permanece
`false` e `explanation.decisionApplied` permanece `false`.

## Limitações atuais

- A política usa apenas campos já presentes no contrato seguro; payload bruto não é consultado.
- Não existe Trust Score por fonte.
- O score legado não possui semântica uniforme e é ignorado.
- A política não trata IP, MAC ou identidade de rede.
- A recomendação ainda não é persistida nem apresentada pelo frontend.
- Não há resolução automática de conflito ou alteração automática do inventário.
