-- 201m — MEDICAO, so leitura, das avaliacoes repetidas (mesma conta + mesmo produto), antes e depois da 20261641000000.
-- Uma loja por run. Rol aberto, sem coluna ok: nunca e' prova do portao da release. So contagens: nenhum id, nome,
-- texto ou nota de avaliacao sai no log. A migration nao le nem reescreve nenhuma linha de reviews; a contagem
-- antes e depois do apply tem de dar o MESMO numero (as repetidas antigas ficam como estao).
SELECT (SELECT count(*) FROM public.reviews) AS avaliacoes_total,
       count(*) AS pares_repetidos,
       COALESCE(sum(d.n - 1), 0) AS avaliacoes_a_mais
  FROM (SELECT r.user_id, r.product_id, count(*) AS n
          FROM public.reviews r
         GROUP BY r.user_id, r.product_id
        HAVING count(*) > 1) d;
