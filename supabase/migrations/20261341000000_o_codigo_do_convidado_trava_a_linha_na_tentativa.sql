-- O CODIGO DO CONVIDADO TRAVA A LINHA NA TENTATIVA (permissao + dado de cliente; 21/10/2026) — fecha a corrida que
-- furava o teto de 5 tentativas da `get_orders_by_otp_v2` (20261217000000).
--
-- O DEFEITO: a v2 le o registro do codigo SEM trava (`SELECT ... LIMIT 1`), confere `attempts >= 5` em MEMORIA e, se o
-- codigo esta errado, faz `UPDATE ... SET attempts = attempts + 1` sem condicao. Com N chamadas ao mesmo tempo, todas
-- leem a MESMA contagem (por exemplo 0), todas avaliam o codigo e cada uma grava "+1" por cima: o teto de 5 nao vale e
-- quem sabe o trio (e-mail + WhatsApp + fragmento do pedido) pode tentar os 1.000.000 de codigos de 6 digitos muito
-- alem de 5, em paralelo, dentro dos 15 minutos de vida do codigo.
--
-- O QUE MUDA: SO a leitura do registro do codigo. O `SELECT` ganha `FOR UPDATE OF v` (a linha de `otp_verifications`,
-- nao a do pedido nem a do usuario). Cada chamada pega a linha, confere, grava e solta no fim da propria chamada;
-- a seguinte ESPERA e le a contagem ja atualizada (e, se o codigo ja foi usado, nem o encontra mais: a resposta e a
-- mesma de "nao ha codigo"). Resultado: no maximo 5 avaliacoes do codigo, qualquer que seja o paralelismo. O resto do
-- corpo — o trio, as respostas, o JSON devolvido, o CPF fora do `customer_data` — e IGUAL byte a byte a 20261217000000
-- (alem de um comentario novo explicando a trava).
--
-- COMPORTAMENTO QUE NAO MUDA: o convidado que digita o codigo certo recebe o pedido; o errado recebe a mesma mensagem e
-- o mesmo "restantes"; o sexto erro recebe a mesma mensagem de bloqueio; sem o trio a resposta continua igual a de "nao
-- ha codigo". Assinatura, RETURNS, SECURITY DEFINER, `search_path = public` e os EXECUTE (anon, authenticated e
-- service_role sim; PUBLIC nao) nao mudam: `CREATE OR REPLACE` preserva a ACL e o pre-voo/a conferencia comprovam.
--
-- CONCORRENCIA E DEADLOCK: so UMA linha e travada, na ordem fixa "pega a linha, grava, solta". A `generate_order_otp_v2` (que
-- cria/renova o codigo) mexe na mesma tabela por outras chaves e nao segura a linha enquanto espera nada; nao ha ordem
-- invertida entre duas linhas, portanto nao ha ciclo de espera. Quem espera a trava espera no maximo o tempo de UMA chamada
-- (milissegundos); `lock_timeout` desta migration vale so para o apply, nao para a funcao.
--
-- A v1 (`get_orders_by_otp_v1`) tem o mesmo desenho, mas a 20261220000000 a FECHOU para o visitante (EXECUTE so do
-- service_role): fora deste lote.
--
-- DADOS EXISTENTES: nenhuma linha e lida ou reescrita ao aplicar — so troca o corpo de uma funcao. Codigos ja gastos ou
-- com tentativas parciais ficam como estao.
--
-- IDEMPOTENCIA: `CREATE OR REPLACE`; o pre-voo aceita o corpo de antes (20261217000000) OU o desta migration — reaplicar
-- produz o mesmo estado. Se o corpo vivo for qualquer outro (inclusive o da 20261342000000, que vem DEPOIS), RECUSA sem
-- escrever: reaplicar esta por cima da 1342 voltaria a expor a nota do pedido.
--
-- PRE-VOO / B1_BASELINE_DIVERGENT: `CREATE OR REPLACE FUNCTION` em plpgsql nao valida o corpo vivo; substituir um corpo
-- desconhecido apagaria em silencio a correcao de outra migration. O `DO $preflight_20261341$`, ANTES de qualquer escrita,
-- recusa se o md5 (sem CR) do corpo vivo nao for 53b5e632657b82206daa6aa992a50c0d (20261217000000) nem 34199947ecded0fd9400b5fd0276ea47 (esta), ou se os atributos / o
-- EXECUTE nao forem os de 20261217000000. A conferencia final repete a checagem do corpo e do EXECUTE.
--
-- TRANSACAO: sem `BEGIN`/`COMMIT` de nivel superior (regra da casa, AGENTS.md): o aplicador abre a transacao e o ledger
-- juntos — pre-voo, funcao e conferencia caem juntos ou nao caem.
--
-- ORDEM: depois da 20261217000000 (a funcao nasce la) e da 20261220000000. Nenhuma edge function e nenhum front mudam:
-- o app chama a mesma RPC com os mesmos parametros e le o mesmo JSON.
--
-- COMO APLICAR: workflow `aplicar-migrations.yml`, `migracoes = 20261341000000_o_codigo_do_convidado_trava_a_linha_na_tentativa.sql`.
--
-- FICHA DE VERIFICACAO: (1) o corpo vivo de `get_orders_by_otp_v2` tem `FOR UPDATE OF v` UMA vez e o md5 34199947ecded0fd9400b5fd0276ea47 (consulta
-- 65a); (2) EXECUTE igual antes e depois; (3) o rastreio do convidado (trio -> codigo -> pedido) segue igual.
--
-- PROVA VIVA: tests/banco/rastreio-do-convidado-viva.cjs (rpc-ci) — 30 chamadas paralelas com codigo errado avaliam o codigo
-- NO MAXIMO 5 vezes e deixam `attempts = 5`; CONTROLE: o mesmo teste com o corpo antigo (com uma pausa na janela da leitura)
-- avalia muito mais; rollback devolve o corpo da 20261217000000 byte a byte; pre-voo recusa sem escrita.
--
-- ROLLBACK MANUAL: rollback-manual-20261341000000_o_codigo_do_convidado_trava_a_linha_na_tentativa.sql devolve o corpo da
-- 20261217000000 byte a byte (e recusa se o corpo vivo nao for o desta migration).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261341$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)');

  IF v_hash IS NULL OR v_hash NOT IN ('53b5e632657b82206daa6aa992a50c0d', '34199947ecded0fd9400b5fd0276ea47') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.get_orders_by_otp_v2(text,text,text,text) (hash %) nao e o vigente (20261217000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
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
END $preflight_20261341$;

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
                'notes', o.notes,
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
DO $conferencia_20261341$
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)')) IS DISTINCT FROM '34199947ecded0fd9400b5fd0276ea47' THEN
    RAISE EXCEPTION 'conferencia 20261341: o corpo vivo de public.get_orders_by_otp_v2(text,text,text,text) nao e o desta migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)') AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR NOT has_function_privilege('anon', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_orders_by_otp_v2(text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261341: EXECUTE de public.get_orders_by_otp_v2(text,text,text,text) mudou (PUBLIC aberto, ou o convidado ficou sem rastreio).';
  END IF;
END $conferencia_20261341$;

NOTIFY pgrst, 'reload schema';
