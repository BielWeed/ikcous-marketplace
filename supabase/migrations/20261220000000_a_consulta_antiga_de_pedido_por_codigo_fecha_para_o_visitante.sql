-- ============================================================================
-- Migration 20261220000000 — a consulta antiga de pedido por código de
-- verificação fecha para o visitante e para a conta logada
-- (auditoria de segurança de 12/10/2026, lote L1, ETAPA 2: achado A-1)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- A consulta de pedido por código de verificação tem duas portas:
--   * `get_orders_by_otp_v1(e-mail, código)` — a antiga. Procura o código
--     ativo mais novo SÓ pelo e-mail. Quem sabe apenas o e-mail de outra pessoa
--     consegue errar o código 5 vezes e deixar o código CERTO dela bloqueado
--     ("Código bloqueado por excesso de tentativas").
--   * `get_orders_by_otp_v2(e-mail, WhatsApp, fragmento, código)` — a nova
--     (migration 20261217000000, etapa 1). Só olha o código do pedido que
--     confere com o trio e só conta tentativa errada quando o trio confere.
-- O site novo (1.5.26 em diante) chama SÓ a v2 e já está nas duas lojas desde
-- 13/10/2026. O único chamador da v1 no código do app
-- (`OrderSearch.tsx` -> `fetchOrdersByOtp`) sempre manda o trio, então só um app
-- instalado muito antigo (PWA que ainda não atualizou) ainda cai na v1.
--
-- 2. O QUE MUDA
--
-- `REVOKE EXECUTE` da `get_orders_by_otp_v1(text, text)` de PUBLIC, anon e
-- authenticated. Só isso. A função NÃO é apagada (nenhum DROP, nenhum corpo
-- trocado): desfazer é um GRANT. service_role e o dono (postgres) não mudam. A
-- `get_orders_by_otp_v2` não muda (continua aberta a anon e authenticated).
--
-- 3. QUEM QUEBRA
--
-- Só um app antigo que ainda chame a v1: a chamada passa a ser recusada pelo
-- banco (permissão negada) e a tela mostra o aviso genérico de erro de
-- verificação; o cliente atualiza o app (ou pede o código de novo no site novo) e
-- segue. Dentro do banco nada chama a v1: a busca em `supabase/migrations`,
-- `scripts`, `tests` e `.github` só acha a definição, a ACL e provas; nenhuma
-- função, view, política ou gatilho a chama. (Mesmo que alguma SECURITY DEFINER a
-- chamasse, rodaria com o dono, que continua com EXECUTE.)
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha de `otp_verifications`, `marketplace_orders` ou qualquer
-- tabela é lida, reescrita ou apagada. Códigos ativos continuam valendo, e pela
-- v2 (com o trio). Só a ACL de uma função muda.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a v1 não existir; o corpo vivo da v1 (md5 de
-- `replace(prosrc, E'\r', '')`) não for o que a 20261217000000 deixou (o
-- corpo é o mesmo antes e depois do corte: só a ACL muda, então um único hash
-- cobre "ainda não aplicada" e "já aplicada"); a ACL da v1 não for EXATAMENTE
-- uma das duas conhecidas — a de antes (PUBLIC não, anon sim, authenticated sim,
-- service_role sim: 20261090500000, `ci_conferir_banco_test.ts`,
-- `db-prove-grants-convergem.cjs`) ou a de depois (PUBLIC não, anon não,
-- authenticated não, service_role sim, o que torna reaplicar idempotente); ACL
-- diferente (PUBLIC com EXECUTE, só um dos dois papéis, service_role sem) é loja
-- que ninguém mediu e o apply para (lado seguro); ou a v2 não existir ou não
-- estiver executável por anon e authenticated (a porta nova tem de estar de pé
-- ANTES de a antiga fechar: senão o convidado ficaria sem rastreio).
--
-- 6. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Só REVOKE: reaplicar deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior
-- (regra da casa): quem abre a transação é o aplicador; o pré-voo, o REVOKE e a
-- conferência final caem juntos ou não caem. Um REVOKE que não revoga (grantor
-- diferente) só emite WARNING: a conferência final transforma isso em erro e o
-- apply inteiro volta.
--
-- 7. ORDEM E ROLLBACK
--
-- Banco depois do front: o front que chama só a v2 já está no ar nas duas lojas
-- (a etapa 1 + o site novo, 13/10/2026). Nenhuma edge function muda e nenhum
-- front muda neste lote. ROLLBACK MANUAL:
-- rollback-manual-20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql
-- devolve o EXECUTE de anon e authenticated com um GRANT (a ACL volta ao
-- conjunto de antes: PUBLIC sem nada; anon, authenticated, service_role e dono
-- com EXECUTE; a ordem das entradas dentro do array de ACL pode mudar, o
-- conjunto de privilégios por papel não) — e com ele volta o achado A-1.
--
-- ORDEM DE DESFAZER (importante):
--   * O rollback desta migration vem SEMPRE ANTES de qualquer rollback ou
--     reaplicação da 20261217000000. A conferência final da 20261217 exige anon e
--     authenticated com EXECUTE na v1; reaplicá-la com a v1 fechada ABORTA. Quem
--     precisar mexer na 20261217: primeiro o rollback desta, depois o resto.
--   * `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`
--     faz `GRANT EXECUTE ... get_orders_by_otp_v1 ... TO PUBLIC`; rodado DEPOIS
--     desta migration reabre a v1 para TODOS, inclusive o visitante. Não rode.
--   * Depois do rollback desta migration a consulta 23b dá POSITIVA e a 23a
--     NEGATIVA; a 21b da 20261217 (que espera anon=sim na v1) só dá o veredito
--     de antes depois dele.
--
-- PROVA VIVA: tests/banco/consulta-antiga-de-pedido-viva.cjs (comportamento) e
-- tests/banco/consulta-antiga-de-pedido-portao-viva.cjs (consultas 23a e 23b).
-- ============================================================================

DO $preflight_20261220$
DECLARE
  v_v1 CONSTANT text := 'public.get_orders_by_otp_v1(text,text)';
  v_v2 CONSTANT text := 'public.get_orders_by_otp_v2(text,text,text,text)';
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
BEGIN
  IF to_regprocedure(v_v1) IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_v1;
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure(v_v1);
  IF v_hash IS DISTINCT FROM '277776acaf395fa864cc3e2cb0638237' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261217000000 deixou — capture o corpo vivo e revise antes de aplicar.', v_v1, COALESCE(v_hash, 'ausente');
  END IF;

  IF to_regprocedure(v_v2) IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — aplique a 20261217000000 antes; sem a v2 o convidado ficaria sem rastreio.', v_v2;
  END IF;
  IF NOT has_function_privilege('anon', v_v2, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_v2, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % sem EXECUTE de anon ou authenticated — a porta nova tem de estar de pé antes de a antiga fechar.', v_v2;
  END IF;

  -- A ACL da v1 tem de ser exatamente a de antes ou a de depois (PUBLIC medido
  -- por aclexplode, grantee = 0: has_function_privilege nao tem o pseudo-papel).
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = to_regprocedure(v_v1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_v1, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_v1, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_v1, 'EXECUTE');
  IF NOT (
       (NOT v_public AND v_anon AND v_auth AND v_servico)
    OR (NOT v_public AND NOT v_anon AND NOT v_auth AND v_servico)
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a de antes nem a de depois do corte (PUBLIC=%, anon=%, authenticated=%, service_role=%) — meça a loja e revise antes de aplicar.', v_v1, v_public, v_anon, v_auth, v_servico;
  END IF;
END $preflight_20261220$;

REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM authenticated;

-- CONFERÊNCIA no instante do apply: aborta se anon/authenticated ainda alcançam
-- a v1 por qualquer caminho, se a service_role perdeu o EXECUTE, ou se a v2 não
-- ficou como a porta aberta do convidado.
DO $conferencia_20261220$
DECLARE
  v_v1 CONSTANT text := 'public.get_orders_by_otp_v1(text,text)';
  v_v2 CONSTANT text := 'public.get_orders_by_otp_v2(text,text,text,text)';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure(v_v1) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261220: % ainda alcancavel por PUBLIC', v_v1;
  END IF;
  IF has_function_privilege('anon', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261220: anon ainda executa %', v_v1;
  END IF;
  IF has_function_privilege('authenticated', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261220: authenticated ainda executa %', v_v1;
  END IF;
  IF NOT has_function_privilege('service_role', v_v1, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261220: service_role perdeu EXECUTE em %', v_v1;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = to_regprocedure(v_v2) AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261220: % aberta para PUBLIC', v_v2;
  END IF;
  IF NOT has_function_privilege('anon', v_v2, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_v2, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261220: % sem EXECUTE de anon ou authenticated -- o convidado ficaria sem rastreio', v_v2;
  END IF;
END $conferencia_20261220$;
