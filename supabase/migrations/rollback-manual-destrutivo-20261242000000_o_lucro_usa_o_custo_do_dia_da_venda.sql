-- ============================================================================
-- ROLLBACK DESTRUTIVO — SÓ COM O DONO — o custo do dia da venda (20261242000000)
-- ============================================================================
-- APAGA a tabela public.marketplace_order_item_custo e, com ela, o custo que cada venda tinha NO DIA. Esse dado
-- NÃO se reconstrói: o custo do produto muda e o de ontem se perde para sempre. Por isso este é o SEGUNDO
-- degrau do rollback e vive em arquivo à parte: o degrau comum
-- (rollback-manual-20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql) devolve os relatórios ao custo de
-- hoje e DEIXA a tabela. Só rode este arquivo depois de ter certeza de que o dado pode morrer — e com a
-- decisão do dono, por escrito.
--
-- TRAVAS (cada uma recusa sem gravar nada):
--   1. o degrau comum já rodou: a função do gatilho e o gatilho NÃO podem existir, e nenhuma função de public
--      pode citar a tabela (um corpo vivo que a lê quebraria);
--   2. confirmação explícita NA SESSÃO, antes de rodar este arquivo:
--          SET app.confirmo_apagar_o_custo_do_dia = 'APAGAR';
--      Sem ela, o arquivo para com CUSTO_DO_DIA_SO_COM_O_DONO. (No aplicar-migrations.yml não há como pôr essa
--      configuração: este arquivo é para o dono, num psql, com cópia dos registros guardada.)
--
-- Antes de apagar, para guardar o que existe (não é feito aqui):
--     \copy (SELECT * FROM public.marketplace_order_item_custo) TO 'custo-do-dia.csv' CSV HEADER
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa; localmente use `psql -1`). Rodar duas vezes deixa o mesmo
-- estado (DROP TABLE IF EXISTS).
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $destrutivo_20261242$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_o_custo_do_dia', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'CUSTO_DO_DIA_SO_COM_O_DONO: este arquivo apaga o custo que cada venda tinha no dia, e isso não se refaz. Só com o dono: rode antes SET app.confirmo_apagar_o_custo_do_dia = ''APAGAR'';';
  END IF;
  IF to_regprocedure('public.marketplace_order_item__guarda_o_custo_do_dia()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgname = 'tr_marketplace_order_items_guarda_o_custo_do_dia' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'CUSTO_DO_DIA_ROLLBACK_COMUM_PRIMEIRO: o gatilho ou a função dele ainda existem — rode antes o rollback-manual-20261242000000.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.prokind = 'f'
                AND p.prosrc LIKE '%marketplace_order_item_custo%') THEN
    RAISE EXCEPTION 'CUSTO_DO_DIA_ROLLBACK_COMUM_PRIMEIRO: uma função de public ainda cita marketplace_order_item_custo — devolva os corpos antes (rollback-manual-20261242000000).';
  END IF;
END $destrutivo_20261242$;

DROP TABLE IF EXISTS public.marketplace_order_item_custo;

DO $conferencia_destrutivo_20261242$
BEGIN
  IF to_regclass('public.marketplace_order_item_custo') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261242: a tabela ainda existe';
  END IF;
END $conferencia_destrutivo_20261242$;
