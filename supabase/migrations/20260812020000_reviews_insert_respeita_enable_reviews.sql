-- =============================================================================
-- reviews_insert_policy passa a checar enable_reviews (ADMIN-090, issue #101)
-- =============================================================================
--
-- PROBLEMA
--   O admin tem um interruptor "Avaliações dos Clientes" que muda o pill para
--   Inativo e mostra toast de sucesso, mas nenhuma tela de cliente lia o flag
--   `enable_reviews` de store_config — nem a vitrine, nem o JSON-LD, nem a
--   tela de pedido entregue. E no banco, reviews_insert_policy nunca conferia
--   o flag: quem chamasse a API direto continuava inserindo avaliação com o
--   interruptor desligado. Era um controle cosmético.
--
-- DECISÃO (sessão de 12/08/2026 — a issue #101 permitia deixar só na UI)
--   O gate vai na UI **e** aqui, na policy de INSERT. Este repositório é o
--   molde que se clona a cada loja vendida: um lojista que desliga avaliações
--   espera que NINGUÉM consiga inserir uma, inclusive quem chama a API sem
--   passar pela tela. Gate só de UI não entrega essa garantia — e o resto do
--   gate (vitrine, JSON-LD, pedido entregue) foi feito no front, nesta mesma
--   tarefa, em `src/views/customer/ProductView.tsx`,
--   `src/views/customer/OrderDetailsView.tsx` e `src/contexts/StoreContext.tsx`.
--
-- POR QUE UMA SUBQUERY DIRETA E NÃO UMA FUNÇÃO SECURITY DEFINER
--   store_config_select_policy é `USING (true)` — leitura aberta para
--   qualquer papel (`CREATE POLICY store_config_select_policy ON
--   public.store_config FOR SELECT USING (true)`, ver
--   20260806000000_baseline_do_schema_vivo.sql:5896). Ler enable_reviews de
--   dentro da policy de INSERT de reviews não precisa de SECURITY DEFINER
--   nem de função auxiliar: a subquery já enxerga a linha porque a RLS da
--   própria store_config nunca a esconderia. Não há recursão — store_config
--   não referencia reviews em nenhuma das suas policies.
--
-- POR QUE `id = 1` E NÃO `LIMIT 1`
--   `upsert_store_config` sempre grava/atualiza a linha `id = 1` (é o mesmo
--   padrão que get_admin_config_view e outras RPCs administrativas já usam:
--   `SELECT * INTO v_store_config FROM public.store_config WHERE id = 1`).
--   `id = 1` documenta a suposição em vez de escondê-la atrás de um LIMIT.
--
-- POR QUE `COALESCE(..., true)`
--   Se por algum motivo a linha id=1 não existir, o app já assume
--   enable_reviews = true por padrão (`defaultStoreConfig.enableReviews` em
--   src/contexts/StoreContext.tsx:26). O fallback aqui espelha esse padrão:
--   ausência de configuração nunca vira um "desligado" silencioso.
--
-- CRITÉRIO DE ACEITE COBERTO POR ESTA POLICY
--   Com o flag desligado, ninguém insere review (nem pela tela, nem pela API
--   direta). Com o flag ligado, o INSERT continua exigindo só que o usuário
--   autenticado seja o dono da linha (auth.uid() = user_id), como já era.
--
-- POR QUE `DROP POLICY` + `CREATE POLICY` E NÃO `ALTER POLICY`
--   `ALTER POLICY` não troca a cláusula `WITH CHECK` de uma policy existente
--   em todas as versões do Postgres sem reescrevê-la por inteiro de qualquer
--   forma; `DROP` + `CREATE` é o padrão mais claro e é exatamente o que
--   `pg_dump`/o baseline já produzem para este tipo de policy.
-- =============================================================================

DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;

CREATE POLICY reviews_insert_policy ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND COALESCE(
      (SELECT sc.enable_reviews FROM public.store_config sc WHERE sc.id = 1),
      true
    )
  );
