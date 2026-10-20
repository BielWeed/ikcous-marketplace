-- ============================================================================
-- ROLLBACK DESTRUTIVO — 2º DEGRAU — a loja escolhe como entrega na cidade (20261244000000)
-- ============================================================================
-- APAGA as colunas public.store_config.local_delivery_enabled e public.store_config.local_delivery_days (e a CHECK
-- do prazo, que cai junto) e, com elas, o que a lojista escolheu: o modo ("Entrego" / "Entrego e retiro" / "Só
-- retiro") e o prazo da entrega própria. Por isso este é o SEGUNDO degrau do rollback e vive em arquivo à parte: o
-- degrau comum (rollback-manual-20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql) devolve as três funções, tira
-- a trigger e a view, e DEIXA as colunas.
--
-- TRAVAS (cada uma recusa sem gravar nada):
--   1. o degrau comum já rodou: a função e a trigger não existem, nenhuma função de public cita as colunas e a view
--      v_store_config não as expõe (um corpo vivo que as lê quebraria no próximo pedido);
--   2. nenhuma loja com local_delivery_enabled = false ("Só retiro") e nenhuma com prazo diferente de 1: o que a
--      lojista escolheu de propósito só se apaga de propósito (devolva a loja ao padrão, ou aceite perder o prazo,
--      com UPDATE public.store_config SET local_delivery_enabled = true, local_delivery_days = 1 WHERE id = 1).
--
-- ANTES DE RODAR: o front e a edge calculate-shipping desta frente que leem as colunas têm de ter voltado à versão
-- anterior (a edge já lê de forma tolerante; o front novo, não).
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa; localmente use `psql -1`). Rodar duas vezes deixa o mesmo
-- estado (DROP COLUMN IF EXISTS).
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $destrutivo_20261244$
DECLARE
  v_n integer := 0;
BEGIN
  IF to_regprocedure('public.store_config_so_retirada_exige_retirada()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgname = 'store_config_so_retirada_exige_retirada' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'ENTREGA_NA_CIDADE_ROLLBACK_COMUM_PRIMEIRO: a trigger ou a função dela ainda existem — rode antes o rollback-manual-20261244000000.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.prokind = 'f'
                AND (p.prosrc LIKE '%local_delivery_enabled%' OR p.prosrc LIKE '%local_delivery_days%')) THEN
    RAISE EXCEPTION 'ENTREGA_NA_CIDADE_ROLLBACK_COMUM_PRIMEIRO: uma função de public ainda cita as colunas — devolva os corpos antes (rollback-manual-20261244000000).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = to_regclass('public.v_store_config')
                AND a.attname IN ('local_delivery_enabled', 'local_delivery_days')
                AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'ENTREGA_NA_CIDADE_ROLLBACK_COMUM_PRIMEIRO: v_store_config ainda expõe as colunas — rode antes o rollback-manual-20261244000000.';
  END IF;

  -- EXECUTE porque as colunas podem já não existir (rodar de novo).
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'store_config'
                AND column_name IN ('local_delivery_enabled', 'local_delivery_days')) THEN
    EXECUTE 'SELECT count(*) FROM public.store_config WHERE local_delivery_enabled = false OR local_delivery_days <> 1' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'ESCOLHA_DA_LOJISTA_NAO_SE_APAGA_SEM_QUERER: a loja escolheu "Só retiro" ou um prazo diferente de 1 dia — devolva-a ao padrão de propósito (UPDATE public.store_config SET local_delivery_enabled = true, local_delivery_days = 1 WHERE id = 1) antes de apagar as colunas (ver o cabeçalho deste arquivo).';
    END IF;
  END IF;
END $destrutivo_20261244$;

ALTER TABLE public.store_config DROP COLUMN IF EXISTS local_delivery_days;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS local_delivery_enabled;

DO $conferencia_destrutivo_20261244$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'store_config'
                AND column_name IN ('local_delivery_enabled', 'local_delivery_days')) THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261244: as colunas ainda existem';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.store_config'::regclass
                AND conname = 'store_config_local_delivery_days_check') THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261244: a CHECK do prazo ainda existe';
  END IF;
END $conferencia_destrutivo_20261244$;

-- Sem isto a REST do PostgREST segue anunciando as colunas que acabaram de sair da tabela.
NOTIFY pgrst, 'reload schema';
