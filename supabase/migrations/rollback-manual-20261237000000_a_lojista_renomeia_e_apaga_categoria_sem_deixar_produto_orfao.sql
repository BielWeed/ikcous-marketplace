-- ============================================================================
-- Rollback manual — a lojista renomeia e apaga categoria sem deixar produto órfão (20261237000000)
-- ============================================================================
-- A migration só CRIA onze funções (as três portas do painel e oito auxiliares privadas) e nenhuma existia antes:
-- desfazer é apagá-las. Nenhuma tabela, coluna, política, gatilho nem linha foi tocada ao aplicar, então não há o
-- que restaurar além disso.
--
-- COM ELE VOLTA O DEFEITO: o painel (que chama renomear_categoria, apagar_categoria_vazia e categorias_com_uso)
-- passa a falhar nessas três chamadas até a migration ser reaplicada — e, sem elas, a lojista volta a só criar categoria.
--
-- DADOS: as trocas de nome que a lojista já fez enquanto as funções valeram FICAM (categoria, produtos, links de
-- banner e lista da política de devolução já estão com o nome novo, de forma consistente). Apagar isso seria desfazer
-- trabalho dela sem pedido.
--
-- Ordem: primeiro as três portas, depois as auxiliares (que elas chamam). DROP IF EXISTS: rodar duas vezes deixa o
-- mesmo estado. Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DROP FUNCTION IF EXISTS public.renomear_categoria(uuid, text);
DROP FUNCTION IF EXISTS public.apagar_categoria_vazia(uuid);
DROP FUNCTION IF EXISTS public.categorias_com_uso();
DROP FUNCTION IF EXISTS public.categoria__usos(uuid);
DROP FUNCTION IF EXISTS public.categoria__mesma(text, text, boolean);
DROP FUNCTION IF EXISTS public.categoria__nome_do_link(text);
DROP FUNCTION IF EXISTS public.categoria__partes_do_link(text);
DROP FUNCTION IF EXISTS public.categoria__url_decodifica(text);
DROP FUNCTION IF EXISTS public.categoria__url_codifica(text);
DROP FUNCTION IF EXISTS public.categoria__slug(text);
DROP FUNCTION IF EXISTS public.categoria__chave(text);

DO $conferencia_rollback_20261237$
DECLARE
  v_restou text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_restou
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'categoria\_\_%' OR p.proname IN ('renomear_categoria', 'apagar_categoria_vazia', 'categorias_com_uso'));
  IF v_restou IS NOT NULL THEN
    RAISE EXCEPTION 'CONFERENCIA_ROLLBACK_20261237: ainda existem: %.', v_restou;
  END IF;
END $conferencia_rollback_20261237$;
