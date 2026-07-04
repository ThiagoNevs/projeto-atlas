# Network Discovery Lite

## Objetivo

O Network Discovery Lite é a primeira base auditável para descoberta de ativos de rede no
Atlas. No MVP, ele permite configurar escopos privados, executar uma simulação controlada e
transformar os resultados em ativos, evidências e eventos de timeline.

Nenhum pacote de rede é enviado nesta versão. A simulação existe para validar o modelo de
dados, os controles de segurança, a experiência operacional e a integração com o inventário.

## Escopo funcional

- Criar, listar, consultar e atualizar perfis de descoberta.
- Definir CIDRs permitidos e negados.
- Limitar a execução a no máximo 60 observações por minuto.
- Executar até três observações determinísticas por rodada no ambiente de demonstração.
- Registrar execução, resultados, evidências `NETWORK_DISCOVERY`, ativos e timeline.
- Auditar cada execução em `AuditLog`.
- Reutilizar um ativo somente quando houver uma única correspondência por hostname, MAC ou IP.
- Criar `NETWORK_IDENTITY_CONFLICT` quando um IP aparecer associado a MACs distintos.

## Modos

- `PASSIVE`: representa uma futura coleta baseada em informações já observadas.
- `LIGHT`: representa uma descoberta leve, de baixo volume.
- `CONTROLLED`: representa uma execução explicitamente autorizada e escopada.

Os modos são valores técnicos da API. A interface apresenta seus nomes em português.
No MVP, os três modos documentam a intenção operacional do perfil, mas usam exatamente o
mesmo mecanismo seguro de simulação. Eles não ativam protocolos ou intensidades reais.

## Ciclo de execução e resultados

Os status disponíveis para uma execução são `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` e
`CANCELLED`. A execução manual atual é criada diretamente como `RUNNING`; `PENDING` e
`CANCELLED` deixam o modelo preparado para orquestração futura.

Resultados usam `DISCOVERED`, `UPDATED`, `SKIPPED` ou `ERROR`. Dados anteriormente registrados
como `CREATED` são preservados pela migration corretiva e passam a ser identificados como
`DISCOVERED`.

O registro principal da execução é criado antes da transação que processa ativos e evidências.
Se o processamento falhar, as alterações parciais são revertidas, mas a execução é preservada
como `FAILED`, com `finishedAt`, `errorCount`, resumo controlado e registro de auditoria.

## Métodos permitidos

- `ICMP_SIMULATED`
- `DNS_REVERSE_SIMULATED`
- `ARP_SIMULATED`

Apesar dos nomes, nenhum ICMP, DNS ou ARP real é executado no MVP. Eles identificam apenas a
origem conceitual do resultado simulado.

## Segurança por padrão

- `allowedCidrs` é obrigatório e não pode estar vazio.
- `0.0.0.0/0` é bloqueado.
- Somente redes privadas RFC1918 (`10.0.0.0/8`, `172.16.0.0/12` e `192.168.0.0/16`) são aceitas
  em `allowedCidrs`.
- CIDRs públicos são rejeitados antes da criação ou execução do perfil.
- CIDRs inválidos são rejeitados pela validação da API.
- CIDRs negados são removidos da geração de alvos.
- Perfis desabilitados não podem ser executados.
- Métodos fora da lista autorizada são rejeitados.
- O rate limit deve ficar entre 1 e 60.
- A execução local gera no máximo três resultados simulados.
- Não há armazenamento ou coleta de credenciais.
- Toda execução concluída gera registro de auditoria.
- Tentativas em perfil desabilitado, configurações inválidas e execuções com falha também geram
  registros de auditoria específicos.

## Identidade e prevenção de duplicidade

O Atlas procura correspondências exatas por hostname, MAC ou IP. A atualização automática só
acontece quando existe exatamente um candidato. Se houver ambiguidade, o sistema não mescla os
registros automaticamente; ele preserva uma identidade própria derivada do perfil e do MAC.

Um mesmo IP observado em outro MAC gera um conflito aberto do tipo
`NETWORK_IDENTITY_CONFLICT`, preparando a análise pelo Resolution Center.

## Limitações do MVP

Esta versão não possui:

- scan de portas;
- Nmap ou varredura agressiva;
- tentativas de login;
- SSH, WMI ou WinRM;
- brute force de comunidades SNMP;
- execução remota de comandos;
- descoberta automática de todas as interfaces locais;
- varredura de ambientes OT/IoT;
- agendamento ativo de execuções.

O agendamento já possui campos de configuração no modelo, mas nenhum scheduler é iniciado no
MVP. Quando `scheduleEnabled` é `true`, `scheduleExpression` é obrigatória, mas essa expressão
serve apenas para preparar uma integração futura e não dispara execuções automaticamente.

## Por que não há scan agressivo

Descoberta de rede pode causar carga, alertas de segurança ou impacto operacional quando feita
sem escopo e autorização. O Atlas começa pelo controle: escopo explícito, volume limitado,
simulação, rastreabilidade e decisão conservadora de identidade. Métodos reais só devem ser
adicionados posteriormente com autorização, proteção contra redes sensíveis, observabilidade e
limites operacionais testados.
