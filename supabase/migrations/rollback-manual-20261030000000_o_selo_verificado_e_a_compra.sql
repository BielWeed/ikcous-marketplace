-- ROLLBACK MANUAL da 20261030000000_o_selo_verificado_e_a_compra.sql
-- (o selo "Verificado" = compra confirmada, por triggers)
--
-- O desfazer devolve o COMPORTAMENTO antigo (selo manual), mas NÃO reverte
-- os booleanos: as avaliações marcadas pelo retroativo ficam verificadas —
-- e estão certas (tinham compra reconhecida). Reverter `verified = false`
-- de volta apagaria a verdade para poupar o interruptor manual que este
-- conserto aposentou. Quem quiser o interruptor de volta é decisão de
-- produto nova, não deste rollback.

DROP TRIGGER IF EXISTS tr_compra_verifica_avaliacoes
  ON public.marketplace_orders;
DROP FUNCTION IF EXISTS public.marca_avaliacoes_do_pedido_verificadas();

DROP TRIGGER IF EXISTS tr_avaliacao_nasce_verificada
  ON public.reviews;
DROP FUNCTION IF EXISTS public.marca_avaliacao_nasce_verificada();

-- ORDEM: front primeiro (o painel sem botão funciona com qualquer estado do
-- banco — a coluna continua existindo; não há PGRST aqui).
--
-- A INSERT POLICY alterada por esta migration (com `AND verified = false`)
-- também volta: re-aplicar a
-- 20260812020000_reviews_insert_respeita_enable_reviews.sql (DROP + CREATE
-- idempotente, restaura a policy sem a trava do selo):
--
--   node scripts/db-apply.cjs \
--     supabase/migrations/20260812020000_reviews_insert_respeita_enable_reviews.sql
--
-- Sem isso, o rollback do comportamento deixaria o INSERT do app RECUSADO
-- (o front não manda `verified`, e o default false da coluna passa na
-- policy... mas a policy antiga sem a trava não existe mais até o passo
-- acima rodar).
