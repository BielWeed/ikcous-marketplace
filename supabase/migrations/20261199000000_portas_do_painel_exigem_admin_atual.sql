-- AS PORTAS DO PAINEL EXIGEM O ADMIN DE AGORA (permissão + dado de cliente +
-- dinheiro; 04/10/2026) — fecha as três brechas que a revisão Opus provou na
-- 20261197000000 e que ela não fechava.
--
-- R1 (ALTA) AUTOPROMOÇÃO. `tr_sync_profile_role_to_auth` (AFTER INSERT OR
-- UPDATE OF role ON profiles) dispara mesmo quando o UPDATE regrava o MESMO
-- valor; authenticated tem UPDATE em profiles e a política deixa cada um
-- atualizar o próprio perfil. Quem foi rebaixado SÓ no app_metadata (painel
-- do Supabase; profiles ainda 'admin') fazia `UPDATE profiles SET role =
-- 'admin' WHERE id = eu` -> ensure_role_protection/prevent_role_change não
-- barram (OLD = NEW) -> o gatilho copiava 'admin' para auth.users ->
-- is_admin_atual()/rls_admin_atual() voltavam a ser true. E as proteções de
-- papel decidiam pelo JWT (prevent_role_change: `is_admin()`) ou por UMA
-- fonte (ensure_role_protection: só profiles): o mesmo rebaixado, com o JWT
-- velho (~1 h), promovia um cúmplice. CORREÇÃO, nas três funções dos
-- gatilhos de papel (levantamento: `NEW.role`/`OLD.role` nas migrations —
-- handle_profile_role_sync_to_auth, ensure_role_protection,
-- prevent_role_change; a quarta, tr_prevent_role_change(), não está ligada a
-- gatilho nenhum e fica como está):
--   * handle_profile_role_sync_to_auth: no UPDATE, só sincroniza quando o
--     papel MUDA (`NEW.role IS NOT DISTINCT FROM OLD.role` -> RETURN NEW). O
--     gatilho em si NÃO muda (o WHEN com OLD não vale para INSERT); no INSERT
--     continua sincronizando sempre (handle_new_user grava 'customer').
--   * ensure_role_protection: além do profiles.role de quem muda, exige
--     `is_admin_atual()` (auth.users E profiles, agora); senão NEW.role volta
--     a OLD.role, em silêncio, como já fazia.
--   * prevent_role_change: o "admin pode" passa a ser `is_admin() AND
--     is_admin_atual()`; o resto (exceção para quem não é) igual.
-- NÃO se revoga UPDATE(role) de authenticated: o grant de profiles é de
-- TABELA (REVOKE de coluna não tira nada, e REVOKE de tabela apagaria os
-- grants de coluna); e o painel do app não muda papel por PostgREST (grep em
-- src/: nenhum `.update({ role })` em profiles) — mas o dono pode, pelo
-- caminho de admin, e esse caminho continua (provado).
--
-- R2 (ALTA) LEITURA DE DADO DE CLIENTE e R3 (MÉDIA) ESTOQUE/CAIXA/CONFIG:
-- RPCs SECURITY DEFINER do painel guardadas só por `is_admin()`, que aceita o
-- JWT ~1 h depois do rebaixamento. Prova da revisão: ex-admin rebaixado nas
-- duas fontes, JWT velho: SELECT direto em pedidos = 0 linhas (a 97 fechou a
-- RLS), get_admin_orders_paged = 10 pedidos.
--
-- O LEVANTAMENTO (banco montado com todas as migrations até a 97): toda
-- função de `public` com SECURITY DEFINER, EXECUTE para authenticated e
-- `public.is_admin()` no corpo sem `is_admin_atual()` — 54. Entram 39 (abaixo)
-- + as três de papel = 42 corpos. FICAM DE FORA, e por quê:
--   update_order_status_atomic        frente em voo (20261198000000) — não
--                                     se toca aqui.
--   admin_devolucao_decidir/registrar/reprovar  só mudam o estado da
--                                     devolução (mesma decisão da 97); o
--                                     dinheiro dela (concluir/reemitir) já
--                                     exige o admin atual.
--   answer_question_atomic(3 args), reply_review_atomic(3 args)  conteúdo
--                                     público (resposta/réplica na vitrine),
--                                     não dinheiro nem dado de cliente.
--   swap_banner_order, reorder_banners_atomic  ordem de banner da vitrine.
--   record_vor_action                 recibo de auditoria (VOR), não move
--                                     dinheiro nem lê cliente.
--   get_admin_products_paged, buscar_por_codigo_barras  catálogo.
--   get_admin_questions_paged, get_admin_reviews_paged  perguntas e
--                                     avaliações — o mesmo que a vitrine
--                                     mostra (nome público do autor).
--   read_store_identity               nome/cores da loja (públicos).
--   assinatura_da_loja_ler            status do plano da loja (sem cliente,
--                                     sem dinheiro movido).
-- Fora do levantamento por construção: as seis RPCs de dinheiro da 97 (já
-- guardadas) e as funções das frentes em voo (cancelar_pedido_com_cobranca,
-- pedido__mudar_status, pedido__saldo_a_estornar e update_order_status_atomic
-- da 98; autorizar_post_do_estorno, registrar_contestacao_no_ledger,
-- registrar_estorno_externo_do_mp e confirmar_pagamento da 96) — nenhuma é
-- redefinida aqui. Fora do escopo (outra frente): as POLÍTICAS de RLS que
-- ainda usam `is_admin()` (profiles, push_subscriptions, itens/histórico do
-- pedido, devoluções...) — o ex-admin com JWT velho ainda lê/escreve por
-- elas até o JWT expirar.
--
-- AS 39 GUARDADAS:
--   dado de cliente: get_admin_orders_paged,
--     get_admin_orders_cancelados_recentes, get_admin_user_detail,
--     get_admin_customers_paged, crm_clientes, admin_devolucoes_listar,
--     devolucao_detalhe, devolucao_elegibilidade, devolucoes_do_pedido,
--     get_segmented_push_targets (endpoints de push dos clientes).
--   números da loja (CRM, Início, analytics e o livro financeiro):
--     crm_visao, painel_inicio, get_admin_analytics_v2,
--     get_category_analytics, get_coupon_stats, get_retention_rate,
--     get_segmented_push_count, fin_contas_listar, fin_categorias_listar,
--     fin_extrato, fin_previstos, fin_resumo, fin_dre, fin_caixa_atual,
--     fin_caixa_historico.
--   escrita de dinheiro, estoque e configuração: confirmar_retorno_do_produto
--     (estoque), registrar_venda_presencial (venda + estoque),
--     fin_caixa_abrir, fin_caixa_movimentar, fin_caixa_fechar,
--     fin_lancamento_salvar, fin_lancamento_baixar, fin_lancamento_cancelar,
--     fin_conta_salvar (saldo inicial), fin_categoria_salvar,
--     salvar_config_pagamento_cartao, salvar_politica_de_devolucao (prazos do
--     reembolso), upsert_store_config, save_store_identity.
--
-- A GUARDA em cada uma das 39 (a mesma regra da 97, uma forma só): o bloco de
-- autorização que a função JÁ tem é copiado byte a byte, com
-- `public.is_admin()` trocado por `public.is_admin_atual()`, e inserido LOGO
-- DEPOIS dele, com um comentário próprio. Daí, sem exceção: mesma mensagem e
-- mesmo SQLSTATE da recusa de não-admin de cada função (o front não muda);
-- `IF NOT ...` onde a função usava `IF NOT`, `IS DISTINCT FROM true` onde ela
-- usava isso (registrar_venda_presencial, save_store_identity); nas três
-- "dono OU admin" (devolucao_detalhe, devolucao_elegibilidade,
-- devolucoes_do_pedido) o dono continua passando — só o atalho de admin passa
-- a exigir o admin de agora (em devolucoes_do_pedido a recusa segue sendo
-- devolver '[]'). O bloco do `is_admin()` fica intacto; o resto do corpo é o
-- VIGENTE byte a byte (o corpo da última migration que define cada uma — o
-- comentário acima de cada CREATE diz qual; conferido contra o banco montado
-- e amarrado pelo teste de texto). Duas chamam outra guardada (painel_inicio
-- -> fin_dre; save_store_identity -> upsert_store_config): mesma regra nas
-- duas pontas. Assinatura, RETURNS, volatilidade, SECURITY DEFINER,
-- search_path e demais SET de cada função são os do catálogo vivo
-- (`pg_get_functiondef`); `CREATE OR REPLACE` preserva ACL e dono — nenhum
-- GRANT/REVOKE aqui. Nenhum chamador muda (nenhuma assinatura muda).
--
-- QUEM PASSA, DEPOIS: o conjunto só ENCOLHE. Admin de verdade (admin em
-- auth.users E em profiles) passa como antes; service_role e o papel postgres
-- (a automação de confiança — mesma detecção de is_admin()) passam como
-- antes; o que já exigia login (devolucao_elegibilidade,
-- devolucoes_do_pedido, registrar_venda_presencial) segue exigindo.
-- EFEITO COLATERAL ACEITO (o mesmo da 97, agora no painel inteiro): quem é
-- admin só no app_metadata, sem profiles.role = 'admin' (ou o contrário),
-- para de abrir pedidos, clientes, CRM, Início e Financeiro e de mexer em
-- caixa/config. ANTES DE APLICAR NUMA LOJA, a mesma conferência da 97 — zero
-- linhas = ninguém perde acesso; cada linha é um papel contraditório que o
-- dono decide qual é o certo:
--   SELECT u.id FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
--    WHERE COALESCE(u.raw_app_meta_data ->> 'role' = 'admin', false)
--          IS DISTINCT FROM COALESCE(p.role = 'admin', false);
-- E a reparação de um app_metadata rebaixado por engano deixa de funcionar
-- regravando o MESMO papel no profiles (era exatamente a brecha): o admin
-- corrige trocando o papel (customer -> admin) ou direto no app_metadata.
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — só corpo
-- de função. Quem JÁ se autopromoveu antes desta migration continua admin
-- (a conferência acima não acha: as duas fontes dizem admin) — se houver
-- suspeita, o dono confere quem é admin nas duas fontes.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE` dos 42 corpos; o preflight aceita, para
-- cada um, o corpo vigente OU o que esta migration deixa — reaplicar produz o
-- mesmo estado (provado: duas reaplicações, impressão digital igual).
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT, ANTES de qualquer escrita, recusa se:
-- (1) `is_admin()` não é o da baseline (a guarda copia o bloco dela);
-- (2) `is_admin_atual()` não é o da 20261197000000 (sem ela, toda guarda vira
-- erro — aplique a 97 antes); (3) o corpo vivo de alguma das 42 não é o
-- vigente nem o desta, por `md5(replace(prosrc, E'\r', ''))`, ou o DONO dela
-- não executa `is_admin_atual()` (a função é SECURITY DEFINER e chama a
-- guarda como o dono — sem EXECUTE, recusaria até o admin); (4) os três
-- gatilhos de papel em profiles não são os que a correção supõe (definição
-- deparseada com search_path = pg_catalog, e ligados). Os hashes são o md5
-- REAL dos corpos, amarrados ao texto por
-- tests/migration_portas_do_painel_exigem_admin_atual_test.ts.
--
-- TRANSAÇÃO: sem `BEGIN`/`COMMIT` de nível superior (regra da casa,
-- AGENTS.md). O workflow `aplicar-migrations.yml` manda o arquivo inteiro numa
-- consulta só — o preflight e os 42 corpos caem juntos ou não caem.
--
-- ORDEM: depois da 20261197000000 (o preflight recusa sem ela). Independe da
-- 96 e da 98 (nenhuma função em comum). ROLLBACK: o desta vem ANTES do da 97
-- — o da 97 apaga is_admin_atual(), que estes 42 corpos chamam; na ordem
-- errada o painel inteiro passa a recusar com "function does not exist"
-- (fecha, não abre). Nenhuma tela muda; nenhuma edge muda.
--
-- COMO APLICAR: workflow `aplicar-migrations.yml` (Actions -> Run workflow),
-- `migracoes = 20261199000000_portas_do_painel_exigem_admin_atual.sql`.
--
-- FICHA DE VERIFICAÇÃO:
--   1. A conferência de papel contraditório acima: zero linhas.
--   2. Cada uma das 39 contém `is_admin_atual()` UMA vez, logo depois do
--      bloco do `is_admin()`; handle_profile_role_sync_to_auth contém
--      `NEW.role IS NOT DISTINCT FROM OLD.role`.
--   3. `proacl` das 42 igual antes e depois.
--   4. Admin de verdade no painel: Pedidos, Clientes, CRM, Início,
--      Financeiro (abrir/fechar caixa, lançar), Devoluções, Configurações e
--      a venda no balcão seguem funcionando; mudar o papel de alguém em
--      Clientes segue funcionando.
--
-- PROVA VIVA: tests/banco/admin-atual-portas-viva.cjs (rpc-ci).
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261199000000_portas_do_painel_exigem_admin_atual.sql
-- restaura, byte a byte, os 42 corpos de antes.

DO $preflight_20261199$
DECLARE
  r record;
  v_hash text;
  v_dono oid;
  v_caminho text;
  v_def text;
  v_ligado "char";
BEGIN
  -- (1) is_admin() da baseline: a guarda é a cópia do bloco dela.
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.is_admin()');

  IF v_hash IS DISTINCT FROM 'e4e624331673f15aaeb4a6703fef2d7c' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.is_admin() (hash %) não é o da baseline — a guarda copia o bloco dela; revise antes de aplicar.', COALESCE(v_hash, 'ausente');
  END IF;

  -- (2) is_admin_atual() da 20261197000000: sem ela cada guarda vira erro.
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.is_admin_atual()');

  IF v_hash IS DISTINCT FROM '519842163e48cc377ac1337ffb9db936' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin_atual() (hash %) não é a da 20261197000000 — aplique a 97 antes desta.', COALESCE(v_hash, 'ausente');
  END IF;

  -- (3) Cada corpo vivo é o vigente ou o desta; e o DONO de cada função
  --     executa is_admin_atual() (as funções são SECURITY DEFINER e a chamam
  --     como o dono — sem o EXECUTE, a guarda recusaria todo mundo).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.handle_profile_role_sync_to_auth()', '408b1496e36049d0b4475c50dc201794', 'e63371757c43ef2619dd613af4635ad3'),
        ('public.ensure_role_protection()', '4a68bf7969530871c9ebedb8ac81111b', '44d677c3fa562318668122aad65fe0df'),
        ('public.prevent_role_change()', '16018a39db2658ff669e032f1c0c6062', '92ff3224c34e3367cdf892579e8176f0'),
        ('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', '59ee815bdf0e456d03987a8dd65baba5', '5861dbbe0e9c007a4196f5308c17d763'),
        ('public.get_admin_orders_cancelados_recentes(integer,integer,integer)', 'cdb61f0f957078523aabe402e4b48fb3', '99a9e4cb232aef020bf297ddcd1901f0'),
        ('public.get_admin_user_detail(uuid)', '1794226c392b8d2eece44f3afe2af166', '4dec3f232e1905ad62688b8bcd098b2a'),
        ('public.get_admin_customers_paged(text,text,text,integer,integer)', '26eb0dfa4174535aefd383671a5afdbf', '3c4a0fc4ca6f5d1c9a017a38bff2ec49'),
        ('public.crm_clientes(text,text,integer,integer)', 'f31396c2f583756da56ae63a44cf09dc', 'd5823a661555bcee3813ab32aeee9117'),
        ('public.admin_devolucoes_listar(text,text,integer,integer)', '959e175f6471d3894ea6dbe802876313', '5a632e0a239104598dcdc4eb323c09b1'),
        ('public.devolucao_detalhe(uuid)', 'cec98031ee4c30cf9fe80c2e4df01d5e', '6897a45df3e5d29256f85611ea3ca91f'),
        ('public.devolucao_elegibilidade(uuid)', '882d22ff3b6a417fcc6b1aed7bdaf678', '0bdb635f4f04e8edb894b70da58282e7'),
        ('public.devolucoes_do_pedido(uuid)', '12c08b046aacd29f91ed398910bf65b3', 'ab157c125b4f4a73f523a12b3c967a56'),
        ('public.get_segmented_push_targets(text,numeric,integer)', 'e160802d4ed395497952112acca4df0e', '404f93b98fdc97b3dde45ac30fa799eb'),
        ('public.crm_visao(date,date)', '0e76e93760b7db349c294c40b4477c18', '7f6ec1bc0fa9f40591c0b577201b7c36'),
        ('public.painel_inicio()', 'f4509ee736a5134003fd5e94901c5018', 'ebcafff0ad5efbb70391a2cc93a14247'),
        ('public.get_admin_analytics_v2(integer)', 'a2c6c6d16330bf0a0c6a3e22e83d969c', '6abc7e44b0aae3b2e542e87daf055451'),
        ('public.get_category_analytics(timestamp with time zone,timestamp with time zone)', '3d23aebe664ca22b5b14a03ca8572189', '9202ebd1aae8cc95e431fd3eb9bc7eb3'),
        ('public.get_coupon_stats()', '68839bb23cdb1f56bf69033457034350', 'ca4d7e6a2b7fc7b1caef9c4deca4bc9b'),
        ('public.get_retention_rate()', '87e30f3261194136cc99bf65a124593f', '9692f411bf837541049308fa1d9da4e9'),
        ('public.get_segmented_push_count(text,numeric,integer)', '268d433bec60dca068dac1ff3049f6cc', 'e5f6b76afd6ec75df32f168d9942e209'),
        ('public.fin_contas_listar()', '154c1de0d59615a58e2df1b12c61f6ab', 'c4b5434e8b99879cfb95b2b94d6b2695'),
        ('public.fin_categorias_listar()', '4db367379c108c46f7d526c741cf2bbf', '4cf0145c5b73d781cd2006881e638513'),
        ('public.fin_extrato(date,date,uuid)', '1be12e753eeb9f573800bbaf56923be7', '46f4763de4295da1fa9113910e188d6e'),
        ('public.fin_previstos(text)', '1c00acae271d225e5e22b4b4f892196c', 'b8b28d76b42d8f53cf38cdf13997016f'),
        ('public.fin_resumo(date,date)', '436c4f46e7d60f610926edc0dcc887df', '410668ed931d89e0a16a568b35df7973'),
        ('public.fin_dre(date,date)', '3ab0be7bdb863cd8605581252ef7a46a', 'e58ac49d3881a459b929064a3acb470a'),
        ('public.fin_caixa_atual()', 'fbb4466d909f17f029c3918e0e7f2a30', 'dd00ea41f415a20bc594659eb2aef08f'),
        ('public.fin_caixa_historico(integer)', '5c2c363f4e887a8c69abf277d2a839f9', '2bd23adcaa5d30b52172ad33ad3137cd'),
        ('public.confirmar_retorno_do_produto(uuid)', '5eb2cb42af868bff0216d82b920dbd63', '803245a0850dccfa6bf3814434023da9'),
        ('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)', '654bc307a4c7f54c9e4b8ce44969e29f', '6a421904a7c99a0e17ca58f2f891c71d'),
        ('public.fin_caixa_abrir(numeric,uuid)', '43d5aa2cb9ef146298db43808b3b98e4', '46793029f342662859e0bf6205566119'),
        ('public.fin_caixa_movimentar(text,numeric,text,uuid)', '34b4ffa5560eb333bff22495088508ce', 'd7e8dfeec40f89dff51f4cb3ccf14b9a'),
        ('public.fin_caixa_fechar(numeric,text)', '0582b0b80702ee9261b41f5376de3861', '69a9dd8988cdc05392f500deb64f349f'),
        ('public.fin_lancamento_salvar(jsonb)', '033299a836af5a342e6cf9e1d6a1fed6', '559a13a9d69e02e5048623685cd07514'),
        ('public.fin_lancamento_baixar(uuid,date,uuid)', 'ee843dd1ba3d94647cd47be817fe3452', 'e59bc12ea20182da4209a257df0be8c1'),
        ('public.fin_lancamento_cancelar(uuid,text)', '25595f56b9f3134f5fb3ee9488670ea0', 'a0b036d6d16d323dc806732b85b8b1cf'),
        ('public.fin_conta_salvar(jsonb)', '4fd59e7124913b1b39a4f10cee153722', '2f9b720cb3804edba4879595b0d6fe1d'),
        ('public.fin_categoria_salvar(jsonb)', '13aadcc57fc634f1758ad91c82b295ce', 'ec6da50db8e67dd3895aed7bbb8a0cb6'),
        ('public.salvar_config_pagamento_cartao(boolean,boolean,integer)', '05ed486b13d9e9084108bf94d9a8154b', 'd957529f1cc67bd5e6005ed4bd0614b4'),
        ('public.salvar_politica_de_devolucao(jsonb)', '79c7ca96ef89dcbec6c94f81945aa33f', '043f816330a66b290fd04d272a4ee934'),
        ('public.upsert_store_config(jsonb)', '37a81b0351637a90b7a5a8e10a7d3e82', '9c56a9c6953e1d774a1ee97d5d8a7e16'),
        ('public.save_store_identity(text,jsonb,jsonb)', 'fe7dad0ae7054a2b92646e89845a43d4', 'b3c3b0aa2cb8cb8aadcdc5f3906d7cde')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')), proowner INTO v_hash, v_dono
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;

    IF NOT has_function_privilege(v_dono, 'public.is_admin_atual()', 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de % (%) não executa public.is_admin_atual() — a guarda recusaria até o admin; revise antes de aplicar.', r.assinatura, v_dono::regrole;
    END IF;
  END LOOP;

  -- (4) Os três gatilhos de papel em profiles, como a correção os supõe
  --     (definição deparseada com search_path = pg_catalog, nomes sempre
  --     qualificados; ligados). O search_path volta logo depois.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('tr_ensure_role_protection', 'CREATE TRIGGER tr_ensure_role_protection BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_role_protection()'),
        ('tr_prevent_role_change', 'CREATE TRIGGER tr_prevent_role_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change()'),
        ('tr_sync_profile_role_to_auth', 'CREATE TRIGGER tr_sync_profile_role_to_auth AFTER INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_profile_role_sync_to_auth()')
      ) AS esperado(gatilho, definicao)
  LOOP
    SELECT pg_get_triggerdef(t.oid), t.tgenabled INTO v_def, v_ligado
      FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.profiles')
       AND t.tgname = r.gatilho
       AND NOT t.tgisinternal;

    IF NOT FOUND OR v_def IS DISTINCT FROM r.definicao OR v_ligado IS DISTINCT FROM 'O' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gatilho % em public.profiles (%, estado %) não é o que esta migration supõe — revise antes de aplicar.', r.gatilho, COALESCE(v_def, 'ausente'), COALESCE(v_ligado::text, '-');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_20261199$;

-- ===== papel =====

-- handle_profile_role_sync_to_auth: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.handle_profile_role_sync_to_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $$
BEGIN
    -- Só quando o papel MUDA (20261199000000). `UPDATE OF role` dispara
    -- até regravando o MESMO valor, e cada usuário pode regravar o próprio
    -- profiles.role: quem foi rebaixado só no app_metadata copiava o
    -- 'admin' do profiles de volta para auth.users e se promovia. No
    -- INSERT continua sincronizando sempre, como antes.
    IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
        RETURN NEW;
    END IF;
    UPDATE auth.users
    SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role)
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

-- ensure_role_protection: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.ensure_role_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    IF (auth.uid() IS NOT NULL) AND (auth.role() <> 'service_role') AND (OLD.role IS DISTINCT FROM NEW.role) THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role = 'admin'
        ) THEN
            NEW.role := OLD.role;
        END IF;
        -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado não mexe em papel (20261199000000).
        IF NOT public.is_admin_atual() THEN
            NEW.role := OLD.role;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- prevent_role_change: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.prevent_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    -- Allow admins to change roles
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado não mexe em papel (20261199000000).
    IF public.is_admin() AND public.is_admin_atual() THEN
        RETURN NEW;
    END IF;

    -- Block role change for normal users
    IF (OLD.role IS DISTINCT FROM NEW.role) THEN
        RAISE EXCEPTION 'Unauthorized: You cannot change your own role.';
    END IF;
    
    RETURN NEW;
END;
$$;

-- ===== leitura de dado de cliente =====

-- get_admin_orders_paged: corpo vigente da 20261163000000_a_lista_de_pedidos_filtra_por_canal.sql.
CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text, p_canal text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_search_digitos TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- So os digitos do que a pessoa digitou. Serve para casar telefone
    -- independente de mascara -- ver a clausula do telefone abaixo.
    v_search_digitos := regexp_replace(v_clean_search, '[^0-9]', '', 'g');

    -- Compute total count with filters (before pagination)
    SELECT COUNT(o.id) INTO v_total_count
    FROM public.marketplace_orders o
    WHERE (
        p_status = 'all'
        OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')) -- "Em Aberto": exclui cancelado e entregue
        OR o.status = p_status
      )
      -- Achado 10 do laudo (29/08): o filtro de pagamento existia so na
      -- tela — o painel buscava a pagina inteira e cortava em memoria,
      -- entao dormia enquanto o resultado cabia numa pagina. Filtra no
      -- banco, na contagem E nos dados; 'sem_cobranca' cobre o NULL
      -- (mesma regra de paymentStatusKey no front).
      AND (
        p_payment_status = 'all'
        OR (p_payment_status = 'sem_cobranca' AND o.payment_status IS NULL)
        OR o.payment_status = p_payment_status
      )
      -- Chip "Balcão" da lista do painel (seção 5.2 do plano): filtra pelo
      -- canal da venda; 'all' é o comportamento de sempre (nada filtrado).
      AND (p_canal = 'all' OR o.canal = p_canal)
      AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
      AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
      AND (
        v_clean_search = '' OR (
          public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
          o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
          (
            -- TELEFONE: compara SO DIGITO com SO DIGITO, dos dois lados.
            -- O checkout grava mascarado -- `formatWhatsApp` em
            -- CheckoutView.tsx monta "(34) 98888-7777" -- entao a
            -- comparacao crua nunca casava o numero inteiro colado do
            -- WhatsApp. Normalizando os dois lados com o MESMO
            -- regexp_replace que o OTP ja usa, mascara deixa de importar.
            --
            -- 🔴 A GUARDA POR QUANTIDADE DE DIGITO NAO E DETALHE. Com
            -- `<> ''`, um termo de POUCOS digitos casava quase toda a
            -- base pela clausula do telefone -- MEDIDO em 23/08/2026 com
            -- o catalogo real: "3d" ia de 15 para 60 resultados, "caneta
            -- 3d" de 7 para 59, e "kit de adesivos 3d de microcenas" de 0
            -- para 59 -- porque o digito "3" sozinho aparece em 59 dos 84
            -- telefones deste banco (e "9" aparece em 84).
            --
            -- O LIMIAR E 4, NAO 6: com 6 a busca perde o caso de lembrar
            -- so os 4 ultimos digitos do telefone (ex.: "7777"), que e
            -- como se lembra um numero de cabeca -- MEDIDO acima. E 4 ja
            -- e a convencao deste schema: `get_orders_by_whatsapp_v3` em
            -- 20260323000002_repair_missing_rpcs_v25.sql:147 exige "pelo
            -- menos 4 dígitos" pelo mesmo motivo.
            --
            -- E A GUARDA CONTINUA NECESSARIA, so' com outro limiar: sem
            -- NENHUMA guarda, um termo sem digito (um NOME) reduz o termo
            -- a '' e `LIKE '%%'` casaria TODOS os pedidos por esta
            -- clausula -- o painel passaria a mostrar a lista inteira
            -- para qualquer texto. E' o defeito que o conserto ingenuo
            -- introduz.
            --
            -- O `coalesce` com o jsonb e o MESMO de
            -- `generate_order_otp_v1`/`v2`: pedido gravado pela RPC legada
            -- (que nunca preencheu a coluna) tambem passa a ser achavel.
            length(v_search_digitos) >= 4
            AND regexp_replace(
                  coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
                  '[^0-9]', '', 'g'
                ) LIKE '%' || v_search_digitos || '%'
          ) OR
          public.f_unaccent(o.coupon_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
          public.f_unaccent(o.tracking_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
          EXISTS (
              SELECT 1 FROM public.marketplace_order_items oi
              WHERE oi.order_id = o.id
                AND public.f_unaccent(oi.product_name) ILIKE public.f_unaccent('%' || v_clean_search || '%')
          )
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT
            o.*,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', oi.id,
                            'order_id', oi.order_id,
                            'product_id', oi.product_id,
                            'variant_id', oi.variant_id,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'product_name', oi.product_name,
                            'image_url', oi.image_url,
                            'product', (
                                SELECT jsonb_build_object(
                                    'imagem_url', p.imagem_url,
                                    'imagem_urls', p.imagem_urls
                                )
                                FROM public.produtos p
                                WHERE p.id = oi.product_id
                            )
                        )
                    ),
                    '[]'::JSONB
                )
                FROM public.marketplace_order_items oi
                WHERE oi.order_id = o.id
            ) AS items,
            (
                SELECT to_jsonb(addr.*)
                FROM public.user_addresses addr
                WHERE addr.id = o.address_id
            ) AS address
        FROM public.marketplace_orders o
        WHERE (
            p_status = 'all'
            OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')) -- "Em Aberto": exclui cancelado e entregue
            OR o.status = p_status
          )
          -- Achado 10 do laudo (29/08): o filtro de pagamento existia so na
          -- tela — o painel buscava a pagina inteira e cortava em memoria,
          -- entao dormia enquanto o resultado cabia numa pagina. Filtra no
          -- banco, na contagem E nos dados; 'sem_cobranca' cobre o NULL
          -- (mesma regra de paymentStatusKey no front).
      AND (
        p_payment_status = 'all'
        OR (p_payment_status = 'sem_cobranca' AND o.payment_status IS NULL)
        OR o.payment_status = p_payment_status
      )
      -- Chip "Balcão" da lista do painel (seção 5.2 do plano): filtra pelo
      -- canal da venda; 'all' é o comportamento de sempre (nada filtrado).
      AND (p_canal = 'all' OR o.canal = p_canal)
      AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
          AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
          AND (
            v_clean_search = '' OR (
              public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
              o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
              (
            -- TELEFONE: compara SO DIGITO com SO DIGITO, dos dois lados.
            -- O checkout grava mascarado -- `formatWhatsApp` em
            -- CheckoutView.tsx monta "(34) 98888-7777" -- entao a
            -- comparacao crua nunca casava o numero inteiro colado do
            -- WhatsApp. Normalizando os dois lados com o MESMO
            -- regexp_replace que o OTP ja usa, mascara deixa de importar.
            --
            -- 🔴 A GUARDA POR QUANTIDADE DE DIGITO NAO E DETALHE. Com
            -- `<> ''`, um termo de POUCOS digitos casava quase toda a
            -- base pela clausula do telefone -- MEDIDO em 23/08/2026 com
            -- o catalogo real: "3d" ia de 15 para 60 resultados, "caneta
            -- 3d" de 7 para 59, e "kit de adesivos 3d de microcenas" de 0
            -- para 59 -- porque o digito "3" sozinho aparece em 59 dos 84
            -- telefones deste banco (e "9" aparece em 84).
            --
            -- O LIMIAR E 4, NAO 6: com 6 a busca perde o caso de lembrar
            -- so os 4 ultimos digitos do telefone (ex.: "7777"), que e
            -- como se lembra um numero de cabeca -- MEDIDO acima. E 4 ja
            -- e a convencao deste schema: `get_orders_by_whatsapp_v3` em
            -- 20260323000002_repair_missing_rpcs_v25.sql:147 exige "pelo
            -- menos 4 dígitos" pelo mesmo motivo.
            --
            -- E A GUARDA CONTINUA NECESSARIA, so' com outro limiar: sem
            -- NENHUMA guarda, um termo sem digito (um NOME) reduz o termo
            -- a '' e `LIKE '%%'` casaria TODOS os pedidos por esta
            -- clausula -- o painel passaria a mostrar a lista inteira
            -- para qualquer texto. E' o defeito que o conserto ingenuo
            -- introduz.
            --
            -- O `coalesce` com o jsonb e o MESMO de
            -- `generate_order_otp_v1`/`v2`: pedido gravado pela RPC legada
            -- (que nunca preencheu a coluna) tambem passa a ser achavel.
            length(v_search_digitos) >= 4
            AND regexp_replace(
                  coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
                  '[^0-9]', '', 'g'
                ) LIKE '%' || v_search_digitos || '%'
          ) OR
              public.f_unaccent(o.coupon_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
              public.f_unaccent(o.tracking_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
              EXISTS (
                  SELECT 1 FROM public.marketplace_order_items oi
                  WHERE oi.order_id = o.id
                    AND public.f_unaccent(oi.product_name) ILIKE public.f_unaccent('%' || v_clean_search || '%')
              )
            )
          )
        ORDER BY o.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

-- get_admin_orders_cancelados_recentes: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.get_admin_orders_cancelados_recentes(p_dias integer DEFAULT 90, p_page integer DEFAULT 0, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_fora_da_janela BIGINT;
    v_data JSONB;
    v_offset INTEGER;
BEGIN
    -- Authorization check (mesmo gate da get_admin_orders_paged).
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- Contagem, numa passada só: dentro da janela (é o total que o laço do
    -- front persegue) e fora dela (o número que impede o recorte de
    -- mentir). p_dias NULL = sem janela: dentro = todos, fora = 0.
    SELECT
        COUNT(*) FILTER (
          WHERE p_dias IS NULL
             OR cancelado_em >= now() - make_interval(days => p_dias)
        ),
        COUNT(*) FILTER (
          WHERE p_dias IS NOT NULL
            AND cancelado_em < now() - make_interval(days => p_dias)
        )
      INTO v_total_count, v_fora_da_janela
      FROM (
        SELECT o.id,
               COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT MAX(hi.created_at) AS cancelado_em
              FROM public.marketplace_order_history hi
             WHERE hi.order_id = o.id
               AND hi.new_status = 'cancelled'
          ) h ON TRUE
         WHERE o.status = 'cancelled'
      ) c;

    -- Linhas enxutas: as 23 colunas que o mapper e o painel leem, mais a
    -- coluna nova do achado 1 (rodada 2), na ordem de atenção do
    -- cancelamento (mais recente primeiro). Nenhum item, nenhum endereço.
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT jsonb_build_object(
            'id', c.id,
            'user_id', c.user_id,
            'customer_name', c.customer_name,
            'customer_data', c.customer_data,
            'total', c.total,
            'subtotal', c.subtotal,
            'shipping', c.shipping,
            'discount', c.discount,
            'payment_method', c.payment_method,
            'payment_status', c.payment_status,
            'status', c.status,
            'notes', c.notes,
            'coupon_code', c.coupon_code,
            'tracking_code', c.tracking_code,
            'cancelled_after_shipping', c.cancelled_after_shipping,
            'returned_to_seller_at', c.returned_to_seller_at,
            'pagamento_recebido_em', c.pagamento_recebido_em,
            'pagamento_recebido_por', c.pagamento_recebido_por,
            'canal', c.canal,
            'vendedor_id', c.vendedor_id,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'cancelado_em', c.cancelado_em,
            'valor_devolvido_por_devolucao', c.valor_devolvido_por_devolucao,
            'valor_estornado', c.valor_estornado
        ) AS t
        FROM (
            SELECT o.id,
                   o.user_id,
                   o.customer_name,
                   o.customer_data,
                   o.total,
                   o.subtotal,
                   o.shipping,
                   o.discount,
                   o.payment_method,
                   o.payment_status,
                   o.status,
                   o.notes,
                   o.coupon_code,
                   o.tracking_code,
                   o.cancelled_after_shipping,
                   o.returned_to_seller_at,
                   o.pagamento_recebido_em,
                   o.pagamento_recebido_por,
                   o.canal,
                   o.vendedor_id,
                   o.created_at,
                   o.updated_at,
                   COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em,
                   COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d
                              WHERE d.order_id = o.id AND d.status = 'concluida' AND d.reembolso_manual), 0)
                     AS valor_devolvido_por_devolucao,
                   -- Achado A4 (revisão 26/09/2026, rodada 3): o "Devolver
                   -- agora" também precisa saber o que já saiu pelo ledger
                   -- CONFIRMADO (order_refunds concluído, coluna somada só em
                   -- concluir_estorno) — sem isto, um estorno parcial já
                   -- pago pelo MP não descontava do valor que falta.
                   o.valor_estornado
              FROM public.marketplace_orders o
              LEFT JOIN LATERAL (
                SELECT MAX(hi.created_at) AS cancelado_em
                  FROM public.marketplace_order_history hi
                 WHERE hi.order_id = o.id
                   AND hi.new_status = 'cancelled'
              ) h ON TRUE
             WHERE o.status = 'cancelled'
               AND (p_dias IS NULL OR COALESCE(h.cancelado_em, o.updated_at) >= now() - make_interval(days => p_dias))
             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC
             LIMIT p_page_size
            OFFSET v_offset
        ) c
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'fora_da_janela', v_fora_da_janela
    );
END;
$$;

-- get_admin_user_detail: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.get_admin_user_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_profile JSONB;
    v_orders JSONB;
    v_cart_items JSONB;
    v_addresses JSONB;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Fetch profile info (join auth.users to get email)
    SELECT JSONB_BUILD_OBJECT(
        'id', p.id,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'whatsapp', p.whatsapp,
        'role', p.role,
        'created_at', p.created_at,
        'email', u.email
    ) INTO v_profile
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user_id;

    -- 2. Fetch marketplace orders (including order items)
    SELECT COALESCE(JSONB_AGG(o_data), '[]'::JSONB) INTO v_orders
    FROM (
        SELECT 
            mo.*,
            COALESCE(
                (
                    SELECT JSONB_AGG(item) 
                    FROM public.marketplace_order_items item 
                    WHERE item.order_id = mo.id
                ), 
                '[]'::JSONB
            ) as items
        FROM public.marketplace_orders mo
        WHERE mo.user_id = p_user_id
        ORDER BY mo.created_at DESC
    ) o_data;

    -- 3. Fetch cart items
    SELECT COALESCE(JSONB_AGG(c), '[]'::JSONB) INTO v_cart_items
    FROM public.cart_items c
    WHERE c.user_id = p_user_id;

    -- 4. Fetch user addresses
    SELECT COALESCE(JSONB_AGG(a), '[]'::JSONB) INTO v_addresses
    FROM public.user_addresses a
    WHERE a.user_id = p_user_id;

    -- Return Consolidated Object
    RETURN JSONB_BUILD_OBJECT(
        'profile', v_profile,
        'orders', v_orders,
        'cart_items', v_cart_items,
        'addresses', v_addresses
    );
END;
$$;

-- get_admin_customers_paged: corpo vigente da 20261021000000_receita_conta_so_dinheiro_que_entrou.sql.
CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;

    -- Global stats variables
    v_global_total_customers BIGINT;
    v_global_new_customers_30d BIGINT;
    v_global_ltv NUMERIC;
    v_global_orders BIGINT;
    v_stats JSONB;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Calculate global stats (not filtered by search for global dashboard consistency)
    SELECT COUNT(id) INTO v_global_total_customers
    FROM public.profiles;

    SELECT COUNT(id) INTO v_global_new_customers_30d
    FROM public.profiles
    WHERE created_at >= NOW() - INTERVAL '30 days';

    SELECT COUNT(id) INTO v_global_orders
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- LTV global: mesma correção do achado 17, dinheiro reconhecido só.
    SELECT COALESCE(SUM(total::numeric), 0) INTO v_global_ltv
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    v_stats := JSONB_BUILD_OBJECT(
        'total_customers', v_global_total_customers,
        'new_customers_30d', v_global_new_customers_30d,
        'global_ltv', v_global_ltv,
        'global_orders', v_global_orders
    );

    -- CTE to gather aggregated stats per customer with unaccent filtering and pagination count
    WITH customer_stats AS (
        SELECT
            p.id,
            u.email,
            p.full_name,
            COALESCE(p.whatsapp, u.phone) as phone,
            p.role,
            p.created_at,
            p.avatar_url,
            addr.city,
            addr.state,
            EXISTS (
                SELECT 1
                FROM public.push_subscriptions
                WHERE user_id = p.id
            ) as is_push_subscribed,
            COUNT(o.id) as orders_count,
            -- LTV por cliente: só dinheiro reconhecido (achado 17). O CASE
            -- fica dentro do SUM, e não na condição do JOIN, de propósito:
            -- orders_count e last_order_date continuam contando qualquer
            -- pedido não cancelado/devolvido, a mesma regra da coluna
            -- "Pedidos" e da ficha do cliente (achado 5).
            COALESCE(SUM(
                CASE
                    WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
                    THEN o.total::numeric
                    ELSE 0
                END
            ), 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
        WHERE (
            v_clean_search = '' OR (
                unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')
            )
        )
        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state
    ),
    sorted_data AS (
        SELECT *, COUNT(*) OVER() as full_count FROM customer_stats
        ORDER BY
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END DESC,
            -- Numeric ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END DESC,
            -- Temporal ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END DESC
    ),
    paginated_data AS (
        SELECT *
        FROM sorted_data
        LIMIT p_page_size
        OFFSET v_offset
    )
    SELECT
        COALESCE((SELECT full_count FROM sorted_data LIMIT 1), 0),
        COALESCE(jsonb_agg(pd), '[]'::JSONB)
    INTO v_total_count, v_data
    FROM paginated_data pd;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'stats', v_stats
    );
END;
$$;

-- crm_clientes: corpo vigente da 20261183000000_o_crm_ve_todo_mundo.sql.
CREATE OR REPLACE FUNCTION public.crm_clientes(p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_digitos text;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  v_digitos := NULLIF(regexp_replace(COALESCE(v_busca, ''), '\D', '', 'g'), '');

  WITH compradores AS (
    SELECT c.chave, c.user_id, COALESCE(pr.full_name, c.nome) AS nome_exibido, c.whatsapp, c.email,
           c.pedidos_total AS pedidos, c.receita_total AS receita,
           CASE WHEN c.pedidos_total > 0 THEN round(c.receita_total / c.pedidos_total, 2) ELSE 0 END AS ticket_medio,
           c.primeira_compra, c.ultima_compra, c.dias_sem_comprar,
           c.r, c.f, c.m, c.segmento, c.canal_preferido,
           NULL::numeric AS valor_em_aberto, NULL::timestamptz AS cadastrado_em,
           0 AS grupo, c.ultima_compra AS ordem_data
      FROM public.crm__clientes_rfm(now()) c
      LEFT JOIN public.profiles pr ON pr.id = c.user_id
  ), nao_pagos AS (
    SELECT np.chave, np.user_id, COALESCE(pr.full_name, np.nome) AS nome_exibido, np.whatsapp, np.email,
           np.pedidos, 0::numeric AS receita, 0::numeric AS ticket_medio,
           NULL::timestamptz AS primeira_compra, np.ultimo_pedido AS ultima_compra,
           (public.fin__dia(now()) - public.fin__dia(np.ultimo_pedido))::integer AS dias_sem_comprar,
           NULL::integer AS r, NULL::integer AS f, NULL::integer AS m,
           'pediu_nao_pagou'::text AS segmento, np.canal_preferido,
           np.valor_em_aberto, NULL::timestamptz AS cadastrado_em,
           1 AS grupo, np.ultimo_pedido AS ordem_data
      FROM public.crm__pedidos_nao_pagos(now()) np
      LEFT JOIN public.profiles pr ON pr.id = np.user_id
  ), nunca AS (
    SELECT nc.chave, nc.user_id, nc.nome AS nome_exibido, nc.whatsapp, nc.email,
           0 AS pedidos, 0::numeric AS receita, 0::numeric AS ticket_medio,
           NULL::timestamptz AS primeira_compra, NULL::timestamptz AS ultima_compra,
           NULL::integer AS dias_sem_comprar,
           NULL::integer AS r, NULL::integer AS f, NULL::integer AS m,
           'nunca_comprou'::text AS segmento, NULL::text AS canal_preferido,
           NULL::numeric AS valor_em_aberto, nc.cadastrado_em,
           2 AS grupo, nc.cadastrado_em AS ordem_data
      FROM public.crm__nunca_comprou(now()) nc
  ), base AS (
    SELECT * FROM compradores
    UNION ALL SELECT * FROM nao_pagos
    UNION ALL SELECT * FROM nunca
  ), filtrado AS (
    SELECT * FROM base
     WHERE (p_segmento IS NULL OR segmento = p_segmento)
       AND (v_busca IS NULL
            OR COALESCE(nome_exibido, '') ILIKE '%' || v_busca || '%'
            OR COALESCE(email, '') ILIKE '%' || v_busca || '%'
            OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND COALESCE(whatsapp, '') LIKE '%' || v_digitos || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtrado),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chave', b.chave, 'user_id', b.user_id, 'nome', b.nome_exibido, 'whatsapp', b.whatsapp, 'email', b.email,
        'pedidos', b.pedidos, 'receita', b.receita, 'ticket_medio', b.ticket_medio,
        'primeira_compra', b.primeira_compra, 'ultima_compra', b.ultima_compra,
        'dias_sem_comprar', b.dias_sem_comprar, 'r', b.r, 'f', b.f, 'm', b.m,
        'segmento', b.segmento, 'canal_preferido', b.canal_preferido,
        'valor_em_aberto', b.valor_em_aberto, 'cadastrado_em', b.cadastrado_em
      ) ORDER BY b.grupo ASC, b.receita DESC, b.ordem_data DESC, b.chave ASC)
      -- `, chave ASC` no fim (achado 10, revisão de risco): desempate único
      -- para a paginação por OFFSET ficar estável quando grupo/receita/data
      -- empatam entre si (comum nos grupos novos, onde receita é sempre 0).
      FROM (SELECT * FROM filtrado ORDER BY grupo ASC, receita DESC, ordem_data DESC, chave ASC
             LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200)
            OFFSET GREATEST(COALESCE(p_offset, 0), 0)) b), '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

-- admin_devolucoes_listar: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucoes_listar(p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer;
  v_itens jsonb;
  v_contagem jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'solicitada', count(*) FILTER (WHERE status = 'solicitada'),
    'aprovada', count(*) FILTER (WHERE status = 'aprovada'),
    'em_transito', count(*) FILTER (WHERE status = 'em_transito'),
    'recebida', count(*) FILTER (WHERE status = 'recebida'),
    'concluida', count(*) FILTER (WHERE status = 'concluida'),
    'recusada', count(*) FILTER (WHERE status = 'recusada'),
    'cancelada', count(*) FILTER (WHERE status = 'cancelada'),
    'reprovada', count(*) FILTER (WHERE status = 'reprovada')
  ) INTO v_contagem FROM public.devolucoes;

  WITH base AS (
    SELECT d.*, o.customer_name AS cliente_nome, o.customer_data ->> 'whatsapp' AS cliente_whatsapp
      FROM public.devolucoes d
      JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (v_busca IS NULL
            OR d.protocolo ILIKE '%' || v_busca || '%'
            OR o.customer_name ILIKE '%' || v_busca || '%'
            OR d.order_id::text ILIKE v_busca || '%')
  )
  SELECT (SELECT count(*) FROM base),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', b.id, 'protocolo', b.protocolo, 'order_id', b.order_id,
            'cliente_nome', b.cliente_nome, 'cliente_whatsapp', b.cliente_whatsapp,
            'tipo', b.tipo, 'motivo', b.motivo, 'status', b.status,
            'resolucao_desejada', b.resolucao_desejada, 'metodo_retorno', b.metodo_retorno,
            'modalidade', b.modalidade, 'valor_itens', b.valor_itens,
            'prazo_ate', b.prazo_ate, 'created_at', b.created_at
          ) ORDER BY b.created_at DESC)
          FROM (SELECT * FROM base ORDER BY created_at DESC LIMIT v_limite OFFSET v_offset) b), '[]'::jsonb)
    INTO v_total, v_itens;

  RETURN jsonb_build_object('total', v_total, 'contagem', v_contagem, 'itens', v_itens);
END;
$$;

-- devolucao_detalhe: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.devolucao_detalhe(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_o public.marketplace_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id;
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT FOUND OR (v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_atual()) THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id;
  RETURN to_jsonb(v_d) || jsonb_build_object(
    'itens', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.product_name, i.id)
                         FROM public.devolucao_itens i WHERE i.devolucao_id = v_d.id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
                           FROM public.devolucao_eventos e WHERE e.devolucao_id = v_d.id), '[]'::jsonb),
    'pedido', jsonb_build_object(
      'id', v_o.id, 'total', v_o.total, 'shipping', v_o.shipping,
      'payment_method', v_o.payment_method, 'payment_status', v_o.payment_status,
      'canal', v_o.canal, 'customer_name', v_o.customer_name,
      'whatsapp', v_o.customer_data ->> 'whatsapp',
      'shipping_label_id', v_o.shipping_label_id,
      'shipping_option_id', v_o.customer_data ->> 'shipping_option_id'
    )
  );
END;
$$;

-- devolucao_elegibilidade: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.devolucao_elegibilidade(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_o public.marketplace_orders%ROWTYPE;
  v_pol public.politica_devolucao%ROWTYPE;
  v_entregue timestamptz;
  v_dias integer;
  v_hoje date := public.devolucao__hoje();
  v_opcao text;
  v_modalidade text;
  v_metodos text[];
  v_j_arrep boolean := false;
  v_j_troca boolean := false;
  v_j_vicio boolean := false;
  v_itens jsonb;
  v_disp_total integer;
  v_bloqueio text;
  -- Achado 6 (revisão 26/09/2026, rodada 2): mesmo rateio do cupom que
  -- solicitar_devolucao aplica no snapshot — sem isto a ficha do cliente
  -- prometia o preço cheio (100) e o reembolso de verdade saía pela metade
  -- (50), porque só o valor_unitario GRAVADO era rateado.
  v_fator_desconto numeric := 1;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para pedir uma devolução.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id;
  IF NOT FOUND OR (v_o.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT FOUND OR (v_o.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin_atual()) THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_o.subtotal > 0 THEN
    v_fator_desconto := GREATEST(LEAST((v_o.subtotal - COALESCE(v_o.discount, 0)) / v_o.subtotal, 1), 0);
  END IF;

  SELECT * INTO v_pol FROM public.politica_devolucao WHERE id = 1;
  v_opcao := v_o.customer_data ->> 'shipping_option_id';
  v_modalidade := public.devolucao__modalidade(v_o.canal, v_opcao);
  v_metodos := public.devolucao__metodos(v_modalidade, v_opcao, v_o.shipping_label_id IS NOT NULL,
                                          v_pol.metodos_locais, v_pol.metodos_nacionais);
  v_entregue := public.devolucao__entregue_em(v_o.id);

  IF v_entregue IS NOT NULL THEN
    v_dias := v_hoje - (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date;
    v_j_arrep := v_o.canal = 'online' AND v_dias <= v_pol.prazo_arrependimento_dias;
    v_j_troca := v_pol.aceita_troca AND v_pol.prazo_troca_dias > 0 AND v_dias <= v_pol.prazo_troca_dias;
    v_j_vicio := v_dias <= v_pol.prazo_vicio_dias;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_item_id', x.id,
           'product_id', x.product_id,
           'product_name', x.product_name,
           'image_url', x.image_url,
           'quantidade', x.quantity,
           'ja_devolvida', x.ja,
           'disponivel', GREATEST(x.quantity - x.ja, 0),
           'valor_unitario', round(x.price * v_fator_desconto, 2)
         ) ORDER BY x.created_at, x.id), '[]'::jsonb),
         COALESCE(sum(GREATEST(x.quantity - x.ja, 0)), 0)
    INTO v_itens, v_disp_total
    FROM (
      SELECT oi.id, oi.product_id, oi.product_name, oi.image_url, oi.quantity, oi.price, oi.created_at,
             COALESCE((SELECT sum(di.quantidade) FROM public.devolucao_itens di
                         JOIN public.devolucoes d ON d.id = di.devolucao_id
                        WHERE di.order_item_id = oi.id
                          AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')), 0)::integer AS ja
        FROM public.marketplace_order_items oi
       WHERE oi.order_id = v_o.id
    ) x;

  v_bloqueio := CASE
    WHEN v_o.status IS DISTINCT FROM 'delivered' THEN 'A devolução fica disponível depois que o pedido for entregue.'
    -- Achado B (revisão de 26/09/2026): lista de PERMISSÃO, não de bloqueio —
    -- `payment_status IN (...)` com NULL dá NULL (nem bloqueia nem libera). O
    -- "Ainda não" do admin deixa payment_status NULL num pedido 'delivered'
    -- (pago na entrega nunca confirmado): sem isto a devolução seguia normal.
    WHEN v_o.payment_status IS NULL
      OR v_o.payment_status NOT IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
      THEN 'Este pedido não tem pagamento a devolver.'
    WHEN EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.order_id = v_o.id
                  AND d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida'))
      THEN 'Já existe uma devolução em andamento para este pedido.'
    WHEN v_entregue IS NULL THEN 'Não encontramos a data de entrega deste pedido. Fale com a loja.'
    WHEN NOT (v_j_arrep OR v_j_troca OR v_j_vicio) THEN 'O prazo para devolução ou troca deste pedido terminou.'
    WHEN v_disp_total <= 0 THEN 'Todos os itens deste pedido já foram devolvidos.'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'pode', v_bloqueio IS NULL,
    'motivo_bloqueio', v_bloqueio,
    'entregue_em', v_entregue,
    'dias_desde_entrega', v_dias,
    'modalidade', v_modalidade,
    'metodos', to_jsonb(v_metodos),
    'prazos', jsonb_build_object(
      'arrependimento_ate', CASE WHEN v_entregue IS NOT NULL AND v_o.canal = 'online'
        THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_arrependimento_dias END,
      'troca_ate', CASE WHEN v_entregue IS NOT NULL AND v_pol.aceita_troca AND v_pol.prazo_troca_dias > 0
        THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_troca_dias END,
      'vicio_ate', CASE WHEN v_entregue IS NOT NULL
        THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_vicio_dias END
    ),
    'janelas', jsonb_build_object('arrependimento', v_j_arrep, 'troca', v_j_troca, 'vicio', v_j_vicio),
    'itens', v_itens,
    'politica', to_jsonb(v_pol) - 'updated_by'
  );
END;
$$;

-- devolucoes_do_pedido: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.devolucoes_do_pedido(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.marketplace_orders o WHERE o.id = p_order_id AND o.user_id = auth.uid()
  ) THEN
    RETURN '[]'::jsonb;
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() AND NOT EXISTS (
    SELECT 1 FROM public.marketplace_orders o WHERE o.id = p_order_id AND o.user_id = auth.uid()
  ) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'protocolo', d.protocolo, 'status', d.status, 'tipo', d.tipo,
      'resolucao_desejada', d.resolucao_desejada, 'metodo_retorno', d.metodo_retorno,
      'valor_itens', d.valor_itens, 'created_at', d.created_at
    ) ORDER BY d.created_at DESC)
    FROM public.devolucoes d WHERE d.order_id = p_order_id
  ), '[]'::jsonb);
END;
$$;

-- get_segmented_push_targets: corpo vigente da 20261021000000_receita_conta_so_dinheiro_que_entrou.sql.
CREATE OR REPLACE FUNCTION public.get_segmented_push_targets(p_segment text DEFAULT 'all'::text, p_min_ltv numeric DEFAULT 150, p_days_inactive integer DEFAULT 30)
 RETURNS TABLE(auth text, endpoint text, p256dh text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- Case 1: Specific User (UUID format)
    IF p_segment ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id = p_segment::uuid;

    -- Case 2: VIP Segment (Users with recognized-money LTV >= p_min_ltv)
    ELSIF p_segment = 'vip' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT o.user_id
            FROM public.marketplace_orders o
            WHERE o.status NOT IN ('cancelled', 'returned')
            AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY o.user_id
            HAVING SUM(o.total::numeric) >= p_min_ltv
        );

    -- Case 3: Inactive Segment (Inactive for >= p_days_inactive)
    ELSIF p_segment = 'inactive' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            -- Users whose last order was more than X days ago
            SELECT o.user_id
            FROM public.marketplace_orders o
            GROUP BY o.user_id
            HAVING MAX(o.created_at) < NOW() - (p_days_inactive || ' days')::interval
        ) OR s.user_id IN (
            -- Users who registered more than X days ago and have never ordered
            SELECT p.id
            FROM public.profiles p
            LEFT JOIN public.marketplace_orders o ON o.user_id = p.id
            WHERE p.created_at < NOW() - (p_days_inactive || ' days')::interval
              AND o.id IS NULL
        );

    -- Case 4: New Clients Segment (Created within the last 7 days)
    ELSIF p_segment = 'new' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT p.id
            FROM public.profiles p
            WHERE p.created_at >= NOW() - INTERVAL '7 days'
        );

    -- Case 5: All (Default fallback)
    ELSE
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s;
    END IF;
END;
$$;

-- ===== leitura de números da loja (CRM, painel, analytics, livro financeiro) =====

-- crm_visao: corpo vigente da 20261183000000_o_crm_ve_todo_mundo.sql.
CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_dias integer;
  v_ant_inicio date;
  v_ant_fim date;
  v_fim_ts timestamptz;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;
  v_dias := p_fim - p_inicio + 1;
  v_ant_fim := p_inicio - 1;
  v_ant_inicio := v_ant_fim - v_dias + 1;
  v_fim_ts := ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');

  WITH v AS (
    SELECT * FROM public.crm__vendas(v_fim_ts)
  ), atual AS (
    SELECT * FROM v WHERE v.dia BETWEEN p_inicio AND p_fim
  ), anterior AS (
    SELECT * FROM v WHERE v.dia BETWEEN v_ant_inicio AND v_ant_fim
  ), primeira AS (
    SELECT v.chave, min(v.pago_em) AS primeira FROM v WHERE v.chave IS NOT NULL GROUP BY v.chave
  ), rfm AS (
    SELECT * FROM public.crm__clientes_rfm(v_fim_ts)
  ), devolvido AS (
    SELECT COALESCE(sum(r.amount), 0) AS valor FROM public.order_refunds r
     WHERE r.status = 'concluido' AND public.fin__dia(r.concluido_em) BETWEEN p_inicio AND p_fim
  ), devolvido_manual AS (
    SELECT COALESCE(sum(d.valor_reembolso), 0) AS valor FROM public.devolucoes d
     WHERE d.status = 'concluida' AND d.reembolso_manual AND public.fin__dia(d.concluida_em) BETWEEN p_inicio AND p_fim
  ), nao_pagos AS (
    SELECT * FROM public.crm__pedidos_nao_pagos(v_fim_ts)
  ), nunca AS (
    SELECT * FROM public.crm__nunca_comprou(v_fim_ts)
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM atual),
      'receita_anterior', (SELECT COALESCE(sum(total), 0) FROM anterior),
      'pedidos', (SELECT count(*) FROM atual),
      'pedidos_anterior', (SELECT count(*) FROM anterior),
      'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM atual),
      'ticket_medio_anterior', (SELECT COALESCE(round(avg(total), 2), 0) FROM anterior),
      'clientes_compradores', (SELECT count(DISTINCT chave) FROM atual WHERE chave IS NOT NULL),
      'clientes_novos', (SELECT count(*) FROM primeira p WHERE public.fin__dia(p.primeira) BETWEEN p_inicio AND p_fim),
      'taxa_recompra', (SELECT CASE WHEN count(*) = 0 THEN 0
                                    ELSE round(count(*) FILTER (WHERE pedidos_total >= 2)::numeric / count(*), 4) END
                          FROM rfm),
      'receita_recorrente_pct', (SELECT CASE WHEN COALESCE(sum(a.total), 0) = 0 THEN 0
                                   ELSE round(COALESCE(sum(a.total) FILTER (WHERE a.pago_em > p.primeira), 0) / sum(a.total), 4) END
                                   FROM atual a JOIN primeira p ON p.chave = a.chave),
      'ltv_medio', (SELECT COALESCE(round(avg(receita_total), 2), 0) FROM rfm),
      'receita_em_risco', (SELECT COALESCE(sum(receita), 0) FROM rfm WHERE segmento IN ('em_risco', 'nao_pode_perder')),
      'taxa_devolucao', (SELECT CASE WHEN COALESCE(sum(total), 0) = 0 THEN 0
                                     ELSE round(((SELECT valor FROM devolvido) + (SELECT valor FROM devolvido_manual)) / sum(total), 4) END
                           FROM atual)
    ),
    'canais', COALESCE((SELECT jsonb_agg(jsonb_build_object('canal', canal, 'receita', receita, 'pedidos', pedidos,
                                                            'ticket_medio', ticket) ORDER BY receita DESC)
                          FROM (SELECT canal, sum(total) AS receita, count(*) AS pedidos, round(avg(total), 2) AS ticket
                                  FROM atual GROUP BY canal) c), '[]'::jsonb),
    'formas', COALESCE((SELECT jsonb_agg(jsonb_build_object('forma', forma, 'receita', receita, 'pedidos', pedidos)
                                         ORDER BY receita DESC)
                          FROM (SELECT forma, sum(total) AS receita, count(*) AS pedidos FROM atual GROUP BY forma) f), '[]'::jsonb),
    'funil', jsonb_build_object(
      'visitas', NULL,
      'produtos_vistos', NULL,
      'carrinhos', (SELECT count(DISTINCT u) FROM (
                      SELECT ci.user_id AS u FROM public.cart_items ci
                       WHERE public.fin__dia(ci.created_at) BETWEEN p_inicio AND p_fim
                      UNION
                      SELECT o.user_id FROM public.marketplace_orders o
                       WHERE o.canal = 'online' AND o.user_id IS NOT NULL
                         AND public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim) x WHERE u IS NOT NULL),
      'pedidos_criados', (SELECT count(*) FROM public.marketplace_orders o
                           WHERE o.canal = 'online' AND public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim),
      'pedidos_pagos', (SELECT count(*) FROM atual WHERE canal = 'online')
    ),
    'pipeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'quantidade', qtd, 'mais_antigo_em', antigo)
                                           ORDER BY ordem)
                            FROM (SELECT o.status, count(*) AS qtd, min(o.created_at) AS antigo,
                                         CASE o.status WHEN 'new' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2
                                                       ELSE 3 END AS ordem
                                    FROM public.marketplace_orders o
                                   WHERE o.status IN ('new', 'pending', 'processing', 'shipping')
                                     AND COALESCE(o.payment_status, '') NOT IN ('aguardando', 'expirado', 'recusado')
                                   GROUP BY o.status) p), '[]'::jsonb),
    'segmentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('segmento', segmento, 'clientes', clientes, 'receita', receita)
                                            ORDER BY receita DESC)
                             FROM (
                               SELECT segmento, count(*) AS clientes, sum(receita) AS receita FROM rfm GROUP BY segmento
                               UNION ALL
                               SELECT 'pediu_nao_pagou', count(*), COALESCE(sum(valor_em_aberto), 0) FROM nao_pagos
                               UNION ALL
                               SELECT 'nunca_comprou', count(*), 0 FROM nunca
                             ) s),
                          '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

-- painel_inicio: corpo vigente da 20261178000000_o_crm_e_o_inicio_leem_a_loja.sql.
CREATE OR REPLACE FUNCTION public.painel_inicio()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_mes_inicio date := date_trunc('month', public.fin__hoje())::date;
  v_mes_ant_inicio date := (date_trunc('month', public.fin__hoje()) - interval '1 month')::date;
  v_mes_ant_fim date;
  v_lucro numeric;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Mesmos dias do mês anterior (dia 1 até o mesmo dia do mês, ou o fim dele).
  v_mes_ant_fim := LEAST(v_mes_ant_inicio + (v_hoje - v_mes_inicio), v_mes_inicio - 1);
  v_lucro := (public.fin_dre(v_mes_inicio, v_hoje) ->> 'lucro_liquido')::numeric;

  WITH v AS (
    SELECT * FROM public.crm__vendas(now()) WHERE dia >= v_mes_ant_inicio - 14
  ), prev AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  )
  SELECT jsonb_build_object(
    'hoje', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje),
      'online', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje AND canal = 'online'),
      'presencial', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje AND canal = 'presencial'),
      'pedidos', (SELECT count(*) FROM v WHERE dia = v_hoje),
      'receita_semana_passada', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje - 7)
    ),
    'mes', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'receita_mes_anterior', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_ant_inicio AND v_mes_ant_fim),
      'pedidos', (SELECT count(*) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'lucro_estimado', v_lucro
    ),
    'saldo_total', (SELECT COALESCE(round(sum(s.saldo), 2), 0)
                      FROM public.fin__saldos() s JOIN public.fin_contas c ON c.id = s.conta_id WHERE c.ativa),
    'a_receber_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'entrada' AND venc <= v_hoje + 7),
    'a_pagar_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7),
    'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje),
    'pendencias', jsonb_build_object(
      'pedidos_para_preparar', (SELECT count(*) FROM public.marketplace_orders o
                                 WHERE o.status IN ('new', 'pending', 'processing')
                                   AND COALESCE(o.payment_status, '') NOT IN ('aguardando', 'expirado', 'recusado', 'estornado')),
      'devolucoes_abertas', (SELECT count(*) FROM public.devolucoes d
                              WHERE d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')),
      'caixa_aberto', EXISTS (SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.status = 'aberto'),
      'estoque_baixo', (SELECT count(*) FROM public.produtos p
                         WHERE p.deleted_at IS NULL AND COALESCE(p.ativo, true)
                           AND (
                             (NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active)
                              AND COALESCE(p.estoque, 0) <= COALESCE(p.estoque_minimo, 3))
                             OR EXISTS (SELECT 1 FROM public.product_variants pv
                                         WHERE pv.product_id = p.id AND pv.active
                                           AND COALESCE(pv.stock_increment, 0) <= COALESCE(p.estoque_minimo, 3))
                           ))
    ),
    'serie_14d', (SELECT jsonb_agg(jsonb_build_object(
                     'dia', d.dia::date,
                     'receita', COALESCE((SELECT sum(total) FROM v WHERE v.dia = d.dia::date), 0)
                   ) ORDER BY d.dia)
                    FROM generate_series((v_hoje - 13)::timestamp, v_hoje::timestamp, interval '1 day') AS d(dia))
  ) INTO v_res;
  RETURN v_res;
END;
$$;

-- get_admin_analytics_v2: corpo vigente da 20261062000000_o_hoje_do_painel_e_o_dia_do_lojista.sql.
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;

    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;

    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;

    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;

    -- avg ticket (all-time)
    avg_ticket numeric;

    -- active customers (all-time)
    active_customers bigint;

    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;

    -- lists
    rev_history json;
    top_prods json;

    -- dinheiro reconhecido: pedido concluído e cobrança paga fora do prazo,
    -- mesmo com o pedido cancelado (achados 2 e 3, 22/08/2026)
    delivered_total bigint;
    paid_on_cancelled bigint;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', (now() - interval '1 day') AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned')
    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    -- Estoque efetivo: soma dos `stock_increment` das variantes ATIVAS
    -- quando existe ao menos uma variante ativa; senão a coluna
    -- `produtos.estoque` crua. É a MESMA regra de src/lib/mappers.ts:98-107
    -- (mapProductFromDB), que o cartão do produto, o formulário e a loja já
    -- usam — antes esta função lia a coluna crua e divergia (achado 13,
    -- 20/08/2026). Calculada uma única vez e usada nos dois agregados
    -- abaixo (estoque baixo, custo/valor de estoque).
    WITH estoque_efetivo AS (
        SELECT
            p.custo,
            p.preco_venda,
            p.estoque_minimo,
            CASE
                WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                ELSE p.estoque
            END AS estoque
        FROM public.produtos p
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE pv.active) AS qtd_ativas,
                SUM(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
            FROM public.product_variants pv
            WHERE pv.product_id = p.id
        ) v ON true
        WHERE p.deleted_at IS NULL AND p.ativo = true
    )
    SELECT
        COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),
        COALESCE(SUM(custo * estoque), 0),
        COALESCE(SUM(preco_venda * estoque), 0)
    INTO low_stock_count, inv_cost_total, inv_value_total
    FROM estoque_efetivo;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                ((now() AT TIME ZONE 'America/Sao_Paulo')
                - (p_limit_days || ' days')::interval)::date,
                (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ),
        daily_items AS (
            SELECT
                (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            JOIN public.produtos p ON oi.product_id = p.id
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
              AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY ((o.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        )
        SELECT
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        SELECT
            p.id as id,
            p.nome AS name,
            SUM(oi.quantity)::int as quantity,
            SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
        AND p.deleted_at IS NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)
    SELECT COUNT(*) INTO delivered_total
    FROM public.marketplace_orders
    WHERE status = 'delivered';

    SELECT COUNT(*) INTO paid_on_cancelled
    FROM public.marketplace_orders
    WHERE payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') AND status = 'cancelled';

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue,
            'count', today_count,
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue,
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total
        ),
        'averageTicket', round(avg_ticket, 2),
        'deliveredTotal', delivered_total,
        'paidOnCancelled', paid_on_cancelled
    );

    RETURN result;
END;
$$;

-- get_category_analytics: corpo vigente da 20261063000000_o_donut_soma_o_dinheiro_do_kpi.sql.
CREATE OR REPLACE FUNCTION public.get_category_analytics(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(name text, value numeric, orders bigint, avg_ticket numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    -- Guarda de autorização: SECURITY DEFINER ignora o RLS das três tabelas
    -- abaixo, então quem autoriza é esta linha.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    WITH itens AS (
        SELECT
            oi.order_id,
            COALESCE(p.categoria, 'Geral')::text AS nome_categoria,
            oi.price * oi.quantity AS valor_item
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON oi.product_id = p.id
    ),
    fatia AS (
        -- Subtotal da categoria no pedido e subtotal de TODOS os itens do
        -- pedido — a fração entre os dois é a fatia do `total` que cabe à
        -- categoria (o rateio reparte cupom e frete na proporção do que
        -- foi vendido).
        SELECT
            i.order_id,
            i.nome_categoria,
            SUM(i.valor_item) AS subtotal_categoria,
            SUM(SUM(i.valor_item)) OVER (PARTITION BY i.order_id)
                AS subtotal_pedido
        FROM itens i
        GROUP BY i.order_id, i.nome_categoria
    ),
    pedidos AS (
        SELECT o.id, o.total
        FROM public.marketplace_orders o
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
          -- Mesmo critério de dinheiro reconhecido de
          -- get_admin_analytics_v2 (as três portas, sem IS NULL —
          -- caractere a caractere com a 20261022).
          AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
    )
    SELECT
        f.nome_categoria,
        SUM(p.total * f.subtotal_categoria
            / NULLIF(f.subtotal_pedido, 0))::numeric AS valor_total,
        COUNT(DISTINCT f.order_id)::bigint AS num_pedidos,
        ROUND(
            SUM(p.total * f.subtotal_categoria
                / NULLIF(f.subtotal_pedido, 0))
            / COUNT(DISTINCT f.order_id),
            2
        ) AS ticket_medio
    FROM fatia f
    JOIN pedidos p ON p.id = f.order_id
    GROUP BY f.nome_categoria
    ORDER BY 2 DESC;
END;
$$;

-- get_coupon_stats: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
 RETURNS TABLE(total_coupons bigint, active_coupons bigint, total_uses bigint, avg_discount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        COALESCE(SUM(usage_count), 0)::BIGINT,
        COALESCE(AVG(value), 0)::NUMERIC
    FROM public.coupons;
END;
$$;

-- get_retention_rate: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.get_retention_rate()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    total_customers bigint := 0;
    repeated_customers bigint := 0;
    retention_rate numeric := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Não autorizado.';
    END IF;

    SELECT count(DISTINCT user_id) INTO total_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    IF total_customers > 0 THEN
        WITH order_counts AS (
            SELECT count(*) AS purchase_count FROM public.marketplace_orders
            WHERE status NOT IN ('cancelled', 'returned') GROUP BY user_id
        )
        SELECT count(*) INTO repeated_customers FROM order_counts WHERE purchase_count > 1;
        retention_rate := (repeated_customers::numeric / total_customers::numeric) * 100.0;
    END IF;

    RETURN round(retention_rate, 1);
END;
$$;

-- get_segmented_push_count: corpo vigente da 20261023000000_push_conta_sem_baixar_credencial.sql.
CREATE OR REPLACE FUNCTION public.get_segmented_push_count(p_segment text DEFAULT 'all'::text, p_min_ltv numeric DEFAULT 150, p_days_inactive integer DEFAULT 30)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
    -- Authorization check (igual à original)
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- Case 1: Specific User (UUID format)
    IF p_segment ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id = p_segment::uuid);

    -- Case 2: VIP Segment (Users with recognized-money LTV >= p_min_ltv)
    ELSIF p_segment = 'vip' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT o.user_id
            FROM public.marketplace_orders o
            WHERE o.status NOT IN ('cancelled', 'returned')
            AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY o.user_id
            HAVING SUM(o.total::numeric) >= p_min_ltv
        ));

    -- Case 3: Inactive Segment (Inactive for >= p_days_inactive)
    ELSIF p_segment = 'inactive' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            -- Users whose last order was more than X days ago
            SELECT o.user_id
            FROM public.marketplace_orders o
            GROUP BY o.user_id
            HAVING MAX(o.created_at) < NOW() - (p_days_inactive || ' days')::interval
        ) OR s.user_id IN (
            -- Users who registered more than X days ago and have never ordered
            SELECT p.id
            FROM public.profiles p
            LEFT JOIN public.marketplace_orders o ON o.user_id = p.id
            WHERE p.created_at < NOW() - (p_days_inactive || ' days')::interval
              AND o.id IS NULL
        ));

    -- Case 4: New Clients Segment (Created within the last 7 days)
    ELSIF p_segment = 'new' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT p.id
            FROM public.profiles p
            WHERE p.created_at >= NOW() - INTERVAL '7 days'
        ));

    -- Case 5: All (Default fallback)
    ELSE
        RETURN (SELECT COUNT(*) FROM public.push_subscriptions s);
    END IF;
END;
$$;

-- fin_contas_listar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_contas_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'saldo_inicial', c.saldo_inicial,
      'saldo_inicial_em', c.saldo_inicial_em, 'ativa', c.ativa, 'ordem', c.ordem,
      'sistema', c.sistema, 'saldo', round(s.saldo, 2)
    ) ORDER BY c.ordem, c.nome)
    FROM public.fin_contas c JOIN public.fin__saldos() s ON s.conta_id = c.id
  ), '[]'::jsonb);
END;
$$;

-- fin_categorias_listar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_categorias_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'natureza', c.natureza, 'grupo_dre', c.grupo_dre,
      'ativa', c.ativa, 'sistema', c.sistema
    ) ORDER BY c.natureza DESC, c.ordem, c.nome)
    FROM public.fin_categorias c
  ), '[]'::jsonb);
END;
$$;

-- fin_extrato: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_extrato(p_inicio date, p_fim date, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'origem', m.origem, 'tipo', m.tipo, 'status', m.status, 'valor', m.valor,
      'data', m.data, 'conta_id', m.conta_id, 'conta_nome', c.nome,
      'conta_destino_id', m.conta_destino_id, 'conta_destino_nome', cd.nome,
      'categoria_id', m.categoria_id, 'categoria_nome', cat.nome,
      'descricao', m.descricao, 'forma_pagamento', m.forma_pagamento,
      'pedido_id', m.pedido_id, 'vencimento', m.vencimento, 'editavel', m.editavel
    ) ORDER BY m.data DESC, m.status, m.id DESC)
    FROM public.fin__movimentos(p_inicio, p_fim) m
    LEFT JOIN public.fin_contas c ON c.id = m.conta_id
    LEFT JOIN public.fin_contas cd ON cd.id = m.conta_destino_id
    LEFT JOIN public.fin_categorias cat ON cat.id = m.categoria_id
   WHERE p_conta_id IS NULL OR m.conta_id = p_conta_id OR m.conta_destino_id = p_conta_id
  ), '[]'::jsonb);
END;
$$;

-- fin_previstos: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_previstos(p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('entrada', 'saida') THEN
    RAISE EXCEPTION 'Tipo inválido: use entrada (a receber) ou saida (a pagar).' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'descricao', m.descricao, 'valor', m.valor,
      'vencimento', COALESCE(m.vencimento, m.data),
      'vencido', COALESCE(m.vencimento, m.data) < v_hoje,
      'conta_id', m.conta_id, 'conta_nome', c.nome,
      'categoria_id', m.categoria_id, 'categoria_nome', cat.nome,
      'parcela', m.parcela, 'parcelas', m.parcelas, 'origem', m.origem,
      'pedido_id', m.pedido_id, 'editavel', m.editavel
    ) ORDER BY COALESCE(m.vencimento, m.data), m.descricao)
    FROM public.fin__movimentos(NULL, NULL) m
    LEFT JOIN public.fin_contas c ON c.id = m.conta_id
    LEFT JOIN public.fin_categorias cat ON cat.id = m.categoria_id
   WHERE m.status = 'previsto' AND m.tipo = p_tipo
  ), '[]'::jsonb);
END;
$$;

-- fin_resumo: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  WITH periodo AS (
    SELECT * FROM public.fin__movimentos(p_inicio, p_fim) WHERE status = 'realizado'
  ), previstos AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  ), saldos AS (
    SELECT c.id, c.nome, c.tipo, c.ativa, c.ordem, round(s.saldo, 2) AS saldo
      FROM public.fin_contas c JOIN public.fin__saldos() s ON s.conta_id = c.id
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'saldo_total', COALESCE((SELECT sum(saldo) FROM saldos WHERE ativa), 0),
    'contas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'saldo', saldo)
                          ORDER BY ordem, nome) FROM saldos WHERE ativa), '[]'::jsonb),
    'entradas', COALESCE((SELECT sum(valor) FROM periodo WHERE tipo = 'entrada'), 0),
    'saidas', COALESCE((SELECT sum(valor) FROM periodo WHERE tipo = 'saida'), 0),
    'resultado', COALESCE((SELECT sum(CASE WHEN tipo = 'entrada' THEN valor WHEN tipo = 'saida' THEN -valor ELSE 0 END)
                           FROM periodo), 0),
    'a_receber', jsonb_build_object(
      'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'entrada'), 0),
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'entrada' AND venc < v_hoje), 0),
      'proximos_7_dias', COALESCE((SELECT sum(valor) FROM previstos
                                    WHERE tipo = 'entrada' AND venc BETWEEN v_hoje AND v_hoje + 7), 0)),
    'a_pagar', jsonb_build_object(
      'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida'), 0),
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND venc < v_hoje), 0),
      'proximos_7_dias', COALESCE((SELECT sum(valor) FROM previstos
                                    WHERE tipo = 'saida' AND venc BETWEEN v_hoje AND v_hoje + 7), 0)),
    'por_forma', COALESCE((SELECT jsonb_agg(jsonb_build_object('forma', forma, 'valor', total) ORDER BY total DESC)
                             FROM (SELECT forma_pagamento AS forma, sum(valor) AS total FROM periodo
                                    WHERE origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
                                    GROUP BY forma_pagamento) f), '[]'::jsonb),
    'por_canal', jsonb_build_object(
      'online', COALESCE((SELECT sum(valor) FROM periodo WHERE origem IN ('venda_online', 'venda_entrega')), 0),
      'presencial', COALESCE((SELECT sum(valor) FROM periodo WHERE origem = 'venda_balcao'), 0)),
    'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'dia', d.dia::date,
                 'entradas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'entrada'), 0),
                 'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0)
               ) ORDER BY d.dia)
               FROM generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') AS d(dia)), '[]'::jsonb),
    'caixa_aberto', (SELECT jsonb_build_object('id', s.id, 'conta_id', s.conta_id,
                                               'aberto_em', s.aberto_em, 'valor_abertura', s.valor_abertura)
                       FROM public.fin_caixa_sessoes s WHERE s.status = 'aberto'
                      ORDER BY s.aberto_em DESC LIMIT 1)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

-- fin_dre: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_dre(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_online numeric;
  v_balcao numeric;
  v_outras_receitas numeric;
  v_ded_derivadas numeric;
  v_ded_manuais numeric;
  v_deducoes numeric;
  v_cmv numeric;
  v_cmv_volta numeric;
  v_variaveis numeric;
  v_fixas numeric;
  v_financeiro numeric;
  v_bruta numeric;
  v_liquida numeric;
  v_lucro_bruto numeric;
  v_margem numeric;
  v_operacional numeric;
  v_linhas_manuais jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;

  -- Competência: derivados pela data do dinheiro; manuais pela competência,
  -- previstos inclusive (a despesa do mês pesa no mês, paga ou não). Estorno
  -- pendente ainda não é dedução. Uma consulta só (sem tabela temporária: a
  -- função roda também em transação só-leitura).
  WITH mov AS (
    SELECT * FROM public.fin__movimentos(NULL, NULL) m
     WHERE m.data_competencia BETWEEN p_inicio AND p_fim
       AND (m.status = 'realizado' OR (m.status = 'previsto' AND m.origem <> 'estorno'))
  ), manuais AS (
    SELECT m.tipo, m.valor, c.grupo_dre, c.nome
      FROM mov m JOIN public.fin_categorias c ON c.id = m.categoria_id
     WHERE m.origem IN ('manual', 'ajuste_caixa') AND m.tipo <> 'transferencia'
  )
  SELECT
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('venda_online', 'venda_entrega')),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem = 'venda_balcao'),
    (SELECT COALESCE(sum(valor), 0) FROM mov WHERE origem IN ('estorno', 'estorno_externo', 'devolucao')),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'entrada' AND grupo_dre = 'receita'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'deducao'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'custo_variavel'),
    (SELECT COALESCE(sum(valor), 0) FROM manuais WHERE tipo = 'saida' AND grupo_dre = 'despesa_fixa'),
    (SELECT COALESCE(sum(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END), 0)
       FROM manuais WHERE grupo_dre = 'financeiro'),
    -- CMV estimado pelo custo ATUAL do produto (o app não guarda custo
    -- histórico), menos o que voltou para a prateleira por devolução no
    -- período. Achado K, refinado pelo achado 4 (rodada 2): a exclusão não é
    -- "stock_returned_at preenchido" sozinho — a política P1 (pago após
    -- expirar, HONRAR) deixa esse carimbo em pedido que foi reativado e
    -- ENTREGUE de verdade (não é mais cancelamento nenhum, e o produto SAIU
    -- da loja outra vez, com custo real). Só CANCELADO com estoque já de
    -- volta é que não custou nada; por isso a condição junta as duas coisas.
    (SELECT COALESCE(sum(oi.quantity * COALESCE(p.custo, 0)), 0)
       FROM mov m
       JOIN public.marketplace_orders o2 ON o2.id = m.pedido_id
       JOIN public.marketplace_order_items oi ON oi.order_id = m.pedido_id
       LEFT JOIN public.produtos p ON p.id = oi.product_id
      WHERE m.origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
        AND NOT (o2.status = 'cancelled' AND o2.stock_returned_at IS NOT NULL)),
    -- Achado 5 (rodada 2): o desconto de devolução PARCIAL não pode contar de
    -- novo o item de um pedido que a linha acima JÁ excluiu inteiro (cancelado
    -- + estoque de volta) — sem este filtro, o mesmo item saía do CMV duas
    -- vezes (uma pela exclusão do pedido inteiro, outra por este desconto) e
    -- comia o custo de OUTRAS vendas do período.
    (SELECT COALESCE(sum(di.quantidade * COALESCE(p.custo, 0)), 0)
       FROM public.devolucao_itens di
       JOIN public.devolucoes d3 ON d3.id = di.devolucao_id
       JOIN public.marketplace_orders o3 ON o3.id = d3.order_id
       LEFT JOIN public.produtos p ON p.id = di.product_id
      WHERE di.reestocado_em IS NOT NULL
        AND public.fin__dia(di.reestocado_em) BETWEEN p_inicio AND p_fim
        AND NOT (o3.status = 'cancelled' AND o3.stock_returned_at IS NOT NULL)),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('grupo', g.grupo_dre, 'categoria', g.nome, 'valor', g.total)
                               ORDER BY g.ordem, g.total DESC), '[]'::jsonb)
       FROM (SELECT grupo_dre, nome, sum(valor) AS total,
                    CASE grupo_dre WHEN 'receita' THEN 1 WHEN 'deducao' THEN 2 WHEN 'custo_variavel' THEN 4
                                   WHEN 'despesa_fixa' THEN 5 ELSE 6 END AS ordem
               FROM manuais WHERE grupo_dre <> 'fora_dre'
              GROUP BY grupo_dre, nome) g)
    INTO v_online, v_balcao, v_ded_derivadas, v_outras_receitas, v_ded_manuais,
         v_variaveis, v_fixas, v_financeiro, v_cmv, v_cmv_volta, v_linhas_manuais;

  v_cmv := GREATEST(v_cmv - v_cmv_volta, 0);
  v_deducoes := v_ded_derivadas + v_ded_manuais;
  v_bruta := v_online + v_balcao + v_outras_receitas;
  v_liquida := v_bruta - v_deducoes;
  v_lucro_bruto := v_liquida - v_cmv;
  v_margem := v_lucro_bruto - v_variaveis;
  v_operacional := v_margem - v_fixas;

  RETURN jsonb_build_object(
    'receita_bruta', v_bruta,
    'receita_online', v_online,
    'receita_balcao', v_balcao,
    'deducoes', v_deducoes,
    'receita_liquida', v_liquida,
    'cmv', v_cmv,
    'cmv_estimado', true,
    'lucro_bruto', v_lucro_bruto,
    'custos_variaveis', v_variaveis,
    'margem_contribuicao', v_margem,
    'despesas_fixas', v_fixas,
    'resultado_operacional', v_operacional,
    'resultado_financeiro', v_financeiro,
    'lucro_liquido', v_operacional + v_financeiro,
    'linhas',
      (SELECT COALESCE(jsonb_agg(l - 'ordem' ORDER BY (l ->> 'ordem')::int), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas pelo app', 'valor', v_online, 'ordem', 1) AS l
          WHERE v_online > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'receita', 'categoria', 'Vendas na loja física', 'valor', v_balcao, 'ordem', 1)
          WHERE v_balcao > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'deducao', 'categoria', 'Estornos e devoluções', 'valor', v_ded_derivadas, 'ordem', 2)
          WHERE v_ded_derivadas > 0
         UNION ALL SELECT jsonb_build_object('grupo', 'cmv', 'categoria', 'Custo das mercadorias vendidas', 'valor', v_cmv, 'ordem', 3)
          WHERE v_cmv > 0
       ) x) || v_linhas_manuais
  );
END;
$$;

-- fin_caixa_atual: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_caixa_atual()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_s.id, 'conta_id', v_s.conta_id,
    'conta_nome', (SELECT nome FROM public.fin_contas WHERE id = v_s.conta_id),
    'aberto_em', v_s.aberto_em, 'valor_abertura', v_s.valor_abertura
  ) || public.fin__caixa_calculo(v_s.id) || jsonb_build_object(
    'movimentos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'origem', l.origem, 'tipo', l.tipo, 'valor', l.valor, 'descricao', l.descricao,
        'entra', (l.tipo = 'entrada' OR l.conta_destino_id = v_s.conta_id), 'criado_em', l.created_at
      ) ORDER BY l.created_at DESC)
      FROM public.fin_lancamentos l
     WHERE l.caixa_sessao_id = v_s.id AND l.status = 'realizado'), '[]'::jsonb)
  );
END;
$$;

-- fin_caixa_historico: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_caixa_historico(p_limite integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'conta_nome', c.nome, 'aberto_em', s.aberto_em, 'fechado_em', s.fechado_em,
      'valor_abertura', s.valor_abertura, 'esperado', s.valor_esperado, 'contado', s.valor_contado,
      'diferenca', s.diferenca, 'status', s.status
    ) ORDER BY s.aberto_em DESC)
    FROM (SELECT * FROM public.fin_caixa_sessoes ORDER BY aberto_em DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limite, 30), 1), 200)) s
    JOIN public.fin_contas c ON c.id = s.conta_id
  ), '[]'::jsonb);
END;
$$;

-- ===== escrita de dinheiro, estoque e configuração =====

-- confirmar_retorno_do_produto: corpo vigente da 20260970000000_cancelamento_respeita_o_envio.sql.
CREATE OR REPLACE FUNCTION public.confirmar_retorno_do_produto(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_status TEXT;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja confirma que o produto voltou.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja confirma que o produto voltou.';
    END IF;

    SELECT status, cancelled_after_shipping, returned_to_seller_at
      INTO v_status, v_cancelled_after_shipping, v_returned_at
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF NOT v_cancelled_after_shipping THEN
        RAISE EXCEPTION 'Este pedido não estava enviado quando foi cancelado: não há produto para voltar.';
    END IF;

    -- cancelled_after_shipping e' HISTORICO (nunca volta a false): se a loja
    -- reativou o pedido para outro status depois do cancelamento (ex.:
    -- 'delivered'), o produto NAO esta voltando -- esta entregue, na mao do
    -- cliente. Sem esta guarda a RPC ainda aceitava e creditava estoque
    -- fantasma. Medido: pedido cancelado-apos-envio reativado para
    -- 'delivered', estoque 499 -> 500 com o produto entregue.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Este pedido não está mais cancelado: não há retorno para confirmar.';
    END IF;

    -- Idempotencia: sem isto, dois cliques dobram o estoque da loja.
    IF v_returned_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'ja_confirmado', true, 'returned_to_seller_at', v_returned_at);
    END IF;

    -- Mesmo laco de public.devolver_estoque(uuid) (20260807000000), sem nada
    -- alem dele -- reusa a funcao em vez de manter uma terceira copia do
    -- mesmo invariante (IF/ELSE variante XOR produto).
    PERFORM public.devolver_estoque(p_order_id);

    UPDATE public.marketplace_orders
       SET returned_to_seller_at = now()
     WHERE id = p_order_id;

    RETURN jsonb_build_object('ok', true, 'ja_confirmado', false);
END;
$$;

-- registrar_venda_presencial: corpo vigente da 20261162000000_a_venda_no_balcao_nasce_inteira.sql.
CREATE OR REPLACE FUNCTION public.registrar_venda_presencial(p_itens jsonb, p_pagamento text, p_cliente_user_id uuid DEFAULT NULL::uuid, p_cliente_nome text DEFAULT NULL::text, p_cliente_whatsapp text DEFAULT NULL::text, p_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
    v_vendedor uuid;
    v_order_id uuid;
    v_canal_existente text;
    v_vendedor_existente uuid;
    v_ja_existia boolean := false;

    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_subtotal numeric := 0;
    v_desconto numeric := 0;
    v_total numeric := 0;
    v_customer_name text;
BEGIN
    -- (1) O GATE VEM ANTES DE QUALQUER LEITURA. Quem não é da loja não pode
    -- nem descobrir que um produto existe pela mensagem de erro que recebe.
    IF public.is_admin() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF public.is_admin_atual() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
    END IF;

    -- Quem vende é SEMPRE a sessão, nunca um parâmetro: um `p_vendedor` seria
    -- o balconista podendo assinar a venda no nome de outro.
    v_vendedor := auth.uid();
    IF v_vendedor IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Não autorizado: é preciso estar autenticado para registrar a venda.';
    END IF;

    -- (2) IDEMPOTÊNCIA, ANTES DE TUDO (forma de 20261081000000:125-133). O
    -- balcão é o lugar onde o mesmo clique mais se repete: a rede do
    -- estabelecimento cai DEPOIS do commit, o operador não vê a confirmação e
    -- bipa "finalizar" de novo. A retentativa honesta tem de receber o pedido
    -- que JÁ NASCEU — não um gêmeo com o estoque debitado duas vezes.
    --
    -- A guarda é OUTRA que a da v23, de propósito: lá ela casa por `user_id`,
    -- que no balcão é o CLIENTE (quase sempre NULL, porque a venda é avulsa).
    -- Casar por cliente aqui devolveria pedido alheio para qualquer chave
    -- repetida. Quem responde pela chave da venda de balcão é o CANAL e o
    -- BALCONISTA.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT o.id, o.canal, o.vendedor_id
          INTO v_order_id, v_canal_existente, v_vendedor_existente
          FROM public.marketplace_orders o
         WHERE o.idempotency_key = p_idempotency_key;

        IF v_order_id IS NOT NULL THEN
            IF v_canal_existente IS DISTINCT FROM 'presencial'
               OR v_vendedor_existente IS DISTINCT FROM v_vendedor THEN
                RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Esta chave de venda já foi usada por outro pedido.';
            END IF;
            v_ja_existia := true;
        END IF;
    END IF;

    IF NOT v_ja_existia THEN
        -- (3) VALIDAÇÃO DOS PARÂMETROS.
        --
        -- A lista de formas de pagamento é FECHADA aqui dentro porque o banco
        -- não tem CHECK de `payment_method` (e criar uma recusaria pedido
        -- legado, ex.: 'na_entrega'). Esta RPC é a única porta do balcão, e é
        -- nela que a lista vale.
        IF p_pagamento IS NULL OR p_pagamento NOT IN ('cash','pix','card') THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Forma de pagamento inválida para venda no balcão.';
        END IF;

        IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A venda precisa de pelo menos um item.';
        END IF;

        -- Teto de itens: o balcão não vende 200 linhas diferentes numa
        -- compra; um payload maior que isso é engano ou abuso, e cada item
        -- custa uma trava de linha dentro da transação.
        IF jsonb_array_length(p_itens) > 200 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Venda com itens demais.';
        END IF;

        v_desconto := round(COALESCE(p_desconto, 0), 2);
        IF v_desconto < 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O desconto não pode ser negativo.';
        END IF;

        -- D4: desconto no balcão SEM motivo escrito é dinheiro que some sem
        -- rastro. O motivo vira `notes` do pedido, que o painel já mostra.
        IF v_desconto > 0 AND NULLIF(btrim(COALESCE(p_observacao,'')),'') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo do desconto.';
        END IF;

        IF p_cliente_user_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_cliente_user_id) THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Cliente não encontrado.';
            END IF;
        END IF;

        -- (4) PRIMEIRO LAÇO — TRAVAR E CONFERIR (forma de 20261081000000:218-297,
        -- sem a parte de frete e de cupom, que o balcão não tem). O preço sai
        -- SEMPRE do banco: não existe parâmetro de preço nesta RPC.
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
        LOOP
            v_product_id := (v_item->>'product_id')::uuid;
            v_variant_id := (v_item->>'variant_id')::uuid;
            v_quantity := (v_item->>'quantity')::integer;

            IF v_quantity IS NULL OR v_quantity <= 0 THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Quantidade inválida para um dos itens.';
            END IF;

            IF v_variant_id IS NOT NULL THEN
                SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome
                  INTO v_db_price, v_db_stock, v_item_name
                  FROM public.produtos p
                  JOIN public.product_variants v ON v.product_id = p.id
                 WHERE v.id = v_variant_id AND p.id = v_product_id
                   AND v.active = true AND p.ativo = true AND p.deleted_at IS NULL
                   FOR NO KEY UPDATE OF v;
            ELSE
                -- A TRAVA DE LINHA VEM PRIMEIRO, e a guarda de variação
                -- obrigatória vem DEPOIS — é a ordem que a v23 tem desde
                -- 20261081000000:235-275, e o comentário de lá explica por que
                -- inverter reabre uma corrida sob READ COMMITTED: com a guarda
                -- antes, ela e o SELECT tomam SNAPSHOTS DIFERENTES, e um
                -- UPDATE concorrente em `produtos.ativo` passa entre os dois.
                SELECT p.preco_venda, p.estoque, p.nome
                  INTO v_db_price, v_db_stock, v_item_name
                  FROM public.produtos p
                 WHERE p.id = v_product_id AND p.ativo = true AND p.deleted_at IS NULL
                   FOR NO KEY UPDATE;

                -- Bipar o produto pai de um produto que TEM variação ativa
                -- venderia pelo preço errado e baixaria o estoque agregado em
                -- vez do tamanho escolhido — o operador entrega a caixa e o
                -- estoque daquele tamanho nunca desce.
                IF v_db_price IS NOT NULL AND EXISTS (
                    SELECT 1
                      FROM public.product_variants v
                     WHERE v.product_id = v_product_id
                       AND v.active = true
                ) THEN
                    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Escolha uma variação para o produto %s.', COALESCE(v_item_name,'selecionado'));
                END IF;
            END IF;

            IF v_db_price IS NULL THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Produto %s não disponível.', COALESCE(v_item_name,'não encontrado'));
            END IF;

            IF v_db_stock < v_quantity THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Estoque insuficiente para o produto %s (Disponível: %s, Solicitado: %s)', v_item_name, v_db_stock, v_quantity);
            END IF;

            v_subtotal := v_subtotal + (v_db_price * v_quantity);
        END LOOP;

        -- (5) TOTAL. Falha FECHADA, ao contrário do clamp da v23
        -- (20261081000000:457-459): lá o desconto vem de um cupom e sobrar
        -- centavo é arredondamento; aqui o desconto é DIGITADO pelo
        -- balconista, e um valor maior que a venda é erro de digitação — zerar
        -- calado esconderia o engano.
        IF v_desconto > v_subtotal THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O desconto não pode ser maior que o subtotal da venda.';
        END IF;
        v_total := v_subtotal - v_desconto;

        -- (6) NOME DO CLIENTE. A coluna é NOT NULL (baseline:3959) e a venda
        -- de balcão é avulsa por desenho (D2): sem nome digitado e sem perfil,
        -- o pedido nasce como "Venda no balcão", que é a verdade.
        v_customer_name := COALESCE(
            NULLIF(btrim(p_cliente_nome),''),
            (SELECT NULLIF(btrim(pr.full_name),'') FROM public.profiles pr WHERE pr.id = p_cliente_user_id),
            'Venda no balcão'
        );

        -- (7) INSERT DO CABEÇALHO. `expires_at` fica FORA da lista de colunas
        -- de propósito: aquela coluna é a reserva de 30 min do PIX, e a venda
        -- de balcão já está paga e entregue — NULL é o valor certo.
        -- `customer_phone` também fica de fora, por paridade com a v23
        -- (20261081000000:485-491), que guarda o whatsapp em `customer_data`.
        BEGIN
            INSERT INTO public.marketplace_orders (
                user_id, total, subtotal, shipping, discount,
                payment_method, status, payment_status, pagamento_recebido_em,
                pagamento_recebido_por, vendedor_id, canal,
                customer_name, customer_data, notes, idempotency_key
            ) VALUES (
                p_cliente_user_id, v_total, v_subtotal, 0, v_desconto,
                p_pagamento, 'delivered', 'recebido_na_entrega', now(),
                v_vendedor, v_vendedor, 'presencial',
                v_customer_name,
                jsonb_build_object(
                    'whatsapp', NULLIF(btrim(COALESCE(p_cliente_whatsapp,'')),''),
                    'canal', 'presencial'
                ),
                NULLIF(btrim(COALESCE(p_observacao,'')),''),
                p_idempotency_key
            ) RETURNING id INTO v_order_id;

        EXCEPTION
            WHEN unique_violation THEN
                -- A corrida PERDEU: a requisição gêmea com a MESMA chave
                -- commitou primeiro. Devolvo o pedido dela — pela MESMA guarda
                -- do passo (2), nunca por `user_id`.
                SELECT o.id, o.canal, o.vendedor_id
                  INTO v_order_id, v_canal_existente, v_vendedor_existente
                  FROM public.marketplace_orders o
                 WHERE o.idempotency_key = p_idempotency_key;

                IF v_order_id IS NULL
                   OR v_canal_existente IS DISTINCT FROM 'presencial'
                   OR v_vendedor_existente IS DISTINCT FROM v_vendedor THEN
                    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Esta chave de venda já foi usada por outro pedido.';
                END IF;
                v_ja_existia := true;
        END;
    END IF;

    IF NOT v_ja_existia THEN
        -- (8) SEGUNDO LAÇO — BAIXA DE ESTOQUE XOR E SNAPSHOT DO ITEM
        -- (forma de 20261081000000:513-554). IF/ELSE, nunca dois IF: debitar
        -- a variação E o produto pai desinfla o catálogo para sempre — é o
        -- defeito que o IF/ELSE de `devolver_estoque` documenta
        -- (20261060000000:154-158). O `AND ... >=` no WHERE mais o
        -- `ROW_COUNT = 0` são a segunda trava: entre a conferência do primeiro
        -- laço e este UPDATE, o estoque pode ter sido levado por outra venda.
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
        LOOP
            v_product_id := (v_item->>'product_id')::uuid;
            v_variant_id := (v_item->>'variant_id')::uuid;
            v_quantity := (v_item->>'quantity')::integer;

            IF v_variant_id IS NOT NULL THEN
                UPDATE public.product_variants
                   SET stock_increment = stock_increment - v_quantity
                 WHERE id = v_variant_id AND stock_increment >= v_quantity;

                GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
                IF v_rows_affected = 0 THEN
                    SELECT p.nome INTO v_item_name
                      FROM public.produtos p
                      JOIN public.product_variants v ON v.product_id = p.id
                     WHERE v.id = v_variant_id;
                    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Estoque insuficiente para o produto %s', v_item_name);
                END IF;

                -- Releitura do preço DEPOIS da baixa, como a v23 faz
                -- (20261081000000:530-534 e :546): o snapshot do item é o
                -- preço que valia no instante em que a peça saiu da prateleira.
                SELECT COALESCE(v.price_override, p.preco_venda), p.nome
                  INTO v_db_price, v_item_name
                  FROM public.produtos p
                  JOIN public.product_variants v ON v.product_id = p.id
                 WHERE v.id = v_variant_id;
            ELSE
                UPDATE public.produtos
                   SET estoque = estoque - v_quantity
                 WHERE id = v_product_id AND estoque >= v_quantity;

                GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
                IF v_rows_affected = 0 THEN
                    SELECT p.nome INTO v_item_name FROM public.produtos p WHERE p.id = v_product_id;
                    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Estoque insuficiente para o produto %s', v_item_name);
                END IF;

                SELECT p.preco_venda, p.nome
                  INTO v_db_price, v_item_name
                  FROM public.produtos p
                 WHERE p.id = v_product_id;
            END IF;

            -- As MESMAS 6 colunas da v23 (20261081000000:549-553).
            -- `image_url` fica FORA: o mapper do front já cai na imagem do
            -- produto quando a do item é nula (src/lib/mappers.ts:243-246), e
            -- copiar a URL aqui seria uma segunda verdade envelhecendo sozinha.
            INSERT INTO public.marketplace_order_items (
                order_id, product_id, variant_id, quantity, price, product_name
            ) VALUES (
                v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
            );
        END LOOP;

        -- (9) OS DOIS HISTÓRICOS. São listas de naturezas diferentes: uma
        -- conta a vida do PEDIDO, a outra a do DINHEIRO (20261020000000:56-58).
        -- A venda de balcão nasce nos dois pontos finais de uma vez, e é por
        -- isso que `old_status` e `payment_status_antes` são NULL: não houve
        -- estado anterior nenhum.
        INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
        VALUES (v_order_id, NULL, 'delivered', 'Venda no balcão', v_vendedor);

        -- A CHECK de `acao` só aceita 'recebido' | 'desfeito'
        -- (20261020000000:61) — nada de rótulo novo por canal aqui.
        INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES (v_order_id, 'recebido', NULL, 'recebido_na_entrega', v_vendedor);
    END IF;

    -- (10) UM ÚNICO ponto de montagem do retorno, para os DOIS caminhos. Com
    -- duas cópias do formato, o dia em que uma chave for acrescentada só de um
    -- lado, a retentativa passa a devolver um objeto diferente da primeira
    -- chamada — e a tela do PDV quebra só na repetição, que é o caso raro.
    RETURN jsonb_build_object(
        'ja_existia', v_ja_existia,
        'order', (SELECT to_jsonb(o.*) FROM public.marketplace_orders o WHERE o.id = v_order_id),
        'items', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', i.id,
                    'product_id', i.product_id,
                    'variant_id', i.variant_id,
                    'quantity', i.quantity,
                    'price', i.price,
                    'product_name', i.product_name
                ) ORDER BY i.created_at
            )
            FROM public.marketplace_order_items i
            WHERE i.order_id = v_order_id
        ), '[]'::jsonb)
    );
END;
$$;

-- fin_caixa_abrir: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_caixa_abrir(p_valor_abertura numeric, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_conta public.fin_contas%ROWTYPE;
  v_saldo numeric;
  v_ultimo_contado numeric;
  v_categoria uuid;
  v_valor numeric(12, 2) := round(p_valor_abertura, 2);
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_valor IS NULL OR v_valor < 0 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro há no caixa (pode ser zero).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_conta FROM public.fin_contas
   WHERE id = COALESCE(p_conta_id, 'f1000000-0000-4000-8000-000000000001'::uuid) FOR UPDATE;
  IF NOT FOUND OR NOT v_conta.ativa OR v_conta.tipo <> 'caixa' THEN
    RAISE EXCEPTION 'Escolha uma conta do tipo caixa.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fin_caixa_sessoes WHERE conta_id = v_conta.id AND status = 'aberto') THEN
    RAISE EXCEPTION 'Este caixa já está aberto.' USING ERRCODE = '23505';
  END IF;

  -- O que foi contado manda: a diferença vira ajuste, para a conta Caixa
  -- refletir a gaveta de verdade.
  --
  -- Achado 13 (revisão 26/09/2026, rodada 2 — decisão do dono, reversível).
  -- Achado A1 (revisão 26/09/2026, rodada 3 — REGRESSÃO do achado 13
  -- consertada): a CATEGORIA tem de decidir com a MESMA base de comparação
  -- que o TIPO/VALOR do lançamento já usam (v_valor contra v_saldo, o saldo
  -- de fin__saldos AGORA) — não contra v_ultimo_contado. A suposição de que
  -- "sem nada estranho no meio, v_saldo já é igual ao último contado" era
  -- verdadeira SÓ quando nada mexe na conta entre o fechamento e a próxima
  -- abertura; uma venda ou despesa em dinheiro registrada com o caixa
  -- FECHADO (fin_caixa_movimentar/fin__movimentos continuam escrevendo na
  -- conta mesmo sem sessão aberta) faz v_saldo divergir de v_ultimo_contado,
  -- e comparar contra a base errada trocava sobra por falta (e vice-versa):
  -- uma falta real de R$30 saía como "sobra" fora_dre, e uma sobra real de
  -- R$10 saía como "Quebra de caixa" (despesa) com sinal de ganho — uma
  -- combinação que a própria fin_lancamento_salvar recusaria se alguém
  -- tentasse lançar à mão.
  --   - v_valor > v_saldo (sobrou dinheiro na gaveta) — sempre `fora_dre`
  --     (categoria 006): aporte do dono, troco trazido de casa, nunca lucro.
  --   - v_valor < v_saldo E existe um fechamento anterior desta conta para
  --     comparar — falta REAL (sumiu dinheiro que o sistema sabia que
  --     estava lá) — Quebra de caixa, `financeiro`, pesa na DRE (031).
  --   - v_valor < v_saldo SEM fechamento anterior (1ª abertura desta conta,
  --     nada para comparar) — `fora_dre` (categoria 007): pode ser só a
  --     loja começando com menos troco do que o sistema supõe, não uma
  --     perda comprovada.
  -- O ajuste continua reconciliando o SALDO do sistema (fin__saldos) para
  -- v_valor — o mesmo cálculo de sempre (achado E) — só a CATEGORIA muda.
  SELECT s.saldo INTO v_saldo FROM public.fin__saldos() s WHERE s.conta_id = v_conta.id;
  SELECT s.valor_contado INTO v_ultimo_contado
    FROM public.fin_caixa_sessoes s
   WHERE s.conta_id = v_conta.id AND s.status = 'fechado'
   ORDER BY s.fechado_em DESC LIMIT 1;

  IF round(v_valor - COALESCE(v_saldo, 0), 2) <> 0 THEN
    v_categoria := CASE
      WHEN v_valor > COALESCE(v_saldo, 0)
        THEN 'f2000000-0000-4000-8000-000000000006'::uuid -- fora_dre: sobra/aporte
      WHEN v_ultimo_contado IS NOT NULL
        THEN 'f2000000-0000-4000-8000-000000000031'::uuid -- Quebra de caixa (financeiro, na DRE)
      ELSE 'f2000000-0000-4000-8000-000000000007'::uuid   -- fora_dre: falta (1ª abertura)
    END;
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, criado_por
    ) VALUES (
      CASE WHEN v_valor > COALESCE(v_saldo, 0) THEN 'entrada' ELSE 'saida' END,
      'realizado', abs(round(v_valor - COALESCE(v_saldo, 0), 2)), v_conta.id,
      v_categoria,
      'Ajuste na abertura do caixa (contado x sistema)', 'dinheiro',
      public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', auth.uid()
    );
  END IF;

  INSERT INTO public.fin_caixa_sessoes (conta_id, valor_abertura, aberto_por)
  VALUES (v_conta.id, v_valor, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- fin_caixa_movimentar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_caixa_movimentar(p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_contra public.fin_contas%ROWTYPE;
  v_valor numeric(12, 2) := round(p_valor, 2);
  v_esperado numeric;
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Use sangria (tirar do caixa) ou suprimento (colocar no caixa).' USING ERRCODE = '22023';
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Abra o caixa antes de movimentar.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_contra FROM public.fin_contas
   WHERE id = COALESCE(p_conta_contrapartida, 'f1000000-0000-4000-8000-000000000002'::uuid);
  IF NOT FOUND OR NOT v_contra.ativa OR v_contra.id = v_s.conta_id THEN
    RAISE EXCEPTION 'Escolha para qual conta o dinheiro vai (ou de onde vem).' USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'sangria' THEN
    v_esperado := (public.fin__caixa_calculo(v_s.id) ->> 'esperado')::numeric;
    IF v_valor > v_esperado THEN
      RAISE EXCEPTION 'A sangria (R$ %) é maior que o dinheiro esperado no caixa (R$ %).', v_valor, v_esperado
        USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.fin_lancamentos (
    tipo, status, valor, conta_id, conta_destino_id, descricao, forma_pagamento,
    data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
  ) VALUES (
    'transferencia', 'realizado', v_valor,
    CASE WHEN p_tipo = 'sangria' THEN v_s.conta_id ELSE v_contra.id END,
    CASE WHEN p_tipo = 'sangria' THEN v_contra.id ELSE v_s.conta_id END,
    COALESCE(NULLIF(btrim(COALESCE(p_descricao, '')), ''),
             CASE WHEN p_tipo = 'sangria' THEN 'Sangria do caixa' ELSE 'Suprimento do caixa' END),
    'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), p_tipo, v_s.id, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- fin_caixa_fechar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_caixa_fechar(p_valor_contado numeric, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_contado numeric(12, 2) := round(p_valor_contado, 2);
  v_esperado numeric(12, 2);
  v_dif numeric(12, 2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_contado IS NULL OR v_contado < 0 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro foi contado no caixa.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há caixa aberto.' USING ERRCODE = '22023';
  END IF;
  v_esperado := round((public.fin__caixa_calculo(v_s.id) ->> 'esperado')::numeric, 2);
  v_dif := v_contado - v_esperado;

  IF v_dif <> 0 THEN
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
    ) VALUES (
      CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END, 'realizado', abs(v_dif), v_s.conta_id,
      CASE WHEN v_dif > 0 THEN 'f2000000-0000-4000-8000-000000000005'::uuid
           ELSE 'f2000000-0000-4000-8000-000000000031'::uuid END,
      CASE WHEN v_dif > 0 THEN 'Sobra de caixa no fechamento' ELSE 'Quebra de caixa no fechamento' END,
      'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', v_s.id, auth.uid()
    );
  END IF;

  UPDATE public.fin_caixa_sessoes
     SET status = 'fechado', fechado_em = now(), fechado_por = auth.uid(),
         valor_contado = v_contado, valor_esperado = v_esperado, diferenca = v_dif,
         observacao = NULLIF(btrim(COALESCE(p_observacao, '')), '')
   WHERE id = v_s.id;
  RETURN jsonb_build_object('id', v_s.id, 'esperado', v_esperado, 'contado', v_contado, 'diferenca', v_dif);
END;
$$;

-- fin_lancamento_salvar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_lancamento_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_tipo text := p ->> 'tipo';
  v_status text := COALESCE(p ->> 'status', 'realizado');
  v_valor numeric(12, 2);
  v_conta public.fin_contas%ROWTYPE;
  v_destino public.fin_contas%ROWTYPE;
  v_cat public.fin_categorias%ROWTYPE;
  v_desc text := btrim(COALESCE(p ->> 'descricao', ''));
  v_forma text := NULLIF(p ->> 'forma_pagamento', '');
  v_comp date;
  v_venc date;
  v_real date;
  v_parcelas integer := COALESCE((p ->> 'parcelas')::integer, 1);
  v_grupo uuid;
  v_valor_parcela numeric(12, 2);
  v_ids uuid[] := '{}';
  v_novo uuid;
  v_sessao uuid;
  v_atual public.fin_lancamentos%ROWTYPE;
  i integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Lançamento inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('entrada', 'saida', 'transferencia') THEN
    RAISE EXCEPTION 'Escolha: receita, despesa ou transferência.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('previsto', 'realizado') THEN
    RAISE EXCEPTION 'Status inválido.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_valor := round((p ->> 'valor')::numeric, 2);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023';
  END;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_desc) NOT BETWEEN 1 AND 140 THEN
    RAISE EXCEPTION 'Descreva o lançamento (até 140 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF v_parcelas NOT BETWEEN 1 AND 48 THEN
    RAISE EXCEPTION 'Parcelas de 1 a 48.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conta FROM public.fin_contas WHERE id = NULLIF(p ->> 'conta_id', '')::uuid;
  IF NOT FOUND OR NOT v_conta.ativa THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'transferencia' THEN
    SELECT * INTO v_destino FROM public.fin_contas WHERE id = NULLIF(p ->> 'conta_destino_id', '')::uuid;
    IF NOT FOUND OR NOT v_destino.ativa OR v_destino.id = v_conta.id THEN
      RAISE EXCEPTION 'Escolha a conta de destino (diferente da de origem).' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_cat FROM public.fin_categorias WHERE id = NULLIF(p ->> 'categoria_id', '')::uuid;
    IF NOT FOUND OR NOT v_cat.ativa THEN
      RAISE EXCEPTION 'Escolha uma categoria.' USING ERRCODE = '22023';
    END IF;
    IF (v_tipo = 'entrada') <> (v_cat.natureza = 'receita') THEN
      RAISE EXCEPTION 'A categoria não combina com o tipo do lançamento.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_forma IS NOT NULL AND v_forma NOT IN ('pix', 'credito', 'debito', 'cartao', 'dinheiro', 'boleto', 'transferencia', 'outro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida.' USING ERRCODE = '22023';
  END IF;

  v_comp := COALESCE(NULLIF(p ->> 'data_competencia', '')::date, v_hoje);
  v_venc := COALESCE(NULLIF(p ->> 'data_vencimento', '')::date, v_comp);
  v_real := CASE WHEN v_status = 'realizado' THEN COALESCE(NULLIF(p ->> 'data_realizacao', '')::date, v_hoje) END;
  IF v_real IS NOT NULL AND v_real > v_hoje THEN
    RAISE EXCEPTION 'Lançamento já pago/recebido não pode ter data no futuro. Use "a pagar/a receber".'
      USING ERRCODE = '22023';
  END IF;

  -- Movimento de hoje na conta de um caixa aberto entra na conferência dele.
  IF v_status = 'realizado' AND v_real = v_hoje THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta.id OR (v_tipo = 'transferencia' AND s.conta_id = v_destino.id))
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Edição: só o previsto manual; realizado se cancela e lança de novo.
    SELECT * INTO v_atual FROM public.fin_lancamentos WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF v_atual.status <> 'previsto' OR v_atual.origem <> 'manual' THEN
      RAISE EXCEPTION 'Só um lançamento a pagar/receber pode ser editado. Para corrigir um já realizado, cancele e lance de novo.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.fin_lancamentos SET
      tipo = v_tipo, status = v_status, valor = v_valor, conta_id = v_conta.id,
      conta_destino_id = CASE WHEN v_tipo = 'transferencia' THEN v_destino.id END,
      categoria_id = CASE WHEN v_tipo = 'transferencia' THEN NULL ELSE v_cat.id END,
      descricao = v_desc, forma_pagamento = v_forma, data_competencia = v_comp,
      data_vencimento = v_venc, data_realizacao = v_real, caixa_sessao_id = v_sessao,
      observacao = NULLIF(btrim(COALESCE(p ->> 'observacao', '')), ''), updated_at = now()
    WHERE id = v_id;
    RETURN jsonb_build_object('ids', jsonb_build_array(v_id));
  END IF;

  v_grupo := CASE WHEN v_parcelas > 1 THEN gen_random_uuid() END;
  v_valor_parcela := trunc(v_valor / v_parcelas, 2);
  FOR i IN 1..v_parcelas LOOP
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, conta_destino_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, grupo_parcelas, parcela, parcelas,
      caixa_sessao_id, observacao, criado_por
    ) VALUES (
      v_tipo,
      CASE WHEN i = 1 THEN v_status ELSE 'previsto' END,
      CASE WHEN i = v_parcelas THEN v_valor - v_valor_parcela * (v_parcelas - 1) ELSE v_valor_parcela END,
      v_conta.id,
      CASE WHEN v_tipo = 'transferencia' THEN v_destino.id END,
      CASE WHEN v_tipo = 'transferencia' THEN NULL ELSE v_cat.id END,
      CASE WHEN v_parcelas > 1 THEN left(v_desc, 128) || ' (' || i || '/' || v_parcelas || ')' ELSE v_desc END,
      v_forma,
      (v_comp + make_interval(months => i - 1))::date,
      (v_venc + make_interval(months => i - 1))::date,
      CASE WHEN i = 1 THEN v_real END,
      v_grupo,
      CASE WHEN v_parcelas > 1 THEN i END,
      CASE WHEN v_parcelas > 1 THEN v_parcelas END,
      CASE WHEN i = 1 THEN v_sessao END,
      NULLIF(btrim(COALESCE(p ->> 'observacao', '')), ''),
      auth.uid()
    ) RETURNING id INTO v_novo;
    v_ids := v_ids || v_novo;
  END LOOP;
  RETURN jsonb_build_object('ids', to_jsonb(v_ids));
END;
$$;

-- fin_lancamento_baixar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_lancamento_baixar(p_id uuid, p_data date DEFAULT NULL::date, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_l public.fin_lancamentos%ROWTYPE;
  v_data date := COALESCE(p_data, public.fin__hoje());
  v_conta uuid;
  v_sessao uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status <> 'previsto' THEN
    RAISE EXCEPTION 'Este lançamento já foi baixado ou cancelado.' USING ERRCODE = '22023';
  END IF;
  IF v_data > public.fin__hoje() THEN
    RAISE EXCEPTION 'A baixa não pode ter data no futuro.' USING ERRCODE = '22023';
  END IF;
  v_conta := COALESCE(p_conta_id, v_l.conta_id);
  IF NOT EXISTS (SELECT 1 FROM public.fin_contas c WHERE c.id = v_conta AND c.ativa) THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;
  IF v_conta = v_l.conta_destino_id THEN
    RAISE EXCEPTION 'A conta de origem precisa ser diferente da de destino.' USING ERRCODE = '22023';
  END IF;
  IF v_data = public.fin__hoje() THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta OR s.conta_id = v_l.conta_destino_id)
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;
  UPDATE public.fin_lancamentos
     SET status = 'realizado', data_realizacao = v_data, conta_id = v_conta,
         caixa_sessao_id = v_sessao, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'realizado');
END;
$$;

-- fin_lancamento_cancelar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_lancamento_cancelar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_l public.fin_lancamentos%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'Diga por que o lançamento está sendo cancelado.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este lançamento já está cancelado.' USING ERRCODE = '22023';
  END IF;
  -- Caixa fechado é conferência encerrada: não se reescreve.
  IF v_l.caixa_sessao_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.id = v_l.caixa_sessao_id AND s.status = 'fechado'
  ) THEN
    RAISE EXCEPTION 'Este movimento faz parte de um caixa já fechado e não pode ser cancelado.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_lancamentos
     SET status = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
         motivo_cancelamento = v_motivo, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelado');
END;
$$;

-- fin_conta_salvar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_conta_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_atual public.fin_contas%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.fin_contas (nome, tipo, saldo_inicial, saldo_inicial_em, ativa, ordem)
    VALUES (btrim(p ->> 'nome'), p ->> 'tipo',
            COALESCE((p ->> 'saldo_inicial')::numeric, 0),
            COALESCE((p ->> 'saldo_inicial_em')::date, public.fin__hoje()),
            COALESCE((p ->> 'ativa')::boolean, true),
            COALESCE((p ->> 'ordem')::integer, 10))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  SELECT * INTO v_atual FROM public.fin_contas WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_atual.sistema AND p ? 'tipo' AND p ->> 'tipo' IS DISTINCT FROM v_atual.tipo THEN
    RAISE EXCEPTION 'As contas da loja não mudam de tipo.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.sistema AND p ? 'ativa' AND NOT (p ->> 'ativa')::boolean THEN
    RAISE EXCEPTION 'As contas da loja recebem as vendas e não podem ser desativadas.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_contas SET
    nome = CASE WHEN p ? 'nome' THEN btrim(p ->> 'nome') ELSE nome END,
    tipo = CASE WHEN p ? 'tipo' THEN p ->> 'tipo' ELSE tipo END,
    saldo_inicial = CASE WHEN p ? 'saldo_inicial' THEN (p ->> 'saldo_inicial')::numeric ELSE saldo_inicial END,
    saldo_inicial_em = CASE WHEN p ? 'saldo_inicial_em' THEN (p ->> 'saldo_inicial_em')::date ELSE saldo_inicial_em END,
    ativa = CASE WHEN p ? 'ativa' THEN (p ->> 'ativa')::boolean ELSE ativa END,
    ordem = CASE WHEN p ? 'ordem' THEN (p ->> 'ordem')::integer ELSE ordem END,
    updated_at = now()
  WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- fin_categoria_salvar: corpo vigente da 20261177000000_o_financeiro_da_loja_nasce.sql.
CREATE OR REPLACE FUNCTION public.fin_categoria_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_atual public.fin_categorias%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.fin_categorias (nome, natureza, grupo_dre, ativa, ordem)
    VALUES (btrim(p ->> 'nome'), p ->> 'natureza', p ->> 'grupo_dre',
            COALESCE((p ->> 'ativa')::boolean, true), COALESCE((p ->> 'ordem')::integer, 50))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;
  SELECT * INTO v_atual FROM public.fin_categorias WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  -- "Vendas" e "Devoluções e estornos" recebem os movimentos derivados.
  IF v_atual.id IN ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000010')
     AND (p ? 'natureza' OR p ? 'grupo_dre' OR (p ? 'ativa' AND NOT (p ->> 'ativa')::boolean)) THEN
    RAISE EXCEPTION 'Esta categoria recebe as vendas e os estornos automaticamente: só o nome pode mudar.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_categorias SET
    nome = CASE WHEN p ? 'nome' THEN btrim(p ->> 'nome') ELSE nome END,
    natureza = CASE WHEN p ? 'natureza' THEN p ->> 'natureza' ELSE natureza END,
    grupo_dre = CASE WHEN p ? 'grupo_dre' THEN p ->> 'grupo_dre' ELSE grupo_dre END,
    ativa = CASE WHEN p ? 'ativa' THEN (p ->> 'ativa')::boolean ELSE ativa END,
    ordem = CASE WHEN p ? 'ordem' THEN (p ->> 'ordem')::integer ELSE ordem END
  WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- salvar_config_pagamento_cartao: corpo vigente da 20261176000000_o_cartao_online_nasce.sql.
CREATE OR REPLACE FUNCTION public.salvar_config_pagamento_cartao(p_credito boolean, p_debito boolean, p_parcelas_max integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v public.config_pagamento_cartao%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_credito IS NULL OR p_debito IS NULL THEN
    RAISE EXCEPTION 'Informe se crédito e débito ficam ligados.' USING ERRCODE = '22023';
  END IF;
  IF p_parcelas_max IS NULL OR p_parcelas_max NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'O parcelamento vai de 1 a 12 vezes.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.config_pagamento_cartao (id, credito, debito, parcelas_max, updated_at, updated_by)
  VALUES (1, p_credito, p_debito, p_parcelas_max::smallint, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
     SET credito = EXCLUDED.credito,
         debito = EXCLUDED.debito,
         parcelas_max = EXCLUDED.parcelas_max,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by
  RETURNING * INTO v;

  RETURN to_jsonb(v) - 'updated_by';
END;
$$;

-- salvar_politica_de_devolucao: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.salvar_politica_de_devolucao(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v public.politica_devolucao%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Política inválida.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  -- Parcial: campo ausente fica como está. Os CHECKs da tabela recusam prazo
  -- abaixo da lei e método desconhecido.
  UPDATE public.politica_devolucao SET
    prazo_arrependimento_dias = CASE WHEN p ? 'prazo_arrependimento_dias'
      THEN (p ->> 'prazo_arrependimento_dias')::integer ELSE prazo_arrependimento_dias END,
    prazo_troca_dias = CASE WHEN p ? 'prazo_troca_dias'
      THEN (p ->> 'prazo_troca_dias')::integer ELSE prazo_troca_dias END,
    prazo_vicio_dias = CASE WHEN p ? 'prazo_vicio_dias'
      THEN (p ->> 'prazo_vicio_dias')::integer ELSE prazo_vicio_dias END,
    aceita_troca = CASE WHEN p ? 'aceita_troca' THEN (p ->> 'aceita_troca')::boolean ELSE aceita_troca END,
    aceita_vale = CASE WHEN p ? 'aceita_vale' THEN (p ->> 'aceita_vale')::boolean ELSE aceita_vale END,
    exige_fotos_vicio = CASE WHEN p ? 'exige_fotos_vicio'
      THEN (p ->> 'exige_fotos_vicio')::boolean ELSE exige_fotos_vicio END,
    metodos_locais = CASE WHEN p ? 'metodos_locais'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'metodos_locais')) ELSE metodos_locais END,
    metodos_nacionais = CASE WHEN p ? 'metodos_nacionais'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'metodos_nacionais')) ELSE metodos_nacionais END,
    reembolso_momento = CASE WHEN p ? 'reembolso_momento'
      THEN p ->> 'reembolso_momento' ELSE reembolso_momento END,
    frete_troca_pago_por = CASE WHEN p ? 'frete_troca_pago_por'
      THEN p ->> 'frete_troca_pago_por' ELSE frete_troca_pago_por END,
    categorias_sem_troca = CASE WHEN p ? 'categorias_sem_troca'
      THEN ARRAY(SELECT btrim(c) FROM jsonb_array_elements_text(p -> 'categorias_sem_troca') c
                  WHERE btrim(c) <> '') ELSE categorias_sem_troca END,
    texto_politica = CASE WHEN p ? 'texto_politica'
      THEN NULLIF(btrim(COALESCE(p ->> 'texto_politica', '')), '') ELSE texto_politica END,
    endereco_devolucao = CASE WHEN p ? 'endereco_devolucao'
      THEN NULLIF(btrim(COALESCE(p ->> 'endereco_devolucao', '')), '') ELSE endereco_devolucao END,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO v;

  RETURN to_jsonb(v) - 'updated_by';
END;
$$;

-- upsert_store_config: corpo vigente da 20261174000000_formas_de_pagamento_por_loja.sql.
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  v_methods text[];
  v_has_methods boolean;
  -- FORMAS DE PAGAMENTO POR LOJA (25/09/2026): mesmo par v_has_.../v_...
  -- que v_has_methods/v_methods acima, com UMA diferença (revisão B1): a
  -- coluna nasceu com um invariante (trigger
  -- store_config_exige_forma_de_pagamento — cardinality=0 exige
  -- pagamento_online=true), e o candidato do INSERT é avaliado por essa
  -- trigger MESMO quando o destino real é o ON CONFLICT DO UPDATE
  -- (Postgres roda a trigger BEFORE INSERT antes de decidir se colide). Um
  -- array fixo aqui validaria um estado que a loja nunca teve — por isso
  -- v_formas_pagamento, quando a chave não vem no payload, reflete o valor
  -- ATUAL da linha (mesmo truque do logo_url, abaixo), não um array fixo.
  v_has_formas_pagamento boolean;
  v_formas_pagamento text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  -- Handle text[] casting safely
  v_has_methods := config_json ? 'enabled_shipping_methods'
    AND config_json->'enabled_shipping_methods' IS NOT NULL
    AND jsonb_typeof(config_json->'enabled_shipping_methods') = 'array';

  IF v_has_methods THEN
    SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_methods
    FROM jsonb_array_elements_text(config_json->'enabled_shipping_methods') x;
  ELSE
    v_methods := '{sedex, pac}'::text[];
  END IF;

  -- Mesmo par v_has_.../v_... de cima, com o fallback do B1: quando a
  -- chave não vem no payload, o candidato do INSERT carrega o valor ATUAL
  -- da linha (não um array fixo) — é isso que impede a trigger BEFORE
  -- INSERT de recusar um salvamento não relacionado numa loja que já vende
  -- só pelo app (formas_pagamento_entrega='{}' com pagamento_online=true).
  v_has_formas_pagamento := config_json ? 'formas_pagamento_entrega'
    AND config_json->'formas_pagamento_entrega' IS NOT NULL
    AND jsonb_typeof(config_json->'formas_pagamento_entrega') = 'array';

  IF v_has_formas_pagamento THEN
    SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_formas_pagamento
    FROM jsonb_array_elements_text(config_json->'formas_pagamento_entrega') x;
  ELSE
    SELECT formas_pagamento_entrega INTO v_formas_pagamento
      FROM public.store_config WHERE id = 1;
    v_formas_pagamento := COALESCE(v_formas_pagamento, ARRAY['pix','card','cash']::text[]);
  END IF;

  INSERT INTO public.store_config (
    id, free_shipping_min, shipping_fee, whatsapp_number, share_text,
    business_hours, enable_reviews, enable_coupons, primary_color,
    theme_mode, logo_url, real_time_sales_alerts, push_marketing_enabled,
    min_app_version, origin_cep, shipping_provider, enabled_shipping_methods,
    shipping_coverage, local_delivery_fee, local_cep_range,
    store_name, store_city, store_state, home_sections,
    secondary_color, accent_color, branding_assets,
    store_address, store_description,
    national_shipping_strategy, national_shipping_min,
    national_discount_type, national_discount_value, national_benefit_scope,
    formas_pagamento_entrega
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 0),
    (config_json->>'shipping_fee')::numeric,
    -- 20261033000000: sem default de fábrica — ausência grava NULL e o
    -- botão de WhatsApp só nasce quando a lojista configurar o número.
    config_json->>'whatsapp_number',
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    -- 20261033000000: sem default de fábrica — a vitrine só publica
    -- expediente que a lojista digitou (mesma regra da 20261029000000).
    config_json->>'business_hours',
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    config_json->>'primary_color',  -- sentinela removida: ausente grava NULL
    COALESCE(config_json->>'theme_mode', 'light'),
    -- CHECK valida o candidato INSERT antes de ON CONFLICT. Reenvio de pacote
    -- com logo omitido usa a referencia atual somente neste candidato.
    CASE WHEN config_json ? 'logo_url' THEN config_json->>'logo_url'
      WHEN NULLIF(config_json->'branding_assets','null'::jsonb) IS NOT NULL
        THEN (SELECT logo_url FROM public.store_config WHERE id=1)
      ELSE NULL END,
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version',
    config_json->>'origin_cep',
    COALESCE(config_json->>'shipping_provider', 'flat_fee'),
    v_methods,
    COALESCE(config_json->>'shipping_coverage', 'national'),
    COALESCE((config_json->>'local_delivery_fee')::numeric, 10.00),
    config_json->>'local_cep_range',
    config_json->>'store_name',
    config_json->>'store_city',
    config_json->>'store_state',
    config_json->'home_sections',
    config_json->>'secondary_color',
    config_json->>'accent_color',
    NULLIF(config_json->'branding_assets', 'null'::jsonb),
    -- 20261167000000: sem default de fábrica — endereço e descrição só
    -- existem quando a lojista digita (mesma régua das store_* de texto).
    config_json->>'store_address',
    config_json->>'store_description',
    -- T1 (20261171000000): com default de fábrica — o candidato do INSERT
    -- nasce com a MESMA sentinela do CHECK/DEFAULT da coluna (mesma régua
    -- de free_shipping_min/shipping_coverage acima, nunca a forma "sem
    -- default" das colunas de texto livre da loja).
    COALESCE(config_json->>'national_shipping_strategy', 'desligado'),
    COALESCE((config_json->>'national_shipping_min')::numeric, 0),
    config_json->>'national_discount_type',
    COALESCE((config_json->>'national_discount_value')::numeric, 0),
    COALESCE(config_json->>'national_benefit_scope', 'mais_barata'),
    v_formas_pagamento
  )
  -- A partir daqui: só sobrescreve o que veio no payload. [ALTERADO]
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = CASE WHEN config_json ? 'free_shipping_min'
      THEN (config_json->>'free_shipping_min')::numeric
      ELSE store_config.free_shipping_min END,
    shipping_fee = CASE WHEN config_json ? 'shipping_fee'
      THEN (config_json->>'shipping_fee')::numeric
      ELSE store_config.shipping_fee END,
    whatsapp_number = CASE WHEN config_json ? 'whatsapp_number'
      THEN config_json->>'whatsapp_number'
      ELSE store_config.whatsapp_number END,
    share_text = CASE WHEN config_json ? 'share_text'
      THEN config_json->>'share_text'
      ELSE store_config.share_text END,
    business_hours = CASE WHEN config_json ? 'business_hours'
      THEN config_json->>'business_hours'
      ELSE store_config.business_hours END,
    enable_reviews = CASE WHEN config_json ? 'enable_reviews'
      THEN (config_json->>'enable_reviews')::boolean
      ELSE store_config.enable_reviews END,
    enable_coupons = CASE WHEN config_json ? 'enable_coupons'
      THEN (config_json->>'enable_coupons')::boolean
      ELSE store_config.enable_coupons END,
    primary_color = CASE WHEN config_json ? 'primary_color'
      THEN config_json->>'primary_color'
      ELSE store_config.primary_color END,
    theme_mode = CASE WHEN config_json ? 'theme_mode'
      THEN config_json->>'theme_mode'
      ELSE store_config.theme_mode END,
    logo_url = CASE WHEN config_json ? 'logo_url'
      THEN config_json->>'logo_url'
      ELSE store_config.logo_url END,
    real_time_sales_alerts = CASE WHEN config_json ? 'real_time_sales_alerts'
      THEN (config_json->>'real_time_sales_alerts')::boolean
      ELSE store_config.real_time_sales_alerts END,
    push_marketing_enabled = CASE WHEN config_json ? 'push_marketing_enabled'
      THEN (config_json->>'push_marketing_enabled')::boolean
      ELSE store_config.push_marketing_enabled END,
    min_app_version = CASE WHEN config_json ? 'min_app_version'
      THEN config_json->>'min_app_version'
      ELSE store_config.min_app_version END,
    origin_cep = CASE WHEN config_json ? 'origin_cep'
      THEN config_json->>'origin_cep'
      ELSE store_config.origin_cep END,
    shipping_provider = CASE WHEN config_json ? 'shipping_provider'
      THEN config_json->>'shipping_provider'
      ELSE store_config.shipping_provider END,
    enabled_shipping_methods = CASE WHEN v_has_methods
      THEN v_methods
      ELSE store_config.enabled_shipping_methods END,
    shipping_coverage = CASE WHEN config_json ? 'shipping_coverage'
      THEN config_json->>'shipping_coverage'
      ELSE store_config.shipping_coverage END,
    local_delivery_fee = CASE WHEN config_json ? 'local_delivery_fee'
      THEN (config_json->>'local_delivery_fee')::numeric
      ELSE store_config.local_delivery_fee END,
    local_cep_range = CASE WHEN config_json ? 'local_cep_range'
      THEN config_json->>'local_cep_range'
      ELSE store_config.local_cep_range END,
    store_name = CASE WHEN config_json ? 'store_name'
      THEN config_json->>'store_name'
      ELSE store_config.store_name END,
    store_city = CASE WHEN config_json ? 'store_city'
      THEN config_json->>'store_city'
      ELSE store_config.store_city END,
    store_state = CASE WHEN config_json ? 'store_state'
      THEN config_json->>'store_state'
      ELSE store_config.store_state END,
    -- home_sections: arranjo das vitrines da home. Grava só quando a chave
    -- vem no payload; preserva o que já estava lá quando não vem.
    home_sections = CASE WHEN config_json ? 'home_sections'
      THEN config_json->'home_sections'
      ELSE store_config.home_sections END,
    secondary_color = CASE WHEN config_json ? 'secondary_color'
      THEN config_json->>'secondary_color' ELSE store_config.secondary_color END,
    accent_color = CASE WHEN config_json ? 'accent_color'
      THEN config_json->>'accent_color' ELSE store_config.accent_color END,
    branding_assets = CASE WHEN config_json ? 'branding_assets'
      THEN NULLIF(config_json->'branding_assets','null'::jsonb) ELSE store_config.branding_assets END,
    -- 20261167000000: endereço e descrição — o CASE é o coração do aceite
    -- "salvar um campo não apaga os outros".
    store_address = CASE WHEN config_json ? 'store_address'
      THEN config_json->>'store_address'
      ELSE store_config.store_address END,
    store_description = CASE WHEN config_json ? 'store_description'
      THEN config_json->>'store_description'
      ELSE store_config.store_description END,
    -- T1 (20261171000000): a tela de frete LOCAL e a tela de frete NACIONAL
    -- salvam separadamente — o CASE por coluna é o que garante que salvar
    -- uma não apaga a outra (mesmo aceite das duas linhas acima).
    national_shipping_strategy = CASE WHEN config_json ? 'national_shipping_strategy'
      THEN config_json->>'national_shipping_strategy'
      ELSE store_config.national_shipping_strategy END,
    national_shipping_min = CASE WHEN config_json ? 'national_shipping_min'
      THEN (config_json->>'national_shipping_min')::numeric
      ELSE store_config.national_shipping_min END,
    national_discount_type = CASE WHEN config_json ? 'national_discount_type'
      THEN config_json->>'national_discount_type'
      ELSE store_config.national_discount_type END,
    national_discount_value = CASE WHEN config_json ? 'national_discount_value'
      THEN (config_json->>'national_discount_value')::numeric
      ELSE store_config.national_discount_value END,
    national_benefit_scope = CASE WHEN config_json ? 'national_benefit_scope'
      THEN config_json->>'national_benefit_scope'
      ELSE store_config.national_benefit_scope END,
    -- FORMAS DE PAGAMENTO POR LOJA (25/09/2026): grava só quando a chave
    -- vem no payload -- preserva o que já estava lá quando não vem (mesmo
    -- CASE das demais colunas parciais).
    formas_pagamento_entrega = CASE WHEN v_has_formas_pagamento
      THEN v_formas_pagamento
      ELSE store_config.formas_pagamento_entrega END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- save_store_identity: corpo vigente da 20261122000000_gravacao_concorrente_da_identidade.sql.
CREATE OR REPLACE FUNCTION public.save_store_identity(expected_revision text, expected_identity jsonb, desired_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET lock_timeout TO '5s'
AS $$
DECLARE
  current_row public.store_config%ROWTYPE;
  current_identity jsonb;
  written jsonb;
  document jsonb;
  field text;
  keys constant text[] := ARRAY['store_name','store_city','store_state','primary_color',
    'secondary_color','accent_color','logo_url','branding_assets'];
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IDENTITY_PERMISSION';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF public.is_admin_atual() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IDENTITY_PERMISSION';
  END IF;
  -- Bound length before casting; transport is canonical decimal text, never a JS number.
  IF expected_revision IS NULL OR length(expected_revision)>19
      OR expected_revision !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
  END IF;
  IF expected_revision::numeric > 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
  END IF;
  FOREACH document IN ARRAY ARRAY[expected_identity,desired_identity] LOOP
    IF jsonb_typeof(document) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
    END IF;
    IF octet_length(convert_to(document::text,'UTF8'))>262144
      OR NOT document ?& keys OR document-keys <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
    END IF;
    FOREACH field IN ARRAY keys LOOP
      IF jsonb_typeof(document->field) NOT IN ('null',
        CASE WHEN field='branding_assets' THEN 'object' ELSE 'string' END) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
      END IF;
    END LOOP;
  END LOOP;
  IF desired_identity->>'primary_color' IS NOT NULL AND
    (desired_identity->>'primary_color' !~ '^#[A-Fa-f0-9]{6}$'
      OR desired_identity->>'primary_color'='#000000') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
  END IF;
  SELECT * INTO current_row FROM public.store_config WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='IDENTITY_MISSING';
  END IF;
  current_identity := jsonb_build_object('store_name',current_row.store_name,'store_city',current_row.store_city,
    'store_state',current_row.store_state,'primary_color',current_row.primary_color,
    'secondary_color',current_row.secondary_color,'accent_color',current_row.accent_color,
    'logo_url',current_row.logo_url,'branding_assets',current_row.branding_assets);
  IF current_row.identity_revision <> expected_revision::bigint
    OR current_identity IS DISTINCT FROM expected_identity THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_CONFLICT';
  END IF;
  IF desired_identity IS DISTINCT FROM current_identity THEN
    BEGIN
      written := public.upsert_store_config(desired_identity);
    EXCEPTION WHEN check_violation THEN
      -- Native CHECK DETAIL contains the candidate row. Keep its SQLSTATE only.
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='IDENTITY_INVALID';
    END;
    SELECT * INTO current_row FROM public.store_config WHERE id=1;
    IF NOT FOUND OR jsonb_typeof(written) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_WRITE_UNCONFIRMED';
    END IF;
    current_identity := jsonb_build_object('store_name',current_row.store_name,'store_city',current_row.store_city,
      'store_state',current_row.store_state,'primary_color',current_row.primary_color,
      'secondary_color',current_row.secondary_color,'accent_color',current_row.accent_color,
      'logo_url',current_row.logo_url,'branding_assets',current_row.branding_assets);
    IF NOT written ?& keys OR current_identity IS DISTINCT FROM desired_identity THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_WRITE_UNCONFIRMED';
    END IF;
    FOREACH field IN ARRAY keys LOOP
      IF written->field IS DISTINCT FROM desired_identity->field THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_WRITE_UNCONFIRMED';
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('revision',current_row.identity_revision::text,'identity',current_identity);
END;
$$;
