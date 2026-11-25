-- A LOJA GUARDA O CADASTRO FISCAL, E SO O DONO ALTERA (Gestao Fiscal, fase 1; permissao + dado de cliente; 24/11/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum. ADITIVA pelos criterios da carta branca: nao apaga tabela,
-- coluna nem dado, nao le nem escreve linha de tabela existente (cria 2 tabelas VAZIAS e 1 funcao; nenhum objeto existente
-- e' redefinido). Mesmo assim cria uma porta de ESCRITA com permissao (SECURITY DEFINER): so aplicar depois da revisao Opus do
-- SQL e da consulta de estado (180b: objetos ausentes; 88c: o dono ja cadastrado na loja).
--
-- DEFEITO (o que falta hoje): a loja nao tem onde dizer qual e' o regime da empresa (MEI, Simples Nacional, Lucro Presumido,
-- Lucro Real ou "nao sei, meu contador cuida") nem a atividade (so comercio ou tem servico). Sem isso a aba Impostos do
-- Financeiro nao sabe se pode mostrar conta, e nunca deve ADIVINHAR um regime. Cada loja tem o seu: o app nao supoe nenhum.
--
-- O QUE ENTRA (3 objetos novos; nenhum objeto existente e' redefinido):
--   (1) public.fiscal_cadastro: no maximo UMA linha por banco (cada loja tem o seu banco): chave boolean fixa em true.
--       Colunas: regime e atividade (obrigatorios, com CHECK), aberta_em (data de abertura da empresa, opcional),
--       vende_no_app_desde (mes em que comecou a vender pelo app, opcional, SEMPRE dia 1), atualizado_em e atualizado_por
--       (quem gravou por ultimo; sem FK de proposito: a linha e a trilha sobrevivem a quem sai e nao seguram a exclusao de conta).
--       Nasce VAZIA: sem semente, sem regime padrao, sem atividade padrao. "Sem cadastro" e' o estado de toda loja no dia em
--       que a versao chega, e a tela diz isso em vez de supor.
--       RLS ligada; REVOKE ALL de PUBLIC/anon/authenticated/service_role e GRANT SELECT so a authenticated e service_role;
--       UMA politica de leitura (admin atual); NENHUM grant e NENHUMA politica de escrita: ninguem de aplicacao escreve.
--   (2) public.fiscal_cadastro_log: id (identity), quem, quando, antes e depois (jsonb com os 4 campos do cadastro). Mesmas
--       travas de acesso. A sequencia do identity tambem fica sem grant para papel de aplicacao. Sem FK, pelo mesmo motivo.
--   (3) public.fiscal_cadastro_salvar(p jsonb) -> jsonb. SECURITY DEFINER, search_path = public, EXECUTE so para authenticated.
--       A UNICA porta que grava. Ordem das guardas (a recusa de dono vem ANTES de qualquer validacao: sem oraculo):
--         a. o chamador (auth.uid()) tem de estar em public.dono_da_loja, conferido NO BANCO, nunca no JWT. Tabela do dono
--            vazia = todo mundo recusado (42501), igual a definir_cargo: a loja sem dono nao altera cadastro fiscal;
--         b. SOMADO ao dono (nunca no lugar): is_admin_atual() (admin de AGORA nas duas fontes, auth.users e profiles). Dono
--            rebaixado, ou com papeis contraditorios, recusa (42501);
--         c. valida o payload (22023): objeto JSON; regime em mei/simples/presumido/real/nao_sei; atividade em
--            comercio/com_servico; aberta_em e vende_no_app_desde ausentes, null ou texto AAAA-MM-DD de data real;
--            vende_no_app_desde so no dia 1. FAIXA plausivel (22023): aberta_em entre 1900-01-01 e hoje; vende_no_app_desde nao
--            antes de 2020-01-01, nao num mes que ainda nao comecou e, havendo aberta_em, nao antes do mes da abertura; "hoje" e'
--            o dia de America/Sao_Paulo, nunca o relogio nem o fuso do servidor. Campo que nao e' do cadastro (cnpj, por exemplo) e' IGNORADO e nunca gravado:
--            o CNPJ mora em store_config, nao aqui. O payload e' a foto INTEIRA do formulario, nao um remendo: campo opcional
--            ausente grava vazio;
--         d. trava a tabela (LOCK ... SHARE ROW EXCLUSIVE: so entre gravadores, a leitura nao espera) para que a trilha
--            encadeie: duas chamadas simultaneas se enfileiram e o "antes" da segunda e' o "depois" da primeira, tambem
--            quando a tabela ainda esta vazia (nao ha linha para trancar);
--         e. se os 4 campos sao iguais aos de agora: NAO grava, NAO toca atualizado_em/atualizado_por e NAO registra (devolve a
--            linha como esta). Se mudou: INSERT ... ON CONFLICT (id) DO UPDATE e UMA linha em fiscal_cadastro_log
--            (quem, antes, depois), na mesma chamada, portanto na mesma transacao: sem o log, a linha tambem nao fica;
--         f. devolve a linha (jsonb).
--
-- O QUE FICA IGUAL, DE PROPOSITO: fin_dre, fin_previstos, fin_extrato, fin_lancamento_salvar e fin__movimentos (nenhum corpo e'
-- tocado; a prova viva confere que o md5 do corpo do fin_dre e' o mesmo antes e depois de aplicar, sem constante), is_admin_atual(),
-- rls_admin_atual(), dono_da_loja, definir_cargo e todas as politicas e grants existentes. Nenhuma estimativa, nenhum valor de lei e nenhum CNPJ moram aqui.
--
-- CADASTRO DO DONO: esta migration NAO cadastra o dono (decisao do dono do produto, loja por loja; ver
-- docs/runbooks/definir-o-dono-da-loja.md). Enquanto dono_da_loja estiver vazia, fiscal_cadastro_salvar recusa TODO MUNDO
-- (42501) e o cadastro fiscal so e' lido; a tela da aba Impostos explica o caminho. Nada afrouxa por esquecimento.
--
-- DADOS EXISTENTES: nenhuma linha de nenhuma tabela existente e' lida ou escrita ao aplicar; as duas tabelas nascem vazias.
-- Quem ja e' admin continua admin; ninguem ganha nem perde acesso a nada que ja existia. Aplicar de novo sobre linhas que ja
-- estavam la (cadastro e trilha) nao as toca: CREATE TABLE IF NOT EXISTS pula a tabela existente.
--
-- ATOMICIDADE E REAPLICACAO: sem BEGIN/COMMIT: o aplicador fornece a transacao inteira (molde 20261383). O PRE-VOO exige o
-- que esta migration SUPOE (a 20261197, a 20261383 e a 20261202 no estado vigente) e aceita, para cada objeto proprio,
-- "ausente" ou "exatamente o desta migration" (colunas das tabelas, corpo da funcao por md5 sem CR, sem sobrecarga);
-- qualquer outra coisa recusa com B1_BASELINE_DIVERGENT e nada e' escrito. O POS-VOO exige TODO o estado novo (corpo,
-- atributos e ACL da funcao; RLS, privilegios, constraints (so os NOMES) e politicas das tabelas; sequencia sem grant);
-- erro aborta a transacao do aplicador e nada fica gravado. Rodar duas vezes deixa o mesmo estado (CREATE TABLE IF NOT
-- EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION, REVOKE/GRANT idempotentes).
--
-- ORDEM: depois da 20261197 (is_admin_atual e rls_admin_atual), da 20261202 (a politica de admin atual de fin_lancamentos) e
-- da 20261383 (dono_da_loja). Esta migration nao le nem redefine o corpo do fin_dre: uma migration anterior que o redefina nao
-- a afeta (nenhuma constante de md5 do fin_dre, aqui ou na prova). Banco ANTES do front: a aba Impostos chama esta funcao. Desfazer ESTA antes de desfazer a 20261197 ou a 20261383
-- (a funcao cita dono_da_loja e a politica cita rls_admin_atual()); o rollback comum tira a funcao e as politicas e deixa as
-- tabelas.
--
-- PROVAS: tests/banco/o-cadastro-fiscal-so-o-dono-altera-viva.cjs (rpc-ci, Postgres efemero): tabelas nascem vazias; sem dono
-- ninguem grava; dono grava e o log ganha uma linha; repetir nao gera log; admin que nao e' dono, dono rebaixado, cliente,
-- anon, service_role e postgres recusam; leitura (admin le, cliente le vazio, anon negado); escrita direta negada;
-- validacao 22023 (inclusive a faixa das datas, com os limites exatos e o "hoje" de Sao Paulo); concorrencia; fin_dre intocado
-- (md5 igual antes e depois); reaplicar; rollback comum e destrutivo; pre-voo e pos-voo divergentes;
-- mutantes (sem conferir o dono, sem is_admin_atual, politica `true`, entre outros).
--
-- RISCOS DECLARADOS:
--   1. Depois do apply e antes do cadastro do dono, ninguem grava o cadastro fiscal (a aba Impostos mostra "sem dono
--      cadastrado" e o caminho). Hoje nada chama a funcao: o efeito e' so existir a porta, fechada.
--   2. O dono cadastrado que nao e' admin nas duas fontes recusa (42501), em vez de gravar com papeis contraditorios.
--   3. O JWT velho do ex-admin vale ~1 h, mas a funcao e a politica olham o banco (is_admin_atual), nunca o JWT.
--   4. LOCK TABLE: uma chamada lenta segura as outras gravacoes do cadastro (uma por loja, raras); leituras nao esperam.
--
-- ROLLBACK MANUAL: rollback-manual-20261440000000_a_loja_guarda_o_cadastro_fiscal.sql (comum: tira a funcao e as politicas;
-- preserva as tabelas e as linhas, seladas) e rollback-manual-destrutivo-20261440000000_a_loja_guarda_o_cadastro_fiscal.sql
-- (so com o dono: apaga as duas tabelas).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261440000000$
DECLARE
  r record;
  v_caminho text;
  v_qual text;
  v_cmd text;
  v_roles text;
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: porta % ausente ou divergente (a 20261197 e a base desta migration).', r.assinatura;
    END IF;
  END LOOP;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE de rls_admin_atual() divergente (a politica nova precisa dele para authenticated).';
  END IF;

  -- O dono da loja (20261383): a tabela como a 20261383 a deixa, com RLS ligada. Sem ela a funcao recusaria todo mundo.
  IF to_regclass('public.dono_da_loja') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.dono_da_loja ausente (aplique a 20261383000000 antes desta).';
  END IF;
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
    INTO v_colunas FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.dono_da_loja') AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.dono_da_loja') AND relkind = 'r' AND relrowsecurity)
     OR v_colunas IS DISTINCT FROM 'loja:boolean:true,user_id:uuid:true,desde:timestamp with time zone:true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.dono_da_loja nao tem a forma da 20261383 ou esta sem RLS (%).', v_colunas;
  END IF;

  -- A politica de admin atual de fin_lancamentos (20261202), deparseada com search_path = pg_catalog (nomes qualificados).
  IF to_regclass('public.fin_lancamentos') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fin_lancamentos ausente.';
  END IF;
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT pg_get_expr(p.polqual, p.polrelid), p.polcmd::text,
         array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END FROM unnest(p.polroles) x ORDER BY 1), ',')
    INTO v_qual, v_cmd, v_roles FROM pg_policy p
   WHERE p.polrelid = to_regclass('public.fin_lancamentos') AND p.polname = 'fin_lancamentos_admin_select_policy'
     AND p.polpermissive AND p.polwithcheck IS NULL;
  PERFORM set_config('search_path', v_caminho, true);
  IF v_cmd IS DISTINCT FROM 'r' OR v_roles IS DISTINCT FROM 'authenticated'
     OR v_qual IS DISTINCT FROM '( SELECT public.rls_admin_atual() AS rls_admin_atual)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a politica fin_lancamentos_admin_select_policy ausente ou diferente da 20261202 (USING %).', COALESCE(v_qual, 'ausente');
  END IF;

  -- Objetos proprios: ausentes ou exatamente os desta migration; nunca sobrecarga, nunca outro tipo de relacao.
  IF to_regclass('public.fiscal_cadastro') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
      INTO v_colunas FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.fiscal_cadastro') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.fiscal_cadastro') AND relkind = 'r')
       OR v_colunas IS DISTINCT FROM 'id:boolean:true,regime:text:true,atividade:text:true,aberta_em:date:false,vende_no_app_desde:date:false,atualizado_em:timestamp with time zone:true,atualizado_por:uuid:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fiscal_cadastro existe e nao tem a forma desta migration (%).', v_colunas;
    END IF;
  END IF;
  IF to_regclass('public.fiscal_cadastro_log') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
      INTO v_colunas FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.fiscal_cadastro_log') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.fiscal_cadastro_log') AND relkind = 'r')
       OR v_colunas IS DISTINCT FROM 'id:bigint:true,quem:uuid:true,quando:timestamp with time zone:true,antes:jsonb:false,depois:jsonb:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fiscal_cadastro_log existe e nao tem a forma desta migration (%).', v_colunas;
    END IF;
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fiscal_cadastro_salvar') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fiscal_cadastro_salvar tem sobrecarga em public.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.fiscal_cadastro_salvar(jsonb)')
       AND md5(replace(prosrc, chr(13), '')) <> '198c24062f62dd29aae1f96fcaed6603')
     OR (to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fiscal_cadastro_salvar')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo vivo de fiscal_cadastro_salvar nao e o desta migration (sucessora no ar?) - nao reaplique por cima.';
  END IF;
END $preflight_20261440000000$;

-- ===== (1) o cadastro fiscal da loja: uma linha so, nasce vazia =====

CREATE TABLE IF NOT EXISTS public.fiscal_cadastro (
  id boolean NOT NULL DEFAULT true,
  regime text NOT NULL,
  atividade text NOT NULL,
  aberta_em date,
  vende_no_app_desde date,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid NOT NULL,
  CONSTRAINT fiscal_cadastro_pkey PRIMARY KEY (id),
  CONSTRAINT fiscal_cadastro_uma_so_check CHECK (id),
  CONSTRAINT fiscal_cadastro_regime_check CHECK (regime IN ('mei', 'simples', 'presumido', 'real', 'nao_sei')),
  CONSTRAINT fiscal_cadastro_atividade_check CHECK (atividade IN ('comercio', 'com_servico')),
  CONSTRAINT fiscal_cadastro_vende_dia_1_check CHECK (vende_no_app_desde IS NULL OR extract(day FROM vende_no_app_desde) = 1)
);
COMMENT ON TABLE public.fiscal_cadastro IS 'No maximo UMA linha por banco (loja): regime e atividade fiscais. Nasce vazia (sem regime padrao). So fiscal_cadastro_salvar escreve, e so o dono da loja a usa. O CNPJ nao mora aqui (store_config).';

ALTER TABLE public.fiscal_cadastro ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fiscal_cadastro FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fiscal_cadastro TO authenticated, service_role;

DROP POLICY IF EXISTS fiscal_cadastro_select_policy ON public.fiscal_cadastro;
CREATE POLICY fiscal_cadastro_select_policy ON public.fiscal_cadastro
  FOR SELECT TO authenticated
  USING ((SELECT public.rls_admin_atual()));

-- ===== (2) a trilha: quem mudou o que, quando, antes e depois =====

CREATE TABLE IF NOT EXISTS public.fiscal_cadastro_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  quem uuid NOT NULL,
  quando timestamptz NOT NULL DEFAULT now(),
  antes jsonb,
  depois jsonb NOT NULL,
  CONSTRAINT fiscal_cadastro_log_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.fiscal_cadastro_log IS 'Historico do cadastro fiscal: quem (o dono) mudou, quando, o que havia antes (nulo na primeira vez) e o que ficou. Sem FK de proposito: o registro sobrevive a quem sai. So fiscal_cadastro_salvar insere.';

ALTER TABLE public.fiscal_cadastro_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fiscal_cadastro_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fiscal_cadastro_log TO authenticated, service_role;

-- A sequencia do identity nasce com os grants padrao de sequencia do schema public (anon/authenticated/service_role): ninguem de
-- aplicacao precisa dela (so o dono da funcao insere no log), entao fica sem grant nenhum.
DO $sequencia_20261440000000$
DECLARE
  v_seq text := pg_get_serial_sequence('public.fiscal_cadastro_log', 'id');
BEGIN
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fiscal_cadastro_log.id nao tem sequencia de identity.';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
END $sequencia_20261440000000$;

DROP POLICY IF EXISTS fiscal_cadastro_log_select_policy ON public.fiscal_cadastro_log;
CREATE POLICY fiscal_cadastro_log_select_policy ON public.fiscal_cadastro_log
  FOR SELECT TO authenticated
  USING ((SELECT public.rls_admin_atual()));

-- ===== (3) a unica porta que grava o cadastro fiscal =====

CREATE OR REPLACE FUNCTION public.fiscal_cadastro_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_quem uuid := auth.uid();
    v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    v_aberta date;
    v_vende date;
    v_antes jsonb;
    v_depois jsonb;
    v_resultado jsonb;
BEGIN
    -- 1. Quem chama: o DONO, conferido na tabela do banco. Nunca o JWT. Tabela vazia = todo mundo recusado.
    IF v_quem IS NULL OR NOT EXISTS (SELECT 1 FROM public.dono_da_loja d WHERE d.user_id = v_quem) THEN
        RAISE EXCEPTION 'Acesso negado: só o dono da loja altera o cadastro fiscal.' USING ERRCODE = '42501';
    END IF;

    -- 1b. SOMADO ao dono (nunca no lugar): o dono precisa ser administrador de AGORA nas duas fontes (auth.users e profiles).
    --     is_admin_atual() le auth.uid() da propria sessao (o SECURITY DEFINER nao troca o GUC da requisicao).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: o dono da loja precisa ser administrador nas duas fontes (auth.users e profiles).' USING ERRCODE = '42501';
    END IF;

    -- 2. Entrada (so depois da recusa de dono: quem nao e' o dono nao descobre o que e' valido). O payload e' a foto inteira do
    --    formulario; campo que nao e' do cadastro (cnpj, por exemplo) e' ignorado.
    IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
        RAISE EXCEPTION 'Cadastro fiscal inválido: envie um objeto com regime e atividade.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p -> 'regime') IS DISTINCT FROM 'string'
       OR p ->> 'regime' NOT IN ('mei', 'simples', 'presumido', 'real', 'nao_sei') THEN
        RAISE EXCEPTION 'Regime inválido: use mei, simples, presumido, real ou nao_sei.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p -> 'atividade') IS DISTINCT FROM 'string'
       OR p ->> 'atividade' NOT IN ('comercio', 'com_servico') THEN
        RAISE EXCEPTION 'Atividade inválida: use comercio ou com_servico.' USING ERRCODE = '22023';
    END IF;

    -- Datas: ausente ou null = vazio; texto AAAA-MM-DD de data real; qualquer outro tipo recusa.
    IF COALESCE(jsonb_typeof(p -> 'aberta_em'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(p -> 'vende_no_app_desde'), 'null') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'Data inválida: use o formato AAAA-MM-DD ou deixe vazio.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p -> 'aberta_em') = 'string' THEN
        IF p ->> 'aberta_em' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'Data de abertura inválida: use o formato AAAA-MM-DD.' USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_aberta := (p ->> 'aberta_em')::date;
        EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
            RAISE EXCEPTION 'Data de abertura inválida: essa data não existe.' USING ERRCODE = '22023';
        END;
    END IF;
    IF jsonb_typeof(p -> 'vende_no_app_desde') = 'string' THEN
        IF p ->> 'vende_no_app_desde' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'Mês de início das vendas inválido: use o formato AAAA-MM-01.' USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_vende := (p ->> 'vende_no_app_desde')::date;
        EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
            RAISE EXCEPTION 'Mês de início das vendas inválido: essa data não existe.' USING ERRCODE = '22023';
        END;
    END IF;
    IF v_vende IS NOT NULL AND extract(day FROM v_vende) <> 1 THEN
        RAISE EXCEPTION 'Mês de início das vendas inválido: use sempre o dia 1.' USING ERRCODE = '22023';
    END IF;

    -- Faixa plausível das datas (22023). "Hoje" é o dia de São Paulo (onde as lojas vivem), nunca o relógio ou o fuso do servidor.
    --   abertura: entre 1900-01-01 e hoje;
    --   início das vendas pelo app: não antes de 2020-01-01, não num mês que ainda não começou e, havendo data de abertura,
    --   não antes do mês da abertura (o dia 1 desse mês vale: abriu e já vendeu no mesmo mês).
    IF v_aberta IS NOT NULL AND v_aberta < DATE '1900-01-01' THEN
        RAISE EXCEPTION 'Data de abertura inválida: não pode ser anterior a 1900.' USING ERRCODE = '22023';
    END IF;
    IF v_aberta IS NOT NULL AND v_aberta > v_hoje THEN
        RAISE EXCEPTION 'Data de abertura inválida: não pode ser no futuro.' USING ERRCODE = '22023';
    END IF;
    IF v_vende IS NOT NULL AND v_vende < DATE '2020-01-01' THEN
        RAISE EXCEPTION 'Mês de início das vendas inválido: não pode ser anterior a janeiro de 2020.' USING ERRCODE = '22023';
    END IF;
    IF v_vende IS NOT NULL AND v_vende > v_hoje THEN
        RAISE EXCEPTION 'Mês de início das vendas inválido: esse mês ainda não começou.' USING ERRCODE = '22023';
    END IF;
    IF v_vende IS NOT NULL AND v_aberta IS NOT NULL AND v_vende < v_aberta - (extract(day FROM v_aberta)::int - 1) THEN
        RAISE EXCEPTION 'Mês de início das vendas inválido: não pode ser anterior ao mês em que a empresa foi aberta.' USING ERRCODE = '22023';
    END IF;

    v_depois := jsonb_build_object(
        'regime', p ->> 'regime',
        'atividade', p ->> 'atividade',
        'aberta_em', v_aberta,
        'vende_no_app_desde', v_vende);

    -- 3. Trava so entre gravadores (a leitura nao espera). Sem ela, duas chamadas simultaneas leriam o MESMO "antes" e a trilha
    --    perderia um elo; com a tabela vazia nem ha linha para trancar. O SELECT abaixo roda DEPOIS da trava (cada instrucao
    --    do READ COMMITTED toma foto nova) e ve o que a chamada anterior confirmou.
    LOCK TABLE public.fiscal_cadastro IN SHARE ROW EXCLUSIVE MODE;

    SELECT jsonb_build_object(
               'regime', f.regime,
               'atividade', f.atividade,
               'aberta_em', f.aberta_em,
               'vende_no_app_desde', f.vende_no_app_desde)
      INTO v_antes
      FROM public.fiscal_cadastro f
     WHERE f.id;

    -- 4. Os mesmos dados: nao grava, nao toca quem/quando da linha e nao registra (repetir nao suja a trilha).
    IF v_antes IS NOT DISTINCT FROM v_depois THEN
        SELECT to_jsonb(f) INTO v_resultado FROM public.fiscal_cadastro f WHERE f.id;
        RETURN v_resultado;
    END IF;

    -- 5. Mudou: grava e registra na MESMA chamada (uma transacao: sem o log, a linha tambem nao fica).
    INSERT INTO public.fiscal_cadastro AS f (id, regime, atividade, aberta_em, vende_no_app_desde, atualizado_em, atualizado_por)
    VALUES (true, p ->> 'regime', p ->> 'atividade', v_aberta, v_vende, now(), v_quem)
    ON CONFLICT (id) DO UPDATE
       SET regime = EXCLUDED.regime,
           atividade = EXCLUDED.atividade,
           aberta_em = EXCLUDED.aberta_em,
           vende_no_app_desde = EXCLUDED.vende_no_app_desde,
           atualizado_em = EXCLUDED.atualizado_em,
           atualizado_por = EXCLUDED.atualizado_por
    RETURNING to_jsonb(f) INTO v_resultado;

    INSERT INTO public.fiscal_cadastro_log (quem, antes, depois)
    VALUES (v_quem, v_antes, v_depois);

    RETURN v_resultado;
END;
$function$;

REVOKE ALL ON FUNCTION public.fiscal_cadastro_salvar(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_cadastro_salvar(jsonb) TO authenticated;
COMMENT ON FUNCTION public.fiscal_cadastro_salvar(jsonb) IS 'Unica porta que grava o cadastro fiscal: so o dono da loja (dono_da_loja) que seja admin atual; valida o payload (22023); grava a linha unica e registra antes/depois em fiscal_cadastro_log so quando mudou.';

DO $posflight_20261440000000$
DECLARE
  r record;
  v_caminho text;
  v_qual text;
  v_cmd text;
  v_roles text;
  v_seq text;
BEGIN
  -- Funcao: corpo, atributos, ACL, sem sobrecarga.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.fiscal_cadastro_salvar(jsonb)')
        AND md5(replace(p.prosrc, chr(13), '')) = '198c24062f62dd29aae1f96fcaed6603'
        AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict
        AND pg_get_function_result(p.oid) = 'jsonb' AND p.proconfig = ARRAY['search_path=public']::text[])
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fiscal_cadastro_salvar') <> 1
     OR has_function_privilege('anon', 'public.fiscal_cadastro_salvar(jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fiscal_cadastro_salvar(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fiscal_cadastro_salvar(jsonb)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL de fiscal_cadastro_salvar divergentes.';
  END IF;

  -- Tabelas: RLS ligada (sem FORCE), nenhum privilegio de escrita para ninguem de aplicacao, leitura so do authenticated e do
  -- service_role; anon e PUBLIC nada.
  FOR r IN SELECT unnest(ARRAY['public.fiscal_cadastro', 'public.fiscal_cadastro_log']) AS tabela LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(r.tabela) AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity)
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
           WHERE c.oid = to_regclass(r.tabela) AND a.grantee <> c.relowner
             AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')))
             AND a.privilege_type <> 'SELECT')
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
           WHERE c.oid = to_regclass(r.tabela) AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon')))
       OR NOT has_table_privilege('authenticated', r.tabela, 'SELECT')
       OR NOT has_table_privilege('service_role', r.tabela, 'SELECT')
       OR has_any_column_privilege('anon', r.tabela, 'SELECT') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RLS ou privilegios de % divergentes.', r.tabela;
    END IF;
  END LOOP;

  -- A sequencia do identity do log: sem grant para ninguem alem do dono.
  v_seq := pg_get_serial_sequence('public.fiscal_cadastro_log', 'id');
  IF v_seq IS NULL
     OR (SELECT a.attidentity FROM pg_attribute a WHERE a.attrelid = to_regclass('public.fiscal_cadastro_log') AND a.attname = 'id') <> 'a'
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) a
         WHERE c.oid = v_seq::regclass AND a.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a sequencia do log nao e identity ou tem grant fora do dono.';
  END IF;

  -- Constraints (chaves e CHECKs; ordem de bytes para nao depender do collation do banco).
  IF (SELECT string_agg(conname::text, ',' ORDER BY conname::text COLLATE "C") FROM pg_constraint
       WHERE conrelid = to_regclass('public.fiscal_cadastro') AND contype IN ('p', 'c'))
        IS DISTINCT FROM 'fiscal_cadastro_atividade_check,fiscal_cadastro_pkey,fiscal_cadastro_regime_check,fiscal_cadastro_uma_so_check,fiscal_cadastro_vende_dia_1_check'
     OR (SELECT string_agg(conname::text, ',' ORDER BY conname::text COLLATE "C") FROM pg_constraint
          WHERE conrelid = to_regclass('public.fiscal_cadastro_log') AND contype IN ('p', 'c'))
        IS DISTINCT FROM 'fiscal_cadastro_log_pkey' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: constraints de fiscal_cadastro ou fiscal_cadastro_log divergentes.';
  END IF;

  -- Politicas (forma deparseada com search_path = pg_catalog, como nas outras migrations): exatamente uma por tabela.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('public.fiscal_cadastro', 'fiscal_cadastro_select_policy'),
    ('public.fiscal_cadastro_log', 'fiscal_cadastro_log_select_policy')
  ) AS esperado(tabela, politica) LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), p.polcmd::text,
           array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END FROM unnest(p.polroles) x ORDER BY 1), ',')
      INTO v_qual, v_cmd, v_roles FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica AND p.polpermissive AND p.polwithcheck IS NULL;
    IF v_cmd IS DISTINCT FROM 'r' OR v_roles IS DISTINCT FROM 'authenticated'
       OR v_qual IS DISTINCT FROM '( SELECT public.rls_admin_atual() AS rls_admin_atual)' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % divergente (USING %).', r.politica, r.tabela, COALESCE(v_qual, 'ausente');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN (to_regclass('public.fiscal_cadastro'), to_regclass('public.fiscal_cadastro_log'))) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fiscal_cadastro e fiscal_cadastro_log tem de ter exatamente uma politica cada (SELECT).';
  END IF;
END $posflight_20261440000000$;

NOTIFY pgrst, 'reload schema';
