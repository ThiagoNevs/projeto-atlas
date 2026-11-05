# ADR-020: Connector Active Directory Domain Services

- Status: Accepted
- Data: 2026-11-05
- Decisores: Arquitetura e Engenharia do Atlas
- Relacionados: ADR-009, ADR-012, ADR-016, ADR-017, ADR-018 e ADR-019

## Contexto

O Atlas possui execução durável, Connector Framework, plano de controle e estabilização de produção,
mas ainda não registra um `ConnectorDefinition` produtivo. O primeiro provider real será o Active
Directory Domain Services (AD DS), limitado inicialmente ao inventário de objetos `computer`.

AD DS e Microsoft Entra ID são providers diferentes. Eles não compartilham protocolo, identidade do
registro, configuração ou credencial. Este ADR fecha o contrato arquitetural do AD DS v1 antes da
implementação e não autoriza credencial produtiva nem conexão a domínio corporativo.

## Escopo

O connector v1 terá:

- `connectorType`: `active-directory-domain-services`;
- capability única: `ASSET_INVENTORY`;
- observation type único: `ASSET`;
- objeto LDAP único: `computer`;
- enumeração completa, paginada e somente leitura do naming context de um domínio;
- normalização para `ConnectorObservation` e ingestão evidence-first já existentes.

## Fora de escopo

Não fazem parte do v1: users, groups, memberships, GPOs, trusts, sites, subnets, password policy,
ACLs, security descriptors, DNS records, vulnerabilidades, security posture, objetos Entra ID,
Global Catalog, DirSync, USN cursor, tombstones, deleted objects control, sincronização incremental,
scheduler, UI, Security Analyzer, SAST, SCA, Policy Engine ou `SecurityFinding`.

O connector não cria, altera, move ou exclui objetos e nunca executa `add`, `modify`, `delete`,
`modifyDN`, password change ou escrita de membership.

## Terminologia

- **instance**: configuração de coleta de exatamente um domínio AD DS;
- **endpoint**: Domain Controller explicitamente configurado por FQDN e rótulo seguro;
- **registro do provider**: um objeto `computer` identificado por `objectGUID`;
- **observation**: representação validada e allowlisted produzida durante `collect()`;
- **material secreto**: senha resolvida em memória a partir de uma `SecretReference`.

## Identidade do connector

O tipo é `active-directory-domain-services`. Ele não reutiliza
`active-directory-entra-id`. Config schemas, secret slots, provider identities e protocolos dos dois
connectors permanecem separados; somente a infraestrutura genérica do Atlas é compartilhada.

O registro de produção continua vazio neste ADR. A futura implementação registrará somente
`ASSET_INVENTORY` e `ASSET`.

## Fronteira domain/instance

Uma `ConnectorInstance` representa exatamente um domínio AD DS, não uma forest. O search base
padrão é o `defaultNamingContext` desse domínio. Uma forest multi-domain exige uma instance por
domínio.

O v1 não usa Global Catalog nem as portas 3268/3269. Essa escolha evita identidade e escopo
cross-domain implícitos, mantém paginação e autorização determinísticas e permite que cada domínio
tenha endpoints, credencial, limites e operação próprios. O custo é administração de múltiplas
instances em forests multi-domain.

## Transporte

O único transporte v1 é LDAPS direto sobre TCP/636:

```text
Atlas Connector Worker → Domain Controller FQDN configurado → TCP/636
```

LDAP/389, StartTLS, Global Catalog e fallback para plaintext são proibidos. O DC não inicia conexão
com o Atlas e não há administração remota. Regras de saída permitem apenas os FQDNs configurados na
porta 636.

## Validação TLS

O cliente valida cadeia de confiança, validade temporal e correspondência do hostname com o FQDN
configurado. O certificado do servidor deve possuir Server Authentication EKU, FQDN do DC em SAN
(ou CN legado aceito pelo validador da plataforma), cadeia confiável e validade vigente.

Certificado self-signed ou emitido por CA não confiável, expirado ou com hostname incompatível é
rejeitado. `rejectUnauthorized=false`, trust-all, skip verification e downgrade são proibidos. O
Atlas não emite nem administra certificados de DC. A CA do ambiente controlado deve ser instalada
fora da instance no trust store do sistema/container; não existe override inseguro por instance.

## Autenticação

O v1 usa **simple bind exclusivamente dentro do LDAPS validado**. A identidade de bind não secreta é
configurada como UPN em `bindPrincipal`; a senha é resolvida pelo slot `bind-password`.

SASL/Kerberos sobre TLS com channel binding oferece postura superior contra relay e poderá ser uma
evolução. Ele não é o modo inicial devido à complexidade operacional cross-platform do runtime
Node/Linux, requisitos de realm/SPN/keytab e suporte desigual das bibliotecas. O v1 não oferece
Kerberos, CBT nem fallback automático entre modos. Simple bind é explicitamente mais fraco que
SASL/Kerberos+CBT e nunca opera fora do TLS estritamente validado.

## Credenciais

Somente a `SecretReference` é persistida pelo plano de controle. O material do slot
`bind-password` é resolvido dentro de `collect()`, permanece apenas em memória pelo tempo necessário
à execução e é descartável ao final.

Senha, locator/logical key, bind credential e material resolvido não entram em configuração, job,
observation, evidence, `AuditLog`, error code, mensagem de erro ou log. Não há outros secret slots no
v1.

## Menor privilégio

A conta é dedicada, read-only e não interativa quando o IdP/diretório permitir. Ela não pertence a
Domain Admins, Enterprise Admins, Account Operators, Server Operators ou outro grupo privilegiado.
Recebe somente leitura do naming context/OU configurado e dos onze atributos allowlisted. Em um
ambiente onde a leitura autenticada padrão seja suficiente, nenhum direito adicional será
concedido. Permissões ausentes falham como autorização, sem elevação automática.

## Endpoints e failover

A configuração contém de 1 a 5 endpoints ordenados, cada um com `label`, `fqdn` e `port: 636`.
FQDNs são validados e únicos. IP não é aceito como identidade TLS primária. O v1 não faz descoberta
DNS SRV; a lista explícita produz comportamento reprodutível e superfície de saída conhecida.

Cada endpoint é tentado no máximo uma vez por tentativa de coleta. O próximo endpoint só é usado
para falha transitória de DNS/conexão/reset/timeout ou resposta LDAP `busy`/`unavailable`. Certificado
inválido é falha determinística daquele endpoint: o próximo DC explicitamente autorizado pode ser
tentado, sem repetir o endpoint e sem relaxar TLS. Se todos falharem por TLS, o resultado é
`ADDS_TLS_VALIDATION_FAILED` não retryable.

Falha de autenticação, autorização, configuração, protocolo ou cancelamento não inicia failover.
Depois de esgotada a lista, a política bounded de retry do Connector Framework decide uma nova
tentativa do mesmo run somente para falhas classificadas como transitórias.

## Escopo de busca

O connector consulta RootDSE e usa `defaultNamingContext` como base padrão, validando que ele
corresponde ao `domainName` configurado. Uma `searchBaseDn` opcional pode restringir a coleta a uma
OU, mas deve ser analisada como DN e ser igual ou descendente do naming context. DNs nunca são
montados por concatenação.

O scope é subtree. Estrutura, tipos, FQDNs e sintaxe do DN são validados antes de resolver segredo ou
abrir conexão. A relação semântica entre `searchBaseDn`, `domainName` e `defaultNamingContext` é
validada depois do TLS/bind e da leitura de RootDSE, antes da primeira busca; incompatibilidade é
determinística e não retryable.

## Referrals

Referral chasing automático fica desligado. Referral recebido é classificado com segurança como
`ADDS_REFERRAL_UNSUPPORTED`, determinístico e não retryable. Credenciais nunca são encaminhadas a
destino indicado pelo servidor. Isso preserva a regra de um domínio por instance e a paginação no
mesmo DC.

## Filtro LDAP e fronteira de injection

O filtro canônico e estático é:

```text
(&(objectCategory=computer)(objectClass=computer))
```

O usuário não fornece filtro. Não há interpolação de valores no filtro nem construção textual de
DN. Qualquer valor dinâmico futuro exigirá parser/builder e escaping próprios antes de ampliar este
contrato.

## Identidade estável

`providerRecordId` é o `objectGUID` binário convertido segundo a ordem de bytes do AD para UUID
canônico lowercase com hífens. GUID ausente ou malformado rejeita somente a entrada com
`ADDS_ENTRY_INVALID`; representação dependente da biblioteca nunca é persistida.

`distinguishedName`, `dNSHostName`, `sAMAccountName` e `objectSid` são atributos/evidência, não
identidade. Rename, alteração de hostname e mudança entre OUs preservam o `providerRecordId`.
Registros com nomes iguais continuam distintos por GUID.

`objectSid` é convertido do binário para a forma canônica `S-1-...` e permanece evidência
secundária. Ele não substitui o GUID e pode mudar em cenários de migração. SID opcional malformado é
omitido com issue segura da entrada; o restante válido pode ser observado.

## Atributos

A consulta e o payload aceitam somente:

```text
objectGUID
objectSid
sAMAccountName
dNSHostName
operatingSystem
operatingSystemVersion
distinguishedName
whenCreated
whenChanged
userAccountControl
lastLogonTimestamp
```

Nenhum atributo adicional ou entrada LDAP bruta é copiado por conveniência.

`lastLogonTimestamp` é replicado e aproximado; não prova atividade exata nem, isoladamente, que uma
máquina está ativa/inativa. `userAccountControl` é interpretado pelo bit `ACCOUNTDISABLE` e exposto
semanticamente como `accountEnabled`; o bitmask inteiro pode permanecer na evidence allowlisted
para rastreabilidade, mas não é a única informação consumível.

## Paginação

Toda enumeração usa LDAP Simple Paged Results Control, OID `1.2.840.113556.1.4.319`. Consulta
full-domain sem paginação é proibida.

`pageSize` padrão é 500, mínimo 50 e máximo 1000. Durante uma enumeração permanecem iguais query,
base, scope, controls, sessão LDAP e DC. A ordem retornada não participa de identidade ou dedupe.

## Ciclo de vida do cookie

O cookie é opaco, existe somente em memória e nunca entra em persistência, log, evidence, job ou
erro. Ele é reenviado apenas na mesma sessão/DC até o servidor retornar cookie vazio/ausente. O
connector não interpreta nem reutiliza cookie entre execuções.

## Failover durante paginação

Se o DC falhar durante a paginação, o cookie é descartado. O connector conecta ao próximo endpoint
permitido e reinicia a enumeração na primeira página, sem tentar usar o cookie anterior.

O restart pode repetir computers já emitidos. Essa semântica é intencional: `objectGUID`, semantic
fingerprint, `connectorObservationKey` e dedupe de evidence preservam idempotência interna. Não há
promessa de enumeração exactly-once no provider.

## Limites e timeouts

Todos os valores são validados e bounded:

| Controle                    |  Padrão | Mínimo |    Máximo |
| --------------------------- | ------: | -----: | --------: |
| endpoints                   |       1 |      1 |         5 |
| page size                   |     500 |     50 |     1.000 |
| max pages                   |     200 |      1 |    10.000 |
| max observations            | 100.000 |      1 | 1.000.000 |
| connection timeout          |     5 s |    1 s |      30 s |
| bind timeout                |    10 s |    1 s |      60 s |
| search/page timeout         |    30 s |    5 s |     120 s |
| overall collection deadline |  15 min |  1 min |    60 min |

Alcançar `maxPages`, `maxObservations` ou deadline nunca declara inventário completo. Se já houver
evidence aceita, o run termina `PARTIAL`; sem evidence, termina `FAILED`, com
`ADDS_LIMIT_EXCEEDED` ou `ADDS_DEADLINE_EXCEEDED`. O retry do framework não é infinito.

## Cancelamento

O `AbortSignal` é verificado antes de conectar, durante connect/bind, antes e entre páginas, durante
operações de busca, antes de failover e antes de normalizar/yield quando aplicável. Cancelamento
fecha sessão/recursos, produz `ADDS_CANCELLED` e não tenta outro endpoint.

## Classificação de retry

São retryable: DNS/conexão/reset/timeout transitórios, LDAP `busy`/`unavailable`, interrupção de
sessão e indisponibilidade transitória de infraestrutura. São determinísticos e não retryable:
configuração inválida, TLS inválido após endpoints permitidos, autenticação, autorização, referral,
protocolo/paging inválido, atributo obrigatório inválido e cancelamento.

O mesmo `ConnectorRun` é preservado entre retries. Quando uma falha terminal ocorre após evidence
durável, o contrato atual resulta em `PARTIAL`; sem evidence, `FAILED`.

## Normalização da observation

Cada estado coletado de um computer produz no máximo uma observation semântica `ASSET`:

- `objectGUID` → `providerRecordId`;
- `dNSHostName` normalizado lowercase → `asset.hostname`;
- `operatingSystem` → `asset.operatingSystem`;
- `operatingSystemVersion` → `asset.osVersion`;
- atributos restantes → payload provider allowlisted;
- `observedAt` → relógio do Atlas no momento da observação.

`whenCreated`, `whenChanged` e `lastLogonTimestamp` são tempos do provider, nunca `observedAt`.
Windows FILETIME zero significa ausência. FILETIME e GeneralizedTime inválidos/out-of-range são
omitidos com issue segura da entrada, sem derrubar toda a coleta.

Se `dNSHostName` válido estiver ausente, o único fallback é `sAMAccountName` terminado em `$`:
remove-se exatamente o último `$`, valida-se um DNS single-label e normaliza-se lowercase. Sem esse
fallback seguro, a entrada é rejeitada com `ADDS_ENTRY_INVALID`. O connector não infere owner,
application context ou security posture.

## Fronteiras de evidence

Não existe staging genérico. O fluxo é:

```text
LDAP entry → parse → validate → normalize → ConnectorObservation → evidence-first ingestion
```

`AssetEvidence` contém somente os onze atributos aprovados, suas representações semânticas e a
proveniência já definida pelo framework. Não contém segredo, logical key, cookie, diagnóstico LDAP,
connection string, dados privados de TLS, ticket Kerberos ou token.

Ausência em uma enumeração full paged não significa automaticamente exclusão física ou desativação;
uma política futura deverá interpretar ausências.

## Logging e redação

Logs podem conter `runId`, `connectorInstanceId`, endpoint label/index seguro, número de página,
contagem, duração, error code e error type. FQDN não é logado por padrão.

Senha, locator/logical key, bind principal, URL com credencial, cookie, diagnóstico bruto, entrada
LDAP completa e DN bruto são proibidos. Mensagens do provider são mapeadas para códigos seguros e
nunca persistidas diretamente.

## Taxonomia de erros

O contrato inicial usa códigos seguros:

```text
ADDS_CONFIGURATION_INVALID
ADDS_CONNECT_FAILED
ADDS_TLS_VALIDATION_FAILED
ADDS_AUTHENTICATION_FAILED
ADDS_AUTHORIZATION_FAILED
ADDS_REFERRAL_UNSUPPORTED
ADDS_SEARCH_FAILED
ADDS_PAGING_FAILED
ADDS_ENTRY_INVALID
ADDS_LIMIT_EXCEEDED
ADDS_DEADLINE_EXCEEDED
ADDS_CANCELLED
```

Nenhum código incorpora endpoint, domínio, DN, principal ou mensagem do servidor.

## Configuração não secreta

O schema v1 contém somente:

```text
schemaVersion: 1
domainName
searchBaseDn?
endpoints[{ label, fqdn, port: 636 }]
authenticationMode: SIMPLE_BIND_LDAPS
bindPrincipal
pageSize
maxPages
maxObservations
connectionTimeoutMs
bindTimeoutMs
searchTimeoutMs
overallDeadlineMs
```

Domínio, FQDNs, porta, DN, modo, principal, paginação, limites e timeouts são validados antes de
qualquer conexão. Password nunca faz parte do schema.

## Propriedades de segurança

- transporte cifrado e validado, sem downgrade;
- destino explícito e outbound limitado;
- autenticação dedicada e menor privilégio;
- filtro estático e DN analisado, sem LDAP injection;
- referral chasing e expansão cross-domain desligados;
- material secreto apenas em memória e fora de observabilidade/persistência;
- coleta read-only, bounded, cancelável e fail-closed;
- payload/evidence estritamente allowlisted;
- AD DS e Entra ID separados por contrato.

## Ambiente controlado de teste

A implementação futura exige domínio AD DS dedicado de teste, um ou mais DCs test-only, LDAPS com
CA de teste instalada no trust store, conta read-only e fixtures conhecidas: computers habilitados e
desabilitados, renomeado/movido, volume maior que uma página, hostname ausente, nomes duplicados com
GUIDs diferentes e, quando viável, DC secundário para failover.

Testes obrigatórios cobrem: LDAPS válido; certificado inválido/hostname mismatch; falha de authn e
authz; múltiplas páginas/cookie; perda de DC e restart da página 1; dedupe do replay; cancelamento;
limites; disabled account; hostname ausente; rename/move com mesmo GUID; hostname duplicado com GUID
diferente; GUID/SID malformado; e redação de erro/segredo.

Nenhum domínio corporativo ou credencial produtiva participa dessa fase.

## First Production Credential Gate

Uma credencial produtiva só poderá existir após gate separado comprovar: source da credential,
rotação, escopo/menor privilégio, caminho de rede, trust chain, redação, domínio piloto, rollback e
owner operacional. O primeiro go-live será um piloto Dedicated; rollout amplo depende da experiência
operacional documentada desse piloto.

Neste ADR, production credentials = 0, production ConnectorDefinitions = 0 e go-live = `NOT YET`.

## Alternativas consideradas

- **Uma instance por forest/Global Catalog:** rejeitada no v1 por escopo cross-domain e identidade,
  autorização e paginação menos determinísticas.
- **DNS SRV automático:** adiado; endpoints explícitos mantêm allowlist de saída e failover
  reprodutível.
- **LDAP/389 ou StartTLS:** rejeitados no v1 para eliminar downgrade e variação de transporte.
- **SASL/Kerberos + CBT:** alternativa de segurança preferível para evolução, mas adiada pelos
  requisitos cross-platform, SPN/realm/keytab e suporte de runtime.
- **IP de DC:** rejeitado como identidade TLS primária por prejudicar hostname validation.
- **DN, hostname, sAMAccountName ou SID como identidade:** rejeitados por mutabilidade ou semântica;
  `objectGUID` é estável para rename/move.
- **DirSync/USN/tombstones:** adiados; v1 prova inventário completo paginado primeiro.
- **Entrada LDAP bruta/staging:** rejeitada por minimização, segurança e arquitetura evidence-first.

## Consequências

O desenho é deliberadamente estreito e operacionalmente explícito. Ele reduz cobertura funcional e
exige uma instance por domínio, configuração manual de DCs e trust store correto. Em troca, limita
blast radius, evita descoberta/downgrade implícitos, preserva identidade em renames e torna coleta,
failover, replay, auditoria e testes determinísticos.

A aceitação deste ADR não torna o connector implementado ou disponível ao usuário.

## Evolução futura

Após implementação e piloto controlado poderão ser avaliados Kerberos/SASL+CBT, DNS SRV, Global
Catalog, multi-domain orchestration, DirSync/USN, deleted objects, checkpoints persistentes,
atributos adicionais e outros tipos de objeto. Cada ampliação exige decisão explícita e testes de
segurança/operabilidade; nenhuma é capability implícita do v1.
