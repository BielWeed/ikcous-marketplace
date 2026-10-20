-- ============================================================================
-- Migration 20261248000000 — a coluna notes do pedido fecha para a gravação do painel
-- (dado de cliente + permissão; segunda metade da 20261247000000)
-- ============================================================================
-- O DEFEITO QUE ESTA MIGRATION FECHA: a anotação interna da lojista mudou de lugar. A 20261247000000
-- criou public.marketplace_order_internal_notes (só do admin de agora) e o front novo (PR #983, no ar
-- desde 17/10/2026) grava lá. Mas a coluna public.marketplace_orders.notes — a que a cliente baixa
-- junto com o pedido — ainda aceita UPDATE do papel authenticated: a 20261060000000 deixou
-- `GRANT UPDATE (tracking_code, notes) ON marketplace_orders TO authenticated`. Um painel ANTIGO
-- ainda aberto num aparelho (o app instalado atualiza por prompt) continuaria gravando a anotação
-- interna em notes, e ela chegaria ao celular da cliente.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. PRÉ-VOO (B1_BASELINE_DIVERGENT), antes de qualquer escrita: lê o privilégio EFETIVO em
--      marketplace_orders (has_column_privilege por coluna: conta o grant direto, o de PUBLIC e o
--      herdado de outro papel, não só a ACL direta) e só segue se ele estiver EXATAMENTE no estado de
--      antes (authenticated atualiza notes e tracking_code, nada mais) ou no de depois (só
--      tracking_code); anon e PUBLIC não atualizam coluna nenhuma. Recusa
--      anon/PUBLIC com UPDATE em qualquer coluna, UPDATE de TABELA inteira para anon/authenticated/
--      PUBLIC (um REVOKE de coluna não tira privilégio de tabela: o apply abortaria no fim com o
--      vazamento aberto, então recusa já aqui, com a mensagem certa), privilégio de coluna com
--      GRANT OPTION, service_role sem UPDATE em notes, e coluna notes ou tracking_code ausente.
--   2. `REVOKE UPDATE (notes) ON marketplace_orders FROM authenticated, anon, PUBLIC` — só a coluna
--      notes. Não é REVOKE de tabela: um REVOKE de tabela apagaria também o grant de coluna de
--      tracking_code, que o painel novo ainda usa para salvar o código de rastreio.
--   3. CONFERÊNCIA no instante do apply: aborta (e a transação do aplicador volta inteira) se
--      authenticated ou anon ainda têm UPDATE em notes por qualquer caminho (grant de outro
--      grantor, herança de papel, tabela inteira), se authenticated PERDEU o UPDATE em
--      tracking_code, se alguma outra coluna ganhou UPDATE, ou se service_role deixou de poder
--      atualizar notes. Sem este bloco, um REVOKE que não revoga (grantor diferente) só emitiria um
--      WARNING e o apply terminaria "ok" com a porta aberta.
--
-- NÃO MEXE: RLS, políticas, gatilhos, funções, INSERT e SELECT. A criação do pedido (INSERT de
-- notes) e a leitura continuam como estão; as RPCs e as edge functions escrevem como SECURITY
-- DEFINER (dono do banco) ou service_role e não dependem deste grant. Provado por busca (17/10/2026):
-- nenhum UPDATE de notes em src/, supabase/functions nem supabase/migrations; e pelo catálogo do banco
-- com todas as migrations aplicadas (211 funções de public): das 14 que atualizam marketplace_orders
-- nenhuma é SECURITY INVOKER e nenhuma cita notes no UPDATE.
--
-- QUEM QUEBRA: só um painel ANTIGO (anterior ao PR #983) ao salvar a "Anotação interna": o
-- PostgREST passa a responder 42501 (permission denied for table marketplace_orders) e a tela mostra
-- o erro de salvar até a lojista atualizar o app. O rastreio, o status e o resto do painel antigo não
-- mudam (o painel antigo grava tracking_code numa chamada À PARTE da de notes). A cliente não é
-- afetada.
--
-- DADOS EXISTENTES: nenhuma linha é lida, copiada, reescrita ou apagada; só mudam privilégios. As
-- anotações antigas continuam em notes, e o que a lojista já gravou lá continua visível à cliente
-- (separar isso mudaria dado existente, decisão à parte).
--
-- IDEMPOTÊNCIA: REVOKE de privilégio é idempotente e o pré-voo aceita o estado de depois, então
-- aplicar duas vezes deixa o mesmo estado (provado em tests/banco/notes-do-pedido-fechada-viva.cjs).
-- TRANSAÇÃO: sem BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md): quem abre a transação é o
-- aplicador (aplicar-migrations.yml / scripts/db-apply.cjs), e o pré-voo, o REVOKE e a conferência
-- caem juntos ou não caem. lock_timeout 5s / statement_timeout 30s.
--
-- ORDEM: depois do front novo no ar nas lojas (já está, 1.5.35). Antes dele, o front antigo ainda
-- grava em notes e seria quebrado. ROLLBACK:
-- rollback-manual-20261248000000_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel.sql devolve
-- `GRANT UPDATE (notes)` ao authenticated (reabre a porta).
-- PROVAS: tests/banco/notes-do-pedido-fechada-viva.cjs (PG17, papéis reais, mutantes) e
-- tests/migration_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel_test.ts (texto e fiação).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261248$
DECLARE
  v_t oid := to_regclass('public.marketplace_orders');
  v_anon oid := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
  v_auth oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  v_colunas text;
BEGIN
  IF v_anon IS NULL OR v_auth IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam os papéis anon, authenticated ou service_role.';
  END IF;
  IF v_t IS NULL OR NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = v_t), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders ausente.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = v_t AND attname IN ('notes', 'tracking_code') AND attnum > 0 AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders sem a coluna notes ou tracking_code.';
  END IF;

  -- UPDATE de TABELA inteira para quem não devia: o REVOKE de coluna abaixo não o tira.
  IF has_table_privilege('anon', v_t, 'UPDATE') OR has_table_privilege('authenticated', v_t, 'UPDATE')
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = v_t AND g.privilege_type = 'UPDATE' AND g.grantee IN (0, v_anon, v_auth)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: anon, authenticated ou PUBLIC têm UPDATE de TABELA inteira em marketplace_orders — o REVOKE de coluna não adianta; revise a ACL antes de aplicar.';
  END IF;

  -- anon e PUBLIC não atualizam coluna nenhuma. Privilégio EFETIVO (has_column_privilege): conta o
  -- grant direto, o de PUBLIC e o herdado de outro papel; ler só a ACL direta (attacl) deixaria passar
  -- um papel herdado com UPDATE em qualquer coluna.
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
                AND (has_column_privilege(v_anon, v_t, a.attnum, 'UPDATE')
                     OR has_column_privilege('public'::name, v_t, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: anon ou PUBLIC têm UPDATE de coluna em marketplace_orders (direto, por PUBLIC ou herdado de papel) — loja que ninguém mediu.';
  END IF;

  -- UPDATE de coluna repassável (GRANT OPTION) deixaria o authenticated reabrir a porta sozinho.
  IF EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
              WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
                AND g.privilege_type = 'UPDATE' AND g.grantee = v_auth AND g.is_grantable) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated tem UPDATE de coluna com GRANT OPTION em marketplace_orders.';
  END IF;

  -- As colunas em que o authenticated atualiza DE FATO (efetivo: direto, PUBLIC ou herdado de papel):
  -- exatamente as de antes ou exatamente as de depois.
  SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege(v_auth, v_t, a.attnum, 'UPDATE');
  IF v_colunas IS DISTINCT FROM 'notes,tracking_code' AND v_colunas IS DISTINCT FROM 'tracking_code' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated atualiza as colunas [%] de marketplace_orders; esperado notes,tracking_code (antes) ou tracking_code (depois).', COALESCE(v_colunas, 'nenhuma');
  END IF;

  IF NOT has_column_privilege('service_role', v_t, 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: service_role não atualiza marketplace_orders.notes.';
  END IF;
END $preflight_20261248$;

REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM authenticated;
REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM anon;
REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM PUBLIC;

DO $conferencia_20261248$
DECLARE
  v_t oid := to_regclass('public.marketplace_orders');
  v_anon oid := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
  v_auth oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  v_colunas text;
BEGIN
  IF has_column_privilege('authenticated', v_t, 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'conferencia 20261248: authenticated ainda atualiza marketplace_orders.notes (grant de outro grantor, herança de papel ou UPDATE de tabela)';
  END IF;
  IF has_column_privilege('anon', v_t, 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'conferencia 20261248: anon ainda atualiza marketplace_orders.notes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
              WHERE a.attrelid = v_t AND a.attname = 'notes' AND NOT a.attisdropped
                AND g.privilege_type = 'UPDATE' AND g.grantee IN (0, v_anon, v_auth))
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = v_t AND g.privilege_type = 'UPDATE' AND g.grantee IN (0, v_anon, v_auth)) THEN
    RAISE EXCEPTION 'conferencia 20261248: ainda há UPDATE em notes (ou na tabela inteira) para authenticated, anon ou PUBLIC';
  END IF;
  IF NOT has_column_privilege('authenticated', v_t, 'tracking_code', 'UPDATE') THEN
    RAISE EXCEPTION 'conferencia 20261248: authenticated perdeu o UPDATE em marketplace_orders.tracking_code';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
                AND (has_column_privilege(v_anon, v_t, a.attnum, 'UPDATE')
                     OR has_column_privilege('public'::name, v_t, a.attnum, 'UPDATE'))) THEN
    RAISE EXCEPTION 'conferencia 20261248: anon ou PUBLIC atualizam alguma coluna de marketplace_orders';
  END IF;
  SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege(v_auth, v_t, a.attnum, 'UPDATE');
  IF v_colunas IS DISTINCT FROM 'tracking_code' THEN
    RAISE EXCEPTION 'conferencia 20261248: authenticated atualiza [%] de marketplace_orders; esperado só tracking_code', COALESCE(v_colunas, 'nenhuma');
  END IF;
  IF NOT has_column_privilege('service_role', v_t, 'notes', 'UPDATE') THEN
    RAISE EXCEPTION 'conferencia 20261248: service_role perdeu o UPDATE em marketplace_orders.notes';
  END IF;
END $conferencia_20261248$;
