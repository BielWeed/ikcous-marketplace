-- AS POLITICAS DE PERFIL, ENDERECO, CARRINHO E NOTIFICACAO EXIGEM O ADMIN DE AGORA
-- (permissao + dado de cliente; 21/10/2026) — fecha o que a 20261197000000, a
-- 20261199000000 e a 20261202000000 deixaram declaradamente de fora.
--
-- O DEFEITO: `public.is_admin()` (baseline 20260806000000) responde `true` assim que o JWT diz
-- `app_metadata.role = 'admin'`, ANTES de olhar o papel atual. O JWT vale ate expirar (~1 h): um
-- administrador REBAIXADO (profiles.role -> 'customer', ou o app_metadata trocado no painel do
-- Supabase) continua, nessa janela, LENDO e ALTERANDO direto pelo PostgREST os dados de TODOS os
-- clientes nas 13 politicas abaixo — whatsapp e CPF em `profiles`, enderecos em `user_addresses`, o
-- carrinho, as inscricoes de push e as notificacoes de cada pessoa, o log de push, os eventos de
-- analytics e as credenciais de frete da loja.
--
-- O QUE MUDA: nas 13 politicas, a porta de admin passa de `(SELECT public.is_admin())` para
-- `(SELECT public.rls_admin_atual())` (a mesma da 20261197000000: admin em auth.users E em profiles, lidos
-- AGORA; service_role e postgres como antes). `ALTER POLICY` so troca a expressao:
--   profiles                     profiles_select_policy, profiles_update_policy
--   user_addresses               user_addresses_all_policy
--   push_subscriptions           push_subscriptions_all_policy
--   cart_items                   cart_items_select_policy, cart_items_delete_policy
--   notificacoes                 notificacoes_select_policy, notificacoes_insert_policy,
--                                notificacoes_update_policy, notificacoes_delete_policy
--   push_notifications_log       push_notifications_log_admin_all_policy
--   analytics_events             analytics_events_select_policy
--   store_shipping_credentials   "Admins have full access to shipping credentials"
-- O ramo do PROPRIO dono (`auth.uid() = id` / `user_id` / `usuario_id`) fica IGUAL byte a byte, o ramo
-- "recado para todas" das notificacoes (`usuario_id IS NULL`) tambem; nome, comando, papeis
-- (todas TO authenticated) e permissividade nao mudam. Nenhum GRANT/REVOKE.
--
-- QUEM PASSA, DEPOIS: o conjunto so ENCOLHE (rls_admin_atual() contido em is_admin() para authenticated).
-- Cliente comum le e altera o proprio perfil, endereco, carrinho, inscricao de push e notificacao como
-- antes; admin de verdade (admin nas duas fontes) segue lendo tudo; service_role e postgres ignoram RLS.
-- EFEITO COLATERAL ACEITO (o mesmo da 97, da 99 e da 202): quem e admin para is_admin() SO no
-- app_metadata do JWT, sem profiles.role = 'admin' (ou o contrario), perde a leitura destas tabelas.
-- ANTES DE APLICAR numa loja, conferir que ninguem esta nesse meio-termo (consulta 8b-papeis-contraditorios,
-- a mesma que o lote 92-202 usa; zero linhas = ninguem perde acesso; cada linha e um papel contraditorio que o
-- dono decide qual e o certo):
--   SELECT u.id FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
--    WHERE COALESCE(u.raw_app_meta_data ->> 'role' = 'admin', false)
--          IS DISTINCT FROM COALESCE(p.role = 'admin', false);
--
-- SEM RECURSAO (o risco GRAVE desta migration): a politica de `profiles` passa a chamar rls_admin_atual(),
-- e rls_admin_atual() -> is_admin_atual() LE `profiles` (e auth.users). Isso so nao entra em laco porque as
-- duas funcoes sao SECURITY DEFINER do DONO da tabela (postgres): o dono da tabela nao passa pela RLS dela
-- (Postgres: "table owners normally bypass row security") — a nao ser que a tabela tenha FORCE ROW LEVEL
-- SECURITY, o que ela NAO tem (nenhuma migration usa FORCE; o pre-voo abaixo CONFERE no banco vivo de cada
-- loja, junto com o dono das duas funcoes, e recusa sem escrever se algo divergir). Se um dia a premissa
-- falhar (dono das funcoes sujeito a RLS), a falha MEDIDA na prova viva, com papeis reais, e' fechar o lado seguro:
-- a funcao enxerga ZERO perfis e nenhum admin e' reconhecido (o painel todo fecha, em vez de abrir). A recursao
-- infinita que se temia (a politica chama a funcao, que le o perfil, que chama a politica...) NAO se reproduziu em
-- nenhuma configuracao tentada, porque a funcao so consulta a linha do PROPRIO usuario, que passa pelo 1o ramo da
-- politica (`auth.uid() = id`) sem chamar a funcao de novo. Nos bancos do Supabase o dono e' `postgres`, dono da
-- tabela e com BYPASSRLS, e nada disso acontece.
--
-- DADOS EXISTENTES: nenhuma linha e lida ou reescrita ao aplicar — so troca a expressao de 13 politicas. O que
-- um administrador rebaixado JA leu ou gravou nessas tabelas antes fica como esta (a migration nao desfaz nem
-- audita: so barra o proximo acesso).
--
-- FORA DESTE LOTE (declarado, nao esquecido): as demais politicas que ainda usam is_admin() — catalogo
-- (produtos, variantes, categorias, banners, cupons), configuracao da loja (store_config, app_settings),
-- perguntas/respostas/avaliacoes, storage e as tabelas internas — e `otp_verifications`, cuja politica
-- "Admins full access on otp_verifications" guarda os codigos de verificacao dos convidados. Cada grupo e uma
-- decisao de escopo propria.
--
-- IDEMPOTENCIA: `ALTER POLICY` com a mesma expressao; o pre-voo aceita, para cada politica, a expressao de antes
-- OU a que esta migration deixa — reaplicar produz o mesmo estado.
--
-- PRE-VOO / B1_BASELINE_DIVERGENT: o `DO $preflight_20261340$`, ANTES de qualquer escrita, recusa se: (1) is_admin(),
-- is_admin_atual() ou rls_admin_atual() nao tiverem o corpo esperado (md5 sem CR), ou rls_admin_atual() nao tiver
-- EXECUTE para authenticated; (2) alguma das 8 tabelas nao tiver RLS ligada ou tiver FORCE; (3) as duas funcoes
-- nao tiverem o mesmo dono, ou esse dono nao for o dono de public.profiles (ou superusuario / BYPASSRLS); (4) alguma
-- das 13 politicas nao existir, ou o comando, o papel, o carater permissivo ou a expressao VIVA (USING e WITH CHECK,
-- deparseados com `search_path = pg_catalog`) nao forem nem os de antes nem os desta migration. No fim, uma
-- CONFERENCIA aborta tudo se alguma politica nao ficou com rls_admin_atual() e sem is_admin().
--
-- TRANSACAO: sem `BEGIN`/`COMMIT` de nivel superior (regra da casa, AGENTS.md): o aplicador abre a transacao e
-- o ledger junto — o pre-voo, as 13 trocas e a conferencia caem juntos ou nao caem. `ALTER POLICY` pega lock
-- curto em cada tabela; lock_timeout de 5 s evita fila atras de uma consulta longa.
--
-- ORDEM: depois da 20261197000000 (cria rls_admin_atual(); o pre-voo recusa sem ela). Nenhuma tela muda. ROLLBACK:
-- este vem ANTES do da 20261197000000 — o rollback dela RECUSA enquanto qualquer politica fora da 97 usar
-- rls_admin_atual() (apagar a funcao deixaria estas politicas quebradas). Na ordem inversa: 1340, depois 1202, depois 1197.
--
-- COMO APLICAR: workflow `aplicar-migrations.yml`, `migracoes = 20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual.sql`.
--
-- FICHA DE VERIFICACAO:
--   1. A conferencia de papel contraditorio acima: zero linhas.
--   2. `pg_policies` das 13 mostra `rls_admin_atual()` no lugar de `is_admin()`; nome, comando e papeis iguais.
--   3. Admin de verdade no painel: Clientes (perfil e endereco), notificacoes e push seguem funcionando; a cliente
--      abre a propria conta, o proprio endereco e o proprio carrinho.
--
-- PROVA VIVA: tests/banco/admin-atual-perfis-viva.cjs (rpc-ci) — papeis reais; para cada politica: o ex-admin
-- (rebaixado so no profiles, so no auth.users; JWT velho) le 0 linhas e nao escreve; CONTROLE na politica antiga le e
-- escreve; admin atual como antes; a cliente comum o proprio e um terceiro nada; leitura de perfil e login SEM
-- recursao (e, com o dono da funcao sujeito a RLS, nenhum admin reconhecido — o pre-voo recusa FORCE e dono diferente);
-- rollback byte a byte; preflight recusando sem escrita.
--
-- ROLLBACK MANUAL: rollback-manual-20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual.sql
-- devolve as 13 expressoes de antes (is_admin()) e recusa se o estado vivo nao for o desta migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261340$
DECLARE
  r record;
  v_hash text;
  v_caminho text;
  v_qual text;
  v_check text;
  v_cmd text;
  v_perm boolean;
  v_roles text;
  v_dono_perfil oid;
BEGIN
  -- (1) as tres portas: o corpo vivo de cada uma e o da baseline / da 20261197000000.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.is_admin()', 'e4e624331673f15aaeb4a6703fef2d7c'),
        ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
        ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
      ) AS esperado(assinatura, hash_esperado)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_esperado THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o esperado — aplique a 20261197000000 antes desta e revise o corpo vivo.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: rls_admin_atual() precisa de EXECUTE para authenticated — as politicas desta migration sao TO authenticated e sem ele cada leitura delas viraria erro.';
  END IF;

  -- (2) RLS ligada e SEM FORCE nas 8 tabelas. O FORCE faria o dono das funcoes passar pela RLS.
  FOR r IN SELECT unnest(ARRAY['public.profiles', 'public.user_addresses', 'public.push_subscriptions', 'public.cart_items', 'public.notificacoes', 'public.push_notifications_log', 'public.analytics_events', 'public.store_shipping_credentials']) AS tabela
  LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_class c
          WHERE c.oid = to_regclass(r.tabela) AND c.relkind = 'r'
            AND c.relrowsecurity AND NOT c.relforcerowsecurity
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % precisa de RLS ligada e SEM FORCE ROW LEVEL SECURITY — com FORCE, o dono das funcoes rls_admin_atual()/is_admin_atual() passaria pela RLS.', r.tabela;
    END IF;
  END LOOP;

  -- (3) SEM RECURSAO: a politica de profiles passa a chamar rls_admin_atual(), que le profiles. Isso so funciona
  -- porque a funcao roda como o dono da tabela (ou papel com BYPASSRLS/superusuario), que nao passa pela RLS. Se o
  -- dono fosse outro, a funcao passaria a enxergar ZERO perfis (nenhum admin seria reconhecido: o painel inteiro
  -- fecharia) e a politica de profiles poderia reentrar nela mesma. O mesmo dono nas duas funcoes tambem e' exigido:
  -- a rls_admin_atual() chama a is_admin_atual(), que nao tem EXECUTE para mais ninguem.
  SELECT c.relowner INTO v_dono_perfil FROM pg_class c WHERE c.oid = to_regclass('public.profiles');
  IF NOT EXISTS (
       SELECT 1
         FROM pg_proc a
         JOIN pg_proc b ON b.proowner = a.proowner
         JOIN pg_roles o ON o.oid = a.proowner
        WHERE a.oid = to_regprocedure('public.is_admin_atual()')
          AND b.oid = to_regprocedure('public.rls_admin_atual()')
          AND (a.proowner = v_dono_perfil OR o.rolsuper OR o.rolbypassrls)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: is_admin_atual() e rls_admin_atual() precisam ter o MESMO dono, e ele precisa ser o dono de public.profiles (ou ter BYPASSRLS): senao nenhum admin seria reconhecido (a funcao nao enxergaria profiles) e a politica de profiles poderia reentrar nela mesma.';
  END IF;

  -- (4) as 13 politicas: cada uma esta como antes desta migration OU como ela deixa (reaplicar e' seguro). Expressoes
  -- deparseadas com search_path = pg_catalog (nomes sempre qualificados); o search_path volta logo depois.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.profiles', 'profiles_select_policy', 'r', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.profiles', 'profiles_update_policy', 'w', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.user_addresses', 'user_addresses_all_policy', '*', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.push_subscriptions', 'push_subscriptions_all_policy', '*', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.cart_items', 'cart_items_select_policy', 'r', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.cart_items', 'cart_items_delete_policy', 'd', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.notificacoes', 'notificacoes_select_policy', 'r', '((( SELECT auth.uid() AS uid) = usuario_id) OR (usuario_id IS NULL) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((( SELECT auth.uid() AS uid) = usuario_id) OR (usuario_id IS NULL) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.notificacoes', 'notificacoes_insert_policy', 'a', NULL::text, '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.notificacoes', 'notificacoes_update_policy', 'w', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.is_admin() AS is_admin))', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
        ('public.notificacoes', 'notificacoes_delete_policy', 'd', '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.is_admin() AS is_admin))', NULL::text, '((( SELECT auth.uid() AS uid) = usuario_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.push_notifications_log', 'push_notifications_log_admin_all_policy', '*', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.analytics_events', 'analytics_events_select_policy', 'r', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.store_shipping_credentials', 'Admins have full access to shipping credentials', '*', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
      ) AS esperado(tabela, politica, comando, qual_vigente, check_vigente, qual_desta, check_desta)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
           p.polcmd::text, p.polpermissive,
           array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                   FROM unnest(p.polroles) AS x ORDER BY 1), ',')
      INTO v_qual, v_check, v_cmd, v_perm, v_roles
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela)
       AND p.polname = r.politica;

    IF NOT FOUND
       OR v_cmd IS DISTINCT FROM r.comando
       OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM 'authenticated'
       OR NOT (
            (v_qual IS NOT DISTINCT FROM r.qual_vigente AND v_check IS NOT DISTINCT FROM r.check_vigente)
         OR (v_qual IS NOT DISTINCT FROM r.qual_desta AND v_check IS NOT DISTINCT FROM r.check_desta)
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % (comando %, papeis %, USING %, WITH CHECK %) nao e a vigente antes desta migration nem a que ela deixa — revise antes de aplicar.', r.politica, r.tabela, COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo'), COALESCE(v_check, 'nulo');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_20261340$;

-- So a porta de admin troca; o ramo do dono (auth.uid() = id / user_id / usuario_id), o ramo "recado para todas"
-- (usuario_id IS NULL), o comando, os papeis e o nome ficam como estao.
ALTER POLICY profiles_select_policy ON public.profiles
  USING ((((SELECT auth.uid()) = id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY profiles_update_policy ON public.profiles
  USING ((((SELECT auth.uid()) = id) OR (SELECT public.rls_admin_atual())))
  WITH CHECK ((((SELECT auth.uid()) = id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY user_addresses_all_policy ON public.user_addresses
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual())))
  WITH CHECK ((((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY push_subscriptions_all_policy ON public.push_subscriptions
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual())))
  WITH CHECK ((((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY cart_items_select_policy ON public.cart_items
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY cart_items_delete_policy ON public.cart_items
  USING ((((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY notificacoes_select_policy ON public.notificacoes
  USING ((((SELECT auth.uid()) = usuario_id) OR (usuario_id IS NULL) OR (SELECT public.rls_admin_atual())));

ALTER POLICY notificacoes_insert_policy ON public.notificacoes
  WITH CHECK ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY notificacoes_update_policy ON public.notificacoes
  USING ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.rls_admin_atual())))
  WITH CHECK ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY notificacoes_delete_policy ON public.notificacoes
  USING ((((SELECT auth.uid()) = usuario_id) OR (SELECT public.rls_admin_atual())));

ALTER POLICY push_notifications_log_admin_all_policy ON public.push_notifications_log
  USING (((SELECT public.rls_admin_atual())))
  WITH CHECK (((SELECT public.rls_admin_atual())));

ALTER POLICY analytics_events_select_policy ON public.analytics_events
  USING (((SELECT public.rls_admin_atual())));

ALTER POLICY "Admins have full access to shipping credentials" ON public.store_shipping_credentials
  USING (((SELECT public.rls_admin_atual())))
  WITH CHECK (((SELECT public.rls_admin_atual())));

-- CONFERENCIA no instante do apply: aborta (e desfaz tudo) se alguma das 13 nao ficou com a porta nova.
DO $conferencia_20261340$
DECLARE
  r record;
  v_caminho text := current_setting('search_path');
  v_texto text;
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.profiles', 'profiles_select_policy'),
        ('public.profiles', 'profiles_update_policy'),
        ('public.user_addresses', 'user_addresses_all_policy'),
        ('public.push_subscriptions', 'push_subscriptions_all_policy'),
        ('public.cart_items', 'cart_items_select_policy'),
        ('public.cart_items', 'cart_items_delete_policy'),
        ('public.notificacoes', 'notificacoes_select_policy'),
        ('public.notificacoes', 'notificacoes_insert_policy'),
        ('public.notificacoes', 'notificacoes_update_policy'),
        ('public.notificacoes', 'notificacoes_delete_policy'),
        ('public.push_notifications_log', 'push_notifications_log_admin_all_policy'),
        ('public.analytics_events', 'analytics_events_select_policy'),
        ('public.store_shipping_credentials', 'Admins have full access to shipping credentials')
      ) AS alvo(tabela, politica)
  LOOP
    SELECT coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ## ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO v_texto
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica;

    IF v_texto IS NULL OR v_texto !~ 'rls_admin_atual\(\)' OR v_texto ~ 'is_admin\(\)' THEN
      RAISE EXCEPTION 'conferencia 20261340: politica % em % nao ficou com rls_admin_atual() (%).', r.politica, r.tabela, COALESCE(v_texto, 'ausente');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $conferencia_20261340$;

NOTIFY pgrst, 'reload schema';
