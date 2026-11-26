-- ============================================================================
-- Rollback manual da 20261530000000 (a loja grande nao trava o balcao nem os avisos).
-- Derruba os TRES objetos que a migration criou e nada mais: a porta public.buscar_clientes_do_balcao(text, integer) e os indices
-- idx_produtos_data_cadastro_id e idx_order_history_status_criado. NADA e' redefinido: a migration so criou objetos novos (a
-- get_admin_customers_paged nunca foi tocada), entao nao ha corpo anterior para devolver.
-- DADOS: nenhuma linha e lida para fora, escrita ou apagada. Indice nao guarda dado (e' reconstruido do zero se a migration for
-- reaplicada) e a porta so lia.
-- ANTES DESTE ARQUIVO: o front que chama a porta nova tem de sair do ar (sem ela o balcao mostra a falha da busca de cliente; nao ha
-- atalho para a porta antiga, de proposito).
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem derrubar nada se um dos nomes estiver ocupado por OUTRO objeto (indice com
-- outra definicao ou em outra tabela, porta com outra assinatura ou outro corpo): derrubar pelo nome levaria junto o que nao e desta
-- migration. Ausente passa (rodar de novo, ja desfeito, e no-op).
-- LOCK: DROP INDEX pega ACCESS EXCLUSIVE na tabela ate o COMMIT (ate a leitura da vitrine espera uns instantes); PRIMEIRO produtos,
-- DEPOIS o historico, a mesma ordem de trava da migration e de quem grava. O lock_timeout de 5 s faz o rollback falhar em vez de
-- enfileirar a loja. Rode fora do horario de pico.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261530000000$
DECLARE
  v_indice record;
  v_def text;
BEGIN
  FOR v_indice IN
    SELECT * FROM (VALUES
      ('public.idx_produtos_data_cadastro_id', 'public.produtos', 'btree (data_cadastro DESC, id)'),
      ('public.idx_order_history_status_criado', 'public.marketplace_order_history', 'btree (new_status, created_at DESC)')
    ) AS t(indice, tabela, definicao)
  LOOP
    IF to_regclass(v_indice.indice) IS NOT NULL THEN
      SELECT substr(pg_get_indexdef(i.indexrelid), strpos(pg_get_indexdef(i.indexrelid), ' USING ') + 7)
        INTO v_def
        FROM pg_catalog.pg_index i
       WHERE i.indexrelid = to_regclass(v_indice.indice)
         AND i.indrelid = to_regclass(v_indice.tabela)
         AND NOT i.indisunique AND i.indnatts = 2 AND i.indnkeyatts = 2 AND i.indpred IS NULL AND i.indexprs IS NULL;
      IF v_def IS DISTINCT FROM v_indice.definicao THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe e nao e o indice da 20261530000000 (%); nada foi derrubado.', v_indice.indice, COALESCE(v_def, 'outra tabela ou outro tipo');
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_clientes_do_balcao'
                AND (pg_get_function_identity_arguments(p.oid) <> 'p_search text, p_limite integer'
                     OR md5(replace(p.prosrc, chr(13), '')) <> '953a50af8e8e14e8a271d9124364bbc0')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.buscar_clientes_do_balcao existe com outra assinatura ou outro corpo; nada foi derrubado.';
  END IF;
END $preflight_rollback_20261530000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de levar o objeto junto.
DROP FUNCTION IF EXISTS public.buscar_clientes_do_balcao(text, integer);
DROP INDEX IF EXISTS public.idx_produtos_data_cadastro_id;
DROP INDEX IF EXISTS public.idx_order_history_status_criado;

DO $posvoo_rollback_20261530000000$
BEGIN
  IF to_regclass('public.idx_produtos_data_cadastro_id') IS NOT NULL
     OR to_regclass('public.idx_order_history_status_criado') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'buscar_clientes_do_balcao') THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o rollback da 20261530000000 deixou objeto para tras.';
  END IF;
END $posvoo_rollback_20261530000000$;

NOTIFY pgrst, 'reload schema';
