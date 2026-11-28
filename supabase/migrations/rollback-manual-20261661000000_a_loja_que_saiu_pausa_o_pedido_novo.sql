-- ROLLBACK COMUM da 20261661000000_a_loja_que_saiu_pausa_o_pedido_novo.sql: o motivo volta a ser o da 20261600000000.
-- Recria public.motivo_da_loja_nao_aceitar_pedido() com o texto da 20261600000000 BYTE A BYTE (md5 bfe365fb64ad8d2bb9c06efca304375c), com o mesmo REVOKE e o mesmo comentario.
-- A fechadura a_loja_aceita_pedido_novo e o gatilho tr_a_loja_aceita_pedido_novo ficam (chamam o motivo pelo nome). A tabela pausa_de_vendas e as linhas
-- dela FICAM como estao. Nenhuma linha e' lida ou alterada por este arquivo. Um degrau so: a migration nao criou tabela nem coluna; sem confirmacao.
-- COM ELE: a loja cancelada com a pausa ligada volta a aceitar pedido novo pela vitrine no proximo pedido (o defeito que a 1661 consertou).
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se o motivo estiver ausente, com sobrecarga ou com corpo que nao seja o desta migration nem o da
-- 20261600000000 (alguem o redefiniu depois: devolver o corpo velho apagaria uma redefinicao que ninguem revisou). Estados aceitos: a migration no ar, ou ja
-- desfeita (rodar de novo e' no-op). Conferencia final: o corpo, os atributos e o EXECUTE do motivo sao os da 20261600000000.
-- ORDEM: desfazer ESTA antes do rollback da 20261600000000 (o pre-voo dele recusa o motivo com o corpo desta).
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior neste arquivo - regra da casa.
-- Rodar duas vezes deixa o mesmo estado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261661000000$
DECLARE
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'motivo_da_loja_nao_aceitar_pedido') <> 1
     OR to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.motivo_da_loja_nao_aceitar_pedido() ausente, com sobrecarga ou com outra assinatura - revise antes de desfazer.';
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash FROM pg_proc p WHERE p.oid = to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()');
  IF v_hash IS NULL OR v_hash NOT IN ('f2404f96cd8a589f2821eb5c20a85aa2', 'bfe365fb64ad8d2bb9c06efca304375c') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.motivo_da_loja_nao_aceitar_pedido() (hash %) nao e o da 20261661000000 nem o da 20261600000000 - uma redefinicao posterior esta no ar; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
  END IF;
END $preflight_rollback_20261661000000$;

-- O motivo da 20261600000000, letra por letra (o mesmo texto do arquivo dela).
CREATE OR REPLACE FUNCTION public.motivo_da_loja_nao_aceitar_pedido()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manutencao boolean;
  v_vale boolean;
  v_suspensa_desde date;
  v_status text;
  v_teste_ate date;
  v_proxima date;
  v_pausa_em date;
  v_inicio date;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- (a) Manutencao: store_config.manutencao da linha 1 (a que a ferramenta da frota liga). Vence a pausa.
  SELECT s.manutencao INTO v_manutencao FROM public.store_config s WHERE s.id = 1;
  IF v_manutencao IS TRUE THEN
    RETURN 'manutencao';
  END IF;

  -- (b) Vendas pausadas por assinatura: as 5 chaves JUNTAS. Qualquer uma faltando = aceita (o que acontece hoje).
  --     Se um rollback tirar uma tabela da porta (20261177000000, 20261399998000) ou a desta migration, aceita, sem erro.
  IF to_regclass('public.pausa_de_vendas') IS NULL OR to_regclass('public.assinatura_da_loja') IS NULL
     OR to_regclass('public.assinatura_da_loja_chave') IS NULL THEN
    RETURN NULL;
  END IF;
  -- 1. ligada nesta loja (so o dono do banco grava; Savy e IKCOUS nunca)
  SELECT p.vale_pela_assinatura, p.suspensa_desde INTO v_vale, v_suspensa_desde FROM public.pausa_de_vendas p WHERE p.id = 1;
  IF v_vale IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  -- 2. a gestao esta ligada (a chave da porta foi definida)
  IF NOT EXISTS (SELECT 1 FROM public.assinatura_da_loja_chave) THEN
    RETURN NULL;
  END IF;
  -- 3. o pedido de pausa: status suspensa (atrasada NUNCA pausa: pausar e' decisao manual)
  SELECT a.status, a.teste_ate, a.proxima_cobranca_em, a.pausa_em INTO v_status, v_teste_ate, v_proxima, v_pausa_em
    FROM public.assinatura_da_loja a WHERE a.id = 1;
  IF v_status IS DISTINCT FROM 'suspensa' THEN
    RETURN NULL;
  END IF;
  -- 4 e 5. passou o minimo, o dia da suspensa e o dia prometido pela gestao (nunca antes de pausa_em), em dia util
  v_inicio := public.data_da_pausa_de_vendas(v_teste_ate, v_proxima, v_suspensa_desde, v_pausa_em);
  IF v_inicio IS NULL OR v_hoje < v_inicio THEN
    RETURN NULL;
  END IF;
  RETURN 'vendas_pausadas';
END;
$function$;

REVOKE ALL ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.motivo_da_loja_nao_aceitar_pedido() IS 'Por que a loja nao aceita pedido NOVO agora: manutencao (store_config.manutencao, vence), vendas_pausadas (pausa_de_vendas ligada, chave da gestao definida, cartao suspensa e hoje em Sao Paulo >= data_da_pausa_de_vendas) ou NULL (aceita). Todo caso duvidoso, inclusive tabela ausente, aceita. EXECUTE de ninguem de aplicacao.';

DO $conferencia_rollback_20261661000000$
DECLARE
  v_oid oid := to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()');
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'motivo_da_loja_nao_aceitar_pedido') <> 1
     OR (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM 'bfe365fb64ad8d2bb9c06efca304375c' THEN
    RAISE EXCEPTION 'conferencia rollback 20261661000000: o motivo nao voltou ao corpo da 20261600000000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's'
                    AND NOT p.proretset AND pg_get_function_result(p.oid) = 'text'
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]) THEN
    RAISE EXCEPTION 'conferencia rollback 20261661000000: os atributos do motivo nao sao os da 20261600000000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261661000000: o EXECUTE do motivo nao e o da 20261600000000 (de ninguem de aplicacao)';
  END IF;
END $conferencia_rollback_20261661000000$;
