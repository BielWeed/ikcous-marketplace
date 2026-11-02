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
--   (2) public.contar_entrada(p_canal text) RETURNS void: a ESCRITA, chamavel por anon e service_role (o porteiro so tem a chave PUBLICA da loja).
--   (3) public.crm_visitas(p_inicio date, p_fim date) RETURNS jsonb: a LEITURA, so do admin atual (as duas travas de crm_visao).
--
-- SEGURANCA - a unica porta nova do visitante e' contar_entrada. O pior caso de um estranho com a chave publica e' o que esta escrito aqui:
--   * NAO LE nada para fora: devolve void (sem RETURN com valor, sem RETURNING); a unica leitura da funcao e' a do teto, para uma variavel
--     interna; a resposta e' sempre vazia, com ou sem canal valido.
--   * NAO ESCOLHE data: a funcao tem UM argumento, o canal. O dia vem de public.fin__hoje() (o dia de Sao Paulo, a mesma regua do CRM),
--     nunca de parametro e nunca do relogio do servidor sem fuso.
--   * NAO GRAVA texto: o canal e' conferido contra a lista fechada de 5 valores ANTES de qualquer escrita (NULL e qualquer outro texto
--     recebem 22023, sem tocar a tabela), e a mesma lista ainda esta no CHECK da tabela (duas fechaduras independentes).
--   * NAO CRIA LINHA ALEM DE 5 POR DIA: a chave e' (dia, canal), o dia e' o de hoje e o canal e' um dos 5.
--   * O CONTADOR PARA EM 50000 por dia e canal: o UPDATE do ON CONFLICT so soma enquanto contagem < 50000; passado disso a chamada
--     NAO da erro e NAO soma. Teto de crescimento da tabela inteira: 5 linhas por dia, cada uma com um inteiro ate 50000.
--   * A LINHA QUENTE (hoje, canal) NAO TRAVA NO TETO: o ON CONFLICT DO UPDATE trava a linha mesmo quando a WHERE barra o update, entao
--     antes dele a funcao le a contagem SEM trava e SAI se ela ja esta no teto (nenhuma escrita, nenhum bloqueio de linha). Abaixo do
--     teto o ON CONFLICT segue sendo a barreira que vale (a leitura sem trava so poupa trabalho; ela nunca deixa passar do teto).
--     Quem chega com a linha travada por outra transacao espera NO MAXIMO 100 ms (SET lock_timeout na definicao da funcao) e recebe
--     55P03: perder uma entrada num pico e' aceito, travar a conexao do porteiro nao.
--   * NAO ESPERA O DISCO: o commit da chamada e' assincrono (set_config LOCAL de synchronous_commit no corpo, vale so para esta
--     transacao); perder uma entrada num crash do servidor e' aceito. Fica no CORPO e nao como clausula SET da definicao porque o
--     Postgres restaura a clausula na saida da funcao, antes do commit (medido: com a clausula o WAL continua sincronizado no commit).
--   * O QUE UM ESTRANHO CONSEGUE: inflar, ate 50000 em cada um dos 5 contadores de HOJE, o numero de entradas daquele dia (so enche o
--     numero, nunca o dado de ninguem) - e por isso a leitura devolve no_teto, a lista dos dias e canais que bateram no teto, para o
--     painel avisar que aquela contagem nao e' confiavel. Custo de CPU de uma chamada por RPC e' o de qualquer outra porta aberta ao
--     visitante; o teto limita o DADO, nao a quantidade de chamadas.
--   * Quem executa: SO anon (o porteiro usa a chave publica) e service_role; authenticated NAO (a sessao de um logado nunca entra aqui).
--   * Sem credencial de escrita por loja e sem INSERT em tabela alguma para o visitante: nenhum GRANT de tabela existe neste arquivo.
--
-- A LEITURA (crm_visitas) devolve {contando_desde, visitas, canais:[{canal, visitas} x4], previas, periodo_completo, no_teto}:
--   contando_desde    o MENOR dia da tabela (a primeira entrada contada prova que o contador estava ligado); NULL se a tabela esta vazia.
--   visitas           NULL se a tabela esta vazia OU o periodo inteiro e' anterior a contando_desde (nunca um 0 enganoso); senao a soma dos
--                     4 canais de PESSOA entre max(p_inicio, contando_desde) e p_fim. A previa nao entra.
--   canais            sempre os 4 canais de pessoa, na ordem direto, instagram, whatsapp, outros_sites; visitas NULL quando o total e' NULL.
--   previas           a soma do canal 'previa' no mesmo recorte (fora da conta de visitas); NULL quando visitas e' NULL.
--   periodo_completo  true quando o contador ja estava ligado no primeiro dia do periodo (contando_desde <= p_inicio).
--   no_teto           lista de {dia, canal} (dia ISO 'YYYY-MM-DD') dos pares que chegaram a 50000 dentro do periodo consultado, SO dos
--                     4 canais de pessoa (a previa nunca entra: previa inflada nao invalida a contagem de pessoas), ordenada por dia e
--                     canal; [] quando nenhum (tambem quando visitas e' NULL). Um par aqui e' contagem NAO confiavel: o numero real
--                     pode ser maior (ou ter sido inflado por quem tem a chave publica).
--   Mesmas guardas de crm_visao, com a MESMA checagem de periodo: is_admin() E is_admin_atual() (42501) e periodo nulo, invertido ou de
--   mais de 400 dias = 22023 com a mesma mensagem.
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
-- SECURITY DEFINER, volatilidade, a configuracao da funcao (search_path e, na contar_entrada, lock_timeout), retorno e ACL
-- (contar_entrada: anon e service_role, nunca authenticated; crm_visitas: authenticated e service_role, nunca anon; PUBLIC nunca).
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
      ('contar_entrada', 'public.contar_entrada(text)', 'e31b3fd92a739ff7b5c206ef0ece1c22'),
      ('crm_visitas', 'public.crm_visitas(date, date)', '025c19ac6d1ce86617dba41b5ba8b73c')
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
 SET lock_timeout = '100ms'
AS $function$
DECLARE
  v_dia date := public.fin__hoje();
  v_atual integer;
BEGIN
  IF p_canal IS NULL OR p_canal NOT IN ('direto', 'instagram', 'whatsapp', 'outros_sites', 'previa') THEN
    RAISE EXCEPTION 'Canal invalido.' USING ERRCODE = '22023';
  END IF;

  -- No teto a funcao sai sem tocar a linha: o ON CONFLICT abaixo travaria a linha mesmo com a WHERE barrando a soma.
  SELECT v.contagem INTO v_atual FROM public.visitas_por_dia v WHERE v.dia = v_dia AND v.canal = p_canal;
  IF v_atual >= 50000 THEN
    RETURN;
  END IF;

  -- Commit sem esperar o disco, so desta transacao (perder uma entrada num crash e' aceito).
  PERFORM set_config('synchronous_commit', 'off', true);

  INSERT INTO public.visitas_por_dia AS v (dia, canal, contagem)
  VALUES (v_dia, p_canal, 1)
  ON CONFLICT (dia, canal) DO UPDATE SET contagem = v.contagem + 1 WHERE v.contagem < 50000;
END;
$function$;

REVOKE ALL ON FUNCTION public.contar_entrada(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contar_entrada(text) TO anon, service_role;
COMMENT ON FUNCTION public.contar_entrada(text) IS 'Porteiro: soma 1 entrada de hoje (dia de Sao Paulo) no canal pedido. Devolve nada, nao aceita data, canal fora da lista = 22023, o contador de cada canal para no teto diario sem erro e sem tocar a linha. So anon e service_role executam.';

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
  v_no_teto jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), nao o do JWT: admin rebaixado para aqui.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
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
      'periodo_completo', false,
      'no_teto', '[]'::jsonb
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

  -- Os dias e canais de PESSOA que chegaram ao teto: a contagem deles nao e confiavel. A previa fica de fora (inflada, nao invalida pessoas).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('dia', dia, 'canal', canal) ORDER BY dia, canal), '[]'::jsonb)
    INTO v_no_teto
    FROM public.visitas_por_dia
   WHERE dia BETWEEN v_de AND p_fim
     AND canal <> 'previa'
     AND contagem >= 50000;

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
    'periodo_completo', v_desde <= p_inicio,
    'no_teto', v_no_teto
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_visitas(date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_visitas(date, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_visitas(date, date) IS 'Painel (so o admin atual): entradas da loja no periodo, por canal de pessoa, mais as previas de link fora da conta e os dias e canais de pessoa que bateram no teto (no_teto, contagem nao confiavel). visitas = NULL quando ainda nao ha contagem para o periodo.';

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
      ('contar_entrada', 'public.contar_entrada(text)', 'e31b3fd92a739ff7b5c206ef0ece1c22', 'void', 'v',
        ARRAY['search_path=public', 'lock_timeout=100ms']::text[], true, false),
      ('crm_visitas', 'public.crm_visitas(date, date)', '025c19ac6d1ce86617dba41b5ba8b73c', 'jsonb', 's',
        ARRAY['search_path=public']::text[], false, true)
    ) AS t(nome, assinatura, hash, retorno, volatilidade, config, anon_executa, authenticated_executa)
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
                      AND p.proconfig = v_f.config) THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: os atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, lock_timeout, retorno).', v_f.assinatura;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % alcancavel por PUBLIC.', v_f.assinatura;
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.anon_executa
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') IS DISTINCT FROM v_f.authenticated_executa THEN
      RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: o EXECUTE de % esta errado (service_role sempre; contar_entrada so anon; crm_visitas so authenticated).', v_f.assinatura;
    END IF;
  END LOOP;
END $conferencia_20261399000000$;

NOTIFY pgrst, 'reload schema';
