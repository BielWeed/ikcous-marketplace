
-- ROLLBACK DESTRUTIVO 20261460000000 - SO COM O DONO.
-- Tira de public.frota_lojas o CHECK frota_lojas_estado_check e as colunas estado, estado_desde e estado_sha. APAGA o estado de cada
-- loja (quem esta adormecida ou encerrada, desde quando e a release de referencia): esse dado NAO tem como ser recuperado. As lojas, os
-- dominios, as chaves e o segredo da frota ficam. Faca copia antes:
--   SELECT id, estado, estado_desde, estado_sha FROM public.frota_lojas ORDER BY id;
-- Depois dele a caderneta volta a ser a da 20261141 (so "ativa ou nao"): loja que estava fora do ar com ativa = true volta a resolver.
-- So depois do rollback comum (rollback-manual-20261460000000_a_loja_tem_estado_de_vida.sql: a v2 ausente e a v1 com o corpo da
-- 20261141), numa transacao do caller, com confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na
-- sessao inteira e confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR';
-- Repetir e' no-op (IF EXISTS). Sem BEGIN/COMMIT de nivel superior: transacao do aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261460000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_estado_de_vida', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'ESTADO_DE_VIDA_SO_COM_O_DONO: confirme antes de apagar o estado das lojas em public.frota_lojas.';
  END IF;
  IF to_regprocedure('public.resolver_loja_com_estado(text, text)') IS NOT NULL
     OR to_regprocedure('public.resolver_loja(text, text)') IS NULL
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_loja(text, text)'))
        IS DISTINCT FROM 'fcb01b1e25e00481d8085d53dec291e5' THEN
    RAISE EXCEPTION 'ESTADO_DE_VIDA_ROLLBACK_COMUM_PRIMEIRO: devolva a resolver_loja ao corpo da 20261141 e tire a resolver_loja_com_estado (rollback comum) antes de apagar as colunas.';
  END IF;
END $destrutivo_20261460000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
ALTER TABLE public.frota_lojas
  DROP CONSTRAINT IF EXISTS frota_lojas_estado_check,
  DROP COLUMN IF EXISTS estado_sha,
  DROP COLUMN IF EXISTS estado_desde,
  DROP COLUMN IF EXISTS estado;

NOTIFY pgrst, 'reload schema';
