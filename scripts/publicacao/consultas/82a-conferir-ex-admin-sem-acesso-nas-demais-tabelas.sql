-- DEPOIS da 20261360000000. SO LEITURA: um SELECT, somente catalogo, nenhuma linha de cliente.
-- Rol fechado de 36 itens, inclusive objetos ausentes (ok=false). Fonte das definicoes no cabecalho da migration.
WITH alvo(tabela, politica, comando, papeis, qual, chk) AS (VALUES
    ('public.coupons', 'coupons_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.coupons', 'coupons_admin_update_policy', 'w', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.coupons', 'coupons_admin_delete_policy', 'd', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.coupons', 'coupons_select_policy', 'r', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.otp_verifications', 'Admins full access on otp_verifications', '*', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('storage.objects', 'devolucoes_dono_ou_admin_select_policy', 'r', 'authenticated', '((bucket_id=''devolucoes''::text)AND((split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text)OR(SELECTrls_admin_atual()ASrls_admin_atual)))', NULL::text),
    ('public.produtos', 'produtos_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.produtos', 'produtos_admin_update_policy', 'w', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.produtos', 'produtos_admin_delete_policy', 'd', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.product_variants', 'product_variants_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.product_variants', 'product_variants_admin_update_policy', 'w', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.product_variants', 'product_variants_admin_delete_policy', 'd', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.produtos', 'produtos_select_policy', 'r', 'authenticated', '((ativo=true)OR(((SELECTauth.role()ASrole)=''authenticated''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual)))', NULL::text),
    ('storage.objects', 'Admin Insert Access (products)', 'a', 'authenticated', NULL::text, '((bucket_id=''products''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))'),
    ('storage.objects', 'Admin Update Access (products)', 'w', 'authenticated', '((bucket_id=''products''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Delete Access (products)', 'd', 'authenticated', '((bucket_id=''products''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Insert Access (banners)', 'a', 'authenticated', NULL::text, '((bucket_id=''banners''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))'),
    ('storage.objects', 'Admin Update Access (banners)', 'w', 'authenticated', '((bucket_id=''banners''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Delete Access (banners)', 'd', 'authenticated', '((bucket_id=''banners''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))', NULL::text),
    ('storage.objects', 'branding_a2_admin_insert', 'a', 'authenticated', NULL::text, '((bucket_id=''branding''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))'),
    ('public.answers', 'answers_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.answers', 'answers_admin_update_policy', 'w', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.answers', 'answers_admin_delete_policy', 'd', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.reviews', 'reviews_admin_update_policy', 'w', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.reviews', 'reviews_admin_delete_policy', 'd', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.questions', 'questions_admin_update_policy', 'w', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', '(SELECTrls_admin_atual()ASrls_admin_atual)'),
    ('public.questions', 'questions_admin_delete_policy', 'd', 'authenticated', '(SELECTrls_admin_atual()ASrls_admin_atual)', NULL::text),
    ('public.reviews', 'reviews_select_policy', 'r', 'authenticated', '((status=''publicada''::text)OR(user_id=(SELECTauth.uid()ASuid))OR(SELECTrls_admin_atual()ASrls_admin_atual))', NULL::text)
), funcoes(assinatura, hash) AS (VALUES
    ('public.answer_question_atomic(uuid,text)', '4766b4ce828e0f7761bcb5c29e4c617a'),
    ('public.answer_question_atomic(uuid,text,uuid)', 'a4d977922837f6ecf3e3df71930b0785'),
    ('public.reply_review_atomic(uuid,text)', '0e58549366e4b4be17ae070a8fc622dc'),
    ('public.reply_review_atomic(uuid,text,uuid)', '64b337eb3ec5dd1431e0dbf9d12a49ac')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel','sim',
    CASE WHEN EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'portas do admin atual: corpos e seguranca','sim', CASE WHEN
    (SELECT count(*)=3 AND bool_and(md5(replace(p.prosrc,chr(13),''))=a.hash AND p.prosecdef
      AND p.provolatile='s' AND p.proconfig=CASE WHEN a.sig='public.is_admin()' THEN ARRAY['search_path=public, auth']::text[] ELSE ARRAY['search_path=public']::text[] END)
      FROM (VALUES ('public.is_admin()','e4e624331673f15aaeb4a6703fef2d7c'),
        ('public.is_admin_atual()','519842163e48cc377ac1337ffb9db936'),
        ('public.rls_admin_atual()','ccb7a56e835b8181795fffb7bee97305')) a(sig,hash)
      JOIN pg_proc p ON p.oid=to_regprocedure(a.sig))
    AND EXISTS(SELECT 1 FROM pg_proc a JOIN pg_proc b ON b.proowner=a.proowner JOIN pg_roles o ON o.oid=a.proowner
      WHERE a.oid=to_regprocedure('public.is_admin_atual()') AND b.oid=to_regprocedure('public.rls_admin_atual()')
        AND (o.rolsuper OR o.rolbypassrls OR (a.proowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('public.profiles'))
          AND a.proowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('auth.users'))))
        AND has_function_privilege('authenticated',b.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',b.oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',a.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',a.oid,'EXECUTE'))
    THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tabelas do lote: RLS ligada e sem FORCE','sim', CASE WHEN
    (SELECT count(*)=9 AND bool_and(c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
      FROM (VALUES ('public.profiles'),('public.coupons'),('public.otp_verifications'),('public.produtos'),
        ('public.product_variants'),('public.answers'),('public.reviews'),('public.questions'),('storage.objects')) a(tabela)
      JOIN pg_class c ON c.oid=to_regclass(a.tabela))
    AND NOT has_any_column_privilege('anon','public.produtos','SELECT') THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'politica: '||a.tabela||' / '||a.politica, 'sim', CASE WHEN
    p.polcmd::text=a.comando AND p.polpermissive
    AND p.polroles=CASE WHEN a.papeis='public' THEN ARRAY[0::oid] ELSE ARRAY['authenticated'::regrole::oid] END
    AND regexp_replace(replace(pg_get_expr(p.polqual,p.polrelid),'public.',''),'[[:space:]]','','g') IS NOT DISTINCT FROM a.qual
    AND regexp_replace(replace(pg_get_expr(p.polwithcheck,p.polrelid),'public.',''),'[[:space:]]','','g') IS NOT DISTINCT FROM a.chk
    THEN 'sim' ELSE 'nao' END
    FROM alvo a LEFT JOIN pg_policy p ON p.polrelid=to_regclass(a.tabela) AND p.polname=a.politica
  UNION ALL
  SELECT 'view: public.vw_produtos_admin','sim',CASE WHEN EXISTS(
    SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.vw_produtos_admin') AND c.relkind='v'
      AND c.reloptions=ARRAY['check_option=cascaded']::text[]
      AND regexp_replace(replace(pg_get_viewdef(c.oid,true),'public.',''),'[[:space:]]','','g')='SELECTid,nome,descricao,categoria,codigo,custo,preco_venda,estoque,estoque_minimo,fornecedor_id,ativo,tags,data_cadastro,ultima_atualizacao,imagem_url,meta_title,meta_description,imagem_urls,preco_original,is_bestseller,frete_gratis,sold,deleted_at,calculated_points,rating,review_count,peso_kg,largura_cm,altura_cm,comprimento_cm,codigo_barrasFROMprodutosWHERErls_admin_atual();'
  ) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'RPC: '||a.assinatura,'sim',CASE WHEN p.prosecdef AND l.lanname='plpgsql' AND p.prokind='f'
    AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=public']::text[] AND p.prorettype='void'::regtype
    AND NOT p.proretset AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
    AND p.proowner=(SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.is_admin_atual()'))
    AND md5(replace(p.prosrc,chr(13),''))=a.hash
    AND (SELECT count(*)=2 FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.proname=p.proname)
    AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) e WHERE e.grantee=0 AND e.privilege_type='EXECUTE')
    THEN 'sim' ELSE 'nao' END
    FROM funcoes a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.assinatura) LEFT JOIN pg_language l ON l.oid=p.prolang
)
SELECT item,esperado,vivo,COALESCE(vivo=esperado,false) AS ok FROM itens ORDER BY ok,item;
