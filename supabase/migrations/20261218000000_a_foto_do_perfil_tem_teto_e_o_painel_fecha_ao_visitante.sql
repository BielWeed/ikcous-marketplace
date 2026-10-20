-- ============================================================================
-- Migration 20261218000000 — a foto do perfil tem teto de tamanho e duas portas
-- do painel deixam de atender o visitante sem login
-- (auditoria de segurança de 12/10/2026, lote L2, primeira de três)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
--   a. A foto e a capa do perfil (`profiles.avatar_url` e `profiles.cover_url`,
--      texto livre, copiadas para `public_profiles` pelo gatilho
--      `sync_public_profile`) não tinham tamanho máximo; o tamanho da imagem do
--      perfil passa a ter teto. O app comprime a foto para JPEG 200x200 e a
--      capa para 800x300 (dezenas de KB).
--   b. `get_segmented_push_count` (contagem de destinatários do push, só do
--      painel) era executável por PUBLIC e pelo visitante sem login. O corpo já
--      recusava quem não é admin; agora a porta também.
--   c. A view do painel `vw_produtos_admin` ainda dava SELECT ao visitante sem
--      login (o WHERE `is_admin()` devolvia zero linhas, mas a porta existia).
--      Nenhum leitor do app a usa sem login.
--
-- 2. O QUE MUDA
--
--   a. Função de gatilho NOVA `perfil_recusa_imagem_grande()` (SECURITY
--      INVOKER, não lê tabela nenhuma) e gatilho NOVO
--      `tr_perfil_recusa_imagem_grande` BEFORE INSERT OR UPDATE OF avatar_url,
--      cover_url ON profiles. Tetos: foto 128 KiB, capa 512 KiB (bytes do
--      texto gravado, ~2x o pior caso do compressor do app). No INSERT confere
--      o que entra; no UPDATE confere SÓ a coluna que MUDOU (comparada com
--      OLD): quem já tem imagem maior que o teto continua salvando nome,
--      WhatsApp e CPF (a RPC regrava as quatro colunas, sempre com o mesmo
--      valor). Recusa com ERRCODE 23514 e mensagem curta; a tela já mostra o
--      aviso genérico de "não foi possível atualizar seu perfil". NULL e
--      'REMOVE' (que vira NULL) passam. Nenhum CHECK: um CHECK reavaliaria a
--      linha inteira em todo UPDATE.
--   b. `get_segmented_push_count(text, numeric, integer)`: REVOKE ALL de
--      PUBLIC e de anon; GRANT EXECUTE a authenticated e service_role. O
--      corpo NÃO é recriado (o md5 dele é conferido por outras consultas).
--   c. `vw_produtos_admin`: REVOKE ALL de PUBLIC e de anon. authenticated
--      (o painel lê e grava produto por ela) e service_role não mudam.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar. Imagem já
-- gravada continua lá e continua sendo servida, qualquer que seja o tamanho
-- (medido em 12/10/2026: a maior é de 16.727 bytes na IKCOUS e 3.335 na Savy,
-- muito abaixo dos tetos). O teto vale só para a próxima troca de imagem.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo de `get_segmented_push_count` (md5 de
-- `replace(prosrc, E'\r', '')`) não for o vigente, se `vw_produtos_admin` ou
-- as colunas de imagem do perfil não existirem, e se a função de gatilho já
-- existir com outro corpo.
--
-- 5. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- `CREATE OR REPLACE FUNCTION`, `CREATE OR REPLACE TRIGGER`, GRANT e REVOKE:
-- reaplicar deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior (regra
-- da casa): quem abre a transação é o aplicador; o pré-voo, as mudanças e a
-- conferência final caem juntos ou não caem.
--
-- 6. ORDEM E ROLLBACK
--
-- Nenhum front nem edge function muda. Banco novo com front velho: igual,
-- exceto a imagem acima do teto, que passa a ser recusada. ROLLBACK MANUAL:
-- rollback-manual-20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql
-- apaga o gatilho e a função e devolve as permissões medidas antes (EXECUTE a
-- PUBLIC e anon na contagem do push; SELECT e REFERENCES a anon na view).
--
-- PROVA VIVA: tests/banco/portas-do-banco-viva.cjs e
-- tests/banco/portas-do-banco-portao-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261218$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.get_segmented_push_count(text,numeric,integer)');
  IF v_hash IS DISTINCT FROM 'e5f6b76afd6ec75df32f168d9942e209' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.get_segmented_push_count(text,numeric,integer) (hash %) não é o vigente — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  IF to_regclass('public.vw_produtos_admin') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.vw_produtos_admin não existe.';
  END IF;

  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname IN ('avatar_url', 'cover_url')
         AND atttypid = 'text'::regtype
         AND attnum > 0 AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.profiles sem avatar_url/cover_url do tipo text.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.perfil_recusa_imagem_grande()');
  IF v_hash IS NOT NULL AND v_hash <> '57552d1ca161fb4176e28ab63c2932f8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.perfil_recusa_imagem_grande() já existe com outro corpo (hash %).', v_hash;
  END IF;
END $preflight_20261218$;

-- a. Teto da foto e da capa do perfil: confere o que entra (INSERT) e só a
-- coluna que mudou (UPDATE). Sem leitura de tabela e sem SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.perfil_recusa_imagem_grande()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
    c_teto_foto constant integer := 131072;  -- 128 KiB
    c_teto_capa constant integer := 524288;  -- 512 KiB
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF coalesce(octet_length(NEW.avatar_url), 0) > c_teto_foto THEN
            RAISE EXCEPTION 'foto de perfil grande demais (limite de 128 KiB)'
                USING ERRCODE = '23514';
        END IF;
        IF coalesce(octet_length(NEW.cover_url), 0) > c_teto_capa THEN
            RAISE EXCEPTION 'capa de perfil grande demais (limite de 512 KiB)'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
        IF coalesce(octet_length(NEW.avatar_url), 0) > c_teto_foto THEN
            RAISE EXCEPTION 'foto de perfil grande demais (limite de 128 KiB)'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.cover_url IS DISTINCT FROM OLD.cover_url THEN
        IF coalesce(octet_length(NEW.cover_url), 0) > c_teto_capa THEN
            RAISE EXCEPTION 'capa de perfil grande demais (limite de 512 KiB)'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.perfil_recusa_imagem_grande() IS
'Gatilho de profiles: foto do perfil ate 128 KiB e capa ate 512 KiB; no UPDATE so confere a coluna que mudou (imagem antiga maior que o teto nao trava o resto do perfil). Migration 20261218000000.';

REVOKE ALL ON FUNCTION public.perfil_recusa_imagem_grande() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.perfil_recusa_imagem_grande() FROM anon;
REVOKE ALL ON FUNCTION public.perfil_recusa_imagem_grande() FROM authenticated;

CREATE OR REPLACE TRIGGER tr_perfil_recusa_imagem_grande
    BEFORE INSERT OR UPDATE OF avatar_url, cover_url ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.perfil_recusa_imagem_grande();

-- b. Contagem do push: só quem está logado (o corpo, inalterado, exige o
-- admin atual).
REVOKE ALL ON FUNCTION public.get_segmented_push_count(text, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_segmented_push_count(text, numeric, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_segmented_push_count(text, numeric, integer) TO service_role;

-- c. View de produtos do painel: nada para o visitante sem login.
REVOKE ALL ON TABLE public.vw_produtos_admin FROM PUBLIC;
REVOKE ALL ON TABLE public.vw_produtos_admin FROM anon;

-- CONFERÊNCIA no instante do apply: aborta se o estado final não for o
-- esperado (um REVOKE que só avisou deixaria a porta aberta).
DO $conferencia_20261218$
DECLARE
  v_fn constant text := 'public.get_segmented_push_count(text,numeric,integer)';
  v_gatilho constant text := 'public.perfil_recusa_imagem_grande()';
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.profiles'::regclass
          AND t.tgname = 'tr_perfil_recusa_imagem_grande'
          AND t.tgenabled = 'O'
          AND NOT t.tgisinternal
          AND replace(pg_get_triggerdef(t.oid), 'public.', '') =
              'CREATE TRIGGER tr_perfil_recusa_imagem_grande BEFORE INSERT OR UPDATE OF avatar_url, cover_url ON profiles FOR EACH ROW EXECUTE FUNCTION perfil_recusa_imagem_grande()') THEN
    RAISE EXCEPTION 'conferencia 20261218: gatilho tr_perfil_recusa_imagem_grande ausente, desligado ou diferente';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(v_gatilho)) THEN
    RAISE EXCEPTION 'conferencia 20261218: % nao pode ser SECURITY DEFINER', v_gatilho;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure(v_gatilho) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_gatilho, 'EXECUTE')
     OR has_function_privilege('authenticated', v_gatilho, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261218: % executavel por PUBLIC, anon ou authenticated', v_gatilho;
  END IF;

  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure(v_fn))
     IS DISTINCT FROM 'e5f6b76afd6ec75df32f168d9942e209' THEN
    RAISE EXCEPTION 'conferencia 20261218: o corpo de % mudou', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure(v_fn) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261218: % ainda executavel por PUBLIC ou anon', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261218: % sem EXECUTE de authenticated ou service_role -- o painel do push pararia', v_fn;
  END IF;

  IF has_table_privilege('anon', 'public.vw_produtos_admin', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR has_any_column_privilege('anon', 'public.vw_produtos_admin', 'SELECT,INSERT,UPDATE,REFERENCES')
     OR EXISTS (SELECT 1 FROM pg_class c
                  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = 'public.vw_produtos_admin'::regclass AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261218: vw_produtos_admin ainda alcancavel por PUBLIC ou anon';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.vw_produtos_admin', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.vw_produtos_admin', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.vw_produtos_admin', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.vw_produtos_admin', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.vw_produtos_admin', 'SELECT') THEN
    RAISE EXCEPTION 'conferencia 20261218: vw_produtos_admin perdeu privilegio de authenticated ou service_role -- o cadastro de produto pararia';
  END IF;
END $conferencia_20261218$;
