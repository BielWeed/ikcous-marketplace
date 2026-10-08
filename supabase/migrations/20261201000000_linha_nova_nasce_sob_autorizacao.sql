-- LINHA NOVA NASCE SOB AUTORIZAÇÃO (dinheiro: ledger de estorno; Lote A,
-- 04/10/2026 — roteiro de publicação revisado pelo Opus, cenário D1).
--
-- O QUE FAZ: só isto — `order_refunds.criada_sob_autorizacao` passa a ter
-- DEFAULT true. Linha que nascer DEPOIS deste arquivo é marcada como "nasceu
-- com o executor novo no ar": para ela, `tentativas > 1` sozinho NÃO a torna
-- incerta (critério exato no cabeçalho da 20261196000000 e em
-- `linhaPodeJaTerChegadoAoMp`, _shared/estorno.ts) — só o carimbo
-- `post_autorizado_em` ou o id do MP. Nenhuma linha existente é tocada (o
-- DEFAULT vale só para INSERT futuro; sem backfill).
--
-- POR QUE ESTÁ SEPARADO DA 20261196000000: com o DEFAULT na 96, a janela de
-- publicação abria o defeito D1 — a edge ANTIGA ainda no ar marca a linha e
-- manda o POST SEM carimbo (ela não conhece `autorizar_post_do_estorno`); a
-- linha, nascida true, parece "nunca enviada", e o cron NOVO a recusa,
-- liberando a reserva com dinheiro já saído. Só com a 96 no ar, a linha nova
-- nasce NULL (legado) e o critério legado (`tentativas > 1` = incerta) a
-- segura (cenário C4).
--
-- ORDEM DE PUBLICAÇÃO (obrigatória, por loja):
--   1. 20261192000000 e 20261196000000 no banco;
--   2. as edges `estornar-pagamento` e `reconciliar-pagamentos` NOVAS no ar
--      (e a `webhook-mercadopago` nova);
--   3. ESCOAMENTO: no mínimo 15 minutos depois do deploy das edges E
--      uma execução completa do cron `reconciliar-pagamentos` já com a edge
--      nova — nenhuma execução da edge antiga pode estar em voo;
--   4. só então ESTE arquivo.
-- Este arquivo só pode ir para a loja DEPOIS de as edges `estornar-pagamento` e `reconciliar-pagamentos` NOVAS
-- estarem no ar e de o escoamento acima ter passado. Antes disso ele reabre
-- o D1.
--
-- ORDEM DE DESFAZER: 20261201000000 -> edges -> 20261196000000 -> 20261192000000
-- (o rollback da 96 RECUSA com o DEFAULT true ainda no ar).
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT — o `DO $preflight_20261201$` abaixo é o
-- PRIMEIRO comando, roda na MESMA transação do restante e não escreve nada.
-- Recusa se:
--   * a coluna `criada_sob_autorizacao` não existe ou não é boolean (a 96
--     não foi aplicada);
--   * ela já tem default diferente de nenhum/true;
--   * `autorizar_post_do_estorno(uuid, numeric)` está ausente, ou o corpo
--     dela não é o da 96 — md5(replace(prosrc, E'\r', '')) =
--     e128f7ad54ebc82c97b97af4aa7baa08 (régua da 97/99; medido no banco e no
--     texto do arquivo em 04/10/2026). Sem o carimbo dessa função, o DEFAULT
--     true marcaria como "nunca enviada" uma linha cujo POST saiu.
--
-- IDEMPOTÊNCIA: SET DEFAULT true reaplicado não muda nada (o preflight aceita
-- o default true que este próprio arquivo pôs).
--
-- DADOS EXISTENTES: nada é reescrito; linhas antigas e as nascidas só com a
-- 96 continuam NULL (legado) para sempre.
--
-- PRIVILÉGIOS: nenhum objeto novo, nenhum GRANT/REVOKE.
--
-- COMO APLICAR: pelo workflow `aplicar-migrations.yml`, `migracoes =
-- 20261201000000_linha_nova_nasce_sob_autorizacao.sql`. Sem `BEGIN`/`COMMIT`
-- de nível superior (regra da casa); o apply é uma transação implícita.
--
-- PROVA VIVA: prova (y) de tests/banco/contestacao-viva.cjs (rpc-ci, job do
-- dinheiro). Prova de texto: tests/migration_linha_nova_nasce_sob_autorizacao_test.ts.
--
-- ROLLBACK MANUAL: rollback-manual-20261201000000_linha_nova_nasce_sob_autorizacao.sql
-- (DROP DEFAULT; seguro a qualquer momento: linha nova volta a nascer NULL,
-- a regra conservadora).

DO $preflight_20261201$
DECLARE
  v_tipo text;
  v_def text;
  v_hash text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_tipo, v_def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.order_refunds'::regclass
     AND a.attname = 'criada_sob_autorizacao'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao ausente ou com tipo % (esperado boolean, aceitando NULL) — aplique a 20261196000000 antes.', v_tipo;
  END IF;
  IF v_def IS NOT NULL AND v_def IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao com default % (esperado nenhum ou true) — revise antes de aplicar.', v_def;
  END IF;

  IF to_regprocedure('public.autorizar_post_do_estorno(uuid, numeric)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.autorizar_post_do_estorno(uuid, numeric) ausente — aplique a 20261196000000 antes.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.autorizar_post_do_estorno(uuid, numeric)');
  IF v_hash IS DISTINCT FROM 'e128f7ad54ebc82c97b97af4aa7baa08' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.autorizar_post_do_estorno(uuid, numeric) não é o corpo da 20261196000000 (md5 %) — sem o carimbo post_autorizado_em, o DEFAULT true marcaria como nunca enviada uma linha cujo POST saiu.', v_hash;
  END IF;
END $preflight_20261201$;

ALTER TABLE public.order_refunds
  ALTER COLUMN criada_sob_autorizacao SET DEFAULT true;
