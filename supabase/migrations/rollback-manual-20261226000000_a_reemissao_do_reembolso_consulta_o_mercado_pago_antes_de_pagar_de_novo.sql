-- ============================================================================
-- Rollback manual — a reemissão do reembolso consulta o Mercado Pago antes de pagar de novo
-- (20261226000000)
-- ============================================================================
-- APAGA o que a migration criou: as três funções (`registrar_diagnostico_do_estorno`,
-- `reemitir_reembolso_da_devolucao`, `admin_devolucao_reembolso_por_fora`) e a tabela
-- `order_refund_diagnostico`. Nenhuma função, tabela, coluna ou linha ANTIGA é tocada (a migration
-- não reescreveu nenhuma).
--
-- COM ELE: a edge não tem mais a reemissão segura nem a saída "Já devolvi por fora" por função
-- própria; o resto do dinheiro (concluir_estorno, cron, webhook, avisos da 20261225) segue igual.
--
-- DADOS: a tabela só guarda o diagnóstico de por que cada linha falhou. Apagá-la volta toda linha
-- `falhou` a "sem diagnóstico" = INCERTA (o lado seguro: nunca recebe chave nova). Mesmo assim o
-- apagamento de linhas é recusado (`ROLLBACK_PERDERIA_DADO`) enquanto a tabela tiver linha e o
-- operador não declarar, na MESMA sessão, `SELECT set_config('app.rollback_aceita_perder_diagnostico','sim',false);`
-- (antes: `CREATE TABLE order_refund_diagnostico_copia AS TABLE order_refund_diagnostico;` guarda uma cópia).
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se alguma função nova existir com corpo que não é o da migration
-- (uma redefinição posterior que ninguém revisou não se apaga) ou com sobrecarga, ou se a tabela tiver colunas
-- diferentes. A conferência final recusa se algum objeto ainda existir.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de
-- nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado (tudo `IF EXISTS`).
-- ============================================================================

DO $preflight_rollback_20261226$
DECLARE
  v_fn text;
  v_hash text;
BEGIN
  FOR v_fn, v_hash IN
    VALUES ('registrar_diagnostico_do_estorno', 'b8e4e28fbcd23a32dac0d18823b8aefe'),
           ('reemitir_reembolso_da_devolucao', '872fcb1d2bac9816e2d2b1c7c2e868c0'),
           ('admin_devolucao_reembolso_por_fora', '0a7e06d7004c3fb70897e87c4dfa8cf9')
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — revise antes de apagar.', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_fn
                  AND md5(replace(p.prosrc, E'\r', '')) <> v_hash) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% existe com um corpo que não é o da 20261226000000 — não se apaga o que ninguém revisou.', v_fn;
    END IF;
  END LOOP;
  IF to_regclass('public.order_refund_diagnostico') IS NOT NULL THEN
    IF (SELECT string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.column_name)
          FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = 'order_refund_diagnostico')
       IS DISTINCT FROM 'atualizado_em:timestamp with time zone,criado_em:timestamp with time zone,mp_codigo:text,post_incerto_em:timestamp with time zone,refund_id:uuid,transitorios:integer' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_diagnostico tem colunas diferentes das da 20261226000000 — revise antes de apagar.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_refund_diagnostico)
       AND COALESCE(current_setting('app.rollback_aceita_perder_diagnostico', true), '') <> 'sim' THEN
      RAISE EXCEPTION 'ROLLBACK_PERDERIA_DADO: order_refund_diagnostico tem linhas; guarde uma cópia e declare app.rollback_aceita_perder_diagnostico = sim na sessão para apagar.';
    END IF;
  END IF;
END $preflight_rollback_20261226$;

DROP FUNCTION IF EXISTS public.admin_devolucao_reembolso_por_fora(uuid, uuid);
DROP FUNCTION IF EXISTS public.reemitir_reembolso_da_devolucao(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.registrar_diagnostico_do_estorno(uuid, text, boolean, boolean);
DROP TABLE IF EXISTS public.order_refund_diagnostico;

DO $conferencia_rollback_20261226$
BEGIN
  IF to_regclass('public.order_refund_diagnostico') IS NOT NULL
     OR to_regprocedure('public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)') IS NOT NULL
     OR to_regprocedure('public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public.admin_devolucao_reembolso_por_fora(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'CONFERENCIA_ROLLBACK_20261226: algum objeto da migration ainda existe.';
  END IF;
END $conferencia_rollback_20261226$;
