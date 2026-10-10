SELECT checagem, valor, esperado, COALESCE(valor = esperado, false) AS ok FROM (VALUES
  ('75 política padrão',          (SELECT concat_ws('/', prazo_arrependimento_dias, prazo_troca_dias, prazo_vicio_dias) FROM public.politica_devolucao), '7/30/90'),
  ('75 bucket privado',           (SELECT public::text FROM storage.buckets WHERE id = 'devolucoes'), 'false'),
  ('76 cartão nasce desligado',   (SELECT concat_ws('/', credito::text, debito::text, parcelas_max) FROM public.config_pagamento_cartao), 'false/false/1'),
  ('76 colunas do pedido',        (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marketplace_orders' AND column_name IN ('tentativas_de_pagamento', 'metodo_online', 'parcelas', 'estorno_manual_registrado_em')), '4'),
  ('76 gatilho do estorno ligado',(SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'tr_marca_estorno_direto_do_pedido'), 'O'),
  ('77 contas de sistema',        (SELECT count(*)::text FROM public.fin_contas WHERE sistema), '3'),
  ('77 categorias de sistema',    (SELECT count(*)::text FROM public.fin_categorias WHERE sistema), '23'),
  ('RLS nas 10 tabelas novas',    (SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity AND relname IN ('politica_devolucao', 'devolucoes', 'devolucao_itens', 'devolucao_eventos', 'config_pagamento_cartao', 'fin_contas', 'fin_categorias', 'fin_lancamentos', 'fin_caixa_sessoes', 'assinatura_da_loja')), '10'),
  ('app executa liberar_cobranca',has_function_privilege('authenticated', 'public.liberar_cobranca_do_pedido(uuid,text)', 'EXECUTE')::text, 'false'),
  ('anon lê updated_by do cartão',has_column_privilege('anon', 'public.config_pagamento_cartao', 'updated_by', 'SELECT')::text, 'false'),
  ('app grava assinatura',        has_table_privilege('authenticated', 'public.assinatura_da_loja', 'INSERT')::text, 'false'),
  ('app grava lançamento direto', has_table_privilege('authenticated', 'public.fin_lancamentos', 'INSERT')::text, 'false'),
  ('anon executa fin_dre',        has_function_privilege('anon', 'public.fin_dre(date,date)', 'EXECUTE')::text, 'false'),
  ('anon executa painel_inicio',  has_function_privilege('anon', 'public.painel_inicio()', 'EXECUTE')::text, 'false')
) AS c(checagem, valor, esperado)
ORDER BY ok, checagem;
