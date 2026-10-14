-- 25b — ANTES de aplicar a migration 20261222000000 (a media de avaliacoes, `get_reviews_metrics`, so
-- responde ao administrador): confirma, POR OBJETO, a base de antes: a funcao existe com o corpo ANTIGO,
-- o da baseline, SEM a guarda de admin (md5), e com os atributos de sempre (SECURITY DEFINER, plpgsql,
-- VOLATILE, `search_path=public`). E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 25a negativa so vira "aplique" se esta
-- for positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de
-- avaliacao e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a loja que ainda nao tem a 20261221000000 (lote 24) pode estar aberta ao
-- visitante, e isso e' da 24a/24b; o pre-voo da 20261222000000 recusa o apply sem a 20261221000000. A
-- ordem dos lotes (24 antes do 25) e' do canais-de-backend.json.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 4 linhas, as
-- mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a
-- loja esta na base de antes; uma loja que JA tem a guarda reprova aqui de proposito, nas linhas do corpo.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da baseline
--                20260806000000, sem a guarda.
--   * guarda  -- 'nao' se `IF NOT public.is_admin() THEN` NAO aparece antes da primeira leitura de
--                avaliacoes (`IF p_search IS NOT NULL`).
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + proconfig = {search_path=public}.
--
-- tests/banco/media-de-avaliacoes-so-admin-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva depois do rollback, negativa depois do apply, um negativo por linha). O md5 do corpo antigo
-- vem do baseline, nao de uma loja: o valor VIVO de cada loja so esta consulta mede. LIMITE: evidencia
-- LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.get_reviews_metrics(text,integer)')
), fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('IF NOT public.is_admin() THEN' IN p.prosrc) > 0
                   AND position('IF NOT public.is_admin() THEN' IN p.prosrc) < position('IF p_search IS NOT NULL' IN p.prosrc)
              THEN 'sim' ELSE 'nao' END AS guarda,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public' ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_reviews_metrics: corpo e o da baseline, sem a guarda de admin (md5)',
         'f7fb638c20dce1ae26509f4ffc563120',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_reviews_metrics: o corpo ainda NAO exige is_admin()',
         'nao',
         COALESCE((SELECT f.guarda FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_reviews_metrics: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
