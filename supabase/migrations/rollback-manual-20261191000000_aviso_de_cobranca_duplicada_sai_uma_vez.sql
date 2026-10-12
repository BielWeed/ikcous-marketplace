-- ============================================================================
-- Rollback manual — o aviso de cobrança duplicada sai uma vez (20261191000000)
-- ============================================================================
-- Desfaz a 20261191000000 inteira, nesta ordem:
--   1. apaga `public.reservar_aviso_ao_lojista(text)`,
--      `public.confirmar_aviso_ao_lojista(text)` e
--      `public.liberar_aviso_ao_lojista(text)`;
--   2. apaga `public.avisos_ao_lojista` — SÓ chaves de aviso
--      (`cartao_divergente:<pedido>:<order do MP>`), o horário da reserva e
--      se foi entregue; nenhum dado de dinheiro, de pedido ou de cliente se
--      perde.
-- Nenhum objeto anterior é tocado: os quatro foram criados pela 20261191.
--
-- NO WINDOWS: rode `$env:PGCLIENTENCODING='UTF8'` no PowerShell ANTES do psql.
-- Sem isso, o psql num console com a saída redirecionada (ex.: para NUL) usa
-- WIN1252 e o texto acentuado do arquivo chega corrompido ao servidor (provado
-- na revisão: corpos acentuados gravados corrompidos).
--
-- Depois do rollback o defeito volta: o push "Cobrança de cartão duplicada?"
-- sai a cada entrega do MP. Se a edge `webhook-mercadopago` nova estiver
-- publicada, ela recebe erro da reserva e avisa a cada entrega (falha aberta,
-- como antes da 20261191: o push que não chega a ninguém não se repete nesta
-- entrega) e loga o erro — reverta a edge junto para calar o log.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261191$` recusa com
-- `B1_BASELINE_DIVERGENT` se qualquer uma das três RPCs vivas não for a desta
-- migration (única, assinatura `(text)`, md5 de `replace(prosrc, E'\r', '')`
-- listado abaixo) ou se a tabela não tiver a forma dela: apagar por cima de
-- uma redefinição POSTERIOR apagaria a dela em silêncio, e desfazer duas
-- vezes não tem o que desfazer. Mesma transação do restante: recusa = nada
-- apagado.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261191$
DECLARE
  v_colunas text;
  v_nome text;
  v_hash text;
BEGIN
  FOR v_nome, v_hash IN
    SELECT f.nome, f.hash FROM (VALUES
      ('reservar_aviso_ao_lojista', '1aed7ca9e2c55d1ea61e9773367faf06'),
      ('confirmar_aviso_ao_lojista', '55de4b72c2b48ab960313961c56125fd'),
      ('liberar_aviso_ao_lojista', 'd505bca7be99fc5e74a76a47ccd2b796')
    ) AS f(nome, hash)
  LOOP
    IF (SELECT count(*) FROM pg_proc
         WHERE proname = v_nome
           AND pronamespace = 'public'::regnamespace) <> 1
       OR (SELECT md5(replace(prosrc, E'\r', ''))
             FROM pg_proc
            WHERE oid = to_regprocedure('public.' || v_nome || '(text)'))
          IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% ausente ou não é a da 20261191000000 — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', v_nome;
    END IF;
  END LOOP;

  IF to_regclass('public.avisos_ao_lojista') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.avisos_ao_lojista ausente — nada a desfazer; revise antes de reverter.';
  END IF;

  SELECT string_agg(
           a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
           ', ' ORDER BY a.attnum)
    INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = 'public.avisos_ao_lojista'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_colunas IS DISTINCT FROM 'chave text NOT NULL, reservado_em timestamp with time zone NOT NULL, enviado boolean NOT NULL' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.avisos_ao_lojista não tem a forma da 20261191000000 (colunas: %) — revise antes de reverter.', v_colunas;
  END IF;
END $preflight_rollback_20261191$;

DROP FUNCTION public.reservar_aviso_ao_lojista(text);
DROP FUNCTION public.confirmar_aviso_ao_lojista(text);
DROP FUNCTION public.liberar_aviso_ao_lojista(text);
DROP TABLE public.avisos_ao_lojista;
