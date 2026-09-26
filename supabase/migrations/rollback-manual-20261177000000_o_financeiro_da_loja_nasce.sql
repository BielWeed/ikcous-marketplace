-- ============================================================================
-- Rollback manual — o financeiro da loja nasce (20261177000000)
-- ============================================================================
-- Reverter PRIMEIRO o front (tela admin-financeiro e os números do Início);
-- só depois executar este arquivo. psql -1 -f — nunca pelo db-apply.
--
-- Remove as RPCs, os ajudantes internos e as cinco tabelas. Nenhuma fonte de
-- dinheiro é tocada: pedidos, estornos e devoluções continuam onde sempre
-- estiveram (o Financeiro só os lia).
--
-- DADOS: APAGA os lançamentos manuais, contas, categorias e sessões de caixa
-- do lojista, e a linha de assinatura que o projeto de cobrança gravou.
-- Exportar antes (fin_extrato por período) se houver uso real.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fin_caixa_historico(integer);
DROP FUNCTION IF EXISTS public.fin_caixa_fechar(numeric, text);
DROP FUNCTION IF EXISTS public.fin_caixa_movimentar(text, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.fin_caixa_abrir(numeric, uuid);
DROP FUNCTION IF EXISTS public.fin_caixa_atual();
DROP FUNCTION IF EXISTS public.fin_lancamento_cancelar(uuid, text);
DROP FUNCTION IF EXISTS public.fin_lancamento_baixar(uuid, date, uuid);
DROP FUNCTION IF EXISTS public.fin_lancamento_salvar(jsonb);
DROP FUNCTION IF EXISTS public.fin_categoria_salvar(jsonb);
DROP FUNCTION IF EXISTS public.fin_conta_salvar(jsonb);
DROP FUNCTION IF EXISTS public.assinatura_da_loja_ler();
DROP FUNCTION IF EXISTS public.fin_dre(date, date);
DROP FUNCTION IF EXISTS public.fin_resumo(date, date);
DROP FUNCTION IF EXISTS public.fin_previstos(text);
DROP FUNCTION IF EXISTS public.fin_extrato(date, date, uuid);
DROP FUNCTION IF EXISTS public.fin_categorias_listar();
DROP FUNCTION IF EXISTS public.fin_contas_listar();

DROP FUNCTION IF EXISTS public.fin__caixa_calculo(uuid);
DROP FUNCTION IF EXISTS public.fin__saldos();
DROP FUNCTION IF EXISTS public.fin__movimentos(date, date);
DROP FUNCTION IF EXISTS public.fin__forma_do_pedido(text, text);
DROP FUNCTION IF EXISTS public.fin__conta_da_forma(text);
DROP FUNCTION IF EXISTS public.fin__dia(timestamptz);
DROP FUNCTION IF EXISTS public.fin__hoje();

DROP TABLE IF EXISTS public.fin_lancamentos;
DROP TABLE IF EXISTS public.fin_caixa_sessoes;
DROP TABLE IF EXISTS public.fin_categorias;
DROP TABLE IF EXISTS public.fin_contas;
DROP TABLE IF EXISTS public.assinatura_da_loja;
