-- ROLLBACK MANUAL de 20261012000000_a_vitrine_sabe_que_o_produto_mudou.sql
-- SEM BEGIN/COMMIT: quem abre a transacao e' quem aplica.
--
-- ALCANCE DECLARADO, para a prova de rollback saber o que conferir:
--   Objetos criados pela migration: DUAS funcoes NOVAS
--   (public.handle_produto_atualizado, public.handle_variant_atualiza_produto)
--   e DOIS gatilhos NOVOS (set_ultima_atualizacao em produtos,
--   sync_produto_ultima_atualizacao em product_variants). Nenhuma funcao
--   PRE-EXISTENTE foi substituida — em particular, `handle_updated_at` NAO
--   foi tocada. Por isso este rollback e' um DROP simples dos quatro objetos
--   novos, e nao precisa reproduzir corpo vivo nenhum de funcao antiga.
--
-- ORDEM: gatilho antes da funcao que ele chama (senao o DROP FUNCTION falha
-- por dependencia — um gatilho ainda em pe' que aponta pra uma funcao
-- apagada). As duas duplas sao independentes uma da outra.
--
-- ⚠️ O QUE VOLTA A ACONTECER se este rollback for aplicado: `ultima_atualizacao`
-- volta a so' ganhar valor no INSERT. Depois da primeira sincronia,
-- `serverTime == localTime` para sempre e o catchUp de
-- `realtimeSyncEngine.ts` nunca mais rebusca nada — preco, estoque e foto
-- ficam desatualizados na vitrine, e variante apagada continua sendo
-- oferecida. Reverter aqui e' escolher de novo esse defeito — so' faca isso
-- se a migration tiver causado algo pior.
DROP TRIGGER IF EXISTS set_ultima_atualizacao ON public.produtos;
DROP FUNCTION IF EXISTS public.handle_produto_atualizado();

DROP TRIGGER IF EXISTS sync_produto_ultima_atualizacao ON public.product_variants;
DROP FUNCTION IF EXISTS public.handle_variant_atualiza_produto();
