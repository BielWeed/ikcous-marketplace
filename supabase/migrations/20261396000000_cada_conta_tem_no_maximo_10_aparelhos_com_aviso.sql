-- ============================================================================
-- Migration 20261396000000 — cada conta tem no máximo 10 aparelhos com aviso ligado
-- (abuso do envio de avisos por quem só tem a chave pública + uma conta; caçada de segurança de 27/10/2026,
-- relatório 11-B, achado 2)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- `public.push_subscriptions` guarda uma linha por aparelho/navegador com aviso ligado. A política
-- `push_subscriptions_all_policy` deixa a dona gravar linhas com o próprio `user_id`, e a tabela só tem
-- `UNIQUE (endpoint)`: nada limita QUANTAS linhas uma conta grava. Uma conta gratuita que cadastra 100
-- "aparelhos" falsos apontando para um endereço que não responde faz a campanha do painel (edge `send-push`:
-- lotes de 20, até 10 s de espera por envio, 50 s de orçamento por campanha) gastar o orçamento esperando por
-- eles; os clientes de verdade ficam sem o aviso ("naoTentados") e, como inscrição que só demora não é apagada,
-- toda campanha seguinte repete o mesmo.
--
-- 2. O QUE MUDA (só objeto NOVO, nada existente é alterado; nenhum dado é apagado)
--
--   * função NOVA `public.push_inscricoes_limite_por_conta()` (RETURNS trigger, SECURITY DEFINER,
--     `search_path = public`);
--   * gatilho NOVO `tr_push_inscricoes_limite_por_conta`, BEFORE INSERT, FOR EACH ROW, em `public.push_subscriptions`.
--
-- Quando quem grava é um cliente (papel de API) que NÃO é administrador da loja, a 11ª inscrição NOVA da mesma
-- conta é recusada com a frase "Esta conta já tem 10 aparelhos com aviso ligado. Desligue o aviso em um aparelho
-- que você não usa mais e tente de novo." (ERRCODE P0001, DETAIL `push_limite_de_aparelhos`). NADA é apagado: a
-- conta que já está no limite escolhe o que desligar (o app apaga a linha pelo botão de desligar o aviso).
--
-- O QUE O LIMITE NÃO PODE QUEBRAR (provado em tests/banco/cada-conta-tem-no-maximo-10-aparelhos-viva.cjs):
--   * O RE-REGISTRO DO MESMO APARELHO. O app grava com UPSERT por endpoint (`usePushNotifications.ts`,
--     `.upsert(…, { onConflict: "endpoint" })` = INSERT … ON CONFLICT DO UPDATE), e o Postgres dispara o gatilho
--     BEFORE INSERT ANTES de olhar o conflito, mesmo quando a linha só vai ser atualizada. Por isso o gatilho só
--     conta o endpoint NOVO: se o endpoint já existe, devolve a linha sem contar nada (o aparelho que renova as
--     chaves de uma conta que está nos 10 continua renovando).
--   * Quem usa vários aparelhos. 10 é folga sobre o uso real (celular, computador, tablet e alguns navegadores).
--   * Conta que JÁ passa de 10 antes do apply: nenhuma linha dela é tocada; ela renova os endpoints que tem, desliga
--     os que quiser, e só não cadastra aparelho novo enquanto estiver com 10 ou mais.
--   * Administrador da loja (`public.rls_admin_atual()`, que também cobre service_role e postgres) e a sessão
--     DIRETA no banco (o `role` da sessão vale 'none'; o PostgREST sempre faz SET ROLE): sem limite, como a
--     20261224000000 faz nas avaliações.
--   * Duas inscrições simultâneas da mesma conta: o gatilho toma `pg_advisory_xact_lock` por conta antes de contar,
--     então a 10ª e a 11ª que chegam juntas não passam as duas (provado com duas conexões reais).
--
-- 3. O QUE ESTA MIGRATION NÃO FECHA (registrado, não escondido)
--
--   * O limite é POR CONTA. Contas gratuitas são ilimitadas: quem cria muitas contas continua podendo cadastrar
--     endereços mudos (10 por conta). O conserto de raiz é outro e maior (lista fechada de serviços de push no
--     `endpoint` e a edge `send-push` apagando a inscrição depois de tempos-limite seguidos) e fica fora desta
--     migration: ele pede medir antes os hosts reais de cada loja e mexe numa edge function.
--   * Inscrições velhas e mortas (aparelho reinstalado, navegador limpo) só saem da tabela quando a edge `send-push`
--     recebe 404/410 do serviço de push. Conta que acumulou 10 inscrições mortas fica sem poder cadastrar o
--     aparelho novo (o app mostra a mensagem genérica de erro do aviso). Meça antes (abaixo).
--
-- 4. DADOS EXISTENTES
--
-- NENHUMA linha é lida, reescrita ou apagada pelo apply: o gatilho só age em INSERT novo. MEDIÇÃO, só leitura, em
-- CADA loja, antes e depois (esperado: máximo bem abaixo de 10; contas com 10 ou mais são as que o limite alcança):
--   SELECT count(*) AS contas_com_10_ou_mais, max(n) AS maximo_por_conta
--     FROM (SELECT user_id, count(*) AS n FROM public.push_subscriptions WHERE user_id IS NOT NULL GROUP BY user_id) c
--    WHERE n >= 10;   -- (se não houver nenhuma, a linha vem com 0 e max nulo)
--   SELECT user_id, count(*) AS n FROM public.push_subscriptions WHERE user_id IS NOT NULL
--    GROUP BY user_id ORDER BY n DESC LIMIT 5;   -- as 5 contas com mais aparelhos
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: `push_subscriptions.endpoint` (text) ou `.user_id` (uuid) não existirem; `public.rls_admin_atual()` não
-- existir (aplique a 20261197000000 antes) ou não devolver boolean; existir mais de uma função com o nome novo, ou
-- uma com outro corpo (md5 de `replace(prosrc, E'\r', '')`); ou o gatilho de nome novo existir fora de
-- `push_subscriptions` ou diferente do desenhado (outra função, outro momento/evento, WHEN, UPDATE OF, argumentos).
-- Estados aceitos: nada do que esta migration cria existe (aplica) ou tudo existe como desenhado (reaplicar é no-op).
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- `CREATE OR REPLACE FUNCTION` + `CREATE OR REPLACE TRIGGER` (sem DROP): rodar duas vezes deixa o mesmo estado.
-- Sem BEGIN/COMMIT de nível superior (regra da casa): o aplicador dá a transação; pré-voo, criação e conferência
-- caem juntos ou não caem. CREATE TRIGGER pega `SHARE ROW EXCLUSIVE` em `push_subscriptions`: com
-- `lock_timeout = 5s` uma loja em uso falha limpo em vez de travar quem liga o aviso — repetir depois. A ACL da
-- função é FECHADA (REVOKE de PUBLIC, anon, authenticated e service_role: o gatilho dispara sem EXECUTE de quem
-- grava); isto vale só para o objeto novo desta migration, nenhum GRANT/REVOKE existente muda.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261197000000 (`rls_admin_atual`). Nenhum front e nenhuma edge function mudam: banco antes ou depois do
-- front dá no mesmo. ROLLBACK MANUAL: rollback-manual-20261396000000_cada_conta_tem_no_maximo_10_aparelhos_com_aviso.sql
-- tira o gatilho e a função (os dois são novos; não há corpo anterior a restaurar). Inscrições gravadas enquanto o
-- gatilho existiu ficam como foram.
--
-- 8. FICHA DE VERIFICAÇÃO: consultas 112a (depois) / 112b (antes).
--   PROVA VIVA: tests/banco/cada-conta-tem-no-maximo-10-aparelhos-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261396000000$
DECLARE
  v_fn CONSTANT text := 'public.push_inscricoes_limite_por_conta()';
  v_oid oid := to_regprocedure('public.push_inscricoes_limite_por_conta()');
  v_hash text;
  v_gat record;
BEGIN
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.push_subscriptions') AND NOT a.attisdropped
         AND ((a.attname = 'endpoint' AND a.atttypid = 'text'::regtype)
           OR (a.attname = 'user_id' AND a.atttypid = 'uuid'::regtype))) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.push_subscriptions não tem endpoint (text) e user_id (uuid) — meça a loja e revise antes de aplicar.';
  END IF;

  -- A exceção do administrador usa a porta das políticas (20261197).
  IF to_regprocedure('public.rls_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não existe — aplique a 20261197000000 antes.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()') AND p.prorettype = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.rls_admin_atual() não devolve boolean.';
  END IF;

  -- A função nova: ausente, ou exatamente a desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: push_inscricoes_limite_por_conta tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '4c716de5f5ccb38f93db187dcf64bf00' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com corpo desconhecido (hash %) — ninguém revisou essa redefinição; capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: push_inscricoes_limite_por_conta existe em public com outra assinatura — revise antes de aplicar.';
  END IF;

  -- O gatilho novo: ausente, ou exatamente o desenhado (BEFORE INSERT, por linha, sem WHEN/UPDATE OF/argumentos).
  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.push_subscriptions')
       OR v_gat.tgfoid IS DISTINCT FROM v_oid
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_push_inscricoes_limite_por_conta que NÃO é o desenhado aqui (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF ou argumentos) — revise antes de aplicar.';
    END IF;
  END LOOP;
END $preflight_20261396000000$;

CREATE OR REPLACE FUNCTION public.push_inscricoes_limite_por_conta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_limite CONSTANT integer := 10;
BEGIN
    -- Sessão DIRETA no banco (migration, seed, script): o `role` da sessão é 'none' (o PostgREST sempre faz SET
    -- ROLE para anon/authenticated/service_role). Não é cliente. Linha sem dona (user_id nulo) não tem conta a contar.
    IF COALESCE(NULLIF(current_setting('role', true), ''), 'none') = 'none' OR NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Re-registro do MESMO aparelho: o app grava com upsert por endpoint (INSERT … ON CONFLICT DO UPDATE) e o
    -- Postgres roda este gatilho ANTES de olhar o conflito. Endpoint que já existe não é aparelho novo: não conta.
    IF EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.endpoint = NEW.endpoint) THEN
        RETURN NEW;
    END IF;

    -- Uma conta por vez: sem a trava, a 10ª e a 11ª inscrições que chegam juntas enxergam a mesma contagem.
    PERFORM pg_advisory_xact_lock(hashtextextended('push_subscriptions_limite:' || NEW.user_id::text, 0));

    -- De novo, AGORA que a trava é nossa: duas abas ativando o MESMO aparelho novo ao mesmo tempo passam juntas pela
    -- checagem de cima (nenhuma gravou ainda); a que espera a trava acorda com o aparelho já gravado pela outra e tem
    -- de virar atualização (ON CONFLICT DO UPDATE), não recusa por contagem. A conta com 9 aparelhos é o caso.
    IF EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.endpoint = NEW.endpoint) THEN
        RETURN NEW;
    END IF;

    -- Conta até o limite e para (uma conta que já passa de 10 não faz o gatilho varrer tudo). O administrador da
    -- loja (rls_admin_atual: papel de AGORA no banco, e service_role/postgres) não tem limite.
    IF (SELECT count(*) FROM (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = NEW.user_id LIMIT v_limite) c) >= v_limite
       AND NOT public.rls_admin_atual() THEN
        RAISE EXCEPTION 'Esta conta já tem % aparelhos com aviso ligado. Desligue o aviso em um aparelho que você não usa mais e tente de novo.', v_limite
            USING ERRCODE = 'P0001', DETAIL = 'push_limite_de_aparelhos';
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.push_inscricoes_limite_por_conta() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER tr_push_inscricoes_limite_por_conta
BEFORE INSERT ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.push_inscricoes_limite_por_conta();

-- CONFERÊNCIA no instante do apply: aborta se a função ou o gatilho não ficaram como desenhados.
DO $conferencia_20261396000000$
DECLARE
  v_fn CONSTANT text := 'public.push_inscricoes_limite_por_conta()';
  v_oid oid := to_regprocedure('public.push_inscricoes_limite_por_conta()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261396000000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'push_inscricoes_limite_por_conta') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261396000000: push_inscricoes_limite_por_conta ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '4c716de5f5ccb38f93db187dcf64bf00' THEN
    RAISE EXCEPTION 'conferencia 20261396000000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.prorettype = 'trigger'::regtype
          AND p.pronargs = 0
          AND p.proconfig = ARRAY['search_path=public']::text[]
     ) THEN
    RAISE EXCEPTION 'conferencia 20261396000000: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, retorno ou argumentos)', v_fn;
  END IF;
  -- Função de gatilho FECHADA a todos os papéis de fora.
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261396000000: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261396000000: anon, authenticated ou service_role executa %', v_fn;
  END IF;
  -- O gatilho: um só, em public.push_subscriptions, BEFORE INSERT por linha, ligado (origin), apontando para a função.
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta') <> 1
     OR NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgname = 'tr_push_inscricoes_limite_por_conta'
             AND t.tgrelid = to_regclass('public.push_subscriptions')
             AND t.tgfoid = v_oid
             AND t.tgtype = 7
             AND t.tgenabled = 'O'
             AND t.tgqual IS NULL
             AND t.tgnargs = 0
             AND t.tgattr::text = ''
             AND NOT t.tgisinternal
        ) THEN
    RAISE EXCEPTION 'conferencia 20261396000000: o gatilho tr_push_inscricoes_limite_por_conta não ficou como desenhado (um só, em public.push_subscriptions, BEFORE INSERT por linha, ligado, sem WHEN)';
  END IF;
END $conferencia_20261396000000$;
