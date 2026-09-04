-- ============================================================================
-- ROLLBACK MANUAL — 20261090000000 (grants de escrita em produtos e views)
-- ============================================================================
-- ATENÇÃO: este rollback REABRE as portas que a migration fecha —
--   * anon volta a carregar escrita+manutenção na TABELA produtos E na view
--     vw_produtos_admin (a porta que a 20260821000100 esqueceu), com a
--     única fechadura voltando a ser o RLS/check_option (segunda camada);
--   * authenticated volta a ter TRUNCATE/TRIGGER/MAINTAIN;
--   * anon volta a ter TRUNCATE/TRIGGER/MAINTAIN na vw_produtos_public.
-- Só executar se a migration causar dano comprovado, e reaplicar a migration
-- assim que o dano for tratado.
--
-- Estado restaurado: o ACL medido em 04/09 (laudos 0754/0829/0900 e
-- db-inspect-blindagem-141.cjs).
--
-- GUARDA (a pedido da 3ª revisão): este arquivo só faz sentido num banco
-- cujo estado é o PÓS-migration. Num clone nascido DEPOIS dela, rodar isto
-- não restaura nada — CRIA privilégio que nunca existiu lá. A guarda abaixo
-- aborta nesse caso em vez de mentir "restaurado".
-- ============================================================================

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.produtos', 'INSERT')
     OR has_table_privilege('anon', 'public.vw_produtos_admin', 'INSERT') THEN
    RAISE EXCEPTION 'guarda do rollback: anon AINDA tem escrita — este banco nao esta no estado pos-migration 20261090000000; este arquivo criaria privilegio novo em vez de restaurar';
  END IF;
END $$;

-- 1. TABELA produtos ----------------------------------------------------------
GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.produtos TO anon;
GRANT TRUNCATE, TRIGGER, MAINTAIN
  ON public.produtos TO authenticated;

-- 2. VIEW vw_produtos_admin ---------------------------------------------------
GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_admin TO anon;
GRANT TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_admin TO authenticated;

-- 3. VIEW vw_produtos_public --------------------------------------------------
GRANT TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_public TO anon;
GRANT TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_public TO authenticated;

-- Conferência do rollback (deve voltar tudo true):
--   SELECT has_table_privilege('anon','public.produtos','INSERT');             -- true
--   SELECT has_table_privilege('anon','public.vw_produtos_admin','INSERT');    -- true
--   SELECT has_table_privilege('anon','public.vw_produtos_public','TRUNCATE'); -- true
--   SELECT has_table_privilege('authenticated','public.produtos','MAINTAIN');  -- true
