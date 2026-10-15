-- 45m — MEDICAO, so leitura, DEPOIS de aplicar a migration 20261242000000 (o lucro usa o custo do dia da venda): o
-- gatilho `tr_marketplace_order_items_guarda_o_custo_do_dia` esta gravando o custo do dia dos itens que nascem?
-- Molde da 35m/41m: UM SELECT de ROL ABERTO, sem coluna `ok`; nunca e prova do portao da release (o portao e a 45a).
-- Quem decide e a pessoa que le a tabela. Rodar nas duas lojas assinantes (IKCOUS e Savy), no dia seguinte ao apply e
-- de tempos em tempos: e o unico modo de saber se o gatilho esta falhando EM SILENCIO (ele nunca derruba a compra: um
-- erro vira aviso no log do banco e o item fica sem registro).
--
-- Saida: tipo | objeto | detalhe (detalhe = `chave=valor`, separado por `|`). Tipos, na ordem:
--   controle   quem leu (superusuario?, BYPASSRLS?) e se a RLS VALE para quem leu em `marketplace_order_items` e em
--              `marketplace_order_item_custo` (a guarda de visibilidade da 8j): com a RLS valendo, todo 0 abaixo e'
--              INCONCLUSIVO (a linha diz isso em vez de dar o numero), porque a RLS esconde as linhas de quem leu.
--   contagem   itens nascidos DEPOIS do apply (created_at >= o primeiro registro gravado): quantos, quantos tem a
--              linha lateral, e quantos NAO tem a linha lateral apesar de o produto TER custo hoje e nao ter sido
--              apagado (`sem_linha_e_produto_com_custo`). A ultima e' a que precisa ser ~0:
--                * 0 = o gatilho gravou todos que tinha de gravar;
--                * >0 = ou o gatilho falhou (procure `ficou sem o custo do dia (SQLSTATE` no log do banco), ou o
--                  produto estava SEM custo no dia da venda e ganhou custo depois (o gatilho nao grava custo
--                  ausente, de proposito). Conferir o log do banco separa as duas coisas.
--   registros  quantas linhas tem a tabela lateral, o instante do primeiro e do ultimo registro (so datas).
-- SEM PRIVILEGIO: a tabela lateral e' so do servidor (REVOKE ALL de todo papel de API), entao um papel somente de
-- leitura que nao tem SELECT nela faz a consulta INTEIRA falhar com 42501 ("permission denied for table
-- marketplace_order_item_custo"): falha alta, nunca um zero que engana. Rode com o papel que aplica as migrations.
-- Sem nenhum registro ainda (loja sem venda depois do apply) a janela nao existe e a contagem diz `sem_registro`.
-- NENHUM DADO PESSOAL: so contagens e datas; nenhum id, nenhum nome de produto, nenhum cliente, nenhum valor de
-- custo. O log do run e legivel por quem le o repositorio: o que sai daqui e so agregado.
-- tests/ci_conferir_banco_test.ts prende essas regras no texto desta consulta; tests/banco/custo-do-dia-portao-viva.cjs a roda
-- num Postgres real.
WITH papel AS (
  SELECT (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS super,
         (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) AS bypass
), rls AS (
  SELECT (SELECT row_security_active(to_regclass('public.marketplace_order_items'))) AS itens,
         (SELECT row_security_active(to_regclass('public.marketplace_order_item_custo'))) AS custo
), janela AS (
  SELECT min(k.registrado_em) AS primeiro, max(k.registrado_em) AS ultimo, count(*) AS linhas
    FROM public.marketplace_order_item_custo k
), depois AS (
  SELECT oi.id, oi.product_id,
         EXISTS (SELECT 1 FROM public.marketplace_order_item_custo k WHERE k.item_id = oi.id) AS tem_linha
    FROM public.marketplace_order_items oi, janela j
   WHERE j.primeiro IS NOT NULL
     AND oi.created_at >= j.primeiro - interval '1 minute'
)
SELECT 'controle' AS tipo, 'quem leu' AS objeto,
       'superusuario=' || COALESCE((SELECT super FROM papel)::text, '?')
       || '|bypassrls=' || COALESCE((SELECT bypass FROM papel)::text, '?')
       || '|rls_vale_em_itens=' || COALESCE((SELECT itens FROM rls)::text, '?')
       || '|rls_vale_no_custo_do_dia=' || COALESCE((SELECT custo FROM rls)::text, '?') AS detalhe
UNION ALL
SELECT 'registros', 'linhas da tabela lateral',
       CASE WHEN (SELECT custo FROM rls) THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            ELSE 'total=' || (SELECT linhas FROM janela)::text
                 || '|primeiro=' || COALESCE((SELECT primeiro::date FROM janela)::text, 'sem_registro')
                 || '|ultimo=' || COALESCE((SELECT ultimo::date FROM janela)::text, 'sem_registro') END
UNION ALL
SELECT 'contagem', 'itens nascidos depois do primeiro registro',
       CASE WHEN (SELECT itens FROM rls) OR (SELECT custo FROM rls)
              THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            WHEN (SELECT primeiro FROM janela) IS NULL THEN 'sem_registro'
            ELSE 'total=' || (SELECT count(*) FROM depois)::text END
UNION ALL
SELECT 'contagem', 'desses, com a linha lateral',
       CASE WHEN (SELECT itens FROM rls) OR (SELECT custo FROM rls)
              THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            WHEN (SELECT primeiro FROM janela) IS NULL THEN 'sem_registro'
            ELSE 'total=' || (SELECT count(*) FILTER (WHERE tem_linha) FROM depois)::text END
UNION ALL
SELECT 'contagem', 'desses, SEM a linha lateral apesar de o produto ter custo hoje (o que precisa ser ~0)',
       CASE WHEN (SELECT itens FROM rls) OR (SELECT custo FROM rls)
              THEN 'INCONCLUSIVO (a RLS vale para quem leu: a contagem pode estar escondida)'
            WHEN (SELECT primeiro FROM janela) IS NULL THEN 'sem_registro'
            ELSE 'total=' || (SELECT count(*)
                                FROM depois d
                                JOIN public.produtos p ON p.id = d.product_id
                               WHERE NOT d.tem_linha AND p.custo IS NOT NULL AND p.deleted_at IS NULL)::text END;
