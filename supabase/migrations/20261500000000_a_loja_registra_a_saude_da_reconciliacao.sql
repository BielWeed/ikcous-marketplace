-- A LOJA REGISTRA A SAUDE DA RECONCILIACAO (26/11/2026; plano VIGIA DA FROTA, lado da loja: o app de gestao do dono confere, de fora e so com a chave PUBLICA,
-- se a reconciliacao de pagamentos de cada loja esta rodando)
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria 1 tabela e 2 funcoes NOVAS; nenhuma funcao, politica,
-- gatilho, grant ou tabela que ja existia e' redefinido ou removido.
--
-- O DEFEITO: a reconciliacao (edge reconciliar-pagamentos, chamada pelo pg_cron a cada 10 min) e' quem acha o PIX pago cujo aviso se perdeu. Sem os segredos do Vault
-- (reconciliacao_url / reconciliacao_secret) o cron monta uma URL nula e ela NUNCA roda (20260808000100_reconciliacao.sql) — em silencio: o cron diz "succeeded", nenhuma
-- tela mostra nada. Com segredo divergente, 401 a cada 10 min, tambem em silencio. Ninguem de fora da loja tinha como saber.
--
-- O SINAL: BATIMENTO. A propria edge grava, no fim de cada rodada que passou da autenticacao, "rodei agora, degradei ou nao, e quais etapas falharam". Quem confere olha
-- a IDADE da ultima rodada: nula ou alta = a reconciliacao parou (qualquer que seja a causa: Vault, segredo, function fora do ar, pg_cron parado, projeto pausado).
--
-- O QUE ENTRA (3 objetos novos):
--   (1) public.saude_da_reconciliacao: a linha unica (id = 1) do batimento. Colunas: ultima_rodada_em (quando a ultima rodada terminou), ultima_saudavel_em (a ultima
--       rodada sem etapa com falha; NULL se ainda nao houve nenhuma), degradado, etapas_com_falha (subconjunto de pagamentos, cancelamentos, estornos, contestacoes, na
--       ordem da edge) e rodadas_degradadas_seguidas (>= 0). CHECKs: id = 1, etapas na lista das 4, contador >= 0, e degradado SE E SO SE ha etapa com falha.
--       RLS ligada SEM politica e REVOKE ALL de PUBLIC, anon, authenticated e service_role: ninguem de aplicacao le nem escreve a tabela; so as duas funcoes abaixo
--       (SECURITY DEFINER, do dono da tabela) passam. O Supabase concede tudo a objeto novo por padrao e as lojas clonadas tem ACL de fabrica diferente: o fechamento e'
--       explicito.
--   (2) public.saude_da_reconciliacao_registrar(p_degradado boolean, p_etapas_com_falha text[]) RETURNS void: a porta da EDGE. EXECUTE SO do service_role (a edge chama
--       com a chave de servico da loja; anon, authenticated e PUBLIC nao). Recusa com 'valor_invalido' (22023, nome do campo no DETAIL) e SEM gravar: p_degradado nulo,
--       lista nula, etapa nula ou fora das 4, e incoerencia (degradado sem etapa, ou etapa sem degradado). Etapa repetida vira uma so, na ordem fixa das 4.
--       GRAVA por UM comando atomico (INSERT ... ON CONFLICT (id) DO UPDATE): ultima_rodada_em = now() sempre; na rodada BOA o contador ZERA e ultima_saudavel_em anda
--       para now(); na RUIM o contador SOMA 1 (a partir do valor da linha travada: duas rodadas simultaneas somam 2, nunca 1) e ultima_saudavel_em fica onde estava.
--   (3) public.saude_da_loja() RETURNS jsonb, STABLE: a LEITURA de quem confere. EXECUTE de anon e authenticated (o app de gestao chama com a chave PUBLICA da loja por
--       POST /rest/v1/rpc/saude_da_loja); service_role e PUBLIC nao. Devolve {medidor: 1, ultima_rodada_em, idade_rodada_s, ultima_saudavel_em, idade_saudavel_s,
--       degradado, rodadas_degradadas_seguidas} — tudo nulo (menos medidor) se a reconciliacao nunca registrou. As idades sao calculadas NO BANCO da
--       loja (segundos inteiros, now() da transacao): o relogio de quem pergunta nao entra. NENHUMA contagem de pagamento, pedido, valor ou cliente sai daqui: o que
--       se expoe ao publico e' so "a reconciliacao roda, e esta degradada?". QUAIS etapas falharam (etapas_com_falha) NAO sai pela leitura publica
--       (revisao de 26/11: estorno ou contestacao com problema e' informacao da loja, nao do publico); fica na tabela, para o dono e para os logs.
--
-- DADOS EXISTENTES: nenhuma linha de tabela alguma e' lida, reescrita ou apagada pelo apply. A tabela nasce VAZIA; a primeira rodada da reconciliacao DEPOIS do deploy da
-- edge cria a linha. Ate la saude_da_loja() responde tudo nulo (= "nunca registrou"), que e' o mesmo alarme de reconciliacao parada — de proposito.
-- Reaplicar nao apaga o batimento guardado: CREATE TABLE IF NOT EXISTS nao toca a tabela que ja existe e as funcoes sao recriadas com o mesmo corpo.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e fazem COMMIT; qualquer erro, inclusive o
-- pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui (com eles o ROLLBACK da prova viraria no-op). Idempotente: IF NOT EXISTS na tabela,
-- CREATE OR REPLACE nas funcoes e REVOKE/GRANT de ACL explicita; rodar duas vezes nao erra e nao muda a linha guardada.
-- Independe de qualquer migration anterior (so cria objetos novos). ORDEM DE PUBLICACAO: esta migration ANTES da edge reconciliar-pagamentos que chama a porta. Ao
-- contrario, nada quebra: a edge que chama a porta ausente recebe erro, so o loga (nome do erro) e responde EXATAMENTE como antes; so o batimento fica sem gravar.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem escrever se faltarem os papeis anon/authenticated/service_role; se saude_da_reconciliacao existir com outra forma
-- (colunas, tipos, NOT NULL); ou se registrar/saude_da_loja existirem com corpo desconhecido, outra assinatura ou sobrecarga (so se aceita ausente ou igual ao desta
-- migration).
-- POS-VOO (B2_POSVOO_DIVERGENTE): confere a tabela (comum, RLS ligada sem FORCE, zero politica, nenhum privilegio de PUBLIC/anon/authenticated/service_role nem de coluna,
-- colunas, chave e os 4 CHECKs) e, em cada funcao, o corpo (md5), SECURITY DEFINER, volatilidade, search_path, argumentos, retorno, o EXECUTE por papel e que o dono
-- alcanca a tabela. Catalogo apenas: o pos-voo NAO chama as funcoes (registrar gravaria um batimento sem rodada nenhuma).
--
-- ROLLBACK: rollback-manual-20261500000000_a_loja_registra_a_saude_da_reconciliacao.sql tira as DUAS funcoes e MANTEM a tabela e a linha (a edge que chamar a porta
-- passa a receber 404 PGRST202 e so loga; o app de gestao ve "sem medidor"). rollback-manual-destrutivo-20261500000000_... apaga a tabela (so depois do comum, com
-- SET app.confirmo_apagar_saude_da_reconciliacao = 'APAGAR'): perde-se so o ultimo batimento, que a proxima rodada recria depois de reaplicar.
-- TIPOS: src/types/database.types.ts ganha a tabela e as duas funcoes.
-- FICHA DE VERIFICACAO: consultas 187b (antes) e 187a (depois); prova viva tests/banco/a-loja-registra-a-saude-da-reconciliacao-viva.cjs (rpc-ci). Os md5 dos corpos:
--   saude_da_reconciliacao_registrar(boolean, text[]) = '06c25460eb479a7a98fc1abd4f384dfd'
--   saude_da_loja()                                   = '511a9587f5d94666b8639e89a0128624'

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261500000000$
DECLARE
  v_forma text;
  v_hash text;
  v_oid oid;
  v_f record;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;

  IF to_regclass('public.saude_da_reconciliacao') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.saude_da_reconciliacao') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.saude_da_reconciliacao') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'degradado:boolean:true,etapas_com_falha:text[]:true,id:smallint:true,rodadas_degradadas_seguidas:integer:true,ultima_rodada_em:timestamp with time zone:true,ultima_saudavel_em:timestamp with time zone:false' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.saude_da_reconciliacao existe e nao tem a forma desta migration (%).', v_forma;
    END IF;
  END IF;

  FOR v_f IN
    SELECT * FROM (VALUES
      ('saude_da_reconciliacao_registrar', 'public.saude_da_reconciliacao_registrar(boolean, text[])', '06c25460eb479a7a98fc1abd4f384dfd'),
      ('saude_da_loja', 'public.saude_da_loja()', '511a9587f5d94666b8639e89a0128624')
    ) AS t(nome, assinatura, hash)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) > 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - revise antes de aplicar.', v_f.nome;
    END IF;
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NOT NULL THEN
      SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
      IF v_hash IS DISTINCT FROM v_f.hash THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ja existe com corpo desconhecido (hash %) - ninguem revisou essa redefinicao; capture o corpo vivo e revise antes de aplicar.', v_f.assinatura, COALESCE(v_hash, 'ausente');
      END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe em public com outra assinatura - revise antes de aplicar.', v_f.nome;
    END IF;
  END LOOP;
END $preflight_20261500000000$;

-- ===== (1) a tabela do batimento: fechada a todo papel de aplicacao =====

CREATE TABLE IF NOT EXISTS public.saude_da_reconciliacao (
  id smallint NOT NULL,
  ultima_rodada_em timestamptz NOT NULL,
  ultima_saudavel_em timestamptz,
  degradado boolean NOT NULL,
  etapas_com_falha text[] NOT NULL,
  rodadas_degradadas_seguidas integer NOT NULL,
  CONSTRAINT saude_da_reconciliacao_pkey PRIMARY KEY (id),
  CONSTRAINT saude_da_reconciliacao_id_check CHECK (id = 1),
  CONSTRAINT saude_da_reconciliacao_etapas_check CHECK (etapas_com_falha <@ ARRAY['pagamentos', 'cancelamentos', 'estornos', 'contestacoes']::text[]),
  CONSTRAINT saude_da_reconciliacao_contador_check CHECK (rodadas_degradadas_seguidas >= 0),
  CONSTRAINT saude_da_reconciliacao_coerencia_check CHECK (degradado = (cardinality(etapas_com_falha) > 0))
);

COMMENT ON TABLE public.saude_da_reconciliacao IS 'Batimento da reconciliacao de pagamentos desta loja (linha unica, id = 1): quando foi a ultima rodada, se degradou e quais etapas falharam. Grava so a edge reconciliar-pagamentos, por saude_da_reconciliacao_registrar; le quem confere, por saude_da_loja(). Ninguem de aplicacao le nem escreve direto.';

ALTER TABLE public.saude_da_reconciliacao ENABLE ROW LEVEL SECURITY;
-- As lojas clonadas tem ACL de fabrica diferente: o REVOKE e' explicito, nunca depende do default.
REVOKE ALL ON TABLE public.saude_da_reconciliacao FROM PUBLIC, anon, authenticated, service_role;

-- ===== (2) a porta da edge: registrar a rodada (so service_role) =====

CREATE OR REPLACE FUNCTION public.saude_da_reconciliacao_registrar(p_degradado boolean, p_etapas_com_falha text[])
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ordem CONSTANT text[] := ARRAY['pagamentos', 'cancelamentos', 'estornos', 'contestacoes'];
  v_etapas text[];
BEGIN
  IF p_degradado IS NULL THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: p_degradado';
  END IF;
  IF p_etapas_com_falha IS NULL
     OR EXISTS (SELECT 1 FROM unnest(p_etapas_com_falha) AS e(nome) WHERE e.nome IS NULL OR e.nome <> ALL (v_ordem)) THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: p_etapas_com_falha';
  END IF;

  -- Uma vez cada, na ordem fixa das 4 (a ordem da resposta da edge).
  v_etapas := ARRAY(SELECT o.nome FROM unnest(v_ordem) WITH ORDINALITY AS o(nome, n) WHERE o.nome = ANY (p_etapas_com_falha) ORDER BY o.n);

  -- Degradado SE E SO SE alguma etapa falhou: e' assim que a edge calcula, e o contrario seria um batimento que mente.
  IF p_degradado <> (cardinality(v_etapas) > 0) THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: p_degradado';
  END IF;

  -- UM comando atomico: na corrida entre duas rodadas, a segunda espera a linha da primeira e soma em cima dela.
  INSERT INTO public.saude_da_reconciliacao AS s (id, ultima_rodada_em, ultima_saudavel_em, degradado, etapas_com_falha, rodadas_degradadas_seguidas)
  VALUES (1, now(), CASE WHEN p_degradado THEN NULL ELSE now() END, p_degradado, v_etapas, CASE WHEN p_degradado THEN 1 ELSE 0 END)
  ON CONFLICT (id) DO UPDATE SET
    ultima_rodada_em = EXCLUDED.ultima_rodada_em,
    ultima_saudavel_em = CASE WHEN EXCLUDED.degradado THEN s.ultima_saudavel_em ELSE EXCLUDED.ultima_rodada_em END,
    degradado = EXCLUDED.degradado,
    etapas_com_falha = EXCLUDED.etapas_com_falha,
    rodadas_degradadas_seguidas = CASE WHEN EXCLUDED.degradado THEN s.rodadas_degradadas_seguidas + 1 ELSE 0 END;
END;
$function$;

REVOKE ALL ON FUNCTION public.saude_da_reconciliacao_registrar(boolean, text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.saude_da_reconciliacao_registrar(boolean, text[]) TO service_role;
COMMENT ON FUNCTION public.saude_da_reconciliacao_registrar(boolean, text[]) IS 'Porta da edge reconciliar-pagamentos: registra o fim de uma rodada (degradada ou nao, e quais das 4 etapas falharam). Contador de rodadas degradadas seguidas zera na boa e soma na ruim; ultima_saudavel_em so anda na boa. So service_role executa.';

-- ===== (3) a leitura de quem confere (anon e authenticated) =====

CREATE OR REPLACE FUNCTION public.saude_da_loja()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v public.saude_da_reconciliacao%ROWTYPE;
BEGIN
  -- Sem linha: v fica toda nula e a resposta diz "nunca registrou" (o mesmo alarme de reconciliacao parada).
  -- A coluna das etapas com falha fica FORA de proposito: a leitura e publica, e dizer qual etapa falha (estorno, contestacao) contaria a qualquer um
  -- que a loja tem problema de dinheiro. Quem precisa do detalhe olha a tabela como dono ou os logs da function.
  SELECT * INTO v FROM public.saude_da_reconciliacao s WHERE s.id = 1;
  RETURN jsonb_build_object(
    'medidor', 1,
    'ultima_rodada_em', v.ultima_rodada_em,
    'idade_rodada_s', floor(extract(epoch FROM (now() - v.ultima_rodada_em)))::bigint,
    'ultima_saudavel_em', v.ultima_saudavel_em,
    'idade_saudavel_s', floor(extract(epoch FROM (now() - v.ultima_saudavel_em)))::bigint,
    'degradado', v.degradado,
    'rodadas_degradadas_seguidas', v.rodadas_degradadas_seguidas);
END;
$function$;

REVOKE ALL ON FUNCTION public.saude_da_loja() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.saude_da_loja() TO anon, authenticated;
COMMENT ON FUNCTION public.saude_da_loja() IS 'Saude da reconciliacao de pagamentos desta loja, para quem confere de fora com a chave publica: quando foi a ultima rodada e a ultima saudavel (com a idade em segundos calculada aqui), se degradou e ha quantas rodadas seguidas. Nunca QUAIS etapas falharam nem contagem de pagamento. Tudo nulo (menos medidor) = nunca registrou.';

-- ===== pos-voo =====

DO $posvoo_20261500000000$
DECLARE
  v_tab oid := to_regclass('public.saude_da_reconciliacao');
  v_papel text;
  v_privilegio text;
  v_f record;
  v_oid oid;
  v_hash text;
  v_dono oid;
BEGIN
  IF v_tab IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_tab AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: saude_da_reconciliacao tem de ser tabela comum com a RLS ligada (sem FORCE).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_tab) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: saude_da_reconciliacao nao pode ter politica: a RLS sem politica e a segunda fechadura.';
  END IF;
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_papel, v_tab, v_privilegio) THEN
        RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem % em saude_da_reconciliacao.', v_papel, v_privilegio;
      END IF;
    END LOOP;
    IF has_any_column_privilege(v_papel, v_tab, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem privilegio de coluna em saude_da_reconciliacao.', v_papel;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              WHERE c.oid = v_tab AND a.grantee = 0) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC tem privilegio em saude_da_reconciliacao.';
  END IF;

  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
        FROM pg_attribute a WHERE a.attrelid = v_tab AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'degradado:boolean:true,etapas_com_falha:text[]:true,id:smallint:true,rodadas_degradadas_seguidas:integer:true,ultima_rodada_em:timestamp with time zone:true,ultima_saudavel_em:timestamp with time zone:false'
     OR EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = v_tab)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'p' AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (id)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c' AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((id=1))')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c'
                      AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((etapas_com_falha<@ARRAY[''pagamentos''::text,''cancelamentos''::text,''estornos''::text,''contestacoes''::text]))')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c' AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((rodadas_degradadas_seguidas>=0))')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c'
                      AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((degradado=(cardinality(etapas_com_falha)>0)))')
     OR (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = v_tab) <> 5 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: as colunas, a chave ou os CHECKs de saude_da_reconciliacao nao sao os desta migration.';
  END IF;

  FOR v_f IN
    SELECT * FROM (VALUES
      ('saude_da_reconciliacao_registrar', 'public.saude_da_reconciliacao_registrar(boolean, text[])', '06c25460eb479a7a98fc1abd4f384dfd',
       'p_degradado boolean, p_etapas_com_falha text[]', 'void', 'v', true, false, false),
      ('saude_da_loja', 'public.saude_da_loja()', '511a9587f5d94666b8639e89a0128624',
       '', 'jsonb', 's', false, true, true)
    ) AS t(nome, assinatura, hash, argumentos, retorno, volatilidade, service_role_executa, anon_executa, authenticated_executa)
  LOOP
    v_oid := to_regprocedure(v_f.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % sumiu.', v_f.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f.nome) <> 1 THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % ficou com sobrecarga.', v_f.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM v_f.hash THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: corpo vivo de % (hash %) nao e o desta migration.', v_f.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = v_f.volatilidade
                      AND NOT p.proretset AND NOT p.proisstrict
                      AND pg_get_function_identity_arguments(p.oid) = v_f.argumentos
                      AND pg_get_function_result(p.oid) = v_f.retorno
                      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, argumentos, retorno).', v_f.assinatura;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % alcancavel por PUBLIC.', v_f.assinatura;
    END IF;
    IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.service_role_executa
       OR has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.anon_executa
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.authenticated_executa THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de % esta errado (registrar so service_role; saude_da_loja so anon e authenticated).', v_f.assinatura;
    END IF;
    -- O dono da funcao e' quem le/escreve a tabela (SECURITY DEFINER): ou e' dono dela, ou passa a RLS (superusuario / BYPASSRLS).
    SELECT p.proowner INTO v_dono FROM pg_proc p WHERE p.oid = v_oid;
    IF NOT (EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = v_dono AND (r.rolsuper OR r.rolbypassrls))
            OR v_dono = (SELECT relowner FROM pg_class WHERE oid = v_tab)) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de % nao passa a RLS de saude_da_reconciliacao.', v_f.assinatura;
    END IF;
    -- has_table_privilege com lista devolve verdadeiro se tiver QUALQUER uma: um a um.
    FOREACH v_privilegio IN ARRAY CASE WHEN v_f.nome = 'saude_da_loja' THEN ARRAY['SELECT'] ELSE ARRAY['SELECT', 'INSERT', 'UPDATE'] END LOOP
      IF NOT has_table_privilege(v_dono, v_tab, v_privilegio) THEN
        RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o dono de % nao tem % em saude_da_reconciliacao.', v_f.assinatura, v_privilegio;
      END IF;
    END LOOP;
  END LOOP;
END $posvoo_20261500000000$;

NOTIFY pgrst, 'reload schema';
