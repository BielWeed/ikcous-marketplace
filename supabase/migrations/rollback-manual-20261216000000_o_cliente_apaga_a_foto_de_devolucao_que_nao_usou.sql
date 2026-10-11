-- Rollback manual da 20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql
-- Apaga a política de DELETE do cliente no bucket `devolucoes`: o cliente volta
-- a poder inserir e ler a própria pasta, mas não apagar nada (estado da
-- 20261175000000). Não toca em nenhum objeto já guardado. Sem BEGIN/COMMIT (regra
-- da casa); quem abre a transação é o aplicador. Idempotente.

DROP POLICY IF EXISTS devolucoes_cliente_delete_policy ON storage.objects;
