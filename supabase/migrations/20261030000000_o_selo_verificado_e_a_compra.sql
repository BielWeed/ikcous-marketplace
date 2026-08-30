-- O selo "Verificado" passa a significar COMPRA CONFIRMADA (laudo "o que
-- falta" 29/08, item 7, degrau 2 — promete o que não cumpre).
--
-- O defeito: `reviews.verified` era interruptor MANUAL do lojista (botão
-- "Verificar Compra/Remover Verificação" no painel) — o selo significava
-- "alguém clicou", não "compra confirmada". E pior: o insert de avaliação é
-- DIRETO do front (RLS só exige ser o autor), então QUALQUER usuário logado
-- avalia qualquer produto sem ter comprado — o próprio addReview carregava o
-- comentário "Logic to check if user bought product could go here later".
--
-- O que "compra confirmada" significa aqui: o MESMO critério de dinheiro
-- reconhecido da casa (as 3 portas: 'pago', 'pago_apos_expirar',
-- 'recebido_na_entrega') num pedido do autor que contém o produto.
--
-- COMO (duas triggers, para o selo nunca ficar desatualizado):
--   1. reviews (INSERT): quem já tinha comprado quando avaliou nasce
--      verificado;
--   2. marketplace_orders (INSERT/UPDATE OF payment_status): quem avaliou
--      antes ganha o selo QUANDO o dinheiro entra (avaliou na expectativa,
--      comprou depois — o selo acerta sozinho).
--   + retroativo: as avaliações existentes com compra reconhecida são
--     marcadas por esta migration.
--
-- O botão manual SAI do painel (não há mais o que clicar); o badge da loja
-- continua lendo a MESMA coluna `verified` — nada muda para quem exibe.
--
-- SEM BEGIN/COMMIT (regra da casa). NÃO aplicar sem prova e sem o Gabriel
-- autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. As duas triggers existem:
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid IN ('public.reviews'::regclass,
--                      'public.marketplace_orders'::regclass)
--      AND NOT tgisinternal
--      AND tgname LIKE 'tr_%verific%';
--   -- esperado: 2 linhas ('tr_avaliacao_nasce_verificada',
--   --                    'tr_compra_verifica_avaliacoes') | O
--
--   -- 2. As 3 portas do dinheiro reconhecido estão nas DUAS funções:
--   SELECT proname,
--          (pg_get_functiondef(oid) LIKE
--           '%''pago'', ''pago_apos_expirar'', ''recebido_na_entrega''%')
--          AS tem_3_portas
--   FROM pg_proc
--   WHERE proname IN ('marca_avaliacao_nasce_verificada',
--                     'marca_avaliacoes_do_pedido_verificadas')
--     AND pronamespace = 'public'::regnamespace;
--   -- esperado: 2 linhas com tem_3_portas = true
--
--   -- 3. Prova funcional (pedido pago de teste; APAGAR depois):
--   --    INSERT de avaliação do MESMO usuário/produto de um pedido pago
--   --    existente, direto na tabela: esperado verified = true já no RETURNING.
--   --    E o inverso: avaliação de usuário SEM compra nasce verified = false.
--
--   -- 4. A insert policy recusa selo forjado direto na API:
--   SELECT pg_get_expr(qual, polrelid) AS com_check_de_verified
--   FROM pg_policy WHERE polname = 'reviews_insert_policy';
--   -- esperado: expressão contendo 'verified = false'

-- ============================================================
-- Função da trigger de reviews (quem já comprou, nasce verificado)
-- ============================================================

CREATE OR REPLACE FUNCTION public.marca_avaliacao_nasce_verificada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.marketplace_orders o
        JOIN public.marketplace_order_items oi ON oi.order_id = o.id
        WHERE o.user_id = NEW.user_id
          AND oi.product_id = NEW.product_id
          AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
    ) THEN
        UPDATE public.reviews SET verified = true WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_avaliacao_nasce_verificada
AFTER INSERT ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.marca_avaliacao_nasce_verificada();

-- ============================================================
-- Função da trigger de pedidos (quem comprou depois, ganha o selo)
-- ============================================================

CREATE OR REPLACE FUNCTION public.marca_avaliacoes_do_pedido_verificadas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.user_id IS NOT NULL
       AND NEW.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
        UPDATE public.reviews r
           SET verified = true
         WHERE r.user_id = NEW.user_id
           AND r.verified = false
           AND EXISTS (
               SELECT 1 FROM public.marketplace_order_items oi
               WHERE oi.order_id = NEW.id
                 AND oi.product_id = r.product_id
           );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_compra_verifica_avaliacoes
AFTER INSERT OR UPDATE OF payment_status ON public.marketplace_orders
FOR EACH ROW EXECUTE FUNCTION public.marca_avaliacoes_do_pedido_verificadas();

-- ============================================================
-- Retroativo: avaliações existentes com compra reconhecida
-- ============================================================

UPDATE public.reviews r
   SET verified = true
 WHERE r.verified = false
   AND EXISTS (
       SELECT 1
       FROM public.marketplace_orders o
       JOIN public.marketplace_order_items oi ON oi.order_id = o.id
       WHERE o.user_id = r.user_id
         AND oi.product_id = r.product_id
         AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
   );

-- ============================================================
-- Fecha o furo que as triggers abrem não fechariam: a insert policy
-- (20260812020000) não restringe `verified`, então qualquer authenticated
-- podia inserir avaliação com verified = true DIRETO NA API — o selo
-- continuaria fabricável por quem não comprou, exatamente o que o item 7
-- descreve. Com `verified = false` na WITH CHECK, o INSERT forjado é
-- recusado; quem comprou de verdade é promovido pela trigger 1 DEPOIS do
-- insert (AFTER INSERT → UPDATE), fora do alcance da policy.
-- ============================================================

DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;

CREATE POLICY reviews_insert_policy ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND verified = false
    AND COALESCE(
      (SELECT sc.enable_reviews FROM public.store_config sc WHERE sc.id = 1),
      true
    )
  );
