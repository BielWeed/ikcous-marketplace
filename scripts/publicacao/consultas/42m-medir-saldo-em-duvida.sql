-- 42m — MEDICAO, so leitura, do tamanho do "reembolso em duvida" ANTES da migration do reembolso A/B
-- (plano em equipe/bastoes/reembolso-ab-plano-20261015.md, secao 2 e tarefa T0). Hoje o saldo a estornar de um
-- pedido (`pedido__saldo_a_estornar`, 20261198000000) IGNORA as linhas `falhou`/`recusado` de `order_refunds`;
-- a decisao B passa a descontar as que PODEM TER SAIDO no Mercado Pago. Esta consulta mede quanto isso prende.
-- Molde da 18a/22m/27m/32m/35m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release.
-- Quem decide e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), por
-- conferir-banco-da-loja.yml (papel `supabase_read_only_user`), ANTES de escrever a migration.
--
-- REGRA "PODE TER SAIDO" (texto IDENTICO a ordem do plano; a funcao `order_refund__pode_ter_saido` da T1 nasce
-- com esta mesma ordem, e tests/ci_conferir_banco_test.ts prende os dois textos):
--   (1) mp_refund_id presente -> true;
--   (2) nada_saiu_provado_em presente -> false;
--   (3) recusado sem post_autorizado_em -> false;
--   (4) falhou com diagnostico, sem carimbo e codigo na lista fechada -> false;
--   (5) senao true (inclui falhou antiga sem diagnostico).
-- O passo (2) e IGNORADO aqui: a tabela `order_refund_prova` ainda nao existe (a linha de controle diz se ela ja
-- existe na loja). Lista fechada = `CODIGOS_NADA_SAIU` de supabase/functions/_shared/estorno.ts e o `v_sem_post`
-- da 20261226000000: 'insufficient_money_for_refund' e 'order_payment_not_yet_enabled_for_refund'.
-- Forma de pagamento: cartao = metodo_online IN ('credito','debito'); pix = 'pix' OU NULL (NULL tratado como PIX).
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?), se a RLS VALE para quem leu nas 4 tabelas lidas (com a RLS
--              valendo em order_refund_diagnostico, toda linha falhou parece "legado sem diagnostico" e o numero
--              sai INFLADO; nas outras, sai baixo), se `order_refund_prova` ja existe, e a autoconferencia da regra
--              contra a categoria (divergencias tem de ser 0).
--   a_linha    linhas falhou/recusado por categoria EXCLUSIVA (o passo da regra que decide) x forma: linhas, soma,
--              quantas a regra diz que podem ter saido.
--   a_marca    as mesmas linhas por status x forma, com as marcas NAO exclusivas (com mp_refund_id, sem
--              diagnostico, com carimbo post_incerto_em, codigo na lista, codigo fora da lista).
--   b_saldo    por forma: pedidos com linha, quantos teriam o saldo REDUZIDO se as linhas em duvida descontassem,
--              a soma em duvida, quantos passariam de saldo > 0 para saldo <= 0, e quantos ficariam negativos.
--              Conta de `pedido__saldo_a_estornar` (20261198:243-264) reescrita em linha (a funcao e fechada para
--              todos os papeis, inclusive o leitor).
--   c_cancel   pedidos CANCELADOS com linha `falhou` em duvida, por forma (o cartao e a pergunta; o pix vai junto).
--   d_travada  linhas em_processamento com tentativas >= 5, por idade desde COALESCE(post_autorizado_em,
--              created_at): >= 3 dias e >= 7 dias; candidatas = nao sistema, sem mp_refund_id, >= 3 dias.
--   e_viva     linhas vivas (solicitado/em_processamento, nao sistema) que `autorizar_post_do_estorno`
--              (20261196:971-976, que NAO desconta o reembolso manual) passaria a RECUSAR: so pelo manual, e pela
--              conta nova inteira (manual + concluido ainda nao somado + em duvida das outras linhas).
--   f_legado   por forma: linhas falhou/recusado que a regra do LEGADO de `linhaPodeJaTerChegadoAoMp`
--              (estorno.ts ~182-188) marca como "pode ter saido" — criada_sob_autorizacao IS NOT TRUE AND
--              tentativas > 1 — e quantas delas o `v_sem_post` (= regra acima falsa) trata como "nada saiu".
--   g_dobro    por forma: das linhas em duvida, quantas tem valor MENOR que o restante do pedido (total -
--              valor_estornado - manual): o unico caso em que um segundo POST pode pagar em dobro (o MP barra
--              quando a soma passa do total).
--   h_manual   por forma: linhas em duvida de pedidos que ja tem reembolso manual registrado ("Ja estornei" =
--              marketplace_orders.estorno_manual_registrado_em; "por fora" = devolucoes.reembolso_manual em
--              qualquer status da devolucao).
-- NENHUM DADO PESSOAL: so contagens e somas; nenhum id de pedido ou de linha, nenhum e-mail, nome, endereco,
-- motivo, ultimo_erro, codigo do MP ou id do MP sai no log. O log do run e legivel por quem le o repositorio.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH ped AS (
  SELECT o.id AS pedido,
         CASE WHEN o.metodo_online IN ('credito', 'debito') THEN 'cartao' ELSE 'pix' END AS forma,
         (o.metodo_online IS NULL) AS metodo_nulo,
         o.status AS status_pedido,
         o.total,
         COALESCE(o.valor_estornado, 0) AS estornado,
         COALESCE((SELECT sum(d.valor_reembolso)
                     FROM public.devolucoes d
                    WHERE d.order_id = o.id
                      AND d.status = 'concluida'
                      AND d.reembolso_manual), 0) AS manual,
         (o.estorno_manual_registrado_em IS NOT NULL) AS ja_estornei,
         EXISTS (SELECT 1
                   FROM public.devolucoes d2
                  WHERE d2.order_id = o.id
                    AND d2.reembolso_manual) AS por_fora
    FROM public.marketplace_orders o
   WHERE EXISTS (SELECT 1 FROM public.order_refunds x WHERE x.order_id = o.id)
), lin AS (
  SELECT r.id AS linha,
         r.order_id AS pedido,
         p.forma,
         p.metodo_nulo,
         r.status,
         r.amount,
         r.solicitado_por,
         r.tentativas,
         r.created_at,
         r.post_autorizado_em,
         r.concluido_em,
         (r.criada_sob_autorizacao IS NOT TRUE AND r.tentativas > 1) AS legado_tentativas,
         p.total - p.estornado - p.manual AS restante,
         p.ja_estornei,
         p.por_fora,
         (r.mp_refund_id IS NOT NULL) AS tem_mp_refund_id,
         (dg.refund_id IS NOT NULL) AS tem_diagnostico,
         (dg.post_incerto_em IS NOT NULL) AS tem_carimbo,
         COALESCE(dg.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund'), false) AS codigo_na_lista,
         CASE
           WHEN r.mp_refund_id IS NOT NULL THEN true
           WHEN r.status = 'recusado' AND r.post_autorizado_em IS NULL THEN false
           WHEN r.status = 'falhou'
                AND dg.refund_id IS NOT NULL
                AND dg.post_incerto_em IS NULL
                AND dg.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund') THEN false
           ELSE true
         END AS pode_ter_saido
    FROM public.order_refunds r
    JOIN ped p ON p.pedido = r.order_id
    LEFT JOIN public.order_refund_diagnostico dg ON dg.refund_id = r.id
), morta AS (
  SELECT l.*,
         CASE
           WHEN l.tem_mp_refund_id THEN 'passo1 com mp_refund_id'
           WHEN l.status = 'recusado' AND l.post_autorizado_em IS NULL THEN 'passo3 recusado sem post autorizado'
           WHEN l.status = 'recusado' THEN 'passo5 recusado com post autorizado'
           WHEN NOT l.tem_diagnostico THEN 'passo5 falhou legado sem diagnostico'
           WHEN l.tem_carimbo THEN 'passo5 falhou com carimbo post_incerto_em'
           WHEN l.codigo_na_lista THEN 'passo4 falhou com codigo da lista nada saiu'
           ELSE 'passo5 falhou com codigo fora da lista'
         END AS categoria
    FROM lin l
   WHERE l.status IN ('falhou', 'recusado')
), saldo AS (
  SELECT p.pedido,
         p.forma,
         p.status_pedido,
         p.total
           - p.estornado
           - COALESCE((SELECT sum(l.amount)
                         FROM lin l
                        WHERE l.pedido = p.pedido
                          AND (l.status IN ('solicitado', 'em_processamento')
                               OR (l.status = 'concluido' AND l.concluido_em IS NULL))), 0)
           - p.manual AS saldo_hoje,
         COALESCE((SELECT sum(l.amount)
                     FROM lin l
                    WHERE l.pedido = p.pedido
                      AND l.status IN ('falhou', 'recusado')
                      AND l.pode_ter_saido), 0) AS em_duvida,
         EXISTS (SELECT 1
                   FROM lin l
                  WHERE l.pedido = p.pedido
                    AND l.status = 'falhou'
                    AND l.pode_ter_saido) AS tem_falhou_em_duvida
    FROM ped p
), viva AS (
  SELECT l.status,
         l.forma,
         l.amount,
         p.total - p.estornado
           - COALESCE((SELECT sum(o2.amount)
                         FROM lin o2
                        WHERE o2.pedido = l.pedido
                          AND o2.linha <> l.linha
                          AND o2.status IN ('solicitado', 'em_processamento')), 0) AS disp_hoje,
         p.manual,
         COALESCE((SELECT sum(o2.amount)
                     FROM lin o2
                    WHERE o2.pedido = l.pedido
                      AND o2.linha <> l.linha
                      AND o2.status = 'concluido'
                      AND o2.concluido_em IS NULL), 0) AS concluido_nao_somado,
         COALESCE((SELECT sum(o2.amount)
                     FROM lin o2
                    WHERE o2.pedido = l.pedido
                      AND o2.linha <> l.linha
                      AND o2.status IN ('falhou', 'recusado')
                      AND o2.pode_ter_saido), 0) AS em_duvida_outras
    FROM lin l
    JOIN ped p ON p.pedido = l.pedido
   WHERE l.status IN ('solicitado', 'em_processamento')
     AND l.solicitado_por <> 'sistema'
), formas AS (
  SELECT f FROM (VALUES ('cartao'), ('pix')) v(f)
), categorias AS (
  SELECT c FROM (VALUES ('passo1 com mp_refund_id'),
                        ('passo3 recusado sem post autorizado'),
                        ('passo4 falhou com codigo da lista nada saiu'),
                        ('passo5 falhou com carimbo post_incerto_em'),
                        ('passo5 falhou com codigo fora da lista'),
                        ('passo5 falhou legado sem diagnostico'),
                        ('passo5 recusado com post autorizado')) v(c)
), r AS (
  SELECT 0 AS ordem, 'controle' AS tipo, 'quem leu' AS objeto,
         'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
         || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
         || '|rls_vale_em_marketplace_orders=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                                    FROM pg_class c, pg_roles a
                                                   WHERE c.oid = 'public.marketplace_orders'::regclass AND a.rolname = current_user)
         || '|rls_vale_em_order_refunds=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                               FROM pg_class c, pg_roles a
                                              WHERE c.oid = 'public.order_refunds'::regclass AND a.rolname = current_user)
         || '|rls_vale_em_order_refund_diagnostico=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                                          FROM pg_class c, pg_roles a
                                                         WHERE c.oid = 'public.order_refund_diagnostico'::regclass AND a.rolname = current_user)
         || '|rls_vale_em_devolucoes=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                            FROM pg_class c, pg_roles a
                                           WHERE c.oid = 'public.devolucoes'::regclass AND a.rolname = current_user) AS detalhe
  UNION ALL
  SELECT 0, 'controle', 'order_refund_prova (passo 2 da regra)',
         'tabela_existe=' || (to_regclass('public.order_refund_prova') IS NOT NULL)::text
         || '|nesta_medicao=ignorada'
  UNION ALL
  SELECT 0, 'controle', 'regra x categoria (autoconferencia)',
         'linhas_mortas=' || count(*)::text
         || '|divergencias=' || count(*) FILTER (WHERE pode_ter_saido = (categoria LIKE 'passo3%' OR categoria LIKE 'passo4%'))::text
    FROM morta
  UNION ALL
  SELECT 1, 'a_linha', c.c || ' | ' || f.f,
         'linhas=' || count(m.categoria)::text
         || '|soma=' || COALESCE(sum(m.amount), 0)::text
         || '|pode_ter_saido=' || count(m.categoria) FILTER (WHERE m.pode_ter_saido)::text
    FROM categorias c
    CROSS JOIN formas f
    LEFT JOIN morta m ON m.categoria = c.c AND m.forma = f.f
   GROUP BY c.c, f.f
  UNION ALL
  SELECT 2, 'a_marca', s.s || ' | ' || f.f,
         'linhas=' || count(m.status)::text
         || '|soma=' || COALESCE(sum(m.amount), 0)::text
         || '|com_mp_refund_id=' || count(m.status) FILTER (WHERE m.tem_mp_refund_id)::text
         || '|sem_diagnostico=' || count(m.status) FILTER (WHERE NOT m.tem_diagnostico)::text
         || '|com_carimbo=' || count(m.status) FILTER (WHERE m.tem_carimbo)::text
         || '|codigo_na_lista=' || count(m.status) FILTER (WHERE m.tem_diagnostico AND m.codigo_na_lista)::text
         || '|codigo_fora_da_lista=' || count(m.status) FILTER (WHERE m.tem_diagnostico AND NOT m.codigo_na_lista)::text
         || '|metodo_nulo=' || count(m.status) FILTER (WHERE m.metodo_nulo)::text
         || '|pode_ter_saido=' || count(m.status) FILTER (WHERE m.pode_ter_saido)::text
         || '|soma_pode_ter_saido=' || COALESCE(sum(m.amount) FILTER (WHERE m.pode_ter_saido), 0)::text
    FROM (VALUES ('falhou'), ('recusado')) s(s)
    CROSS JOIN formas f
    LEFT JOIN morta m ON m.status = s.s AND m.forma = f.f
   GROUP BY s.s, f.f
  UNION ALL
  SELECT 3, 'b_saldo', f.f,
         'pedidos_com_linha=' || count(s.pedido)::text
         || '|saldo_reduzido=' || count(s.pedido) FILTER (WHERE s.em_duvida > 0)::text
         || '|soma_em_duvida=' || COALESCE(sum(s.em_duvida), 0)::text
         || '|saldo_positivo_passa_a_zero_ou_menos=' || count(s.pedido) FILTER (WHERE s.em_duvida > 0 AND s.saldo_hoje > 0 AND s.saldo_hoje - s.em_duvida <= 0)::text
         || '|ja_zero_ou_menos_hoje_e_com_duvida=' || count(s.pedido) FILTER (WHERE s.em_duvida > 0 AND s.saldo_hoje <= 0)::text
         || '|fica_negativo=' || count(s.pedido) FILTER (WHERE s.em_duvida > 0 AND s.saldo_hoje - s.em_duvida < 0)::text
         || '|soma_saldo_hoje_dos_reduzidos=' || COALESCE(sum(s.saldo_hoje) FILTER (WHERE s.em_duvida > 0), 0)::text
    FROM formas f
    LEFT JOIN saldo s ON s.forma = f.f
   GROUP BY f.f
  UNION ALL
  SELECT 4, 'c_cancel', f.f,
         'cancelados_com_falhou_em_duvida=' || count(s.pedido) FILTER (WHERE s.status_pedido = 'cancelled' AND s.tem_falhou_em_duvida)::text
         || '|soma_em_duvida=' || COALESCE(sum(s.em_duvida) FILTER (WHERE s.status_pedido = 'cancelled' AND s.tem_falhou_em_duvida), 0)::text
         || '|desses_saldo_positivo_passa_a_zero_ou_menos=' || count(s.pedido) FILTER (WHERE s.status_pedido = 'cancelled' AND s.tem_falhou_em_duvida AND s.saldo_hoje > 0 AND s.saldo_hoje - s.em_duvida <= 0)::text
    FROM formas f
    LEFT JOIN saldo s ON s.forma = f.f
   GROUP BY f.f
  UNION ALL
  SELECT 5, 'd_travada', f.f,
         'travadas=' || count(l.linha)::text
         || '|ha_3_dias_ou_mais=' || count(l.linha) FILTER (WHERE now() - COALESCE(l.post_autorizado_em, l.created_at) >= interval '3 days')::text
         || '|ha_7_dias_ou_mais=' || count(l.linha) FILTER (WHERE now() - COALESCE(l.post_autorizado_em, l.created_at) >= interval '7 days')::text
         || '|candidatas_a_prova_3_dias=' || count(l.linha) FILTER (WHERE l.solicitado_por <> 'sistema' AND NOT l.tem_mp_refund_id
                                                                     AND now() - COALESCE(l.post_autorizado_em, l.created_at) >= interval '3 days')::text
         || '|soma=' || COALESCE(sum(l.amount), 0)::text
    FROM formas f
    LEFT JOIN lin l ON l.forma = f.f AND l.status = 'em_processamento' AND l.tentativas >= 5
   GROUP BY f.f
  UNION ALL
  SELECT 6, 'e_viva', s.s || ' | ' || f.f,
         'linhas=' || count(v.status)::text
         || '|ja_nao_cabe_hoje=' || count(v.status) FILTER (WHERE v.amount > v.disp_hoje)::text
         || '|passa_a_recusar_so_pelo_manual=' || count(v.status) FILTER (WHERE v.amount <= v.disp_hoje AND v.amount > v.disp_hoje - v.manual)::text
         || '|passa_a_recusar_pela_conta_nova=' || count(v.status) FILTER (WHERE v.amount <= v.disp_hoje
                                                                            AND v.amount > v.disp_hoje - v.manual - v.concluido_nao_somado - v.em_duvida_outras)::text
         || '|soma_que_passa_a_recusar_pela_conta_nova=' || COALESCE(sum(v.amount) FILTER (WHERE v.amount <= v.disp_hoje
                                                                            AND v.amount > v.disp_hoje - v.manual - v.concluido_nao_somado - v.em_duvida_outras), 0)::text
    FROM (VALUES ('em_processamento'), ('solicitado')) s(s)
    CROSS JOIN formas f
    LEFT JOIN viva v ON v.status = s.s AND v.forma = f.f
   GROUP BY s.s, f.f
  UNION ALL
  SELECT 7, 'f_legado', f.f,
         'linhas_mortas_legado_tentativas_maior_que_1=' || count(m.status) FILTER (WHERE m.legado_tentativas)::text
         || '|desses_v_sem_post_diz_nada_saiu=' || count(m.status) FILTER (WHERE m.legado_tentativas AND NOT m.pode_ter_saido)::text
         || '|soma=' || COALESCE(sum(m.amount) FILTER (WHERE m.legado_tentativas), 0)::text
    FROM formas f
    LEFT JOIN morta m ON m.forma = f.f
   GROUP BY f.f
  UNION ALL
  SELECT 8, 'g_dobro', f.f,
         'linhas_em_duvida=' || count(m.status) FILTER (WHERE m.pode_ter_saido)::text
         || '|valor_menor_que_o_restante=' || count(m.status) FILTER (WHERE m.pode_ter_saido AND m.amount < m.restante)::text
         || '|soma_valor_menor_que_o_restante=' || COALESCE(sum(m.amount) FILTER (WHERE m.pode_ter_saido AND m.amount < m.restante), 0)::text
         || '|valor_igual_ou_maior_que_o_restante=' || count(m.status) FILTER (WHERE m.pode_ter_saido AND m.amount >= m.restante)::text
    FROM formas f
    LEFT JOIN morta m ON m.forma = f.f
   GROUP BY f.f
  UNION ALL
  SELECT 9, 'h_manual', f.f,
         'linhas_em_duvida_em_pedido_com_manual=' || count(m.status) FILTER (WHERE m.pode_ter_saido AND (m.ja_estornei OR m.por_fora))::text
         || '|via_ja_estornei=' || count(m.status) FILTER (WHERE m.pode_ter_saido AND m.ja_estornei)::text
         || '|via_por_fora_da_devolucao=' || count(m.status) FILTER (WHERE m.pode_ter_saido AND m.por_fora)::text
         || '|soma=' || COALESCE(sum(m.amount) FILTER (WHERE m.pode_ter_saido AND (m.ja_estornei OR m.por_fora)), 0)::text
    FROM formas f
    LEFT JOIN morta m ON m.forma = f.f
   GROUP BY f.f
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;
