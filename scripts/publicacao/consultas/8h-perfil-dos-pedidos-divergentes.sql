-- 8h — PERFIL dos pedidos que a 8c acusa (soma dos itens ≠ `subtotal`).
-- É DIAGNÓSTICO, não portão: não substitui, não suaviza e não reinterpreta a
-- 8c. Quem decide continua sendo a 8c (qualquer divergente > 0 PARA); a 8h só
-- conta, por campo, COMO estão hoje os divergentes.
-- SÓ LEITURA, um único SELECT, só agregados: nenhum id de pedido, nenhum dado
-- de cliente (nome, e-mail, telefone, endereço, `customer_data`), nenhum
-- `user_id` e nenhum identificador de gateway saem daqui — só contagens.
--
-- A POPULAÇÃO é a MESMA da 8c (a CTE `soma` é copiada dela, linha a linha):
--     subtotal IS DISTINCT FROM COALESCE(SUM(quantity * price), 0)
-- O teste ci_conferir_banco_test.ts confere que a CTE é idêntica à da 8c.
--
-- O QUE ISTO DIZ E O QUE NÃO DIZ:
--   * Descreve o ESTADO ATUAL de campos observáveis (status, pagamento, método,
--     canal, mês de criação, faixa de subtotal, presença de histórico e de
--     registros ligados ao pedido). NÃO diz a origem do pedido, NÃO diz se foi
--     teste ou venda, NÃO aponta erro, fraude ou adulteração, e NÃO diz se o
--     pedido já teve itens. Mês, faixa de valor ou status não classificam um
--     pedido como teste.
--   * AUSÊNCIA de sinal não prova ausência do fato: sem id de gateway, sem
--     registro em marketplace_order_payment_history, sem estorno e sem
--     devolução NÃO provam que nunca houve pagamento — o pagamento pode ter
--     passado por fora do app, por um fluxo que não grava esses registros, ou
--     os registros podem ter sido apagados. PRESENÇA de sinal também não prova
--     que houve itens: só que existe aquele registro hoje.
--   * NÃO HÁ AUDITORIA de DELETE em marketplace_order_items nem de UPDATE em
--     `subtotal`: o banco não guarda "estes itens existiram" nem "o subtotal
--     era outro". A política `order_items_all_policy` (baseline
--     20260806000000, linha 5644) é FOR ALL, inclusive DELETE, para o admin OU
--     o dono do pedido — antes da 20261202 o dono podia apagar os próprios
--     itens. O histórico de status registra só mudança de status, não de item.
--
-- TEXTO LIVRE NUNCA SAI CRU: cada campo agrupado vira uma categoria de uma
-- lista fixa; valor fora da lista sai como (fora da lista, nao impresso).
--   status, payment_status, metodo_online e canal têm CHECK no schema (lista
--   abaixo), a categoria fora da lista é defesa contra CHECK alterado;
--   payment_method NÃO tem CHECK (20261162, linha ~103): é texto livre, e só
--   online/pix/card/cash (os valores que o código grava) são nomeados.
--   `subtotal` é numeric(10,2) NOT NULL desde o baseline (nunca alterado); a
--   faixa (nulo) vem antes das outras para um nulo nunca cair em > 1000.
--
-- Saída: secao | chave | pedidos (contagem em texto). Os controles de
-- visibilidade têm de ser >0 para a leitura valer: um papel que a RLS deixa
-- cego veria 0 divergentes sem ter olhado nada. Um controle de tabela
-- auxiliar em 0 quer dizer "tabela vazia OU invisível para este papel" — a
-- linha de sinal correspondente fica então inconclusiva, nunca "nenhum".
-- Sem BYPASSRLS, a política TO public de marketplace_order_payment_history
-- chama is_admin() (rls_admin_atual() depois da 20261202); sem EXECUTE nela, a
-- consulta inteira FALHA com 42501 (provado no banco local de teste; o grant
-- vivo da CAF não está no repositório) — falha alta, nunca zero silencioso.
WITH soma AS (
  SELECT o.id, o.subtotal,
         COALESCE(SUM(oi.quantity * oi.price), 0) AS soma_itens,
         count(oi.id) AS n_itens
    FROM public.marketplace_orders o
    LEFT JOIN public.marketplace_order_items oi ON oi.order_id = o.id
   GROUP BY o.id, o.subtotal
), div AS (
  SELECT o.id, s.n_itens, o.created_at, o.subtotal,
         (o.gateway_payment_id IS NOT NULL) AS tem_cobranca_no_gateway,
         o.payment_status,
         CASE WHEN o.status IS NULL THEN '(nulo)'
              WHEN o.status IN ('new', 'pending', 'processing', 'shipping', 'delivered', 'cancelled')
                THEN o.status
              ELSE '(fora da lista, nao impresso)' END AS cat_status,
         CASE WHEN o.payment_status IS NULL THEN '(nulo)'
              WHEN o.payment_status IN ('aguardando', 'pago', 'recusado', 'expirado', 'estornado',
                                        'pago_apos_expirar', 'recebido_na_entrega')
                THEN o.payment_status
              ELSE '(fora da lista, nao impresso)' END AS cat_payment_status,
         CASE WHEN o.payment_method IS NULL THEN '(nulo)'
              WHEN o.payment_method IN ('online', 'pix', 'card', 'cash') THEN o.payment_method
              ELSE '(fora da lista, nao impresso)' END AS cat_payment_method,
         CASE WHEN o.metodo_online IS NULL THEN '(nulo)'
              WHEN o.metodo_online IN ('pix', 'credito', 'debito') THEN o.metodo_online
              ELSE '(fora da lista, nao impresso)' END AS cat_metodo_online,
         CASE WHEN o.canal IS NULL THEN '(nulo)'
              WHEN o.canal IN ('online', 'presencial') THEN o.canal
              ELSE '(fora da lista, nao impresso)' END AS cat_canal
    FROM soma s
    JOIN public.marketplace_orders o ON o.id = s.id
   WHERE s.subtotal IS DISTINCT FROM s.soma_itens
), r(ordem, secao, chave, pedidos) AS (
  SELECT 0, 'controle', 'pedidos visiveis',
         CASE WHEN (SELECT count(*) FROM soma) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 0, 'controle', 'itens de pedido visiveis',
         CASE WHEN (SELECT count(*) FROM public.marketplace_order_items) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 0, 'controle', 'historico de status visivel',
         CASE WHEN EXISTS (SELECT 1 FROM public.marketplace_order_history) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 0, 'controle', 'registros de pagamento visiveis',
         CASE WHEN EXISTS (SELECT 1 FROM public.marketplace_order_payment_history) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 0, 'controle', 'estornos visiveis',
         CASE WHEN EXISTS (SELECT 1 FROM public.order_refunds) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 0, 'controle', 'devolucoes visiveis',
         CASE WHEN EXISTS (SELECT 1 FROM public.devolucoes) THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 1, 'total', 'divergentes (mesma regra da 8c)', (SELECT count(*) FROM div)::text
  UNION ALL
  SELECT 1, 'total', 'dos quais sem nenhum item', (SELECT count(*) FROM div WHERE n_itens = 0)::text
  UNION ALL
  SELECT 2, 'status', cat_status, count(*)::text FROM div GROUP BY 3
  UNION ALL
  SELECT 3, 'payment_status', cat_payment_status, count(*)::text FROM div GROUP BY 3
  UNION ALL
  SELECT 4, 'payment_method', cat_payment_method, count(*)::text FROM div GROUP BY 3
  UNION ALL
  SELECT 5, 'metodo_online', cat_metodo_online, count(*)::text FROM div GROUP BY 3
  UNION ALL
  SELECT 6, 'canal', cat_canal, count(*)::text FROM div GROUP BY 3
  UNION ALL
  SELECT 7, 'mes de criacao (UTC)',
         COALESCE(to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM'), '(nulo)'), count(*)::text
    FROM div GROUP BY 3
  UNION ALL
  SELECT 8, 'faixa de subtotal',
         CASE WHEN subtotal IS NULL THEN '(nulo)'
              WHEN subtotal <= 0 THEN '<= 0'
              WHEN subtotal <= 10 THEN '(0, 10]'
              WHEN subtotal <= 100 THEN '(10, 100]'
              WHEN subtotal <= 1000 THEN '(100, 1000]'
              ELSE '> 1000' END,
         count(*)::text
    FROM div GROUP BY 3
  UNION ALL
  SELECT 9, 'historico de status', 'com algum evento',
         (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.marketplace_order_history h
                                          WHERE h.order_id = div.id)))::text
    FROM div
  UNION ALL
  SELECT 9, 'historico de status', 'com evento para processing, shipping ou delivered',
         (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.marketplace_order_history h
                                          WHERE h.order_id = div.id
                                            AND h.new_status IN ('processing', 'shipping', 'delivered'))))::text
    FROM div
  UNION ALL
  SELECT 10, 'sinais de cobranca', 'com id de cobranca no gateway (so a presenca)',
         (count(*) FILTER (WHERE tem_cobranca_no_gateway))::text
    FROM div
  UNION ALL
  SELECT 10, 'sinais de cobranca', 'payment_status pago, pago_apos_expirar ou recebido_na_entrega',
         (count(*) FILTER (WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')))::text
    FROM div
  UNION ALL
  SELECT 10, 'sinais de cobranca', 'payment_status estornado',
         (count(*) FILTER (WHERE payment_status = 'estornado'))::text
    FROM div
  UNION ALL
  SELECT 10, 'sinais de cobranca', 'com registro em marketplace_order_payment_history',
         (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.marketplace_order_payment_history p
                                          WHERE p.order_id = div.id)))::text
    FROM div
  UNION ALL
  SELECT 10, 'sinais de cobranca', 'com estorno em order_refunds',
         (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.order_refunds rf
                                          WHERE rf.order_id = div.id)))::text
    FROM div
  UNION ALL
  SELECT 10, 'sinais de cobranca', 'com devolucao',
         (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.devolucoes dv
                                          WHERE dv.order_id = div.id)))::text
    FROM div
)
SELECT secao, chave, pedidos
  FROM r
 ORDER BY ordem, chave;
