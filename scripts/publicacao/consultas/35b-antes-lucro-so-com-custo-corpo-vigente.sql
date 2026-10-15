-- 35b — ANTES de aplicar a migration 20261234000000 (o lucro so conta produto com custo): confirma, POR OBJETO, a
-- base de antes: `get_admin_analytics_v2(integer)` existe, UMA so, com o corpo VIGENTE (md5, o da 20261214000000, o
-- lote 17), SEM a regra nova, e com os atributos de sempre. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do
-- lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 35a negativa so vira "aplique" se esta for
-- positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de produto, de
-- pedido ou de cliente e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL da funcao e' a da 20261090500000 (e da 17a/8e); o pre-voo da migration recusa
-- o apply com a ACL aberta.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem o lucro novo reprova aqui de proposito, nas linhas do corpo e do marcador. Uma loja
-- ainda no corpo da 20261199000000 (o lote 17 nao aplicado) tambem reprova nas duas: aplique o lote 17 antes.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261214000000.
--   * marcador -- 'nao' se a regra nova NAO aparece no corpo (so o corpo novo a traz).
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + `search_path=public` + retorno json.
--
-- tests/banco/lucro-so-com-custo-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback,
-- negativa depois do apply, um negativo por linha). O md5 do corpo de antes vem do ARQUIVO da migration
-- 20261214000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.get_admin_analytics_v2(integer)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'get_admin_analytics_v2') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('''productsWithoutCost'', products_without_cost' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'json'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> json'
              ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_admin_analytics_v2: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o da 20261214000000, sem o lucro so de produto com custo (md5)',
         '0a5f8c75bbeeda3777a6a7326a0e281c',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: o corpo ainda NAO conta os produtos sem custo',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> json',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
