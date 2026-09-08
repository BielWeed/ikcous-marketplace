-- ============================================================================
-- Migration 20261120000000 — reordenar banners numa transação só
-- (issue #499 — frente reordenar-banners-numa-transacao-so, 08/09/2026)
-- ============================================================================
--
-- O PROBLEMA (medido no useBanners.ts): quando havia ordens duplicadas,
-- reorderBanners normalizava cada linha em uma chamada separada e só depois
-- chamava swap_banner_order. Uma falha intermediária deixava parte gravada.
--
-- O QUE ESTA MIGRATION FAZ: cria uma RPC que valida o administrador e a
-- posição, trava as linhas daquela posição, renumera por ordem/id e troca
-- os dois banners. Uma exceção desfaz todas as escritas daquela chamada.
--
-- DADOS EXISTENTES: aplicar este arquivo não altera banners. Ao chamar a
-- RPC, somente a posição solicitada é normalizada para 1..n, inclusive
-- ordens repetidas ou nulas; linhas já numeradas corretamente não são
-- regravadas na normalização. Banner ausente ou de outra posição aborta
-- também essa normalização. Os demais campos permanecem como estavam.
--
-- IDEMPOTÊNCIA: reaplicar CREATE OR REPLACE e os grants mantém o mesmo
-- estado da função. A operação de TROCA não é idempotente: chamar duas
-- vezes com os mesmos ids distintos troca e depois destroca; não repetir
-- automaticamente após resposta perdida. Com dois ids iguais, a troca
-- mantém a ordem normalizada. O lock cobre as linhas existentes daquela
-- posição, não impede inserções concorrentes de banners novos.
--
-- FORA DO ESCOPO: swap_banner_order continua intacta para consumidores
-- antigos; este arquivo não altera tabela, políticas, triggers ou dados.
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- node scripts/db-apply.cjs (uma transação por arquivo) ou psql -1.
-- Nunca statement a statement: criação e grants precisam confirmar juntos.
-- Não há controle de transação neste arquivo, preservando o ROLLBACK da
-- prova. O BEGIN abaixo delimita o corpo PL/pgSQL, não abre uma transação.
--
-- ROLLBACK: reverter primeiro o front e depois executar o arquivo
-- rollback-manual-20261120000000_reordenar_banners_numa_transacao_so.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reorder_banners_atomic(
  p_position text,
  p_banner_id_1 uuid,
  p_banner_id_2 uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_banner record;
  v_next_order integer := 1;
  v_order_1 integer;
  v_order_2 integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  IF p_position NOT IN ('home_top', 'home_middle', 'home_bottom') THEN
    RAISE EXCEPTION 'Posição inválida.';
  END IF;

  PERFORM 1 FROM public.banners WHERE "position" = p_position FOR UPDATE;

  FOR v_banner IN
    SELECT id FROM public.banners
    WHERE "position" = p_position
    ORDER BY "order" ASC, id ASC
  LOOP
    UPDATE public.banners
    SET "order" = v_next_order
    WHERE id = v_banner.id AND "order" IS DISTINCT FROM v_next_order;

    v_next_order := v_next_order + 1;
  END LOOP;

  SELECT "order" INTO v_order_1 FROM public.banners
  WHERE id = p_banner_id_1 AND "position" = p_position;

  SELECT "order" INTO v_order_2 FROM public.banners
  WHERE id = p_banner_id_2 AND "position" = p_position;

  IF v_order_1 IS NULL OR v_order_2 IS NULL THEN
    RAISE EXCEPTION 'Banner não encontrado.';
  END IF;

  UPDATE public.banners
  SET "order" = v_order_2
  WHERE id = p_banner_id_1 AND "position" = p_position;

  UPDATE public.banners
  SET "order" = v_order_1
  WHERE id = p_banner_id_2 AND "position" = p_position;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reorder_banners_atomic(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_banners_atomic(text, uuid, uuid) TO authenticated, service_role;
