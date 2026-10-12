-- 9a — PROVA, por OBJETO, de que as migrations 20261160..20261166 já estão no banco
-- (efeito VIVO) — o que o ledger `supabase_migrations.schema_migrations` da CAF
-- não registra desde o achado de 21/09 (o ledger salta de 20261150 para 20261167).
-- SÓ LEITURA, um único SELECT, só catálogo: nenhuma linha de cliente, e NEM O
-- LEDGER — a forma do ledger NÃO é desta consulta (ver "O LEDGER" abaixo).
--
-- Saída: item | esperado | vivo | ok, com as linhas ok = false primeiro. Toda
-- linha imprime o valor VIVO.
--
-- ORDEM (D3): rode a 8e da CAF (POSITIVA; e o backfill 92-202, se faltar) ANTES
-- desta. Os corpos das funções redefinidas depois (abaixo) só batem se a 92..202
-- está no banco.
--
-- COMO LER (a faixa NUNCA se reaplica — reaplicar é regressivo e destrutivo: a 63
-- faz `DROP FUNCTION` e recria o corpo ANTIGO; a 62/65 também devolvem corpo velho;
-- a 66 apaga duplicados e faz ADD CONSTRAINT/CREATE INDEX/CREATE TRIGGER sem
-- IF NOT EXISTS):
--   * POSITIVA (todas as linhas ok = true) = os objetos já estão lá e só falta o
--     REGISTRO: o único passo é o backfill do ledger (gravar_ledger = 60-66), que
--     refaz esta consulta e confere a forma do ledger antes de gravar.
--   * NEGATIVA (qualquer linha ok = false) = PARAR. Nada se aplica. O que faltar
--     vira migration NOVA para a frente, só com o objeto ausente.
--
-- O LEDGER: esta consulta dá a MESMA resposta antes e depois do backfill (não o
-- olha). A forma do ledger (150 e 167 presentes, 0 de 7 / 7 de 7 / outra) é lida e
-- conferida pelo `rodarLedger` do conferir-banco.cjs, que também grava com um
-- INSERT guardado e relê para conferir. "7 de 7" é o estado explícito "já
-- registrado: nada a gravar", nunca uma prova negativa.
--
-- O QUE ESTA CONSULTA PROVA DA 60..66, E O QUE NÃO PROVA (D1/D3):
--   * A EVIDÊNCIA da faixa são os OBJETOS e a ESTRUTURA, não os corpos:
--       - 60/66: colunas `codigo_barras` (produtos, product_variants e as duas
--         vistas, com as colunas na ordem), `marketplace_orders.canal` (tipo,
--         NOT NULL, default), `vendedor_id` (tipo e FK para auth.users), os dois
--         índices únicos parciais, o índice do balcão, o default 0 de
--         `store_config.free_shipping_min`, a UNIQUE (colunas na ordem) e o índice
--         do cache, o CHECK do canal, o gatilho do cache e o GRANT de coluna
--         `codigo_barras` ao authenticated;
--       - 61..64: o que só elas deixam é a ACL (REVOKE/GRANT) de
--         `buscar_por_codigo_barras`, `registrar_venda_presencial`,
--         `get_admin_orders_paged` e `get_admin_orders_cancelados_recentes`
--         (EXECUTE por anon/authenticated/service_role e NENHUM grantee PUBLIC,
--         lido de aclexplode(proacl), proacl NULL conta como PUBLIC) e o DROP do
--         overload de 7 argumentos da 63: UMA só `get_admin_orders_paged`, de 8
--         argumentos, e uma só sobrecarga de cada função tratada.
--   * Os CORPOS (`prosrc`, sem o retorno de carro (CR), md5) são os da migration MAIS NOVA da árvore
--     que define cada função. Isso verifica o ESTADO ATUAL exigido para a release
--     presente; NÃO é evidência das migrations 62..64 — quatro delas
--     (registrar_venda_presencial, get_admin_orders_paged,
--     get_admin_orders_cancelados_recentes e upsert_store_config) foram
--     redefinidas na 20261199 e o corpo vivo prova a 99; a evidência de 62..64 é a
--     ACL e o overload acima. tests/ci_conferir_banco_test.ts recalcula cada md5 a
--     partir dos arquivos desta árvore: uma migration futura que redefina uma delas
--     QUEBRA o CI e obriga a atualizar esta consulta no mesmo PR.
--   * Comparação por IGUALDADE EXATA, sem parser de prefixo nem coleta de literais:
--       - gatilho por tgrelid + tgfoid + tgtype + tgenabled; índice por indrelid +
--         indisunique + indisvalid + indisready + indnullsnotdistinct + colunas
--         (pg_attribute, na ordem) + collation/opclass de cada coluna COM O SCHEMA (um
--         `public."default"` não passa por `pg_catalog.default`) + o PREDICADO
--         por pg_get_expr; restrição por conrelid + contype + convalidated +
--         condeferrable + condeferred + colunas (conkey, na ordem); a FK ainda por
--         confupdtype + confmatchtype + confdeltype. UNIQUE adiável quebra o
--         ON CONFLICT do upsert da edge calculate-shipping, por isso entra;
--       - METADADOS de cada uma das 7 funções (item `atributos <fn>`): SECURITY
--         DEFINER/INVOKER, `proconfig` (o search_path exato), volatilidade, STRICT,
--         dono, argumentos de identidade, retorno e linguagem. O corpo igual com o
--         `SET search_path` removido (ou DEFINER trocado por INVOKER) é POSITIVA
--         falsa se só o corpo for conferido. O DONO é exatamente `postgres`, medido
--         SÓ localmente (nenhuma migration o define): se o dono na CAF for outro, a
--         consulta sai NEGATIVA e para o backfill em vez de esconder a divergência —
--         não há normalização nem exceção por ambiente;
--       - o GRANT de coluna: `aclexplode(attacl)` dá SELECT em `codigo_barras` ao
--         authenticated E o `relacl` da tabela NÃO dá SELECT ao authenticated nem a
--         PUBLIC, e `has_table_privilege` também dá falso (pega o SELECT HERDADO de
--         outro papel); um GRANT de tabela exporia `custo` e as demais colunas.
--         RISCO RESIDUAL declarado: a consulta NÃO lê GRANT de coluna das OUTRAS
--         colunas (ex.: `custo`) nem papéis que não sejam o authenticated;
--       - o CHECK do canal: o pg_get_constraintdef (espaços normalizados) tem de ser
--         IGUAL a uma forma de uma lista FECHADA (hoje uma só, a medida no PG 17);
--         qualquer outra expressão (`... OR true`, `... AND false`, terceiro valor,
--         valor faltando) reprova;
--       - defaults: o pg_get_expr(adbin) tem de ser IGUAL a um dos textos da lista
--         FECHADA de constantes equivalentes (`0`, `(0)::numeric`, `0.00`,
--         `(0)::numeric(10,2)`, `'online'::text`); expressão composta
--         (`0 + 100`, `'online'::text || 'x'`) reprova;
--       - vistas: colunas na ordem, opções (check_option) E o md5 do
--         pg_get_viewdef(oid, true) com `public.` removido e espaços normalizados,
--         igual ao da definição da árvore final (medido no PG efêmero depois de
--         aplicar a árvore inteira). Pega a coluna `codigo_barras` trocada por NULL
--         e o filtro (`WHERE`) alterado.
--   * LIMITE DECLARADO: a prova é do Postgres 17 LOCAL (tests/banco/lote-60-66-viva.cjs);
--     a versão e o papel de leitura reais da CAF não foram medidos. O deparse
--     (pg_get_constraintdef, pg_get_expr, pg_get_viewdef) varia com a versão do
--     servidor: se divergir, a consulta FALHA FECHADO — vira NEGATIVA (PARAR e olhar
--     o vivo), nunca uma POSITIVA falsa. `indnullsnotdistinct` exige PG 15 ou mais:
--     em servidor mais velho a consulta ERRA (também fecha). Fica de fora a política inteira de RLS e a
--     ACL das demais funções (o pós-voo da migration dona já afirma isso dentro da
--     transação).
WITH corpos AS (
  SELECT p.proname,
         string_agg(md5(replace(p.prosrc, E'\r', '')), ',' ORDER BY md5(replace(p.prosrc, E'\r', ''))) AS h
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
   GROUP BY p.proname
), final(fn, h) AS (VALUES
    ('buscar_por_codigo_barras', '8762faab7f7efaf4bfd183499408d8df'),
    ('get_admin_orders_cancelados_recentes', '99a9e4cb232aef020bf297ddcd1901f0'),
    ('get_admin_orders_paged', '5861dbbe0e9c007a4196f5308c17d763'),
    ('get_product_recommendations', '3de5b27cc17c31301249861b7921a6fe'),
    ('limpar_cotacoes_fora_da_janela', '4d398faddf7d697d539a77b8fd04d8ba'),
    ('registrar_venda_presencial', '6a421904a7c99a0e17ca58f2f891c71d'),
    ('upsert_store_config', '9c56a9c6953e1d774a1ee97d5d8a7e16')
), acls(fn, esperado) AS (VALUES
    ('buscar_por_codigo_barras', 'anon=false authenticated=true service_role=true public=nao'),
    ('get_admin_orders_cancelados_recentes', 'anon=false authenticated=true service_role=true public=nao'),
    ('get_admin_orders_paged', 'anon=false authenticated=true service_role=true public=nao'),
    ('registrar_venda_presencial', 'anon=false authenticated=true service_role=false public=nao')
), atributos_esperados(fn, esperado) AS (VALUES
    -- METADADOS de cada função (não só o corpo): SECURITY DEFINER/INVOKER, config
    -- (o search_path exato), volatilidade, STRICT, dono, argumentos e retorno. Um
    -- CREATE OR REPLACE que mantém o prosrc e tira `SET search_path` (ou troca
    -- DEFINER por INVOKER) deixaria o corpo igual e a função insegura. Valores
    -- medidos no PG 17 efêmero depois da árvore inteira; tests/ci_conferir_banco_test.ts
    -- os cruza com o cabeçalho da migration MAIS NOVA que define cada função.
    -- O dono (postgres) não vem de migration nenhuma: é o papel que roda o apply.
    ('buscar_por_codigo_barras', 'secdef=true config=search_path=pg_catalog, pg_temp volatil=s strict=false dono=postgres args=p_codigo text retorno=jsonb lang=plpgsql'),
    ('get_admin_orders_cancelados_recentes', 'secdef=true config=search_path=public, extensions volatil=v strict=false dono=postgres args=p_dias integer, p_page integer, p_page_size integer retorno=jsonb lang=plpgsql'),
    ('get_admin_orders_paged', 'secdef=true config=search_path=public, extensions volatil=v strict=false dono=postgres args=p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text retorno=jsonb lang=plpgsql'),
    ('get_product_recommendations', 'secdef=true config=search_path=public volatil=v strict=false dono=postgres args=p_product_id uuid, p_limit integer retorno=SETOF produtos lang=plpgsql'),
    ('limpar_cotacoes_fora_da_janela', 'secdef=false config=(nenhum) volatil=v strict=false dono=postgres args= retorno=trigger lang=plpgsql'),
    ('registrar_venda_presencial', 'secdef=true config=search_path=pg_catalog, pg_temp volatil=v strict=false dono=postgres args=p_itens jsonb, p_pagamento text, p_cliente_user_id uuid, p_cliente_nome text, p_cliente_whatsapp text, p_desconto numeric, p_observacao text, p_idempotency_key uuid retorno=jsonb lang=plpgsql'),
    ('upsert_store_config', 'secdef=true config=search_path=public volatil=v strict=false dono=postgres args=config_json jsonb retorno=jsonb lang=plpgsql')
), defaults_aceitos(expr, canonico) AS (VALUES
    -- Lista FECHADA de deparses (pg_get_expr) de defaults CONSTANTES equivalentes,
    -- medidos no PG 17 local. Igualdade EXATA do texto: expressão composta
    -- (`0 + 100`, `'online'::text || 'x'`) nunca entra aqui e reprova.
    ('0', '0'),
    ('(0)::numeric', '0'),
    ('0.00', '0'),
    ('(0)::numeric(10,2)', '0'),
    ('''online''::text', 'online')
), colunas_vivas AS (
  SELECT c.relname AS tabela, a.attname AS coluna,
         'tipo=' || format_type(a.atttypid, a.atttypmod)
           || ' notnull=' || a.attnotnull::text
           || ' padrao=' || CASE
                WHEN d.adbin IS NULL THEN '(nenhum)'
                ELSE COALESCE((SELECT k.canonico FROM defaults_aceitos k WHERE k.expr = pg_get_expr(d.adbin, d.adrelid)),
                              'expr:' || pg_get_expr(d.adbin, d.adrelid)) END AS def,
         CASE
           WHEN d.adbin IS NULL THEN '(nenhum)'
           ELSE COALESCE((SELECT k.canonico FROM defaults_aceitos k WHERE k.expr = pg_get_expr(d.adbin, d.adrelid)),
                         'expr:' || pg_get_expr(d.adbin, d.adrelid)) END AS padrao
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE ns.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
), colunas(tabela, coluna, esperado) AS (VALUES
    ('produtos', 'codigo_barras', 'tipo=text notnull=false padrao=(nenhum)'),
    ('product_variants', 'codigo_barras', 'tipo=text notnull=false padrao=(nenhum)'),
    ('marketplace_orders', 'canal', 'tipo=text notnull=true padrao=online'),
    ('marketplace_orders', 'vendedor_id', 'tipo=uuid notnull=false padrao=(nenhum)')
), vistas_vivas AS (
  SELECT c.relname AS vista,
         (SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
            FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
         COALESCE(array_to_string(c.reloptions, ','), '(nenhuma)') AS opcoes,
         md5(regexp_replace(regexp_replace(pg_get_viewdef(c.oid, true), 'public[.]', '', 'g'), '\s+', ' ', 'g')) AS definicao
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'v'
), vistas(vista, colunas, opcoes, definicao) AS (VALUES
    ('vw_produtos_public',
     'id,nome,descricao,preco_venda,preco_original,estoque,imagem_url,imagem_urls,categoria,ativo,data_cadastro,tags,meta_title,meta_description,is_bestseller,frete_gratis,sold,calculated_points,codigo,ultima_atualizacao,rating,review_count,peso_kg,largura_cm,altura_cm,comprimento_cm,codigo_barras',
     '(nenhuma)', '3cdde92a1bc457879a210c59e023be20'),
    ('vw_produtos_admin',
     'id,nome,descricao,categoria,codigo,custo,preco_venda,estoque,estoque_minimo,fornecedor_id,ativo,tags,data_cadastro,ultima_atualizacao,imagem_url,meta_title,meta_description,imagem_urls,preco_original,is_bestseller,frete_gratis,sold,deleted_at,calculated_points,rating,review_count,peso_kg,largura_cm,altura_cm,comprimento_cm,codigo_barras',
     'check_option=cascaded', '2912f1cb227cd8fac3c2d2c09c06e945')
), indices_vivos AS (
  SELECT x.relname AS nome, t.relname AS tabela,
         'tabela=' || t.relname || ' metodo=' || am.amname
           || ' unico=' || i.indisunique::text
           || ' valido=' || i.indisvalid::text
           || ' pronto=' || i.indisready::text
           || ' nulls_not_distinct=' || i.indnullsnotdistinct::text
           || ' colunas=' || COALESCE((SELECT string_agg(COALESCE(a.attname, '(expressao)')
                                                         || CASE WHEN (i.indoption[u.ord - 1] & 1) = 1 THEN ' DESC' ELSE '' END,
                                                         ',' ORDER BY u.ord)
                                         FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS u(attnum, ord)
                                         LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = u.attnum), '')
           || ' classes=' || COALESCE((SELECT string_agg(COALESCE(cn.nspname || '.' || co.collname, '-') || '/' || ocn.nspname || '.' || oc.opcname, ',' ORDER BY w.ord)
                                         FROM unnest(i.indcollation::oid[], i.indclass::oid[]) WITH ORDINALITY AS w(coll, opc, ord)
                                         LEFT JOIN pg_collation co ON co.oid = w.coll
                                         LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
                                         JOIN pg_opclass oc ON oc.oid = w.opc
                                         JOIN pg_namespace ocn ON ocn.oid = oc.opcnamespace), '')
           || ' predicado=' || COALESCE(pg_get_expr(i.indpred, i.indrelid), '(nenhum)') AS def
    FROM pg_index i
    JOIN pg_class x ON x.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_am am ON am.oid = x.relam
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
   WHERE ns.nspname = 'public'
), indices(nome, tabela, esperado) AS (VALUES
    ('produtos_codigo_barras_unico', 'produtos', 'tabela=produtos metodo=btree unico=true valido=true pronto=true nulls_not_distinct=false colunas=codigo_barras classes=pg_catalog.default/pg_catalog.text_ops predicado=((codigo_barras IS NOT NULL) AND (deleted_at IS NULL))'),
    ('product_variants_codigo_barras_unico', 'product_variants', 'tabela=product_variants metodo=btree unico=true valido=true pronto=true nulls_not_distinct=false colunas=codigo_barras classes=pg_catalog.default/pg_catalog.text_ops predicado=(codigo_barras IS NOT NULL)'),
    ('idx_marketplace_orders_presencial', 'marketplace_orders', 'tabela=marketplace_orders metodo=btree unico=false valido=true pronto=true nulls_not_distinct=false colunas=created_at DESC classes=-/pg_catalog.timestamptz_ops predicado=(canal = ''presencial''::text)'),
    ('shipping_quotes_cache_created_at_idx', 'shipping_quotes_cache', 'tabela=shipping_quotes_cache metodo=btree unico=false valido=true pronto=true nulls_not_distinct=false colunas=created_at classes=-/pg_catalog.timestamptz_ops predicado=(nenhum)')
), formas_check(forma, canonico) AS (VALUES
    -- Lista FECHADA de deparses (pg_get_constraintdef, espaços normalizados) do CHECK
    -- do canal, medida no PG 17 local. Qualquer outra expressão (`… OR true`,
    -- `… AND false`, terceiro valor, valor faltando) cai em `fora_da_lista:` e reprova.
    ('CHECK ((canal = ANY (ARRAY[''online''::text, ''presencial''::text])))', 'canal aceita online,presencial')
), restricoes_vivas AS (
  SELECT k.conname AS nome, t.relname AS tabela, k.contype::text AS tipo,
         'tipo=' || k.contype::text
           || ' validada=' || k.convalidated::text
           || ' colunas=' || COALESCE((SELECT string_agg(a.attname, ',' ORDER BY u.ord)
                                         FROM unnest(k.conkey) WITH ORDINALITY AS u(attnum, ord)
                                         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum), '')
           || CASE WHEN k.contype = 'c'
                   THEN ' definicao=' || COALESCE((SELECT f.canonico FROM formas_check f
                                                    WHERE f.forma = regexp_replace(pg_get_constraintdef(k.oid), '\s+', ' ', 'g')),
                                                  'fora_da_lista:' || regexp_replace(pg_get_constraintdef(k.oid), '\s+', ' ', 'g'))
                   ELSE '' END
           || ' adiavel=' || k.condeferrable::text
           || ' adiada=' || k.condeferred::text AS def
    FROM pg_constraint k
    JOIN pg_class t ON t.oid = k.conrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
   WHERE ns.nspname = 'public'
), restricoes(nome, tabela, tipo, esperado) AS (VALUES
    ('marketplace_orders_canal_check', 'marketplace_orders', 'c', 'tipo=c validada=true colunas=canal definicao=canal aceita online,presencial adiavel=false adiada=false'),
    ('shipping_quotes_cache_chave_unica', 'shipping_quotes_cache', 'u', 'tipo=u validada=true colunas=origin_cep,destination_cep,cart_hash adiavel=false adiada=false')
), fk_vendedor AS (
  SELECT string_agg('tipo=f validada=' || k.convalidated::text
                    || ' ref=' || rn.nspname || '.' || rr.relname || '('
                    || COALESCE((SELECT string_agg(a.attname, ',' ORDER BY u.ord)
                                   FROM unnest(k.confkey) WITH ORDINALITY AS u(attnum, ord)
                                   JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.attnum), '') || ')'
                    || ' delete=' || k.confdeltype::text
                    || ' update=' || k.confupdtype::text
                    || ' match=' || k.confmatchtype::text
                    || ' adiavel=' || k.condeferrable::text
                    || ' adiada=' || k.condeferred::text,
                    ' ; ' ORDER BY k.oid) AS def
    FROM pg_constraint k
    JOIN pg_class rr ON rr.oid = k.confrelid
    JOIN pg_namespace rn ON rn.oid = rr.relnamespace
   WHERE k.contype = 'f'
     AND k.conrelid = to_regclass('public.marketplace_orders')
     AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                            WHERE a.attrelid = to_regclass('public.marketplace_orders')
                              AND a.attname = 'vendedor_id' AND NOT a.attisdropped)]::int2[]
), gatilho AS (
  SELECT 'funcao_certa=' || (t.tgfoid = to_regprocedure('public.limpar_cotacoes_fora_da_janela()'))::text
           || ' tgtype=' || t.tgtype::text
           || ' colunas_do_update=' || COALESCE(array_to_string(t.tgattr::int2[], ','), '')
           || ' com_when=' || (t.tgqual IS NOT NULL)::text
           || ' habilitada=' || t.tgenabled::text AS def
    FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgrelid = to_regclass('public.shipping_quotes_cache')
     AND t.tgname = 'shipping_quotes_cache_limpa_ao_gravar'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM corpos) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'corpo final ' || f.fn, f.h, COALESCE(c.h, 'AUSENTE')
    FROM final f LEFT JOIN corpos c ON c.proname = f.fn
  UNION ALL
  SELECT 'sobrecargas ' || f.fn, '1',
         (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.fn)::text
    FROM final f
  UNION ALL
  SELECT 'assinatura get_admin_orders_paged',
         'p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text',
         COALESCE((SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' ; ' ORDER BY pg_get_function_identity_arguments(p.oid))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_orders_paged'), 'AUSENTE')
  UNION ALL
  SELECT 'acl ' || a.fn, a.esperado,
         COALESCE((SELECT string_agg('anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
                                     || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                                     || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
                                     || ' public=' || CASE WHEN p.proacl IS NULL
                                                             OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) g WHERE g.grantee = 0)
                                                           THEN 'sim' ELSE 'nao' END,
                                     ' ; ' ORDER BY p.oid)
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = a.fn), 'AUSENTE')
    FROM acls a
  UNION ALL
  SELECT 'atributos ' || a.fn, a.esperado,
         COALESCE((SELECT string_agg('secdef=' || p.prosecdef::text
                                     || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '(nenhum)')
                                     || ' volatil=' || p.provolatile::text
                                     || ' strict=' || p.proisstrict::text
                                     || ' dono=' || pg_get_userbyid(p.proowner)
                                     || ' args=' || pg_get_function_identity_arguments(p.oid)
                                     || ' retorno=' || pg_get_function_result(p.oid)
                                     || ' lang=' || (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang),
                                     ' ; ' ORDER BY pg_get_function_identity_arguments(p.oid))
                     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = a.fn), 'AUSENTE')
    FROM atributos_esperados a
  UNION ALL
  SELECT 'coluna ' || k.tabela || '.' || k.coluna, k.esperado, COALESCE(v.def, 'AUSENTE')
    FROM colunas k
    LEFT JOIN colunas_vivas v ON v.tabela = k.tabela AND v.coluna = k.coluna
  UNION ALL
  SELECT 'default de store_config.free_shipping_min', '0',
         COALESCE((SELECT v.padrao
                     FROM colunas_vivas v
                    WHERE v.tabela = 'store_config' AND v.coluna = 'free_shipping_min'), 'AUSENTE')
  UNION ALL
  SELECT 'vista ' || s.vista || ' colunas', s.colunas, COALESCE(v.colunas, 'AUSENTE')
    FROM vistas s LEFT JOIN vistas_vivas v ON v.vista = s.vista
  UNION ALL
  SELECT 'vista ' || s.vista || ' opcoes', s.opcoes, COALESCE(v.opcoes, 'AUSENTE')
    FROM vistas s LEFT JOIN vistas_vivas v ON v.vista = s.vista
  UNION ALL
  SELECT 'vista ' || s.vista || ' definicao', s.definicao, COALESCE(v.definicao, 'AUSENTE')
    FROM vistas s LEFT JOIN vistas_vivas v ON v.vista = s.vista
  UNION ALL
  SELECT 'indice ' || i.nome, i.esperado,
         COALESCE((SELECT x.def FROM indices_vivos x WHERE x.nome = i.nome AND x.tabela = i.tabela), 'AUSENTE')
    FROM indices i
  UNION ALL
  SELECT 'restricao ' || r.nome, r.esperado,
         COALESCE((SELECT x.def FROM restricoes_vivas x
                    WHERE x.nome = r.nome AND x.tabela = r.tabela AND x.tipo = r.tipo), 'AUSENTE')
    FROM restricoes r
  UNION ALL
  SELECT 'fk marketplace_orders.vendedor_id', 'tipo=f validada=true ref=auth.users(id) delete=a update=a match=s adiavel=false adiada=false',
         COALESCE((SELECT def FROM fk_vendedor), 'AUSENTE')
  UNION ALL
  SELECT 'gatilho shipping_quotes_cache_limpa_ao_gravar',
         'funcao_certa=true tgtype=20 colunas_do_update= com_when=false habilitada=O',
         COALESCE((SELECT def FROM gatilho), 'AUSENTE')
  UNION ALL
  SELECT 'privilegio authenticated le produtos.codigo_barras',
         'coluna_authenticated=true tabela_authenticated=false tabela_public=false tabela_efetivo=false',
         CASE WHEN EXISTS (SELECT 1 FROM colunas_vivas v WHERE v.tabela = 'produtos' AND v.coluna = 'codigo_barras')
              THEN 'coluna_authenticated=' || EXISTS (SELECT 1 FROM pg_attribute a, aclexplode(a.attacl) g
                                                       WHERE a.attrelid = 'public.produtos'::regclass AND a.attname = 'codigo_barras'
                                                         AND NOT a.attisdropped AND g.privilege_type = 'SELECT'
                                                         AND g.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = 'authenticated'))::text
                   || ' tabela_authenticated=' || EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) g
                                                          WHERE c.oid = 'public.produtos'::regclass AND g.privilege_type = 'SELECT'
                                                            AND g.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = 'authenticated'))::text
                   || ' tabela_public=' || EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) g
                                                   WHERE c.oid = 'public.produtos'::regclass AND g.privilege_type = 'SELECT' AND g.grantee = 0)::text
                   || ' tabela_efetivo=' || has_table_privilege('authenticated', 'public.produtos', 'SELECT')::text
              ELSE 'AUSENTE' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
