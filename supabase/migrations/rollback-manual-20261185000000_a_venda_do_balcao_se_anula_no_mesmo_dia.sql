-- ============================================================================
-- ROLLBACK MANUAL da 20261185000000 — a venda do balcão se anula no mesmo dia
-- ============================================================================
-- OBSOLETO: NÃO EXECUTAR ESTE ARQUIVO. Ele não atualiza o ledger nem recusa
-- anulações já feitas. Use exclusivamente scripts/sql/pix-84-85-revert.sql
-- pelo workflow rollback-pix-84-85.yml; a verificação deve aprovar o estado.
--
-- O QUE DESFAZ: só a criação de `public.anular_venda_presencial`. A função é
-- NOVA; desfazer é derrubar.
--
-- O QUE NÃO TOCA: as vendas JÁ anuladas continuam cancelled/estornado, com o
-- estoque devolvido e os históricos — são fatos, não configuração. Nenhum dado
-- é lido, escrito ou apagado aqui.
--
-- EFEITO COLATERAL: o botão "Anular venda" do painel passa a receber
-- 42883/PGRST202 e mostra que a anulação não está liberada.
--
-- IDEMPOTÊNCIA: `DROP FUNCTION IF EXISTS` com a assinatura completa. Sem
-- BEGIN/COMMIT (regra da casa).
--
-- VERIFICAÇÃO: SELECT count(*) FROM pg_proc WHERE proname = 'anular_venda_presencial';
--   -- esperado: 0.
-- ============================================================================

DO $$ BEGIN
  RAISE EXCEPTION 'Rollback manual obsoleto; use scripts/sql/pix-84-85-revert.sql';
END $$;
