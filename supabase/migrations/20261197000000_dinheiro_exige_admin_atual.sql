-- O DINHEIRO EXIGE O ADMIN DE AGORA (permissão + dinheiro; 04/10/2026) —
-- cria `public.is_admin_atual()` e a acrescenta como guarda ADICIONAL nas
-- RPCs que movem dinheiro ou estoque.
--
-- O DEFEITO (auditoria): `public.is_admin()` (baseline 20260806000000)
-- responde `true` assim que o JWT diz `app_metadata.role = 'admin'`, ANTES de
-- olhar o papel atual. O JWT vale até expirar (~1 h): um admin rebaixado
-- (profiles.role -> 'customer', ou o app_metadata trocado no painel do
-- Supabase) continua, nessa janela, pedindo estorno, registrando estorno feito
-- fora, concluindo/reemitindo reembolso de devolução e registrando (ou
-- desfazendo) pagamento recebido na entrega.
--
-- O QUE NÃO SE FAZ: `is_admin()` NÃO muda — ela está em dezenas de policies de
-- RLS e RPCs; trocar a fonte dela às cegas é proibido. A guarda nova se SOMA:
-- cada RPC abaixo continua chamando `is_admin()` primeiro, exatamente como
-- antes, e só depois `is_admin_atual()`. O conjunto de quem passa só ENCOLHE.
--
-- A AUTORIDADE ATUAL: as DUAS fontes do papel, lidas agora, têm de dizer
-- 'admin' — `auth.users.raw_app_meta_data ->> 'role'` (o campo do fallback de
-- `is_admin()`) E `profiles.role` (o que as edges de dinheiro, como
-- estornar-pagamento, conferem). Papéis contraditórios NÃO autorizam
-- dinheiro. O conjunto de papéis é o de `is_admin()`: só 'admin'
-- (gerente/vendedor nunca passaram). Por que as duas, e não uma:
-- `tr_sync_profile_role_to_auth` (AFTER INSERT OR UPDATE OF role ON profiles)
-- copia profiles.role -> auth.users na mesma transação, mas só nessa direção:
-- o rebaixamento feito direto no app_metadata (painel do Supabase) deixa
-- profiles dizendo admin, e um profiles rebaixado com o gatilho fora do ar (ou
-- um UPDATE em auth.users depois) deixa auth.users dizendo admin. Exigir as
-- duas fecha as duas direções, e a edge estornar-pagamento passa a exigir as
-- mesmas duas (mesmo commit) — a função e a edge têm UMA regra só.
-- EFEITO COLATERAL ACEITO: quem é admin para `is_admin()` só pelo
-- app_metadata (sem profiles.role = 'admin') para de mexer em dinheiro aqui —
-- já não conseguia pela edge estornar-pagamento, que sempre exigiu profiles.
-- Antes de aplicar numa loja, conferir que ninguém está nesse meio-termo:
--   SELECT u.id FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
--    WHERE (u.raw_app_meta_data ->> 'role' = 'admin')
--          IS DISTINCT FROM (p.role = 'admin');
-- (zero linhas = ninguém perde acesso; cada linha é um papel contraditório
-- que o dono decide qual é o certo).
--
-- `is_admin_atual()`: STABLE, SECURITY DEFINER, `search_path = public`, tudo
-- qualificado. (a) libera o GUC `role` em 'postgres'/'service_role' — a
-- mesma detecção de `is_admin()`, contrato da automação de confiança (cron,
-- edge com a chave de serviço); (b) para usuário logado exige
-- `auth.uid()` não nulo E o papel 'admin' AGORA em auth.users E em profiles;
-- (c) o resto é false. GRANT: só o necessário — as RPCs guardadas são SECURITY DEFINER e a
-- chamam como o dono, então ninguém de fora precisa de EXECUTE: REVOKE de
-- PUBLIC, anon e authenticated (o EXECUTE que o default privileges do
-- Supabase dá ao service_role fica — mesma forma de `check_is_admin()`,
-- 20261090500000).
--
-- AS RPCs GUARDADAS (as que movem dinheiro ou estoque), e por quê:
--   solicitar_estorno                 abre linha em order_refunds (o estorno
--                                     que a edge/cron executam no MP).
--   registrar_estorno_manual          marca o pedido `estornado` e tira a
--                                     linha `solicitado` da fila.
--   admin_devolucao_concluir          reestoca itens e abre o reembolso
--                                     (order_refunds ou manual).
--   admin_devolucao_reemitir_reembolso abre NOVA linha em order_refunds, ou
--                                     converte o reembolso em manual.
--   admin_devolucao_liberar_vinculo_reverso solta o vínculo com o envio
--                                     reverso PAGO no Melhor Envio — o
--                                     próximo "Gerar" compra outra etiqueta.
--   registrar_pagamento_recebido      grava `recebido_na_entrega` (dinheiro
--                                     que entrou na mão) ou o desfaz — é o
--                                     que o Financeiro conta na gaveta.
-- FICAM DE FORA (não movem dinheiro nem estoque): admin_devolucao_decidir,
-- admin_devolucao_registrar, admin_devolucao_reprovar (só mudam o estado da
-- devolução) e admin_devolucao_listar (leitura).
--
-- A GUARDA em cada uma: um bloco próprio LOGO DEPOIS do `IF NOT
-- public.is_admin() ... END IF;`, antes de qualquer leitura, trava ou escrita,
-- com a MESMA mensagem e o MESMO SQLSTATE que a função já usa para quem não é
-- admin — o rebaixado é tratado igual ao "não é admin" de sempre: 42501 nas
-- cinco primeiras; em registrar_pagamento_recebido a recusa de não-admin
-- sempre foi `RAISE EXCEPTION` sem ERRCODE (P0001, 'Não autorizado: ...'), e
-- a guarda repete exatamente isso (o front, useOrders.ts, não lê o código).
-- O bloco do `is_admin()` fica intacto, byte a byte (o mapa de
-- scripts/db-apply.cjs da 20261072000000 conta `IF NOT public.is_admin()
-- THEN` em registrar_estorno_manual). Em registrar_pagamento_recebido a
-- guarda vem antes da recusa de `p_recebido` NULL da 20261195000000 (quem não
-- é admin agora não aprende nada). Fora o bloco novo, cada corpo é o vigente
-- byte a byte: solicitar_estorno, admin_devolucao_concluir e
-- admin_devolucao_reemitir_reembolso da 20261175000000;
-- admin_devolucao_liberar_vinculo_reverso da 20261179000000;
-- registrar_estorno_manual da 20261194000000; registrar_pagamento_recebido da
-- 20261195000000. Assinaturas, RETURNS, SECURITY DEFINER e search_path não
-- mudam; `CREATE OR REPLACE` preserva a ACL de cada RPC (nenhum GRANT/REVOKE
-- nelas aqui). A assinatura não muda: nenhum chamador
-- (src/hooks/useEstornosDoPedido.ts, src/views/admin/AdminOrdersView.tsx,
-- src/hooks/useDevolucoesAdmin.ts, src/hooks/useOrders.ts) precisa mudar.
--
-- RLS FINANCEIRA: as mesmas regras valem para LER e mexer direto nas tabelas
-- do dinheiro. Antes desta migration, as políticas de admin de
-- `marketplace_orders` (select/update/insert/delete, baseline 20260806000000)
-- e `order_refunds_admin_all` (2026110000000) usavam `is_admin()` — o ex-admin
-- com JWT velho continuava LENDO pedido alheio (nome, telefone, valores) e o
-- ledger de estornos. Elas passam a usar `public.rls_admin_atual()`: a política
-- roda como o usuário, e `is_admin_atual()` é privada; o embrulho é do dono,
-- STABLE, SECURITY DEFINER, `search_path = public`, só devolve o boolean, com
-- EXECUTE para authenticated (REVOKE de PUBLIC e anon — as cinco políticas são
-- `TO authenticated`). Sem laço: ele lê profiles e auth.users como DONO (sem
-- RLS), e a política de profiles (que chama is_admin()) nunca é avaliada.
-- `(SELECT ...)` mantém a avaliação UMA vez por consulta. O que NÃO muda: o dono
-- do pedido continua vendo o próprio (`auth.uid() = user_id`, mesma
-- expressão), `order_refunds_cliente_le` (dono) intacta, papéis e comandos das
-- políticas iguais (ALTER POLICY só troca a expressão), service_role (que no
-- Supabase ignora RLS) intocado. `rls_admin_atual()` ⊆ `is_admin()` para
-- authenticated (exige o admin em auth.users, que o fallback de is_admin() já
-- aceita): trocar a porta só ENCOLHE quem passa. Fora do escopo daqui (outra
-- frente): as outras tabelas que ainda usam `is_admin()` (itens do pedido,
-- histórico de pagamento, devoluções...) e a ACL de anon em marketplace_orders.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — troca
-- corpo de função, cria duas funções e troca a expressão de cinco políticas.
-- Estorno, devolução ou reembolso que um admin rebaixado JÁ fez antes desta
-- migration fica como está (a guarda só vale para o próximo clique).
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE`, REVOKE/GRANT repetíveis e ALTER POLICY
-- com a mesma expressão; o preflight aceita, para cada função e cada
-- política, o estado de antes OU o que esta migration deixa — reaplicar
-- produz o mesmo estado.
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: `CREATE OR REPLACE FUNCTION` em plpgsql
-- não valida o corpo na criação, e substituir um corpo vivo que NÃO é o
-- esperado apagaria em silêncio a correção de outra migration. O
-- `DO $preflight_20261197$`, ANTES de qualquer escrita, recusa se: (1) o corpo
-- vivo de cada RPC, por `md5(replace(prosrc, E'\r', ''))`, não for nem o
-- vigente nem o desta migration; (2) `is_admin()` não for o corpo da baseline
-- (a guarda espelha a detecção dela — num banco com outro `is_admin()`, a
-- premissa não vale); (3) `is_admin_atual()` ou `rls_admin_atual()` existir
-- com outro corpo; (4) a expressão viva (USING e WITH CHECK, deparseada com
-- `search_path = pg_catalog`, nomes sempre qualificados) e o comando de cada
-- uma das cinco políticas não forem nem os vigentes nem os desta migration.
-- Os hashes são o md5 REAL dos corpos, amarrados ao texto dos arquivos por
-- tests/migration_dinheiro_exige_admin_atual_test.ts.
--
-- TRANSAÇÃO: sem `BEGIN`/`COMMIT` de nível superior (regra da casa,
-- AGENTS.md: com eles o `ROLLBACK` da prova do workflow vira no-op). O
-- workflow `aplicar-migrations.yml` manda o arquivo inteiro numa consulta só
-- — o preflight, as duas funções novas, os grants, as seis redefinições e as
-- cinco políticas caem juntos ou não caem.
--
-- ORDEM DE APLICAÇÃO: depois da 20261194000000 e da 20261195000000 (o
-- preflight recusa sem elas). Nenhuma tela muda. A edge estornar-pagamento
-- muda no mesmo commit (só a porta de admin) e NÃO depende desta migration:
-- lê profiles e o usuário do Auth, não chama is_admin_atual() — pode subir
-- antes ou depois.
--
-- COMO APLICAR: workflow `aplicar-migrations.yml` (Actions -> Run workflow),
-- `migracoes = 20261197000000_dinheiro_exige_admin_atual.sql`.
--
-- FICHA DE VERIFICAÇÃO:
--   1. `is_admin_atual()` existe com `proacl` sem anon, authenticated nem
--      PUBLIC; `rls_admin_atual()` existe com EXECUTE para authenticated e
--      sem anon/PUBLIC.
--   2. Cada uma das seis RPCs contém `IF NOT public.is_admin_atual() THEN`
--      UMA vez, logo depois do `is_admin()`.
--   3. `pg_policies` das cinco políticas mostra `rls_admin_atual()` no lugar
--      de `is_admin()`; `order_refunds_cliente_le` igual.
--   4. Admin de verdade no painel: lista de pedidos, "Devolver dinheiro",
--      "Já estornei", concluir devolução e "Recebi" seguem funcionando;
--      cliente vê os próprios pedidos.
--   5. `proacl` das seis RPCs igual antes e depois.
--
-- PROVA VIVA: tests/banco/admin-atual-viva.cjs (rpc-ci) — admin rebaixado com
-- JWT velho, nas DUAS direções (só profiles, só auth.users) -> a recusa de
-- não-admin sem escrita, cliente idem, anon sem EXECUTE, admin atual e
-- service_role passam, controle sem a guarda escreve; RLS: o ex-admin vê 0
-- pedidos e 0 linhas do ledger alheios (sem erro) e continua vendo o próprio;
-- rollback volta byte a byte e recusa sem escrita quando o estado vivo não é
-- o desta migration.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261197000000_dinheiro_exige_admin_atual.sql
-- restaura, byte a byte, os seis corpos e as cinco expressões de antes e apaga
-- `rls_admin_atual()` e `is_admin_atual()`.

DO $preflight_20261197$
DECLARE
  r record;
  v_hash text;
  v_caminho text;
  v_qual text;
  v_check text;
  v_cmd text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.solicitar_estorno(uuid, numeric, text)', 'ee9fe85d9b18b0e38e23cf48dd3b1111', '069c3d12a470cc4708099d909c57ca02'),
        ('public.registrar_estorno_manual(uuid)', '18ea2e76d075634b57189592fb91ac0d', '6901cdc521dfae408836a150a5752ad0'),
        ('public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)', '2207a35be5937de4e1f6205dcd3340d1', '26080db4aeb82bdfb9fcd0c6f7169ebb'),
        ('public.admin_devolucao_reemitir_reembolso(uuid, boolean)', '06c92efbbf5b3db1f97853e121612c88', '7a5ce4978a989e1bebb3d048d347c0c6'),
        ('public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)', '83144be5ac2bc52f07f02274023a83ab', '8314060e4e11eeab71d077fd76e0398f'),
        ('public.registrar_pagamento_recebido(uuid, boolean)', '0a594768d4836bcc6d5064ce537b47dc', '6584d62da7815a913b1e0cb86c108b0f')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.is_admin()');

  IF v_hash IS DISTINCT FROM 'e4e624331673f15aaeb4a6703fef2d7c' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.is_admin() (hash %) não é o da baseline — a guarda is_admin_atual() espelha a detecção dela; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
        ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NOT NULL AND v_hash <> r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com outro corpo (hash %) — revise antes de aplicar.', r.assinatura, v_hash;
    END IF;
  END LOOP;

  -- Expressões das políticas deparseadas com search_path = pg_catalog (nomes
  -- sempre qualificados, independente do search_path de quem aplica); o
  -- search_path volta logo depois.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.marketplace_orders', 'marketplace_orders_select_policy', 'r',
         '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))', NULL::text,
         '((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.marketplace_orders', 'marketplace_orders_admin_update_policy', 'w',
         '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)',
         '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.marketplace_orders', 'marketplace_orders_admin_insert_policy', 'a',
         NULL::text, '( SELECT public.is_admin() AS is_admin)',
         NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.marketplace_orders', 'marketplace_orders_admin_delete_policy', 'd',
         '( SELECT public.is_admin() AS is_admin)', NULL::text,
         '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.order_refunds', 'order_refunds_admin_all', '*',
         'public.is_admin()', 'public.is_admin()',
         '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
      ) AS esperado(tabela, politica, comando, qual_vigente, check_vigente, qual_desta, check_desta)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), p.polcmd::text
      INTO v_qual, v_check, v_cmd
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela)
       AND p.polname = r.politica;

    IF NOT FOUND
       OR v_cmd IS DISTINCT FROM r.comando
       OR NOT (
            (v_qual IS NOT DISTINCT FROM r.qual_vigente AND v_check IS NOT DISTINCT FROM r.check_vigente)
         OR (v_qual IS NOT DISTINCT FROM r.qual_desta AND v_check IS NOT DISTINCT FROM r.check_desta)
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: política % em % (USING %, WITH CHECK %) não é a vigente antes desta migration nem a que ela deixa — revise antes de aplicar.', r.politica, r.tabela, COALESCE(v_qual, 'nulo'), COALESCE(v_check, 'nulo');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_20261197$;

CREATE OR REPLACE FUNCTION public.is_admin_atual()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- (a) Automação de confiança: a MESMA detecção de public.is_admin()
  --     (baseline) — o GUC 'role' da sessão, que o PostgREST põe em
  --     'service_role' na chave de serviço. Usuário logado não o altera.
  -- (b) Usuário logado: o papel de AGORA nas DUAS fontes — auth.users
  --     (raw_app_meta_data, o fallback de is_admin()) E profiles.role (o
  --     que as edges de dinheiro conferem). Papéis contraditórios não
  --     autorizam dinheiro. Nunca o app_metadata do JWT, que vale até expirar.
  -- (c) Qualquer outra coisa: false.
  SELECT COALESCE(current_setting('role', true), '') IN ('postgres', 'service_role')
      OR (
           auth.uid() IS NOT NULL
           AND EXISTS (
                 SELECT 1
                   FROM auth.users u
                  WHERE u.id = auth.uid()
                    AND (u.raw_app_meta_data ->> 'role') = 'admin'
               )
           AND EXISTS (
                 SELECT 1
                   FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND p.role = 'admin'
               )
         );
$$;

REVOKE ALL ON FUNCTION public.is_admin_atual() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rls_admin_atual()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Porta das POLÍTICAS de RLS: a política roda como o usuário, e
  -- is_admin_atual() é privada (sem EXECUTE para authenticated). Este
  -- embrulho, do dono, só devolve o boolean — a MESMA regra das RPCs e da
  -- edge. Lê profiles e auth.users como dono (sem RLS): nenhum laço com a
  -- política de profiles, que chama is_admin().
  SELECT public.is_admin_atual();
$$;

REVOKE ALL ON FUNCTION public.rls_admin_atual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_estorno(
    p_order_id uuid,
    p_amount numeric,
    p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_payment_status TEXT;
    v_paid_at TIMESTAMPTZ;
    v_total NUMERIC;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
    v_valor_estornado NUMERIC;
    v_em_curso NUMERIC;
    v_ja_manual NUMERIC;
    v_saldo NUMERIC;
    v_refund_id UUID;
BEGIN
    -- So' a loja pede devolucao pelo painel. ERRCODE 42501 para o front
    -- distinguir "nao e' a loja" de qualquer outro erro.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Somente a loja pede a devolução pelo painel.'
            USING ERRCODE = '42501';
    END IF;

    SELECT status, payment_status, paid_at, total,
           cancelled_after_shipping, returned_to_seller_at, valor_estornado
      INTO v_status, v_payment_status, v_paid_at, v_total,
           v_cancelled_after_shipping, v_returned_at, v_valor_estornado
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Dinheiro que nao entrou nao se devolve. IS NULL explicito porque
    -- `NULL NOT IN (...)` avaliaria para NULL e o IF nao dispararia.
    IF v_payment_status IS NULL
       OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN
        RAISE EXCEPTION 'Este pedido não está pago: não há dinheiro do Mercado Pago para devolver.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Regra 24/08: o estorno manual so' existe para pedido CANCELADO. Pedir
    -- devolucao de pedido vivo e' trocar o dinheiro sem desfazer a venda.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Cancele o pedido antes de devolver o dinheiro.';
    END IF;

    -- Regra 24/08, lado do enviado: produto que SAIU so' gera devolucao
    -- depois de VOLTAR a mao do lojista. O FATO vem de returned_to_seller_at
    -- (gravado por confirmar_retorno_do_produto), nunca deduzido de status.
    IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN
        RAISE EXCEPTION 'A devolução espera o produto: ele ainda não voltou para a loja.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Saldo disponivel = total pago - ja confirmado (valor_estornado) -
    -- pendencias em andamento (solicitado/em_processamento) - reembolso
    -- manual de devolução já concluída do mesmo pedido (achado 3, rodada 2).
    -- Linhas falhou/recusado NAO reservam saldo: sao pedidos mortos.
    SELECT COALESCE(SUM(amount), 0) INTO v_em_curso
      FROM public.order_refunds
     WHERE order_id = p_order_id
       AND status IN ('solicitado', 'em_processamento');

    SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
      FROM public.devolucoes d
     WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

    v_saldo := v_total - v_valor_estornado - v_em_curso - v_ja_manual;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'O valor a devolver tem de ser maior que zero.';
    END IF;

    IF p_amount > v_saldo THEN
        RAISE EXCEPTION 'O valor pedido (R$ %) é maior que o valor disponível para devolver (R$ %).',
            to_char(p_amount, 'FM999G999D00'), to_char(v_saldo, 'FM999G999D00')
            USING ERRCODE = 'P0001';
    END IF;

    -- A linha nasce AQUI, pedida pela loja. status default 'solicitado':
    -- quem executa e' a edge do clique (Task 3) ou o cron (Task 4).
    INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)
    VALUES (p_order_id, p_amount, NULLIF(trim(COALESCE(p_motivo, '')), ''), 'lojista')
    RETURNING id INTO v_refund_id;

    RETURN jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existe boolean;
    v_ja_estornado boolean;
    v_total numeric;
    v_valor_estornado numeric;
    v_ja_manual numeric;
    v_em_processamento boolean;
    v_disputa_em_curso boolean;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    -- 1. Trava as linhas VIVAS do ledger antes do pedido: a mesma ordem
    --    (linha -> pedido) de concluir_estorno, para as duas nunca se
    --    esperarem em cruz.
    PERFORM 1
       FROM public.order_refunds viva
      WHERE viva.order_id = p_order_id
        AND viva.status IN ('solicitado', 'em_processamento')
      ORDER BY viva.id
        FOR UPDATE OF viva;

    -- 2. Trava o pedido; o estado lido aqui já é o da linha travada.
    SELECT COALESCE(o.payment_status = 'estornado', false),
           o.total,
           COALESCE(o.valor_estornado, 0)
      INTO v_ja_estornado, v_total, v_valor_estornado
      FROM public.marketplace_orders o
     WHERE o.id = p_order_id
       FOR UPDATE OF o;

    v_existe := FOUND;

    IF NOT v_existe THEN
        RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_ja_estornado THEN
        -- Dinheiro que não entrou não se devolve (20261194). Pedido
        -- `aguardando` (PIX aberto, cartão em análise) marcado como estornado
        -- faz o pagamento que chega DEPOIS cair em 'ignorado' no
        -- confirmar_pagamento e sumir sem alerta. `recebido_na_entrega` passa:
        -- é a devolução do dinheiro em espécie (balcão e entrega). NOT EXISTS
        -- sobre a linha (já travada acima) para payment_status NULL também
        -- recusar. Antes da releitura do ledger e de qualquer escrita.
        IF NOT EXISTS (
            SELECT 1
              FROM public.marketplace_orders pedido
             WHERE pedido.id = p_order_id
               AND pedido.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
        ) THEN
            RAISE EXCEPTION 'Este pedido não tem pagamento confirmado: não há dinheiro a devolver. Registrar o estorno agora esconderia um pagamento que ainda pode chegar.'
                USING ERRCODE = '22023';
        END IF;

        -- 3. Relê e TRAVA as linhas vivas com o pedido já travado. A linha
        --    que nasceu (cancelamento, solicitar_estorno) enquanto a trava do
        --    pedido era esperada fica travada ANTES da checagem abaixo: sem
        --    isto a marca do cron/edge cai entre a checagem e o UPDATE e o
        --    POST sai (cenário iv). O UPDATE final sozinho NÃO cobre isso.
        PERFORM 1
           FROM public.order_refunds releitura
          WHERE releitura.order_id = p_order_id
            AND releitura.status IN ('solicitado', 'em_processamento')
          ORDER BY releitura.id
            FOR UPDATE OF releitura;

        SELECT COALESCE(bool_or(r.solicitado_por IS DISTINCT FROM 'sistema'), false),
               COALESCE(bool_or(r.solicitado_por = 'sistema'), false)
          INTO v_em_processamento, v_disputa_em_curso
          FROM public.order_refunds r
         WHERE r.order_id = p_order_id
           AND r.status = 'em_processamento';

        -- O POST já saiu com a chave da linha: registrar uma devolução por
        -- fora agora é o caminho do cliente receber duas vezes.
        IF v_em_processamento THEN
            RAISE EXCEPTION 'O Mercado Pago já está devolvendo este dinheiro ao cliente (o app já pediu a devolução). Não registre nem faça outra devolução: se ela não aparecer no painel do Mercado Pago, faça-a pelo painel do Mercado Pago, nunca por outro caminho.'
                USING ERRCODE = '22023';
        END IF;

        -- Linha do SISTEMA (contestação/disputa no MP): o app não pediu nada,
        -- mas há dinheiro em movimento pelo MP — mesma recusa, texto próprio.
        IF v_disputa_em_curso THEN
            RAISE EXCEPTION 'Há uma disputa ou devolução do Mercado Pago em andamento para este pedido. Acompanhe pelo painel do Mercado Pago; não devolva por outro meio.'
                USING ERRCODE = '22023';
        END IF;

        SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
          FROM public.devolucoes d
         WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual;

        IF v_total - v_valor_estornado - v_ja_manual <= 0 THEN
            RAISE EXCEPTION 'Este pedido não tem mais nada a devolver: o valor já saiu por outro caminho (devolução ou estorno).'
                USING ERRCODE = '22023';
        END IF;

        -- Ninguém pediu ao MP ainda: a linha sai da fila (as marcas do cron e
        -- da edge são condicionais por status e passam a achar 0 linhas).
        UPDATE public.order_refunds r
           SET status = 'recusado',
               ultimo_erro = 'A loja registrou a devolução feita fora do app',
               updated_at = now()
         WHERE r.order_id = p_order_id
           AND r.status = 'solicitado';

        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())
         WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(
  p_id uuid,
  p_resolucao text,
  p_itens jsonb,
  p_valor_reembolso numeric DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_item jsonb;
  v_di public.devolucao_itens%ROWTYPE;
  v_condicao text;
  v_reestocar boolean;
  v_reestocados integer := 0;
  v_valor numeric(12, 2);
  v_disponivel numeric(12, 2);
  v_em_voo numeric(12, 2);
  v_ja_manual numeric(12, 2);
  v_pago_pelo_app boolean;
  v_refund_id uuid;
  v_manual boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Conclua a devolução depois de receber o produto.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao IS NULL OR p_resolucao NOT IN ('reembolso', 'troca', 'vale') THEN
    RAISE EXCEPTION 'Escolha a resolução: reembolso, troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucao = 'reembolso' AND v_d.tipo = 'troca' THEN
    RAISE EXCEPTION 'Devolução por troca de política não gera reembolso. Use troca ou vale-troca.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Achado H (revisão de 26/09/2026): o lock não bastava — a devolução podia
  -- concluir mesmo depois de o PEDIDO ter mudado de vida por outro caminho
  -- (admin cancela + registrar_estorno_manual enquanto a devolução está
  -- 'recebida', ou o estoque já voltou pelo cancelamento). Sem isto: venda de
  -- balcão de R$100, devolução concluída com reembolso, pedido cancelado e
  -- estornado por fora → 200 saem por uma venda de 100, e o estoque credita
  -- de novo (achado C, ver devolver_estoque logo abaixo).
  IF v_o.status <> 'delivered' THEN
    RAISE EXCEPTION 'O pedido desta devolução não está mais entregue (status atual: %). Fale com o financeiro antes de concluir.',
      v_o.status USING ERRCODE = '22023';
  END IF;
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento registrado para devolver.' USING ERRCODE = '22023';
  END IF;
  -- Achado 4 (revisão 26/09/2026, rodada 2): stock_returned_at NÃO É só
  -- "cancelou depois da devolução" — a política P1 (pago após expirar,
  -- HONRAR) reativa pedido expirado (devolver_estoque já carimbou) até
  -- 'delivered' de verdade, e esse carimbo nunca some. Recusar a conclusão
  -- inteira aqui prendia esses pedidos para sempre, sem devolução possível.
  -- A trava certa é só no REESTOQUE (abaixo, força reestocar=false) — a
  -- resolução (reembolso/troca/vale) segue normal.

  -- Inspeção e reestoque por item (uma vez só por item).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    SELECT * INTO v_di FROM public.devolucao_itens
     WHERE id = NULLIF(v_item ->> 'item_id', '')::uuid AND devolucao_id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item não pertence a esta devolução.' USING ERRCODE = '22023';
    END IF;
    v_condicao := v_item ->> 'condicao';
    IF v_condicao IS NULL OR v_condicao NOT IN ('nova', 'usada', 'danificada', 'ausente') THEN
      RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
    END IF;
    v_reestocar := COALESCE((v_item ->> 'reestocar')::boolean, false) AND v_condicao <> 'ausente'
                   AND v_o.stock_returned_at IS NULL;

    UPDATE public.devolucao_itens SET condicao = v_condicao, reestocar = v_reestocar WHERE id = v_di.id;

    IF v_reestocar AND v_di.reestocado_em IS NULL THEN
      IF v_di.variant_id IS NOT NULL THEN
        UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade
         WHERE id = v_di.variant_id;
      ELSIF v_di.product_id IS NOT NULL THEN
        UPDATE public.produtos SET estoque = estoque + v_di.quantidade WHERE id = v_di.product_id;
      END IF;
      UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;
      v_reestocados := v_reestocados + v_di.quantidade;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.devolucao_itens WHERE devolucao_id = p_id AND condicao IS NULL) THEN
    RAISE EXCEPTION 'Informe a condição de cada item recebido.' USING ERRCODE = '22023';
  END IF;

  IF p_resolucao = 'reembolso' THEN
    -- Achado G: pagamento online com mais de 180 dias — o executor
    -- (supabase/functions/_shared/estorno.ts, guardaAntesDeChamar) RECUSA
    -- antes de chamar o Mercado Pago (prazo_vicio_dias aceita até 365, o MP
    -- só até 180). Abrir a linha em order_refunds ali só criaria um
    -- 'recusado' e a devolução concluiria sem dinheiro sair e sem caminho de
    -- refazer. Vai direto pelo caminho manual (a loja resolve fora do app).
    v_pago_pelo_app := v_o.payment_method = 'online'
                       AND v_o.payment_status IN ('pago', 'pago_apos_expirar')
                       AND v_o.gateway_payment_id IS NOT NULL
                       AND v_o.paid_at IS NOT NULL
                       AND now() - v_o.paid_at <= interval '180 days';

    -- Achado 3 (revisão 26/09/2026, rodada 2): reembolso manual JÁ CONCLUÍDO
    -- de uma OUTRA devolução do mesmo pedido é dinheiro que já saiu — sem
    -- descontar, uma segunda devolução online (ou reemitida) reabria o
    -- saldo cheio e pagava duas vezes a mesma fatia.
    SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
      FROM public.devolucoes d
     WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual AND d.id <> v_d.id;

    IF v_pago_pelo_app THEN
      -- Mesma trava de saldo da solicitar_estorno: total − já devolvido − em voo.
      SELECT COALESCE(sum(r.amount), 0) INTO v_em_voo FROM public.order_refunds r
       WHERE r.order_id = v_o.id AND r.status IN ('solicitado', 'em_processamento');
      v_disponivel := v_o.total - COALESCE(v_o.valor_estornado, 0) - v_em_voo - v_ja_manual;
    ELSE
      SELECT v_o.total - COALESCE(v_o.valor_estornado, 0) - COALESCE(sum(d.valor_reembolso), 0)
        INTO v_disponivel
        FROM public.devolucoes d
       WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual;
    END IF;
    v_disponivel := GREATEST(COALESCE(v_disponivel, 0), 0);

    -- Achado A: valor explícito do lojista continua recusado se passar do
    -- disponível (erro dele, ele corrige); o DEFAULT (valor dos itens + frete
    -- de ida) é CAPADO no disponível em vez de recusar a conclusão — era isto
    -- que fazia uma devolução integral com cupom (itens no preço cheio,
    -- 220 > 120 pagos) travar para sempre.
    IF p_valor_reembolso IS NOT NULL THEN
      v_valor := round(p_valor_reembolso, 2);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Informe o valor do reembolso.' USING ERRCODE = '22023';
      END IF;
      IF v_pago_pelo_app THEN
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      ELSE
        IF v_valor > v_disponivel THEN
          RAISE EXCEPTION 'O reembolso (R$ %) passa do valor pago no pedido (R$ %).',
            v_valor, v_disponivel USING ERRCODE = '22023';
        END IF;
      END IF;
    ELSE
      v_valor := LEAST(round(v_d.valor_itens + v_d.valor_frete_ida, 2), v_disponivel);
      IF v_valor <= 0 THEN
        RAISE EXCEPTION 'Não há valor disponível para reembolso deste pedido.' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_pago_pelo_app THEN
      INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
      VALUES (v_o.id, v_valor, 'Devolução ' || v_d.protocolo, 'lojista', 'solicitado')
      RETURNING id INTO v_refund_id;
    ELSE
      v_manual := true;
    END IF;
  END IF;

  UPDATE public.devolucoes
     SET status = 'concluida', resolucao_final = p_resolucao,
         valor_reembolso = CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
         refund_id = v_refund_id, reembolso_manual = v_manual,
         observacao_inspecao = NULLIF(btrim(COALESCE(p_observacao, '')), ''),
         concluida_em = now(), updated_at = now()
   WHERE id = p_id;

  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'concluida', 'loja',
    CASE p_resolucao
      WHEN 'reembolso' THEN 'Reembolso de R$ ' || to_char(v_valor, 'FM999G999G990D00')
        || CASE WHEN v_manual THEN ' (devolvido pela loja fora do app)' ELSE ' pelo Mercado Pago' END
      WHEN 'troca' THEN 'Troca combinada com a loja'
      ELSE 'Vale-troca emitido'
    END);

  RETURN jsonb_build_object(
    'id', p_id, 'status', 'concluida', 'resolucao', p_resolucao,
    'valor_reembolso', CASE WHEN p_resolucao = 'reembolso' THEN v_valor END,
    'refund_id', v_refund_id, 'reembolso_manual', v_manual, 'reestocados', v_reestocados
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_reemitir_reembolso(
  p_devolucao_id uuid,
  p_manual boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
  v_refund public.order_refunds%ROWTYPE;
  v_em_voo numeric(12, 2);
  v_ja_manual numeric(12, 2);
  v_disponivel numeric(12, 2);
  v_pago_pelo_app boolean;
  v_novo_refund_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'concluida' OR v_d.resolucao_final <> 'reembolso' THEN
    RAISE EXCEPTION 'Só uma devolução concluída com reembolso pode reemitir o reembolso.' USING ERRCODE = '22023';
  END IF;
  IF v_d.valor_reembolso IS NULL OR v_d.valor_reembolso <= 0 THEN
    RAISE EXCEPTION 'Esta devolução não tem valor de reembolso.' USING ERRCODE = '22023';
  END IF;
  -- Achado 2: manual é FINAL. Sem refund_id (nunca passou pelo MP) ou já
  -- convertida para manual por uma reemissão anterior — nada a reemitir.
  IF v_d.reembolso_manual THEN
    RAISE EXCEPTION 'Esta devolução já foi resolvida manualmente (fora do app); não há reembolso para reemitir.'
      USING ERRCODE = '22023';
  END IF;
  IF v_d.refund_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não tem um reembolso recusado para reemitir.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  -- Achado 2 (revalida como o achado H, sem a trava de estoque — esta RPC
  -- não reestoca nada, então stock_returned_at não é assunto dela).
  IF v_o.status <> 'delivered' THEN
    RAISE EXCEPTION 'O pedido desta devolução não está mais entregue (status atual: %). Fale com o financeiro antes de reemitir.',
      v_o.status USING ERRCODE = '22023';
  END IF;
  IF v_o.payment_status IS NULL
     OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
    RAISE EXCEPTION 'Este pedido não tem pagamento registrado para devolver.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund FROM public.order_refunds WHERE id = v_d.refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status <> 'recusado' THEN
    RAISE EXCEPTION 'O reembolso desta devolução não foi recusado (status atual: %). Nada para reemitir.',
      COALESCE(v_refund.status, 'desconhecido') USING ERRCODE = '22023';
  END IF;

  IF p_manual THEN
    UPDATE public.devolucoes
       SET refund_id = NULL, reembolso_manual = true, updated_at = now()
     WHERE id = p_devolucao_id;
    PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
      'Reembolso reemitido manualmente (fora do app) após recusa pelo Mercado Pago.');
    RETURN jsonb_build_object('id', p_devolucao_id, 'reembolso_manual', true, 'refund_id', NULL);
  END IF;

  -- Achado 2: mesma regra de elegibilidade de 180 dias da conclusão — o
  -- executor recusaria de novo, e a linha 'recusado' ficaria para sempre
  -- sem caminho de refazer se insistíssemos no MP aqui.
  v_pago_pelo_app := v_o.payment_method = 'online'
                     AND v_o.payment_status IN ('pago', 'pago_apos_expirar')
                     AND v_o.gateway_payment_id IS NOT NULL
                     AND v_o.paid_at IS NOT NULL
                     AND now() - v_o.paid_at <= interval '180 days';
  IF NOT v_pago_pelo_app THEN
    RAISE EXCEPTION 'Este pedido não é mais elegível para reembolso pelo Mercado Pago (prazo de 180 dias ou forma de pagamento). Reemita como manual (p_manual = true).'
      USING ERRCODE = '22023';
  END IF;

  -- Achado 3: desconta reembolso manual JÁ CONCLUÍDO de OUTRA devolução do
  -- mesmo pedido — mesma trava da conclusão.
  SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual
    FROM public.devolucoes d
   WHERE d.order_id = v_o.id AND d.status = 'concluida' AND d.reembolso_manual AND d.id <> v_d.id;

  -- Mesma trava de saldo da conclusão: total − já devolvido − em voo (menos a
  -- própria linha recusada, que não compete por saldo com a reemissão dela)
  -- − reembolso manual de outra devolução do mesmo pedido.
  SELECT COALESCE(sum(r.amount), 0) INTO v_em_voo FROM public.order_refunds r
   WHERE r.order_id = v_o.id AND r.status IN ('solicitado', 'em_processamento')
     AND r.id <> v_d.refund_id;
  v_disponivel := GREATEST(v_o.total - COALESCE(v_o.valor_estornado, 0) - v_em_voo - v_ja_manual, 0);
  IF v_d.valor_reembolso > v_disponivel THEN
    RAISE EXCEPTION 'O reembolso (R$ %) passa do que ainda pode ser devolvido deste pedido (R$ %).',
      v_d.valor_reembolso, v_disponivel USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
  VALUES (v_o.id, v_d.valor_reembolso, 'Reemissão da devolução ' || v_d.protocolo, 'lojista', 'solicitado')
  RETURNING id INTO v_novo_refund_id;

  UPDATE public.devolucoes
     SET refund_id = v_novo_refund_id, reembolso_manual = false, updated_at = now()
   WHERE id = p_devolucao_id;

  PERFORM public.devolucao__registrar_evento(p_devolucao_id, 'concluida', 'concluida', 'loja',
    'Reembolso reemitido pelo Mercado Pago após recusa anterior.');

  RETURN jsonb_build_object('id', p_devolucao_id, 'reembolso_manual', false, 'refund_id', v_novo_refund_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
BEGIN
  -- Achado 3 (rodada 4): `is_admin()` (baseline) aceita a conexão rodando
  -- como `postgres`/`service_role` (`current_setting('role') IN (...)`) —
  -- correto para as OUTRAS RPCs do app (automações internas de confiança),
  -- mas esta RPC é uma decisão humana pós-checagem manual no Melhor Envio, e
  -- nenhuma automação deveria tomá-la. `auth.uid() IS NOT NULL` garante que
  -- alguém está DE FATO logado (JWT ou GUC de sessão) além de ser admin —
  -- `SET ROLE service_role`/`postgres` sem login nenhum não tem `auth.uid()`
  -- e cai aqui (prova viva: `mutante F3_service_role_sem_jwt`).
  IF NOT public.is_admin() OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.me_reverse_id IS NULL THEN
    RAISE EXCEPTION 'Esta devolução não está vinculada a nenhum envio reverso no Melhor Envio.' USING ERRCODE = '22023';
  END IF;
  IF v_d.codigo_postagem IS NOT NULL THEN
    RAISE EXCEPTION 'O código de postagem já foi emitido — não há vínculo preso para liberar; cancele o envio reverso direto no Melhor Envio, se for o caso.'
      USING ERRCODE = '22023';
  END IF;
  -- Achado R5 (rodada 3, dinheiro): o pagamento pode já ter sido CONFIRMADO
  -- no Melhor Envio sem o código de postagem ter voltado ainda — a janela
  -- real entre o checkout (paga) e a gravação do código, que é a única prova
  -- no banco de que foi pago. Sem este guard a RPC soltava esse vínculo do
  -- mesmo jeito que um morto: a gravação do código lá na frente batia 0
  -- linhas SEM erro (o `me_reverse_id` não bate mais) e a edge respondia 200
  -- `ok: true` sem nada salvo — o próximo "Gerar" comprava um SEGUNDO envio
  -- (T10 do scratchpad da revisão). O marcador é um evento 'sistema' que a
  -- própria edge grava assim que `pagoConfirmado` vira true
  -- (`gravarPagamentoConfirmadoReverso`, index.ts) — o texto do `strpos`
  -- abaixo É O CONTRATO com aquela função (conferido em
  -- `tests/marcador_pagamento_reverso_contrato_test.ts`, achado 4 da rodada
  -- 4): mudar um lado sem atualizar o outro quebra esta proteção em
  -- silêncio. Este marcador (CONFIRMADO) NUNCA aceita `p_conferi_no_melhor_envio`
  -- — dinheiro confirmado não se destrava por auto-declaração.
  IF EXISTS (SELECT 1 FROM public.devolucao_eventos WHERE devolucao_id = p_id AND ator = 'sistema' AND strpos(nota, 'confirmou o pagamento do envio reverso ' || v_d.me_reverse_id || ';') > 0) THEN
    RAISE EXCEPTION 'O Melhor Envio já confirmou o pagamento deste envio reverso — aguarde o código de postagem chegar ou cancele o envio direto no Melhor Envio antes de liberar o vínculo aqui.'
      USING ERRCODE = '22023';
  END IF;
  -- Achado 1 (rodada 5, dinheiro — "negar por padrão"): o guard da rodada 4
  -- só recusava quando o marcador INDETERMINADO existia — mas um vínculo
  -- REAL sem NENHUM marcador (edge derrubada no meio do caminho, um link de
  -- produção gravado antes de esta proteção nascer, ou qualquer outra falha
  -- que nunca chegou a gravar nada) não caía em guard nenhum e saía solto
  -- sem pedir confirmação (achado G5 do scratchpad `ataque4.cjs`: vínculo
  -- real, zero eventos 'sistema', liberado sem `p_conferi_no_melhor_envio`).
  -- CORREÇÃO: para QUALQUER `me_reverse_id` REAL (a fase de reserva continua
  -- isenta — achados R1/N-a intactos), a RPC agora EXIGE
  -- `p_conferi_no_melhor_envio = true` sempre, com ou sem marcador. O
  -- marcador indeterminado deixa de decidir sozinho e vira só informação na
  -- MENSAGEM da recusa (avisa que há um registro de pagamento indeterminado,
  -- quando existir); sem marcador nenhum, a mensagem diz isso também. O
  -- marcador CONFIRMADO (guard acima) continua recusando sem NENHUMA
  -- exceção — inalterado pela rodada 5.
  --
  -- Achado 2 (rodada 6a, scratchpad rev79/ataque5.cjs, G8): `NOT
  -- p_conferi_no_melhor_envio` deixa passar um `NULL` EXPLÍCITO — em SQL,
  -- `NOT NULL` é `NULL` (não `TRUE`), e um `IF` com condição `NULL` nunca
  -- entra no corpo, então a RPC soltava o vínculo do mesmo jeito que com
  -- `false`. Isso é alcançável de fora: PostgREST aceita `{"p_id": "...",
  -- "p_conferi_no_melhor_envio": null}` no corpo JSON e passa `NULL` pra
  -- valer (o `DEFAULT false` só vale quando o parâmetro nem aparece na
  -- chamada). CORREÇÃO: `IS NOT TRUE` — únicos que NÃO recusam são `true` de
  -- verdade; `false` e `NULL` recusam igual.
  IF v_d.me_reverse_id NOT LIKE 'reservando:%' AND p_conferi_no_melhor_envio IS NOT TRUE THEN
    IF EXISTS (SELECT 1 FROM public.devolucao_eventos WHERE devolucao_id = p_id AND ator = 'sistema' AND strpos(nota, 'Pagamento do envio reverso ' || v_d.me_reverse_id || ' em verificação;') > 0) THEN
      RAISE EXCEPTION 'Há registro de pagamento indeterminado para este envio reverso no Melhor Envio — confira "Meus envios" na conta do Melhor Envio antes de liberar; chame de novo com p_conferi_no_melhor_envio = true depois de conferir que não foi pago.'
        USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'Não há nenhum registro de pagamento para este envio reverso no banco — confira "Meus envios" na conta do Melhor Envio antes de liberar; chame de novo com p_conferi_no_melhor_envio = true depois de conferir que não foi pago.'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;
  -- Texto neutro pelo mesmo motivo do evento de cancelar_devolucao (achado
  -- R2): o dono da devolução também pode ler esta nota. Achado N-a (rodada
  -- 3): esta RPC também pode soltar uma RESERVA ativa (prefixo
  -- 'reservando:', ainda não vencida) — seguro (a edge relê o status antes de
  -- vincular e desfaz sozinha se a reserva sumiu), mas chamar isso de "envio
  -- reverso (id reservando:...)" confundia quem lesse; a nota agora distingue
  -- os dois casos.
  PERFORM public.devolucao__registrar_evento(
    p_id, v_d.status, v_d.status, 'sistema',
    CASE
      WHEN v_d.me_reverse_id LIKE 'reservando:%' THEN
        'Uma reserva em andamento desta devolução com o Melhor Envio foi liberada manualmente pela loja.'
      ELSE
        'O vínculo desta devolução com um envio reverso no Melhor Envio (id ' || v_d.me_reverse_id || ') foi liberado manualmente pela loja. Convém conferir se esse envio precisa ser cancelado por lá.'
    END
  );
  RETURN jsonb_build_object('id', p_id, 'me_reverse_id_liberado', v_d.me_reverse_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(
    p_order_id uuid,
    p_recebido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status          TEXT;
    v_payment_status  TEXT;
    v_payment_method  TEXT;
    v_caller          UUID := auth.uid();
    v_antes           TEXT;
    v_depois          TEXT;
    v_ja_estava       BOOLEAN := FALSE;
    v_recebido_em     TIMESTAMPTZ;
    v_recebido_por    UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    -- NULL nao e nem "recebi" nem "desfiz": sem esta recusa o ELSE de
    -- `IF p_recebido` o tratava como DESFAZER (20261195000000). Vem DEPOIS da
    -- autorizacao (quem nao e admin nao aprende nada) e ANTES do SELECT ... FOR
    -- UPDATE, para recusar sem esperar a linha de quem esta gravando.
    IF p_recebido IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22004',
            MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).';
    END IF;

    SELECT status, payment_status, payment_method,
           pagamento_recebido_em, pagamento_recebido_por
      INTO v_status, v_payment_status, v_payment_method,
           v_recebido_em, v_recebido_por
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';
    END IF;

    IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site: quem confirma o pagamento é o gateway, não a loja.';
    END IF;

    v_antes := v_payment_status;

    IF p_recebido THEN
        IF v_payment_status = 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado como "%": não dá para marcar recebimento na entrega por cima.', v_payment_status;
        ELSE
            v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,
                   pagamento_recebido_em = now(),
                   pagamento_recebido_por = v_caller,
                   updated_at = now()
             WHERE id = p_order_id
             RETURNING pagamento_recebido_em, pagamento_recebido_por
                  INTO v_recebido_em, v_recebido_por;
        END IF;
    ELSE
        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSE
            v_depois := NULL;
            UPDATE public.marketplace_orders
               SET payment_status = NULL,
                   pagamento_recebido_em = NULL,
                   pagamento_recebido_por = NULL,
                   updated_at = now()
             WHERE id = p_order_id;
            v_recebido_em := NULL;
            v_recebido_por := NULL;
        END IF;
    END IF;

    IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history
            (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES
            (p_order_id,
             CASE WHEN p_recebido THEN 'recebido' ELSE 'desfeito' END,
             v_antes, v_depois, v_caller);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_status', v_depois,
        'pagamento_recebido_em', v_recebido_em,
        'pagamento_recebido_por', v_recebido_por,
        'ja_estava', v_ja_estava
    );
END;
$$;

-- RLS financeira: as políticas de admin de marketplace_orders e order_refunds
-- passam da porta antiga (is_admin(), que aceita o JWT velho) para a
-- autoridade ATUAL. Dono do pedido continua pelo `auth.uid() = user_id`;
-- order_refunds_cliente_le (dono) não muda. `(SELECT ...)`: avaliada uma vez
-- por consulta. Papéis e comandos de cada política não mudam (ALTER POLICY só
-- troca a expressão).
ALTER POLICY marketplace_orders_select_policy ON public.marketplace_orders
  USING (((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual()));

ALTER POLICY marketplace_orders_admin_update_policy ON public.marketplace_orders
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

ALTER POLICY marketplace_orders_admin_insert_policy ON public.marketplace_orders
  WITH CHECK ((SELECT public.rls_admin_atual()));

ALTER POLICY marketplace_orders_admin_delete_policy ON public.marketplace_orders
  USING ((SELECT public.rls_admin_atual()));

ALTER POLICY order_refunds_admin_all ON public.order_refunds
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));
