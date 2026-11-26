-- ROLLBACK COMUM da 20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql: o livro PARA de anotar.
-- Tira os 34 gatilhos tr_livro_* e a funcao public.livro_de_registro_anotar(), e desagenda o job limpar-livro-de-registro SO se ele
-- existir. PRESERVA as tabelas (public.livro_de_registro, _chave e _falhas) seladas com as linhas (RLS ligada, sem politica, sem grant) e
-- a funcao public.livro_de_registro_limpar() (sem EXECUTE para ninguem de aplicacao; o dono pode roda-la a mao para apagar o que passou
-- de 90 dias). Nenhuma linha das 17 tabelas e' lida ou alterada. Reaplicar a migration volta a anotar com as mesmas linhas e com a
-- chave como estava (reaplicar nao religa). Apagar as tabelas e' o rollback-manual-destrutivo-, so com o "pode" do dono.
--
-- DESLIGAR NA HORA nao precisa deste arquivo: UPDATE public.livro_de_registro_chave SET ligado = false, motivo = '...', mudado_em = now();
-- Este arquivo e' o "para sempre" (o que a migration seguinte copia, se o dono decidir tirar o livro).
--
-- LOCK das 17 em ACCESS EXCLUSIVE NOWAIT: DROP TRIGGER exige ACCESS EXCLUSIVE; NOWAIT faz o arquivo FALHAR NA HORA (55P03) se houver
-- qualquer leitura ou escrita em voo, em vez de entrar na fila e segurar a loja inteira atras dele. E' so rodar de novo (de madrugada).
-- Idempotente: DROP ... IF EXISTS; rodar duas vezes nao erra. Sem BEGIN/COMMIT: quem roda abre a transacao.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261510000000$
DECLARE
  v_tabela text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['marketplace_orders', 'marketplace_order_items', 'order_refunds',
                                  'marketplace_order_payment_history', 'devolucoes', 'devolucao_itens', 'produtos',
                                  'product_variants', 'categorias', 'coupons', 'fornecedores', 'fin_lancamentos', 'fin_contas',
                                  'fin_categorias', 'store_config', 'config_pagamento_cartao', 'politica_devolucao'] LOOP
    IF to_regclass('public.' || v_tabela) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta a tabela public.% (o rollback nao sabe desfazer um banco diferente).', v_tabela;
    END IF;
  END LOOP;
  -- Um gatilho tr_livro_* fora das 17 (ou usando outra funcao) e' estado que este arquivo nao conhece: recusa sem escrever.
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE NOT t.tgisinternal AND t.tgname IN ('tr_livro_alteracao', 'tr_livro_exclusao')
                AND (t.tgrelid NOT IN (SELECT to_regclass('public.' || x)::oid
                                         FROM unnest(ARRAY['marketplace_orders', 'marketplace_order_items', 'order_refunds',
                                                           'marketplace_order_payment_history', 'devolucoes', 'devolucao_itens',
                                                           'produtos', 'product_variants', 'categorias', 'coupons', 'fornecedores',
                                                           'fin_lancamentos', 'fin_contas', 'fin_categorias', 'store_config',
                                                           'config_pagamento_cartao', 'politica_devolucao']) AS x)
                     OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.livro_de_registro_anotar()')::oid)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ha gatilho tr_livro_* fora das 17 tabelas ou apontando para outra funcao.';
  END IF;
END $preflight_rollback_20261510000000$;

LOCK TABLE public.marketplace_orders, public.marketplace_order_items, public.order_refunds, public.marketplace_order_payment_history,
  public.devolucoes, public.devolucao_itens, public.produtos, public.product_variants, public.categorias, public.coupons,
  public.fornecedores, public.fin_lancamentos, public.fin_contas, public.fin_categorias, public.store_config,
  public.config_pagamento_cartao, public.politica_devolucao IN ACCESS EXCLUSIVE MODE NOWAIT;

DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.marketplace_orders;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.marketplace_orders;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.marketplace_order_items;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.marketplace_order_items;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.order_refunds;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.order_refunds;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.marketplace_order_payment_history;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.marketplace_order_payment_history;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.devolucoes;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.devolucoes;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.devolucao_itens;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.devolucao_itens;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.produtos;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.produtos;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.product_variants;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.product_variants;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.categorias;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.categorias;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.coupons;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.coupons;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.fornecedores;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.fornecedores;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.fin_lancamentos;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.fin_lancamentos;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.fin_contas;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.fin_contas;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.fin_categorias;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.fin_categorias;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.store_config;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.store_config;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.config_pagamento_cartao;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.config_pagamento_cartao;
DROP TRIGGER IF EXISTS tr_livro_alteracao ON public.politica_devolucao;
DROP TRIGGER IF EXISTS tr_livro_exclusao ON public.politica_devolucao;

-- Sem CASCADE: se algum gatilho que este arquivo nao conhece ainda usar a funcao, o Postgres recusa em vez de leva-lo junto.
DROP FUNCTION IF EXISTS public.livro_de_registro_anotar();

DO $desagenda_20261510000000$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpar-livro-de-registro') THEN
      PERFORM cron.unschedule('limpar-livro-de-registro');
    END IF;
  END IF;
END $desagenda_20261510000000$;

DO $posvoo_rollback_20261510000000$
BEGIN
  IF to_regprocedure('public.livro_de_registro_anotar()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE NOT t.tgisinternal AND t.tgname IN ('tr_livro_alteracao', 'tr_livro_exclusao')) THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261510000000: ficou gatilho ou funcao do livro.';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpar-livro-de-registro') THEN
      RAISE EXCEPTION 'POSVOO_ROLLBACK_20261510000000: o job limpar-livro-de-registro continua agendado.';
    END IF;
  END IF;
END $posvoo_rollback_20261510000000$;

NOTIFY pgrst, 'reload schema';
