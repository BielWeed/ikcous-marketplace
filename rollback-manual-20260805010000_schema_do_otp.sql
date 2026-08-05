-- Rollback da parte de SCHEMA da 20260805010000_bind_guest_otp_to_single_order.sql
-- (AUTH-010, #118)
--
-- ESTE ARQUIVO É METADE DA VOLTA. A outra metade é o rollback automático que o
-- db-apply.cjs gera, com o corpo anterior de generate_order_otp_v1 e
-- get_orders_by_otp_v1 — essas duas ele SABE fotografar, porque são
-- `CREATE OR REPLACE FUNCTION`.
--
-- O que ele NÃO fotografa é o `ALTER TABLE`, e é o que está aqui. O nome deste
-- arquivo é `rollback-manual-...` de propósito: o db-apply grava em
-- `rollback-<migration>.sql` e sobrescreve sem olhar se já existe (INFRA-280,
-- #140). Nomes diferentes, nenhum dos dois se perde.
--
-- ORDEM PARA DESFAZER TUDO:
--   1. rollback-20260805010000_bind_guest_otp_to_single_order.sql  (as funções)
--   2. este arquivo                                                (o schema)
--   Nesta ordem: as funções antigas não conhecem order_id nem attempts, então
--   devolvê-las primeiro evita uma janela em que a função nova encontre a
--   coluna já removida.
--
-- O QUE SE PERDE: os OTPs vigentes no momento da reversão. São códigos de 15
-- minutos; o pior caso é um convidado precisar pedir outro. Nenhum dado de
-- pedido é tocado — order_id é uma referência, não a origem.
--
-- E O QUE VOLTA A VALER, dito sem eufemismo: o furo da AUTH-010. Quem souber o
-- WhatsApp de um cliente volta a receber na própria caixa o código que abre os
-- pedidos dele.
--
-- COMO RODAR: cole no SQL Editor do Supabase, ou
--   psql "$DATABASE_URL" -f rollback-manual-20260805010000_schema_do_otp.sql

BEGIN;

DROP INDEX IF EXISTS public.idx_otp_verifications_email_pendente;

ALTER TABLE public.otp_verifications DROP COLUMN IF EXISTS attempts;
ALTER TABLE public.otp_verifications DROP COLUMN IF EXISTS order_id;

COMMIT;

-- Confira depois de rodar: as duas colunas somem da lista.
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='otp_verifications'
--    ORDER BY ordinal_position;
