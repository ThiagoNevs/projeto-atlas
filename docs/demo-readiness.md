# Preparação para demonstração

## Estado atual

O Atlas já possui conteúdo suficiente para demonstrar o conceito de inteligência de ativos
baseada em evidências. O principal trabalho restante é tornar a apresentação previsível,
visualmente consistente e clara sobre os limites do MVP.

## Obrigatório antes da demo

### Ajustes mínimos de layout

- Validar inventário e conflitos nas dimensões da tela usada na apresentação.
- Confirmar que tabelas, filtros, badges e botões não ficam cortados.
- Verificar estados vazios, loading e erro.
- Conferir textos, acentuação, datas em BRT e labels em português.

### Dados demo

- Executar `corepack pnpm db:seed` antes da apresentação.
- Confirmar os 15 ativos e cinco conflitos esperados.
- Não usar dados, IPs ou identificadores reais de clientes.
- Evitar alterações improvisadas na massa imediatamente antes da demo.

### Fluxo de apresentação

- Selecionar previamente os ativos usados em cada história.
- Definir quais alterações administrativas serão feitas ao vivo.
- Preparar um conflito que possa ser movido para análise ou exceção.
- Criar antecipadamente um perfil privado para o Network Discovery Lite, se ele for executado.

### Validação visual

- Testar em janela anônima sem extensões.
- Fazer recarga completa e verificar o console.
- Validar as rotas `/assets`, `/assets/:id`, `/conflicts` e `/network-discovery`.
- Confirmar que API e PostgreSQL permanecem estáveis durante todo o roteiro.

### Roteiro da demo

- Ensaiar o roteiro de 10 a 15 minutos.
- Definir uma narrativa centrada no problema, não na tecnologia.
- Ter um caminho curto caso alguma interação ao vivo falhe.
- Preparar perguntas frequentes sobre fontes, segurança e discovery real.

### Mensagens claras de MVP e simulação

- Informar que não há conectores corporativos reais nesta versão.
- Informar que Network Discovery Lite não envia tráfego de rede.
- Não apresentar scores atuais como modelos estatísticos maduros.
- Explicar que autenticação, tenants e Collector pertencem ao roadmap.

## Desejável antes da demo

- Tela inicial mais comercial, com proposta de valor e casos de uso.
- Cards e gráficos executivos sobre cobertura, conflitos, qualidade e estados.
- Exportação CSV de ativos e conflitos.
- Tela dedicada de auditoria.
- Melhorias no Resolution Center: responsável, notas e histórico visual.
- Filtros extras e persistência dos filtros na URL.
- Documentação visual com capturas e arquitetura simplificada.
- Dados demo com narrativa por área: infraestrutura, segurança e suporte.
- Ambiente de demonstração empacotado e pré-validado.
- Testes E2E automatizados do frontend.

## Fora da demo

- Discovery real de rede.
- Conectores reais Microsoft, CMDB, ITSM ou SIEM.
- Collector instalado em infraestrutura externa.
- Autenticação corporativa completa.
- Multi-tenant produtivo.
- Alta disponibilidade e operação cloud em produção.
- Coleta ou demonstração com secrets reais.

## Checklist rápido

```text
[ ] Docker Desktop e PostgreSQL saudáveis
[ ] Migrations aplicadas
[ ] Seed demo recriado
[ ] API /health respondendo
[ ] Frontend aberto em janela anônima
[ ] Ativos e conflitos esperados presentes
[ ] Perfil de discovery privado preparado
[ ] Roteiro ensaiado
[ ] Mensagens de simulação revisadas
[ ] Plano alternativo preparado
```
