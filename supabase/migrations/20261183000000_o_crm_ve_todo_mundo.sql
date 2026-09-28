-- O CRM VÊ TODO MUNDO (pedido do dono, 27/09/2026).
--
-- O DEFEITO, MEDIDO NA FONTE
--   Dashboard CRM → aba Clientes → "Todos os clientes" só lista quem tem
--   ≥ 1 compra PAGA (crm__vendas filtra payment_status pago/pago_apos_expirar/
--   recebido_na_entrega e exclui status cancelled/returned; crm__clientes_rfm
--   agrupa por chave = user_id ou 'wa:'||dígitos). Ficam de fora TRÊS grupos
--   reais de gente: quem se cadastrou e nunca comprou; quem fez pedido e não
--   pagou (nos últimos 30 dias: 13 pedidos do app criados, 0 pagos); venda de
--   balcão sem WhatsApp (essa continua sem identidade — não dá para listar,
--   não há chave nenhuma para amarrar o registro a uma pessoa). O dono
--   escolheu: mostrar todo mundo, com 2 grupos novos na lista.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM (só LEITURA — nenhuma tabela nova)
--   1. crm__pedidos_nao_pagos(p_ate): identidade (conta OU WhatsApp, MESMA
--      regra de chave/fusão wa→conta de crm__vendas — reaproveita
--      crm__vendas(p_ate) para achar a fusão, sem duplicar a lógica; achado 7
--      da revisão de risco acrescenta um SEGUNDO mapa de fusão, tirado de
--      TODOS os pedidos com user_id — não só os pagos — para a mesma pessoa
--      não virar dois registros quando NENHUM dos pedidos dela é pago, ver
--      REVISÃO DE RISCO abaixo) com ≥ 1 pedido (qualquer status,
--      `marketplace_orders.created_at <= p_ate`) e NENHUM pedido "pago
--      válido" (a mesma régua de crm__vendas: chave ausente do conjunto que
--      crm__vendas devolve). `pedidos` conta TODOS os pedidos da identidade
--      (pedidos criados); `valor_em_aberto` soma só pedido `aguardando`,
--      NÃO cancelado/devolvido e com a reserva ainda viva (achado 2) — é o
--      valor que ainda tem chance real de virar pagamento. Exclui
--      equipe/admin (achado 8, mesma dupla checagem do item 2 abaixo).
--   2. crm__nunca_comprou(p_ate): conta cadastrada em `profiles` até p_ate
--      SEM nenhum pedido (`NOT EXISTS` em marketplace_orders), sem o mesmo
--      WhatsApp de uma venda paga de balcão (achado 6 — mesma pessoa, não
--      duas) e com DUAS checagens de "não é staff" (achado 8):
--      `COALESCE(profiles.role, 'customer') = 'customer'` (papel mora em
--      `profiles.role`: `admin | gerente | vendedor | customer` — só
--      `handle_new_user` grava `customer` no cadastro real da loja, os
--      outros três papéis são conta de STAFF, nunca de cliente comprando —
--      AGENTS.md: "papel mora em profiles.role ... lojista = staff") E
--      `auth.users.raw_app_meta_data->>'role' NOT IN staff` — a checagem que
--      `is_admin()` de fato lê; hoje as duas sempre concordam (gatilho
--      `handle_profile_role_sync_to_auth` mantém sincronizado), mas checar
--      só uma seria confiar num gatilho por trás de uma régua de segurança.
--      E-mail vem de `auth.users` (schema-qualificado; profiles não guarda
--      e-mail); WhatsApp sai normalizado a dígitos (mesma régua do resto do
--      CRM — achado 6, `profiles.whatsapp` pode estar em qualquer formato).
--      As duas funções são STABLE, sem SECURITY DEFINER (mesmo padrão de
--      crm__vendas/crm__clientes_rfm): quem autoriza é o REVOKE de
--      PUBLIC/anon/authenticated logo abaixo, e quem as chama com privilégio
--      já são as RPCs SECURITY DEFINER (3) e (4).
--   3. crm_visao(p_inicio, p_fim): CREATE OR REPLACE, MESMA assinatura. O
--      array `segmentos` ganha DUAS linhas fixas, sempre presentes (mesmo
--      com 0 clientes — o dono quer ver "0" como confirmação, não a ausência
--      do bloco): `pediu_nao_pagou` (clientes = contagem; receita = SOMA do
--      `valor_em_aberto`, decisão: é a métrica que importa aqui — quanto
--      dinheiro está "na mesa" para recuperar, não zero) e `nunca_comprou`
--      (clientes = contagem; receita = 0, decisão: não têm nenhum pedido,
--      não há valor nenhum associado). kpis, canais, formas, funil e
--      pipeline não mudam UMA vírgula — nenhuma das CTEs que os alimentam
--      (v, atual, anterior, primeira, rfm, devolvido, devolvido_manual) foi
--      tocada; só entram duas CTEs NOVAS (`nao_pagos`, `nunca`) usadas
--      exclusivamente dentro do `jsonb_build_object` de `segmentos`.
--   4. crm_clientes(p_segmento, p_busca, p_limite, p_offset): CREATE OR
--      REPLACE, MESMA assinatura, MESMO formato jsonb `{total, clientes:[…]}`
--      com as MESMAS chaves de antes + DUAS novas, `valor_em_aberto` (só
--      `pediu_nao_pagou`) e `cadastrado_em` (só `nunca_comprou` — o front
--      usa para o cartão enxuto do celular desse grupo) — quem lê a RPC
--      antiga (banco de uma loja ainda na 78) não ganha as chaves, e o
--      parser do front (`lerCliente`) já trata chave ausente como "não sei"
--      por padrão, então nenhuma tela quebra.
--      A lista vira a UNIÃO de três grupos, cada um com um número de ordem
--      (`grupo` 0/1/2) que MANDA na ordenação final antes de qualquer outro
--      critério — por isso os compradores (grupo 0) sempre vêm primeiro,
--      "pediu e não pagou" (grupo 1) depois, "nunca comprou" (grupo 2) por
--      último, exatamente como pedido:
--        grupo 0 — compradores: crm__clientes_rfm(now()), CORPO INTOCADO
--                  (mesma fonte, mesmos campos; só ganhou o alias de union).
--                  Ordenado por receita desc, depois última compra desc —
--                  o MESMO critério de antes.
--                  `receita`/`pedidos` continuam sendo os TOTAIS de vida
--                  inteira (`pedidos_total`/`receita_total`), nunca os
--                  campos de janela de 24 meses — igual ao comportamento já
--                  existente antes desta migration.
--        grupo 1 — pediu_nao_pagou: crm__pedidos_nao_pagos(now()); `receita`
--                  fixa em 0; `segmento` fixo em 'pediu_nao_pagou' (não é
--                  segmento RFM, é rótulo do grupo); ordenado por pedido mais
--                  recente (dentro do grupo, `receita` é sempre 0, então o
--                  desempate por `ultima_compra` decide sozinho).
--        grupo 2 — nunca_comprou: crm__nunca_comprou(now()); `pedidos` e
--                  `receita` fixos em 0; `primeira_compra`/`ultima_compra`
--                  ficam `NULL` (nunca houve compra — o front mostra "Nunca"
--                  quando o segmento é este); ordenado por cadastro mais
--                  recente.
--      `p_segmento` e a busca (nome/e-mail/WhatsApp) filtram os TRÊS grupos
--      igual — o filtro roda sobre a união, não sobre cada grupo à parte.
--      `total` conta a união inteira (já filtrada). Desempate final por
--      `chave ASC` (achado 10) — paginação por OFFSET estável quando grupo/
--      receita/data empatam (comum nos grupos novos, receita sempre 0).
--      Nome: `profiles.full_name` quando existir (LEFT JOIN em todos os
--      grupos), senão o nome que o pedido carrega (`customer_name`, só
--      grupos 0/1) — igual à regra de hoje.
--      SECURITY DEFINER, `search_path = public`, gate `is_admin()` com
--      42501, REVOKE/GRANT iguais aos de 78: nenhum SELECT amplo novo para
--      anon/authenticated.
--
-- REVISÃO DE RISCO (rodada 1, 27/09/2026) — achados corrigidos aqui
--   1. `tests/banco/crm-inicio-viva.cjs` esperava só os 10 segmentos RFM em
--      `crm_visao.segmentos` — corrigido NO TESTE (não aqui: a promessa desta
--      migration é trazer os 2 grupos sempre, é o teste que estava
--      desatualizado); ver tests/banco/LEIA-ME e o passo novo no rpc-ci.yml.
--   2. `valor_em_aberto`/a `receita` de `pediu_nao_pagou` em `crm_visao`
--      somavam pedido CANCELADO (cancelar não muda `payment_status`, fica
--      'aguardando' para sempre) e reserva online JÁ VENCIDA que o pg_cron
--      ainda não varreu (a varredura só olha `status='pending'`) — os dois
--      filtros novos (`status NOT IN ('cancelled','returned')` e
--      `expires_at IS NULL OR expires_at > now()`) fecham isso.
--   5. Decisão do coordenador: quem PAGOU e teve o pedido cancelado/
--      estornado/devolvido depois CONTINUA em `pediu_nao_pagou` (não tem
--      compra paga VÁLIDA agora — a descrição do front já é "não tem compra
--      paga válida", não "nunca pagou") — mas com `valor_em_aberto = 0`
--      (o achado 2 já garante: `payment_status` desse pedido não é mais
--      'aguardando'). Provado em prova viva com fixture de pedido estornado.
--   6. `crm__nunca_comprou`: WhatsApp saía CRU (`profiles.whatsapp`, formato
--      livre) — agora normalizado a dígitos, mesma régua do resto do CRM.
--      E um perfil cujo WhatsApp bate com uma venda PAGA de balcão
--      ('wa:...', a mesma pessoa comprando sem conta antes de se cadastrar)
--      não pode virar um SEGUNDO cliente aqui — `NOT EXISTS` contra as
--      chaves 'wa:' de `crm__vendas`.
--   7. `crm__pedidos_nao_pagos` só fundia WhatsApp→conta a partir de pedido
--      PAGO (`crm__vendas`) — vazio por definição neste grupo (ninguém aqui
--      pagou nada). Sem pedido pago nenhum, a MESMA pessoa que pediu uma vez
--      com conta e outra só pelo WhatsApp do balcão virava DOIS registros.
--      `wa_de_qualquer_pedido` é o fallback: mapa tirado de TODOS os pedidos
--      com `user_id`, só usado quando o mapa dos pagos não resolveu.
--   8. Equipe/admin não era excluída de `pediu_nao_pagou` (só de
--      `nunca_comprou`) — agora as duas funções excluem por
--      `profiles.role <> 'customer'` E `auth.users.raw_app_meta_data->>
--      'role' IN staff` (o que `is_admin()` de fato lê).
--   9. Provas vivas reescritas para provar 42501 com `SET ROLE anon`/
--      `SET ROLE authenticated` de verdade (não só "logado como não-admin"),
--      contra as 4 funções (as 2 RPCs e os 2 ajudantes).
--  10. `ORDER BY` de `crm_clientes` sem desempate único — paginação por
--      OFFSET podia reordenar linhas empatadas entre uma chamada e outra.
--      `, chave ASC` no fim do `ORDER BY` (interno e do `jsonb_agg`).
--
-- RE-REVISÃO DE RISCO (rodada 2, 27/09/2026) — achados corrigidos aqui
--   N1. Regressão da própria correção do achado 7: a fusão wa→conta de
--       pedidos NÃO pagos podia juntar um pedido não pago com um pedido QUE
--       `crm__vendas` reconhece como pago (ex.: pedido de app sem pagar +
--       balcão avulso pago, mesmo WhatsApp) — a identidade "vazava" para
--       pediu_nao_pagou mesmo já sendo compradora (aparecia nos dois
--       grupos). `HAVING bool_and(i.id NOT IN (SELECT order_id FROM
--       vendas))`: se qualquer pedido do grupo fundido é um pedido pago
--       reconhecido, o grupo inteiro sai de pediu_nao_pagou.
--   N2. A prova viva das RPCs/ajudantes (M10/M17) aceitava qualquer
--       "permission denied" — provado ao vivo que, com o REVOKE dos 2
--       ajudantes removido, a chamada AINDA falha (42501 "permission denied
--       for schema auth", ao ler auth.users por dentro), então um validador
--       genérico passaria com o mutante VIVO. A prova agora exige a
--       mensagem citar a FUNÇÃO certa. Também acrescentadas fixtures que
--       provam que as DUAS checagens de staff (achado 8) são
--       independentemente necessárias (profiles.role e app_metadata.role
--       mentindo um em relação ao outro) e que o WhatsApp de nunca_comprou
--       sai mesmo em dígitos (não só "não duplica").
--   N3. `scripts/ci/banco/provisionar-efemero.cjs` emulava `auth.users` sem
--       `raw_app_meta_data` — as funções desta migration leem essa coluna
--       no próprio corpo (LANGUAGE sql valida contra o catálogo na
--       criação), e a 2ª passada de aplicação (prova-dupla-aplicacao.cjs)
--       registrava o 42703 como "colisão informativa" em vez de expor o
--       defeito real de provisionamento. Coluna acrescentada, mesma receita
--       de tests/banco/provisionar.cjs.
--   N4. Comparação de WhatsApp entre os pedidos/perfis desta migration não
--       ignorava o prefixo "55" (DDI) — o mesmo número gravado uma vez com
--       DDI (balcão, "+55...") e outra sem (conta/perfil) virava duas
--       pessoas. `crm__pedidos_nao_pagos` e `crm__nunca_comprou` agora
--       comparam por uma CHAVE que tira o "55" quando o número tem 12-13
--       dígitos — o valor EXIBIDO continua o original captado.
--       `crm__vendas` (migration 78) não foi tocado.
--   N5. Custo medido (aceito como risco conhecido, sem mudança de desenho):
--       em amostra de ~20 mil perfis / ~60 mil pedidos, `crm_clientes` roda
--       ~4× mais devagar e `crm_visao` ~2,3× mais devagar que na 78 (as
--       duas novas funções fazem full scan de `profiles`/`marketplace_orders`
--       sem índice dedicado). Aceitável no volume atual da loja; se crescer
--       uma ordem de grandeza, revisar com índice em profiles.role/
--       marketplace_orders.user_id+created_at.
--   N6. `chave ASC` (achado 10) e o restante do desempate já cobriam a
--       paginação estável — nenhuma mudança adicional aqui (nit de runbook,
--       ver §8).
--
-- DADOS EXISTENTES
--   Nenhuma tabela nova, nenhuma coluna nova, nenhuma linha escrita ou
--   reescrita. As quatro funções são leitura pura.
--
-- IDEMPOTÊNCIA
--   Toda função usa `CREATE OR REPLACE`; reaplicar o arquivo dá o mesmo
--   estado. Os dois `REVOKE ALL ... FROM PUBLIC, anon, authenticated` e o
--   bloco `DO $grants$` (REVOKE seguido de GRANT) não acumulam privilégio a
--   cada rodada.
--
-- FORA DO ESCOPO
--   Venda de balcão sem WhatsApp continua sem identidade — não existe chave
--   para amarrar aquele registro a uma pessoa, então ela não pode aparecer
--   em nenhum dos três grupos (o dono já sabia disso ao pedir a mudança).
--   `painel_inicio()` não muda. Front (`src/types/crm.ts`, `src/lib/crm.ts`,
--   `ClientesDoCrm.tsx`) é passo à parte desta mesma tarefa, não desta
--   migration.
--
-- COMO APLICAR (local/dev, DATABASE_URL direto): `node scripts/db-apply.cjs
-- <este arquivo>` (sem BEGIN/COMMIT de nível superior neste arquivo — regra
-- da casa). NA LOJA (produção), NUNCA db-apply direto — só pelo workflow
-- `aplicar-migrations.yml` (Actions → migracoes=
-- 20261183000000_o_crm_ve_todo_mundo.sql, projeto=loja), que faz a prova
-- BEGIN/ROLLBACK antes de aplicar de verdade. Ver runbook §8.
--
-- FICHA DE VERIFICAÇÃO:
--   1. SELECT public.crm_clientes(NULL, NULL, 200, 0) -> 'total'; -- soma os 3 grupos
--   2. SELECT jsonb_path_query_array(public.crm_clientes(NULL, NULL, 200, 0),
--        '$.clientes[*] ? (@.segmento == "pediu_nao_pagou")');
--   3. SELECT jsonb_path_query_array(public.crm_clientes(NULL, NULL, 200, 0),
--        '$.clientes[*] ? (@.segmento == "nunca_comprou")');
--   4. SELECT public.crm_visao(current_date - 29, current_date) -> 'segmentos';
--      -- deve trazer 'pediu_nao_pagou' e 'nunca_comprou', mesmo com 0
--   5. Como não-admin (authenticated comum): SELECT public.crm_clientes();
--      deve estourar 42501.
--
-- ROLLBACK MANUAL: rollback-manual-20261183000000_o_crm_ve_todo_mundo.sql
-- (restaura os corpos de crm_visao e crm_clientes da 78, verbatim, e derruba
-- os dois ajudantes novos). psql -1 -f, nunca db-apply. Rode ANTES de
-- reverter a 78 — provado ao vivo: reverter a 78 primeiro DROPA
-- crm_clientes/crm_visao/crm__vendas/crm__clientes_rfm (o rollback da 78 é
-- só DROP, ela não existia antes) enquanto os ajudantes desta migration
-- ainda estão no ar chamando `crm__vendas` — a PRÓXIMA chamada a
-- `crm_clientes` já estoura 42883 (function does not exist), antes mesmo de
-- chegar nos ajudantes órfãos. Ver runbook §5.

CREATE OR REPLACE FUNCTION public.crm__pedidos_nao_pagos(p_ate timestamptz)
RETURNS TABLE (
  chave text, user_id uuid, nome text, whatsapp text, email text,
  pedidos integer, valor_em_aberto numeric, canal_preferido text, ultimo_pedido timestamptz
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH vendas AS (
    SELECT * FROM public.crm__vendas(p_ate)
  ), pagas AS (
    SELECT DISTINCT chave FROM vendas WHERE chave IS NOT NULL
  ), wa_da_conta_paga AS (
    -- N4 (re-revisão de risco): `wa_chave` compara SEM o "55" quando o
    -- número tem DDI (12-13 dígitos) — o MESMO WhatsApp gravado uma vez com
    -- conta (sem DDI) e outra num balcão (com "+55", ou vice-versa) não pode
    -- virar duas pessoas. `wa` (exibido) continua o valor ORIGINAL captado.
    SELECT DISTINCT ON (wa_chave)
           CASE WHEN length(v.whatsapp) IN (12, 13) AND left(v.whatsapp, 2) = '55'
                THEN substring(v.whatsapp FROM 3) ELSE v.whatsapp END AS wa_chave,
           v.user_id
      FROM vendas v
     WHERE v.whatsapp IS NOT NULL AND v.user_id IS NOT NULL
     ORDER BY wa_chave, v.pago_em DESC
  ), todos AS (
    SELECT o.id, o.total::numeric AS total, o.canal, o.user_id, o.created_at,
           o.payment_status, o.status, o.expires_at,
           NULLIF(btrim(o.customer_name), '') AS nome,
           w.wa,
           CASE WHEN length(w.wa) IN (12, 13) AND left(w.wa, 2) = '55'
                THEN substring(w.wa FROM 3) ELSE w.wa END AS wa_chave,
           NULLIF(btrim(COALESCE(o.customer_data ->> 'email', '')), '') AS email
      FROM public.marketplace_orders o
      CROSS JOIN LATERAL (
        SELECT NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa
      ) w
     WHERE o.created_at <= p_ate
  ), wa_de_qualquer_pedido AS (
    -- Achado 7 (revisão de risco): sem NENHUM pedido pago, a fusão de
    -- `vendas` (só paga) fica vazia para este grupo inteiro — sem este
    -- ajudante, a MESMA pessoa que pediu uma vez com conta e outra só pelo
    -- WhatsApp do balcão (nenhuma das duas paga) virava DOIS registros.
    -- Só entra quando `wa_da_conta_paga` não resolveu aquele número.
    SELECT DISTINCT ON (t.wa_chave) t.wa_chave, t.user_id
      FROM todos t
     WHERE t.wa_chave IS NOT NULL AND t.user_id IS NOT NULL
     ORDER BY t.wa_chave, t.created_at DESC
  ), identificados AS (
    SELECT t.*,
           COALESCE(t.user_id::text, wp.user_id::text, wq.user_id::text,
                    CASE WHEN t.wa IS NOT NULL THEN 'wa:' || t.wa END) AS chave_calc,
           COALESCE(t.user_id, wp.user_id, wq.user_id) AS uid
      FROM todos t
      LEFT JOIN wa_da_conta_paga wp ON wp.wa_chave = t.wa_chave AND t.user_id IS NULL
      LEFT JOIN wa_de_qualquer_pedido wq
             ON wq.wa_chave = t.wa_chave AND t.user_id IS NULL AND wp.user_id IS NULL
  ), agregados AS (
    SELECT i.chave_calc AS chave,
           (array_agg(i.uid ORDER BY i.created_at DESC) FILTER (WHERE i.uid IS NOT NULL))[1] AS user_id,
           (array_agg(i.nome ORDER BY i.created_at DESC) FILTER (WHERE i.nome IS NOT NULL))[1] AS nome,
           (array_agg(i.wa ORDER BY i.created_at DESC) FILTER (WHERE i.wa IS NOT NULL))[1] AS whatsapp,
           (array_agg(i.email ORDER BY i.created_at DESC) FILTER (WHERE i.email IS NOT NULL))[1] AS email,
           count(*)::integer AS pedidos,
           -- Achado 2 (revisão de risco): cancelar NÃO muda payment_status
           -- (fica 'aguardando' para sempre — update_order_status_atomic só
           -- mexe em status/estoque) e a varredura de expiração só varre
           -- status='pending'; sem os dois filtros extras, um pedido morto
           -- (cancelado, ou uma reserva online já vencida que o cron ainda
           -- não varreu) inflava "valor em aberto" com dinheiro que não tem
           -- mais chance nenhuma de virar pagamento.
           COALESCE(sum(i.total) FILTER (
             WHERE i.payment_status = 'aguardando'
               AND i.status NOT IN ('cancelled', 'returned')
               AND (i.expires_at IS NULL OR i.expires_at > now())
           ), 0) AS valor_em_aberto,
           mode() WITHIN GROUP (ORDER BY i.canal) AS canal_preferido,
           max(i.created_at) AS ultimo_pedido
      FROM identificados i
     WHERE i.chave_calc IS NOT NULL
       AND i.chave_calc NOT IN (SELECT chave FROM pagas)
     GROUP BY i.chave_calc
    -- Re-revisão de risco (N1, 27/09/2026): regressão da própria correção do
    -- achado 7. `pagas` só sabe excluir pela chave que crm__vendas calculou
    -- (sem a fusão NOVA desta migration) — quando a fusão wa→conta junta um
    -- pedido NÃO pago (ex.: app) com um pedido QUE crm__vendas RECONHECE
    -- como pago (ex.: balcão avulso, mesmo WhatsApp), a chave fundida (o
    -- user_id) não bate com a chave estreita ('wa:...') que está em `pagas`
    -- — a identidade "vazava" para pediu_nao_pagou mesmo já sendo compradora.
    -- `HAVING`: se QUALQUER pedido do grupo fundido é um dos pedidos que
    -- `vendas` (crm__vendas) reconhece como pago, o grupo inteiro sai daqui
    -- — a pessoa já é comprador, não é "quem pediu e não pagou".
    HAVING bool_and(i.id NOT IN (SELECT v.order_id FROM vendas v))
  )
  -- Achado 8 (revisão de risco): equipe/admin também não pode aparecer
  -- aqui — mesma dupla checagem de crm__nunca_comprou (profiles.role E
  -- auth.users.raw_app_meta_data->>'role', o que is_admin() lê de fato).
  SELECT a.chave, a.user_id, a.nome, a.whatsapp, a.email, a.pedidos,
         a.valor_em_aberto, a.canal_preferido, a.ultimo_pedido
    FROM agregados a
    LEFT JOIN public.profiles pr ON pr.id = a.user_id
    LEFT JOIN auth.users au ON au.id = a.user_id
   WHERE COALESCE(pr.role, 'customer') = 'customer'
     AND COALESCE(au.raw_app_meta_data ->> 'role', 'customer') NOT IN ('admin', 'gerente', 'vendedor')
$$;

CREATE OR REPLACE FUNCTION public.crm__nunca_comprou(p_ate timestamptz)
RETURNS TABLE (
  chave text, user_id uuid, nome text, whatsapp text, email text, cadastrado_em timestamptz
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH wa_pagos AS (
    -- Achado 6 (revisão de risco): o MESMO WhatsApp que já é uma venda paga
    -- de balcão ('wa:...', crm__vendas) não pode voltar como um SEGUNDO
    -- cliente aqui só porque a pessoa depois criou conta — é a MESMA
    -- identidade, já contada como compradora.
    -- N4 (re-revisão de risco): a chave de comparação sai SEM o "55" quando
    -- o número tem DDI (12-13 dígitos) — a MESMA régua de
    -- crm__pedidos_nao_pagos, para o perfil sem DDI e a venda de balcão com
    -- DDI (ou vice-versa) baterem como a mesma pessoa.
    SELECT DISTINCT
           CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55'
                THEN substring(d FROM 3) ELSE d END AS wa_chave
      FROM (
        SELECT substring(v.chave FROM 4) AS d
          FROM public.crm__vendas(p_ate) v
         WHERE v.chave LIKE 'wa:%'
      ) x
  )
  SELECT p.id::text, p.id, NULLIF(btrim(COALESCE(p.full_name, '')), ''),
         -- WhatsApp normalizado a dígitos, mesma régua do resto do CRM (era
         -- devolvido cru — achado 6). Exibido no formato ORIGINAL captado
         -- (só a comparação abaixo ignora o "55").
         pw.wa,
         u.email::text, p.created_at
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    CROSS JOIN LATERAL (
      SELECT NULLIF(regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g'), '') AS wa
    ) pw
   WHERE COALESCE(p.role, 'customer') = 'customer'
     -- Achado 8: a checagem que is_admin() de fato lê (app_metadata), não só
     -- profiles.role — defesa em profundidade mesmo com o gatilho que hoje
     -- mantém os dois sincronizados (handle_profile_role_sync_to_auth).
     AND COALESCE(u.raw_app_meta_data ->> 'role', 'customer') NOT IN ('admin', 'gerente', 'vendedor')
     AND p.created_at <= p_ate
     AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_orders o
        WHERE o.user_id = p.id AND o.created_at <= p_ate
     )
     AND NOT EXISTS (
       SELECT 1 FROM wa_pagos wp
        WHERE wp.wa_chave = (
          CASE WHEN length(pw.wa) IN (12, 13) AND left(pw.wa, 2) = '55'
               THEN substring(pw.wa FROM 3) ELSE pw.wa END
        )
     )
$$;

REVOKE ALL ON FUNCTION public.crm__pedidos_nao_pagos(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm__nunca_comprou(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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

CREATE OR REPLACE FUNCTION public.crm_clientes(
  p_segmento text DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_digitos text;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
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

DO $grants$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.crm_visao(date, date)',
    'public.crm_clientes(text, text, integer, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END
$grants$;
