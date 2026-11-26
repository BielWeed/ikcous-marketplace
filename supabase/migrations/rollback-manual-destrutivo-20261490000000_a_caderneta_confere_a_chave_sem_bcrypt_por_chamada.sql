
-- ROLLBACK DESTRUTIVO 20261490000000 - SO COM O DONO.
-- Tira de public.frota_segredo as colunas hash_rapido e hash_rapido_de. Apaga o atalho da chave da frota (o sha256 da chave que abriu
-- pelo bcrypt e o hash a que ele vale): e' so uma copia derivada da chave, nao ha o que guardar; o hash bcrypt (hash) e a linha ficam.
-- Depois dele frota_segredo volta a ter a forma da 20261141 (id, hash, updated_at).
-- So depois do rollback comum (rollback-manual-20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql: as duas portas
-- com os corpos da 20261460, que nao leem as colunas), numa transacao do caller, com confirmacao explicita (SET LOCAL vale so ate o fim
-- da transacao; um SET sem LOCAL ficaria na sessao inteira e confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR';
-- Repetir e' no-op (IF EXISTS). Sem BEGIN/COMMIT de nivel superior: transacao do aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261490000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_atalho_da_chave_da_frota', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'ATALHO_DA_CHAVE_SO_COM_O_DONO: confirme antes de apagar o atalho da chave em public.frota_segredo.';
  END IF;
  -- As portas da 20261490 leem as colunas: tira-las com elas no ar faria o porteiro falhar em toda chamada.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja(text, text)'))
        IS DISTINCT FROM '19072d99f3253583342a0bb6c42447dd'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja_com_estado(text, text)'))
        IS DISTINCT FROM '92682af1143806d3662411b6d5788096' THEN
    RAISE EXCEPTION 'ATALHO_DA_CHAVE_ROLLBACK_COMUM_PRIMEIRO: devolva resolver_loja e resolver_loja_com_estado aos corpos da 20261460 (rollback comum) antes de apagar as colunas.';
  END IF;
END $destrutivo_20261490000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
ALTER TABLE public.frota_segredo
  DROP COLUMN IF EXISTS hash_rapido_de,
  DROP COLUMN IF EXISTS hash_rapido;

NOTIFY pgrst, 'reload schema';
