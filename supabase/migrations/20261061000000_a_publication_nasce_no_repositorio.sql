-- A PUBLICATION NASCE NO REPOSITÓRIO (laudo novos ângulos 01/09, achado B1).
--
-- O DEFEITO: o sino do cliente e o realtime do painel dependem de
-- `notificacoes` e `marketplace_orders` estarem na publication
-- `supabase_realtime` — e NENHUMA migration as adiciona. As únicas adições
-- conhecidas estão em QUATRO migrations arquivadas de 08/07
-- (`_arquivadas/20260708020000` loop genérico, `20260708030000` reviews,
-- `20260708040000` cart_items, `20260708050000` favorites), todas ANTERIORES
-- à existência dessas tabelas. No molde funciona porque foi habilitado À MÃO
-- no dashboard, fora das migrations — o próprio diagnóstico interno registra
-- (docs/onboarding/06-ESTADO-ATUAL.md, item 44: "foi habilitado fora das
-- migrations").
--
-- A CONSEQUÊNCIA é de molde: toda loja clonada que nascer rodando as
-- migrations nasce com o sino do cliente morto e o realtime do painel
-- morto — a promessa da tela de sucesso ("A cada atualização — preparo,
-- envio, entrega — você recebe um aviso aqui no app", OrderSuccessView.tsx)
-- e a trigger `tr_pedido_avisa_o_cliente` (20261026000000) dependem
-- exatamente dessas tabelas na publication.
--
-- O QUE ESTA MIGRATION FAZ: adiciona as três tabelas à publication e grava
-- REPLICA IDENTITY FULL em `marketplace_order_items` (as outras duas já
-- nascem FULL no baseline — :3983 e :4003). O FULL é o que permite ao
-- realtime aplicar os filtros de RLS em eventos de UPDATE/DELETE sem chave
-- primária exposta — é o estado que o banco do molde tem HOJE na mão
-- (item 44: "relreplident = 'f'").
--
-- IDEMPOTENTE DE PROPÓSITO: no banco do molde as três já são membros
-- (habilitação manual), então os três IF pulam — aqui é no-op. Numa loja
-- clonada recém-nascida, os três IF executam. `ALTER TABLE ... REPLICA
-- IDENTITY FULL` é intrinsecamente idempotente (regravar FULL em quem já é
-- FULL não faz nada).
--
-- POR QUE AS TRÊS TABELAS (e não só as duas com ouvinte hoje): paridade com
-- o estado à mão do molde, que é o estado PROVADO funcionando —
-- `marketplace_order_items` não tem canal ouvinte hoje, mas está na
-- publication do banco que está no ar; remover paridade seria afronta.
--
-- SEM BEGIN/COMMIT (regra da casa: o db-apply.cjs abre a transação).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (contra o banco vivo):
--   -- 1. As três tabelas são membros:
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime'
--      AND tablename IN ('notificacoes', 'marketplace_orders',
--                        'marketplace_order_items')
--    ORDER BY tablename;
--   -> espera 3 linhas
--
--   -- 2. Replica identity:
--   SELECT relname, relreplident FROM pg_class
--    WHERE oid IN ('public.notificacoes'::regclass,
--                  'public.marketplace_orders'::regclass,
--                  'public.marketplace_order_items'::regclass);
--   -> espera relreplident = 'f' nas três
--
--   -- 3. Idempotência: rodar ESTE ARQUIVO de novo no db-apply não pode
--   --    errorar (os três IF pulam).
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261061000000_a_publication_nasce_no_repositorio.sql
--
-- ⚠️ Revisão do par OBRIGATÓRIA antes de aplicar.

DO $publication$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'notificacoes'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'marketplace_orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_orders;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'marketplace_order_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_order_items;
    END IF;
END
$publication$;

-- As outras duas já nascem FULL no baseline (:3983 marketplace_orders,
-- :4003 notificacoes); regravar é no-op e explicita a intenção.
ALTER TABLE public.marketplace_orders REPLICA IDENTITY FULL;
ALTER TABLE public.notificacoes REPLICA IDENTITY FULL;
ALTER TABLE public.marketplace_order_items REPLICA IDENTITY FULL;
