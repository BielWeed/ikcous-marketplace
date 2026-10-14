-- 31b — ANTES de aplicar a migration 20261229000000 (o endereco da compra fica no pedido): confirma, POR OBJETO, a base de
-- antes: `create_marketplace_order_v23` e `create_marketplace_order_v24` existem com o corpo ANTIGO, o da 20261174000000
-- (formas de pagamento por loja), SEM a copia do endereco da conta (md5), e com os atributos de sempre (SECURITY DEFINER,
-- plpgsql, VOLATILE, `search_path=public`). E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em
-- `provasDeObjetos` de scripts/frota/canais-de-backend.json: a 31a negativa so vira "aplique" se esta for positiva (a loja
-- esta na base de antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de pedido, de endereco ou de
-- cliente e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL das duas funcoes nao muda nesta migration (CREATE OR REPLACE a preserva) e e' medida
-- pela 31a; o pre-voo da migration recusa o apply com a ACL fora do esperado.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 7 linhas, as mesmas em qualquer
-- estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de antes; uma loja que
-- JA tem a copia reprova aqui de proposito, nas linhas dos corpos.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261174000000, sem a copia.
--   * copia   -- 'nao' se `FROM public.user_addresses ua` NAO aparece antes do `INSERT INTO public.marketplace_orders`.
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + proconfig = {search_path=public}.
--
-- tests/banco/endereco-no-pedido-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do rollback, negativa
-- depois do apply, um negativo por linha). O md5 do corpo antigo vem do arquivo da 20261174000000, nao de uma loja: o valor
-- VIVO de cada loja so esta consulta mede. LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
WITH alvo(nome, assinatura) AS (
  VALUES ('create_marketplace_order_v23', 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)'),
         ('create_marketplace_order_v24', 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)')
), fn AS (
  SELECT t.nome,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('FROM public.user_addresses ua' IN p.prosrc) > 0
                   AND position('FROM public.user_addresses ua' IN p.prosrc) < position('INSERT INTO public.marketplace_orders' IN p.prosrc)
              THEN 'sim' ELSE 'nao' END AS copia,
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
  SELECT 'create_marketplace_order_v23: corpo e o da 20261174000000, sem a copia do endereco (md5)',
         '59cbccc4aa8762a26cf98f2acf1c721a',
         COALESCE((SELECT f.m FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: corpo e o da 20261174000000, sem a copia do endereco (md5)',
         '8381691b7a03a9b232d21de8d756991d',
         COALESCE((SELECT f.m FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: o corpo ainda NAO copia o endereco da conta',
         'nao',
         COALESCE((SELECT f.copia FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: o corpo ainda NAO copia o endereco da conta',
         'nao',
         COALESCE((SELECT f.copia FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v23: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.nome = 'create_marketplace_order_v23'), 'AUSENTE')
  UNION ALL
  SELECT 'create_marketplace_order_v24: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=public',
         COALESCE((SELECT f.atributos FROM fn f WHERE f.nome = 'create_marketplace_order_v24'), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
