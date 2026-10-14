-- ============================================================================
-- Migration 20261233000000 — o sino do pedido de retirada fala de retirada
-- (dado de cliente; caçada de 14/10/2026 em Postgres descartável; só troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- public.notifica_cliente_de_mudanca_de_status() é a trigger (tr_pedido_avisa_o_cliente, 20261026000000)
-- que acende o SINO da cliente a cada mudança real de status do pedido. O texto era um só, o da entrega:
-- num pedido de RETIRADA NA LOJA, quando a lojista marcava "Pronto para retirar" (status shipping), o sino
-- dizia "Pedido a caminho — saiu para entrega" e, depois, que o pedido foi entregue; o aviso do painel
-- (push) e a tela do pedido diziam "Pronto para retirar". Duas mensagens contraditórias para a mesma cliente,
-- e a do sino mandava esperar em casa um pedido que ela precisa buscar.
--
-- 2. A REGRA NOVA
--
-- Pedido de retirada = customer_data->>'shipping_option_id' = 'store-pickup' (comparação EXATA, o id é o
-- contrato; a RPC create_marketplace_order_v23/v24 grava esse id e o endereço da loja em
-- customer_data.pickup_address JUNTOS, e só para a retirada). Nesses pedidos:
--
--   * status shipping  → título "Pedido pronto para retirar",
--                        mensagem "Seu pedido está pronto! Venha retirar na loja." (a mesma frase da tela do pedido);
--   * status delivered → título "Pedido retirado",
--                        mensagem "Seu pedido foi retirado na loja. Obrigado por comprar com a gente!".
--
-- 3. O QUE NÃO MUDA (byte a byte, provado em tests/banco/o-sino-do-pedido-de-retirada-viva.cjs)
--
-- Todo pedido que NÃO é retirada (entrega, balcão, sem customer_data, id de outra opção, id com espaço) segue
-- com os textos de hoje. Em QUALQUER pedido, processing, cancelled e os status sem frase seguem como hoje.
-- Convidado (user_id nulo) segue sem aviso; update que não muda o status segue sem aviso (reaplicar o mesmo
-- status não duplica o aviso); a falha de inserir o aviso segue logada e nunca derruba o pedido. Assinatura,
-- SECURITY DEFINER, search_path, a trigger, a tabela notificacoes e a ACL NÃO são tocados.
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * retirada + shipping → "Pedido pronto para retirar"; retirada + delivered → "Pedido retirado";
--   * entrega + shipping → "Pedido a caminho"; entrega + delivered → "Pedido entregue" (como hoje);
--   * customer_data NULL, sem a chave, com a chave NULL, ou que não é objeto: não é retirada (texto de hoje);
--   * ' store-pickup' (com espaço), 'store-pickup-x' ou 'local-delivery': não é retirada (texto de hoje);
--   * só o endereço (pickup_address) sem o id: não é retirada (a RPC nunca grava um sem o outro).
--
-- 5. QUEM LÊ
--
-- O sino da cliente (NotificationContext, realtime em notificacoes) só exibe titulo e mensagem; dados.order_id
-- segue o mesmo. Nenhum front e nenhuma edge function mudam.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda. As notificações
-- que já nasceram com o texto da entrega num pedido de retirada FICAM como estão (são histórico da cliente;
-- reescrever o sino dela seria mexer em dado de cliente sem pedido); só as mudanças de status DEPOIS do apply
-- usam o texto novo.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', ''))
-- não for UM dos dois conhecidos (o da 20261026000000 ou o desta migration); os atributos não forem os de
-- sempre (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, retorna trigger, sem argumentos); a trigger
-- não estiver ligada a ela (AFTER UPDATE OF status, por linha); faltar coluna que o corpo lê ou grava; ou a
-- ACL não for EXATAMENTE a de hoje (aberta por herança do PUBLIC, como lista
-- tests/banco/portas-do-visitante-permitidas.json). Os hashes são o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_sino_do_pedido_de_retirada_fala_de_retirada_test.ts.
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo da 20261026000000 (aplica) ou corpo desta migration (reaplicar reescreve o
-- MESMO texto). Qualquer outro estado ABORTA. Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a
-- transação é o aplicador; o pré-voo, a troca do corpo e a conferência final caem juntos ou não caem.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261026000000 (a trigger e a função; o pré-voo recusa sem elas). Independe das demais.
-- ROLLBACK MANUAL: rollback-manual-20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql devolve o
-- corpo da 20261026000000 byte a byte. NÃO apaga nenhuma notificação criada enquanto o texto novo valeu: são
-- avisos verdadeiros que a cliente já leu (ou não).
--
-- 10. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
--      -- esperado: fc8fd54a2fa1533f0d926744aab8ff58.
--   2. Num pedido de RETIRADA de teste de usuária logada: UPDATE status = 'shipping' e depois
--      SELECT titulo, mensagem FROM public.notificacoes WHERE dados->>'order_id' = '<id>' ORDER BY created_at DESC LIMIT 1;
--      -- esperado: "Pedido pronto para retirar" / "Seu pedido está pronto! Venha retirar na loja.".
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/o-sino-do-pedido-de-retirada-viva.cjs (rpc-ci); portão da release: consultas 34a e 34b.
-- ============================================================================

DO $preflight_20261233$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
  v_public boolean;
  v_falta text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: notifica_cliente_de_mudanca_de_status tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261026000000, aplica) ou o desta migration (reaplicar é no-op).
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261026000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
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

  -- O PL/pgSQL só acusa coluna ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.tabela || '.' || d.coluna, ', ' ORDER BY d.tabela, d.coluna) INTO v_falta
    FROM (VALUES
            ('marketplace_orders', 'id'), ('marketplace_orders', 'user_id'), ('marketplace_orders', 'status'),
            ('marketplace_orders', 'customer_data'),
            ('notificacoes', 'usuario_id'), ('notificacoes', 'tipo'), ('notificacoes', 'titulo'),
            ('notificacoes', 'mensagem'), ('notificacoes', 'dados')
         ) AS d(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || d.tabela)
                        AND a.attname = d.coluna AND NOT a.attisdropped AND a.attnum > 0)
      OR (d.tabela = 'marketplace_orders' AND d.coluna = 'customer_data'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = to_regclass('public.marketplace_orders')
                             AND a.attname = 'customer_data' AND a.atttypid = 'jsonb'::regtype));
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo lê ou grava não existem (ou customer_data não é jsonb): % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): aberta por herança do PUBLIC, como a
  -- lista de portas permitidas declara; o CREATE OR REPLACE a preserva e esta migration não a toca.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF NOT v_public THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC sem EXECUTE; hoje ela é aberta por herança do PUBLIC) — meça a loja e revise.', v_fn;
  END IF;
END $preflight_20261233$;

-- notifica_cliente_de_mudanca_de_status: corpo vigente da 20261026000000_o_pedido_avisa_o_cliente.sql, com o texto
-- da retirada nos dois status que mudam (a troca declarada no cabeçalho, itens 2 e 3).
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

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo mudou, se a trigger
-- saiu do lugar ou se a ACL deixou de ser a de hoje.
DO $conferencia_20261233$
DECLARE
  v_fn CONSTANT text := 'public.notifica_cliente_de_mudanca_de_status()';
  v_oid oid := to_regprocedure('public.notifica_cliente_de_mudanca_de_status()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261233: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261233: notifica_cliente_de_mudanca_de_status ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'fc8fd54a2fa1533f0d926744aab8ff58' THEN
    RAISE EXCEPTION 'conferencia 20261233: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia 20261233: atributos de % mudaram', v_fn;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgname = 'tr_pedido_avisa_o_cliente'
          AND t.tgrelid = 'public.marketplace_orders'::regclass
          AND t.tgfoid = v_oid
          AND t.tgtype = 17
     ) THEN
    RAISE EXCEPTION 'conferencia 20261233: a trigger tr_pedido_avisa_o_cliente saiu de %', v_fn;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                  WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261233: ACL de % mudou (PUBLIC perdeu EXECUTE)', v_fn;
  END IF;
END $conferencia_20261233$;
