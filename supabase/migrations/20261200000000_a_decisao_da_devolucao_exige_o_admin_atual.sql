-- A DECISÃO DA DEVOLUÇÃO EXIGE O ADMIN DE AGORA (permissão + dado de cliente;
-- 04/10/2026) — fecha a ressalva R-b da revisão Opus da 20261199000000.
--
-- O DEFEITO: admin_devolucao_decidir, admin_devolucao_registrar e
-- admin_devolucao_reprovar autorizam só por `public.is_admin()`, que
-- responde `true` assim que o JWT diz app_metadata.role = 'admin' (vale
-- ~1 h depois do rebaixamento). Nesse tempo, um ex-admin ainda aprova ou
-- recusa a devolução de um cliente (a recusa vai para o cliente com a
-- mensagem que ele escrever), registra envio/recebimento e reprova o produto
-- na inspeção. A 20261197000000 e a 20261199000000 deixaram estas três de
-- fora de propósito ("só mudam o estado da devolução"); a revisão pediu para
-- fechá-las também, porque quem não é mais admin não deve mexer no andamento
-- da devolução de ninguém. O dinheiro e o estoque dela (concluir, reemitir
-- reembolso, liberar vínculo reverso) já exigem o admin atual desde a 97.
--
-- A GUARDA (a mesma regra da 97 e da 99, uma forma só): o bloco de
-- autorização que a função JÁ tem é copiado byte a byte, com
-- `public.is_admin()` trocado por `public.is_admin_atual()` (admin em auth.users E em
-- profiles, lidos agora), e inserido LOGO DEPOIS dele, com um comentário
-- próprio — antes de ler a devolução, de travar a linha ou de escrever. Daí:
-- mesma mensagem ('Acesso negado.') e mesmo SQLSTATE (42501) da recusa de
-- não-admin que a função já tem, o front não muda; e quem não é admin de
-- agora não descobre se a devolução existe (recebe 42501, nunca P0002). O
-- bloco do `is_admin()` fica intacto; o resto de cada corpo é o vigente
-- byte a byte (o da 20261175000000 — nenhuma migration posterior redefine
-- estas três; conferido contra o banco montado com todas as migrations até a
-- 99 e amarrado pelo teste de texto). Assinatura, RETURNS, volatilidade,
-- SECURITY DEFINER e search_path não mudam; `CREATE OR REPLACE` preserva ACL
-- e dono — nenhum GRANT/REVOKE aqui. Nenhum chamador muda
-- (src/hooks/useDevolucoesAdmin.ts não lê o código do erro).
--
-- QUEM PASSA, DEPOIS: o conjunto só ENCOLHE. Admin de verdade (admin nas duas
-- fontes) passa como antes; service_role e o papel postgres (a automação de
-- confiança — mesma detecção de is_admin()) passam como antes; o dono da
-- devolução nunca passou por aqui (são portas do painel). EFEITO COLATERAL
-- ACEITO (o mesmo da 97 e da 99): quem é admin só no app_metadata, sem
-- profiles.role = 'admin' (ou o contrário), para de mexer na devolução. A
-- conferência de papel contraditório é a mesma da 97/99 — zero linhas = ninguém
-- perde acesso:
--   SELECT u.id FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
--    WHERE COALESCE(u.raw_app_meta_data ->> 'role' = 'admin', false)
--          IS DISTINCT FROM COALESCE(p.role = 'admin', false);
--
-- DADOS EXISTENTES: nenhuma linha é lida ou reescrita ao aplicar — só corpo
-- de função. Devolução que um ex-admin JÁ decidiu, registrou ou reprovou antes
-- desta migration fica como está (a guarda só vale para o próximo clique);
-- devolução em andamento (solicitada, aprovada, em trânsito, recebida)
-- continua no estado em que está e é decidida normalmente por um admin atual.
--
-- IDEMPOTÊNCIA: `CREATE OR REPLACE` dos três corpos; o preflight aceita, para
-- cada um, o corpo vigente OU o que esta migration deixa — reaplicar produz o
-- mesmo estado (provado: duas reaplicações, impressão digital igual).
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: `CREATE OR REPLACE FUNCTION` em plpgsql não
-- valida o corpo na criação, e substituir um corpo vivo que NÃO é o esperado
-- apagaria em silêncio a correção de outra migration. O
-- `DO $preflight_20261200$`, ANTES de qualquer escrita, recusa se: (1)
-- `is_admin()` não é o corpo da baseline (a guarda copia o bloco dela); (2)
-- `is_admin_atual()` não é o da 20261197000000 (sem ela, toda guarda vira
-- erro — aplique a 97 antes); (3) o corpo vivo de alguma das três, por
-- `md5(replace(prosrc, E'\r', ''))`, não é nem o vigente nem o desta, ou o
-- DONO dela não executa `is_admin_atual()` (a função é SECURITY DEFINER e chama
-- a guarda como o dono — sem EXECUTE, recusaria até o admin). Os hashes são o
-- md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_a_decisao_da_devolucao_exige_o_admin_atual_test.ts.
--
-- TRANSAÇÃO: sem `BEGIN`/`COMMIT` de nível superior (regra da casa,
-- AGENTS.md: com eles o `ROLLBACK` da prova do workflow vira no-op). O
-- workflow `aplicar-migrations.yml` manda o arquivo inteiro numa consulta só — o
-- preflight e os três corpos caem juntos ou não caem.
--
-- ORDEM: depois da 20261197000000 (cria is_admin_atual(); o preflight recusa
-- sem ela). Independe da 20261198000000 (nenhuma função em comum: a 98 mexe
-- em cancelar/mudar status e em admin_devolucao_reemitir_reembolso, não nestas
-- três). ROLLBACK: este vem ANTES do da 97 — o da 97 apaga is_admin_atual(),
-- que estes três corpos chamam; na ordem errada decidir/registrar/reprovar
-- passam a recusar com "function does not exist" (fecha, não abre). Nenhuma
-- tela muda; nenhuma edge muda.
--
-- COMO APLICAR: workflow `aplicar-migrations.yml` (Actions -> Run workflow),
-- `migracoes = 20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql`.
--
-- FICHA DE VERIFICAÇÃO:
--   1. A conferência de papel contraditório acima: zero linhas.
--   2. Cada uma das três contém `public.is_admin_atual()` UMA vez, logo depois do
--      bloco do `is_admin()`.
--   3. `proacl` das três igual antes e depois.
--   4. Admin de verdade no painel (Devoluções): aprovar/recusar, marcar como
--      enviada/recebida e reprovar na inspeção seguem funcionando.
--
-- PROVA VIVA: tests/banco/admin-atual-devolucao-viva.cjs (rpc-ci) — para cada
-- uma das três: ex-admin rebaixado (só profiles, só auth.users, JWT velho) é
-- recusado com a recusa de sempre e SEM escrita; admin de verdade, service_role
-- e postgres têm o efeito normal; cliente e anon recusam; controle sem a guarda
-- escreve; rollback troca só os três corpos; preflights recusando sem escrita.
--
-- ROLLBACK MANUAL:
-- rollback-manual-20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql
-- restaura, byte a byte, os três corpos de antes.

DO $preflight_20261200$
DECLARE
  r record;
  v_hash text;
  v_dono oid;
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
        ('public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)', '9016a6f0151bcefddd65eb24bc369c32', '9cd24a3818b1fea1b4d182bf4b2b52b0'),
        ('public.admin_devolucao_registrar(uuid,text,text,text)', '1c21f253418ca60b76c8f9374dd9b298', 'f59a9f01811512329c425295ea171e76'),
        ('public.admin_devolucao_reprovar(uuid,text)', 'b68b1b227b2fa90a037374e2770a1b68', '16f223b54591e6ee24eeb6e28c8c264c')
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
END $preflight_20261200$;

-- admin_devolucao_decidir: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucao_decidir(
  p_id uuid,
  p_aprovar boolean,
  p_mensagem text DEFAULT NULL,
  p_coleta_em timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_msg text := NULLIF(btrim(COALESCE(p_mensagem, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261200000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'solicitada' THEN
    RAISE EXCEPTION 'Esta devolução já foi decidida.' USING ERRCODE = '22023';
  END IF;

  IF p_aprovar THEN
    UPDATE public.devolucoes
       SET status = 'aprovada', aprovada_em = now(), mensagem_loja = v_msg,
           coleta_em = CASE WHEN metodo_retorno = 'coleta' THEN p_coleta_em ELSE NULL END,
           updated_at = now()
     WHERE id = p_id;
    PERFORM public.devolucao__registrar_evento(p_id, 'solicitada', 'aprovada', 'loja', v_msg);
    RETURN jsonb_build_object('id', p_id, 'status', 'aprovada');
  END IF;

  -- Recusa sempre explícita e com motivo (CDC art. 26 §2º I).
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'Explique ao cliente o motivo da recusa.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'recusada', mensagem_loja = v_msg, encerrada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'solicitada', 'recusada', 'loja', v_msg);
  RETURN jsonb_build_object('id', p_id, 'status', 'recusada');
END;
$$;

-- admin_devolucao_registrar: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucao_registrar(
  p_id uuid,
  p_evento text,
  p_codigo text DEFAULT NULL,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_codigo text := NULLIF(upper(btrim(COALESCE(p_codigo, ''))), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261200000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF p_evento = 'em_transito' THEN
    IF v_d.status <> 'aprovada' THEN
      RAISE EXCEPTION 'Só uma devolução aprovada pode ser marcada como enviada.' USING ERRCODE = '22023';
    END IF;
    IF v_codigo IS NOT NULL AND v_codigo !~ '^[A-Z0-9-]{5,40}$' THEN
      RAISE EXCEPTION 'Código de rastreio inválido.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.devolucoes
       SET status = 'em_transito', postada_em = now(),
           codigo_rastreio = COALESCE(v_codigo, codigo_rastreio), updated_at = now()
     WHERE id = p_id;
  ELSIF p_evento = 'recebida' THEN
    IF v_d.status NOT IN ('aprovada', 'em_transito') THEN
      RAISE EXCEPTION 'Só uma devolução aprovada ou a caminho pode ser marcada como recebida.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.devolucoes SET status = 'recebida', recebida_em = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Evento desconhecido.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.devolucao__registrar_evento(p_id, v_d.status, p_evento, 'loja',
    concat_ws(' · ', CASE WHEN v_codigo IS NOT NULL THEN 'Rastreio: ' || v_codigo END, NULLIF(btrim(COALESCE(p_nota, '')), '')));
  RETURN jsonb_build_object('id', p_id, 'status', p_evento);
END;
$$;

-- admin_devolucao_reprovar: corpo vigente da 20261175000000_a_devolucao_nasce_no_pedido.sql.
CREATE OR REPLACE FUNCTION public.admin_devolucao_reprovar(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.devolucoes%ROWTYPE;
  v_msg text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261200000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_d FROM public.devolucoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'recebida' THEN
    RAISE EXCEPTION 'Só um produto recebido pode ser reprovado na inspeção.' USING ERRCODE = '22023';
  END IF;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'Explique ao cliente por que o produto não foi aceito.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.devolucoes
     SET status = 'reprovada', mensagem_loja = v_msg, encerrada_em = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.devolucao__registrar_evento(p_id, 'recebida', 'reprovada', 'loja', v_msg);
  RETURN jsonb_build_object('id', p_id, 'status', 'reprovada');
END;
$$;
