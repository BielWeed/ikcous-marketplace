-- ROLLBACK MANUAL de 20261179000000_cancelar_devolucao_barra_compra_em_voo.sql
--
-- Desfaz as DUAS mudanças daquela migration (rodadas 1-4):
--   1. devolve `cancelar_devolucao` ao corpo exato da
--      20261175000000_a_devolucao_nasce_no_pedido.sql (linhas 768-788
--      daquele arquivo) — sem o guard de "compra em voo" (nem a versão da
--      rodada 1, nem a `NOT LIKE 'reservando:%'` da rodada 2) e sem o evento
--      extra ao lojista;
--   2. derruba `admin_devolucao_liberar_vinculo_reverso` (função NOVA da
--      rodada 2 — não existia antes desta migration, não há corpo anterior
--      para restaurar). Os DOIS `DROP FUNCTION` abaixo (assinatura de 1 e de
--      2 argumentos) cobrem tanto quem já aplicou só até a rodada 2/3 quanto
--      quem já tem a rodada 4 — `IF EXISTS` torna as duas chamadas seguras
--      em qualquer um dos dois estados.
-- Nenhuma tabela, índice, policy ou trigger foi criado pela migration
-- original: não há mais nada para desfazer aqui.
--
-- Restauração VERBATIM (byte a byte) do corpo de `cancelar_devolucao`
-- aprovado em 20261175000000 — conferida pelo teste estático
-- tests/migration_cancelar_devolucao_barra_compra_em_voo_test.ts, que compara
-- este bloco contra o texto lido diretamente daquele arquivo (md5 do bloco
-- original: ef90f1e3fa72c67a606656aeace10ecf). Não edite este bloco sem
-- reconferir os dois — é o que prova que "restaurar" aqui significa o texto
-- que já foi aprovado, não uma versão reescrita de memória.
--
-- Sem BEGIN/COMMIT de nível superior neste arquivo (regra da casa).
--
-- GUARDA DE ORDEM: o corpo que este rollback restaura para `cancelar_devolucao`
-- lê `public.devolucoes` (`SELECT * INTO v_d FROM public.devolucoes ...`) — sem
-- essa tabela (20261175000000) no ar, a função restaurada nasceria quebrada,
-- e o erro só apareceria na primeira chamada dela (42P01), não aqui. Isso
-- acontece se alguém reverter na ordem ERRADA (75 antes de 79 — o §7.5 do
-- runbook manda o oposto). Recusa cedo, com uma mensagem clara.
DO $$
BEGIN
  IF to_regclass('public.devolucoes') IS NULL THEN
    RAISE EXCEPTION 'reverta esta migration (79) só com a tabela public.devolucoes (20261175000000) no ar — sem ela, o corpo restaurado de cancelar_devolucao não funciona. Reverta 79 ANTES de 75 (ver runbook, §7.5).';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid);

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
