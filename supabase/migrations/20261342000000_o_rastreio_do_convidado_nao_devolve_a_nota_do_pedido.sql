-- O RASTREIO DO CONVIDADO NAO DEVOLVE A NOTA DO PEDIDO (dado de cliente; 21/10/2026) — tira `notes` do retorno da
-- `get_orders_by_otp_v2`.
--
-- O DEFEITO: a v2 devolve `'notes', o.notes` ao aparelho de quem consulta o pedido SEM login (trio + codigo). A coluna
-- `marketplace_orders.notes` guarda a observacao da cliente, a variante e a frase "Frete Escolhido: ...", e, ate
-- 17/10/2026 (antes da 20261247000000), tambem a ANOTACAO INTERNA que a lojista escrevia no painel — misturada com o
-- resto. Depois dessa migration as anotacoes novas moram na tabela propria (so do admin de agora), mas as ANTIGAS
-- continuam em `notes` (a 20261247 deliberadamente nao copiou nem apagou nada). Resultado: o que a loja escreveu de
-- interno antes de 17/10 chega ao celular do convidado que consulta o rastreio.
--
-- O QUE MUDA: SO o retorno da funcao — a linha `'notes', o.notes` sai do JSON de cada pedido. Todo o resto do corpo e
-- IGUAL byte a byte ao da 20261341000000 (alem de um comentario novo). Quem usa: o rastreio do convidado
-- (src/hooks/useOrders.ts `fetchOrdersByOtp` -> `mapOrderFromDB`, que le `row.notes || undefined`): sem o campo o pedido
-- chega com `notes` indefinido e nenhuma tela do visitante mostra esse texto (conferido em src/: so as telas do painel
-- — OrderDetail, EtiquetaDoPedidoCard — leem `notes`, e elas leem a tabela com a permissao do admin, nao esta RPC).
-- Nenhum arquivo do front precisa mudar.
--
-- O QUE NAO MUDA / FICA DE FORA: nao migra nem limpa dado (as anotacoes antigas continuam em `notes`, e a cliente logada
-- continua lendo o `notes` dos PROPRIOS pedidos pela tabela; mover/limpar dado e decisao do dono, separada). Cache local ja
-- gravado no aparelho de alguem (localStorage do rastreio, antes desta migration) nao pode ser apagado daqui.
-- Assinatura, RETURNS, SECURITY DEFINER, `search_path = public` e EXECUTE nao mudam.
--
-- DADOS EXISTENTES: nenhuma linha e lida ou reescrita ao aplicar — so troca o corpo de uma funcao.
--
-- IDEMPOTENCIA: `CREATE OR REPLACE`; o pre-voo aceita o corpo da 20261341000000 OU o desta migration. Se o corpo vivo for
-- o da 20261217000000 (a 20261341 ainda nao foi aplicada) ou qualquer outro, RECUSA sem escrever: aplique a 20261341 antes —
-- esta migration NAO traz de volta a corrida do teto de tentativas.
--
-- PRE-VOO / B1_BASELINE_DIVERGENT: o `DO $preflight_20261342$`, ANTES de qualquer escrita, recusa se o md5 (sem CR) do corpo vivo
-- nao for 34199947ecded0fd9400b5fd0276ea47 (20261341000000) nem 02208ac9d2abe2e8b03790349d491ecb (esta), ou se os atributos / o EXECUTE nao forem os da 20261217000000.
-- A conferencia final repete a checagem do corpo e do EXECUTE.
--
-- TRANSACAO: sem `BEGIN`/`COMMIT` de nivel superior (regra da casa, AGENTS.md): pre-voo, funcao e conferencia caem juntos ou
-- nao caem.
--
-- ORDEM: depois da 20261341000000. Banco antes do front nao importa (o front nao muda).
--
-- COMO APLICAR: workflow `aplicar-migrations.yml`, `migracoes = 20261342000000_o_rastreio_do_convidado_nao_devolve_a_nota_do_pedido.sql`.
--
-- FICHA DE VERIFICACAO: (1) o corpo vivo de `get_orders_by_otp_v2` tem o md5 02208ac9d2abe2e8b03790349d491ecb e nenhum `o.notes` (consulta 66a);
-- (2) o JSON do pedido tem as mesmas chaves de antes MENOS `notes`; (3) EXECUTE igual antes e depois.
--
-- PROVA VIVA: tests/banco/rastreio-do-convidado-viva.cjs (rpc-ci) — pedido com nota (observacao da cliente + anotacao antiga)
-- consultado pelo convidado: o JSON nao tem a chave `notes`, nem o texto da nota em lugar nenhum; as demais chaves seguem
-- (CPF continua fora); CONTROLE: o corpo da 20261341 devolve a nota; rollback devolve o corpo da 20261341 byte a byte.
--
-- ROLLBACK MANUAL: rollback-manual-20261342000000_o_rastreio_do_convidado_nao_devolve_a_nota_do_pedido.sql devolve o corpo da
-- 20261341000000 byte a byte (e recusa se o corpo vivo nao for o desta migration).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261342$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)');

  IF v_hash IS NULL OR v_hash NOT IN ('34199947ecded0fd9400b5fd0276ea47', '02208ac9d2abe2e8b03790349d491ecb') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.get_orders_by_otp_v2(text,text,text,text) (hash %) nao e o da 20261341000000 nem o que esta migration deixa (a 20261342 vem DEPOIS da 20261341) — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos e ACL que o CREATE OR REPLACE preserva: se nao forem os da 20261217000000, algo mexeu depois.
  IF NOT EXISTS (
       SELECT 1
         FROM pg_proc p
         JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
     )
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)') AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos ou EXECUTE de public.get_orders_by_otp_v2(text,text,text,text) nao sao os da 20261217000000 (plpgsql, SECURITY DEFINER, search_path=public, anon/authenticated/service_role sim, PUBLIC nao) — revise antes de aplicar.';
  END IF;
END $preflight_20261342$;

CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2("p_email" "text", "p_whatsapp" "text", "p_fragmento" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec RECORD;
    v_max_tentativas CONSTANT integer := 5;
    v_fragmento text := trim(coalesce(p_fragmento, ''));
BEGIN
    -- O trio, com as MESMAS regras da generate_order_otp_v2 (20260820000000):
    -- os dois canais obrigatorios e o fragmento so com o alfabeto de um UUID.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = ''
       OR v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    END IF;

    -- So o codigo do pedido que confere com o trio. Quem sabe so o e-mail nao
    -- alcanca codigo nenhum, logo nao gasta tentativa de ninguem nem descobre
    -- se ha codigo ativo: sem trio, a resposta e' a mesma de "nao ha codigo".
    -- 20261341: a linha do codigo fica TRAVADA (so a de otp_verifications, nao a do pedido) ate o fim desta
    -- chamada. Sem a trava, N chamadas simultaneas liam a mesma contagem de tentativas, cada uma errava
    -- e gravava "+1" sobre o mesmo valor: o teto de 5 nao valia. Agora a segunda espera a primeira
    -- terminar e le a contagem ja atualizada (ou, se o codigo ja foi usado, nao o encontra mais).
    SELECT v.* INTO v_rec
      FROM public.otp_verifications v
      JOIN public.marketplace_orders o ON o.id = v.order_id
      LEFT JOIN auth.users u ON u.id = o.user_id
     WHERE regexp_replace(
               coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
               '[^0-9]', '', 'g'
           ) = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
       AND (
             LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(trim(p_email))
          OR LOWER(coalesce(u.email, ''))                   = LOWER(trim(p_email))
       )
       AND o.id::text ILIKE '%' || v_fragmento
       AND v.expires_at > NOW()
       AND v.verified = false
     ORDER BY v.created_at DESC
     LIMIT 1
     FOR UPDATE OF v;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    END IF;

    IF v_rec.attempts >= v_max_tentativas THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código bloqueado por excesso de tentativas. Peça um novo.');
    END IF;

    IF v_rec.otp_code IS DISTINCT FROM p_otp THEN
        UPDATE public.otp_verifications
           SET attempts = attempts + 1
         WHERE id = v_rec.id;
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Código inválido ou expirado.',
            'restantes', v_max_tentativas - (v_rec.attempts + 1)
        );
    END IF;

    UPDATE public.otp_verifications SET verified = TRUE WHERE id = v_rec.id;

    -- 20261342: a coluna notes NAO sai mais daqui. Ela guarda a observacao da cliente MISTURADA com a
    -- anotacao interna que a loja gravava ali antes de 17/10/2026 (20261247); a tela do convidado nao a usa.
    -- Um pedido, o que o código comprou. Nunca a lista por e-mail ou WhatsApp.
    RETURN jsonb_build_object(
        'ok', true,
        'orders', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', o.id,
                'user_id', o.user_id,
                'total', o.total,
                'subtotal', o.subtotal,
                'shipping', o.shipping,
                'discount', o.discount,
                'payment_method', o.payment_method,
                'status', o.status,
                'payment_status', o.payment_status,
                'coupon_code', o.coupon_code,
                'tracking_code', o.tracking_code,
                'created_at', o.created_at,
                'updated_at', o.updated_at,
                'customer_name', o.customer_name,
                'customer_data', (
                    -- LGPD (migration 20261181000000, achado alto): o CPF do
                    -- destinatário nunca sai desta RPC — nem em
                    -- `customer_data.cpf` (migration 20261172) nem dentro de
                    -- `customer_data.address` (janela 23-26/09, antes de o
                    -- INSERT do pedido aprender a tirar a chave do endereço).
                    -- Quem chega até aqui só provou o OTP do PRÓPRIO pedido —
                    -- não precisa do CPF para nada nesta tela: o front já
                    -- descarta a chave antes de guardar o pedido no cache do
                    -- localStorage (src/lib/mappers.ts, semCpf()), e é o
                    -- servidor (melhor-envio-etiqueta) quem usa o CPF para
                    -- emitir a etiqueta, nunca o navegador de quem digitou o
                    -- código.
                    --
                    -- RODADA 2 (revisão de risco):
                    --   * achado 4 — `customer_data` ESCALAR (não objeto) não
                    --     tem chave para `jsonb - text` tirar; sem este
                    --     primeiro WHEN, `o.customer_data - 'cpf'` explode com
                    --     "cannot delete from scalar" e derruba a verificação
                    --     de OTP inteira para aquele pedido. Devolve o valor
                    --     cru: não há CPF para vazar dentro de um escalar.
                    --   * achado 5 — quando `address` era só `{"cpf":"..."}`,
                    --     tirar a chave deixava `{}` (TRUTHY em JS, vencia
                    --     `row.address` — o endereço de verdade do JOIN — na
                    --     cadeia `||` de `src/lib/mappers.ts`). Vira JSON
                    --     `null` (mesma régua da `20261172`,
                    --     `v_address_data_sem_cpf`): `null` também é
                    --     `typeof === "object"` em JS, mas é FALSY, então a
                    --     cadeia cai para a próxima fonte.
                    --   * achado 6 (informativo, sem código) — `address` como
                    --     ARRAY não entra no segundo WHEN (`jsonb_typeof` diz
                    --     'array', não 'object') e mantém qualquer `cpf`
                    --     aninhado. O front nunca manda array em `address`
                    --     (só objeto ou string); se um dia mandar, este
                    --     ponto precisa ser revisto.
                    CASE
                        WHEN jsonb_typeof(o.customer_data) <> 'object' THEN o.customer_data
                        WHEN jsonb_typeof(o.customer_data -> 'address') = 'object' THEN
                            (o.customer_data - 'cpf')
                                || jsonb_build_object(
                                     'address',
                                     CASE
                                         WHEN ((o.customer_data -> 'address') - 'cpf') = '{}'::jsonb THEN NULL
                                         ELSE (o.customer_data -> 'address') - 'cpf'
                                     END
                                   )
                        ELSE
                            o.customer_data - 'cpf'
                    END
                ),
                'items', (
                    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', oi.id,
                        'order_id', oi.order_id,
                        'product_id', oi.product_id,
                        'variant_id', oi.variant_id,
                        'quantity', oi.quantity,
                        'price', oi.price,
                        'product_name', oi.product_name,
                        'image_url', oi.image_url
                    )), '[]'::jsonb)
                      FROM public.marketplace_order_items oi
                     WHERE oi.order_id = o.id
                ),
                'address', (
                    SELECT to_jsonb(addr.*)
                      FROM public.user_addresses addr
                     WHERE addr.id = o.address_id
                )
            )), '[]'::jsonb)
              FROM public.marketplace_orders o
             WHERE o.id = v_rec.order_id
        )
    );
END;
$$;

-- CONFERENCIA no instante do apply: aborta (e desfaz tudo) se o corpo vivo nao ficou o desta migration ou o EXECUTE mudou.
DO $conferencia_20261342$
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')) IS DISTINCT FROM '02208ac9d2abe2e8b03790349d491ecb' THEN
    RAISE EXCEPTION 'conferencia 20261342: o corpo vivo de public.get_orders_by_otp_v2(text,text,text,text) nao e o desta migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)') AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261342: EXECUTE de public.get_orders_by_otp_v2(text,text,text,text) mudou (PUBLIC aberto, ou o convidado ficou sem rastreio).';
  END IF;
END $conferencia_20261342$;

NOTIFY pgrst, 'reload schema';
