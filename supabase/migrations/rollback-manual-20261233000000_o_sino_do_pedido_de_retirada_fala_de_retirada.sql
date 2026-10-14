-- ============================================================================
-- Rollback manual — o sino do pedido de retirada fala de retirada (20261233000000)
-- ============================================================================
-- Recria public.notifica_cliente_de_mudanca_de_status() com o corpo VIGENTE de antes (o da 20261026000000,
-- byte a byte: o md5 de replace(prosrc, E'\r', '') volta a ser o de antes, e a prova viva confere).
-- Assinatura, SECURITY DEFINER, VOLATILE, search_path e retorno são os mesmos da migration. A trigger
-- tr_pedido_avisa_o_cliente NÃO é tocada (continua apontando para a mesma função).
--
-- A ACL NÃO é tocada: CREATE OR REPLACE preserva dono e privilégios, e este arquivo não tem nenhum GRANT nem
-- REVOKE.
--
-- COM ELE VOLTA O DEFEITO: o pedido de retirada volta a receber "Pedido a caminho" e "Pedido entregue" no sino.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui. As notificações que nasceram com o texto
-- da retirada enquanto a migration valeu FICAM (são avisos verdadeiros que a cliente já leu, ou não; apagar
-- histórico de sino seria destruição de dado sem motivo).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo vivo não for
-- um dos dois conhecidos (o desta migration, ou o vigente — e então rodar de novo reescreve o mesmo texto); se
-- os atributos não forem os de sempre; ou se a ACL mudou. A conferência final recusa se o corpo não voltou ao
-- vigente, se algum atributo mudou, se a trigger saiu do lugar ou se a ACL mudou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de
-- nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261233$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: notifica_cliente_de_mudanca_de_status tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.notifica_cliente_de_mudanca_de_status()', '7ace411aa5e184677d21d3b15ae94bf2', 'fc8fd54a2fa1533f0d926744aab8ff58')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'trigger'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                  WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC sem EXECUTE; o estado de antes era aberto por herança do PUBLIC) — revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261233$;

CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Convidado não tem conta, logo não tem sino: sem usuário, sem aviso.
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Só mudança REAL de status: updates que tocam outra coluna (tracking,
    -- notas, gateway) não acendem o sino.
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    BEGIN
        CASE NEW.status
            WHEN 'processing' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'info', 'Pedido em preparo',
                        'Seu pedido já está em preparo pela loja.',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'shipping' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'info', 'Pedido a caminho',
                        'Seu pedido saiu para entrega!',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'delivered' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'success', 'Pedido entregue',
                        'Seu pedido foi entregue. Obrigado por comprar com a gente!',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'cancelled' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'warning', 'Pedido cancelado',
                        'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',
                        jsonb_build_object('order_id', NEW.id));
            ELSE
                -- Status sem frase desenhada (o 'pending' de updates tardios,
                -- um status futuro) não inventa aviso.
                NULL;
        END CASE;
    EXCEPTION WHEN OTHERS THEN
        -- O sino é best-effort: falha de aviso NUNCA reverte a mudança de
        -- status do pedido. O UPDATE segue; a falha fica LOGADA no servidor
        -- para os logs do banco, não engolida em silêncio — defeito de
        -- configuração (permissão, coluna renomeada) tem de aparecer.
        RAISE WARNING
            'notifica_cliente_de_mudanca_de_status: aviso do pedido % nao nasceu (%).',
            NEW.id, SQLERRM;
        NULL;
    END;

    RETURN NEW;
END;
$$;

DO $conferencia_rollback_20261233$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '7ace411aa5e184677d21d3b15ae94bf2' THEN
    RAISE EXCEPTION 'conferencia rollback 20261233: corpo vivo de % (hash %) não voltou ao vigente', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'trigger'
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261233: atributos de % mudaram', v_fn;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
          AND t.tgrelid = 'public.marketplace_orders'::regclass
          AND t.tgfoid = v_oid
          AND t.tgtype = 17
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261233: a trigger tr_pedido_avisa_o_cliente saiu de %', v_fn;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                  WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261233: ACL de % mudou (PUBLIC perdeu EXECUTE)', v_fn;
  END IF;
END $conferencia_rollback_20261233$;
