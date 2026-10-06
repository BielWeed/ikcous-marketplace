-- 8d — Depois do ESCOAMENTO (drain) das edges de estorno: existe alguma linha de
-- `order_refunds` marcada `concluido` mas SEM `concluido_em`? Essas são as
-- "órfãs": o estorno saiu e o carimbo de conclusão não, e o critério novo da
-- 20261196000000 não as enxerga como concluídas.
-- SÓ LEITURA, um único SELECT, só contagens: nenhum id de pedido ou de estorno,
-- nenhum valor, sai daqui.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro).
--   * `orfas` esperado 0.
--   * Controle de visibilidade: se a RLS esconde `order_refunds` deste papel, o
--     0 de `orfas` não vale nada. O controle compara as linhas VISÍVEIS com a
--     estimativa do catálogo (`pg_class.reltuples`, que a RLS não filtra) e
--     lista se há RLS ligada e se o papel tem SELECT. `reltuples` é -1 numa
--     tabela nunca analisada; aí o controle REPROVA e diz `estimativa
--     indisponivel` (cauteloso de propósito: sem estimativa não há como provar
--     que o 0 de `orfas` veio de olhar a tabela inteira).
--     As linhas `informativo` repetem o valor nas duas colunas (não reprovam).
WITH v AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE status = 'concluido') AS concluidas,
         count(*) FILTER (WHERE status = 'concluido' AND concluido_em IS NULL) AS orfas
    FROM public.order_refunds
), c AS (
  SELECT relrowsecurity AS rls, reltuples::bigint AS est
    FROM pg_class
   WHERE oid = 'public.order_refunds'::regclass
), r(item, esperado, vivo) AS (
  SELECT 'controle: papel pode ler order_refunds', 'true',
         has_table_privilege(current_user, 'public.order_refunds', 'SELECT')::text
  UNION ALL
  SELECT 'controle: linhas visiveis vs estimativa do catalogo', 'visiveis coerentes com a estimativa',
         CASE WHEN c.est > 0 AND v.total = 0 THEN 'ESCONDIDAS: estimativa ' || c.est || ', visiveis 0'
              WHEN c.est < 0 THEN 'estimativa indisponivel (tabela nunca analisada); visiveis ' || v.total
              ELSE 'visiveis coerentes com a estimativa' END
    FROM v, c
  UNION ALL
  SELECT 'informativo: RLS ligada em order_refunds', c.rls::text, c.rls::text
    FROM c
  UNION ALL
  SELECT 'informativo: linhas visiveis em order_refunds', v.total::text, v.total::text
    FROM v
  UNION ALL
  SELECT 'informativo: linhas concluidas', v.concluidas::text, v.concluidas::text
    FROM v
  UNION ALL
  SELECT 'orfas: status concluido sem concluido_em', '0', v.orfas::text
    FROM v
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;
