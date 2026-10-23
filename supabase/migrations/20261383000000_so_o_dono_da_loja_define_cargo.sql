-- SO O DONO DA LOJA DEFINE CARGO (passo 2 do endurecimento de permissoes; permissao + dado de cliente; 23/10/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum. Muda quem pode mexer em profiles.role:
-- NAO e "so aditiva" no sentido da carta branca (o gatilho novo recusa o que antes passava); so aplicar depois da
-- revisao Opus do SQL e da consulta de estado (papeis contraditorios) em cada loja.
--
-- DEFEITO (o que acontece hoje): a politica profiles_update_policy deixa QUALQUER admin atual alterar profiles.role de
-- QUALQUER pessoa por um PATCH (inclusive rebaixar o dono, ou nomear 5 administradores que nomeiam outros). Nenhuma tela
-- muda papel, mas a porta esta aberta. Decisao de produto (ja tomada, nao reaberta): so o DONO da loja nomeia e remove
-- administradores; administrador nomeado NAO nomeia ninguem; ninguem rebaixa o dono.
--
-- O QUE ENTRA (4 objetos novos; nenhum objeto existente e' redefinido):
--   (1) public.dono_da_loja: no maximo UMA linha por banco (cada loja tem o seu banco): chave boolean fixa em true.
--       RLS ligada; leitura so do proprio dono e do admin atual; NINGUEM escreve por papel de aplicacao (sem GRANT de
--       escrita, sem politica de escrita). Nasce VAZIA (ver "CADASTRO DO DONO").
--   (2) public.cargo_log: quem mudou, de quem, de que cargo para qual, quando. Leitura so do dono e do admin atual; a
--       unica escrita e' o INSERT de definir_cargo.
--   (3) public.definir_cargo(p_user_id uuid, p_cargo text) -> jsonb. SECURITY DEFINER, search_path fixo, EXECUTE so para
--       authenticated. Confere o chamador contra dono_da_loja NO BANCO (nunca contra o JWT nem is_admin()), aceita so
--       'admin' e 'customer' (os valores reais de profiles.role; 'gerente'/'vendedor' existem no CHECK mas nenhuma regra os
--       usa), recusa mexer no dono, grava SEMPRE profiles.role E auth.users.raw_app_meta_data->role (a trava da 20261199,
--       que so sincroniza quando profiles.role MUDA, deixaria o auth.users velho: a funcao forca a escrita) e registra
--       em cargo_log. Repetir o mesmo cargo e' no-op (mudou=false, sem linha de log nova).
--   (4) tr_papel_so_pelo_definir_cargo (BEFORE UPDATE em profiles, nome escolhido de proposito): qualquer mudanca de
--       role feita por papel de aplicacao (o GUC 'role' da sessao = anon/authenticated, a mesma deteccao de is_admin())
--       FORA da janela que definir_cargo abre em volta do proprio UPDATE e' recusada com 42501. Gatilhos BEFORE disparam
--       em ordem alfabetica: tr_ensure_role_protection -> tr_papel_so_pelo_definir_cargo -> tr_perfil_recusa_imagem_grande
--       -> tr_prevent_role_change. Estando DEPOIS do tr_ensure_role_protection, quem nao e' admin continua tendo o papel
--       desfeito EM SILENCIO por ele (o que as provas da 20261199 esperam); so o que sobra (o admin atual de PATCH) bate
--       aqui. O preflight e o posflight CONFEREM essa ordem em cada banco.
--
-- O QUE FICA IGUAL, DE PROPOSITO: ensure_role_protection, prevent_role_change e handle_profile_role_sync_to_auth (nenhum
-- corpo e' redefinido: a lista de sucessoras da 20261199 em tests/banco/sucessoras-da-99.cjs nao muda); a politica
-- profiles_update_policy (o usuario ainda edita o PROPRIO perfil: nome, foto, whatsapp); is_admin() (o painel decide a
-- tela por ela: passo 3). O gatilho novo so recusa papel de APLICACAO (anon/authenticated e qualquer papel que nao seja
-- da lista de confianca); a automacao de confianca (GUC role = service_role/postgres/supabase_admin) e a sessao de login
-- direto nao ganham restricao NOVA daqui (o que as regras antigas, como prevent_role_change, ja decidiam para elas segue
-- igual): elas ja escrevem auth.users e qualquer tabela.
--
-- CADASTRO DO DONO (a migration NAO faz seed; o dono de cada loja e' decidido por consulta no banco, depois do apply).
-- Antes, conferir que a pessoa e' admin NAS DUAS FONTES (auth.users e profiles); depois, como postgres, UMA vez por loja:
--   INSERT INTO public.dono_da_loja (user_id) VALUES ('<uuid-do-dono-em-auth.users>');
-- Trocar de dono (raro, decisao do dono atual): DELETE FROM public.dono_da_loja; e o INSERT acima com o novo uuid.
-- Enquanto a tabela estiver vazia, definir_cargo recusa TODO MUNDO (42501) e o gatilho continua recusando o PATCH: nada
-- afrouxa por esquecimento do cadastro.
--
-- DADOS EXISTENTES: nenhuma linha de profiles, auth.users ou qualquer tabela existente e' lida ou escrita ao aplicar.
-- Quem ja e' admin continua admin (a migration nao rebaixa ninguem); o que muda e' QUEM PODE mudar papel dai em diante.
-- Admins ja nomeados por PATCH antes desta migration seguem admins ate o dono decidir pela funcao nova.
--
-- ATOMICIDADE E REAPLICACAO: sem BEGIN/COMMIT: o aplicador fornece a transacao inteira (molde 20261381). O PRE-VOO aceita,
-- para cada objeto, "ausente" ou "exatamente o desta migration" (corpo por md5 sem CR, atributos, definicao deparseada do
-- gatilho, colunas das tabelas); qualquer outra coisa recusa com B1_BASELINE_DIVERGENT e nada e escrito. Rodar duas vezes
-- deixa o mesmo estado (CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION e
-- CREATE OR REPLACE TRIGGER sao idempotentes; REVOKE/GRANT tambem). O POS-VOO exige TODO o estado novo (incluindo a ordem
-- dos gatilhos); erro aborta a transacao do aplicador e nada fica gravado.
--
-- ORDEM: depois da 20261197, 20261199 (as portas e os tres gatilhos de papel) e 20261340 (politica de profiles). Nao
-- depende de front nem de edge function: nenhuma tela chama definir_cargo ainda (passo 3). Desfazer ESTA antes de desfazer a
-- 20261197 (a politica nova cita rls_admin_atual()); o rollback comum tira as politicas e deixa as tabelas.
--
-- PROVAS: tests/banco/definir-cargo-so-o-dono-viva.cjs (rpc-ci, Postgres efemero): dono nomeia e remove; nomeado nao
-- nomeia; ninguem rebaixa o dono; PATCH direto de admin atual falha; PATCH de cliente continua desfeito em silencio; log
-- gravado; EXECUTE negado a anon; tabelas fechadas; rollback; reaplicar; preflight e posflight divergentes; mutantes.
--
-- RISCOS DECLARADOS:
--   1. Depois do apply e antes do cadastro do dono, ninguem consegue nomear/remover admin (nem por PATCH). Hoje nenhuma tela
--      faz isso; o efeito e' so fechar a porta. Cadastrar o dono logo em seguida (comando acima).
--   2. definir_cargo atravessa tr_ensure_role_protection/tr_prevent_role_change (que decidem pelo JWT e por auth.uid()): o
--      dono precisa ser admin nas duas fontes; senao o papel nao grava e a funcao aborta com erro claro (posverificacao).
--   3. O ex-admin ainda tem o JWT velho por ate ~1 h: tirar o cargo aqui fecha as portas que ja usam o admin ATUAL (passo 1);
--      o painel so passa a derrubar a tela na hora no passo 3.
--
-- ROLLBACK MANUAL: rollback-manual-20261383000000_so_o_dono_da_loja_define_cargo.sql (comum: tira gatilho, funcoes e
-- politicas; preserva tabelas e dados) e rollback-manual-destrutivo-20261383000000_so_o_dono_da_loja_define_cargo.sql (so
-- com o dono: apaga as duas tabelas).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261383000000$
DECLARE
  r record;
  v_def text;
  v_ligado "char";
  v_caminho text;
  v_ordem text[];
  v_colunas text;
BEGIN
  -- Portas do admin atual (20261197): corpo, seguranca e EXECUTE do authenticated em rls_admin_atual().
  FOR r IN SELECT * FROM (VALUES
    ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
    ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
  ) AS porta(assinatura, hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure(r.assinatura)
        AND md5(replace(p.prosrc, chr(13), '')) = r.hash
        AND p.prosecdef) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: porta % ausente ou divergente.', r.assinatura;
    END IF;
  END LOOP;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE de rls_admin_atual() divergente (a politica nova precisa dele para authenticated).';
  END IF;

  -- Tabelas vizinhas e colunas que a funcao toca.
  IF to_regclass('public.profiles') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam public.profiles ou auth.users.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.profiles') AND attname IN ('id', 'role')
        AND NOT attisdropped AND attnum > 0) <> 2
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('auth.users') AND attname IN ('id', 'raw_app_meta_data')
        AND NOT attisdropped AND attnum > 0) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam profiles.id/role ou auth.users.id/raw_app_meta_data.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.profiles') AND relkind = 'r' AND relrowsecurity) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.profiles precisa de RLS ligada.';
  END IF;

  -- Os tres gatilhos de papel da 20261199, como esta migration os supoe (corpo e definicao deparseada, ligados).
  FOR r IN SELECT * FROM (VALUES
    ('public.ensure_role_protection()', '44d677c3fa562318668122aad65fe0df'),
    ('public.prevent_role_change()', '92ff3224c34e3367cdf892579e8176f0'),
    ('public.handle_profile_role_sync_to_auth()', 'e63371757c43ef2619dd613af4635ad3')
  ) AS gatilho(assinatura, hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure(r.assinatura) AND md5(replace(p.prosrc, chr(13), '')) = r.hash) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % nao e o da 20261199000000 (capture o corpo vivo e revise antes de aplicar).', r.assinatura;
    END IF;
  END LOOP;
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('tr_ensure_role_protection', 'CREATE TRIGGER tr_ensure_role_protection BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_role_protection()'),
    ('tr_prevent_role_change', 'CREATE TRIGGER tr_prevent_role_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change()'),
    ('tr_sync_profile_role_to_auth', 'CREATE TRIGGER tr_sync_profile_role_to_auth AFTER INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_profile_role_sync_to_auth()')
  ) AS esperado(gatilho, definicao) LOOP
    SELECT pg_get_triggerdef(t.oid), t.tgenabled INTO v_def, v_ligado FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = r.gatilho AND NOT t.tgisinternal;
    IF NOT FOUND OR v_def IS DISTINCT FROM r.definicao OR v_ligado IS DISTINCT FROM 'O' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gatilho % em public.profiles (%, estado %) nao e o que esta migration supoe.', r.gatilho, COALESCE(v_def, 'ausente'), COALESCE(v_ligado::text, '-');
    END IF;
  END LOOP;
  -- O gatilho NOVO: ausente (primeira aplicacao) ou exatamente o desta migration, ligado.
  SELECT pg_get_triggerdef(t.oid), t.tgenabled INTO v_def, v_ligado FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = 'tr_papel_so_pelo_definir_cargo' AND NOT t.tgisinternal;
  IF FOUND AND (v_def IS DISTINCT FROM 'CREATE TRIGGER tr_papel_so_pelo_definir_cargo BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.papel_so_pelo_definir_cargo()'
                OR v_ligado IS DISTINCT FROM 'O') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gatilho tr_papel_so_pelo_definir_cargo existe e nao e o desta migration (%, estado %).', v_def, v_ligado;
  END IF;
  PERFORM set_config('search_path', v_caminho, true);

  -- Nenhum outro gatilho BEFORE UPDATE de profiles pode cair ENTRE o tr_ensure_role_protection e o nosso: a ordem alfabetica
  -- dos BEFORE de linha em UPDATE, mais o nome novo, precisa deixar tr_ensure < nosso < tr_prevent.
  SELECT array_agg(n ORDER BY n COLLATE "C") INTO v_ordem FROM (
    SELECT t.tgname::text AS n FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
       AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
       AND t.tgname <> 'tr_papel_so_pelo_definir_cargo'
    UNION SELECT 'tr_papel_so_pelo_definir_cargo') x;
  IF array_position(v_ordem, 'tr_ensure_role_protection') IS NULL
     OR array_position(v_ordem, 'tr_prevent_role_change') IS NULL
     OR NOT (array_position(v_ordem, 'tr_ensure_role_protection') < array_position(v_ordem, 'tr_papel_so_pelo_definir_cargo')
         AND array_position(v_ordem, 'tr_papel_so_pelo_definir_cargo') < array_position(v_ordem, 'tr_prevent_role_change')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a ordem dos gatilhos BEFORE UPDATE de profiles (%) nao deixa tr_papel_so_pelo_definir_cargo entre tr_ensure_role_protection e tr_prevent_role_change.', v_ordem;
  END IF;

  -- Objetos proprios: ausentes ou exatamente os desta migration; nunca sobrecarga, nunca outro tipo de relacao.
  IF to_regclass('public.dono_da_loja') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
      INTO v_colunas FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.dono_da_loja') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.dono_da_loja') AND relkind = 'r')
       OR v_colunas IS DISTINCT FROM 'loja:boolean:true,user_id:uuid:true,desde:timestamp with time zone:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.dono_da_loja existe e nao tem a forma desta migration (%).', v_colunas;
    END IF;
  END IF;
  IF to_regclass('public.cargo_log') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
      INTO v_colunas FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.cargo_log') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.cargo_log') AND relkind = 'r')
       OR v_colunas IS DISTINCT FROM 'id:uuid:true,em:timestamp with time zone:true,quem:uuid:true,alvo:uuid:true,de_cargo:text:false,para_cargo:text:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.cargo_log existe e nao tem a forma desta migration (%).', v_colunas;
    END IF;
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'definir_cargo') > 1
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'papel_so_pelo_definir_cargo') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: definir_cargo ou papel_so_pelo_definir_cargo tem sobrecarga em public.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.definir_cargo(uuid,text)')
       AND md5(replace(prosrc, chr(13), '')) <> '69258350cbaf598b1e0b8e0bf2f20211')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.papel_so_pelo_definir_cargo()')
       AND md5(replace(prosrc, chr(13), '')) <> '4db62affedb4d07d5ea9e26393fb938c')
     OR (to_regprocedure('public.definir_cargo(uuid,text)') IS NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'definir_cargo')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo vivo de definir_cargo ou do gatilho nao e o desta migration (sucessora no ar?) - nao reaplique por cima.';
  END IF;
END $preflight_20261383000000$;

-- ===== (1) quem e' o dono da loja =====

CREATE TABLE IF NOT EXISTS public.dono_da_loja (
  loja boolean NOT NULL DEFAULT true,
  user_id uuid NOT NULL,
  desde timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dono_da_loja_pkey PRIMARY KEY (loja),
  CONSTRAINT dono_da_loja_uma_so_check CHECK (loja),
  CONSTRAINT dono_da_loja_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.dono_da_loja IS 'No maximo UMA linha por banco (loja): quem e o dono. Nasce vazia; so o postgres escreve (INSERT manual depois do apply). Ninguem de aplicacao escreve.';

ALTER TABLE public.dono_da_loja ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dono_da_loja FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.dono_da_loja TO authenticated, service_role;

DROP POLICY IF EXISTS dono_da_loja_select_policy ON public.dono_da_loja;
CREATE POLICY dono_da_loja_select_policy ON public.dono_da_loja
  FOR SELECT TO authenticated
  USING (((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual()));

-- ===== (2) o registro de quem mudou o cargo de quem =====

CREATE TABLE IF NOT EXISTS public.cargo_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  em timestamptz NOT NULL DEFAULT now(),
  quem uuid NOT NULL,
  alvo uuid NOT NULL,
  de_cargo text,
  para_cargo text NOT NULL,
  CONSTRAINT cargo_log_pkey PRIMARY KEY (id),
  CONSTRAINT cargo_log_para_cargo_check CHECK (para_cargo IN ('admin', 'customer'))
);
COMMENT ON TABLE public.cargo_log IS 'Historico de cargos: quem (o dono) mudou o cargo de quem (alvo), de que cargo para qual. Sem FK de proposito: o registro sobrevive a quem sai. So definir_cargo insere.';
CREATE INDEX IF NOT EXISTS cargo_log_em_idx ON public.cargo_log (em DESC);

ALTER TABLE public.cargo_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cargo_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cargo_log TO authenticated, service_role;

DROP POLICY IF EXISTS cargo_log_select_policy ON public.cargo_log;
CREATE POLICY cargo_log_select_policy ON public.cargo_log
  FOR SELECT TO authenticated
  USING ((SELECT public.rls_admin_atual()) OR ((SELECT auth.uid()) = quem));

-- ===== (3) a unica porta que muda cargo =====

CREATE OR REPLACE FUNCTION public.definir_cargo(p_user_id uuid, p_cargo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_quem uuid := auth.uid();
    v_de text;
    v_de_auth text;
    v_de_log text;
    v_mudou boolean;
    v_depois text;
BEGIN
    -- 1. Quem chama: o DONO, conferido na tabela do banco. Nunca o JWT nem a porta de admin do JWT.
    IF v_quem IS NULL OR NOT EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_quem) THEN
        RAISE EXCEPTION 'Acesso negado: só o dono da loja define cargos.' USING ERRCODE = '42501';
    END IF;

    -- 2. Entrada: a pessoa e um dos dois cargos reais de profiles.role.
    IF p_user_id IS NULL OR p_cargo IS NULL OR p_cargo NOT IN ('admin', 'customer') THEN
        RAISE EXCEPTION 'Cargo inválido: informe a pessoa e use admin ou customer.' USING ERRCODE = '22023';
    END IF;

    -- 3. O dono nao muda (nem por ele mesmo).
    IF EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = p_user_id) THEN
        RAISE EXCEPTION 'O cargo do dono da loja não muda.' USING ERRCODE = '42501';
    END IF;

    -- 4. A pessoa existe nas DUAS fontes do papel. A linha do profiles fica travada: duas chamadas sobre a mesma pessoa
    --    se enfileiram e a segunda ve o resultado da primeira.
    SELECT p.role INTO v_de FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pessoa não encontrada.' USING ERRCODE = 'P0002';
    END IF;
    SELECT u.raw_app_meta_data ->> 'role' INTO v_de_auth FROM auth.users u WHERE u.id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pessoa não encontrada.' USING ERRCODE = 'P0002';
    END IF;

    v_mudou := v_de IS DISTINCT FROM p_cargo OR v_de_auth IS DISTINCT FROM p_cargo;
    v_de_log := CASE WHEN v_de IS DISTINCT FROM p_cargo THEN v_de ELSE v_de_auth END;

    -- 5. Grava profiles.role dentro da janela que o gatilho tr_papel_so_pelo_definir_cargo reconhece (esta pessoa, este
    --    cargo, so em volta deste UPDATE). Os outros gatilhos de papel podem desfazer o UPDATE em silencio; por isso a
    --    releitura logo abaixo.
    IF v_de IS DISTINCT FROM p_cargo THEN
        PERFORM set_config('ikcous.definir_cargo', p_user_id::text || ':' || p_cargo, true);
        UPDATE public.profiles SET role = p_cargo WHERE id = p_user_id;
        PERFORM set_config('ikcous.definir_cargo', '', true);
        SELECT p.role INTO v_depois FROM public.profiles p WHERE p.id = p_user_id;
        IF v_depois IS DISTINCT FROM p_cargo THEN
            RAISE EXCEPTION 'O cargo não foi gravado: confira se o dono é administrador nas duas fontes (auth.users e profiles).' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 6. auth.users SEMPRE: o gatilho de sincronia so copia quando profiles.role MUDA, entao uma pessoa que ja era
    --    'customer' em profiles mas 'admin' em auth.users (ou o contrario) ficaria como estava.
    UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_cargo)
     WHERE id = p_user_id
       AND (raw_app_meta_data ->> 'role') IS DISTINCT FROM p_cargo;

    -- 7. Registro: so quando algo mudou (repetir o mesmo cargo nao suja o historico).
    IF v_mudou THEN
        INSERT INTO public.cargo_log (quem, alvo, de_cargo, para_cargo)
        VALUES (v_quem, p_user_id, v_de_log, p_cargo);
    END IF;

    RETURN jsonb_build_object('user_id', p_user_id, 'de', v_de_log, 'para', p_cargo, 'mudou', v_mudou);
END;
$function$;

REVOKE ALL ON FUNCTION public.definir_cargo(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_cargo(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.definir_cargo(uuid, text) IS 'Unica porta que muda cargo: so o dono da loja (dono_da_loja), so admin/customer, nunca o dono; grava profiles.role e auth.users e registra em cargo_log.';

-- ===== (4) o gatilho: nenhum outro caminho muda cargo =====

CREATE OR REPLACE FUNCTION public.papel_so_pelo_definir_cargo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    -- Nada a vigiar: o papel nao mudou (inclui o UPDATE que regrava o mesmo valor).
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
        RETURN NEW;
    END IF;

    -- A janela que public.definir_cargo abre em volta do proprio UPDATE: vale so para esta pessoa e este cargo E so quando
    -- o UPDATE roda como o DONO da funcao (SECURITY DEFINER): o GUC sozinho nao basta, porque qualquer sessao com SQL pode
    -- grava-lo, mas ninguem de aplicacao (authenticated) vira o dono da funcao.
    IF current_setting('ikcous.definir_cargo', true) = NEW.id::text || ':' || COALESCE(NEW.role, '')
       AND current_user = (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid = to_regprocedure('public.definir_cargo(uuid,text)')) THEN
        RETURN NEW;
    END IF;

    -- Automacao de confianca: o GUC 'role' da sessao (a mesma deteccao que as portas de admin usam). O PostgREST poe
    -- anon/authenticated em TODA requisicao de aplicacao e o usuario nao o altera; 'none' e' a sessao de login direto
    -- (SQL editor, migrations). Este gatilho NAO acrescenta restricao a elas (prevent_role_change continua decidindo, como
    -- antes). Papel de aplicacao desconhecido NAO esta na lista: recusa.
    IF COALESCE(current_setting('role', true), '') IN ('', 'none', 'postgres', 'service_role', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'O cargo só muda pela função definir_cargo (e só o dono da loja a usa).' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.papel_so_pelo_definir_cargo() FROM PUBLIC, anon, authenticated, service_role;

-- Nome entre tr_ensure_role_protection e tr_prevent_role_change (ordem alfabetica dos gatilhos BEFORE).
CREATE OR REPLACE TRIGGER tr_papel_so_pelo_definir_cargo
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.papel_so_pelo_definir_cargo();

DO $posflight_20261383000000$
DECLARE
  r record;
  v_def text;
  v_ligado "char";
  v_caminho text;
  v_ordem text[];
  v_qual text;
  v_cmd text;
  v_roles text;
BEGIN
  -- Funcoes: corpo, atributos, ACL.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.definir_cargo(uuid,text)')
        AND md5(replace(p.prosrc, chr(13), '')) = '69258350cbaf598b1e0b8e0bf2f20211'
        AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict
        AND pg_get_function_result(p.oid) = 'jsonb' AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[])
     OR has_function_privilege('anon', 'public.definir_cargo(uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.definir_cargo(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.definir_cargo(uuid,text)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = to_regprocedure('public.definir_cargo(uuid,text)') AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL de definir_cargo divergentes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.papel_so_pelo_definir_cargo()')
        AND md5(replace(p.prosrc, chr(13), '')) = '4db62affedb4d07d5ea9e26393fb938c'
        AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND pg_get_function_result(p.oid) = 'trigger'
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[])
     OR has_function_privilege('anon', 'public.papel_so_pelo_definir_cargo()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.papel_so_pelo_definir_cargo()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.papel_so_pelo_definir_cargo()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = to_regprocedure('public.papel_so_pelo_definir_cargo()') AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL do gatilho papel_so_pelo_definir_cargo divergentes.';
  END IF;

  -- Tabelas: RLS ligada (sem FORCE), nenhum privilegio de escrita para ninguem de aplicacao, leitura so do authenticated
  -- (e service_role); anon e PUBLIC nada.
  FOR r IN SELECT unnest(ARRAY['public.dono_da_loja', 'public.cargo_log']) AS tabela LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(r.tabela) AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity)
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
           WHERE c.oid = to_regclass(r.tabela) AND a.grantee <> c.relowner
             AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')))
             AND a.privilege_type <> 'SELECT')
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
           WHERE c.oid = to_regclass(r.tabela) AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon')))
       OR NOT has_table_privilege('authenticated', r.tabela, 'SELECT')
       OR has_any_column_privilege('anon', r.tabela, 'SELECT') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RLS ou privilegios de % divergentes.', r.tabela;
    END IF;
  END LOOP;

  -- Politicas (forma deparseada com search_path = pg_catalog, como nas outras migrations).
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('public.dono_da_loja', 'dono_da_loja_select_policy', '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))'),
    ('public.cargo_log', 'cargo_log_select_policy', '(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (( SELECT auth.uid() AS uid) = quem))')
  ) AS esperado(tabela, politica, qual) LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), p.polcmd::text,
           array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END FROM unnest(p.polroles) x ORDER BY 1), ',')
      INTO v_qual, v_cmd, v_roles FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica AND p.polpermissive AND p.polwithcheck IS NULL;
    IF NOT FOUND OR v_cmd IS DISTINCT FROM 'r' OR v_roles IS DISTINCT FROM 'authenticated' OR v_qual IS DISTINCT FROM r.qual THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % divergente (USING %).', r.politica, r.tabela, v_qual;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN (to_regclass('public.dono_da_loja'), to_regclass('public.cargo_log'))) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: dono_da_loja e cargo_log tem de ter exatamente uma politica cada (SELECT).';
  END IF;

  -- O gatilho e a ORDEM entre os BEFORE UPDATE de profiles.
  SELECT pg_get_triggerdef(t.oid), t.tgenabled INTO v_def, v_ligado FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = 'tr_papel_so_pelo_definir_cargo' AND NOT t.tgisinternal;
  IF NOT FOUND
     OR v_def IS DISTINCT FROM 'CREATE TRIGGER tr_papel_so_pelo_definir_cargo BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.papel_so_pelo_definir_cargo()'
     OR v_ligado IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gatilho tr_papel_so_pelo_definir_cargo ausente, diferente ou desligado (%).', v_def;
  END IF;
  PERFORM set_config('search_path', v_caminho, true);
  SELECT array_agg(t.tgname::text ORDER BY t.tgname COLLATE "C") INTO v_ordem FROM pg_trigger t
   WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
     AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16;
  IF NOT (array_position(v_ordem, 'tr_ensure_role_protection') < array_position(v_ordem, 'tr_papel_so_pelo_definir_cargo')
          AND array_position(v_ordem, 'tr_papel_so_pelo_definir_cargo') < array_position(v_ordem, 'tr_prevent_role_change')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ordem dos gatilhos BEFORE UPDATE de profiles: %.', v_ordem;
  END IF;
END $posflight_20261383000000$;

NOTIFY pgrst, 'reload schema';
