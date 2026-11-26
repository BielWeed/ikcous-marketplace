-- ============================================================================
-- Rollback manual — a caderneta da frota (20261141000000)
-- ============================================================================
-- Reverter PRIMEIRO o porteiro (T3, `resolverConexao`/`middleware.ts`) e
-- `frota-estado.cjs` (que passam a depender desta caderneta); só depois
-- executar este arquivo. Na ordem contrária, o porteiro cai no caminho (b)
-- do brief (ambiente do próprio projeto Vercel, sem consultar a caderneta —
-- funciona igual, só não sabe mais listar a frota inteira) e o
-- `frota-estado.cjs` responde `CADASTRO NAO MEDIDO` em vez de listar as
-- lojas. Executar sob transação externa (db-apply ou psql -1).
--
-- Remove só o que esta migration criou: `resolver_loja`, `frota_lojas`,
-- `frota_segredo`. Nenhuma outra tabela é tocada. `IF EXISTS` em todos os
-- três `DROP` permite repetir este rollback sem erro caso já tenham sido
-- removidos. A função é derrubada ANTES das tabelas (nenhuma dependência
-- rígida de fato — `RETURNS TABLE` não gera dependência de `pg_depend`
-- contra as tabelas nomeadas dentro do corpo — mas a ordem evita qualquer
-- erro de objeto pendente).
--
-- DADOS: se `frota_lojas`/`frota_segredo` já tiverem sido semeadas pela hub
-- (fora desta migration), este rollback APAGA essas linhas junto com a
-- tabela — não há como derrubar a tabela e preservar o dado. Confirmar que
-- não há outra loja/segredo de produção precisando sobreviver antes de
-- rodar isto de verdade.
--
-- CADERNETA SEMEADA (26/11/2026, plano caderneta-fora-do-dekxab, T3): o
-- banco da IKCOUS passa a guardar a caderneta de PRODUÇÃO da frota (o
-- porteiro de todas as lojas lê dela). O bloco abaixo recusa
-- (CADERNETA_SEMEADA) sem apagar nada se frota_lojas, frota_segredo ou
-- frota_estado_historico tiver qualquer linha; nos bancos das lojas as três
-- ficam vazias e o rollback apaga como antes. Apagar a caderneta de verdade
-- é só com o dono, com a confirmação na MESMA transação:
--   SET LOCAL ikcous.apagar_caderneta = 'sim';
-- (SET sem LOCAL ficaria na sessão e confirmaria uma chamada futura que
-- ninguém pediu). A trava de escrita (SHARE) vale até o fim da transação:
-- ninguém grava linha entre a conferência e o DROP.
-- ============================================================================

DO $caderneta_semeada$
DECLARE
  v_tabela text;
  v_tem_linha boolean;
BEGIN
  IF COALESCE(current_setting('ikcous.apagar_caderneta', true), '') = 'sim' THEN
    RETURN;
  END IF;
  FOREACH v_tabela IN ARRAY ARRAY['frota_lojas', 'frota_segredo', 'frota_estado_historico'] LOOP
    IF to_regclass('public.' || v_tabela) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN SHARE MODE', v_tabela);
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_tabela) INTO v_tem_linha;
      IF v_tem_linha THEN
        RAISE EXCEPTION 'CADERNETA_SEMEADA: public.% tem linha - este banco guarda a caderneta da frota e apaga-la tira todas as lojas do ar. Nada foi apagado. So com o dono: SET LOCAL ikcous.apagar_caderneta = ''sim'' na mesma transacao.', v_tabela;
      END IF;
    END IF;
  END LOOP;
END $caderneta_semeada$;

DROP FUNCTION IF EXISTS public.resolver_loja(text, text);
DROP TABLE IF EXISTS public.frota_segredo;
DROP TABLE IF EXISTS public.frota_lojas;
