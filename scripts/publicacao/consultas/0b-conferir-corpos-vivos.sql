SELECT v.funcao, count(p.oid) AS versoes_vivas,
       bool_and(md5(replace(p.prosrc, E'\r', '')) = v.md5) AS igual_ao_rollback
  FROM (VALUES ('devolver_estoque', '209838b88d76ae9e8c003ef928232bcf'),
               ('get_admin_orders_cancelados_recentes', 'c7f3f0f749373e904071888686bf9ce6'),
               ('solicitar_estorno', '97045c26a318f98e703c2005638d8785'),
               ('update_order_status_atomic', 'adfc4d3c40f2e6bfe6ec29b08e9ca323'),
               ('registrar_estorno_manual', '30dda5e415cb7ae6112f2499c9c8cd9a')) AS v(funcao, md5)
  LEFT JOIN pg_proc p ON p.proname = v.funcao AND p.pronamespace = 'public'::regnamespace
 GROUP BY v.funcao ORDER BY v.funcao;
