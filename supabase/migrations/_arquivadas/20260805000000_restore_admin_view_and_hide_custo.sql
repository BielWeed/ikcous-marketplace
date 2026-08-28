-- =============================================================================
-- Recria vw_produtos_admin e tira `custo` do alcance do cliente (BANCO-010, #119)
-- =============================================================================
--
-- ESTADO MEDIDO NO BANCO EM 05/08/2026, não deduzido do repositório:
--
--   produtos: RLS ligado, relforcerowsecurity = false
--   produtos_select_policy [SELECT] roles={public}
--     USING ((ativo = true) OR (auth.role() = 'authenticated' AND is_admin()))
--   Privilégio de TABELA: authenticated tem SELECT (todas as colunas, portanto)
--   anon NÃO tem SELECT em produtos ('permission denied for table produtos')
--   Sonda real: cliente comum leu 18 linhas com custo; admin leu 22.
--   vw_produtos_admin: NÃO EXISTE em nenhum schema.
--
-- PROBLEMA 1 — o vazamento
--   Não é privilégio de coluna mal posto: é privilégio de TABELA. `authenticated`
--   tem SELECT em produtos, e a policy libera a linha por `ativo = true`. Logo,
--   qualquer pessoa que crie conta lê a margem de todo produto ativo com uma
--   chamada PostgREST.
--
--   A issue diz que o anônimo é protegido por passar pela vw_produtos_public,
--   que omite a coluna. Isso está errado: ele é barrado antes disso, por não ter
--   SELECT na tabela. O efeito final é o mesmo, a causa não.
--
-- PROBLEMA 2 — a porta do admin não existe
--   No Supabase o admin também é o papel `authenticated`. Privilégio de coluna
--   não distingue admin de cliente; só is_admin() distingue. Então qualquer
--   correção por grant tira `custo` dos dois — a menos que o admin tenha outra
--   porta.
--
--   Essa porta tem nome no código: `vw_produtos_admin`, chamada em sete lugares
--   (useProducts.ts:228, :483, :669; StoreContext.tsx:388; useReviews.ts:314;
--   OrderDetail.tsx:880; AdminUserDetailView.tsx:130) e tipada em
--   database.types.ts:1445 — tipos que são GERADOS do banco, ou seja, a view
--   existiu e sumiu. Nenhuma migration deste repositório a cria.
--
--   Consequência já em produção, confirmada pelo Gabriel: cadastrar produto novo
--   dá erro. O insert de useProducts.ts:483 vai nessa view e não tem fallback.
--   A listagem sobrevive porque StoreContext.tsx:398 cai na view pública — e é
--   por isso que ninguém tinha percebido.
--
-- A CORREÇÃO, em duas metades que só funcionam juntas
--   1. Recria vw_produtos_admin com todas as colunas, `custo` incluso, guardada
--      por is_admin(). Ela é dona-executada (sem security_invoker), então roda
--      com os privilégios do dono: não esbarra no grant de coluna abaixo nem no
--      RLS da tabela base. O guarda-corpo passa a ser o WHERE, e o WITH CHECK
--      OPTION estende isso para INSERT e UPDATE.
--   2. Troca o SELECT de tabela por SELECT de colunas, todas menos `custo`.
--
--   Sem a metade 1, a metade 2 cega o admin. Sem a metade 2, a metade 1 só
--   acrescenta uma porta e deixa o vazamento aberto.
--
-- O RISCO PRINCIPAL, e é por isso que existe prova antes de aplicar
--   is_admin() começa com `IF current_setting('role') IN ('postgres',
--   'service_role') THEN RETURN true`. Dentro de uma view executada como dono,
--   não é óbvio se esse GUC continua valendo 'authenticated' ou vira 'postgres'.
--   Se virar 'postgres', o WHERE é sempre verdadeiro e a view vira um vazamento
--   PIOR que o de hoje, aberto a qualquer authenticated. scripts/db-prove-banco-010.cjs
--   mede exatamente isso, e o cenário 4 reprova a migration se acontecer.
--
-- SOBRE O GRANT SER GERADO EM TEMPO DE APLICAÇÃO
--   A lista de colunas sai de information_schema no momento do apply, em vez de
--   estar escrita aqui. Não é elegância: eu não tenho como conferir a lista
--   completa de colunas de produtos a partir do repositório, e escrever de
--   memória uma lista que decide quem lê o quê é como este projeto já se
--   machucou antes. O DO block abaixo não tem esse modo de falhar.
--
--   Contrapartida honesta: coluna nova criada DEPOIS deste apply nasce sem
--   SELECT para `authenticated`, e some da vitrine em silêncio. Quem adicionar
--   coluna em produtos precisa repetir o GRANT. Isso está registrado na issue.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. A porta do admin
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.vw_produtos_admin;

CREATE VIEW public.vw_produtos_admin AS
    SELECT * FROM public.produtos WHERE public.is_admin()
WITH CASCADED CHECK OPTION;

ALTER VIEW public.vw_produtos_admin OWNER TO postgres;

-- Espelha os grants da vw_produtos_public, que é a view irmã: o front escreve
-- por aqui (insert de produto em useProducts.ts:483), não só lê.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vw_produtos_admin TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vw_produtos_admin TO service_role;

COMMENT ON VIEW public.vw_produtos_admin IS
    'Porta do admin para produtos, custo incluso. Guardada por is_admin() no WHERE, '
    'não por GRANT: no Supabase o admin é o mesmo papel authenticated do cliente. '
    'Recriada em 05/08/2026 (BANCO-010, #119) — existia, sumiu do banco sem deixar '
    'migration, e o cadastro de produto ficou quebrado.';

-- ----------------------------------------------------------------------------
-- 2. Tirar custo do alcance do cliente
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_colunas text;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_colunas
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'produtos'
       AND column_name <> 'custo';

    IF v_colunas IS NULL THEN
        RAISE EXCEPTION 'Nao consegui montar a lista de colunas de produtos.';
    END IF;

    -- O SELECT de tabela engloba toda coluna; precisa sair antes do grant por
    -- coluna valer alguma coisa.
    EXECUTE 'REVOKE SELECT ON public.produtos FROM authenticated';
    EXECUTE format('GRANT SELECT (%s) ON public.produtos TO authenticated', v_colunas);

    RAISE NOTICE 'SELECT concedido em % colunas de produtos, custo fora.',
        array_length(string_to_array(v_colunas, ', '), 1);
END $$;
