-- ============================================================================
-- Rollback manual — repetir a devolução que falhou não paga duas vezes (20261399991000)
-- ============================================================================
-- Apaga a função `public.solicitar_estorno_repetindo(uuid, text)` e a tabela `public.order_refund_repeticao`: os DOIS
-- objetos eram NOVOS na migration, então desfazer é apagá-los; não há corpo anterior a restaurar (`solicitar_estorno`
-- e as demais funções nunca foram tocadas). Nenhum outro objeto muda.
--
-- COM ELE VOLTA O DEFEITO: o botão "Tentar de novo" (do front antigo) volta a criar uma linha nova a cada clique, e
-- duas abas na MESMA linha falhada podem mandar dois pedidos ao Mercado Pago. DESFAZER O FRONT ANTES: o front novo
-- chama a função e, sem ela, o botão falha com erro de função inexistente.
--
-- DADOS: nenhuma linha de order_refunds, devolucoes ou marketplace_orders é lida ou escrita. A tabela apagada é a
-- das marcas "esta falhada já foi repetida". POR ISSO ESTE ARQUIVO RECUSA (B1_BASELINE_DIVERGENT) se a tabela tiver
-- QUALQUER linha: apagar a marca reabriria a repetição de uma linha que já foi repetida (o dinheiro da repetição
-- pode estar a caminho do cliente). Quem decidir desfazer mesmo assim apaga as marcas à mão, sabendo disso.
--
-- PRÉ-VOO: recusa antes de apagar qualquer coisa se: a função existir com corpo diferente do da migration (alguém a
-- redefiniu: apagar levaria junto uma redefinição que ninguém revisou) ou com sobrecarga; a tabela existir com
-- colunas diferentes das da migration; a tabela tiver linha; ou outro objeto depender da função ou da tabela.
-- Estados aceitos: os dois objetos como desenhados, só a tabela (a função já foi tirada) ou nenhum (rodar de novo é
-- no-op). Conferência final: nenhum dos dois existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399991000$
DECLARE
  v_oid oid := to_regprocedure('public.solicitar_estorno_repetindo(uuid,text)');
  v_hash text;
  v_colunas text;
  v_marcas bigint;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_repetindo tem sobrecarga em public — revise antes de apagar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '018d9480bacfc4776b6f3424d303a3ee' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.solicitar_estorno_repetindo(uuid,text) (hash %) não é o da 20261399991000 — uma redefinição posterior está no ar; revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_repetindo existe em public com outra assinatura — revise antes de apagar.';
  END IF;

  IF to_regclass('public.order_refund_repeticao') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attname) INTO v_colunas
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.order_refund_repeticao') AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_colunas IS DISTINCT FROM 'created_at:timestamp with time zone,nova_refund_id:uuid,refund_id:uuid' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_repeticao tem colunas diferentes das da 20261399991000 (%) — revise antes de apagar.', COALESCE(v_colunas, 'ausente');
    END IF;
    EXECUTE 'SELECT count(*) FROM public.order_refund_repeticao' INTO v_marcas;
    IF v_marcas > 0 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refund_repeticao tem % marca(s) de "linha já repetida" — apagar reabriria a repetição de linha que já foi repetida (o dinheiro pode estar a caminho do cliente); não desfaça por este arquivo.', v_marcas;
    END IF;
    -- Ninguém mais pode depender da tabela (uma visão, uma função ou uma chave estrangeira de outro objeto).
    IF EXISTS (SELECT 1 FROM pg_depend d
                WHERE d.refobjid = to_regclass('public.order_refund_repeticao')
                  AND d.deptype = 'n' AND d.classid <> 'pg_constraint'::regclass) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: outro objeto passou a depender de public.order_refund_repeticao — revise antes de apagar.';
    END IF;
  END IF;
END $preflight_rollback_20261399991000$;

DROP FUNCTION IF EXISTS public.solicitar_estorno_repetindo(uuid, text);

DROP TABLE IF EXISTS public.order_refund_repeticao;

DO $conferencia_rollback_20261399991000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_repetindo') THEN
    RAISE EXCEPTION 'conferencia rollback 20261399991000: a função ainda existe';
  END IF;
  IF to_regclass('public.order_refund_repeticao') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261399991000: a tabela ainda existe';
  END IF;
END $conferencia_rollback_20261399991000$;
