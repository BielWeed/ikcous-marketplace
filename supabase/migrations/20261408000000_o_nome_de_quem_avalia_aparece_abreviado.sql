-- Etapa 1: abrevia o nome nas duas views sem login e fornece nome_publico à tela logada.
-- NÃO é proteção completa contra cliente logada via API direta: o acesso vigente
-- a public_profiles.full_name permanece até a etapa 2, que não faz parte deste arquivo.
--
-- O nome cadastrado não muda. O painel ainda depende de full_name na busca e
-- consulta alternativa de avaliações/perguntas, no pré-carregamento de perguntas,
-- nas métricas de avaliações e na consulta de autor do histórico de push.
-- As consultas principais de avaliações/perguntas do painel já leem profiles.
--
-- PG17: STORED calcula também os perfis que já existem e acompanha o gatilho
-- de sincronização sem outro gatilho. O ALTER reescreve fisicamente a tabela
-- para guardar a coluna nova; não altera os valores das colunas existentes.
-- O aplicador abre e fecha a transação. Publicar banco antes do site.
-- Rollback: reverter o site antes de apagar a coluna nova.

SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE
  v_perfis regclass := to_regclass('public.public_profiles');
  v_avaliacoes regclass := to_regclass('public.vw_reviews_public');
  v_perguntas regclass := to_regclass('public.vw_questions_public');
  v_caminho text := current_setting('search_path');
  v_esperada record;
  v_definicao text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = v_perfis AND relkind = 'r' AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_perfis AND attname = 'full_name' AND attnum > 0
      AND NOT attisdropped AND atttypid = 'text'::regtype
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_perfis AND attname = 'nome_publico' AND attnum > 0 AND NOT attisdropped
  ) OR to_regprocedure('public.nome_publico_de(text)') IS NOT NULL
    OR current_setting('server_encoding') <> 'UTF8'
    OR NOT EXISTS (
      SELECT 1 FROM pg_collation
      WHERE collnamespace = 'pg_catalog'::regnamespace AND collname = 'und-x-icu'
        AND collprovider = 'i' AND collisdeterministic
    ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: perfil público, objetos novos ou suporte Unicode fora do esperado.';
  END IF;

  -- Compara o SELECT canônico; o catálogo pode pôr parênteses e quebrar linhas.
  -- As duas definições esperadas têm só comparações simples, sem operadores
  -- lógicos cujo significado dependa de parênteses.
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR v_esperada IN
    SELECT * FROM (VALUES
      (v_avaliacoes, $views$SELECT r.id, r.product_id, r.rating, r.comment, r.created_at, r.helpful,
        r.verified, r.merchant_reply, r.merchant_reply_at, pp.full_name AS author_name,
        pp.avatar_url AS author_avatar_url FROM public.reviews r
        LEFT JOIN public.public_profiles pp ON pp.id = r.user_id WHERE r.status = 'publicada'::text;$views$),
      (v_perguntas, $views$SELECT q.id, q.product_id, q.question, q.created_at,
        pp.full_name AS author_name, pp.avatar_url AS author_avatar_url FROM public.questions q
        LEFT JOIN public.public_profiles pp ON pp.id = q.user_id;$views$)
    ) AS t(oid, corpo)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = v_esperada.oid AND relkind = 'v' AND reloptions IS NULL
        AND has_table_privilege('anon', oid, 'SELECT')
        AND has_table_privilege('authenticated', oid, 'SELECT')
        AND has_table_privilege('service_role', oid, 'SELECT')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: view da vitrine ausente ou com opções/permissões divergentes (%).', v_esperada.oid;
    END IF;

    v_definicao := pg_get_viewdef(v_esperada.oid, true);
    IF regexp_replace(v_definicao, '[[:space:]()]', '', 'g') IS DISTINCT FROM
       regexp_replace(v_esperada.corpo, '[[:space:]()]', '', 'g') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: definição da view % não é a da 20261110000000.', v_esperada.oid;
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight$;

CREATE FUNCTION public.nome_publico_de(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $funcao$
  -- A classe de espaços é a mesma de \s do JavaScript, não depende do locale.
  WITH partes AS (
    SELECT array_remove(regexp_split_to_array(p_nome,
      U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+'), '') AS palavras
  )
  SELECT coalesce(partes.palavras[1], 'Cliente') ||
         coalesce(' ' || left(upper(left(normalize(ultimo.palavra, NFC), 1)
           COLLATE pg_catalog."und-x-icu"), 1) || '.', '')
  FROM partes
  LEFT JOIN LATERAL (
    SELECT palavra
    FROM unnest(partes.palavras) WITH ORDINALITY AS p(palavra, posicao)
    WHERE posicao > 1 AND lower(palavra COLLATE pg_catalog."C") NOT IN ('de', 'da', 'do', 'das', 'dos', 'e')
    ORDER BY posicao DESC
    LIMIT 1
  ) AS ultimo ON true;
$funcao$;

-- A coluna gerada avalia a função nas escritas. Os papéis normais do app podem
-- executá-la: ela só transforma a string recebida e não lê dado algum do banco.
REVOKE EXECUTE ON FUNCTION public.nome_publico_de(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nome_publico_de(text) TO anon, authenticated, service_role;

ALTER TABLE public.public_profiles
  ADD COLUMN nome_publico text GENERATED ALWAYS AS (public.nome_publico_de(full_name)) STORED NOT NULL;

-- CREATE OR REPLACE mantém OID, dono e grants. Sem security_invoker como
-- antes: as views conservam os filtros e a leitura por visitante sem login.
CREATE OR REPLACE VIEW public.vw_reviews_public AS
SELECT
  r.id,
  r.product_id,
  r.rating,
  r.comment,
  r.created_at,
  r.helpful,
  r.verified,
  r.merchant_reply,
  r.merchant_reply_at,
  COALESCE(pp.nome_publico, 'Cliente') AS author_name,
  pp.avatar_url AS author_avatar_url
FROM public.reviews r
LEFT JOIN public.public_profiles pp ON pp.id = r.user_id
WHERE r.status = 'publicada';

CREATE OR REPLACE VIEW public.vw_questions_public AS
SELECT
  q.id,
  q.product_id,
  q.question,
  q.created_at,
  COALESCE(pp.nome_publico, 'Cliente') AS author_name,
  pp.avatar_url AS author_avatar_url
FROM public.questions q
LEFT JOIN public.public_profiles pp ON pp.id = q.user_id;
