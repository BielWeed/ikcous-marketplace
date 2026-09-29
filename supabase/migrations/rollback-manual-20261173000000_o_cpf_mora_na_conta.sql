-- ROLLBACK MANUAL de 20261173000000_o_cpf_mora_na_conta.sql
-- (o CPF mora na conta — CPF opcional no perfil + prefill/persistência no
-- checkout, 23/09/2026).
--
-- Derruba as DUAS funções que a migration criou, na ordem INVERSA da
-- criação (`set_my_cpf` primeiro, `get_my_cpf` depois) — `DROP FUNCTION IF
-- EXISTS`, seguro mesmo se a função já não existir (reversão repetida é
-- no-op). SEM `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da
-- casa).
--
-- DADOS: nada é apagado. `profiles.cpf` que já tiver sido gravado pelas
-- RPCs (perfil ou checkout, depois que a migration foi aplicada) continua
-- exatamente como está na coluna — este rollback só tira o CAMINHO de
-- leitura/escrita por RPC; a coluna em si (`public.profiles.cpf`) não nasceu
-- nesta migration e não é tocada aqui.
--
-- MODO DE APLICAÇÃO — psql, UMA transação externa única:
--   psql "$DATABASE_URL" -1 -f rollback-manual-20261173000000_o_cpf_mora_na_conta.sql
-- NUNCA pelo scripts/db-apply.cjs (registraria o rollback no ledger de
-- migrations).

DROP FUNCTION IF EXISTS public.set_my_cpf(text);
DROP FUNCTION IF EXISTS public.get_my_cpf();
