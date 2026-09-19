# ADR-013 — Autenticação de Service Actors

Status: Accepted

## Context

Connectors e outras integrações machine-to-machine não podem reutilizar identidade ou access token
humano. Confiar apenas na origem de rede, em um header declarado pelo caller ou em um identificador
textual sem autenticação permitiria ambiguidade entre atores, bypass de autorização e perda de
rastreabilidade.

O Atlas já atua como resource server para atores humanos: valida access tokens JWT emitidos por um
IdP confiável usando issuer, audience, algoritmos allowlisted e JWKS; deriva um `CurrentActor`; exige
o gate independente `atlas:access`; e aplica permissions explícitas com default-deny. O modelo de
atores e a auditoria já distinguem `HUMAN`, `SERVICE` e `SYSTEM`.

Service Actors precisam reutilizar essas fronteiras sem transformar a API, o PostgreSQL ou os logs
do Atlas em superfícies de armazenamento ou transporte da credencial privada do caller.

## Decision

Service Actors usarão OAuth 2.0 Client Credentials. O caller obtém do IdP confiável um access token
JWT de curta duração e o apresenta à API como bearer token. O Atlas permanece exclusivamente como
resource server: não emite tokens e não recebe nem valida diretamente o client secret, certificado
privado ou outra credencial usada pelo caller no token endpoint.

Quando o IdP suportar, a autenticação do client no token endpoint deve preferir um mecanismo
assimétrico, como `private_key_jwt`, em vez de shared secret. Essa preferência não altera a fronteira
da API: o Atlas recebe somente o access token emitido pelo IdP.

O access token de Service Actor seguirá o trust model JWT/JWKS existente e deverá validar, no mínimo:

- assinatura por chave publicada pelo IdP confiável;
- issuer e audience exatos;
- algoritmo explicitamente allowlisted;
- `exp`, `nbf` e `iat`;
- lifetime máximo configurado para tokens de serviço;
- client registration e subject compatíveis com uma allowlist explícita.

Identidades humanas e de serviço serão classificadas por registrations separadas e disjuntas. O
client humano configurado nunca produz `SERVICE`; somente uma registration machine-to-machine
explicitamente allowlisted pode produzi-lo. Uma claim fornecida pelo caller, como `kind=SERVICE`, não
participa da decisão. Registration desconhecida, ausente, sobreposta ou ambígua falha fechada.

Após a validação, a identidade será projetada como:

```text
kind:
SERVICE

id:
service:oidc:v1:<SHA-256 canônico de issuer + subject>
```

O identificador usa o mesmo contrato namespaced de `oidcActorId` e não expõe issuer, subject, client
ID ou claims brutas. A configuração poderá associar um nome operacional seguro à registration, mas
esse nome não substitui o ID estável.

Service Actors passam pelo mesmo `PermissionGuard` e pelo mesmo default-deny dos atores humanos. As
claims machine-to-machine terão mapping explícito e separado para permissions Atlas. Roles humanas
como Viewer, Analyst e Admin não concedem implicitamente permissions a `SERVICE`. Não existe bypass
por `SYSTEM`, Admin, origem de rede ou condição de caller interno.

O gate `atlas:access` permanece obrigatório e independente das demais permissions. Estar na allowlist
de registrations não concede esse gate implicitamente.

Operações auditadas persistirão a proveniência já suportada:

```text
actorType:
SERVICE

actorId:
<service:oidc:v1:...>
```

O contexto e os logs operacionais podem registrar somente `actorKind` e `actorId` seguros. Access
token, client credential, assertions privadas, locators de segredo e claims brutas não pertencem a
respostas, logs ou `AuditLog`.

A credencial privada pertence ao caller e ao IdP e é provisionada fora da API Atlas. O Atlas não a
persiste. `SecretReference != SecretMaterial` continua sendo uma fronteira obrigatória. Secret
scanning no CI deve existir antes da primeira credencial operacional de Service Actor.

## Alternatives Considered

- **API keys:** rejeitadas como desenho inicial por serem credenciais bearer tipicamente long-lived,
  com distribuição, escopo, rotação e revogação mais frágeis que tokens curtos emitidos pelo IdP.
- **Tokens humanos reutilizados:** rejeitados porque confundem autoria, ampliam privilégio e impedem
  lifecycle e revogação próprios do serviço.
- **JWTs de serviço autoemitidos diretamente para o Atlas:** rejeitados porque transfeririam para o
  Atlas responsabilidades de issuer, key distribution, rotação, replay e revogação já pertencentes ao
  IdP.
- **Confiança por localização de rede:** rejeitada porque rede interna não autentica principal nem
  autoriza operação.
- **Bypass por `SYSTEM` ou Admin:** rejeitado porque Service Actors devem permanecer sujeitos a
  permissions explícitas e least privilege.
- **mTLS como mecanismo inicial exclusivo:** não adotado por exigir PKI, terminação e propagação de
  identidade operacional ainda não definidas. Pode futuramente complementar ou vincular tokens.
- **DPoP:** não adotado inicialmente por ampliar o contrato de proof-of-possession e a operação de
  chaves do caller. Pode ser reconsiderado se replay de bearer token exigir mitigação adicional.
- **Token introspection:** não adotada inicialmente para evitar dependência síncrona do IdP em cada
  request. Pode ser considerada quando revogação imediata superar os benefícios da validação local.
- **Denylist de revogação:** não adotada inicialmente porque introduz estado, distribuição e limpeza
  sem eliminar a necessidade de tokens curtos.
- **Workload identity ou federation:** permanecem opções futuras para Cloud ou ambientes com suporte
  nativo, sem alterar a identidade lógica `SERVICE`.

## Consequences

- O fluxo machine-to-machine reutiliza JWT/JWKS, guards, permissions e auditoria existentes.
- HUMAN e SERVICE permanecem inequivocamente distintos mesmo quando compartilham issuer e audience.
- Cada principal de serviço precisa de registration, ownership, permissions, rotação e revogação
  operacionais explícitos.
- A API não precisa possuir a credencial privada do caller.
- A implementação pode permanecer sem persistência de Service Actors, credentials, roles ou
  permissions.
- Dedicated e Cloud podem usar formas diferentes de autenticar o client no IdP, mantendo o mesmo
  contrato de access token na API.

## Security / Operational Considerations

Bearer tokens podem ser reutilizados por quem obtiver seu valor até a expiração. TLS e tokens de
curta duração são obrigatórios. O lifetime máximo deve ser validado usando `iat` e `exp`; clock skew
deve permanecer limitado. Uma claim `jti`, isoladamente, não impede replay sem armazenamento e
coordenação de estado.

Desabilitar a registration ou rotacionar sua credencial impede a emissão de novos tokens, mas não
revoga imediatamente access tokens já emitidos. Eles permanecem válidos até `exp`. Introspection,
denylist, DPoP e tokens vinculados a mTLS exigem decisões futuras se revogação imediata ou
proof-of-possession se tornarem requisitos.

Mappings de serviço devem falhar no startup quando houver registrations duplicadas, sobreposição com
o client humano, permission desconhecida ou configuração ambígua. A autorização deve conceder apenas
o conjunto explícito necessário para o workload.

Tokens e credenciais nunca são persistidos, refletidos em erros ou copiados para logs. Rejeições de
autenticação e autorização pertencem à telemetria de segurança; operações privilegiadas concluídas
continuam usando `AuditLog` com o ator `SERVICE` confiável.

## Reconsider When

- O ambiente exigir revogação de access token antes de sua expiração.
- Replay exigir proof-of-possession ou token binding.
- Um deployment oferecer workload identity ou federation sem credencial estática.
- Multi-tenancy exigir scoping adicional por tenant ou recurso.
- O IdP não conseguir emitir claims machine-to-machine inequívocas e com lifetime limitado.
- Service Actors precisarem de lifecycle administrativo persistente no Atlas.

## Related Decisions

ADR-006, ADR-007, ADR-008, ADR-010, ADR-011, ADR-012 e ADR-016.
