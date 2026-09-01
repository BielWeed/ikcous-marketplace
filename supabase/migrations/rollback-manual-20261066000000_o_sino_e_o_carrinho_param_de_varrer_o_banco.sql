-- ROLLBACK MANUAL de 20261066000000_o_sino_e_o_carrinho_param_de_varrer_o_banco.sql
-- (laudo varredura 01/09, achados P-1 + P-7 + P-10).
--
-- Derruba os QUATRO índices criados pela migration. Nada mais: a migration
-- não muda dado, policy nem função — o rollback devolve o estado exato de
-- antes (e com ele, os seq-scans do sino, do badge de moderação e do sync
-- do carrinho).
--
-- SEM BEGIN/COMMIT (regra da casa). Aplicar à mão, pelo painel do Supabase
-- ou pelo db-apply, nunca por `supabase db push`.

DROP INDEX IF EXISTS public.idx_notificacoes_usuario_created;
DROP INDEX IF EXISTS public.idx_notificacoes_globais_created;
DROP INDEX IF EXISTS public.idx_reviews_resposta_pendente;
DROP INDEX IF EXISTS public.idx_cart_items_user_id;
