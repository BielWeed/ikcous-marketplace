-- 196b-antes-a-loja-pausa-o-pedido-novo-ausente: ANTES da 20261600000000 (ou depois dos DOIS rollbacks dela: o comum sozinho deixa a tabela). SO LEITURA,
-- rol fechado de 8 linhas. Do catalogo: a AUSENCIA de tudo o que a migration cria (a tabela, as 5 funcoes e os 2 gatilhos) e as premissas do pre-voo dela
-- (marketplace_orders.canal e idempotency_key, store_config.manutencao, is_admin e is_admin_atual, o cartao com pausa_em da 20261590000000 e a tabela da
-- chave). De dado, so UMA contagem da loja: quantas linhas de store_config estao com manutencao = true HOJE. A loja em manutencao passa a RECUSAR pedido
-- online no apply (o gatilho novo): com ela "nao", parar e avisar o dono antes. Lida por to_jsonb, para nao errar sem a coluna. Nenhum pedido, cartao,
-- chave nem dado de pessoa e' lido; nenhuma funcao e' chamada.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'pausa_de_vendas: ainda NAO existe', 'sim', CASE WHEN to_regclass('public.pausa_de_vendas') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 5 funcoes da 20261600000000: nenhuma existe ainda (com qualquer assinatura)', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('data_da_pausa_de_vendas', 'marcar_suspensa_desde', 'motivo_da_loja_nao_aceitar_pedido', 'a_loja_aceita_pedido_novo', 'situacao_das_vendas_da_loja'))
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'os 2 gatilhos da 20261600000000: nenhum existe ainda', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('tr_a_loja_aceita_pedido_novo', 'tr_assinatura_marca_suspensa_desde'))
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'premissa: marketplace_orders.canal (text NOT NULL) e idempotency_key (uuid); store_config.manutencao (boolean NOT NULL)', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'canal'
              AND a.atttypid = 'text'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'idempotency_key'
              AND a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'manutencao'
              AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND a.attnum > 0 AND NOT a.attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'premissa: is_admin() e is_admin_atual() existem (20261197000000)', 'sim', CASE WHEN
    to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_admin_atual()') IS NOT NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'premissa: o cartao com as 14 colunas da 20261590000000 (com pausa_em) e a tabela da chave da 20261399998000', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped)
       = 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,pausa_em:date:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false'
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
           FROM pg_attribute a WHERE a.attrelid = to_regclass('public.assinatura_da_loja_chave') AND a.attnum > 0 AND NOT a.attisdropped)
       = 'chave_hash:text:true,criada_em:timestamp with time zone:true,id:smallint:true' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'store_config: nenhuma linha com manutencao = true hoje (se houver, a loja passa a recusar pedido online no apply: avisar o dono antes)', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.store_config s WHERE (to_jsonb(s) ->> 'manutencao') = 'true') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
