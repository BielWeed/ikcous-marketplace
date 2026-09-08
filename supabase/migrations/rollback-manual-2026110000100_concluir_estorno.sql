-- ROLLBACK MANUAL da migration 2026110000100_concluir_estorno.sql
-- (Task 3 da frente "estorno de dinheiro pelo app").
--
-- Desfaz o UNICO objeto que a migration cria: a RPC public.concluir_estorno.
-- Nao ha tabela nem coluna para remover (o ledger e' da 2026110000000).
--
-- O QUE FICA SE ESTE ROLLBACK RODAR SOZINHO: linhas concluidas e
-- valor_estornado ja' somados FICAM (dado real nao se apaga — regra da
-- casa); o que se perde e' a FUNCAO, e com ela os tres caminhos de
-- conclusao (edge, cron, webhook) passam a falhar. Rodar isto em vivo e'
-- decisao do dono, com o estado na mao.
--
-- SEM BEGIN/COMMIT (regra da casa: o ROLLBACK do script de prova
-- teria de valer).

DROP FUNCTION IF EXISTS public.concluir_estorno(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.concluir_estorno(uuid);
