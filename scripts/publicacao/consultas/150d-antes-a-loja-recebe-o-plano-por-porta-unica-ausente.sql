-- 150d-antes-a-loja-recebe-o-plano-por-porta-unica-ausente: ANTES da 20261399998000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo, rol fechado de 4 linhas.
-- Nao le nenhuma linha (nem o cartao da assinatura, nem a chave). Prova a AUSENCIA dos tres objetos novos e as premissas do pre-voo da migration: a tabela do cartao com a forma
-- da 20261177000000 (13 colunas), store_config com id bigint e store_name text, e os tres papeis de aplicacao.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_chave, assinatura_da_loja_definir_chave e assinatura_da_loja_gravar: ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.assinatura_da_loja_chave') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('assinatura_da_loja_definir_chave', 'assinatura_da_loja_gravar')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja tem a forma da 20261177000000 (13 colunas) e store_config tem id bigint e store_name text', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped)
       = 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false'
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'store_name' AND a.atttypid = 'text'::regtype AND a.attnum > 0 AND NOT a.attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.store_config') AND a.attname = 'id' AND a.atttypid = 'bigint'::regtype AND a.attnum > 0 AND NOT a.attisdropped) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'os papeis anon, authenticated e service_role existem', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
