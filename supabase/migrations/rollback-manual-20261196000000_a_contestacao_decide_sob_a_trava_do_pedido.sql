-- ============================================================================
-- Rollback manual — a contestação decide sob a trava do pedido (20261196000000)
-- ============================================================================
-- Desfaz a 20261196000000: apaga as três funções novas
-- (`public.registrar_contestacao_no_ledger`,
-- `public.registrar_estorno_externo_do_mp` e
-- `public.autorizar_post_do_estorno`). Elas NÃO existiam antes
-- desta migration — não há corpo anterior a restaurar. NENHUMA linha de
-- `order_refunds` é tocada, e nenhum default (a 96 não põe nenhum). ORDEM
-- DE DESFAZER: 20261201000000 -> edges -> 20261196000000 -> 20261192000000.
-- Com o DEFAULT true da 20261201000000 ainda no ar este rollback RECUSA: com
-- a edge antiga de volta (que não carimba `post_autorizado_em`), linha nova
-- tem de nascer NULL (legado) — senão uma linha com POST antigo sem carimbo
-- pareceria "nunca enviada" e poderia ser recusada. As colunas `mp_chargeback_case_id`,
-- `mp_chargeback_valor_do_caso`, `post_autorizado_em` e
-- `criada_sob_autorizacao` e a tabela `public.contestacoes_decisao_final`
-- FICAM, de propósito: apagá-las perderia o vínculo, o valor confirmado, o
-- histórico das decisões finais de casos já registrados e o carimbo de POST
-- autorizado (dado de dinheiro) — se um dia for preciso, é decisão do dono,
-- com o SQL mostrado.
--
-- Depois do rollback a edge NOVA do webhook falha ao registrar contestação
-- (função ausente -> 500, o MP reenvia; nada é gravado pela metade).
-- Reverter a edge para a versão anterior ANTES deste rollback. O mesmo
-- vale para as edges estornar-pagamento e reconciliar-pagamentos: as novas
-- pedem autorizar_post_do_estorno antes de todo POST e, sem ela, nenhuma
-- devolução sai (falha fechada) até a edge anterior voltar.
--
-- NO WINDOWS: rode `$env:PGCLIENTENCODING='UTF8'` no PowerShell ANTES do psql.
--
-- PRÉ-VOO: recusa com `B1_BASELINE_DIVERGENT` se uma das funções não existir
-- com a assinatura desta migration — nada a desfazer, ou outra coisa está no
-- ar. Mesma transação do restante.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261196$
BEGIN
  IF to_regprocedure('public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.registrar_contestacao_no_ledger(...) ausente — nada a desfazer; revise antes de reverter.';
  END IF;
  IF to_regprocedure('public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.registrar_estorno_externo_do_mp(...) ausente — nada a desfazer; revise antes de reverter.';
  END IF;
  IF to_regprocedure('public.autorizar_post_do_estorno(uuid, numeric)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.autorizar_post_do_estorno(...) ausente — nada a desfazer; revise antes de reverter.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.order_refunds'::regclass
       AND attname = 'criada_sob_autorizacao' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao ausente — revise antes de reverter.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
      JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.order_refunds'::regclass
       AND a.attname = 'criada_sob_autorizacao' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao ainda tem DEFAULT true — desfaça a 20261201000000 antes (ordem: 201 -> edges -> 96 -> 92).';
  END IF;
END $preflight_rollback_20261196$;

DROP FUNCTION public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer);
DROP FUNCTION public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text);
DROP FUNCTION public.autorizar_post_do_estorno(uuid, numeric);
