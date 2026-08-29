-- Policy de SELECT em banners passa a respeitar a janela de exibicao.
--
-- Achado acendido pela revisao 20260825-2115 (conserto 6 da fatia GLM):
-- a banners_select_policy so olha "active" - a janela de exibicao
-- (start_date/end_date, que a 20261000000000 cria) e filtrada SO no
-- cliente (useBanners.ts:267-274). Resultado: banner active=true com
-- start_date no futuro ficaria legivel por ANON - title, badge_text e
-- URL da imagem publicos ANTES do lancamento. Mesmo padrao do
-- get_product_recommendations: trava no cliente, banco entrega tudo.
--
-- DEPENDENCIA EXPLICITA (e ordem que corrige a nota anterior): esta
-- policy REFERENCIA start_date/end_date - colunas que so existem DEPOIS
-- da 20261000000000. Criar a policy ANTES das colunas FALHA (Postgres
-- valida a referencia no CREATE POLICY). A ordem certa e:
--   1. aplicar 20261000000000 (colunas nascem; a exposicao abre NESSE
--      instante, ja que a policy antiga so olha "active");
--   2. aplicar ESTA file em SEGUIDA, na MESMA sessao de clique -
--      janela de exposicao de segundos, nao dias.
-- Regra que governa (revisao 20260825-2230): estado de parada menos
-- perigoso - entre colunas-sem-policy e policy-sem-colunas, a primeira
-- existe aqui por necessidade tecnica; o pedido de clique ao Gabriel
-- EMPACOTA as duas na mesma conversa, columns->policy em sequencia.
--
-- A policy preserva o painel: admin autenticado continua vendo os
-- agendados (o segundo ramo do OR nao toca na janela).
--
-- SEM BEGIN/COMMIT. Faixa 20261000* (cacador-b-dorso, _REGRAS.md).
-- NAO aplicar sem prova de ROLLBACK e sem o Gabriel autorizar NESTA sessao.
--
-- FICHA DE VERIFICACAO pos-aplicacao (por consulta, com tres papeis):
--   anon    -> SELECT count(*) FROM banners WHERE active AND
--              start_date > now(): espera 0 LINHAS devolvidas a anon
--              (criar banner de prova com start_date futuro, conferir,
--              apagar)
--   anon    -> banner com janela VALIDA: continua visivel (a policy nao
--              fecha a loja)
--   admin   -> o banner futuro CONTINUA na lista do painel (o ramo admin
--              nao cega o lojista - efeito que a ficha protege)
--   controle negativo: antes desta file (e depois das colunas), o mesmo
--   SELECT anon DEVOLVE o banner futuro - e o furo que ela fecha.

DROP POLICY IF EXISTS banners_select_policy ON public.banners;

CREATE POLICY banners_select_policy ON public.banners FOR SELECT USING (
    (
        "active" = true
        AND ("start_date" IS NULL OR "start_date" <= now())
        AND ("end_date" IS NULL OR "end_date" >= now())
    )
    OR (
        ( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"
        AND ( SELECT "public"."is_admin"() AS "is_admin")
    )
);
