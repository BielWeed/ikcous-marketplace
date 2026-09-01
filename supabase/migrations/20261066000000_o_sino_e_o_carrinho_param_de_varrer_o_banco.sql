-- O SINO, O COUNT DE MODERAÇÃO E O CARRINHO PARAM DE VARRER O BANCO
-- (laudo varredura 01/09, achados P-1 + P-7 + P-10).
--
-- O DEFEITO: três tabelas do dia a dia vivem de consultas por dono/data e
-- não têm índice NENHUM além da PK — toda consulta é seq-scan O(n) + sort:
--
--   notificacoes  (baseline :3990; único índice = PK) — o sino do cliente
--     faz DUAS consultas a cada boot e a cada evento do canal realtime
--     (NotificationContext.tsx:105-118): `WHERE usuario_id = X ORDER BY
--     created_at DESC LIMIT 50` e a de campanha `WHERE usuario_id IS NULL
--     ORDER BY created_at DESC LIMIT 20`. A tabela ganha ~4-5 linhas POR
--     PEDIDO para sempre (trigger 20261026000000).
--
--   reviews — o badge de moderação do painel (AdminLayout.tsx:209) conta
--     `WHERE merchant_reply IS NULL` a cada rodada (já coalescida): seq-scan
--     O(avaliações) para achar as dezenas pendentes. Os únicos índices são
--     product_id e user_id (baseline :4920/:4927).
--
--   cart_items (baseline :3851; sem índice) — o sync do carrinho lê
--     `WHERE user_id = X` a cada boot/tab (CartContext.tsx:212-214).
--
-- Defeito de MOLDE: nasce em toda loja clonada.
--
-- O QUE ESTA MIGRATION FAZ: 4 CREATE INDEX, SEM CONCURRENTLY (a migration
-- roda dentro da transação do db-apply; o CONCURRENTLY não pode — e o custo
-- de travar a tabela num banco de molde é pequeno perto do seq-scan
-- permanente):
--   1. idx_notificacoes_usuario_created — serve a consulta do sino do
--      usuário: filtra por usuario_id E já entrega a ordem created_at DESC
--      (o LIMIT 50 para de sortear a tabela inteira);
--   2. idx_notificacoes_globais_created (PARCIAL, WHERE usuario_id IS NULL)
--      — a consulta de campanha é exatamente este predicado; parcial porque
--      só as globais interessam e o índice fica do tamanho delas;
--   3. idx_reviews_resposta_pendente (PARCIAL, WHERE merchant_reply IS NULL)
--      — o count do badge e a listagem de `useAvisosDoLojista` passam a
--      custar O(pendentes), não O(avaliações);
--   4. idx_cart_items_user_id — o sync do carrinho pelo dono.
--
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação: scripts/db-prove-indices-sino-carrinho.cjs
-- (transação descartável com ROLLBACK: massa sintética grande, os 4 índices
-- criados INLINE, EXPLAIN mostrando o uso de CADA índice nas consultas do
-- app e pg_indexes listando os 4). Depois de aplicar no banco, conferir:
--
--   SELECT indexname FROM pg_indexes
--    WHERE (tablename = 'notificacoes' AND indexname LIKE 'idx_notificacoes%')
--       OR (tablename = 'reviews' AND indexname = 'idx_reviews_resposta_pendente')
--       OR (tablename = 'cart_items' AND indexname = 'idx_cart_items_user_id');
--   -> espera 4 linhas (idx_notificacoes_usuario_created,
--      idx_notificacoes_globais_created, idx_reviews_resposta_pendente,
--      idx_cart_items_user_id)
--
--   EXPLAIN SELECT * FROM notificacoes WHERE usuario_id = '<um uuid real>'
--    ORDER BY created_at DESC LIMIT 50;
--   -> espera "Index Scan using idx_notificacoes_usuario_created" (ou
--      Bitmap Index Scan com o mesmo nome)
--
--   EXPLAIN SELECT * FROM notificacoes WHERE usuario_id IS NULL
--    ORDER BY created_at DESC LIMIT 20;
--   -> espera "idx_notificacoes_globais_created" no plano
--
--   EXPLAIN SELECT count(*) FROM reviews WHERE merchant_reply IS NULL;
--   -> espera "idx_reviews_resposta_pendente" no plano
--
--   EXPLAIN SELECT * FROM cart_items WHERE user_id = '<um uuid real>';
--   -> espera "idx_cart_items_user_id" no plano
--
--   (⚠️ em tabela vazia/quase vazia o planejador prefere seq-scan por custo —
--   isso NÃO é defeito do índice; a prova usa massa grande de propósito.)
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261066000000_o_sino_e_o_carrinho_param_de_varrer_o_banco.sql
-- (os 4 DROP INDEX; nada aqui muda dados ou policies).

CREATE INDEX idx_notificacoes_usuario_created
    ON public.notificacoes (usuario_id, created_at DESC);

CREATE INDEX idx_notificacoes_globais_created
    ON public.notificacoes (created_at DESC)
    WHERE usuario_id IS NULL;

CREATE INDEX idx_reviews_resposta_pendente
    ON public.reviews (created_at DESC)
    WHERE merchant_reply IS NULL;

CREATE INDEX idx_cart_items_user_id
    ON public.cart_items (user_id);
