-- ============================================================================
-- Rollback manual — a caderneta confere a chave sem bcrypt por chamada (20261490000000)
-- ============================================================================
-- Recria public.resolver_loja(text, text) e public.resolver_loja_com_estado(text, text) com os corpos da 20261460000000 BYTE A BYTE (os
-- dois blocos CREATE OR REPLACE abaixo são os da 20261460 copiados do arquivo; o md5 de replace(prosrc, E'\r', '') volta a ser
-- 19072d99f3253583342a0bb6c42447dd e 92682af1143806d3662411b6d5788096). Assinatura, SECURITY DEFINER, VOLATILE, search_path vazio, OID,
-- dono e ACL das duas não mudam (CREATE OR REPLACE). Nenhum GRANT nem REVOKE neste arquivo.
--
-- COM ELE VOLTA O COMPORTAMENTO DE ANTES: as duas portas conferem a chave pelo bcrypt em TODA chamada (o defeito que a migration
-- corrigiu volta junto: chave errada em laço ocupa a CPU do banco da caderneta).
-- DADOS: as colunas hash_rapido e hash_rapido_de e o que estiver gravado nelas FICAM (os corpos antigos não as leem; reaplicar a
-- migration volta a usar o atalho se o hash da chave não mudou, e o ignora se mudou). Tirar as colunas é o
-- rollback-manual-destrutivo-20261490000000 (só com o dono, depois deste).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se alguma das duas portas não existir, tiver sobrecarga, ou os corpos vivos não forem os desta
-- migration nem os da 20261460 (rodar de novo, já desfeito, é no-op: recria os mesmos corpos); se os atributos ou a ACL não forem os de
-- sempre. O pós-voo recusa se os corpos não voltaram aos da 20261460 ou se OID, dono, ACL ou atributos mudaram.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261490000000$
DECLARE
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_hash_v1 text;
  v_hash_v2 text;
BEGIN
  IF v_v1 IS NULL OR v_v2 IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja ou resolver_loja_com_estado ausente; nada a reverter.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado')) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja ou resolver_loja_com_estado tem sobrecarga em public — meça o banco e revise antes de seguir.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash_v1 FROM pg_proc WHERE oid = v_v1;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash_v2 FROM pg_proc WHERE oid = v_v2;
  IF NOT ((v_hash_v1 = '0c60eb13c0016d2129b51def3ec7c255' AND v_hash_v2 = 'a30e752cff5ae4edc2db612866eb8bcd')  -- corpos da 20261490000000 (o que este rollback desfaz)
       OR (v_hash_v1 = '19072d99f3253583342a0bb6c42447dd' AND v_hash_v2 = '92682af1143806d3662411b6d5788096')) THEN -- corpos da 20261460000000 (já desfeito: repetir é no-op)
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_loja (hash %) e resolver_loja_com_estado (hash %) não são os da 20261490000000 nem os da 20261460000000; revise antes de reverter.', COALESCE(v_hash_v1, 'ausente'), COALESCE(v_hash_v2, 'ausente');
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid IN (v_v1, v_v2)
         AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
         AND p.proconfig = ARRAY['search_path=""']::text[]
         AND pg_get_function_arguments(p.oid) = 'p_host text, p_chave text') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de resolver_loja ou resolver_loja_com_estado não são os conhecidos — revise antes de sobrescrever.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid IN (v_v1, v_v2) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', v_v1, 'EXECUTE') OR NOT has_function_privilege('anon', v_v2, 'EXECUTE')
     OR has_function_privilege('authenticated', v_v1, 'EXECUTE') OR has_function_privilege('authenticated', v_v2, 'EXECUTE')
     OR has_function_privilege('service_role', v_v1, 'EXECUTE') OR has_function_privilege('service_role', v_v2, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a ACL de resolver_loja ou resolver_loja_com_estado não é a conhecida (só o anon executa) — revise antes de sobrescrever.';
  END IF;
  PERFORM set_config('ikcous.chave1490_rb', (SELECT jsonb_agg(to_jsonb(p) - 'prosrc' ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (v_v1, v_v2))::text, true);
END $preflight_rollback_20261490000000$;

-- A v1 da 20261460000000, byte a byte (bloco copiado do arquivo dela).
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
     AND fl.ativa
     -- 20261460000000: loja adormecida ou encerrada nao resolve pela v1 (o porteiro que usa a v1 a trata como endereco desconhecido).
     AND fl.estado = 'ativa';
END;
$$;

-- A v2 da 20261460000000, byte a byte (bloco copiado do arquivo dela).
CREATE OR REPLACE FUNCTION public.resolver_loja_com_estado(p_host text, p_chave text)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  project_ref text,
  supabase_url text,
  publishable_key text,
  estado text
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

  -- ativa = false continua sendo endereço desconhecido (zero linhas). Fora do ar (adormecida, encerrada): a linha vem para o porteiro
  -- mostrar a página certa, mas a URL e a chave do banco da loja nunca saem — o porteiro não tem como falar com o banco dela.
  RETURN QUERY
  SELECT fl.id, fl.nome, fl.dominio_publico, fl.project_ref,
         CASE WHEN fl.estado = 'ativa' THEN fl.supabase_url END,
         CASE WHEN fl.estado = 'ativa' THEN fl.publishable_key END,
         fl.estado
    FROM public.frota_lojas fl
   WHERE lower(fl.dominio_publico) = lower(p_host)
     AND fl.ativa;
END;
$$;

DO $posvoo_rollback_20261490000000$
DECLARE
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_v1) IS DISTINCT FROM '19072d99f3253583342a0bb6c42447dd'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_v2) IS DISTINCT FROM '92682af1143806d3662411b6d5788096' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261490000000: os corpos de resolver_loja e resolver_loja_com_estado não voltaram aos da 20261460000000';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(p) - 'prosrc' ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (v_v1, v_v2))
     IS DISTINCT FROM current_setting('ikcous.chave1490_rb')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261490000000: atributos, dono, OID ou ACL de resolver_loja ou resolver_loja_com_estado mudaram';
  END IF;
END $posvoo_rollback_20261490000000$;
