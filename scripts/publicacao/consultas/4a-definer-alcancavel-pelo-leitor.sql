-- Funções SECURITY DEFINER, em QUALQUER schema (menos pg_catalog e
-- information_schema — sistema do próprio Postgres), que o papel
-- supabase_read_only_user consegue EXECUTAR. Se aparecer alguma linha, é
-- uma porta de escrita alcançável pelo caminho só-leitura: o papel não ter
-- grant de escrita numa tabela não impede uma função SECURITY DEFINER
-- concedida a PUBLIC de escrever por dentro dela — e isso vale em QUALQUER
-- schema, não só `public` (achado #3 da revisão de risco, rodada 3, ampliado
-- na rodada 4: uma definer em outro schema também escreve).
--
-- `provolatile = 'v'`: o Postgres RECUSA escrita dentro de função STABLE ou
-- IMMUTABLE (ex.: `forma_de_pagamento_aceita`, STABLE) — sem escrita
-- possível, sobrar na lista é ruído, não achado.
-- `prorettype NOT IN ('trigger', 'event_trigger')`: função de gatilho
-- (`handle_variant_atualiza_produto`, `marca_avaliacao_nasce_verificada`,
-- `marca_avaliacoes_do_pedido_verificadas`,
-- `notifica_cliente_de_mudanca_de_pagamento`,
-- `notifica_cliente_de_mudanca_de_status`) só executa quando o PRÓPRIO
-- gatilho dispara (UPDATE/INSERT na tabela dona) — `EXECUTE` direto por
-- `supabase_read_only_user` nem é uma chamada válida (`RETURNS trigger`),
-- então `has_function_privilege` nunca é o caminho de escrita real aqui.
-- Achado da rodada 5 (26/09/2026) — as duas guardas tiraram os 7 falsos
-- positivos medidos contra o schema do zero (Postgres efêmero).
--
-- Esperado: 0 linhas. Exceção CONHECIDA E ACEITA (revise se aparecer outra):
-- `public.get_segmented_push_count` — VOLATILE (por isso não é filtrada
-- pela guarda acima), mas só faz `SELECT count(*)` depois de barrar
-- `NOT public.is_admin()`; alcançável pelo papel de leitura só porque
-- ninguém revogou o EXECUTE default de PUBLIC dela, não porque ela escreva.
-- Se vier a linha "(supabase_read_only_user AUSENTE — resultado não vale)"
-- em vez disso, o papel não existe neste projeto e "0 linhas" NÃO PROVA
-- nada — rode de novo com o papel certo antes de confiar no resultado.
SELECT pronamespace::regnamespace || '.' || proname AS funcao
  FROM pg_proc
 WHERE pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
   AND prosecdef
   AND provolatile = 'v'
   AND prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
   AND has_function_privilege(to_regrole('supabase_read_only_user'), oid, 'EXECUTE')
UNION ALL
SELECT '(supabase_read_only_user AUSENTE — resultado não vale)' AS funcao
 WHERE to_regrole('supabase_read_only_user') IS NULL
 ORDER BY 1;
