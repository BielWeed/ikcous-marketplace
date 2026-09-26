-- Corpos vivos ANTES das 72-74: devem bater com o que os rollbacks restauram.
SELECT v.funcao, count(p.oid) AS versoes_vivas,
       bool_and(md5(replace(p.prosrc, E'\r', '')) = v.md5) AS igual_ao_rollback
  FROM (VALUES ('create_marketplace_order_v23', '34ee39c2536171dda29eb31622fb6bf2'),
               ('create_marketplace_order_v24', '9a7113aa9ef1e93c951d4b8bb7aada7b'),
               ('upsert_store_config', '9d7a2752fea26847a86c189f88d31d62')) AS v(funcao, md5)
  LEFT JOIN pg_proc p ON p.proname = v.funcao AND p.pronamespace = 'public'::regnamespace
 GROUP BY v.funcao ORDER BY v.funcao;
