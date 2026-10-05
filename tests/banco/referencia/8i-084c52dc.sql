-- 8i — Os pedidos que a 8c acusa são os que o dono atestou, NO MESMO ESTADO?
-- NÃO SUBSTITUI a 8c, não a suaviza e não reinterpreta a regra dela: a 8c
-- continua rodando e continua acusando (qualquer divergente > 0 PARA o D1). A 8i
-- existe para que a decisão do dono, SE ele aceitar os divergentes conhecidos,
-- fique PRESA ao conjunto E ao estado deles — e não a "um número" que outro
-- pedido poderia ocupar (um dos três volta a ter item e OUTRO pedido perde os
-- itens: a contagem continua 3), nem a "os mesmos ids" com o subtotal ou o
-- status mudados no meio do caminho.
-- SÓ LEITURA, um único SELECT. Nenhum id e nenhum dado pessoal sai daqui: o que
-- sai é a contagem, os sinais e UMA impressão (sha256, 64 hex).
--
-- A POPULAÇÃO é a MESMA da 8c (a CTE `soma` é copiada dela, linha a linha):
--     subtotal IS DISTINCT FROM COALESCE(SUM(quantity * price), 0)
-- O teste ci_conferir_banco_test.ts confere que a CTE é idêntica à da 8c.
--
-- O QUE A 8i CONFERE (cada linha é uma pergunta de sim ou não):
--   * controles: pedidos, itens e as três tabelas de sinal são visíveis para este
--     papel (um papel que a RLS deixa cego veria "0 sinais" sem ter olhado nada);
--   * os divergentes são 3 (a base atestada), todos cancelled, todos sem item;
--   * nenhum tem id de cobrança no gateway, payment_status de pagamento ou
--     estorno (pago, pago_apos_expirar, recebido_na_entrega, estornado) nem
--     registro em marketplace_order_payment_history, order_refunds ou devolucoes;
--   * IMPRESSÃO DE INTEGRIDADE do conjunto e do estado, comparada com a constante
--     embutida abaixo.
--
-- A IMPRESSÃO: encode(sha256(convert_to(<serialização>, 'UTF8')), 'hex'), os 64
-- hex. A serialização é CANÔNICA: uma linha por divergente, ordenadas por id; em
-- cada linha os campos nesta ordem fixa, separados por ';', cada um escrito como
-- <comprimento>:<texto> (assim nenhum valor "se parece" com um separador) e o NULL
-- como a letra N (assim NULL não se confunde com texto vazio):
--     id, created_at, updated_at, status, payment_status, payment_method,
--     metodo_online, canal, subtotal, total, shipping, discount, valor_estornado,
--     paid_at, (gateway_payment_id IS NOT NULL), n_itens, soma_itens,
--     total_amount, shipping_cost
-- Os numeric de escala FIXA (numeric(10,2)) entram como ::numeric(12,2)::text
-- (100.0 e 100.00 dão o mesmo texto). total_amount e shipping_cost são numeric
-- SEM escala (baseline 20260806000000, linhas 3976 e 3977): ::numeric(12,2)
-- ARREDONDARIA uma mudança na 3ª casa e a esconderia; por isso entram como
-- trim_scale(x)::text (tira só os zeros à direita: 100 e 100.000 dão o mesmo
-- texto, mas 100.001 não). O NULL de qualquer campo sai como N.
-- timestamptz entra em UTC, ISO, com microssegundos (independe do fuso da sessão);
-- o booleano do gateway entra só como true/false (o id do gateway nunca entra).
--   ENTRA o que fala de dinheiro (inclusive total_amount e shipping_cost, que o
--   mesmo pedido grava ao lado de total e shipping), de pagamento e de estado do
--   pedido, e o que mostra "o pedido foi tocado": updated_at. Qualquer toque num pedido cancelado
--   é motivo para decidir de novo; o custo é um possível ALARME FALSO (uma rotina
--   que mexa em updated_at sem mudar nada que importe), que é o lado seguro: o
--   preço é medir e atestar de novo, nunca deixar passar. SAEM os campos que
--   identificam a pessoa (nome, contato, endereço, customer_data, user_id) e o id
--   do gateway.
--   ESTA IMPRESSÃO: muda se QUALQUER campo coberto mudar (inclusive a troca de um
--   pedido por outro); NÃO diz a origem dos pedidos; a colisão de SHA-256 é
--   teórica, mas a impressão NÃO substitui auditoria — um campo fora da lista
--   (por exemplo uma linha de item apagada e recriada igual) não é visto por ela.
--
-- MODO MEDIR / MODO ATESTADO. Enquanto a constante for A_ATESTAR, a linha da
-- impressão REPROVA e o `vivo` mostra a impressão de agora: é assim que se mede.
-- Só DEPOIS de o dono atestar por escrito a impressão medida, um commit à parte
-- troca A_ATESTAR por ela (e o 3 pela contagem atestada, se mudar). Mudar a
-- constante é decisão do dono, nunca desta consulta, e nunca é calculada daqui.
--
-- O QUE ISTO NÃO DIZ:
--   * NÃO diz a origem dos pedidos, se foram teste ou venda, nem aponta erro ou
--     adulteração. Diz só: "hoje o conjunto e o estado cobertos são os que foram
--     atestados, e nenhum sinal de cobrança registrado apareceu neles".
--   * Ausência de sinal não prova ausência do fato: sem id de gateway, sem
--     registro de pagamento, sem estorno e sem devolução NÃO provam que nunca
--     houve pagamento (pode ter passado por fora do app, ou o registro pode ter
--     sido apagado). Não há auditoria de DELETE em marketplace_order_items nem de
--     UPDATE em `subtotal`.
--   * ESTORNO E DEVOLUÇÃO: se a tabela está vazia OU invisível para o papel, o
--     controle lê 0 e a linha de sinal sai INCONCLUSIVO — e INCONCLUSIVO NÃO É ok,
--     é bloqueante. (Foi o que a 8h leu na CAF em 04/10: os dois controles deram
--     0.) Quem decide o que fazer com um inconclusivo é o dono, não esta consulta.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro), no formato da 8c.
-- Sem BYPASSRLS, a política TO public de marketplace_order_payment_history chama
-- is_admin() (rls_admin_atual() depois da 20261202); sem EXECUTE nela a consulta
-- inteira FALHA com 42501 — falha alta, nunca zero silencioso.
WITH soma AS (
  SELECT o.id, o.subtotal,
         COALESCE(SUM(oi.quantity * oi.price), 0) AS soma_itens,
         count(oi.id) AS n_itens
    FROM public.marketplace_orders o
    LEFT JOIN public.marketplace_order_items oi ON oi.order_id = o.id
   GROUP BY o.id, o.subtotal
), div AS (
  SELECT o.id, s.n_itens, s.soma_itens,
         o.created_at, o.updated_at, o.status, o.payment_status, o.payment_method,
         o.metodo_online, o.canal, o.subtotal, o.total, o.shipping, o.discount,
         o.valor_estornado, o.paid_at, o.total_amount, o.shipping_cost,
         (o.status IS NOT DISTINCT FROM 'cancelled') AS cancelado,
         (o.gateway_payment_id IS NOT NULL) AS tem_cobranca_no_gateway,
         COALESCE(o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado'), false) AS tem_status_de_pagamento,
         EXISTS (SELECT 1 FROM public.marketplace_order_payment_history p
                  WHERE p.order_id = o.id) AS tem_registro_de_pagamento,
         EXISTS (SELECT 1 FROM public.order_refunds rf
                  WHERE rf.order_id = o.id) AS tem_estorno,
         EXISTS (SELECT 1 FROM public.devolucoes dv
                  WHERE dv.order_id = o.id) AS tem_devolucao
    FROM soma s
    JOIN public.marketplace_orders o ON o.id = s.id
   WHERE s.subtotal IS DISTINCT FROM s.soma_itens
), enc AS (
  SELECT d.id,
         string_agg(CASE WHEN f.v IS NULL THEN 'N' ELSE length(f.v)::text || ':' || f.v END,
                    ';' ORDER BY f.n) AS linha
    FROM div d
   CROSS JOIN LATERAL (VALUES
     (1, d.id::text),
     (2, to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
     (3, to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
     (4, d.status),
     (5, d.payment_status),
     (6, d.payment_method),
     (7, d.metodo_online),
     (8, d.canal),
     (9, d.subtotal::numeric(12,2)::text),
     (10, d.total::numeric(12,2)::text),
     (11, d.shipping::numeric(12,2)::text),
     (12, d.discount::numeric(12,2)::text),
     (13, d.valor_estornado::numeric(12,2)::text),
     (14, to_char(d.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
     (15, d.tem_cobranca_no_gateway::text),
     (16, d.n_itens::text),
     (17, d.soma_itens::numeric(12,2)::text),
     (18, trim_scale(d.total_amount)::text),
     (19, trim_scale(d.shipping_cost)::text)
   ) AS f(n, v)
   GROUP BY d.id
), imp AS (
  SELECT encode(sha256(convert_to(string_agg(linha, '#' ORDER BY id), 'UTF8')), 'hex') AS hash
    FROM enc
), r(item, esperado, vivo) AS (
  SELECT 'controle: pedidos visiveis', '>0',
         CASE WHEN (SELECT count(*) FROM soma) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'controle: itens de pedido visiveis', '>0',
         CASE WHEN (SELECT count(*) FROM public.marketplace_order_items) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'controle: registros de pagamento visiveis', '>0',
         CASE WHEN EXISTS (SELECT 1 FROM public.marketplace_order_payment_history) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'controle: estornos visiveis', '>0',
         CASE WHEN EXISTS (SELECT 1 FROM public.order_refunds) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'controle: devolucoes visiveis', '>0',
         CASE WHEN EXISTS (SELECT 1 FROM public.devolucoes) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'pedidos divergentes (mesma regra da 8c; base atestada)', '3',
         (SELECT count(*) FROM div)::text
  UNION ALL
  SELECT '  dos quais fora de cancelled', '0',
         (SELECT count(*) FILTER (WHERE NOT cancelado) FROM div)::text
  UNION ALL
  SELECT '  dos quais com algum item', '0',
         (SELECT count(*) FILTER (WHERE n_itens > 0) FROM div)::text
  UNION ALL
  SELECT '  dos quais com id de cobranca no gateway (so a presenca)', '0',
         (SELECT count(*) FILTER (WHERE tem_cobranca_no_gateway) FROM div)::text
  UNION ALL
  SELECT '  dos quais com payment_status pago, pago_apos_expirar, recebido_na_entrega ou estornado', '0',
         (SELECT count(*) FILTER (WHERE tem_status_de_pagamento) FROM div)::text
  UNION ALL
  SELECT '  dos quais com registro em marketplace_order_payment_history', '0',
         CASE WHEN EXISTS (SELECT 1 FROM public.marketplace_order_payment_history)
              THEN (SELECT count(*) FILTER (WHERE tem_registro_de_pagamento) FROM div)::text
              ELSE 'INCONCLUSIVO (tabela sem linha visivel)' END
  UNION ALL
  SELECT '  dos quais com estorno em order_refunds', '0',
         CASE WHEN EXISTS (SELECT 1 FROM public.order_refunds)
              THEN (SELECT count(*) FILTER (WHERE tem_estorno) FROM div)::text
              ELSE 'INCONCLUSIVO (tabela sem linha visivel)' END
  UNION ALL
  SELECT '  dos quais com devolucao', '0',
         CASE WHEN EXISTS (SELECT 1 FROM public.devolucoes)
              THEN (SELECT count(*) FILTER (WHERE tem_devolucao) FROM div)::text
              ELSE 'INCONCLUSIVO (tabela sem linha visivel)' END
  UNION ALL
  SELECT 'impressao de integridade do conjunto e do estado (sha256, 64 hex)', 'A_ATESTAR',
         COALESCE((SELECT hash FROM imp), '(sem divergentes)')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;
