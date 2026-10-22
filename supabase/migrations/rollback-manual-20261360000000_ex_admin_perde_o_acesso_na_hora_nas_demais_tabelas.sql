-- Rollback manual da 20261360000000. So metadados: nenhum dado e alterado.
-- Exige o estado EXATO desta migration antes de escrever. Executar antes dos rollbacks da 97 e da 240.
-- Corpos anteriores copiados das migrations vigentes (240, 65 e 64), sem editar os corpos.
-- Sem BEGIN/COMMIT: transacao do aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261360$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_cmd text;
  v_roles text;
  v_perm boolean;
  v_view text;
  v_opcoes text[];
  v_caminho text;
BEGIN

  -- Portas da 97: corpo, seguranca, caminho e dono com BYPASSRLS; nenhuma leitura de cliente.
  FOR r IN SELECT * FROM (VALUES
    ('public.is_admin()', 'e4e624331673f15aaeb4a6703fef2d7c'),
    ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
    ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
  ) AS porta(assinatura, hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(r.assinatura)
        AND md5(replace(p.prosrc, chr(13), '')) = r.hash
        AND p.prosecdef AND p.provolatile = 's'
        AND p.proconfig = CASE WHEN r.assinatura = 'public.is_admin()' THEN ARRAY['search_path=public, auth']::text[] ELSE ARRAY['search_path=public']::text[] END
        AND l.lanname = CASE WHEN r.assinatura = 'public.is_admin()' THEN 'plpgsql' ELSE 'sql' END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: porta % ausente ou divergente.', r.assinatura;
    END IF;
  END LOOP;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.is_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.is_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE das portas do admin atual divergente.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc a JOIN pg_proc b ON b.proowner = a.proowner JOIN pg_roles o ON o.oid = a.proowner
     WHERE a.oid = to_regprocedure('public.is_admin_atual()') AND b.oid = to_regprocedure('public.rls_admin_atual()')
       AND (o.rolsuper OR o.rolbypassrls OR (
         a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.profiles'))
         AND a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('auth.users'))))
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: portas com donos diferentes ou sujeitos a RLS.';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public.profiles','public.coupons','public.otp_verifications','public.produtos',
    'public.product_variants','public.answers','public.reviews','public.questions','storage.objects']) AS tabela LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(r.tabela)
      AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % precisa de RLS ligada e sem FORCE.', r.tabela;
    END IF;
  END LOOP;

  -- O visitante ja deve ler pela vitrine, sem SELECT direto nem por coluna (20261070).
  IF has_any_column_privilege('anon', 'public.produtos', 'SELECT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: anon ainda le produtos diretamente; revise a ACL antes de restringir o papel da politica.';
  END IF;
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('public.coupons', 'coupons_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.coupons', 'coupons_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.coupons', 'coupons_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.coupons', 'coupons_select_policy', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.otp_verifications', 'Admins full access on otp_verifications', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('storage.objects', 'devolucoes_dono_ou_admin_select_policy', 'r', 'authenticated', '((bucket_id = ''devolucoes''::text) AND ((split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text) OR ( SELECT public.is_admin() AS is_admin)))', NULL::text, '((bucket_id = ''devolucoes''::text) AND ((split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual)))', NULL::text),
    ('public.produtos', 'produtos_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.produtos', 'produtos_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.produtos', 'produtos_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.product_variants', 'product_variants_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.product_variants', 'product_variants_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.product_variants', 'product_variants_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.produtos', 'produtos_select_policy', 'r', 'public', '((ativo = true) OR ((( SELECT auth.role() AS role) = ''authenticated''::text) AND ( SELECT public.is_admin() AS is_admin)))', NULL::text, '((ativo = true) OR ((( SELECT auth.role() AS role) = ''authenticated''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual)))', NULL::text),
    ('storage.objects', 'Admin Insert Access (products)', 'a', 'authenticated', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('storage.objects', 'Admin Update Access (products)', 'w', 'authenticated', '((bucket_id = ''products''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Delete Access (products)', 'd', 'authenticated', '((bucket_id = ''products''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Insert Access (banners)', 'a', 'authenticated', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('storage.objects', 'Admin Update Access (banners)', 'w', 'authenticated', '((bucket_id = ''banners''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Delete Access (banners)', 'd', 'authenticated', '((bucket_id = ''banners''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'branding_a2_admin_insert', 'a', 'authenticated', NULL::text, '((bucket_id = ''branding''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''branding''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('public.answers', 'answers_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.answers', 'answers_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.answers', 'answers_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.reviews', 'reviews_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.reviews', 'reviews_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.questions', 'questions_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.questions', 'questions_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.reviews', 'reviews_select_policy', 'r', 'authenticated', '((status = ''publicada''::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((status = ''publicada''::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text)
  ) AS esperado(tabela, politica, comando, papeis, qual_antes, check_antes, qual_depois, check_depois) LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid),
      p.polcmd::text,p.polpermissive,
      array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
        FROM unnest(p.polroles) x ORDER BY 1), ',')
      INTO v_qual,v_check,v_cmd,v_perm,v_roles FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica;
    IF NOT FOUND OR v_cmd IS DISTINCT FROM r.comando OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM (CASE WHEN r.politica = 'produtos_select_policy' THEN 'authenticated' ELSE r.papeis END) OR NOT (v_qual IS NOT DISTINCT FROM replace(r.qual_depois, chr(13), '') AND v_check IS NOT DISTINCT FROM replace(r.check_depois, chr(13), '')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % ausente ou divergente (USING %, CHECK %).', r.politica,r.tabela,v_qual,v_check;
    END IF;
  END LOOP;
  -- A view e gravavel: mesma projecao, mesmo dono/ACL, CASCADED CHECK OPTION preservado.
  SELECT pg_get_viewdef(c.oid,true),c.reloptions INTO v_view,v_opcoes
    FROM pg_class c WHERE c.oid = to_regclass('public.vw_produtos_admin') AND c.relkind = 'v';
  IF NOT FOUND OR v_opcoes IS DISTINCT FROM ARRAY['check_option=cascaded']::text[]
     OR NOT (v_view = replace($view_esperada$ SELECT id,
    nome,
    descricao,
    categoria,
    codigo,
    custo,
    preco_venda,
    estoque,
    estoque_minimo,
    fornecedor_id,
    ativo,
    tags,
    data_cadastro,
    ultima_atualizacao,
    imagem_url,
    meta_title,
    meta_description,
    imagem_urls,
    preco_original,
    is_bestseller,
    frete_gratis,
    sold,
    deleted_at,
    calculated_points,
    rating,
    review_count,
    peso_kg,
    largura_cm,
    altura_cm,
    comprimento_cm,
    codigo_barras
   FROM public.produtos
  WHERE public.rls_admin_atual();$view_esperada$, chr(13), '')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: vw_produtos_admin ausente, projecao/filtro/opcoes divergentes.';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.answer_question_atomic(uuid,text)', '1268df6cb364dfb46b5c535e007bb2d0', '4766b4ce828e0f7761bcb5c29e4c617a'),
    ('public.answer_question_atomic(uuid,text,uuid)', 'b62a4186ff8d58955973f53d6c0f302b', 'a4d977922837f6ecf3e3df71930b0785'),
    ('public.reply_review_atomic(uuid,text)', 'adca21e7f0217075de7b6f959628466c', '0e58549366e4b4be17ae070a8fc622dc'),
    ('public.reply_review_atomic(uuid,text,uuid)', 'c9d65554fd386e5b0e2d04b924822d0f', '64b337eb3ec5dd1431e0dbf9d12a49ac')
  ) AS esperado(assinatura, hash_antes, hash_depois) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=to_regprocedure(r.assinatura)
         AND md5(replace(p.prosrc, chr(13), '')) = r.hash_depois
         AND p.prokind='f' AND p.prosecdef AND l.lanname='plpgsql' AND p.provolatile='v'
         AND p.proconfig=ARRAY['search_path=public']::text[] AND p.prorettype='void'::regtype
         AND NOT p.proretset AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
         AND p.proowner=(SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated',p.oid,'EXECUTE')
         AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPC % ausente, corpo/atributos/dono/ACL divergentes.',r.assinatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='answer_question_atomic') <> 2
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='reply_review_atomic') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: sobrecarga inesperada nas RPCs de resposta.';
  END IF;
  PERFORM set_config('search_path',v_caminho,true);
END $preflight_rollback_20261360$;

ALTER POLICY "coupons_admin_insert_policy" ON public.coupons
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "coupons_admin_update_policy" ON public.coupons
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "coupons_admin_delete_policy" ON public.coupons
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "coupons_select_policy" ON public.coupons
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "Admins full access on otp_verifications" ON public.otp_verifications
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "devolucoes_dono_ou_admin_select_policy" ON storage.objects
  USING (((bucket_id = 'devolucoes'::text) AND ((split_part(name, '/'::text, 1) = (( SELECT auth.uid() AS uid))::text) OR ( SELECT public.is_admin() AS is_admin))));

ALTER POLICY "produtos_admin_insert_policy" ON public.produtos
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "produtos_admin_update_policy" ON public.produtos
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "produtos_admin_delete_policy" ON public.produtos
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "product_variants_admin_insert_policy" ON public.product_variants
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "product_variants_admin_update_policy" ON public.product_variants
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "product_variants_admin_delete_policy" ON public.product_variants
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "produtos_select_policy" ON public.produtos TO public
  USING (((ativo = true) OR ((( SELECT auth.role() AS role) = 'authenticated'::text) AND ( SELECT public.is_admin() AS is_admin))));

ALTER POLICY "Admin Insert Access (products)" ON storage.objects
  WITH CHECK (((bucket_id = 'products'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "Admin Update Access (products)" ON storage.objects
  USING (((bucket_id = 'products'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "Admin Delete Access (products)" ON storage.objects
  USING (((bucket_id = 'products'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "Admin Insert Access (banners)" ON storage.objects
  WITH CHECK (((bucket_id = 'banners'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "Admin Update Access (banners)" ON storage.objects
  USING (((bucket_id = 'banners'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "Admin Delete Access (banners)" ON storage.objects
  USING (((bucket_id = 'banners'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "branding_a2_admin_insert" ON storage.objects
  WITH CHECK (((bucket_id = 'branding'::text) AND ( SELECT public.is_admin() AS is_admin)));

ALTER POLICY "answers_admin_insert_policy" ON public.answers
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "answers_admin_update_policy" ON public.answers
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "answers_admin_delete_policy" ON public.answers
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "reviews_admin_update_policy" ON public.reviews
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "reviews_admin_delete_policy" ON public.reviews
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "questions_admin_update_policy" ON public.questions
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "questions_admin_delete_policy" ON public.questions
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "reviews_select_policy" ON public.reviews
  USING (((status = 'publicada'::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

CREATE OR REPLACE VIEW public.vw_produtos_admin AS
 SELECT id,
    nome,
    descricao,
    categoria,
    codigo,
    custo,
    preco_venda,
    estoque,
    estoque_minimo,
    fornecedor_id,
    ativo,
    tags,
    data_cadastro,
    ultima_atualizacao,
    imagem_url,
    meta_title,
    meta_description,
    imagem_urls,
    preco_original,
    is_bestseller,
    frete_gratis,
    sold,
    deleted_at,
    calculated_points,
    rating,
    review_count,
    peso_kg,
    largura_cm,
    altura_cm,
    comprimento_cm,
    codigo_barras
   FROM public.produtos
  WHERE public.is_admin()
  WITH CASCADED CHECK OPTION;

CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
    v_admin_id uuid;
BEGIN
    -- SECURITY CHECK: Ensure the caller is an admin
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Upsert Answer (idx_answers_question_id_unique, criado pela
    -- migration 20260812030000, e' quem permite o ON CONFLICT inferir o
    -- alvo)
    INSERT INTO answers (question_id, user_id, answer)
    VALUES (p_question_id, v_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 3. Aviso no sino da cliente que perguntou (20261240000000). Um por
        --    pergunta: resposta repetida ou editada nao cria outro. Best-effort:
        --    a falha do aviso nunca perde a resposta da loja.
        BEGIN
            INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, dados, acao)
            SELECT v_user_id, 'info', 'Sua pergunta foi respondida',
                   'A loja respondeu sua pergunta sobre ' || COALESCE(v_product_name, 'um produto') || '.',
                   jsonb_build_object('question_id', p_question_id, 'product_id', v_product_id),
                   jsonb_build_object('url', '/product-detail?id=' || v_product_id)
             WHERE v_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM notificacoes n
                                WHERE n.usuario_id = v_user_id
                                  AND n.dados ->> 'question_id' = p_question_id::text);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'answer_question_atomic: aviso da pergunta % nao nasceu (%).', p_question_id, SQLERRM;
        END;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Upsert Answer (mesmo caminho da sobrecarga de 2 args, ver acima)
    INSERT INTO public.answers (question_id, user_id, answer)
    VALUES (p_question_id, p_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM public.questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 3. Aviso no sino da cliente que perguntou (20261240000000). Um por
        --    pergunta: resposta repetida ou editada nao cria outro. Best-effort:
        --    a falha do aviso nunca perde a resposta da loja.
        BEGIN
            INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados, acao)
            SELECT v_user_id, 'info', 'Sua pergunta foi respondida',
                   'A loja respondeu sua pergunta sobre ' || COALESCE(v_product_name, 'um produto') || '.',
                   jsonb_build_object('question_id', p_question_id, 'product_id', v_product_id),
                   jsonb_build_object('url', '/product-detail?id=' || v_product_id)
             WHERE v_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.notificacoes n
                                WHERE n.usuario_id = v_user_id
                                  AND n.dados ->> 'question_id' = p_question_id::text);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'answer_question_atomic: aviso da pergunta % nao nasceu (%).', p_question_id, SQLERRM;
        END;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
    v_admin_id uuid;
BEGIN
    -- SECURITY CHECK: Ensure the caller is an admin
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility — A10: log honesto,
        --    nasce com 0; só sobe quando o send-push CONFIRMAR entrega.
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliação foi respondida!',
            'A loja respondeu à sua avaliação no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            0,
            v_admin_id
        );
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE public.reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility — A10: log honesto,
        --    nasce com 0; só sobe quando o send-push CONFIRMAR entrega.
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliacao foi respondida!',
            'A loja respondeu a sua avaliacao no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            0,
            p_admin_id
        );
    END IF;
END;
$function$;

DO $conferencia_rollback_20261360$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_cmd text;
  v_roles text;
  v_perm boolean;
  v_view text;
  v_opcoes text[];
  v_caminho text;
BEGIN

  -- Portas da 97: corpo, seguranca, caminho e dono com BYPASSRLS; nenhuma leitura de cliente.
  FOR r IN SELECT * FROM (VALUES
    ('public.is_admin()', 'e4e624331673f15aaeb4a6703fef2d7c'),
    ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
    ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
  ) AS porta(assinatura, hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(r.assinatura)
        AND md5(replace(p.prosrc, chr(13), '')) = r.hash
        AND p.prosecdef AND p.provolatile = 's'
        AND p.proconfig = CASE WHEN r.assinatura = 'public.is_admin()' THEN ARRAY['search_path=public, auth']::text[] ELSE ARRAY['search_path=public']::text[] END
        AND l.lanname = CASE WHEN r.assinatura = 'public.is_admin()' THEN 'plpgsql' ELSE 'sql' END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: porta % ausente ou divergente.', r.assinatura;
    END IF;
  END LOOP;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.is_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.is_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE das portas do admin atual divergente.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc a JOIN pg_proc b ON b.proowner = a.proowner JOIN pg_roles o ON o.oid = a.proowner
     WHERE a.oid = to_regprocedure('public.is_admin_atual()') AND b.oid = to_regprocedure('public.rls_admin_atual()')
       AND (o.rolsuper OR o.rolbypassrls OR (
         a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.profiles'))
         AND a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('auth.users'))))
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: portas com donos diferentes ou sujeitos a RLS.';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public.profiles','public.coupons','public.otp_verifications','public.produtos',
    'public.product_variants','public.answers','public.reviews','public.questions','storage.objects']) AS tabela LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(r.tabela)
      AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % precisa de RLS ligada e sem FORCE.', r.tabela;
    END IF;
  END LOOP;

  -- O visitante ja deve ler pela vitrine, sem SELECT direto nem por coluna (20261070).
  IF has_any_column_privilege('anon', 'public.produtos', 'SELECT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: anon ainda le produtos diretamente; revise a ACL antes de restringir o papel da politica.';
  END IF;
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('public.coupons', 'coupons_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.coupons', 'coupons_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.coupons', 'coupons_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.coupons', 'coupons_select_policy', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.otp_verifications', 'Admins full access on otp_verifications', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('storage.objects', 'devolucoes_dono_ou_admin_select_policy', 'r', 'authenticated', '((bucket_id = ''devolucoes''::text) AND ((split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text) OR ( SELECT public.is_admin() AS is_admin)))', NULL::text, '((bucket_id = ''devolucoes''::text) AND ((split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual)))', NULL::text),
    ('public.produtos', 'produtos_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.produtos', 'produtos_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.produtos', 'produtos_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.product_variants', 'product_variants_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.product_variants', 'product_variants_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.product_variants', 'product_variants_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.produtos', 'produtos_select_policy', 'r', 'public', '((ativo = true) OR ((( SELECT auth.role() AS role) = ''authenticated''::text) AND ( SELECT public.is_admin() AS is_admin)))', NULL::text, '((ativo = true) OR ((( SELECT auth.role() AS role) = ''authenticated''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual)))', NULL::text),
    ('storage.objects', 'Admin Insert Access (products)', 'a', 'authenticated', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('storage.objects', 'Admin Update Access (products)', 'w', 'authenticated', '((bucket_id = ''products''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Delete Access (products)', 'd', 'authenticated', '((bucket_id = ''products''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Insert Access (banners)', 'a', 'authenticated', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('storage.objects', 'Admin Update Access (banners)', 'w', 'authenticated', '((bucket_id = ''banners''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'Admin Delete Access (banners)', 'd', 'authenticated', '((bucket_id = ''banners''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''banners''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
    ('storage.objects', 'branding_a2_admin_insert', 'a', 'authenticated', NULL::text, '((bucket_id = ''branding''::text) AND ( SELECT public.is_admin() AS is_admin))', NULL::text, '((bucket_id = ''branding''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('public.answers', 'answers_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.answers', 'answers_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.answers', 'answers_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.reviews', 'reviews_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.reviews', 'reviews_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.questions', 'questions_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.questions', 'questions_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.reviews', 'reviews_select_policy', 'r', 'authenticated', '((status = ''publicada''::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((status = ''publicada''::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text)
  ) AS esperado(tabela, politica, comando, papeis, qual_antes, check_antes, qual_depois, check_depois) LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid),
      p.polcmd::text,p.polpermissive,
      array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
        FROM unnest(p.polroles) x ORDER BY 1), ',')
      INTO v_qual,v_check,v_cmd,v_perm,v_roles FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica;
    IF NOT FOUND OR v_cmd IS DISTINCT FROM r.comando OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM r.papeis OR NOT (v_qual IS NOT DISTINCT FROM replace(r.qual_antes, chr(13), '') AND v_check IS NOT DISTINCT FROM replace(r.check_antes, chr(13), '')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % ausente ou divergente (USING %, CHECK %).', r.politica,r.tabela,v_qual,v_check;
    END IF;
  END LOOP;
  -- A view e gravavel: mesma projecao, mesmo dono/ACL, CASCADED CHECK OPTION preservado.
  SELECT pg_get_viewdef(c.oid,true),c.reloptions INTO v_view,v_opcoes
    FROM pg_class c WHERE c.oid = to_regclass('public.vw_produtos_admin') AND c.relkind = 'v';
  IF NOT FOUND OR v_opcoes IS DISTINCT FROM ARRAY['check_option=cascaded']::text[]
     OR NOT (v_view = replace($view_esperada$ SELECT id,
    nome,
    descricao,
    categoria,
    codigo,
    custo,
    preco_venda,
    estoque,
    estoque_minimo,
    fornecedor_id,
    ativo,
    tags,
    data_cadastro,
    ultima_atualizacao,
    imagem_url,
    meta_title,
    meta_description,
    imagem_urls,
    preco_original,
    is_bestseller,
    frete_gratis,
    sold,
    deleted_at,
    calculated_points,
    rating,
    review_count,
    peso_kg,
    largura_cm,
    altura_cm,
    comprimento_cm,
    codigo_barras
   FROM public.produtos
  WHERE public.is_admin();$view_esperada$, chr(13), '')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: vw_produtos_admin ausente, projecao/filtro/opcoes divergentes.';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('public.answer_question_atomic(uuid,text)', '1268df6cb364dfb46b5c535e007bb2d0', '4766b4ce828e0f7761bcb5c29e4c617a'),
    ('public.answer_question_atomic(uuid,text,uuid)', 'b62a4186ff8d58955973f53d6c0f302b', 'a4d977922837f6ecf3e3df71930b0785'),
    ('public.reply_review_atomic(uuid,text)', 'adca21e7f0217075de7b6f959628466c', '0e58549366e4b4be17ae070a8fc622dc'),
    ('public.reply_review_atomic(uuid,text,uuid)', 'c9d65554fd386e5b0e2d04b924822d0f', '64b337eb3ec5dd1431e0dbf9d12a49ac')
  ) AS esperado(assinatura, hash_antes, hash_depois) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=to_regprocedure(r.assinatura)
         AND md5(replace(p.prosrc, chr(13), '')) = r.hash_antes
         AND p.prokind='f' AND p.prosecdef AND l.lanname='plpgsql' AND p.provolatile='v'
         AND p.proconfig=ARRAY['search_path=public']::text[] AND p.prorettype='void'::regtype
         AND NOT p.proretset AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
         AND p.proowner=(SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated',p.oid,'EXECUTE')
         AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPC % ausente, corpo/atributos/dono/ACL divergentes.',r.assinatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='answer_question_atomic') <> 2
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='reply_review_atomic') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: sobrecarga inesperada nas RPCs de resposta.';
  END IF;
  PERFORM set_config('search_path',v_caminho,true);
END $conferencia_rollback_20261360$;

NOTIFY pgrst, 'reload schema';
