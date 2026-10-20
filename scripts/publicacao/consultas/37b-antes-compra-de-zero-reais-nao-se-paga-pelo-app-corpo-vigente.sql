-- 37b — ANTES de aplicar a migration 20261236000000 (a compra que da R$ 0,00 nao se paga pelo app): confirma, POR OBJETO, a
-- base de antes: `create_marketplace_order_v24` existe, UMA so, com o corpo VIGENTE (md5, o da 20261229000000, o endereco
-- da compra fica no pedido), SEM a recusa do total zero pelo app, e com os atributos de sempre. E' a consulta de AUSENCIA
-- (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 37a negativa so vira
-- "aplique" se esta for positiva (a loja esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de pedido, de cupom, de
-- produto ou de cliente e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL da funcao e' a de sempre (PUBLIC nao; anon, authenticated e service_role sim); o
-- pre-voo da migration recusa o apply com a ACL diferente (B1_BASELINE_DIVERGENT), e a 37a a mede DEPOIS.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as mesmas em qualquer
-- estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de antes; uma loja
-- que JA tem a recusa reprova aqui de proposito, nas linhas do corpo e do marcador. Uma loja ainda no corpo da
-- 20261174000000 (o lote da 20261229000000 nao aplicado) tambem reprova na linha do corpo: aplique o lote da 20261229000000 antes, a migration recusa
-- (B1_BASELINE_DIVERGENT) um corpo que ninguem mediu.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261229000000.
--   * marcador -- 'nao' se a recusa do total zero pelo app NAO aparece no corpo (so o corpo novo traz o identificador
--                `pedido_sem_valor_a_pagar_pelo_app`).
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + nao SETOF + `search_path=public` + retorno uuid.
--
-- tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva depois do rollback, negativa depois do apply, um negativo por linha). O md5 do corpo de antes vem do ARQUIVO da
-- migration 20261229000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'create_marketplace_order_v24') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('pedido_sem_valor_a_pagar_pelo_app' IN p.prosrc) > 0 THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset
                   AND p.proconfig = ARRAY['search_path=public']::text[]
                   AND p.prorettype = 'uuid'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=public -> uuid' ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'create_marketplace_order_v24: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o da 20261229000000, sem a recusa do total zero pelo app (md5)',
         'b1ee9337105f442511c13a75977911b7',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: o corpo ainda NAO recusa o pedido pelo app cujo total do servidor e zero',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public -> uuid',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
