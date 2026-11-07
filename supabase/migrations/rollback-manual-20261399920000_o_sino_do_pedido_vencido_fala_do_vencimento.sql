-- ============================================================================
-- Rollback manual — o sino do pedido vencido fala do vencimento (20261399920000)
-- ============================================================================
-- Recria public.notifica_cliente_de_mudanca_de_status() com o corpo VIGENTE de antes (o da 20261233000000, byte a byte: o md5 de
-- replace(prosrc, E'\r', '') volta a ser fc8fd54a2fa1533f0d926744aab8ff58). Assinatura, SECURITY DEFINER, VOLATILE, search_path, retorno trigger e ACL são os mesmos;
-- OID e dono não mudam (CREATE OR REPLACE). A trigger tr_pedido_avisa_o_cliente NÃO é tocada. Nenhum GRANT nem REVOKE neste arquivo.
--
-- COM ELE VOLTA O DEFEITO descrito no cabeçalho da migration 20261399920000: o pedido que venceu sozinho volta a mandar ao sino da cliente
-- "Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.".
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui. As notificações que nasceram com o texto do vencimento enquanto a migration
-- valeu FICAM (são avisos verdadeiros que a cliente já leu, ou não; apagar histórico de sino seria destruição de dado sem motivo).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo vivo não for o DESTA migration (rodar de novo, já
-- desfeito, recusa); se os atributos não forem os de sempre; se a trigger saiu do lugar; ou se a ACL não for a conhecida. O pós-voo recusa se o corpo
-- não voltou ao vigente ou se OID, dono, ACL ou atributos mudaram.
--
-- ORDEM: este vem ANTES de qualquer rollback da 20261233000000 (o dele recusa enquanto este corpo estiver no ar). Executar pelo aplicar-migrations.yml
-- (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399920000$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: notifica_cliente_de_mudanca_de_status tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'dd76f4442bcb0a3b05bcede6d80fc406' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) não é o da 20261399920000; revise antes de reverter.', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
          AND t.tgrelid = 'public.marketplace_orders'::regclass
          AND t.tgfoid = v_oid
          AND t.tgtype = 17
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a trigger tr_pedido_avisa_o_cliente não está ligada a % — revise antes de sobrescrever.', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF NOT v_public THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC sem EXECUTE; o estado de antes era aberto por herança do PUBLIC) — revise a ACL antes.', v_fn;
  END IF;
  PERFORM set_config('ikcous.sino3999_rb_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_rollback_20261399920000$;

CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_retirada boolean := false;
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
        -- Retirada na loja: o id da opção de entrega gravado na compra é o contrato
        -- (comparação exata). Sem customer_data ou sem a chave, não é retirada.
        v_retirada := COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup';

        CASE NEW.status
            WHEN 'processing' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'info', 'Pedido em preparo',
                        'Seu pedido já está em preparo pela loja.',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'shipping' THEN
                IF v_retirada THEN
                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                    VALUES (NEW.user_id, 'info', 'Pedido pronto para retirar',
                            'Seu pedido está pronto! Venha retirar na loja.',
                            jsonb_build_object('order_id', NEW.id));
                ELSE
                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                    VALUES (NEW.user_id, 'info', 'Pedido a caminho',
                            'Seu pedido saiu para entrega!',
                            jsonb_build_object('order_id', NEW.id));
                END IF;
            WHEN 'delivered' THEN
                IF v_retirada THEN
                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                    VALUES (NEW.user_id, 'success', 'Pedido retirado',
                            'Seu pedido foi retirado na loja. Obrigado por comprar com a gente!',
                            jsonb_build_object('order_id', NEW.id));
                ELSE
                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                    VALUES (NEW.user_id, 'success', 'Pedido entregue',
                            'Seu pedido foi entregue. Obrigado por comprar com a gente!',
                            jsonb_build_object('order_id', NEW.id));
                END IF;
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

DO $posvoo_rollback_20261399920000$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'fc8fd54a2fa1533f0d926744aab8ff58' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261399920000: corpo vivo (hash %) não voltou ao vigente', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.sino3999_rb_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261399920000: atributos, dono, OID ou ACL de % mudaram', v_fn;
  END IF;
END $posvoo_rollback_20261399920000$;
