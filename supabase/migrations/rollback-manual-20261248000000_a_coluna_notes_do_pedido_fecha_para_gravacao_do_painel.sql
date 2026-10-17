-- ============================================================================
-- Rollback manual — a coluna notes do pedido fecha para a gravação do painel (20261248000000)
-- ============================================================================
-- REABRE A PORTA: devolve `GRANT UPDATE (notes) ON marketplace_orders TO authenticated`, o estado em
-- que a 20261060000000 deixou a coluna. Com ele, um painel ANTIGO volta a poder gravar a anotação
-- interna em notes — e ela volta a chegar ao celular da cliente. Use só se o fechamento quebrou um
-- caminho legítimo que ninguém mediu, e prefira a correção do caminho a manter a porta aberta.
--
-- DADOS: nenhuma linha é lida, reescrita ou apagada, nem pela migration nem aqui; só privilégio.
-- O GRANT é de COLUNA (não de tabela): tracking_code, status, pagamento etc. ficam como estão.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se marketplace_orders ou as colunas notes/tracking_code
-- não existem, ou se anon/PUBLIC têm UPDATE de tabela inteira ou de coluna — reabrir a coluna por cima
-- de uma ACL que ninguém mediu abriria mais do que o estado de antes. Rodar duas vezes deixa o mesmo
-- estado (GRANT repetível).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa; quem abre a transação é o aplicador.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261248$
DECLARE
  v_t oid := to_regclass('public.marketplace_orders');
  v_anon oid := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
BEGIN
  IF v_anon IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papéis anon ou authenticated.';
  END IF;
  IF v_t IS NULL OR NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = v_t), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders ausente.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = v_t AND attname IN ('notes', 'tracking_code') AND attnum > 0 AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders sem a coluna notes ou tracking_code.';
  END IF;
  IF has_table_privilege('anon', v_t, 'UPDATE')
     OR EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                 WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
                   AND g.privilege_type = 'UPDATE' AND g.grantee IN (0, v_anon)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: anon ou PUBLIC têm UPDATE em marketplace_orders — meça a loja antes de reabrir a coluna.';
  END IF;
END $preflight_rollback_20261248$;

GRANT UPDATE (notes) ON TABLE public.marketplace_orders TO authenticated;

DO $conferencia_rollback_20261248$
DECLARE
  v_t oid := to_regclass('public.marketplace_orders');
BEGIN
  IF NOT has_column_privilege('authenticated', v_t, 'notes', 'UPDATE')
     OR NOT has_column_privilege('authenticated', v_t, 'tracking_code', 'UPDATE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261248: authenticated sem UPDATE em notes ou tracking_code';
  END IF;
  IF has_column_privilege('anon', v_t, 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261248: anon atualiza notes — o estado de antes não tinha isso';
  END IF;
END $conferencia_rollback_20261248$;
