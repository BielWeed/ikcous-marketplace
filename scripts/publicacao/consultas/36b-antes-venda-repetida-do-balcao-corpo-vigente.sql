-- 36b — ANTES de aplicar a migration 20261235000000 (a venda repetida do balcao devolve a venda feita): confirma, POR
-- OBJETO, a base de antes: `registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)` existe, UMA so, com o
-- corpo VIGENTE (md5, o da 20261199000000, portas do painel exigem o admin atual), SEM a trava pela chave de idempotencia,
-- e com os atributos de sempre. E' a consulta de AUSENCIA (`ausenciaConfirmadaPor`) do lote em `provasDeObjetos` de
-- scripts/frota/canais-de-backend.json: a 36a negativa so vira "aplique" se esta for positiva (a loja esta na base de
-- antes, nao em um corpo que ninguem mediu).
-- SO LEITURA, um unico SELECT, so catalogo (pg_proc, pg_namespace, pg_language): nenhuma linha de venda, de pedido, de
-- produto ou de cliente e' lida nem devolvida.
--
-- NAO mede a ACL de proposito: a ACL da funcao e' a da 20261199000000 (EXECUTE so para authenticated); o pre-voo da
-- migration recusa o apply com a ACL diferente (B1_BASELINE_DIVERGENT), e a 36a a mede DEPOIS.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 5 linhas, as mesmas em
-- qualquer estado do banco (funcao ausente vira `AUSENTE` na propria linha). Tudo `true` = a loja esta na base de
-- antes; uma loja que JA tem a trava pela chave reprova aqui de proposito, nas linhas do corpo e do marcador. Uma loja
-- num corpo que ninguem mediu (a 20261199000000 nao aplicada, ou outra redefinicao) reprova na linha do corpo: PARE e
-- meca antes de aplicar.
--
--   * corpo   -- md5(replace(prosrc, chr(13), '')) do corpo vivo (LF ou CRLF): o da 20261199000000.
--   * marcador -- 'nao' se a trava pela chave NAO aparece no corpo (so o corpo novo a traz).
--   * atributos -- SECURITY DEFINER + plpgsql + VOLATILE + nao STRICT + 8 argumentos + `search_path=pg_catalog, pg_temp`
--                + retorno jsonb.
--
-- tests/banco/venda-balcao-mesma-chave-portao-viva.cjs roda esta consulta num Postgres real (positiva depois do
-- rollback, negativa depois do apply, um negativo por linha). O md5 do corpo de antes vem do ARQUIVO da migration
-- 20261199000000, nao de uma loja: o valor VIVO de cada loja so esta consulta mede.
-- LIMITE: evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta consulta contra o ref de cada loja.
WITH alvo(assinatura) AS (
  VALUES ('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)')
), fn AS (
  SELECT p.oid,
         (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = 'registrar_venda_presencial') AS sobrecargas,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         CASE WHEN position('hashtextextended(''venda_presencial:'' || p_idempotency_key::text, 0)' IN p.prosrc) > 0
              THEN 'sim' ELSE 'nao' END AS marcador,
         CASE WHEN p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
                   AND NOT p.proisstrict AND NOT p.proretset AND p.pronargs = 8
                   AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
                   AND p.prorettype = 'jsonb'::regtype
              THEN 'SECURITY DEFINER plpgsql VOLATILE search_path=pg_catalog, pg_temp -> jsonb'
              ELSE 'DIFERENTE' END AS atributos
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
    JOIN pg_language l ON l.oid = p.prolang
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'registrar_venda_presencial: sobrecargas', '1',
         COALESCE((SELECT f.sobrecargas::text FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: corpo e o da 20261199000000, sem a trava pela chave (md5)',
         '6a421904a7c99a0e17ca58f2f891c71d',
         COALESCE((SELECT f.m FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: o corpo ainda NAO toma a trava pela chave de idempotencia',
         'nao',
         COALESCE((SELECT f.marcador FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=pg_catalog, pg_temp)',
         'SECURITY DEFINER plpgsql VOLATILE search_path=pg_catalog, pg_temp -> jsonb',
         COALESCE((SELECT f.atributos FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
