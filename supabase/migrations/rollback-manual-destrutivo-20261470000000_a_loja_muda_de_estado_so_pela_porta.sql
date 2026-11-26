-- ROLLBACK DESTRUTIVO 20261470000000 - SO COM O DONO.
-- Apaga public.frota_estado_historico (a tabela, a sequencia do id e TODAS as linhas): quem mudou o estado de cada loja, quando, de qual
-- para qual, em qual release e por que. Esse dado NAO tem como ser recuperado. As lojas, o estado atual de cada uma (frota_lojas.estado,
-- estado_desde, estado_sha), as chaves e o segredo da frota ficam. Faca copia antes:
--   SELECT id, loja_id, project_ref, de, para, sha, motivo, quem, em FROM public.frota_estado_historico ORDER BY id;
-- So depois do rollback comum (rollback-manual-20261470000000_a_loja_muda_de_estado_so_pela_porta.sql: a porta, a funcao do gatilho e o
-- gatilho ausentes), numa transacao do caller, com confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL
-- ficaria na sessao inteira e confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_historico_do_estado_da_loja = 'APAGAR';
-- Repetir e' no-op (IF EXISTS). Sem BEGIN/COMMIT de nivel superior: transacao do aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261470000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_historico_do_estado_da_loja', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'HISTORICO_DO_ESTADO_SO_COM_O_DONO: confirme antes de apagar o historico de estado das lojas (public.frota_estado_historico).';
  END IF;
  IF to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)') IS NOT NULL
     OR to_regprocedure('public.frota_lojas_estado_so_pela_porta()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.frota_lojas') AND t.tgname = 'frota_lojas_estado_so_pela_porta') THEN
    RAISE EXCEPTION 'HISTORICO_DO_ESTADO_ROLLBACK_COMUM_PRIMEIRO: tire a porta, a funcao do gatilho e o gatilho (rollback comum) antes de apagar o historico.';
  END IF;
END $destrutivo_20261470000000$;

-- CADERNETA SEMEADA (26/11/2026, plano caderneta-fora-do-dekxab, T4): o banco da IKCOUS passa a guardar a caderneta de PRODUCAO da
-- frota. Com qualquer linha em frota_lojas, frota_segredo ou frota_estado_historico, este destrutivo recusa (CADERNETA_SEMEADA) sem
-- apagar nada, mesmo com a confirmacao APAGAR acima: apagaria o historico de estado da frota. Nos bancos das lojas as tres ficam
-- vazias e nada muda. So com o dono, na mesma transacao, alem do APAGAR:
--   SET LOCAL ikcous.apagar_caderneta = 'sim';
-- A trava de escrita (SHARE) vale ate o fim da transacao: ninguem grava linha entre a conferencia e o DROP.
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
DROP TABLE IF EXISTS public.frota_estado_historico;

NOTIFY pgrst, 'reload schema';
