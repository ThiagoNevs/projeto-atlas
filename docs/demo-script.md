# Roteiro de demonstração do Atlas

**Duração estimada:** 10 a 15 minutos.

**Objetivo:** apresentar o valor do Atlas para infraestrutura, segurança, suporte e sustentação,
sem confundir funcionalidades simuladas com capacidades produtivas.

## Preparação

Antes da reunião:

1. Inicie o PostgreSQL e as aplicações.
2. Aplique as migrations e execute o seed demo.
3. Confirme `/health`, `/assets`, `/conflicts` e `/network-discovery`.
4. Abra o frontend em janela anônima.
5. Deixe `SRV-APP-01`, `VM-WEB-02`, `NB-SUP-021` e `NB-DIR-003` fáceis de localizar.

## 1. O problema — 1 minuto

**Mensagem sugerida:**

> Empresas possuem inventários em múltiplas ferramentas, planilhas e fontes técnicas. O desafio
> não é apenas listar dispositivos, mas saber quais informações são atuais, de onde vieram, o
> que mudou e onde existe conflito entre realidade técnica e decisão administrativa.

Explique que ausência de evidência não é igual a inexistência, e que um cadastro administrativo
sozinho não prova o estado técnico do ativo.

## 2. Visão geral do Atlas — 1 minuto

Abra o dashboard na página inicial. Mostre os indicadores de ativos, qualidade, confiança e
conflitos; em seguida, destaque a saúde do inventário, a atividade recente e as ações
recomendadas. Na saúde do inventário, compare as famílias e versões de sistemas operacionais.
Apresente **Sinais de Atenção** e diferencie acompanhamento operacional de conflito. Destaque
sistemas operacionais obsoletos e ativos que deixaram de gerar evidência há mais de 45 dias.
Use os atalhos do dashboard para entrar no inventário e no Resolution Center.

Abra **Qualidade dos dados** para transformar os indicadores em ação. Mostre os ativos sem
sistema operacional, número de série ou rede, use uma prioridade e abra o detalhe de um ativo.
Explique que **Qualidade** e **Confiabilidade** são métricas diferentes: a primeira reflete
completude/recência/consistência dos dados, enquanto a segunda reflete confiança nas fontes e
evidências. Mostre os fatores positivos e negativos e destaque que o score é derivado, não é uma
decisão administrativa e não pode ser editado diretamente.
Use **Exportar CSV** para mostrar que a visão filtrada pode ser levada para análise operacional
fora do Atlas sem expor enums técnicos na planilha.

Em **Ativos**, use **Adicionar ativo** para explicar a declaração humana de um equipamento em
estoque ou isolado. Reforce que ela cria evidência, timeline e auditoria, mas não confirma estado
operacional até que uma fonte técnica observe o equipamento.

Use **Importar CSV** para mostrar a entrada em massa controlada. Explique que `hostname` e
`ipAddress` são obrigatórios, que o hostname é a identidade forte da importação e que IP repetido
vira aviso porque pode mudar ou ser reutilizado.

No detalhe de um ativo incompleto, use **Adicionar informação manual** para preencher um campo
ausente. Mostre a nova evidência e timeline e destaque que valores técnicos existentes não são
sobrescritos.

Abra **Fontes de Dados** para explicar que o Atlas não depende exclusivamente de conectores reais.
Mostre cadastro manual, importação CSV, enriquecimento manual e Network Discovery Lite como fontes
disponíveis, e posicione Microsoft, segurança, cloud e CMDB/ITSM como evolução planejada.

Apresente o Atlas como uma camada de inteligência que:

- consolida ativos;
- preserva evidências;
- constrói timeline;
- mede confiança e qualidade;
- identifica contradições;
- registra decisões auditáveis.

## 3. Inventário baseado em evidências — 1 a 2 minutos

Na listagem de ativos:

- destaque hostname, tipo e estados;
- compare confiança e qualidade;
- mostre contagens de evidências e eventos;
- explique que os 15 ativos são fictícios e reproduzíveis pelo seed.

Use `NB-FIN-014` para ilustrar dados incompletos e `SRV-APP-01` para um cadastro de alta
qualidade com múltiplas evidências.

## 4. Detalhe, evidências e timeline — 2 minutos

Abra `SRV-APP-01` ou `VM-WEB-02`.

Mostre:

- ID Atlas e identificação atual;
- estados operacional e administrativo;
- atributos normalizados;
- interfaces de rede;
- evidências brutas;
- timeline ordenada.

Em `VM-WEB-02`, explique como uma mudança de hostname gera histórico sem apagar o valor
anterior. Em `SRV-DB-01`, use a mudança de IP para ilustrar a evolução da interface.

## 5. Alteração administrativa auditável — 1 minuto

No detalhe de um ativo apropriado:

1. selecione um novo status administrativo;
2. preencha motivo e comentário;
3. salve a alteração;
4. mostre o evento criado na timeline.

Explique que a atualização do ativo, o evento e o `AuditLog` são tratados de forma transacional.
Informe que a identidade do ator ainda é simulada no MVP.

Abra **Auditoria** e localize a alteração por ação, entidade ou período. Expanda o registro para
mostrar valor anterior, valor novo, motivo, comentário e data da decisão.

## 6. Ativo encerrado que reaparece — 1 minuto

Abra `NB-SUP-021`, `NB-COM-007` ou `WS-ENG-004`.

Apresente a situação:

- administrativamente o ativo foi encerrado, perdido ou descartado;
- uma nova evidência técnica foi recebida;
- o Atlas não reativa o ativo automaticamente;
- um conflito de ciclo de vida é aberto para decisão humana.

Essa é a principal história de valor do MVP: evidência técnica contradizendo uma decisão
administrativa.

## 7. Resolution Center — 1 a 2 minutos

Abra `/conflicts`.

Mostre:

- busca e filtros;
- impacto, status e número de ocorrências;
- vínculo com o ativo;
- tratamento com motivo e comentário.

Explique que um conflito de ciclo de vida não pode ser marcado como resolvido enquanto o ativo
continua administrativamente encerrado. Nesse caso, as opções coerentes são investigar, ignorar
com justificativa ou registrar exceção.

## 8. Busca, filtros e paginação — 1 minuto

Volte para `/assets`.

Demonstre uma ou duas buscas:

- hostname como `SRV-APP-01`;
- tipo “Servidor”;
- confiança mínima;
- status administrativo;
- ordenação por última evidência ou qualidade.

Não gaste tempo passando por todos os controles; o objetivo é provar que o inventário é
operável, não apenas uma tabela estática.

## 9. Network Discovery Lite — 1 a 2 minutos

Abra `/network-discovery`.

Antes de executar, diga explicitamente:

> Esta versão é totalmente simulada. Nenhum ping, DNS, ARP, Nmap ou scan real é executado.

Mostre:

- perfil limitado a CIDR privado RFC1918;
- métodos simulados;
- rate limit;
- bloqueio de perfis desabilitados e configurações inseguras;
- execução e histórico;
- resultados ligados aos ativos;
- auditoria de conclusão, rejeição ou falha.

Explique que essa etapa valida o modelo seguro e auditável antes de qualquer Collector real.

## 10. Encerramento e roadmap — 1 minuto

Recapitule:

- inventário baseado em evidências;
- histórico em vez de fotografia estática;
- decisões administrativas auditáveis;
- conflitos que exigem tratamento humano;
- arquitetura preparada para conectores e Collector futuros.
- fontes de dados atuais e planejadas sem armazenar credenciais no MVP.

Apresente as próximas fases:

1. transformar o MVP em demo vendável;
2. adicionar autenticação, exportação de auditoria e testes frontend;
3. integrar fontes corporativas reais;
4. projetar Collector seguro;
5. evoluir para produto multi-tenant comercial.

Finalize reforçando que o Atlas atual comprova a lógica de produto, enquanto capacidades
produtivas e coleta real permanecem no roadmap.

## Plano alternativo

Se uma interação ao vivo falhar:

- use os ativos já carregados pelo seed;
- evite recriar o banco durante a apresentação;
- apresente o histórico existente em vez de executar nova ingestão;
- explique o Network Discovery pela execução já registrada;
- mantenha capturas das telas principais como contingência.
