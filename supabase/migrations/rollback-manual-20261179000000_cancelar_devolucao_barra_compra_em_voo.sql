-- ROLLBACK MANUAL de 20261179000000_cancelar_devolucao_barra_compra_em_voo.sql
--
-- Desfaz a ÚNICA mudança daquela migration: devolve `cancelar_devolucao` ao
-- corpo exato da 20261175000000_a_devolucao_nasce_no_pedido.sql (linhas
-- 768-788 daquele arquivo) — sem o guard de "compra em voo" e sem o evento
-- extra ao lojista. Nenhuma tabela, índice, policy, trigger ou grant foi
-- criado pela migration original: não há mais nada para desfazer aqui.
--
-- Restauração VERBATIM (byte a byte) do corpo aprovado em 20261175000000 —
-- conferida pelo teste estático
-- tests/migration_cancelar_devolucao_barra_compra_em_voo_test.ts, que compara
-- este bloco contra o texto lido diretamente daquele arquivo (md5 do bloco
-- original: ef90f1e3fa72c67a606656aeace10ecf). Não edite este bloco sem
-- reconferir os dois — é o que prova que "restaurar" aqui significa o texto
-- que já foi aprovado, não uma versão reescrita de memória.
--
-- Sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa).

CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_d.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'aprovada') THEN
    RAISE EXCEPTION 'Esta devolução não pode mais ser cancelada.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes SET status = 'cancelada', encerrada_em = now(), updated_at = now() WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelada');
END;
$$;
