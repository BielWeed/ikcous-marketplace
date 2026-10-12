-- ============================================================================
-- Rollback manual — a decisão da devolução exige o admin de agora (20261200000000)
-- ============================================================================
-- Restaura, byte a byte, os três corpos que estavam vivos antes da
-- 20261200000000 (admin_devolucao_decidir, admin_devolucao_registrar e
-- admin_devolucao_reprovar, da 20261175000000). Mesma assinatura, mesmo
-- SECURITY DEFINER, mesmo search_path, mesma ACL — este arquivo não toca ACL
-- (CREATE OR REPLACE preserva a vigente) nem nenhum outro objeto.
--
-- Depois do rollback o defeito volta: um admin rebaixado com JWT ainda válido
-- (até ~1 h) volta a aprovar/recusar, registrar envio/recebimento e reprovar
-- devolução. Reverter só faz sentido se a guarda estiver recusando um admin
-- legítimo.
-- ORDEM: este rollback vem ANTES do da 20261197000000 (que apaga
-- is_admin_atual()); estes três corpos restaurados não chamam is_admin_atual().
--
-- DADOS: a migration não gravou nada em linha nenhuma (só recusou cliques),
-- então não há dado a desfazer. Nada é apagado.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261200$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se o corpo VIVO de
-- alguma das três (md5 de `replace(prosrc, E'\r', '')`) não for exatamente o que a
-- 20261200000000 deixou: desfazer por cima de uma redefinição POSTERIOR
-- apagaria a dela em silêncio, e desfazer duas vezes não tem o que desfazer.
-- Mesma transação do restante: recusa = nada gravado.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261200$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)', '9cd24a3818b1fea1b4d182bf4b2b52b0'),
        ('public.admin_devolucao_registrar(uuid,text,text,text)', 'f59a9f01811512329c425295ea171e76'),
        ('public.admin_devolucao_reprovar(uuid,text)', '16f223b54591e6ee24eeb6e28c8c264c')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261200000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_rollback_20261200$;

-- admin_devolucao_decidir: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucao_decidir(
  p_id uuid,
  p_aprovar boolean,
  p_mensagem text DEFAULT NULL,
  p_coleta_em timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_msg text := NULLIF(btrim(COALESCE(p_mensagem, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'solicitada' THEN
    RAISE EXCEPTION 'Esta devolução já foi decidida.' USING ERRCODE = '22023';
  END IF;

  IF p_aprovar THEN
    UPDATE public.devolucoes
       SET status = 'aprovada', aprovada_em = now(), mensagem_loja = v_msg,
           coleta_em = CASE WHEN metodo_retorno = 'coleta' THEN p_coleta_em ELSE NULL END,
           updated_at = now()
     WHERE id = p_id;
    PERFORM public.devolucao__registrar_evento(p_id, 'solicitada', 'aprovada', 'loja', v_msg);
    RETURN jsonb_build_object('id', p_id, 'status', 'aprovada');
  END IF;

  -- Recusa sempre explícita e com motivo (CDC art. 26 §2º I).
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'Explique ao cliente o motivo da recusa.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'recusada', mensagem_loja = v_msg, encerrada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'solicitada', 'recusada', 'loja', v_msg);
  RETURN jsonb_build_object('id', p_id, 'status', 'recusada');
END;
$$;

-- admin_devolucao_registrar: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucao_registrar(
  p_id uuid,
  p_evento text,
  p_codigo text DEFAULT NULL,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_codigo text := NULLIF(upper(btrim(COALESCE(p_codigo, ''))), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_evento = 'em_transito' THEN
    IF v_d.status <> 'aprovada' THEN
      RAISE EXCEPTION 'Só uma devolução aprovada pode ser marcada como enviada.' USING ERRCODE = '22023';
    END IF;
    IF v_codigo IS NOT NULL AND v_codigo !~ '^[A-Z0-9-]{5,40}$' THEN
      RAISE EXCEPTION 'Código de rastreio inválido.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.devolucoes
       SET status = 'em_transito', postada_em = now(),
           codigo_rastreio = COALESCE(v_codigo, codigo_rastreio), updated_at = now()
     WHERE id = p_id;
  ELSIF p_evento = 'recebida' THEN
    IF v_d.status NOT IN ('aprovada', 'em_transito') THEN
      RAISE EXCEPTION 'Só uma devolução aprovada ou a caminho pode ser marcada como recebida.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.devolucoes SET status = 'recebida', recebida_em = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Evento desconhecido.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, p_evento, 'loja',
    concat_ws(' · ', CASE WHEN v_codigo IS NOT NULL THEN 'Rastreio: ' || v_codigo END, NULLIF(btrim(COALESCE(p_nota, '')), '')));
  RETURN jsonb_build_object('id', p_id, 'status', p_evento);
END;
$$;

-- admin_devolucao_reprovar: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucao_reprovar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_msg text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Só um produto recebido pode ser reprovado na inspeção.' USING ERRCODE = '22023';
  END IF;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'Explique ao cliente por que o produto não foi aceito.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'reprovada', mensagem_loja = v_msg, encerrada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'reprovada', 'loja', v_msg);
  RETURN jsonb_build_object('id', p_id, 'status', 'reprovada');
END;
$$;
