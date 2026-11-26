
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

-- CADERNETA SEMEADA (26/11/2026, plano caderneta-fora-do-dekxab, T4): o banco da IKCOUS passa a guardar a caderneta de PRODUCAO da
-- frota. Com qualquer linha em frota_lojas, frota_segredo ou frota_estado_historico, este destrutivo recusa (CADERNETA_SEMEADA) sem
-- apagar nada, mesmo com a confirmacao APAGAR acima: apagaria o estado de cada loja da frota. Nos bancos das lojas as tres ficam
-- vazias e nada muda. So com o dono, na mesma transacao, alem do APAGAR:
--   SET LOCAL ikcous.apagar_caderneta = 'sim';
-- A trava de escrita (SHARE) vale ate o fim da transacao: ninguem grava linha entre a conferencia e o ALTER.
DO $caderneta_semeada$
DECLARE
  v_tabela text;
  v_tem_linha boolean;
BEGIN
  IF COALESCE(current_setting('ikcous.apagar_caderneta', true), '') = 'sim' THEN
    RETURN;
  END IF;
  FOREACH v_tabela IN ARRAY ARRAY['frota_lojas', 'frota_segredo', 'frota_estado_historico'] LOOP
    IF to_regclass('public.' || v_tabela) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', v_tabela);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_tabela) INTO v_tem_linha;
      IF v_tem_linha THEN
        RAISE EXCEPTION 'CADERNETA_SEMEADA: public.% tem linha - este banco guarda a caderneta da frota e apaga-la tira todas as lojas do ar. Nada foi apagado. So com o dono: SET LOCAL ikcous.apagar_caderneta = ''sim'' na mesma transacao.', v_tabela;
      END IF;
    END IF;
  END LOOP;
END $caderneta_semeada$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
ALTER TABLE public.frota_lojas
  DROP CONSTRAINT IF EXISTS frota_lojas_estado_check,
  DROP COLUMN IF EXISTS estado_sha,
  DROP COLUMN IF EXISTS estado_desde,
  DROP COLUMN IF EXISTS estado;

NOTIFY pgrst, 'reload schema';
