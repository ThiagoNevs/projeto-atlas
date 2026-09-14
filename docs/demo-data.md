# Massa de demonstração

O seed local do Atlas cria 15 ativos fictícios para demonstrações de infraestrutura,
segurança, suporte e sustentação. Todos os nomes, identificadores, endereços e decisões são
simulados. Os endereços pertencem exclusivamente às redes privadas `10.20.0.0/24`,
`10.30.0.0/24` e `172.16.10.0/24`.

## Executar

Com PostgreSQL disponível e migrations aplicadas, execute na raiz do monorepo:

```powershell
corepack pnpm db:seed
```

O comando pode ser repetido. Antes de recriar a massa, ele remove somente:

- ativos com `canonicalKey` iniciado por `atlas-demo:` e seus relacionamentos em cascata;
- auditorias criadas pela identidade técnica de seed `atlas-demo-seed` (fixture de demonstração, não
  identidade de usuário produtiva).

Dados criados manualmente, migrations e estrutura do banco não são removidos.

## Cenários

| #   | Ativo          | Demonstração                                                                           |
| --- | -------------- | -------------------------------------------------------------------------------------- |
| 1   | `NB-RH-001`    | Notebook em uso, recente, com confiança e qualidade altas.                             |
| 2   | `SRV-APP-01`   | Servidor com três evidências e eventos de descoberta e sincronização.                  |
| 3   | `VM-WEB-02`    | Máquina virtual renomeada, com hostname anterior preservado no histórico de atributos. |
| 4   | `SRV-DB-01`    | Servidor que mudou de IP; evidências preservam os snapshots anterior e atual.          |
| 5   | `NB-FIN-014`   | Notebook sem fabricante e número de série, com baixa qualidade dos dados.              |
| 6   | `NB-JUR-008`   | Ativo desativado que não voltou a aparecer.                                            |
| 7   | `NB-SUP-021`   | Ativo desativado que reapareceu e abriu conflito de ciclo de vida.                     |
| 8   | `NB-COM-007`   | Ativo perdido que reapareceu com impacto crítico.                                      |
| 9   | `WS-ENG-004`   | Estação descartada que reapareceu mais de uma vez.                                     |
| 10  | `NB-DIR-003`   | Ativo roubado com conflito em análise e decisão auditada.                              |
| 11  | `VM-LEGACY-01` | Ativo arquivado cujo conflito foi marcado como exceção justificada.                    |
| 12  | `NB-TI-009`    | Notebook em manutenção e operação degradada.                                           |
| 13  | `NB-EST-012`   | Notebook disponível em estoque.                                                        |
| 14  | `SW-ANDAR-03`  | Switch de acesso descoberto como ativo de infraestrutura.                              |
| 15  | `PRN-RH-02`    | Impressora de rede com confiança média e informações incompletas.                      |

## Roteiro sugerido

1. Abra `http://localhost:3000/assets` para comparar confiança, qualidade, estados e tipos.
2. Consulte `SRV-APP-01`, `VM-WEB-02` e `SRV-DB-01` para explorar evidências e timeline.
3. Abra `http://localhost:3000/conflicts` para comparar conflitos abertos, em análise e em
   exceção.
4. Consulte `NB-SUP-021`, `NB-COM-007` ou `WS-ENG-004` para ver o alerta de ciclo de vida.
5. Use o Resolution Center para testar a política que impede resolver um conflito enquanto o
   ativo continua administrativamente encerrado.
