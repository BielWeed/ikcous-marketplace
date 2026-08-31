-- ROLLBACK MANUAL de 20261037000000_a_fabrica_do_whatsapp_morre_na_coluna
-- (laudo caça-bugs do molde, 30-31/08/2026, achado C3).
--
-- ⚠️ O rollback REPLANTA o default de fábrica na coluna: qualquer INSERT
-- que omitir whatsapp_number volta a nascer com '5534999999999'. Rodar só
-- se o DROP quebrar algo provado, e consertar o conserto na sequência.
--
-- SEM BEGIN/COMMIT.

ALTER TABLE public.store_config ALTER COLUMN whatsapp_number SET DEFAULT '5534999999999'::text;
