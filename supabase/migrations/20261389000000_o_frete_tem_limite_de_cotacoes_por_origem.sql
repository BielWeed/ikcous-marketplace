-- O FRETE TEM LIMITE DE COTACOES POR ORIGEM (frente E / E1; seguranca + dinheiro de terceiro; 26/10/2026)
-- RASCUNHO PARA REVISAO OPUS. Nada foi aplicado em banco algum.
-- ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado e nao muda dado existente. Cria 1 tabela, 1 indice e
-- 1 funcao; nenhuma funcao, politica, grant ou gatilho que ja existia e' redefinido ou removido.
--
-- DEFEITO: a edge calculate-shipping e' publica (a cotacao do carrinho roda com a chave publica do app). Quem a chamasse em laco,
-- variando o CEP para driblar o cache, gastava a cota do token da transportadora (Melhor Envio / Frenet / SuperFrete; o token e' da
-- lojista) e enchia shipping_calculation_logs e shipping_quotes_cache. Nao existia limite por origem. A edge passa a gastar uma
-- unidade de cota por cotacao que VAI a transportadora (acerto de cache, erro de validacao, entrega local e acao do painel nao
-- contam) e a responder 429 + Retry-After ao passar do teto. Este arquivo e' so o CONTADOR; a regra de quem conta e o teto
-- (60 cotacoes por 300 s por origem) moram em supabase/functions/calculate-shipping/limite-por-origem.ts.
--
-- O QUE ENTRA (3 objetos novos):
--   (1) public.frete_cota_por_origem: um contador por (origem, janela). origem = hash (32 hex) do IP, NUNCA o IP; janela_inicio = o
--       inicio da janela fixa; chamadas = quantas cotacoes a origem ja gastou naquela janela. Chave primaria (origem, janela_inicio).
--       RLS ligada, SEM politica e SEM grant para ninguem de aplicacao (anon, authenticated, service_role): a unica porta e' a funcao.
--       Indice por janela_inicio: serve a limpeza das linhas velhas.
--   (2) public.frete_consumir_cota(p_origem text, p_limite integer, p_janela_segundos integer) RETURNS jsonb:
--       {permitido, espere_segundos}. SECURITY DEFINER, search_path fixo (pg_catalog, pg_temp; tudo qualificado), EXECUTE so para
--       service_role (a edge usa a chave de servico; anon e authenticated nao chamam: o visitante nao zera nem consulta o contador).
--       Atomica: UM INSERT ... ON CONFLICT DO UPDATE ... WHERE chamadas < p_limite. Duas chamadas simultaneas da mesma origem se
--       enfileiram na linha e a segunda reavalia o WHERE com o valor ja gravado pela primeira: ninguem passa do teto e nenhuma
--       unidade se perde. Quem passa do teto NAO escreve nada (o WHERE barra o UPDATE): o abusador nao amplifica carga de escrita.
--   (3) NOTIFY pgrst: o PostgREST passa a ver a funcao.
--
-- JANELA FIXA, E O QUE ELA CUSTA: a contagem recomeca a cada multiplo de p_janela_segundos. Uma origem pode gastar o teto no fim de
-- uma janela e outro teto no comeco da seguinte (ate 2x o teto em poucos segundos, uma vez). Aceito: o teto e' folgado para a cliente
-- (60 por 5 min) e a janela deslizante pediria uma linha por chamada, que e' justamente a carga que o limite quer evitar.
-- ARGUMENTOS: validados (origem 32 hex minusculas, limite 1..100000, janela 10..3600 s); invalido e' 22023, nao cota infinita. A edge
-- e' quem escolhe os numeros, mas um bug dela nao pode virar "sem limite" nem apagar o contador.
-- LIMPEZA: quando uma origem abre janela nova (1a chamada dela naquela janela), a mesma chamada apaga ate 500 linhas com mais de 1 hora
-- (FOR UPDATE SKIP LOCKED: nunca espera nem forma deadlock com outra limpeza). Sem pg_cron: a tabela nao cresce sem limite nem
-- depende de agendador que a loja talvez nao tenha. Uma enxurrada de origens falsas deixa, no maximo, uma hora de linhas.
--
-- FALHA ABERTA NA EDGE: se esta funcao nao existe (loja que ainda nao recebeu a migration), erra ou demora mais de 2 s, a cotacao
-- SEGUE e o aviso vai para o log da edge. Publicar a edge antes da migration nao derruba o frete; so deixa o limite sem efeito.
--
-- DADOS EXISTENTES: nenhuma linha de nenhuma tabela e' lida ou alterada. A tabela nasce vazia. Reaplicar nao zera nem duplica contagem
-- (CREATE TABLE IF NOT EXISTS; CREATE OR REPLACE da funcao). Rodar duas vezes e' no-op.
--
-- ORDEM E ATOMICIDADE: tudo roda na transacao do aplicador (aplicar-migrations.yml / db-apply.cjs abrem BEGIN, aplicam o arquivo e
-- fazem COMMIT; qualquer erro, inclusive o pre-voo e o pos-voo daqui, desfaz o arquivo inteiro). Sem BEGIN/COMMIT aqui: com eles o
-- ROLLBACK do script de prova viraria no-op e a mudanca ficaria gravada. lock_timeout de 5 s: nada aqui toca tabela existente, mas
-- o REVOKE/COMMENT esperam o catalogo e e' melhor falhar e reaplicar do que enfileirar a loja.
--
-- PRE-VOO fail-closed (B1_BASELINE_DIVERGENT): recusa sem escrever se ja existir uma public.frete_cota_por_origem com forma diferente
-- da desta migration, ou uma public.frete_consumir_cota com corpo desconhecido (so se aceita ausente ou igual a esta).
-- POS-VOO (B2_POSVOO_DIVERGENTE): confere RLS ligada e zero politica, ACL da tabela (ninguem de aplicacao tem privilegio), ACL da
-- funcao (so service_role executa; anon, authenticated e PUBLIC nao), atributos e hash do corpo, E EXERCITA a funcao (2 chamadas com
-- teto 1: a primeira passa, a segunda e' barrada; as linhas do teste sao apagadas na mesma transacao).
--
-- ROLLBACK: rollback-manual-20261389000000_o_frete_tem_limite_de_cotacoes_por_origem.sql tira a funcao e a tabela (so existiam
-- contadores de ate 5 minutos; nada de negocio se perde). A edge nova continua cotando (falha aberta), sem limite.
-- TIPOS: src/types/database.types.ts nao muda aqui (nada do front chama a funcao; so a edge, com a chave de servico).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===== pre-voo =====

DO $preflight_389$
DECLARE
  v_forma text;
  v_hash text;
BEGIN
  IF to_regclass('public.frete_cota_por_origem') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
      INTO v_forma
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.frete_cota_por_origem') AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.frete_cota_por_origem') AND relkind = 'r')
       OR v_forma IS DISTINCT FROM 'chamadas:integer:true,janela_inicio:timestamp with time zone:true,origem:text:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frete_cota_por_origem existe e nao tem a forma desta migration (%).', v_forma;
    END IF;
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'frete_consumir_cota') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frete_consumir_cota tem mais de uma assinatura.';
  END IF;
  IF to_regprocedure('public.frete_consumir_cota(text,integer,integer)') IS NOT NULL THEN
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure('public.frete_consumir_cota(text,integer,integer)');
    IF v_hash IS DISTINCT FROM '8e86b8ee56a05d623a2684c0f8ab8f05' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frete_consumir_cota existe com corpo desconhecido (hash %); revise antes de aplicar.', v_hash;
    END IF;
  END IF;
END $preflight_389$;

-- ===== (1) a tabela =====

CREATE TABLE IF NOT EXISTS public.frete_cota_por_origem (
  origem text NOT NULL,
  janela_inicio timestamptz NOT NULL,
  chamadas integer NOT NULL,
  CONSTRAINT frete_cota_por_origem_pkey PRIMARY KEY (origem, janela_inicio),
  CONSTRAINT frete_cota_por_origem_origem_check CHECK (origem ~ '^[0-9a-f]{32}$'),
  CONSTRAINT frete_cota_por_origem_chamadas_check CHECK (chamadas > 0)
);

COMMENT ON TABLE public.frete_cota_por_origem IS 'Contador de cotacoes de frete por origem (hash do IP) e janela fixa. So a funcao frete_consumir_cota le e escreve; ninguem de aplicacao tem acesso. Linhas com mais de 1 hora sao apagadas pela propria funcao.';
COMMENT ON COLUMN public.frete_cota_por_origem.origem IS 'SHA-256 (32 primeiros hex) do IP de quem pediu a cotacao, calculado pela edge. Nunca o IP.';

CREATE INDEX IF NOT EXISTS frete_cota_por_origem_janela_idx
  ON public.frete_cota_por_origem (janela_inicio);

ALTER TABLE public.frete_cota_por_origem ENABLE ROW LEVEL SECURITY;
-- As lojas clonadas tem ACL de fabrica diferente: o REVOKE e' explicito, nunca depende do default.
REVOKE ALL ON TABLE public.frete_cota_por_origem FROM PUBLIC, anon, authenticated, service_role;

-- ===== (2) a funcao =====

CREATE OR REPLACE FUNCTION public.frete_consumir_cota(p_origem text, p_limite integer, p_janela_segundos integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_agora timestamptz := clock_timestamp();
  v_inicio timestamptz;
  v_fim timestamptz;
  v_chamadas integer;
BEGIN
  IF p_origem IS NULL OR p_origem !~ '^[0-9a-f]{32}$'
     OR p_limite IS NULL OR p_limite < 1 OR p_limite > 100000
     OR p_janela_segundos IS NULL OR p_janela_segundos < 10 OR p_janela_segundos > 3600 THEN
    RAISE EXCEPTION 'frete_consumir_cota: argumento invalido' USING ERRCODE = '22023';
  END IF;

  v_inicio := to_timestamp(floor(extract(epoch FROM v_agora) / p_janela_segundos) * p_janela_segundos);
  v_fim := v_inicio + make_interval(secs => p_janela_segundos);

  -- Atomico: a linha da origem na janela nasce com 1 ou sobe 1 SO se ainda esta abaixo do teto. Acima do teto o WHERE barra o UPDATE,
  -- nada e' gravado e o RETURNING vem vazio.
  INSERT INTO public.frete_cota_por_origem AS c (origem, janela_inicio, chamadas)
  VALUES (p_origem, v_inicio, 1)
  ON CONFLICT (origem, janela_inicio) DO UPDATE
     SET chamadas = c.chamadas + 1
   WHERE c.chamadas < p_limite
  RETURNING c.chamadas INTO v_chamadas;

  IF v_chamadas IS NULL THEN
    RETURN jsonb_build_object(
      'permitido', false,
      'espere_segundos', GREATEST(1, ceil(extract(epoch FROM (v_fim - v_agora)))::integer)
    );
  END IF;

  -- Primeira chamada desta origem na janela: aproveita para varrer o que passou de 1 hora. Em lote pequeno e sem esperar ninguem.
  IF v_chamadas = 1 THEN
    DELETE FROM public.frete_cota_por_origem d
     WHERE (d.origem, d.janela_inicio) IN (
       SELECT o.origem, o.janela_inicio
         FROM public.frete_cota_por_origem o
        WHERE o.janela_inicio < v_agora - interval '1 hour'
        LIMIT 500
          FOR UPDATE SKIP LOCKED
     );
  END IF;

  RETURN jsonb_build_object('permitido', true, 'espere_segundos', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.frete_consumir_cota(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.frete_consumir_cota(text, integer, integer) TO service_role;
COMMENT ON FUNCTION public.frete_consumir_cota(text, integer, integer) IS 'Gasta uma cotacao de frete da origem (hash do IP) na janela fixa; devolve {permitido, espere_segundos}. Atomica. So a edge calculate-shipping (service_role) chama.';

-- ===== pos-voo =====

DO $posvoo_389$
DECLARE
  v_papel text;
  v_privilegio text;
  v_r1 jsonb;
  v_r2 jsonb;
  v_teste text := repeat('0', 32);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.frete_cota_por_origem') AND relkind = 'r' AND relrowsecurity) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: a RLS de frete_cota_por_origem nao ficou ligada.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.frete_cota_por_origem')) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: frete_cota_por_origem nao pode ter politica nenhuma.';
  END IF;
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilegio IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_papel, 'public.frete_cota_por_origem', v_privilegio) THEN
        RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: % tem % em frete_cota_por_origem.', v_papel, v_privilegio;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
              WHERE c.oid = to_regclass('public.frete_cota_por_origem') AND a.grantee = 0) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: PUBLIC tem privilegio em frete_cota_por_origem.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = to_regprocedure('public.frete_consumir_cota(text,integer,integer)')
       AND md5(replace(p.prosrc, E'\r', '')) = '8e86b8ee56a05d623a2684c0f8ab8f05'
       AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND l.lanname = 'plpgsql'
       AND p.prorettype = 'jsonb'::regtype
       AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
       AND has_function_privilege('service_role', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: frete_consumir_cota nao ficou com o corpo, os atributos e a ACL esperados.';
  END IF;

  -- A funcao funciona nesta loja (plpgsql so valida o corpo na execucao): teto 1, a 1a passa, a 2a e' barrada; some tudo no fim.
  v_r1 := public.frete_consumir_cota(v_teste, 1, 3600);
  v_r2 := public.frete_consumir_cota(v_teste, 1, 3600);
  DELETE FROM public.frete_cota_por_origem WHERE origem = v_teste;
  IF (v_r1->>'permitido') IS DISTINCT FROM 'true' OR (v_r2->>'permitido') IS DISTINCT FROM 'false'
     OR COALESCE((v_r2->>'espere_segundos')::integer, 0) NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: frete_consumir_cota nao se comportou como esperado (%, %).', v_r1, v_r2;
  END IF;
END $posvoo_389$;

NOTIFY pgrst, 'reload schema';
