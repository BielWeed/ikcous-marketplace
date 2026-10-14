-- 30b — ANTES de aplicar as migrations 20261227000000 e 20261228000000 (os numeros do painel): confirma,
-- POR OBJETO, a base de antes: cada uma das duas funcoes existe com o corpo VIGENTE (md5), SEM o corte na
-- mesma hora, e com os atributos de sempre (SECURITY DEFINER, plpgsql, STABLE, `search_path=public`). Os
-- vigentes sao o corpo da 20261199000000 (crm_visao) e o da 20261212000000, do lote 17 (painel_inicio).
-- E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json: a 30a negativa so vira "aplique" se esta for positiva (a loja esta
-- na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de pedido,
-- de devolucao ou de cliente e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL das duas funcoes e' a da 20261199000000 (lote 8e) e e' da 8e e da
-- 22a; os pre-voos das duas migrations recusam o apply com a ACL diferente. A ordem dos lotes (17 antes do
-- 30) e' do canais-de-backend.json: a loja sem a 20261212000000 reprova aqui, na linha do corpo do
-- painel_inicio.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 7 linhas, as
-- mesmas em qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a
-- loja esta na base de antes; uma loja que JA tem um dos cortes reprova aqui de proposito, nas linhas do
-- corpo e do marcador daquela funcao.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261199000000
--                (crm_visao) e o da 20261212000000 (painel_inicio).
--   * marcador -- 'nao' se `::time <= v_hora` NAO aparece no corpo (so os corpos novos o trazem).
--   * atributos -- SECURITY DEFINER + plpgsql + STABLE + proconfig = {search_path=public}.
--
-- tests/banco/numeros-do-painel-portao-viva.cjs roda esta consulta num Postgres real (positiva depois dos
-- dois rollbacks, negativa depois do apply, um negativo por linha). O md5 dos corpos de antes vem dos
-- ARQUIVOS das migrations 20261199000000 e 20261212000000, nao de uma loja: o valor VIVO de cada loja so
-- esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(chave, assinatura) AS (
  VALUES ('crm', 'public.crm_visao(date,date)'),
         ('painel', 'public.painel_inicio()')
), fn AS (
  SELECT t.chave,
         p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('::time <= v_hora' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql STABLE search_path=public' ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'crm_visao: corpo e o da 20261199000000, sem o corte na mesma hora (md5)',
         '7f6ec1bc0fa9f40591c0b577201b7c36',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: o corpo ainda NAO corta o anterior na mesma hora',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'crm'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: corpo e o da 20261212000000, sem o corte na mesma hora (md5)',
         'f11d22d076c59ab54d1beb280954dd15',
         COALESCE((SELECT f.m FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: o corpo ainda NAO corta a semana passada na mesma hora',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.chave = 'painel'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
