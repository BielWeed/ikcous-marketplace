-- 28b — ANTES de aplicar a migration 20261225000000 (o reembolso da devolucao so e' "liberado" quando o dinheiro
-- sai): confirma, POR OBJETO, a base de antes: `devolucao_avisa_o_cliente` existe com o corpo ANTIGO, o da
-- 20261175000000 (que avisa "foi liberado" na conclusao, antes do dinheiro sair; md5), sem ler o estado do
-- reembolso, com os atributos de sempre (SECURITY DEFINER, plpgsql, VOLATILE, `search_path=public`); e as duas
-- funcoes novas e o gatilho novo de `order_refunds` ainda NAO existem. E' a consulta de AUSENCIA
-- (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 28a negativa
-- so vira "aplique" se esta for positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language, pg_trigger): nenhuma linha de
-- devolucao, de reembolso ou de aviso e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as mesmas em
-- qualquer estado do banco (objeto ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na
-- base de antes; uma loja que JA tem a migration reprova aqui de proposito, nas linhas do corpo, do estado real
-- e dos objetos novos.
--
--   * corpo     -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261175000000.
--   * estado real -- 'nao' se o corpo NAO le o status do reembolso (`SELECT r.status INTO v_estado`).
--   * objetos novos -- 'ausentes' se nem `devolucao__avisar_reembolso`, nem `devolucao_avisa_reembolso_liberado`,
--                   nem o gatilho `tr_order_refunds_avisa_reembolso_liberado` existem.
--
-- tests/banco/reembolso-da-devolucao-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- rollback, negativa depois do apply, um negativo por linha). O md5 do corpo antigo vem do arquivo da
-- 20261175000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.devolucao_avisa_o_cliente()')
), fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('SELECT r.status INTO v_estado' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS estado_real,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND p.proconfig = ARRAY['search_path=public']::text[]
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public' ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), novos AS (
  SELECT (to_regprocedure('public.devolucao__avisar_reembolso(uuid,text,text,text,text)') IS NULL
          AND to_regprocedure('public.devolucao_avisa_reembolso_liberado()') IS NULL
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = to_regclass('public.order_refunds')
                             AND t.tgname = 'tr_order_refunds_avisa_reembolso_liberado'
                             AND NOT t.tgisinternal)) AS ausentes
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: corpo e o da 20261175000000, que avisa liberado na conclusao (md5)',
         '0bf0bf168c1c0db817220329c47b64ef',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: o aviso da conclusao ainda NAO le o estado real do reembolso',
         'nao',
         COALESCE((SELECT f.estado_real FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_avisa_o_cliente: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'as duas funcoes novas e o gatilho de order_refunds ainda NAO existem',
         'ausentes',
         CASE WHEN (SELECT n.ausentes FROM novos n) THEN 'ausentes' ELSE 'presentes' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
