-- O CONTADOR DUPLICADO DO CUPOM MORRE (política P4 do dono: "ao tocar no
-- código de cupom, eliminar os contadores duplicados usage_count/used_count";
-- decisão D6 da investigação docs/superpowers/specs/
-- 2026-09-28-cupons-checkout-investigacao.md).
--
-- `coupons.used_count` (baseline:3892) nunca foi escrito por nenhuma RPC,
-- gatilho, edge ou tela — quem conta é `usage_count` (v23/v24 somam 1,
-- devolver_uso_cupom tira 1). O front parou de ler used_count no PAINEL-12
-- (useCoupons.ts/realtimeSyncEngine.ts). A coluna morta só confunde.
--
-- TRAVA: se alguma linha tiver used_count diferente de 0 (alguém escreveu
-- por fora e a gente não sabe o que é), o arquivo EXPLODE em vez de apagar
-- dado — o dono decide antes. Independente da 20261187: pode subir a
-- qualquer momento, antes ou depois.
--
-- FRONT ANTIGO COM ESTE BANCO: o front lê coupons com `select("*")` e nunca
-- cita used_count — nada quebra.
--
-- SEM BEGIN/COMMIT (regra da casa). Rollback:
-- rollback-manual-20261188000000_o_contador_duplicado_do_cupom_morre.sql

DO $$
DECLARE
  v_escritos bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'coupons'
       AND column_name = 'used_count'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.coupons WHERE COALESCE(used_count, 0) <> 0'
      INTO v_escritos;
    IF v_escritos > 0 THEN
      RAISE EXCEPTION 'used_count tem % linha(s) diferente(s) de 0 — nada foi apagado; confira antes de rodar de novo', v_escritos;
    END IF;
  END IF;
END
$$;

ALTER TABLE public.coupons DROP COLUMN IF EXISTS used_count;
