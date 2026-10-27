-- 105a — MEDICAO, so leitura, dos pedidos de VISITANTE (sem conta) que NAO sao pagos online ("pagar na entrega"), ANTES
-- de ligar o freio aprovado pelo dono: (1) teto de 10 unidades por pedido e (2) limite K de pedidos de visitante
-- pendentes nos ultimos 72 h por loja. Os numeros daqui decidem o 10 e o K; nenhuma migration nasce sem eles.
-- Molde da 44m/45m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem decide e a
-- pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), uma loja por run, por
-- conferir-banco-da-loja.yml (papel `supabase_read_only_user`).
--
-- DEFINICAO (create_marketplace_order_v24, migration 20261384000000, e v23, 20261350000000): o pedido nasce em
-- public.marketplace_orders com user_id = auth.uid() (NULO para visitante), payment_method = p_payment_method,
-- status = 'pending' e created_at; os itens nascem em public.marketplace_order_items (order_id, quantity).
--   visitante-na-entrega = user_id IS NULL AND payment_method IS DISTINCT FROM 'online'
-- (forma nula tambem entra: o que importa e nao ser online).
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em `marketplace_orders` e em
--              `marketplace_order_items`: com a RLS valendo, todo numero abaixo sai baixo e NAO e o da loja.
--   a_status   pedidos de visitante-na-entrega por status (pending, cancelled, delivered, ...), mais a linha `todos`.
--   b_agora    pendentes AGORA.
--   c_janela   o MAIOR numero de pendentes dentro de qualquer janela de 72 h e de 24 h: para cada pedido pendente, conta
--              os pendentes criados em [created_at - janela, created_at] (a janela termina num pedido, que e onde o
--              maximo acontece) e devolve o maximo. Tambem: o maior numero de pedidos de visitante-na-entrega
--              CRIADOS (qualquer status) na mesma janela, que e o que um freio por criacao enxergaria.
--   d_unidades distribuicao das unidades por pedido (soma de quantity dos itens): quantos pedidos, maximo, percentil 95,
--              mediana e quantos passam de 10 unidades.
--   e_idade    idade em horas do pendente mais antigo e quantos pendentes tem mais de 72 h (a lojista nao confirma?).
--   f_forma    contagem por forma de pagamento.
-- NENHUM DADO PESSOAL: so contagens, maximos e percentis; nenhum id de pedido, nome, telefone, endereco ou e-mail sai
-- no log. O log do run e legivel por quem le o repositorio.
WITH v AS (
  SELECT o.id AS pedido, o.status, o.created_at, o.payment_method AS forma
    FROM public.marketplace_orders o
   WHERE o.user_id IS NULL
     AND o.payment_method IS DISTINCT FROM 'online'
), pend AS (
  SELECT v.pedido, v.created_at FROM v WHERE v.status = 'pending'
), janela AS (
  SELECT p.pedido,
         (SELECT count(*) FROM pend q WHERE q.created_at BETWEEN p.created_at - interval '72 hours' AND p.created_at) AS pend_72h,
         (SELECT count(*) FROM pend q WHERE q.created_at BETWEEN p.created_at - interval '24 hours' AND p.created_at) AS pend_24h
    FROM pend p
), criados AS (
  SELECT x.pedido,
         (SELECT count(*) FROM v y WHERE y.created_at BETWEEN x.created_at - interval '72 hours' AND x.created_at) AS cri_72h,
         (SELECT count(*) FROM v y WHERE y.created_at BETWEEN x.created_at - interval '24 hours' AND x.created_at) AS cri_24h
    FROM v x
), un AS (
  SELECT v.pedido, COALESCE(SUM(oi.quantity), 0) AS unidades
    FROM v
    LEFT JOIN public.marketplace_order_items oi ON oi.order_id = v.pedido
   GROUP BY v.pedido
), r AS (
  SELECT 0 AS ordem, 'controle' AS tipo, 'quem leu' AS objeto,
         'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
         || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
         || '|rls_vale_em_marketplace_orders=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                                    FROM pg_class c, pg_roles a
                                                   WHERE c.oid = 'public.marketplace_orders'::regclass AND a.rolname = current_user)
         || '|rls_vale_em_marketplace_order_items=' || (SELECT (c.relrowsecurity AND NOT COALESCE(a.rolbypassrls, false) AND NOT COALESCE(a.rolsuper, false))::text
                                                         FROM pg_class c, pg_roles a
                                                        WHERE c.oid = 'public.marketplace_order_items'::regclass AND a.rolname = current_user) AS detalhe
  UNION ALL
  SELECT 1, 'a_status', COALESCE(v.status, 'nulo'), 'pedidos=' || count(*)::text
    FROM v
   GROUP BY v.status
  UNION ALL
  SELECT 1, 'a_status', 'todos', 'pedidos=' || count(*)::text FROM v
  UNION ALL
  SELECT 2, 'b_agora', 'pendentes agora', 'pendentes=' || count(*)::text FROM pend
  UNION ALL
  SELECT 3, 'c_janela', 'maior de pendentes em 72 h',
         'maximo=' || COALESCE(max(j.pend_72h), 0)::text FROM janela j
  UNION ALL
  SELECT 3, 'c_janela', 'maior de pendentes em 24 h',
         'maximo=' || COALESCE(max(j.pend_24h), 0)::text FROM janela j
  UNION ALL
  SELECT 3, 'c_janela', 'maior de criados (qualquer status) em 72 h',
         'maximo=' || COALESCE(max(c.cri_72h), 0)::text FROM criados c
  UNION ALL
  SELECT 3, 'c_janela', 'maior de criados (qualquer status) em 24 h',
         'maximo=' || COALESCE(max(c.cri_24h), 0)::text FROM criados c
  UNION ALL
  SELECT 4, 'd_unidades', 'unidades por pedido',
         'pedidos=' || count(*)::text
         || '|maximo=' || COALESCE(max(u.unidades), 0)::text
         || '|p95=' || COALESCE(round((percentile_cont(0.95) WITHIN GROUP (ORDER BY u.unidades))::numeric, 1)::text, 'sem_pedido')
         || '|mediana=' || COALESCE(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY u.unidades))::numeric, 1)::text, 'sem_pedido')
         || '|acima_de_10=' || count(*) FILTER (WHERE u.unidades > 10)::text
    FROM un u
  UNION ALL
  SELECT 5, 'e_idade', 'pendentes',
         'pendentes=' || count(*)::text
         || '|mais_antigo_em_horas=' || COALESCE(round((extract(epoch FROM (now() - min(p.created_at))) / 3600)::numeric, 1)::text, 'sem_pendente')
         || '|com_mais_de_72h=' || count(*) FILTER (WHERE p.created_at < now() - interval '72 hours')::text
    FROM pend p
  UNION ALL
  SELECT 6, 'f_forma', COALESCE(v.forma, 'nulo'), 'pedidos=' || count(*)::text
    FROM v
   GROUP BY v.forma
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;
