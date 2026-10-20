# Plano — caixa-db

Spec: docs/superpowers/specs/2026-10-20-noturno-onda2-design.md. Manifesto: docs/superpowers/lanes/2026-10-20-noturno-onda2.json. Risco dinheiro/migração/permissão/concorrência; executor Opus e revisão independente Opus SHA final.

## Posse
Migration e rollback não destrutivo dentro de20261252–20261261; primeira prevista20261252000000_o_caixa_preserva_a_intencao.sql (validar faixa antes). tests/banco/caixa-intencao-viva.cjs; scripts/publicacao/consultas/55a-conferir-intencao-do-caixa-aplicado.sql e55b-antes-intencao-do-caixa-base-vigente.sql; .github/workflows/rpc-ci.yml liberado EXCLUSIVAMENTE para integrar esta prova no workflow existente, sem mudar permissões/segredos/portões/timeout/tolerância. Não tocar nos demais passos.
Compartilhados fora dessa lista (database.types.ts, db-apply.cjs, conferir-banco.cjs, impressao-digital.sql, inventários de portas, AGENTS) → PEDIDOS precisos para integrador, não editar. Front/hook/folha são onda posterior.

## Etapa A — TDD remoto RED, parar na prova antes da implementação
1. Validar CWD ABSOLUTO/branch/HEAD esperado. Se divergir PARE ANTES de entrar. Cada PowerShell: Set-Location ABSOLUTO e comando na MESMA chamada ou git-C ABSOLUTO; nunca confiar em CWD de chamada anterior. Registrar faixa uma vez com frente.mjs entrar. Não apagar/refazer âncora.
2. Ler SQL vigente, contratos consumidores, padrão20261246 e harness efêmero/rodar-isolado. Escrever teste real com fixtures sintéticas e um modo explícito somente do instrumento que chama RPCs antigas e exige comportamento seguro (retryS1 não fechaS2; sangria retry uma transferência). RED NÃO pode ser import/função nova ausente/guard errado. O modo legado só seleciona função sob teste; não altera fonte/permite DB real.
3. Adicionar passo no RPC-CI existente, com mesma guarda !cancelled()+steps.aplica.success e clone isolado. Na etapaRED chamar modo legado e esperar job vermelho pelo defeito, sem continue-on-error. Não remover passos antigos. Não executar PG local/serviço ou teste de banco remoto de loja.
4. Conferir faixa e commitar APENAS teste+workflow pelos hooks/frente.mjs; devolver branch/SHA e comando de dispatch pro integrador. PARAR aqui até receber SAÍDA REAL do RED do CI. Executor não faz push/PR/workflow_dispatch, integrador conduz branch própria. Não declarar TDD se RED não rodou pelo motivo certo.

## Etapa B — só depois do RED observado
5. Implementar migration aditiva e consultas55a/b/rollback preservando tabela; nomes novos e contrato exato da spec Opus. Checar transação/ACL/RLS/NaN/colunas/FKdeferred/ONCONFLICT/ordem locks/replay e funções antigas byte/hash intactas. Não adicionar assinatura silenciosa ou corrigir outro bug financeiro de passagem.
6. Ampliar provas conforme spec: replay apósS2/status fechado/contrapartida inativa; payload/autor divergentes; admin atual42501 antesreplay; NaN/infinito/teto/140/500; chaves diferentes legítimas; duas conexões com bloqueio COMMIT/ROLLBACK e sessões diferentes; constraints/ACL; rollback preserva tabela/antigas. Mutantes devem cair nas asserções certas.
7. Trocar apenas seletor do passo de teste para contrato novo, mantendo controle legado explícito no teste sem mascarar bug. Conferir/commitar. Integrador roda CI GREEN no SHA final e colhe saída; falha volta ao mesmo executor com escopo. Revisão financeira independente Opus do SHA final após última mudança, não do plano.
8. Relatório final: SHA/worktree/branch, arquivos e comandos/RED/GREEN observados ou pendentes, dados existentes preservados, mutantes realmente mortos, PEDIDOS compartilhados/inventários/tiposgerados e limites clienteantigo. Sem push/merge/realDB/deploy. Última tarefa do integrador: diretor factual antes de promover qualquer entrega.
