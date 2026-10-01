-- ============================================================================
-- Migration 20261186000000 — o balcão sabe se o PIX está pronto
-- (prontidão do PIX com QR da tela Vender; edge cobrar-pix-no-balcao, acao
-- "prontidao")
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- A tela Vender oferecia o PIX com QR só pela ficha da loja. "Gerar PIX"
-- chama `iniciar_venda_presencial_pix` (cria a venda e RESERVA o estoque por
-- 30 min) e só depois a edge. Numa loja sem as migrations 20261184000000 /
-- 20261185000000, ou com elas pela metade, a opção aparecia disponível e
-- falhava na mão do caixa — e, se a falha vinha depois da venda criada, o
-- estoque ficava preso até a varredura.
--
-- 2. O QUE ESTA MIGRATION FAZ
--
-- Cria `public.pix_do_balcao_pronto() RETURNS boolean`, LANGUAGE sql, STABLE,
-- SECURITY INVOKER, `search_path = pg_catalog, pg_temp`. Só LÊ o catálogo e
-- devolve true SOMENTE se TODAS as peças estão no lugar:
--   (1) `iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)`
--       existe e authenticated a executa (é como a tela do lojista a chama);
--   (2) `anular_venda_presencial(uuid,text)` existe e authenticated a executa;
--   (3) os gatilhos `tr_venda_do_balcao_paga_e_entregue` e
--       `tr_venda_do_balcao_guarda_o_status` existem em
--       public.marketplace_orders e disparam em sessão normal (tgenabled 'O'
--       ou 'A'; 'R' só dispara em réplica e 'D' está desligado).
-- O EXECUTE é conferido pelo OID (`to_regprocedure`): com a assinatura em
-- texto, função ausente LANÇA erro em vez de responder falso. OID nulo deixa
-- o resultado nulo, e o COALESCE externo o transforma em false — a função
-- nunca devolve NULL.
--
-- 3. QUEM EXECUTA: só service_role (a edge, depois de conferir o admin).
-- anon e authenticated não a enxergam.
--
-- 4. DADOS EXISTENTES: nenhum. Não lê nem grava linha de tabela; não recria
-- nem altera nada das 20261184000000/20261185000000.
--
-- 5. DEPENDÊNCIAS: nenhuma para APLICAR (a função responde false enquanto
-- faltar peça). Para responder true, aplicar depois das 84 e 85.
--
-- 6. COMO APLICAR, VERIFICAR E DESFAZER
--
-- Pelo `aplicar-migrations.yml`, só pelo dono. Sem BEGIN/COMMIT neste arquivo.
-- FICHA: SELECT provolatile, prosecdef, proconfig FROM pg_proc WHERE proname = 'pix_do_balcao_pronto';
--   -- esperado: s, false, {"search_path=pg_catalog, pg_temp"}
-- SELECT has_function_privilege('anon', 'public.pix_do_balcao_pronto()', 'EXECUTE'),
--        has_function_privilege('authenticated', 'public.pix_do_balcao_pronto()', 'EXECUTE'),
--        has_function_privilege('service_role', 'public.pix_do_balcao_pronto()', 'EXECUTE');
--   -- esperado: false, false, true
-- ROLLBACK MANUAL: rollback-manual-20261186000000_o_balcao_sabe_se_o_pix_esta_pronto.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pix_do_balcao_pronto()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT COALESCE(
    to_regprocedure('public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)') IS NOT NULL
    AND to_regprocedure('public.anular_venda_presencial(uuid,text)') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)'), 'EXECUTE')
    AND has_function_privilege('authenticated', to_regprocedure('public.anular_venda_presencial(uuid,text)'), 'EXECUTE')
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = to_regclass('public.marketplace_orders')
         AND t.tgname = 'tr_venda_do_balcao_paga_e_entregue'
         AND NOT t.tgisinternal
         AND t.tgenabled IN ('O', 'A')
    )
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = to_regclass('public.marketplace_orders')
         AND t.tgname = 'tr_venda_do_balcao_guarda_o_status'
         AND NOT t.tgisinternal
         AND t.tgenabled IN ('O', 'A')
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.pix_do_balcao_pronto() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pix_do_balcao_pronto() TO service_role;

COMMENT ON FUNCTION public.pix_do_balcao_pronto() IS 'Prontidão do PIX com QR do balcão (20261186000000): true só se iniciar_venda_presencial_pix e anular_venda_presencial existem e authenticated as executa, e os gatilhos tr_venda_do_balcao_paga_e_entregue/tr_venda_do_balcao_guarda_o_status disparam em sessão normal. Só lê o catálogo; executável só por service_role (edge cobrar-pix-no-balcao, acao prontidao).';
