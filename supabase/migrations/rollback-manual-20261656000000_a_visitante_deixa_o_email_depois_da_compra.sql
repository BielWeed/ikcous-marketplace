-- ============================================================================
-- Rollback manual — a visitante deixa o e-mail depois da compra (20261656000000)
-- ============================================================================
-- Tira as DUAS funções que a 20261656000000 criou (DROP FUNCTION só delas): public.informar_email_da_visitante(uuid, text) (md5
-- 4ab021c0ff86fbecf36e4c4702a04398) e public.reivindicar_comprovante_da_visitante(uuid) (md5 37c9cd2bd0d16c466bb824d0f3a2887c).
-- Nenhuma função existente foi mudada por ela, então não há corpo antigo a devolver.
--
-- NÃO APAGA NENHUMA LINHA: os e-mails que as visitantes já deixaram continuam em customer_data.email (é o que a pessoa digitou; o
-- "Acompanhar pedido" segue achando o pedido por eles) e a marca confirmation_email_sent_at dos comprovantes já enviados fica.
--
-- COM ELE VOLTA O DEFEITO: a tela "Pedido recebido!" nova recebe PGRST202/42883 e diz que não deu para guardar o e-mail; a edge
-- nova responde envio_falhou para a visitante. Desfaça o front e a edge antes, ou junto.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se alguma das duas existir com outro corpo ou com sobrecarga (não é desta). Repetir o
-- rollback é no-op. O pós-voo recusa se alguma ficou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste
-- arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261656000000$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('informar_email_da_visitante', 'public.informar_email_da_visitante(uuid,text)', '4ab021c0ff86fbecf36e4c4702a04398'),
        ('reivindicar_comprovante_da_visitante', 'public.reivindicar_comprovante_da_visitante(uuid)', '37c9cd2bd0d16c466bb824d0f3a2887c')
      ) AS esperado(nome, assinatura, hash_desta)
  LOOP
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) > 1
       OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) = 1
          AND to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % existe com outra assinatura ou com sobrecarga (nao e desta); revise antes de desfazer.', r.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = to_regprocedure(r.assinatura);
    IF v_hash IS NOT NULL AND v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo da 20261656000000; revise antes de desfazer.', r.assinatura, v_hash;
    END IF;
  END LOOP;
END $preflight_rollback_20261656000000$;

DROP FUNCTION IF EXISTS public.informar_email_da_visitante(uuid, text);
DROP FUNCTION IF EXISTS public.reivindicar_comprovante_da_visitante(uuid);

DO $posvoo_rollback_20261656000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('informar_email_da_visitante', 'reivindicar_comprovante_da_visitante')) THEN
    RAISE EXCEPTION 'B2_POSTFLIGHT_FAILED: uma das funcoes da 20261656000000 ficou depois do rollback.';
  END IF;
END $posvoo_rollback_20261656000000$;

NOTIFY pgrst, 'reload schema';
