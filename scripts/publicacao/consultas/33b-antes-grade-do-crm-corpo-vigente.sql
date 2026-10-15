-- 33b — ANTES de aplicar a migration 20261232000000 (a grade do CRM mede a recencia do mesmo instante da lista):
-- confirma a base de antes: public.crm_visao existe com o corpo VIGENTE (md5, o da 20261227000000), SEM a ancora de
-- agora, e com os atributos de sempre (SECURITY DEFINER, plpgsql, STABLE, `search_path=public`). E' a consulta de
-- AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 33a
-- negativa so vira "aplique" se esta for positiva (a loja esta na base de antes, nao em um corpo que ninguem
-- mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de pedido, de
-- cliente ou de perfil e' lida nem devolvida.
--
-- ORDEM: esta consulta so da positiva DEPOIS do lote da 20261227000000 (a 30a). Uma loja ainda no corpo da
-- 20261199000000 reprova aqui, na linha do corpo: a 20261232000000 nao pode ser aplicada antes da 27 (o pre-voo
-- tambem recusa).
--
-- NAO mede a ACL de proposito: a ACL da funcao e' a da 20261199000000 (lote 8e) e e' da 8e e da 22a; o pre-voo da
-- migration recusa o apply com a ACL diferente.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 4 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem a ancora de agora reprova aqui de proposito, nas linhas do corpo e do marcador.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261227000000.
--   * marcador -- 'nao' se `LEAST(((p_fim + 1)::timestamp ...), now())` NAO aparece no corpo (so o corpo novo o traz).
--   * atributos -- SECURITY DEFINER + plpgsql + STABLE + proconfig = {search_path=public}.
--
-- tests/banco/a-grade-do-crm-mede-a-recencia-portao-viva.cjs roda esta consulta num Postgres real (positiva
-- depois do rollback, negativa depois do apply, um negativo por linha). O md5 do corpo de antes vem do ARQUIVO da
-- migration 20261227000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('LEAST(((p_fim + 1)::timestamp AT TIME ZONE ''America/Sao_Paulo''), now())' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql STABLE search_path=public' ELSE 'DIFERENTE' END AS atributos
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.crm_visao(date,date)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'crm_visao: corpo e o da 20261227000000, sem a ancora de agora (md5)',
         'c33073503fccc6caa5f1085265501eae',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: o corpo ainda NAO mede o periodo ate agora',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)',
         'SECURITY DEFINER plpgsql STABLE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
