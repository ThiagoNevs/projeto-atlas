# Princípios Arquiteturais do Projeto Atlas

## 1. Visão geral

Este documento define os princípios técnicos e arquiteturais que devem orientar a evolução do Projeto Atlas.

O Atlas é uma plataforma de inteligência de ativos baseada em evidências. Por isso, sua arquitetura deve priorizar:

- Segurança.
- Evidência.
- Auditabilidade.
- Histórico.
- Manutenibilidade.
- Escalabilidade gradual.
- Baixo acoplamento.
- Clareza de domínio.
- Evolução segura para produção.

Esses princípios devem ser considerados em novas funcionalidades, refatorações, integrações e decisões técnicas futuras.

---

## 2. Security by Design

O Atlas deve ser construído com segurança desde a concepção, não como uma camada adicionada no final.

Isso significa que cada funcionalidade deve considerar:

- Quais dados serão recebidos.
- Quais dados serão armazenados.
- Quais permissões serão necessárias.
- Quais ações serão auditadas.
- Quais riscos operacionais existem.
- Quais informações não devem ser expostas.
- Quais limites precisam ser impostos por padrão.

Segurança deve fazer parte do desenho da funcionalidade, da implementação, dos testes e da documentação.

---

## 3. Menor privilégio

O Atlas deve operar com o menor privilégio necessário.

No MVP, isso significa:

- Não executar ações destrutivas.
- Não alterar sistemas externos.
- Não executar comandos remotos.
- Não coletar secrets.
- Não fazer discovery real sem controle explícito.

Em versões futuras, conectores reais devem usar permissões mínimas.

Exemplos:

- Um conector de inventário deve ter permissão de leitura, não de administração.
- Um coletor de rede deve observar apenas os escopos autorizados.
- Integrações devem ser segmentadas por finalidade.

---

## 4. Read-only first

O Atlas deve priorizar observação antes de ação.

A primeira responsabilidade do produto é:

> Observar, registrar evidência, construir histórico e apoiar decisão humana.

O Atlas não deve:

- Desativar ativos automaticamente.
- Resolver conflitos automaticamente.
- Reativar ativos automaticamente.
- Executar scripts em máquinas.
- Alterar configurações de ferramentas externas sem fluxo explícito.

Esse princípio reduz risco operacional e aumenta confiança no produto.

---

## 5. Evidence-first

O Atlas deve ser orientado por evidências.

Nenhuma informação importante deve ser tratada como verdade absoluta sem fonte, data e contexto.

Sempre que possível, uma informação deve responder:

- Quem informou?
- Quando foi observado?
- Qual fonte reportou?
- Qual é o nível de confiança?
- Existe conflito com outra fonte?
- Esse dado é atual ou antigo?

Exemplo inadequado:

> Este ativo pertence ao usuário João.

Exemplo adequado:

> Último login observado: João. Fonte: Intune. Observado em 03/07/2026.

A diferença é importante porque o Atlas deve evitar conclusões frágeis sobre ownership, uso e responsabilidade.

---

## 6. Histórico preservado

O Atlas deve preservar histórico de mudanças relevantes.

Informações críticas não devem ser simplesmente sobrescritas sem rastreabilidade.

Exemplos de histórico que devem ser preservados:

- Hostname anterior.
- IP anterior.
- Status anterior.
- Status novo.
- Mudança de usuário observado.
- Mudança de fabricante/modelo.
- Evidências anteriores.
- Conflitos anteriores.
- Decisões administrativas.
- Comentários e motivos.

O histórico é essencial para auditoria, investigação e confiança no inventário.

---

## 7. Auditoria obrigatória

Toda ação administrativa relevante deve gerar auditoria.

Exemplos:

- Alteração de status administrativo.
- Tratamento de conflito.
- Marcação de exceção.
- Execução de Network Discovery.
- Rejeição de execução de Network Discovery.
- Falha em execução de Network Discovery.

Cada registro de auditoria deve conter, sempre que aplicável:

- Ator.
- Tipo de ator.
- Ação realizada.
- Entidade afetada.
- Valor anterior.
- Valor novo.
- Motivo.
- Comentário.
- Data/hora.
- Metadados relevantes.

No MVP, o ator pode ser simulado. Em produção, deve ser vinculado a um usuário autenticado.

---

## 8. Idempotência

Operações de ingestão devem ser idempotentes.

Isso significa que processar a mesma informação repetidamente não deve causar duplicações indevidas.

Uma nova ingestão pode gerar nova evidência, mas não deve duplicar:

- O mesmo ativo.
- O mesmo atributo atual.
- A mesma interface de rede.
- O mesmo conflito aberto.
- O mesmo evento de mudança quando nada mudou.

A timeline deve diferenciar:

- Ativo descoberto.
- Ativo sincronizado sem mudança.
- Ativo atualizado com mudança real.

Esse princípio é essencial para evitar inventário inflado e perda de confiança na plataforma.

---

## 9. Separação entre status operacional e administrativo

O Atlas deve manter separação clara entre status operacional e status administrativo.

### Status operacional

Representa evidência técnica.

Exemplos:

- Visto recentemente.
- Sem evidência recente.
- Provavelmente inativo.
- Fonte parou de reportar.
- Voltou a aparecer.

### Status administrativo

Representa decisão ou classificação da empresa.

Exemplos:

- Em uso.
- Em estoque.
- Em manutenção.
- Desativado.
- Descartado.
- Perdido.
- Roubado/Furtado.
- Arquivado.

Essa separação é um dos princípios centrais do produto.

Um ativo pode estar administrativamente desativado e, ainda assim, voltar a gerar evidência técnica. Nesse caso, o Atlas deve criar conflito, não reativar automaticamente.

---

## 10. Decisão humana sobre conflitos

O Atlas pode detectar inconsistências, mas não deve resolver conflitos automaticamente sem decisão humana.

Exemplo:

> Ativo descartado voltou a aparecer.

O sistema deve:

- Registrar evidência.
- Criar evento.
- Criar conflito.
- Exibir alerta.
- Sugerir ação.

Mas a decisão deve ser humana:

- Reativar o ativo.
- Manter em análise.
- Marcar como exceção.
- Ignorar com justificativa.
- Investigar com time responsável.

Essa abordagem evita automações perigosas e aumenta governança.

---

## 11. Modularidade

O sistema deve ser organizado por módulos de domínio.

Módulos atuais ou previstos:

- Assets.
- Evidences.
- Timeline.
- Conflicts.
- Audit.
- Network Discovery.
- Connectors.
- Auth.
- Users.
- Tenants.
- Reports.

Cada módulo deve ter responsabilidade clara.

Exemplo:

- O módulo de Assets gerencia ativos.
- O módulo de Conflicts gerencia conflitos.
- O módulo de Audit registra ações.
- O módulo de Network Discovery gerencia descoberta de rede.

Essa organização facilita manutenção, testes e evolução.

---

## 12. Baixo acoplamento

Os módulos devem evitar dependência excessiva entre si.

Quando um módulo precisar interagir com outro, deve fazê-lo por meio de serviços e contratos claros.

Evitar:

- Regras de negócio espalhadas.
- Acesso direto a modelos de outro domínio sem necessidade.
- Duplicação de lógica.
- Componentes que conhecem detalhes internos demais de outros módulos.

Preferir:

- Serviços de aplicação.
- DTOs bem definidos.
- Presenters.
- Mappers.
- Contratos claros.
- Eventos internos, quando fizer sentido no futuro.

---

## 13. Camada de domínio progressiva

O MVP pode começar simples, mas a arquitetura deve permitir uma camada de domínio mais forte no futuro.

À medida que o produto crescer, regras importantes devem ser concentradas em serviços ou objetos de domínio, evitando que a lógica fique espalhada em controllers, componentes ou queries.

Exemplos de regras que merecem centralização:

- Identificação de ativo.
- Cálculo de confiança.
- Qualidade dos dados.
- Detecção de conflitos.
- Resolução de conflitos.
- Regras de lifecycle.
- Regras de discovery.
- Regras de auditoria.

---

## 14. Validação no backend e frontend

A validação deve existir tanto no frontend quanto no backend.

### Frontend

Responsável por:

- Melhorar experiência do usuário.
- Evitar envio de dados claramente inválidos.
- Exibir mensagens amigáveis.
- Controlar estados de loading, erro, vazio e sucesso.

### Backend

Responsável por:

- Garantir integridade.
- Validar contratos.
- Bloquear entradas inválidas.
- Impedir ações proibidas.
- Proteger regras de negócio.
- Ser a fonte de verdade.

O backend nunca deve confiar apenas na validação do frontend.

---

## 15. Tratamento padronizado de erros

O Atlas deve tratar erros de forma segura e previsível.

Erros devem possuir:

- Código ou tipo.
- Mensagem compreensível.
- Status HTTP adequado.
- Contexto seguro.
- Request ID, futuramente.

O sistema não deve expor ao usuário final:

- Stack trace.
- Erros internos crus.
- Detalhes sensíveis do banco.
- Secrets.
- Tokens.
- Dados sigilosos.

Exemplo adequado:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "CIDR público não é permitido no MVP.",
  "statusCode": 400
}
```
