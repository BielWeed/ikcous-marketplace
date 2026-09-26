-- O PEDIDO POR WHATSAPP FECHA PARA ANON (achado LGPD, alto — auditoria de
-- 26/09/2026).
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: `public.get_orders_by_whatsapp_v3`
-- continua executável por `anon` (e por `PUBLIC`, o que dá o mesmo alcance —
-- `anon` é só mais um papel sob o `PUBLIC` pseudo-papel) SEM exigir OTP e SEM
-- limite de tentativa nenhum. Basta telefone + e-mail da vítima e um
-- sufixo de 4+ caracteres do id do pedido ou do código de rastreio — dado que
-- a própria tela de busca pede, então não é segredo nenhum. A função devolve
-- `customer_data` CRU (`20261035000000`:102), e desde a `20261172000000`
-- (aplicada em produção hoje) `customer_data.cpf` guarda o CPF do
-- destinatário; entre 23 e 26/09 o CPF também podia estar dentro de
-- `customer_data.address` (antes de o INSERT aprender a tirar a chave do
-- endereço — ver o item MAPPER daquela migration). Nenhum front vivo chama
-- mais esta RPC (ver "CALLERS" abaixo): a porta ficou aberta sem morador.
--
-- A `20261090500000` já reduziu o alcance de 58 funções, mas listou
-- `get_orders_by_whatsapp_v3` e `get_orders_by_otp_v1` como EXCEÇÃO
-- DELIBERADA (seu cabeçalho, linhas 110-114/186-190) — na época, as duas
-- pareciam caminho legítimo de convidado. Hoje sabe-se que só a segunda é: a
-- primeira não tem tela nem RPC que a alcance.
--
-- CALLERS (grep, 26/09/2026, em `src/`, `supabase/functions/`, `scripts/` e
-- `public/`, incluindo string dinâmica — nenhuma ocorrência de
-- "get_orders_by_whatsapp" ficou de fora):
--   * `src/hooks/useOrders.ts:3034-3059` declara `fetchOrdersByWhatsapp`
--     (a única chamada de `supabase.rpc("get_orders_by_whatsapp_v3", ...)`
--     que existe no repositório) e a exporta no retorno do hook
--     (linha 3606). NENHUM outro arquivo de `src/` desestrutura ou chama
--     `fetchOrdersByWhatsapp` — nem tela, nem componente, nem outro hook.
--     Não há tela de busca de pedido por telefone/WhatsApp no app hoje
--     (a busca por rastreio vigente é só por OTP, `get_orders_by_otp_v1`).
--   * `tests/front/fragmento-do-pedido-nao-aceita-curinga.test.ts` só
--     confere o TEXTO da migration `20261035000000` (SQL como string) —
--     não chama a RPC nem exercita `fetchOrdersByWhatsapp`.
--   * `scripts/db-prove-grants-convergem.cjs:304` guarda o ALVO histórico de
--     ACL (comparação Savy × principal) com `anon: true` para esta função —
--     ele fica DESATUALIZADO por esta migration (o alvo real passa a ser
--     `false`); não é gate de CI (não entra em `npm test`) e sua correção é
--     tarefa separada, fora deste pacote (ver relatório).
--   * `src/types/database.types.ts:3187` é só o tipo gerado da RPC — não é
--     caller.
-- Conclusão: nenhum consumidor legítimo, nem `anon` nem `authenticated`.
--
-- OUTRAS VERSÕES (`get_orders_by_whatsapp`, `_v1`, `_v2`, sem sufixo): não
-- existem no schema vivo. O baseline `20260806000000` (linha 2356-2434, o
-- retrato do banco em produção naquela data) só define `_v3` — qualquer
-- versão anterior já tinha sido `DROP`ada antes do baseline ser tirado
-- (as migrations que fariam isso estão hoje arquivadas em
-- `supabase/migrations/_arquivadas/`). Nada a revogar além da `_v3`.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `REVOKE EXECUTE` de `get_orders_by_whatsapp_v3(text,text,text)` de
--      `PUBLIC`, `anon` e `authenticated` — dos três, porque nenhum consumidor
--      legítimo restou nem para convidado nem para conta logada (ver
--      CALLERS acima). `service_role`/dono/postgres NÃO são tocados (mesma
--      regra da `20261090500000`: quem chama pelo painel/edge com a chave de
--      serviço continua podendo, se um dia precisar de novo).
--   2. `CREATE OR REPLACE` de `get_orders_by_otp_v1(text,text)` — corpo
--      copiado BYTE A BYTE da última definição viva
--      (`20260950000000_rastreio_por_codigo_mostra_o_pagamento.sql:53-138`,
--      confirmado como a única `CREATE OR REPLACE` desta função depois do
--      baseline), com UMA mudança: o valor da chave `'customer_data'` deixa
--      de ser `o.customer_data` cru e passa a ser `o.customer_data` SEM a
--      chave `cpf` — nem no nível raiz, nem dentro de `customer_data.address`
--      quando `address` é um objeto (a janela 23-26/09 citada acima). Esta
--      RPC continua sendo chamada por convidado autenticado por OTP
--      (`src/hooks/useOrders.ts:3415-3485`, `fetchOrdersByOtp` — legítimo,
--      protegido por código de 6 dígitos + limite de 5 tentativas,
--      `20260950000000`), então o GRANT dela para `anon`/`authenticated`
--      (deixado como exceção pela `20261090500000`) NÃO muda aqui — só o
--      CORPO, para não devolver mais um dado que ninguém do lado do
--      cliente precisa: `src/lib/mappers.ts` (`semCpf()`, chamada em
--      `mapOrderFromDB`) já descarta `customer_data.cpf` ANTES de o pedido
--      entrar no cache do `localStorage` — nenhuma tela lê `customer.cpf` —
--      então tirar o CPF já na resposta da RPC fecha a exposição também para
--      quem lê a rede direto (devtools, `curl` com o `anon key`), sem mudar
--      NADA que a tela usa. `tests/front/mapper-cpf-nao-vai-para-o-cache.test.ts`
--      já prova o lado do mapper; este pacote acrescenta a prova do lado do
--      banco (`tests/migration_pedido_por_whatsapp_fecha_para_anon_test.ts`)
--      e um teste de front que o pedido mapeado não muda quando a RPC já
--      chega sem CPF nenhum
--      (`tests/front/otp-endereco-nao-depende-do-cpf.test.ts`).
--
-- O QUE NÃO MUDA:
--   * Assinatura de nenhuma das duas funções (mesmos parâmetros, mesmo
--     `RETURNS`) — `CREATE OR REPLACE` continua válido, sem `DROP`.
--   * `SECURITY DEFINER` + `SET search_path TO 'public'` das duas — copiados
--     de novo por extenso na `get_orders_by_otp_v1` (a casa já aprendeu, na
--     `20260950000000`, que atributo não repetido SOME em silêncio no
--     `CREATE OR REPLACE`).
--   * GRANTs de `get_orders_by_otp_v1` (`anon`/`authenticated` continuam
--     podendo chamar; `PUBLIC` continua revogado desde a `20261090500000`).
--   * `dono`, `service_role` e `postgres` das duas funções.
--   * O restante do corpo de `get_orders_by_otp_v1` — tentativas, mensagens
--     de erro, `payment_status`, `items`, `address` (o JOIN em
--     `user_addresses`, que não guarda CPF) — tudo VERBATIM.
--
-- DADOS EXISTENTES: nenhuma linha de `marketplace_orders` é lida nem
-- reescrita por esta migration — ela só troca o ACL de uma função e o CORPO
-- de outra (o que a segunda RPC DEVOLVE na próxima chamada, nunca o que está
-- gravado). Pedido que já tem `customer_data.cpf` continua tendo — só para
-- de sair na resposta desta RPC.
--
-- IDEMPOTÊNCIA: `REVOKE EXECUTE ... FROM <papel>` de um privilégio que o
-- papel já não tem é NO-OP no Postgres (aviso, não erro) — reaplicar este
-- arquivo não muda nada na segunda vez. `CREATE OR REPLACE FUNCTION` com o
-- mesmo corpo também é idempotente por natureza.
--
-- ORDEM DE APLICAÇÃO: esta migration não depende de nenhuma migration
-- numerada `20261179*`/`20261180*` de outra frente (os números 79 e 80 estão
-- reservados por outras branches) — só depende de tudo até a `20261178000000`
-- já estar aplicado (schema vivo hoje). Aplica INDEPENDENTE DE 79/80, em
-- qualquer ordem relativa a elas.
--
-- FORA DO ESCOPO: `scripts/db-prove-grants-convergem.cjs` (ALVO desatualizado
-- para `get_orders_by_whatsapp_v3`, ver CALLERS acima); qualquer tela nova de
-- busca de pedido por WhatsApp (não existe, e não é este pacote que decide se
-- deve voltar a existir); mexer em `get_orders_by_otp_v1` além do
-- `customer_data` (rate limit, formato do envelope, etc. — nada disso mudou).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada mesmo assim).
--
-- COMO APLICAR: `node scripts/db-apply.cjs
-- 20261181000000_pedido_por_whatsapp_fecha_para_anon.sql` (ou `psql -1 -f`) —
-- sem `BEGIN`/`COMMIT` de nível superior neste arquivo.
--
-- FICHA DE VERIFICAÇÃO (rodar à mão contra o banco depois de aplicar):
--   1. `SELECT has_function_privilege('anon',
--       'public.get_orders_by_whatsapp_v3(text,text,text)', 'execute');` →
--       `false` (antes desta migration: `true`).
--   2. `SELECT has_function_privilege('authenticated',
--       'public.get_orders_by_whatsapp_v3(text,text,text)', 'execute');` →
--       `false`.
--   3. `SELECT EXISTS (SELECT 1 FROM pg_proc p
--        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,
--          acldefault('f', p.proowner))) g
--        WHERE p.oid = 'public.get_orders_by_whatsapp_v3(text,text,text)'::regprocedure
--          AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);` → `false`
--       (ninguém mais alcança por `PUBLIC`).
--   4. `SET ROLE anon; SELECT public.get_orders_by_whatsapp_v3('...', '...',
--       'abcd');` (com um `RESET ROLE` depois) → erro `permission denied for
--       function get_orders_by_whatsapp_v3` (42501), não mais o histórico do
--       usuário.
--   5. `SELECT has_function_privilege('anon',
--       'public.get_orders_by_otp_v1(text,text)', 'execute');` → continua
--       `true` (rota de convidado por OTP não fechou).
--   6. Com um OTP válido de teste: `SELECT public.get_orders_by_otp_v1(
--       '<email-de-teste>', '<otp-de-teste>');` → `ok:true` e o pedido no
--       envelope SEM a chave `cpf` em `customer_data` nem em
--       `customer_data.address`, com os demais campos (endereço, itens,
--       payment_status) intactos.
--   7. Admin inalterado: `get_admin_orders_paged`/`get_admin_customers_paged`
--       (gate `is_admin()`) continuam de pé — esta migration não toca neles.
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261181000000_pedido_por_whatsapp_fecha_para_anon.sql
-- (devolve o `GRANT ... TO PUBLIC` de `get_orders_by_whatsapp_v3` e o corpo
-- EXATO que a `20260950000000` deixava para `get_orders_by_otp_v1`, na ordem
-- inversa desta migration).

REVOKE EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1("p_email" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec RECORD;
    v_max_tentativas CONSTANT integer := 5;
BEGIN
    -- Busca pelo e-mail, NÃO por e-mail + código: com o código errado não
    -- haveria linha para incrementar, e o contador nunca sairia do lugar.
    SELECT * INTO v_rec
      FROM public.otp_verifications
     WHERE email = trim(p_email)
       AND expires_at > NOW()
       AND verified = false
     ORDER BY created_at DESC
     LIMIT 1;

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
                    CASE
                        WHEN jsonb_typeof(o.customer_data -> 'address') = 'object' THEN
                            (o.customer_data - 'cpf')
                                || jsonb_build_object('address', (o.customer_data -> 'address') - 'cpf')
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
