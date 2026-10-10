-- AS POLÍTICAS DE RLS DO PEDIDO, DA DEVOLUÇÃO E DO FINANCEIRO EXIGEM O ADMIN
-- DE AGORA (permissão + dado de cliente + dinheiro; 04/10/2026) — fecha os
-- achados do inventário de RLS que a revisão da 20261200000000 deixou de fora
-- ("fora do escopo (outra frente): as outras tabelas que ainda usam is_admin()"
-- da 20261197000000 e da 20261199000000).
--
-- O DEFEITO (1/2 — a porta do admin): as 14 políticas abaixo deixam passar quem
-- o JWT diz que é admin (`public.is_admin()`, que lê `app_metadata.role` do
-- token e só depois olha o banco). O JWT vale até expirar (~1 h): um admin
-- rebaixado continuava, nesse tempo, LENDO e ESCREVENDO direto nas tabelas pelo
-- PostgREST — por cima das RPCs que a 97, a 99 e a 200 já fecharam:
--   pedido (escrita e leitura): marketplace_order_items e
--     marketplace_order_history (uma política ALL cada), order_shipping_events
--     (select, insert, update e delete) e marketplace_order_payment_history
--     (select, papel public);
--   devolução (leitura): devolucoes, devolucao_itens e devolucao_eventos;
--   financeiro da loja (leitura): fin_contas, fin_categorias, fin_caixa_sessoes
--     e fin_lancamentos.
--
-- O DEFEITO (2/2 — o DONO ESCREVIA no que pagou): marketplace_order_items e
-- marketplace_order_history tinham UMA política ALL (leitura E escrita) com o
-- ramo "o pedido é meu". Medido no banco montado: o comprador autenticado,
-- chamando direto pela RLS (sem RPC), em pedido PAGO ou com cobrança em curso,
-- conseguia INSERIR item novo, ALTERAR produto/variação/quantidade/preço de
-- item existente, APAGAR item, e INSERIR/ALTERAR/APAGAR evento do histórico
-- (inclusive um evento que simula "pago"/"approved"). Nada no banco barra: o
-- papel authenticated tem INSERT/UPDATE/DELETE de tabela (default do Supabase;
-- nenhuma migration revoga), não há gatilho nem CHECK que impeça (só
-- quantity > 0 e as FKs). Código: NENHUM fluxo do app escreve nelas como o
-- usuário — as telas só LÊEM (itens embutidos em pedidos, histórico da ficha); a
-- criação do pedido, a mudança de status, o cancelamento e a venda no balcão
-- são RPCs SECURITY DEFINER (dono postgres, ignoram RLS); as edges usam a chave
-- de serviço (ignoram RLS).
--
-- O QUE MUDA: (a) a porta de admin das 14 políticas passa de
-- `(SELECT public.is_admin())` para `(SELECT public.rls_admin_atual())` (a mesma
-- da 97: admin em auth.users E em profiles, lidos agora; service_role e
-- postgres como antes); (b) as duas políticas ALL do pedido (itens e histórico)
-- ficam SÓ do admin de agora (ALTER POLICY, mesmo nome e comando) e a LEITURA do
-- dono/admin passa para duas políticas de SELECT novas, `order_items_select_policy`
-- e `order_history_select_policy` (dono OU admin de agora, o ramo do dono igual
-- byte a byte ao de antes). Resultado: o comprador continua LENDO o que é dele
-- (itens do pedido, linha do tempo) e um terceiro continua sem ver nada, mas
-- NÃO escreve mais nada nessas tabelas; o admin de agora lê e escreve como
-- antes. Nas outras 12 políticas `ALTER POLICY` só troca a expressão: nome,
-- comando e papéis ficam como estão, e o ramo do dono (`auth.uid()` / o EXISTS do
-- pedido do dono / a devolução do dono) fica igual byte a byte. Em
-- mkt_order_payment_history_select a expressão era `is_admin()` sem o
-- `(SELECT ...)`; passa a `(SELECT public.rls_admin_atual())` — avaliada UMA vez
-- por consulta, como as outras.
--
-- POR QUE POLÍTICA E NÃO REVOKE: o REVOKE de tabela apagaria o grant de COLUNA
-- (attacl) e a ACL viva de cada loja não está no repositório (o baseline foi
-- dumpado --no-privileges); a política decide igual em qualquer loja,
-- independente da ACL. Nenhum GRANT/REVOKE aqui.
--
-- QUEM PASSA, DEPOIS: o conjunto só ENCOLHE (rls_admin_atual() ⊆ is_admin()
-- para authenticated). Admin de verdade passa como antes; service_role e
-- postgres (que ignoram RLS) intocados; o dono do pedido/devolução passa pelo
-- ramo dele. EFEITO COLATERAL ACEITO (o mesmo da 97 e da 99): quem é admin só
-- no app_metadata, sem profiles.role = 'admin' (ou o contrário), para de ler
-- estas tabelas direto. A conferência de antes de aplicar numa loja é a mesma:
--   SELECT u.id FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
--    WHERE COALESCE(u.raw_app_meta_data ->> 'role' = 'admin', false)
--          IS DISTINCT FROM COALESCE(p.role = 'admin', false);
-- (zero linhas = ninguém perde acesso).
--
-- O ANON em mkt_order_payment_history_select: a política é `TO public` (anon
-- inclusive) e o papel anon TEM o SELECT da tabela; `rls_admin_atual()` não
-- tem EXECUTE para anon (a 97 o revogou de propósito). Antes, o anon recebia 0
-- linhas (is_admin() é falsa para ele); depois, recebe o erro 42501 "permission
-- denied for function rls_admin_atual" — também sem nenhum dado, e fecha-falha.
-- Nenhuma tela nem edge lê essa tabela como anon (o painel do lojista lê com
-- login; as edges usam a chave de serviço). O papel da política NÃO muda aqui
-- (decisão do plano); se um dia o erro do anon incomodar, a troca é
-- `ALTER POLICY ... TO authenticated`, decisão à parte.
--
-- NÃO MUDAM: nenhuma RPC, nenhum GRANT/REVOKE, nenhum gatilho, nenhuma outra
-- política (inclusive as públicas — politica_devolucao e config_pagamento_cartao
-- —, order_refunds_cliente_le, os grupos de storage e as tabelas fora desta
-- lista). Nenhum chamador muda: o painel que lê
-- `marketplace_order_history`, `devolucoes` e os itens embutidos nos pedidos
-- continua lendo igual, como admin de agora; as edges que tocam estas tabelas
-- usam a chave de serviço (ignora RLS).
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — só troca a
-- expressão de 14 políticas e cria 2 de SELECT. O que um admin rebaixado, ou um
-- comprador, JÁ escreveu direto nessas tabelas antes desta migration fica como
-- está (a migration não desfaz nem audita: só barra o próximo clique).
--
-- IDEMPOTÊNCIA: `ALTER POLICY` com a mesma expressão e `DROP POLICY IF EXISTS` +
-- `CREATE POLICY` das duas de SELECT novas (objetos desta própria migration); o
-- preflight aceita, para cada política, a expressão de antes OU a que esta
-- migration deixa — reaplicar produz o mesmo estado (provado: duas
-- reaplicações, impressão digital igual).
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: o `DO $preflight_20261202$`, ANTES de
-- qualquer escrita, recusa se: (1) `is_admin_atual()` ou `rls_admin_atual()`
-- não for o corpo da 20261197000000 (sem elas toda política vira erro —
-- aplique a 97 antes); (2) alguma das 14 políticas não existir, ou o comando, o
-- papel, o caráter permissivo ou a expressão VIVA (USING e WITH CHECK,
-- deparseados com `search_path = pg_catalog`, nomes sempre qualificados) não
-- for nem a vigente antes desta migration nem a que ela deixa; (3) uma das duas
-- políticas de SELECT novas já existir com outra expressão. Nenhuma outra
-- migration da pilha (92, 96, 99, 200) redefine estas políticas — conferido
-- por busca; só a baseline, 20261020, 20261080, 20261175 e 20261177 as criam.
--
-- TRANSAÇÃO: sem `BEGIN`/`COMMIT` de nível superior (regra da casa, AGENTS.md).
-- O workflow `aplicar-migrations.yml` manda o arquivo inteiro numa consulta só
-- — o preflight e as 14 trocas caem juntos ou não caem. `ALTER POLICY` pega
-- lock exclusivo curto em cada tabela (como a 97 fez em marketplace_orders).
--
-- ORDEM: depois da 20261197000000 (cria rls_admin_atual(); o preflight recusa
-- sem ela). ROLLBACK: este vem ANTES do da 97 — o da 97 apaga rls_admin_atual(),
-- que estas 14 políticas usam; na ordem errada o DROP falha por dependência
-- (fecha, não abre).
--
-- COMO APLICAR: workflow `aplicar-migrations.yml` (Actions -> Run workflow),
-- `migracoes = 20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql`.
--
-- FICHA DE VERIFICAÇÃO:
--   1. A conferência de papel contraditório acima: zero linhas.
--   2. `pg_policies` das 14 mostra `rls_admin_atual()` no lugar de
--      `is_admin()`; nome, comando e papéis iguais; o ramo do dono igual.
--   3. Admin de verdade no painel: Pedidos (itens e histórico do pedido),
--      Devoluções, Financeiro e a etiqueta seguem abrindo; o cliente vê os
--      próprios pedidos, itens e devoluções.
--
-- PROVA VIVA: tests/banco/admin-atual-rls-viva.cjs (rpc-ci) — para cada
-- política: ex-admin rebaixado (só profiles, só auth.users; JWT velho) lê 0
-- linhas e não escreve; CONTROLE na política antiga lê e escreve; admin atual
-- lê e escreve como antes; o dono lê o que é dele e um terceiro não; rollback
-- byte a byte e preflights recusando sem escrita.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql
-- devolve as 14 expressões de antes.

DO $preflight_20261202$
DECLARE
  r record;
  v_hash text;
  v_caminho text;
  v_qual text;
  v_check text;
  v_cmd text;
  v_perm boolean;
  v_roles text;
BEGIN
  -- (1) as portas da 20261197000000: sem elas cada política vira erro.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
        ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
      ) AS esperado(assinatura, hash_da_97)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_da_97 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) não é a da 20261197000000 — aplique a 97 antes desta.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- (2) Expressões deparseadas com search_path = pg_catalog (nomes sempre
  --     qualificados, independente do search_path de quem aplica); o
  --     search_path volta logo depois.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.marketplace_order_items', 'order_items_all_policy', '*', 'authenticated',
         E'(( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_items.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))', E'(( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_items.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', E'( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.marketplace_order_history', 'order_history_all_policy', '*', 'authenticated',
         E'(( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_history.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))', E'(( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_history.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', E'( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.order_shipping_events', 'order_shipping_events_select_policy', 'r', 'authenticated',
         E'(( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders o\n  WHERE ((o.id = order_shipping_events.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid))))))', NULL::text,
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders o\n  WHERE ((o.id = order_shipping_events.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid))))))', NULL::text),
        ('public.order_shipping_events', 'order_shipping_events_admin_insert_policy', 'a', 'authenticated',
         NULL::text, E'( SELECT public.is_admin() AS is_admin)',
         NULL::text, E'( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.order_shipping_events', 'order_shipping_events_admin_update_policy', 'w', 'authenticated',
         E'( SELECT public.is_admin() AS is_admin)', E'( SELECT public.is_admin() AS is_admin)',
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', E'( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
        ('public.order_shipping_events', 'order_shipping_events_admin_delete_policy', 'd', 'authenticated',
         E'( SELECT public.is_admin() AS is_admin)', NULL::text,
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.marketplace_order_payment_history', 'mkt_order_payment_history_select', 'r', 'public',
         E'public.is_admin()', NULL::text,
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.devolucoes', 'devolucoes_dono_ou_admin_select_policy', 'r', 'authenticated',
         E'((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin))', NULL::text,
         E'((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.rls_admin_atual() AS rls_admin_atual))', NULL::text),
        ('public.devolucao_itens', 'devolucao_itens_dono_ou_admin_select_policy', 'r', 'authenticated',
         E'(( SELECT public.is_admin() AS is_admin) OR (devolucao_id IN ( SELECT d.id\n   FROM public.devolucoes d\n  WHERE (d.user_id = ( SELECT auth.uid() AS uid)))))', NULL::text,
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (devolucao_id IN ( SELECT d.id\n   FROM public.devolucoes d\n  WHERE (d.user_id = ( SELECT auth.uid() AS uid)))))', NULL::text),
        ('public.devolucao_eventos', 'devolucao_eventos_dono_ou_admin_select_policy', 'r', 'authenticated',
         E'(( SELECT public.is_admin() AS is_admin) OR (devolucao_id IN ( SELECT d.id\n   FROM public.devolucoes d\n  WHERE (d.user_id = ( SELECT auth.uid() AS uid)))))', NULL::text,
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (devolucao_id IN ( SELECT d.id\n   FROM public.devolucoes d\n  WHERE (d.user_id = ( SELECT auth.uid() AS uid)))))', NULL::text),
        ('public.fin_contas', 'fin_contas_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.is_admin() AS is_admin)', NULL::text,
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.fin_categorias', 'fin_categorias_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.is_admin() AS is_admin)', NULL::text,
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.fin_caixa_sessoes', 'fin_caixa_sessoes_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.is_admin() AS is_admin)', NULL::text,
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
        ('public.fin_lancamentos', 'fin_lancamentos_admin_select_policy', 'r', 'authenticated',
         E'( SELECT public.is_admin() AS is_admin)', NULL::text,
         E'( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text)
      ) AS esperado(tabela, politica, comando, papeis, qual_vigente, check_vigente, qual_desta, check_desta)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
           p.polcmd::text, p.polpermissive,
           array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                   FROM unnest(p.polroles) AS x ORDER BY 1), ',')
      INTO v_qual, v_check, v_cmd, v_perm, v_roles
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela)
       AND p.polname = r.politica;

    IF NOT FOUND
       OR v_cmd IS DISTINCT FROM r.comando
       OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM r.papeis
       OR NOT (
            (v_qual IS NOT DISTINCT FROM r.qual_vigente AND v_check IS NOT DISTINCT FROM r.check_vigente)
         OR (v_qual IS NOT DISTINCT FROM r.qual_desta AND v_check IS NOT DISTINCT FROM r.check_desta)
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: política % em % (comando %, papéis %, USING %, WITH CHECK %) não é a vigente antes desta migration nem a que ela deixa — revise antes de aplicar.', r.politica, r.tabela, COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo'), COALESCE(v_check, 'nulo');
    END IF;
  END LOOP;

  -- (3) As duas políticas de SELECT novas: ausentes (a migration as cria) ou
  --     exatamente as desta migration (reaplicação).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.marketplace_order_items', 'order_items_select_policy', 'r', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_items.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))'),
        ('public.marketplace_order_history', 'order_history_select_policy', 'r', 'authenticated',
         E'(( SELECT public.rls_admin_atual() AS rls_admin_atual) OR (EXISTS ( SELECT 1\n   FROM public.marketplace_orders mo\n  WHERE ((mo.id = marketplace_order_history.order_id) AND (mo.user_id = ( SELECT auth.uid() AS uid))))))')
      ) AS esperado(tabela, politica, comando, papeis, qual_desta)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid),
           p.polcmd::text, p.polpermissive,
           array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
                                   FROM unnest(p.polroles) AS x ORDER BY 1), ',')
      INTO v_qual, v_check, v_cmd, v_perm, v_roles
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela)
       AND p.polname = r.politica;

    IF FOUND AND (
         v_cmd IS DISTINCT FROM r.comando
         OR v_perm IS DISTINCT FROM true
         OR v_roles IS DISTINCT FROM r.papeis
         OR v_qual IS DISTINCT FROM r.qual_desta
         OR v_check IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: política % em % já existe com outra definição (comando %, papéis %, USING %) — revise antes de aplicar.', r.politica, r.tabela, COALESCE(v_cmd, '-'), COALESCE(v_roles, '-'), COALESCE(v_qual, 'nulo');
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
END $preflight_20261202$;

-- A leitura do dono (e do admin de agora) de itens e histórico passa para duas
-- políticas de SELECT; elas nascem ANTES de as ALL ficarem só do admin.
DROP POLICY IF EXISTS order_items_select_policy ON public.marketplace_order_items;
CREATE POLICY order_items_select_policy ON public.marketplace_order_items
  FOR SELECT TO authenticated
  USING (((SELECT public.rls_admin_atual())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders mo
      WHERE mo.id = marketplace_order_items.order_id
        AND mo.user_id = (SELECT auth.uid())
    )));

DROP POLICY IF EXISTS order_history_select_policy ON public.marketplace_order_history;
CREATE POLICY order_history_select_policy ON public.marketplace_order_history
  FOR SELECT TO authenticated
  USING (((SELECT public.rls_admin_atual())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders mo
      WHERE mo.id = marketplace_order_history.order_id
        AND mo.user_id = (SELECT auth.uid())
    )));

-- Só a porta de admin troca; o ramo do dono, o comando, os papéis e o nome não mudam
-- (nas duas ALL do pedido, a política passa a ser só do admin de agora).
ALTER POLICY order_items_all_policy ON public.marketplace_order_items
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

ALTER POLICY order_history_all_policy ON public.marketplace_order_history
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

ALTER POLICY order_shipping_events_select_policy ON public.order_shipping_events
  USING (((SELECT public.rls_admin_atual())
    OR EXISTS (
      SELECT 1 FROM public.marketplace_orders o
      WHERE o.id = order_shipping_events.order_id
        AND o.user_id = (SELECT auth.uid())
    )));

ALTER POLICY order_shipping_events_admin_insert_policy ON public.order_shipping_events
  WITH CHECK ((SELECT public.rls_admin_atual()));

ALTER POLICY order_shipping_events_admin_update_policy ON public.order_shipping_events
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

ALTER POLICY order_shipping_events_admin_delete_policy ON public.order_shipping_events
  USING ((SELECT public.rls_admin_atual()));

ALTER POLICY mkt_order_payment_history_select ON public.marketplace_order_payment_history
  USING ((SELECT public.rls_admin_atual()));

ALTER POLICY devolucoes_dono_ou_admin_select_policy ON public.devolucoes
  USING ((user_id = (SELECT auth.uid()) OR (SELECT public.rls_admin_atual())));

ALTER POLICY devolucao_itens_dono_ou_admin_select_policy ON public.devolucao_itens
  USING (((SELECT public.rls_admin_atual())
    OR devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = (SELECT auth.uid()))));

ALTER POLICY devolucao_eventos_dono_ou_admin_select_policy ON public.devolucao_eventos
  USING (((SELECT public.rls_admin_atual())
    OR devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = (SELECT auth.uid()))));

ALTER POLICY fin_contas_admin_select_policy ON public.fin_contas
  USING ((SELECT public.rls_admin_atual()));

ALTER POLICY fin_categorias_admin_select_policy ON public.fin_categorias
  USING ((SELECT public.rls_admin_atual()));

ALTER POLICY fin_caixa_sessoes_admin_select_policy ON public.fin_caixa_sessoes
  USING ((SELECT public.rls_admin_atual()));

ALTER POLICY fin_lancamentos_admin_select_policy ON public.fin_lancamentos
  USING ((SELECT public.rls_admin_atual()));
