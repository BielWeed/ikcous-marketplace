-- ============================================================================
-- Migration 20261399920000 — o sino do pedido vencido fala do vencimento
-- (dado de cliente; caçada do lote 43 do modo autônomo; só troca o corpo de UMA função de gatilho)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- public.notifica_cliente_de_mudanca_de_status() é a trigger (tr_pedido_avisa_o_cliente) que acende o SINO da cliente a cada mudança
-- real de status do pedido. O aviso de 'cancelled' tinha UMA frase só: "Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.".
-- Quando a cliente escolhe PIX ou cartão e não paga, a varredura automática (expirar_pedidos_vencidos, 20261393000000) cancela o pedido
-- sozinha: grava status 'cancelled' E payment_status 'expirado' no MESMO UPDATE. A cliente abria o sino e lia que "o pedido foi
-- cancelado, fale com a loja" — como se a loja tivesse cancelado — enquanto a tela do pedido (OrderDetailsView) já explica o motivo
-- certo ("O prazo do pagamento terminou ..."). Sino e tela contavam histórias diferentes.
--
-- 2. A REGRA NOVA
--
-- No ramo 'cancelled': se NEW.payment_status for 'expirado' (comparação EXATA, IS NOT DISTINCT FROM: NULL nunca é expirado), o sino grava
--   título   "Prazo do pagamento terminou"
--   mensagem "O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo.
--             Se não pagou, é só comprar de novo."
-- (a mesma frase da tela do pedido, palavra por palavra: quem pagou no último minuto pode ver o pedido virar 'pago_apos_expirar' minutos
-- depois, e mandar "comprar de novo" na hora seria pagar duas vezes). Qualquer outro cancelamento (a cliente cancela, a lojista cancela,
-- estorno, pagamento recusado) segue com a frase de hoje, idêntica. A varredura grava payment_status e status no mesmo UPDATE, então
-- NEW.payment_status já vale 'expirado' dentro da trigger (que dispara em UPDATE OF status).
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- O INSERT do ramo WHEN 'cancelled' vira IF/ELSE: o ramo IF traz o texto do vencimento (acima), o ELSE traz o INSERT de antes (o mesmo
-- texto, só uma indentação a mais), mais duas linhas de comentário. Convidado (user_id nulo) segue sem aviso; update que não muda o status
-- segue sem aviso; processing, shipping (entrega e retirada), delivered (entrega e retirada) e os status sem frase seguem como estavam; o
-- bloco best-effort (falha de aviso nunca derruba o pedido, só loga) segue. Assinatura, SECURITY DEFINER, VOLATILE, search_path, a trigger,
-- a tabela notificacoes e a ACL NÃO são tocados. O título é diferente do de "Pedido cancelado" de propósito (a frase de hoje continua uma
-- só vez no corpo, e quem lê só o título do sino já sabe que foi o prazo).
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida ou escrita ao aplicar: só o corpo de UMA função muda. Os avisos de cancelamento que JÁ nasceram com a frase antiga
-- num pedido vencido FICAM como estão (são histórico da cliente; reescrever o sino dela seria mexer em dado de cliente sem pedido); só as
-- mudanças de status DEPOIS do apply usam o texto novo. Aplicar duas vezes deixa o mesmo estado (o pré-voo aceita o corpo vigente OU o
-- desta migration).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos
-- (o da 20261233000000, fc8fd54a2fa1533f0d926744aab8ff58, ou o desta migration, dd76f4442bcb0a3b05bcede6d80fc406) — por isso uma loja que ainda está no corpo da
-- 20261026000000 (sem o sino da retirada) RECUSA e precisa da 20261233000000 antes; os atributos não forem os de sempre (plpgsql, SECURITY
-- DEFINER, VOLATILE, search_path=public, retorna trigger, sem argumentos); a trigger não estiver ligada a ela (AFTER UPDATE OF status, por
-- linha); faltar coluna que o corpo lê ou grava (inclui marketplace_orders.payment_status); ou a ACL não for EXATAMENTE a de hoje (aberta por
-- herança do PUBLIC, como lista tests/banco/portas-do-visitante-permitidas.json). Fotografa OID, dono, ACL e atributos (set_config local à
-- transação) para o pós-voo. Os hashes são o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_sino_do_pedido_vencido_fala_do_vencimento_test.ts.
--
-- 6. TRANSAÇÃO E IDEMPOTÊNCIA
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa: com eles o ROLLBACK do script de prova vira no-op e a mudança fica gravada): quem abre a
-- transação é o aplicador; o pré-voo, a troca do corpo e o pós-voo caem juntos ou não caem. CREATE OR REPLACE (sem DROP) preserva OID, dono e
-- ACL; nenhum GRANT nem REVOKE neste arquivo. lock_timeout de 5 s: se uma transação longa segurar a função, o apply desiste em vez de esperar.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261233000000 (o pré-voo recusa sem o corpo dela). ROLLBACK MANUAL: rollback-manual-20261399920000_o_sino_do_pedido_vencido_fala_do_vencimento.sql
-- devolve o corpo da 20261233000000 byte a byte; vem ANTES de qualquer rollback da 20261233000000 (o dele recusa enquanto este corpo estiver
-- no ar). NÃO apaga nenhuma notificação criada enquanto o texto novo valeu. A consulta 34a aceita o corpo desta migration como sucessor.
-- Banco de CADA loja; valem IKCOUS e Savy, lojas de teste ficam fora.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
--      -- esperado: dd76f4442bcb0a3b05bcede6d80fc406.
--   2. Num pedido de teste de usuária logada: UPDATE payment_status = 'expirado', status = 'cancelled' e depois
--      SELECT titulo, mensagem FROM public.notificacoes WHERE dados->>'order_id' = '<id>' ORDER BY created_at DESC LIMIT 1;
--      -- esperado: "Prazo do pagamento terminou" / "O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, ...".
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/o-sino-do-pedido-vencido-fala-do-vencimento-viva.cjs (rpc-ci); portão da release: consultas 127a e 127b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399920000$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
  v_vigente text;
  v_desta text;
  v_public boolean;
  v_falta text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: notifica_cliente_de_mudanca_de_status tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- vigente = o corpo da 20261233000000 (até aqui); desta = o que ESTA migration deixa (reaplicação idempotente).
  SELECT anterior, desta INTO v_vigente, v_desta FROM (VALUES
    ('public.notifica_cliente_de_mudanca_de_status()', 'fc8fd54a2fa1533f0d926744aab8ff58', 'dd76f4442bcb0a3b05bcede6d80fc406')
  ) esperado(assinatura, anterior, desta);
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (v_vigente, v_desta) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261233000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- A trigger tem de estar ligada à função (AFTER UPDATE OF status, por linha: tgtype 17 = ROW + UPDATE, sem BEFORE).
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
          AND t.tgrelid = 'public.marketplace_orders'::regclass
          AND t.tgfoid = v_oid
          AND NOT t.tgisinternal
          AND t.tgtype = 17
          AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a
                                 WHERE a.attrelid = 'public.marketplace_orders'::regclass
                                   AND a.attname = 'status' AND NOT a.attisdropped)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a trigger tr_pedido_avisa_o_cliente não está ligada a % como AFTER UPDATE OF status por linha — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- O PL/pgSQL só acusa coluna ausente na hora de EXECUTAR, não ao criar: confere antes (o corpo novo lê payment_status).
  SELECT string_agg(d.tabela || '.' || d.coluna, ', ' ORDER BY d.tabela, d.coluna) INTO v_falta
    FROM (VALUES
            ('marketplace_orders', 'id'), ('marketplace_orders', 'user_id'), ('marketplace_orders', 'status'),
            ('marketplace_orders', 'payment_status'), ('marketplace_orders', 'customer_data'),
            ('notificacoes', 'usuario_id'), ('notificacoes', 'tipo'), ('notificacoes', 'titulo'),
            ('notificacoes', 'mensagem'), ('notificacoes', 'dados')
         ) AS d(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || d.tabela)
                        AND a.attname = d.coluna AND NOT a.attisdropped AND a.attnum > 0)
      OR (d.tabela = 'marketplace_orders' AND d.coluna = 'customer_data'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = to_regclass('public.marketplace_orders')
                             AND a.attname = 'customer_data' AND a.atttypid = 'jsonb'::regtype))
      OR (d.tabela = 'marketplace_orders' AND d.coluna = 'payment_status'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = to_regclass('public.marketplace_orders')
                             AND a.attname = 'payment_status' AND a.atttypid = 'text'::regtype));
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo lê ou grava não existem (ou customer_data não é jsonb, ou payment_status não é text): % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): aberta por herança do PUBLIC; o CREATE OR REPLACE a preserva.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF NOT v_public THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC sem EXECUTE; hoje ela é aberta por herança do PUBLIC) — meça a loja e revise.', v_fn;
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.sino3999_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261399920000$;

-- notifica_cliente_de_mudanca_de_status: corpo vigente da 20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql, com o aviso do
-- pedido vencido no ramo WHEN 'cancelled' (a troca declarada no cabeçalho, itens 2 e 3).
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
                -- 20261399920000: o pedido que a varredura cancelou porque o prazo do pagamento terminou (payment_status 'expirado', gravado
                -- no mesmo UPDATE) fala do vencimento, a mesma frase da tela do pedido; qualquer outro cancelamento segue com a frase de antes.
                IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN
                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                    VALUES (NEW.user_id, 'warning', 'Prazo do pagamento terminou',
                            'O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.',
                            jsonb_build_object('order_id', NEW.id));
                ELSE
                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                    VALUES (NEW.user_id, 'warning', 'Pedido cancelado',
                            'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',
                            jsonb_build_object('order_id', NEW.id));
                END IF;
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

-- PÓS-VOO no instante do apply: aborta (e a transação do aplicador desfaz a troca) se o corpo vivo não é o novo, se a troca não aparece
-- exatamente uma vez, se a frase de antes ou o texto da retirada sumiu, se algum atributo mudou, se a trigger saiu do lugar ou se a ACL deixou
-- de ser a de hoje.
DO $posvoo_20261399920000$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
  v_src text;
  v_marca text := '20261399920000: o pedido que a varredura cancelou';
  v_vencido text := 'O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.';
  v_antiga text := 'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.';
  v_guarda text := 'IF NEW.payment_status IS NOT DISTINCT FROM ''expirado'' THEN';
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: % sumiu', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'dd76f4442bcb0a3b05bcede6d80fc406' THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: corpo vivo (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) <> 1
     OR (length(v_src) - length(replace(v_src, v_guarda, ''))) / length(v_guarda) <> 1
     OR (length(v_src) - length(replace(v_src, v_vencido, ''))) / length(v_vencido) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: a troca desta migration não aparece exatamente uma vez';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_antiga, ''))) / length(v_antiga) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: a frase do cancelamento de antes não aparece exatamente uma vez';
  END IF;
  IF position('Pedido pronto para retirar' IN v_src) = 0 OR position('Pedido retirado' IN v_src) = 0
     OR position('store-pickup' IN v_src) = 0 OR position('Pedido a caminho' IN v_src) = 0
     OR position('Pedido entregue' IN v_src) = 0 OR position('Pedido em preparo' IN v_src) = 0 THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: um texto de outro status (20261233000000) sumiu do corpo';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: notifica_cliente_de_mudanca_de_status ficou com sobrecarga';
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
    RAISE EXCEPTION 'POSVOO_20261399920000: atributos de % mudaram', v_fn;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
          AND t.tgrelid = 'public.marketplace_orders'::regclass
          AND t.tgfoid = v_oid
          AND t.tgtype = 17
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: a trigger tr_pedido_avisa_o_cliente saiu de %', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF NOT v_public THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: ACL de % mudou (PUBLIC perdeu EXECUTE)', v_fn;
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.sino3999_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261399920000: atributos, dono, OID ou ACL de % mudaram', v_fn;
  END IF;
END $posvoo_20261399920000$;
