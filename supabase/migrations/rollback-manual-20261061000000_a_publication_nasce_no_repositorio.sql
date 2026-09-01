-- ROLLBACK MANUAL de 20261061000000_a_publication_nasce_no_repositorio.sql.
--
-- Tira as três tabelas da publication (o estado "nasce das migrations" volta
-- a ser o de antes: fora). REPLICA IDENTITY não volta ao default DE PROPÓSITO:
-- o default seria 'n' (nothing), mas o baseline (:3983/:4003) já gravava FULL
-- em marketplace_orders e notificacoes antes desta migration — voltar para
-- 'n' desfazeria o baseline, não a migration. `marketplace_order_items` também
-- fica: sem ouvinte, sem efeito, e o molde já o tinha FULL na mão.
--
-- ⚠️ Depois deste rollback, o estado "loja clonada nasce com o sino morto"
-- volta a existir.
--
-- SEM BEGIN/COMMIT (regra da casa).

ALTER PUBLICATION supabase_realtime DROP TABLE public.notificacoes;
ALTER PUBLICATION supabase_realtime DROP TABLE public.marketplace_orders;
ALTER PUBLICATION supabase_realtime DROP TABLE public.marketplace_order_items;
