-- 33m — MEDICAO, so leitura, de QUANTOS clientes a grade do CRM contava no segmento errado: os que estao EXATAMENTE
-- na virada de recencia (30, 60 ou 120 dias desde a ultima compra) vistos de hoje. Com o periodo terminando hoje, a
-- grade antiga media cada cliente ate a meia-noite de amanha e os via 1 dia mais velhos que a lista; so quem esta na
-- virada muda de segmento (Novos -> Promissores aos 30, Promissores -> Quase dormindo aos 60, Quase dormindo ->
-- Hibernando aos 120). A virada de 240 dias muda a nota mas nao o segmento: aparece so para constar.
-- Molde da 18a/22m/27m/32m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release. Quem
-- decide e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), ANTES do apply, so para saber o
-- tamanho do que a correcao move; o apply nao muda nenhuma linha de cliente.
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em marketplace_orders: com a RLS
--              valendo, toda contagem abaixo sai baixa e o numero nao e o da loja.
--   contagem   compradores (clientes com venda paga, como a lista os conta) e quantos estao em cada virada.
-- NENHUM DADO PESSOAL: so contagens; nenhum nome, nenhum numero, nenhum id. O log do run e legivel por quem le o
-- repositorio: o que sai daqui e so agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta.
WITH r AS (
  SELECT c.dias_sem_comprar AS dias FROM public.crm__clientes_rfm(now()) c
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
       || '|bypassrls=' || (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text
       || '|rls_vale_em_marketplace_orders=' || (SELECT (c.relrowsecurity AND NOT COALESCE(ro.rolbypassrls, false) AND NOT COALESCE(ro.rolsuper, false))::text
                                                    FROM pg_class c, pg_roles ro
                                                   WHERE c.oid = 'public.marketplace_orders'::regclass AND ro.rolname = current_user) AS detalhe
UNION ALL
SELECT 'contagem', 'compradores (a lista os conta ate agora)', 'total=' || count(*)::text FROM r
UNION ALL
SELECT 'contagem', 'na virada de 30 dias (Novos na lista, Promissores na grade antiga)',
       'total=' || count(*) FILTER (WHERE dias = 30)::text FROM r
UNION ALL
SELECT 'contagem', 'na virada de 60 dias (Promissores na lista, Quase dormindo na grade antiga)',
       'total=' || count(*) FILTER (WHERE dias = 60)::text FROM r
UNION ALL
SELECT 'contagem', 'na virada de 120 dias (Quase dormindo na lista, Hibernando na grade antiga)',
       'total=' || count(*) FILTER (WHERE dias = 120)::text FROM r
UNION ALL
SELECT 'contagem', 'na virada de 240 dias (muda a nota, nao muda o segmento: a grade nao mostra)',
       'total=' || count(*) FILTER (WHERE dias = 240)::text FROM r;
