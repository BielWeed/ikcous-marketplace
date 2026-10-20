-- ============================================================================
-- Migration 20261218000100 — as configurações da loja e os códigos de
-- verificação só são lidos e gravados pelo servidor
-- (auditoria de segurança de 12/10/2026, lote L2, segunda de três)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- `app_settings` (configurações internas da loja, incluindo o registro cifrado
-- da conta de pagamento do lojista) e `otp_verifications` (códigos de
-- verificação do rastreio do convidado) só são usados pelo servidor: as edge
-- functions com a chave de serviço e funções SECURITY DEFINER do banco.
-- Nenhuma tela do app lê ou grava essas tabelas. Mesmo assim, em uma das lojas
-- (medido em 12/10/2026) os papéis do visitante (anon) e da conta logada
-- (authenticated) tinham todos os privilégios de tabela nelas, e só a política
-- de RLS separava o acesso. Na outra loja esses papéis já não tinham privilégio
-- nenhum, e todos os fluxos funcionam assim.
--
-- 2. O QUE MUDA
--
-- `REVOKE ALL` em `app_settings` e `otp_verifications` de PUBLIC, anon e
-- authenticated (REVOKE ALL, e não uma lista: no PG17 a lista deixaria o
-- MAINTAIN). service_role e o dono não mudam. As políticas de RLS existentes
-- não mudam. Onde esses papéis já não tinham privilégio, nada muda.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida, reescrita ou apagada. O REVOKE de tabela também tira
-- permissão de COLUNA desses papéis; medido em 12/10/2026: nenhuma coluna das
-- duas tabelas tinha permissão própria nas duas lojas, e a conferência final
-- exige que nenhuma coluna fique alcançável por PUBLIC, anon ou authenticated.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se uma das tabelas não existir, estiver sem RLS, ou se service_role
-- não tiver SELECT, INSERT, UPDATE e DELETE nelas (as edge functions e o
-- painel de credenciais parariam).
--
-- 5. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Só REVOKE: reaplicar deixa o mesmo estado (e não faz nada onde já estava
-- fechado). Sem BEGIN/COMMIT de nível superior (regra da casa). Um REVOKE que
-- não revoga (grantor diferente) só emite WARNING: a conferência final
-- transforma isso em erro e o apply inteiro volta.
--
-- 6. ORDEM E ROLLBACK
--
-- Nenhum front nem edge function muda. ROLLBACK MANUAL:
-- rollback-manual-20261218000100_configuracoes_e_codigos_so_do_servidor.sql
-- devolve o estado medido na loja que tinha os privilégios abertos (GRANT ALL a
-- anon e authenticated). Ele NÃO deve rodar numa loja que já estava fechada
-- antes desta migration: abriria o que nunca esteve aberto.
--
-- PROVA VIVA: tests/banco/portas-do-banco-viva.cjs e
-- tests/banco/portas-do-banco-portao-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261218000100$
DECLARE
  v_tabela text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['public.app_settings', 'public.otp_verifications'] LOOP
    IF to_regclass(v_tabela) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_tabela;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(v_tabela)) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está sem RLS.', v_tabela;
    END IF;
    IF NOT has_table_privilege('service_role', v_tabela, 'SELECT')
       OR NOT has_table_privilege('service_role', v_tabela, 'INSERT')
       OR NOT has_table_privilege('service_role', v_tabela, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_tabela, 'DELETE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: service_role sem SELECT/INSERT/UPDATE/DELETE em % — revise antes de aplicar.', v_tabela;
    END IF;
  END LOOP;
END $preflight_20261218000100$;

REVOKE ALL ON TABLE public.app_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.app_settings FROM anon;
REVOKE ALL ON TABLE public.app_settings FROM authenticated;

REVOKE ALL ON TABLE public.otp_verifications FROM PUBLIC;
REVOKE ALL ON TABLE public.otp_verifications FROM anon;
REVOKE ALL ON TABLE public.otp_verifications FROM authenticated;

-- CONFERÊNCIA no instante do apply: aborta se anon/authenticated ainda alcançam
-- as tabelas por qualquer caminho, ou se service_role perdeu o que usa.
DO $conferencia_20261218000100$
DECLARE
  v_tabela text;
  v_papel text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['public.app_settings', 'public.otp_verifications'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(v_tabela)) THEN
      RAISE EXCEPTION 'conferencia 20261218000100: RLS desligada em %', v_tabela;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c
                 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                WHERE c.oid = to_regclass(v_tabela) AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia 20261218000100: % ainda tem privilegio para PUBLIC', v_tabela;
    END IF;
    FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(v_papel, v_tabela, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
         OR has_any_column_privilege(v_papel, v_tabela, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'conferencia 20261218000100: % ainda alcanca %', v_papel, v_tabela;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_attribute a
                 CROSS JOIN LATERAL aclexplode(a.attacl) g
                WHERE a.attrelid = to_regclass(v_tabela) AND a.attacl IS NOT NULL
                  AND a.attnum > 0 AND NOT a.attisdropped AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia 20261218000100: % tem coluna com permissao para PUBLIC', v_tabela;
    END IF;
    IF NOT has_table_privilege('service_role', v_tabela, 'SELECT')
       OR NOT has_table_privilege('service_role', v_tabela, 'INSERT')
       OR NOT has_table_privilege('service_role', v_tabela, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_tabela, 'DELETE') THEN
      RAISE EXCEPTION 'conferencia 20261218000100: service_role perdeu SELECT/INSERT/UPDATE/DELETE em % -- o servidor pararia', v_tabela;
    END IF;
  END LOOP;

  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_has_role(v_papel, 'pg_read_all_data', 'MEMBER')
       OR pg_has_role(v_papel, 'pg_write_all_data', 'MEMBER') THEN
      RAISE EXCEPTION 'conferencia 20261218000100: % e membro de pg_read_all_data ou pg_write_all_data', v_papel;
    END IF;
  END LOOP;
END $conferencia_20261218000100$;
