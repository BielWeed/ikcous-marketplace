-- 195b-antes-a-loja-guarda-o-dia-da-pausa-do-teste-ausente: ANTES da 20261590000000 (ou depois dos DOIS rollbacks dela: o comum sozinho deixa a coluna). SO LEITURA,
-- somente catalogo, rol fechado de 4 linhas. Nao le nenhuma linha (nem o cartao, nem a chave) e nao chama funcao. Prova a AUSENCIA da coluna pausa_em (o cartao com as
-- 13 colunas da 20261177000000) e as premissas do pre-voo da migration: a porta com o corpo da 20261399998000 (md5 565f82...) e definir_chave intacta.
WITH fn AS (
  SELECT p.oid, p.proname, md5(replace(p.prosrc, chr(13), '')) AS h
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('assinatura_da_loja_gravar', 'assinatura_da_loja_definir_chave')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja.pausa_em: ainda NAO existe (o cartao tem as 13 colunas da 20261177000000)', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
       FROM pg_attribute a WHERE a.attrelid = to_regclass('public.assinatura_da_loja') AND a.attnum > 0 AND NOT a.attisdropped)
       = 'atualizado_em:timestamp with time zone:true,ciclo:text:true,gerenciar_url:text:false,id:smallint:true,inicio_em:date:false,observacao:text:false,plano:text:true,proxima_cobranca_em:date:false,recursos:text[]:true,status:text:true,suporte_whatsapp:text:false,teste_ate:date:false,valor_mensal:numeric(10,2):false' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_gravar: uma so, com o corpo da 20261399998000 (md5; a premissa do pre-voo)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_gravar') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_gravar' AND oid = to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)')
                  AND h = '565f82cb9a65ed96e4702db9d97bf0d6') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'assinatura_da_loja_definir_chave: intacta, com o corpo da 20261399998000 (md5)', 'sim', CASE WHEN
    (SELECT count(*) FROM fn WHERE proname = 'assinatura_da_loja_definir_chave') = 1
    AND EXISTS (SELECT 1 FROM fn WHERE proname = 'assinatura_da_loja_definir_chave' AND h = 'ee89c0e70e378fe0be0fc3c805567d56') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
