-- AS VISITAS DA LOJA PASSAM A SER CONTADAS PELO PORTEIRO (linha B da spec "Visitas da loja"; 02/11/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria 1 tabela e 2 funcoes
-- NOVAS; nenhuma funcao, politica, gatilho, grant ou tabela que ja existia e' redefinido ou removido (crm_visao, que calcula dinheiro,
-- NAO e' tocada).
--
-- O DEFEITO: o funil do CRM mostra "visitas" como vazio de proposito (um numero inventado seria pior que a ausencia). A lojista nao sabe
-- quantas vezes abriram a loja nem por qual canal. A contagem sera feita no PORTEIRO (middleware da Vercel, que atende todo documento da
-- loja por host), nunca no pacote do cliente. ESTA migration e' so o BANCO dessa contagem: onde ela mora, quem a soma e quem a le.
-- O porteiro (que chama contar_entrada) e o painel (que chama crm_visitas) sao de outras linhas e vem DEPOIS desta no ar.
--
-- O QUE ENTRA (3 objetos novos):
--   (1) public.visitas_por_dia(dia date, canal text, contagem integer), chave (dia, canal). Uma linha por dia e canal, e SO ISSO:
--       CHECK dos 5 canais (direto, instagram, whatsapp, outros_sites = pessoas; previa = robo ou previa de link, que NUNCA entra em
--       "visitas"); contagem nunca negativa. RLS LIGADA sem politica nenhuma e REVOKE ALL de PUBLIC, anon, authenticated e service_role:
--       o Supabase concede tudo a objeto novo por padrao e as lojas clonadas tem ACL de fabrica diferente, entao o fechamento e' explicito.
--       Ninguem de aplicacao le nem escreve a tabela; so as duas funcoes abaixo (SECURITY DEFINER, do dono da tabela) passam.
--   (2) public.contar_entrada(p_canal text) RETURNS void: a ESCRITA, chamavel por anon (o porteiro so tem a chave PUBLICA da loja).
--   (3) public.crm_visitas(p_inicio date, p_fim date) RETURNS jsonb: a LEITURA, so do admin atual (as duas travas de crm_visao).
--
-- SEGURANCA - a unica porta nova do visitante e' contar_entrada. O pior caso de um estranho com a chave publica e' o que esta escrito aqui:
--   * NAO LE nada: devolve void (sem RETURN, sem RETURNING, sem SELECT); a resposta e' sempre vazia, com ou sem canal valido.
--   * NAO ESCOLHE data: a funcao tem UM argumento, o canal. O dia vem de public.fin__hoje() (o dia de Sao Paulo, a mesma regua do CRM),
--     nunca de parametro e nunca do relogio do servidor sem fuso.
--   * NAO GRAVA texto: o canal e' conferido contra a lista fechada de 5 valores ANTES de qualquer escrita (NULL e qualquer outro texto
--     recebem 22023, sem tocar a tabela), e a mesma lista ainda esta no CHECK da tabela (duas fechaduras independentes).
--   * NAO CRIA LINHA ALEM DE 5 POR DIA: a chave e' (dia, canal), o dia e' o de hoje e o canal e' um dos 5.
--   * O CONTADOR PARA EM 50000 por dia e canal: o UPDATE do ON CONFLICT so soma enquanto contagem < 50000; passado disso a chamada
--     NAO da erro e NAO soma. Teto de crescimento da tabela inteira: 5 linhas por dia, cada uma com um inteiro ate 50000.
--   * O QUE UM ESTRANHO CONSEGUE: inflar, ate 50000 em cada um dos 5 contadores de HOJE, o numero de entradas daquele dia (so enche o
--     numero, nunca o dado de ninguem). Custo de CPU de uma chamada por RPC e' o de qualquer outra porta aberta ao visitante; o teto limita
--     o DADO, nao a quantidade de chamadas. A linha quente (hoje, canal) serializa as chamadas pelo bloqueio de linha, por poucos ms cada.
--   * Sem credencial de escrita por loja e sem INSERT em tabela alguma para o visitante: nenhum GRANT de tabela existe neste arquivo.
--
-- A LEITURA (crm_visitas) devolve {contando_desde, visitas, canais:[{canal, visitas} x4], previas, periodo_completo}:
--   contando_desde    o MENOR dia da tabela (a primeira entrada contada prova que o contador estava ligado); NULL se a tabela esta vazia.
--   visitas           NULL se a tabela esta vazia OU o periodo inteiro e' anterior a contando_desde (nunca um 0 enganoso); senao a soma dos
--                     4 canais de PESSOA entre max(p_inicio, contando_desde) e p_fim. A previa nao entra.
--   canais            sempre os 4 canais de pessoa, na ordem direto, instagram, whatsapp, outros_sites; visitas NULL quando o total e' NULL.
--   previas           a soma do canal 'previa' no mesmo recorte (fora da conta de visitas); NULL quando visitas e' NULL.
--   periodo_completo  true quando o contador ja estava ligado no primeiro dia do periodo (contando_desde <= p_inicio).
--   Mesmas guardas de crm_visao: is_admin() E is_admin_atual() (42501) e periodo valido de ate 400 dias (22023).
--
-- DADOS EXISTENTES: nenhuma linha de tabela alguma e' lida, reescrita ou apagada pela migration. A tabela nasce VAZIA (nao ha
-- backfill: nao se inventa visita passada). Reaplicar nao zera nem soma contagem: CREATE TABLE IF NOT EXISTS nao toca a tabela que ja
-- existe e as funcoes sao recriadas com o mesmo corpo.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e
-- fazem COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Idempotente: IF NOT EXISTS na
-- tabela, CREATE OR REPLACE nas funcoes e REVOKE/GRANT de ACL explicita; rodar duas vezes nao erra e nao muda a contagem. Nenhum
-- objeto existente e travado alem do catalogo; o lock_timeout de 5s faz a migration FALHAR em vez de esperar.
-- APLICAR ANTES de publicar o porteiro e o painel desta linha: o porteiro tolera a funcao ausente (404 = silencio por alguns minutos)
-- e o painel trata a ausencia como "indisponivel", mas so conta e le depois que esta migration estiver no banco de CADA loja.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem escrever se faltar public.fin__hoje() (date), public.is_admin() ou
-- public.is_admin_atual() (boolean), um dos papeis anon, authenticated e service_role, ou se ja existir uma visitas_por_dia com forma
-- diferente, ou contar_entrada/crm_visitas com corpo desconhecido, sobrecarga ou outra assinatura.
-- POS-VOO (B2_POSVOO_DIVERGENTE): confere a tabela comum com RLS ligada (sem FORCE) e sem politica, nenhum privilegio de anon,
-- authenticated, service_role ou PUBLIC nela, as colunas, a chave, os dois CHECK e o default; e, em cada funcao, o corpo (md5),
-- SECURITY DEFINER, volatilidade, search_path fixo, retorno e ACL (contar_entrada: anon, authenticated e service_role; crm_visitas:
-- authenticated e service_role, nunca anon; PUBLIC nunca).
--
-- ROLLBACK: rollback-manual-20261399000000_as_visitas_da_loja_contam_pelo_porteiro.sql PARA a conta e a leitura (derruba as duas
-- funcoes) e MANTEM a tabela e as linhas. rollback-manual-destrutivo-20261399000000_... apaga a tabela (so com confirmacao explicita,
-- depois do comum); as contagens nao se reconstroem. TIPOS: src/types/database.types.ts nao muda aqui (e' da linha do painel).
-- Sem BEGIN/COMMIT: o aplicador controla a transacao (com eles o ROLLBACK da prova viraria no-op e a mudanca ficaria gravada).
-- FICHA DE VERIFICACAO: consultas 117a (depois) e 117b (antes); prova viva tests/banco/as-visitas-da-loja-viva.cjs (rpc-ci).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_20261399000000$
DECLARE
  v_forma text;
  v_hash text;
  v_oid oid;
  v_f record;
BEGIN
  IF to_regprocedure('public.fin__hoje()') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam public.fin__hoje(), public.is_admin() ou public.is_admin_atual() - aplique a 20261177000000 e a 20261197000000 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.fin__hoje()') AND prorettype = 'date'::regtype)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.is_admin()') AND prorettype = 'boolean'::regtype)
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()') AND prorettype = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin__hoje() tem de devolver date e is_admin()/is_admin_atual() boolean.';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papeis anon, authenticated ou service_role.';
  END IF;

  IF to_regclass('public.visitas_por_dia') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.visitas_por_dia') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.visitas_por_dia') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'canal:text:true,contagem:integer:true,dia:date:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.visitas_por_dia existe e nao tem a forma desta migration (%).', v_forma;
    END IF;
  END IF;

  FOR v_f IN
    SELECT * FROM (VALUES
      ('contar_entrada', 'public.contar_entrada(text)', '86d4bedb06ac94a8ef70e6455792518e'),
      ('crm_visitas', 'public.crm_visitas(date, date)', '5fc0e010d21d65c8731df760ad30e2ba')
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
END $preflight_20261399000000$;

-- ===== (1) a tabela: fechada a todo papel de aplicacao =====

CREATE TABLE IF NOT EXISTS public.visitas_por_dia (
  dia date NOT NULL,
  canal text NOT NULL,
  contagem integer NOT NULL DEFAULT 0,
  CONSTRAINT visitas_por_dia_pkey PRIMARY KEY (dia, canal),
  CONSTRAINT visitas_por_dia_canal_check CHECK (canal IN ('direto', 'instagram', 'whatsapp', 'outros_sites', 'previa')),
  CONSTRAINT visitas_por_dia_contagem_check CHECK (contagem >= 0)
);

COMMENT ON TABLE public.visitas_por_dia IS 'Entradas na loja contadas pelo porteiro: uma linha por dia (de Sao Paulo) e canal. Canais de pessoa: direto, instagram, whatsapp, outros_sites; previa = robo ou previa de link (fora de visitas). Ninguem de aplicacao le nem escreve a tabela: escreve contar_entrada, le crm_visitas.';

ALTER TABLE public.visitas_por_dia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.visitas_por_dia FROM PUBLIC, anon, authenticated, service_role;

-- ===== (2) a escrita: a unica porta nova do visitante =====

CREATE OR REPLACE FUNCTION public.contar_entrada(p_canal text)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF p_canal IS NULL OR p_canal NOT IN ('direto', 'instagram', 'whatsapp', 'outros_sites', 'previa') THEN
    RAISE EXCEPTION 'Canal invalido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.visitas_por_dia AS v (dia, canal, contagem)
  VALUES (public.fin__hoje(), p_canal, 1)
  ON CONFLICT (dia, canal) DO UPDATE SET contagem = v.contagem + 1 WHERE v.contagem < 50000;
END;
$function$;

REVOKE ALL ON FUNCTION public.contar_entrada(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.contar_entrada(text) IS 'Porteiro: soma 1 entrada de hoje (dia de Sao Paulo) no canal pedido. Devolve nada, nao aceita data, canal fora da lista = 22023, o contador de cada canal para no teto diario sem erro.';

-- ===== (3) a leitura: so o admin atual =====

CREATE OR REPLACE FUNCTION public.crm_visitas(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_desde date;
  v_de date;
  v_direto bigint;
  v_instagram bigint;
  v_whatsapp bigint;
  v_outros bigint;
  v_previa bigint;
  v_pessoas bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), nao o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Periodo invalido (ate 400 dias).' USING ERRCODE = '22023';
  END IF;

  SELECT min(dia) INTO v_desde FROM public.visitas_por_dia;

  -- Tabela vazia, ou periodo inteiro anterior ao contador: ausencia, nunca zero.
  IF v_desde IS NULL OR p_fim < v_desde THEN
    RETURN jsonb_build_object(
      'contando_desde', v_desde,
      'visitas', NULL::bigint,
      'canais', jsonb_build_array(
        jsonb_build_object('canal', 'direto', 'visitas', NULL::bigint),
        jsonb_build_object('canal', 'instagram', 'visitas', NULL::bigint),
        jsonb_build_object('canal', 'whatsapp', 'visitas', NULL::bigint),
        jsonb_build_object('canal', 'outros_sites', 'visitas', NULL::bigint)
      ),
      'previas', NULL::bigint,
      'periodo_completo', false
    );
  END IF;

  v_de := GREATEST(p_inicio, v_desde);

  SELECT COALESCE(sum(contagem) FILTER (WHERE canal = 'direto'), 0),
         COALESCE(sum(contagem) FILTER (WHERE canal = 'instagram'), 0),
         COALESCE(sum(contagem) FILTER (WHERE canal = 'whatsapp'), 0),
         COALESCE(sum(contagem) FILTER (WHERE canal = 'outros_sites'), 0),
         COALESCE(sum(contagem) FILTER (WHERE canal = 'previa'), 0)
    INTO v_direto, v_instagram, v_whatsapp, v_outros, v_previa
    FROM public.visitas_por_dia
   WHERE dia BETWEEN v_de AND p_fim;

  v_pessoas := v_direto + v_instagram + v_whatsapp + v_outros;

  RETURN jsonb_build_object(
    'contando_desde', v_desde,
    'visitas', v_pessoas,
    'canais', jsonb_build_array(
      jsonb_build_object('canal', 'direto', 'visitas', v_direto),
      jsonb_build_object('canal', 'instagram', 'visitas', v_instagram),
      jsonb_build_object('canal', 'whatsapp', 'visitas', v_whatsapp),
      jsonb_build_object('canal', 'outros_sites', 'visitas', v_outros)
    ),
    'previas', v_previa,
    'periodo_completo', v_desde <= p_inicio
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_visitas(date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_visitas(date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_visitas(date, date) IS 'Painel (so o admin atual): entradas da loja no periodo, por canal de pessoa, mais as previas de link fora da conta. visitas = NULL quando ainda nao ha contagem para o periodo.';

-- ===== pos-voo =====

DO $conferencia_20261399000000$
DECLARE
  v_tab oid := to_regclass('public.visitas_por_dia');
  v_papel text;
  v_privilegio text;
  v_f record;
  v_oid oid;
  v_hash text;
BEGIN
  IF v_tab IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_tab AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: visitas_por_dia tem de ser tabela comum com a RLS ligada (sem FORCE).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_tab) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: visitas_por_dia nao pode ter politica: a RLS sem politica e a segunda fechadura.';
  END IF;
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_papel, v_tab, v_privilegio) THEN
        RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem % em visitas_por_dia.', v_papel, v_privilegio;
      END IF;
    END LOOP;
    IF has_any_column_privilege(v_papel, v_tab, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem privilegio de coluna em visitas_por_dia.', v_papel;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              WHERE c.oid = v_tab AND a.grantee = 0) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC tem privilegio em visitas_por_dia.';
  END IF;

  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
        FROM pg_attribute a WHERE a.attrelid = v_tab AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'canal:text:true,contagem:integer:true,dia:date:true'
     OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                     WHERE d.adrelid = v_tab AND a.attname = 'contagem' AND pg_get_expr(d.adbin, d.adrelid) = '0')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'p'
                      AND pg_get_constraintdef(k.oid) = 'PRIMARY KEY (dia, canal)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c'
                      AND (SELECT array_agg(m[1] ORDER BY m[1]) FROM regexp_matches(pg_get_constraintdef(k.oid), '''([a-z_]+)''::text', 'g') AS m)
                          = ARRAY['direto', 'instagram', 'outros_sites', 'previa', 'whatsapp']::text[]
                      AND pg_get_constraintdef(k.oid) LIKE 'CHECK ((canal = ANY%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_tab AND k.contype = 'c'
                      AND replace(pg_get_constraintdef(k.oid), ' ', '') = 'CHECK((contagem>=0))')
     OR (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = v_tab) <> 3 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: as colunas, o default, a chave ou os dois CHECK de visitas_por_dia nao sao os desta migration.';
  END IF;

  FOR v_f IN
    SELECT * FROM (VALUES
      ('contar_entrada', 'public.contar_entrada(text)', '86d4bedb06ac94a8ef70e6455792518e', 'void', 'v', true),
      ('crm_visitas', 'public.crm_visitas(date, date)', '5fc0e010d21d65c8731df760ad30e2ba', 'jsonb', 's', false)
    ) AS t(nome, assinatura, hash, retorno, volatilidade, aberta_ao_visitante)
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
                      AND pg_get_function_result(p.oid) = v_f.retorno
                      AND p.proconfig = ARRAY['search_path=public']::text[]) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, retorno).', v_f.assinatura;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % alcancavel por PUBLIC.', v_f.assinatura;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.aberta_ao_visitante THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de % esta errado (authenticated e service_role sempre; anon so na contar_entrada).', v_f.assinatura;
    END IF;
  END LOOP;
END $conferencia_20261399000000$;

NOTIFY pgrst, 'reload schema';
