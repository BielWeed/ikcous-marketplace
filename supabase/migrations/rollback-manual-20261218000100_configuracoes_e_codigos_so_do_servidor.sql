-- ============================================================================
-- Rollback manual — as configurações da loja e os códigos de verificação só
-- são lidos e gravados pelo servidor (20261218000100)
-- ============================================================================
-- Devolve o estado anterior desta loja, antes da migration: anon e
-- authenticated com TODOS os privilégios de tabela em
-- `app_settings` e `otp_verifications` (DELETE, INSERT, MAINTAIN, REFERENCES,
-- SELECT, TRIGGER, TRUNCATE, UPDATE; grantor postgres; nenhuma permissão de
-- coluna própria). PUBLIC não tinha nada e continua sem nada.
--
-- NÃO SE APLICA NA IKCOUS (nem em loja nenhuma que já estava fechada antes da
-- migration): lá anon e authenticated nunca tiveram privilégio nessas tabelas,
-- e este arquivo abriria o que nunca esteve aberto. Para a IKCOUS, desfazer a
-- 20261218000100 é não fazer nada.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se uma das tabelas não existir ou
-- estiver sem RLS — os privilégios voltam a valer só atrás da política de RLS
-- que já existe. Rodar duas vezes deixa o mesmo estado (GRANT).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261218000100$
DECLARE
  v_tabela text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['public.app_settings', 'public.otp_verifications'] LOOP
    IF to_regclass(v_tabela) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_tabela;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(v_tabela)) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está sem RLS — não devolva privilégio sem a política na frente.', v_tabela;
    END IF;
  END LOOP;
END $preflight_rollback_20261218000100$;

GRANT ALL ON TABLE public.app_settings TO anon;
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.otp_verifications TO anon;
GRANT ALL ON TABLE public.otp_verifications TO authenticated;

DO $conferencia_rollback_20261218000100$
DECLARE
  v_tabela text;
  v_papel text;
  v_priv text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['public.app_settings', 'public.otp_verifications'] LOOP
    FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        IF NOT has_table_privilege(v_papel, v_tabela, v_priv) THEN
          RAISE EXCEPTION 'conferencia rollback 20261218000100: % sem % em %', v_papel, v_priv, v_tabela;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $conferencia_rollback_20261218000100$;
