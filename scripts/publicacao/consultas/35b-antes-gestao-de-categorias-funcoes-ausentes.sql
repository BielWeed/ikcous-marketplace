-- 35b — ANTES de aplicar a migration 20261237000000 (a lojista renomeia e apaga categoria sem deixar produto orfao):
-- confirma, POR OBJETO, a base de antes: NENHUMA das tres portas (renomear_categoria, apagar_categoria_vazia,
-- categorias_com_uso) nem das oito auxiliares categoria__* existe ainda, as tabelas e colunas de que a migration
-- depende estao de pe (categorias.nome/slug/ativo, produtos.categoria, banners.link,
-- politica_devolucao.categorias_sem_troca/updated_at/updated_by), as funcoes de papel e de acento que ela chama existem
-- (is_admin, is_admin_atual, f_unaccent) e o gatilho set_ultima_atualizacao segue ligado em produtos. E' a consulta de
-- AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 35a
-- negativa so vira "aplique" se esta for positiva (a loja esta na base de antes, nao num estado que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_attribute, pg_trigger, pg_namespace): nenhuma linha de produto,
-- de banner, de categoria nem de politica de devolucao e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 6 linhas, as mesmas em
-- qualquer estado do banco. Tudo `true` = a loja esta na base de antes; uma loja que JA tem a migration reprova aqui
-- de proposito, nas linhas das portas e das auxiliares. NAO mede ACL (nao ha funcao para medir).
--
-- tests/banco/categorias-gestao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback, negativa
-- depois do apply, um negativo por linha). LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH presentes AS (
  SELECT p.proname
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'categoria\_\_%'
          OR p.proname IN ('renomear_categoria', 'apagar_categoria_vazia', 'categorias_com_uso'))
), colunas AS (
  SELECT c.tabela, c.coluna,
         EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.' || c.tabela) AND a.attname = c.coluna
                    AND a.attnum > 0 AND NOT a.attisdropped) AS existe
    FROM (VALUES ('categorias', 'nome'), ('categorias', 'slug'), ('categorias', 'ativo'), ('produtos', 'categoria'),
                 ('banners', 'link'), ('politica_devolucao', 'categorias_sem_troca'),
                 ('politica_devolucao', 'updated_at'), ('politica_devolucao', 'updated_by')) AS c(tabela, coluna)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'as tres portas (renomear_categoria, apagar_categoria_vazia, categorias_com_uso) ainda NAO existem',
         'nenhuma',
         COALESCE((SELECT string_agg(x.proname, ', ' ORDER BY x.proname) FROM presentes x
                    WHERE x.proname IN ('renomear_categoria', 'apagar_categoria_vazia', 'categorias_com_uso')), 'nenhuma')
  UNION ALL
  SELECT 'as oito auxiliares categoria__* ainda NAO existem',
         'nenhuma',
         COALESCE((SELECT string_agg(x.proname, ', ' ORDER BY x.proname) FROM presentes x
                    WHERE x.proname LIKE 'categoria\_\_%'), 'nenhuma')
  UNION ALL
  SELECT 'as tabelas e colunas de que a migration depende estao de pe (categorias, produtos, banners, politica_devolucao)',
         'sim',
         CASE WHEN (SELECT bool_and(c.existe) FROM colunas c) THEN 'sim'
              ELSE 'faltam: ' || (SELECT string_agg(c.tabela || '.' || c.coluna, ', ' ORDER BY c.tabela, c.coluna)
                                    FROM colunas c WHERE NOT c.existe) END
  UNION ALL
  SELECT 'is_admin(), is_admin_atual() e f_unaccent(text) existem (a migration as chama)',
         'sim',
         CASE WHEN to_regprocedure('public.is_admin()') IS NOT NULL
                   AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
                   AND to_regprocedure('public.f_unaccent(text)') IS NOT NULL
              THEN 'sim' ELSE 'faltam' END
  UNION ALL
  SELECT 'produtos: o gatilho set_ultima_atualizacao (avisa a vitrine do produto trocado) esta ligado',
         'ligado',
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_trigger t
                 WHERE t.tgname = 'set_ultima_atualizacao' AND t.tgrelid = to_regclass('public.produtos')
                   AND NOT t.tgisinternal AND t.tgenabled = 'O' AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
                   AND (t.tgtype & 1) = 1)
              THEN 'ligado' ELSE 'DIFERENTE' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
