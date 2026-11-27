-- ROLLBACK COMUM da 20261630000000_a_loja_ja_suspensa_tambem_pausa.sql: a marca volta a ser a da 20261600000000.
-- Recria public.marcar_suspensa_desde() com o texto da 20261600000000 BYTE A BYTE (md5 162120d86a79c72a8b3622d2777dfa8d), com o mesmo REVOKE e o mesmo comentario.
-- O gatilho tr_assinatura_marca_suspensa_desde fica (aponta para a mesma funcao, pelo OID). A tabela pausa_de_vendas e as linhas dela FICAM como estao: os dias que
-- a marca desta migration ja gravou para a loja que estava suspensa antes da 1600 continuam la (a marca da 1600 os mantem enquanto a loja segue suspensa e os apaga
-- quando ela sai). Nenhuma linha e' lida ou alterada por este arquivo. Um degrau so: a migration nao criou tabela nem coluna, nada de destrutivo; sem confirmacao.
-- COM ELE: a loja que segue suspensa sem dia volta a nunca ganhar o dia (o defeito que a 1630 consertou).
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se a marca estiver ausente, com sobrecarga ou com corpo que nao seja o desta migration nem o da
-- 20261600000000 (alguem a redefiniu depois: devolver o corpo velho apagaria uma redefinicao que ninguem revisou). Estados aceitos: a migration no ar, ou ja desfeita
-- (rodar de novo e' no-op). Conferencia final: o corpo, os atributos e o EXECUTE da marca sao os da 20261600000000.
-- ORDEM: desfazer ESTA antes do rollback da 20261600000000 (o pre-voo dele recusa a marca com o corpo desta).
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo - regra da casa.
-- Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261630000000$
DECLARE
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'marcar_suspensa_desde') <> 1
     OR to_regprocedure('public.marcar_suspensa_desde()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.marcar_suspensa_desde() ausente, com sobrecarga ou com outra assinatura - revise antes de desfazer.';
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_suspensa_desde()');
  IF v_hash IS NULL OR v_hash NOT IN ('974c4efadc6876427ffe740312c7619b', '162120d86a79c72a8b3622d2777dfa8d') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.marcar_suspensa_desde() (hash %) nao e o da 20261630000000 nem o da 20261600000000 - uma redefinicao posterior esta no ar; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261630000000$;

-- A marca da 20261600000000, letra por letra (o mesmo texto do arquivo dela).
CREATE OR REPLACE FUNCTION public.marcar_suspensa_desde()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Grava o dia quando o status ENTRA em suspensa; mantem enquanto segue suspensa (o reenvio das 03:00 nao recomeca a contagem); apaga quando sai.
  -- So mexe em suspensa_desde: vale_pela_assinatura e ligada_em (a chave que liga a pausa) ficam como estao.
  -- NUNCA derruba a porta do app de gestao: se a marca falhar, a gravacao do cartao segue (e com ela o "pagou, reabre"); a falha vira WARNING.
  BEGIN
    IF NEW.status = 'suspensa' THEN
      IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'suspensa' THEN
        INSERT INTO public.pausa_de_vendas AS p (id, suspensa_desde)
        VALUES (1, (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        ON CONFLICT (id) DO UPDATE SET suspensa_desde = EXCLUDED.suspensa_desde;
      END IF;
    ELSE
      UPDATE public.pausa_de_vendas SET suspensa_desde = NULL WHERE id = 1 AND suspensa_desde IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'marcar_suspensa_desde: a marca do dia da suspensa falhou (% %); o cartao foi gravado sem ela', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_suspensa_desde() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.marcar_suspensa_desde() IS 'Gatilho de assinatura_da_loja: grava pausa_de_vendas.suspensa_desde (dia de Sao Paulo) quando o status entra em suspensa, mantem enquanto segue suspensa e apaga quando sai. Nunca levanta erro (a porta do app de gestao grava mesmo se a marca falhar).';

DO $conferencia_rollback_20261630000000$
DECLARE
  v_oid oid := to_regprocedure('public.marcar_suspensa_desde()');
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'marcar_suspensa_desde') <> 1
     OR (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM '162120d86a79c72a8b3622d2777dfa8d' THEN
    RAISE EXCEPTION 'conferencia rollback 20261630000000: a marca nao voltou ao corpo da 20261600000000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND NOT p.proretset AND pg_get_function_result(p.oid) = 'trigger'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'conferencia rollback 20261630000000: os atributos da marca nao sao os da 20261600000000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261630000000: o EXECUTE da marca nao e o da 20261600000000 (de ninguem de aplicacao)';
  END IF;
END $conferencia_rollback_20261630000000$;
