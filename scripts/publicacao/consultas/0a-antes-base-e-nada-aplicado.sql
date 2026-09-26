SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'store_config'
           AND column_name = 'formas_pagamento_entrega') AS base_74,  -- 1: a base (PR #664) já está na loja
       to_regclass('public.devolucoes')                  AS t75,      -- NULL
       to_regclass('public.config_pagamento_cartao')     AS t76,      -- NULL
       to_regclass('public.fin_contas')                  AS t77,      -- NULL
       to_regprocedure('public.painel_inicio()')         AS f78;      -- NULL
