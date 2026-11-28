-- ============================================================================
-- Rollback manual — a ordem dos banners muda numa trava só (20261651000000)
-- ============================================================================
-- Tira SÓ as duas RPCs que a 20261651000000 criou: `normalize_banners_atomic(text,uuid,boolean)` e
-- `move_banner_atomic(text,uuid,text)`. A `reorder_banners_atomic` e a `swap_banner_order` não são tocadas (a conferência
-- compara a fotografia da primeira antes e depois).
--
-- COM ELE VOLTA O DEFEITO: o front novo não acha as RPCs (PGRST202) e cai no caminho antigo — a arrumação da página volta
-- a ser leitura + uma gravação por banner, sem trava entre aparelhos, e subir/descer volta a trocar com o vizinho que o
-- aparelho calculou.
--
-- DADOS: nenhuma linha é lida para reescrita, reescrita ou apagada. A ordem gravada pelas RPCs novas fica como está.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se uma das duas existir com corpo que não é o desta migration
-- (uma redefinição posterior desconhecida: tirar por cima a apagaria em silêncio) ou com sobrecarga. Estados aceitos: a
-- 20261651000000 no ar, ou já desfeita (rodar duas vezes deixa o mesmo estado).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261651000000$
DECLARE
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'normalize_banners_atomic') > 1
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'move_banner_atomic') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: normalize_banners_atomic ou move_banner_atomic tem sobrecarga em public; revise antes de desfazer.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'normalize_banners_atomic') THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc
     WHERE oid = to_regprocedure('public.normalize_banners_atomic(text,uuid,boolean)');
    IF v_hash IS DISTINCT FROM 'c221e4ba453f3f659574f03fcd1341e3' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: normalize_banners_atomic no ar (hash %) nao e a desta migration — uma redefinicao posterior esta no ar; revise antes de tirar.', COALESCE(v_hash, 'outra assinatura');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'move_banner_atomic') THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc
     WHERE oid = to_regprocedure('public.move_banner_atomic(text,uuid,text)');
    IF v_hash IS DISTINCT FROM '2da1c33deaceb650951a795b9d720eb7' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: move_banner_atomic no ar (hash %) nao e a desta migration — uma redefinicao posterior esta no ar; revise antes de tirar.', COALESCE(v_hash, 'outra assinatura');
    END IF;
  END IF;
  PERFORM set_config('ikcous.ordem_banners_1651_rb_reorder',
    COALESCE((SELECT to_jsonb(p)::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reorder_banners_atomic(text,uuid,uuid)')), 'ausente'),
    true);
END $preflight_rollback_20261651000000$;

DROP FUNCTION IF EXISTS public.move_banner_atomic(text, uuid, text);
DROP FUNCTION IF EXISTS public.normalize_banners_atomic(text, uuid, boolean);

DO $conferencia_rollback_20261651000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN ('normalize_banners_atomic', 'move_banner_atomic')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261651000000: uma das RPCs novas continua no banco';
  END IF;
  IF COALESCE((SELECT to_jsonb(p)::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reorder_banners_atomic(text,uuid,uuid)')), 'ausente')
       IS DISTINCT FROM current_setting('ikcous.ordem_banners_1651_rb_reorder') THEN
    RAISE EXCEPTION 'conferencia rollback 20261651000000: a reorder_banners_atomic mudou (corpo, OID, dono, ACL ou atributo)';
  END IF;
END $conferencia_rollback_20261651000000$;

NOTIFY pgrst, 'reload schema';
