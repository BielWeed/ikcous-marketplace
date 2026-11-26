-- ============================================================================
-- Rollback manual — a loja tem estado de vida (20261460000000)
-- ============================================================================
-- Recria public.resolver_loja(text, text) com o corpo da 20261141000000 BYTE A BYTE (o bloco CREATE OR REPLACE abaixo é o da
-- 20261141 copiado do arquivo; o md5 de replace(prosrc, E'\r', '') volta a ser fcb01b1e25e00481d8085d53dec291e5) e derruba
-- public.resolver_loja_com_estado(text, text). Assinatura, SECURITY DEFINER, VOLATILE, search_path vazio, OID, dono e ACL da v1 não
-- mudam (CREATE OR REPLACE). Nenhum GRANT nem REVOKE neste arquivo.
--
-- COM ELE VOLTA O COMPORTAMENTO DE ANTES: a v1 deixa de olhar o estado (loja adormecida ou encerrada com ativa = true volta a resolver,
-- com URL e chave) e a v2 some (o porteiro do Lote 2, se ainda estiver no ar, recebe PGRST202 e cai na reserva estreita da v1).
-- Reverter ANTES o porteiro do Lote 2 e o comando estado-da-loja.mjs (Lote 4).
-- DADOS: as colunas estado, estado_desde e estado_sha, o CHECK frota_lojas_estado_check e TODAS as linhas de frota_lojas FICAM (o estado
-- de cada loja é preservado; reaplicar a migration volta a valer o que estava gravado). Tirar as colunas é o
-- rollback-manual-destrutivo-20261460000000 (só com o dono, depois deste).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a v1 não existir, tiver sobrecarga, ou o corpo vivo não for o desta migration nem o da
-- 20261141 (rodar de novo, já desfeito, é no-op: recria o mesmo corpo); se os atributos ou a ACL da v1 não forem os de sempre; ou se a v2
-- existir com outro corpo (sucessora no ar?). O pós-voo recusa se o corpo da v1 não voltou ao da 20261141, se OID, dono, ACL ou atributos
-- mudaram, ou se a v2 ficou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261460000000$
DECLARE
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_hash text;
BEGIN
  IF v_v1 IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.resolver_loja(text, text) ausente; nada a reverter.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja tem sobrecarga em public — meça o banco e revise antes de seguir.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_v1;
  IF v_hash IS NULL OR v_hash NOT IN (
       '19072d99f3253583342a0bb6c42447dd', -- corpo da 20261460000000 (o que este rollback desfaz)
       'fcb01b1e25e00481d8085d53dec291e5'  -- corpo da 20261141000000 (já desfeito: repetir é no-op)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.resolver_loja (hash %) não é o da 20261460000000 nem o da 20261141000000; revise antes de reverter.', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_v1
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_host text, p_chave text'
          AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, project_ref text, supabase_url text, publishable_key text)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de public.resolver_loja não são os conhecidos — revise antes de sobrescrever.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_v1 AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', v_v1, 'EXECUTE')
     OR has_function_privilege('authenticated', v_v1, 'EXECUTE')
     OR has_function_privilege('service_role', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de public.resolver_loja não é a conhecida (só o anon executa) — revise antes de sobrescrever.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja_com_estado') > 1
     OR (v_v2 IS NULL AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja_com_estado'))
     OR (v_v2 IS NOT NULL AND (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_v2) IS DISTINCT FROM '92682af1143806d3662411b6d5788096') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja_com_estado não é a da 20261460000000 (outro corpo, outra assinatura ou sobrecarga: sucessora no ar?); nada foi desfeito.';
  END IF;
  PERFORM set_config('ikcous.estado1460_rb_v1', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_v1)::text, true);
END $preflight_rollback_20261460000000$;

-- A v1 da 20261141000000, byte a byte (bloco copiado do arquivo da caderneta).
CREATE OR REPLACE FUNCTION public.resolver_loja(p_host text, p_chave text)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  project_ref text,
  supabase_url text,
  publishable_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.frota_segredo fs
     WHERE fs.id = 1
       AND fs.hash = extensions.crypt(p_chave, fs.hash)
  ) THEN
    RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
  END IF;

  RETURN QUERY
  SELECT fl.id, fl.nome, fl.dominio_publico, fl.project_ref, fl.supabase_url, fl.publishable_key
    FROM public.frota_lojas fl
   WHERE lower(fl.dominio_publico) = lower(p_host)
     AND fl.ativa;
END;
$$;

DROP FUNCTION IF EXISTS public.resolver_loja_com_estado(text, text);

DO $posvoo_rollback_20261460000000$
DECLARE
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
BEGIN
  IF v_v1 IS NULL OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_v1) IS DISTINCT FROM 'fcb01b1e25e00481d8085d53dec291e5' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261460000000: o corpo de resolver_loja não voltou ao da 20261141000000';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_v1) IS DISTINCT FROM current_setting('ikcous.estado1460_rb_v1')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261460000000: atributos, dono, OID ou ACL de resolver_loja mudaram';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_loja_com_estado') THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261460000000: resolver_loja_com_estado ainda existe';
  END IF;
END $posvoo_rollback_20261460000000$;

-- A v2 saiu do catálogo: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';
