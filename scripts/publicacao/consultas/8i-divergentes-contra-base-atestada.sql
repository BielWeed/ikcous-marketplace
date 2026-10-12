-- 8i — Os pedidos que a 8c acusa são os que o dono atestou, NO MESMO ESTADO?
-- NÃO SUBSTITUI a 8c, não a suaviza e não reinterpreta a regra dela: a 8c
-- continua rodando e continua acusando (qualquer divergente > 0 PARA o D1). A 8i
-- existe para que a decisão do dono, SE ele aceitar os divergentes conhecidos,
-- fique PRESA ao conjunto E ao estado deles — e não a "um número" que outro
-- pedido poderia ocupar (um dos três volta a ter item e OUTRO pedido perde os
-- itens: a contagem continua 3), nem a "os mesmos ids" com o subtotal ou o
-- status mudados no meio do caminho.
-- SÓ LEITURA, um único SELECT. Nenhum id e nenhum dado pessoal sai daqui: o que
-- sai é a contagem, os sinais, UMA impressão (sha256, 64 hex) e metadado do papel
-- e das tabelas (nome do papel, se tem BYPASSRLS, veredito de visibilidade).
--
-- A POPULAÇÃO é a MESMA da 8c (a CTE `soma` é copiada dela, linha a linha):
--     subtotal IS DISTINCT FROM COALESCE(SUM(quantity * price), 0)
-- O teste ci_conferir_banco_test.ts confere que a CTE é idêntica à da 8c.
--
-- O QUE A 8i CONFERE (cada linha é uma pergunta de sim ou não):
--   * o PAPEL: `papel efetivo` = supabase_read_only_user (o do endpoint somente
--     leitura). Outro papel REPROVA: o que se mede tem de ser o que o endpoint vê;
--   * a VISIBILIDADE das seis tabelas que a 8i lê ou que a 8h lê junto
--     (marketplace_orders, marketplace_order_items, marketplace_order_history,
--     marketplace_order_payment_history, order_refunds, devolucoes), uma linha
--     `<tabela>: visibilidade` cada, com os quatro vereditos da 8j. Só
--     VISIVEL_VAZIA e VISIVEL_COM_LINHAS passam; RLS_ATIVA_INCONCLUSIVO e
--     BLOQUEIA reprovam. A visibilidade é calculada AQUI, no MESMO statement (logo
--     no MESMO snapshot) que calcula os sinais e a impressão: não se confia numa
--     leitura de visibilidade feita antes, em outra consulta, noutro instante;
--   * controles: há pedidos e há itens (sem eles a população não faz sentido);
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
--   NESTA VERSÃO (visibilidade no snapshot) a população, a serialização e a
--   fórmula da impressão NÃO mudaram: a impressão sai IDÊNTICA à da versão
--   anterior (084c52dc) sobre os mesmos dados. As CTEs soma, div, enc e imp são
--   as mesmas, e o teste de banco compara os dois SQL no mesmo banco.
--
-- MODO MEDIR / MODO ATESTADO. Enquanto a constante for A_ATESTAR, a linha da
-- impressão REPROVA e o `vivo` mostra a impressão de agora: é assim que se mede.
-- Só DEPOIS de o dono atestar por escrito a impressão medida, um commit à parte
-- troca A_ATESTAR por ela (e o 3 pela contagem atestada, se mudar). Mudar a
-- constante é decisão do dono, nunca desta consulta, e nunca é calculada daqui.
--
-- OS SINAIS DAS TRÊS TABELAS AUXILIARES (registro em
-- marketplace_order_payment_history, estorno em order_refunds, devolução em
-- devolucoes) só são CONCLUSIVOS quando a tabela é VISIVEL_VAZIA ou
-- VISIVEL_COM_LINHAS para o papel. Aí o `vivo` é a contagem (0 numa tabela
-- VISIVEL_VAZIA é conclusivo: a tabela está mesmo vazia, e NÃO se exige uma linha
-- fictícia para provar que se enxerga). Se a tabela é RLS_ATIVA_INCONCLUSIVO ou
-- BLOQUEIA, o `vivo` é `INCONCLUSIVO (...)`, que NÃO é ok: um 0 sob RLS ativa não
-- prova ausência (a RLS pode esconder tudo ou parte). Por isso os controles
-- antigos "estornos / devolucoes / registros de pagamento visiveis" (que exigiam
-- >0) SAÍRAM: eles reprovavam a loja real, em que essas tabelas estão vazias e
-- visíveis, e a linha `<tabela>: visibilidade` já cobre exatamente a pergunta que
-- eles tentavam fazer (o papel enxerga a tabela?), sem exigir dado. Os controles
-- de pedidos e de itens CONTINUAM exigindo >0.
--
-- A VISIBILIDADE (mesma derivação da 8j; a 8j explica a semântica na fonte,
-- rls.c). row_security_active(tabela) diz se a RLS vale para o papel; o `apto`
-- confere esse resultado contra uma derivação independente (relrowsecurity, BYPASSRLS
-- ou superuser, dono sem FORCE) e contra relkind = 'r' e has_table_privilege
-- (SELECT de tabela inteira): se discordam, ou a tabela não é comum, ou o SELECT é
-- só de coluna, o veredito é BLOQUEIA. SEM SELECT NENHUM numa das tabelas a consulta
-- INTEIRA falha com 42501 (um statement estático não pula um SELECT sem permissão):
-- falha alta, nunca um zero silencioso.
--
-- O QUE ISTO NÃO DIZ:
--   * NÃO diz a origem dos pedidos, se foram teste ou venda, nem aponta erro ou
--     adulteração. Diz só: "hoje o conjunto e o estado cobertos são os que foram
--     atestados, e nenhum sinal de cobrança registrado apareceu neles".
--   * Ausência de sinal não prova ausência do fato: sem id de gateway, sem
--     registro de pagamento, sem estorno e sem devolução NÃO provam que nunca
--     houve pagamento (pode ter passado por fora do app, ou o registro pode ter
--     sido apagado). Não há auditoria de DELETE em marketplace_order_items nem de
--     UPDATE em `subtotal`. Uma tabela VISIVEL_VAZIA diz que NÃO HÁ linha agora, não
--     que nunca houve.
--   * A visibilidade vale para o papel que leu, neste statement. METADADO (relrowsecurity,
--     dono, privilégio, row_security_active) vem do cache de catálogo do Postgres e as
--     LINHAS vêm do snapshot do statement: uma ALTER TABLE que comitasse no meio da
--     execução poderia aparecer num lado e não no outro (o mesmo limite da 8j). A
--     8i NÃO elimina esse intervalo; ela o reduz a UM statement.
--   * `papel efetivo` compara só o NOME (current_user). A linha `atributos do papel`
--     só informa rolbypassrls e rolsuper e NUNCA reprova (esperado = vivo): quem
--     decide é a visibilidade de cada tabela. Um papel sem BYPASSRLS passa se a RLS
--     não se aplica às seis tabelas, e reprova se se aplica.
--   * A tabela marketplace_order_history entra na visibilidade (as seis da 8j, para
--     o veredito ser o mesmo nas duas), embora nenhum sinal da 8i dependa dela.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro), no formato da 8c. Nas
-- linhas `<tabela>: visibilidade` o esperado mostra o próprio veredito quando ele é
-- conclusivo (então ok) e `VISIVEL_VAZIA ou VISIVEL_COM_LINHAS` quando não é.
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
), papel AS (
  SELECT current_user::text AS nome,
         (SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS bypass,
         (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS super
), alvo(ordem, tabela) AS (
  VALUES (1, 'marketplace_orders'),
         (2, 'marketplace_order_items'),
         (3, 'marketplace_order_history'),
         (4, 'marketplace_order_payment_history'),
         (5, 'order_refunds'),
         (6, 'devolucoes')
), vis AS (
  SELECT 'marketplace_orders' AS tabela,
         EXISTS (SELECT 1 FROM public.marketplace_orders) AS tem_linha
  UNION ALL
  SELECT 'marketplace_order_items',
         EXISTS (SELECT 1 FROM public.marketplace_order_items)
  UNION ALL
  SELECT 'marketplace_order_history',
         EXISTS (SELECT 1 FROM public.marketplace_order_history)
  UNION ALL
  SELECT 'marketplace_order_payment_history',
         EXISTS (SELECT 1 FROM public.marketplace_order_payment_history)
  UNION ALL
  SELECT 'order_refunds',
         EXISTS (SELECT 1 FROM public.order_refunds)
  UNION ALL
  SELECT 'devolucoes',
         EXISTS (SELECT 1 FROM public.devolucoes)
), meta AS (
  SELECT a.ordem, a.tabela,
         c.relkind::text AS relkind,
         c.relrowsecurity AS rls_ligada,
         c.relforcerowsecurity AS rls_forcada,
         pg_has_role(current_user, c.relowner, 'USAGE') AS dono,
         has_table_privilege(current_user, c.oid, 'SELECT') AS pode_ler,
         row_security_active(c.oid) AS rls_ativa,
         v.tem_linha
    FROM alvo a
    LEFT JOIN pg_catalog.pg_class c
      ON c.relname = a.tabela AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN vis v ON v.tabela = a.tabela
), julga AS (
  SELECT m.*,
         COALESCE(m.relkind = 'r'
                  AND m.pode_ler
                  AND m.rls_ativa IS NOT NULL
                  AND m.rls_ativa = (m.rls_ligada
                                     AND NOT (p.bypass OR p.super)
                                     AND NOT (m.dono AND NOT m.rls_forcada)),
                  false) AS apto
    FROM meta m
   CROSS JOIN papel p
), veredito AS (
  SELECT j.ordem, j.tabela,
         CASE WHEN j.apto AND NOT j.rls_ativa AND NOT j.tem_linha THEN 'VISIVEL_VAZIA'
              WHEN j.apto AND NOT j.rls_ativa AND j.tem_linha THEN 'VISIVEL_COM_LINHAS'
              WHEN j.apto AND j.rls_ativa THEN 'RLS_ATIVA_INCONCLUSIVO'
              ELSE 'BLOQUEIA' END AS resultado
    FROM julga j
), leitura AS (
  SELECT v.ordem, v.tabela, v.resultado,
         (v.resultado IN ('VISIVEL_VAZIA', 'VISIVEL_COM_LINHAS')) AS conclusivo
    FROM veredito v
), r(item, esperado, vivo) AS (
  SELECT 'controle: pedidos visiveis', '>0',
         CASE WHEN (SELECT count(*) FROM soma) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'controle: itens de pedido visiveis', '>0',
         CASE WHEN (SELECT count(*) FROM public.marketplace_order_items) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'papel efetivo', 'supabase_read_only_user', p.nome
    FROM papel p
  UNION ALL
  SELECT 'atributos do papel (so informa; nunca reprova)', a.texto, a.texto
    FROM (SELECT 'rolbypassrls=' || COALESCE(p.bypass::text, '?') || '; rolsuper=' || COALESCE(p.super::text, '?') AS texto
            FROM papel p) a
  UNION ALL
  SELECT lt.tabela || ': visibilidade',
         CASE WHEN lt.conclusivo THEN lt.resultado ELSE 'VISIVEL_VAZIA ou VISIVEL_COM_LINHAS' END,
         lt.resultado
    FROM leitura lt
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
         CASE WHEN (SELECT lt.conclusivo FROM leitura lt WHERE lt.tabela = 'marketplace_order_payment_history')
              THEN (SELECT count(*) FILTER (WHERE tem_registro_de_pagamento) FROM div)::text
              ELSE 'INCONCLUSIVO (a tabela nao esta visivel para o papel; ver a linha de visibilidade)' END
  UNION ALL
  SELECT '  dos quais com estorno em order_refunds', '0',
         CASE WHEN (SELECT lt.conclusivo FROM leitura lt WHERE lt.tabela = 'order_refunds')
              THEN (SELECT count(*) FILTER (WHERE tem_estorno) FROM div)::text
              ELSE 'INCONCLUSIVO (a tabela nao esta visivel para o papel; ver a linha de visibilidade)' END
  UNION ALL
  SELECT '  dos quais com devolucao', '0',
         CASE WHEN (SELECT lt.conclusivo FROM leitura lt WHERE lt.tabela = 'devolucoes')
              THEN (SELECT count(*) FILTER (WHERE tem_devolucao) FROM div)::text
              ELSE 'INCONCLUSIVO (a tabela nao esta visivel para o papel; ver a linha de visibilidade)' END
  UNION ALL
  SELECT 'impressao de integridade do conjunto e do estado (sha256, 64 hex)', '6382d110fb62af00bcf3be7868185662f46b10faa3206af0fa8e01d3776d1b7b',
         COALESCE((SELECT hash FROM imp), '(sem divergentes)')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;
