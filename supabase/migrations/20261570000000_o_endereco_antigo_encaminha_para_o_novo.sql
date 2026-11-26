-- ============================================================================
-- Migration 20261570000000 — o endereço antigo encaminha para o novo (26/11/2026; caderneta da frota, troca de domínio)
-- ============================================================================
--
-- 1. O QUE FALTAVA
--
-- A caderneta (public.frota_lojas) só conhece UM endereço por loja (dominio_publico). Quando a loja troca de endereço (de
-- loja.vercel.app para loja.com.br, por exemplo), o endereço antigo — link no Instagram, favorito, Google, app instalado — deixa de
-- resolver: a v2 (resolver_loja_com_estado) devolve zero linhas e o porteiro mostra "esta loja está em manutenção" para sempre.
--
-- 2. O QUE ESTA MIGRATION FAZ (no banco que guarda a caderneta; nas outras lojas a tabela existe vazia e o efeito é o mesmo)
--
--   a) public.frota_enderecos_que_encaminham (nova): um endereço que ENCAMINHA para uma loja. Colunas: host (a chave, mesmo CHECK de
--      formato de frota_lojas.dominio_publico), loja_id (referência a frota_lojas.id, ON DELETE CASCADE: apagar a loja apaga os
--      endereços dela), motivo (antigo | www | novo-em-preparo), criado_em (now()) e quem (session_user). A linha guarda A LOJA, não o
--      destino: o endereço atual é lido de frota_lojas na hora (encaminhamento dos Correios: duas mudanças seguidas nunca viram
--      corrente de redirecionamentos). RLS ligada, NENHUMA política, nenhum privilégio para PUBLIC, anon, authenticated nem
--      service_role: só o dono lê e escreve.
--   b) gatilho frota_enderecos_que_encaminham_nao_e_principal (BEFORE INSERT OR UPDATE OF host, por linha): recusa
--      (FROTA_ENDERECO_JA_E_PRINCIPAL) um host que já é o endereço principal de alguma loja — um principal nunca encaminha.
--   c) public.resolver_encaminhamento(p_host, p_chave) RETURNS TABLE(destino text): a PORTA DE LEITURA do porteiro, perguntada só
--      quando a v2 disse "não achei". SECURITY DEFINER, VOLATILE, search_path vazio, EXECUTE só do anon (como a v2). O bloco que
--      confere a chave é o da v2 (20261490), LETRA POR LETRA (a prova viva compara os dois corpos vivos): chave errada, NULL ou vazia
--      dá zero linhas sem erro; a chave certa paga o bcrypt uma vez por hash e grava o atalho só em transação de escrita. Devolve o
--      dominio_publico ATUAL da loja dona do host, só se a loja tem ativa = true e o destino é diferente do próprio host; senão zero
--      linhas. A loja adormecida ou encerrada encaminha igual: quem mostra a página certa é o endereço novo, pela v2.
--   d) public.frota_trocar_dominio(p_id, p_ref, p_de, p_para, p_motivo, p_valido_ate): a PORTA DE TROCA (a virada, P2 do roteiro).
--      SECURITY INVOKER, search_path vazio, EXECUTE só do dono (o mesmo molde de frota_mudar_estado). Recusa, sem escrever nada:
--      instrução vencida (agora > p_valido_ate, ou NULL) ou com validade de mais de 1 h; de ou para fora do formato de host (o mesmo
--      CHECK de frota_lojas.dominio_publico, só minúsculas); de = para; motivo vazio ou com mais de 200 caracteres; loja que não existe
--      com aquele id E aquele ref; endereço atual diferente de p_de (a mensagem diz o atual); p_para que não é um endereço que
--      encaminha para ESTA loja (prova de que o preparo foi feito; apelido de outra loja também recusa). Passando tudo, numa transação
--      só: tranca a linha da loja e a do apelido (FOR UPDATE), apaga p_para da tabela nova, troca frota_lojas.dominio_publico para
--      p_para e grava p_de com o motivo antigo. Devolve id, nome, dominio_publico (o novo) e dominio_anterior. Ela é o próprio desfazer:
--      chamar com de e para invertidos volta o roteamento ao de antes (o endereço novo passa a encaminhar com o motivo antigo). O
--      motivo não é guardado em tabela (não há histórico de domínio): sai num NOTICE para o registro de quem rodou a virada.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida, escrita, apagada ou reescrita por comando desta migration (nenhum INSERT, UPDATE ou DELETE; o pré-voo e o
-- pós-voo leem só o catálogo). frota_lojas, frota_segredo, frota_estado_historico e as portas v1 e v2 não são tocadas (o pós-voo
-- confere). A tabela nova nasce vazia. Aplicar duas vezes deixa o mesmo estado: CREATE TABLE IF NOT EXISTS não toca a tabela que existe
-- (nem as linhas dela), a função do gatilho volta com o mesmo corpo e o pré-voo só aceita objetos ausentes ou idênticos aos desta.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: frota_lojas não existir ou não tiver a chave (id) e o CHECK de formato do dominio_publico da 20261141; a 20261490 não
-- estiver aplicada (frota_segredo sem hash_rapido/hash_rapido_de, ou resolver_loja e resolver_loja_com_estado sem os corpos dela); a
-- tabela, a função do gatilho e o gatilho não estiverem TODOS ausentes ou TODOS idênticos aos desta migration (colunas, restrições,
-- índice, RLS, política, privilégio, dono, corpo, atributos, ACL; sobrecarga também recusa); a porta de leitura existir com outro
-- corpo, outros atributos, outra ACL ou sobrecarga (ausente é aceito: é o que o rollback comum deixa); a porta de troca, idem.
--
-- 5. TRANSAÇÃO E TRAVAS
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; pré-voo, tabela, gatilho e pós-voo caem
-- juntos ou não caem. lock_timeout de 5 s: a chave estrangeira pede trava SHARE ROW EXCLUSIVE em frota_lojas (o porteiro só LÊ a
-- tabela, e leitura não bloqueia essa trava; quem a bloqueia é escrita longa na caderneta); se esperar mais de 5 s, a migration desiste
-- sem escrever nada (rodar de novo).
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261490000000 (o pré-voo recusa sem ela). Aplicar em CADA banco do canal (IKCOUS e Savy) e no banco onde a caderneta de
-- produção mora (IKCOUS_FROTA_URL).
-- ROLLBACK MANUAL: rollback-manual-20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql tira as portas e PRESERVA a tabela com
-- as linhas (seguro: sem a porta de leitura o porteiro volta a dar "não achei"; reaplicar devolve tudo). Apagar a tabela (e TODOS os
-- endereços que encaminham) e a função do gatilho é o rollback-manual-destrutivo-20261570000000 — só com o dono, depois do comum, com a
-- confirmação APAGAR. O rollback da 20261141 (DROP TABLE frota_lojas) recusa com esta tabela no ar (a chave estrangeira depende de
-- frota_lojas): rode antes o comum e o destrutivo desta.
--
-- 7. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.frota_enderecos_que_encaminham_nao_e_principal()');
--      -- esperado: 874d5af8ef1504daa9e602d6f991353a.
--   2. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.resolver_encaminhamento(text, text)');
--      -- esperado: 5ca45d858b56991facb8d2052f0aecfb.
--   3. SELECT has_table_privilege('anon', 'public.frota_enderecos_que_encaminham', 'SELECT'),
--             has_table_privilege('service_role', 'public.frota_enderecos_que_encaminham', 'SELECT'),
--             has_function_privilege('anon', 'public.resolver_encaminhamento(text, text)', 'EXECUTE'),
--             has_function_privilege('authenticated', 'public.resolver_encaminhamento(text, text)', 'EXECUTE');
--      -- esperado: false, false, true, false.
--   4. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.frota_trocar_dominio(text, text, text, text, text, timestamptz)');
--      -- esperado: 5758ff83113e042fc927d83c254291bd.
--   PROVA VIVA: tests/banco/o-endereco-antigo-encaminha-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261570000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_tabela oid := to_regclass('public.frota_enderecos_que_encaminham');
  v_gatilho_fn oid := to_regprocedure('public.frota_enderecos_que_encaminham_nao_e_principal()');
  v_leitura oid := to_regprocedure('public.resolver_encaminhamento(text, text)');
  v_troca oid := to_regprocedure('public.frota_trocar_dominio(text, text, text, text, text, timestamptz)');
  v_dono oid;
  v_gatilhos integer;
BEGIN
  -- A caderneta da 20261141: frota_lojas com a chave id e o CHECK de formato do endereço (o mesmo que a tabela nova copia).
  IF v_lojas IS NULL OR v_segredo IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas ou public.frota_segredo não existe — aplique a 20261141000000 antes.';
  END IF;
  IF (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = v_lojas AND k.conname = 'frota_lojas_pkey')
       IS DISTINCT FROM 'PRIMARY KEY (id)'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attname = 'id' AND NOT a.attisdropped)
       IS DISTINCT FROM 'text'
     OR (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = v_lojas AND k.conname = 'frota_lojas_dominio_publico_check')
       IS DISTINCT FROM 'CHECK ((dominio_publico ~ ''^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$''::text))' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas não tem a chave (id text) ou o CHECK de formato do dominio_publico da 20261141000000 — meça o banco e revise.';
  END IF;
  -- A 20261490 aplicada: as colunas do atalho e as duas portas com os corpos dela (a porta nova copia o bloco da chave da v2).
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = v_segredo AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('hash_rapido', 'hash_rapido_de')) <> 2
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja(text, text)'))
        IS DISTINCT FROM '0c60eb13c0016d2129b51def3ec7c255'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja_com_estado(text, text)'))
        IS DISTINCT FROM 'a30e752cff5ae4edc2db612866eb8bcd' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a 20261490000000 não está aplicada (colunas hash_rapido/hash_rapido_de, corpos de resolver_loja e resolver_loja_com_estado) — aplique-a antes ou meça o banco.';
  END IF;
  SELECT c.relowner INTO v_dono FROM pg_class c WHERE c.oid = v_lojas;

  -- Tabela, função do gatilho e gatilho: todos ausentes (primeira vez ou depois do destrutivo) ou todos idênticos (reaplicação).
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_enderecos_que_encaminham_nao_e_principal')
     <> (CASE WHEN v_gatilho_fn IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_enderecos_que_encaminham_nao_e_principal existe com outra assinatura ou com sobrecarga — meça o banco e revise.';
  END IF;
  SELECT count(*) INTO v_gatilhos FROM pg_trigger t
   WHERE t.tgrelid = v_tabela AND t.tgname = 'frota_enderecos_que_encaminham_nao_e_principal' AND NOT t.tgisinternal;
  IF (CASE WHEN v_tabela IS NULL THEN 0 ELSE 1 END) + (CASE WHEN v_gatilho_fn IS NULL THEN 0 ELSE 1 END) + v_gatilhos NOT IN (0, 3) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: só parte de frota_enderecos_que_encaminham (a tabela, a função do gatilho e o gatilho) existe — estado desconhecido, meça o banco e revise.';
  END IF;
  IF v_tabela IS NOT NULL AND (
       (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
          FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = v_tabela AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'host:text:true::-,loja_id:text:true::-,motivo:text:true::-,criado_em:timestamp with time zone:true::now(),quem:text:true::SESSION_USER'
       OR (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_tabela AND k.contype <> 'f')
       IS DISTINCT FROM 'frota_enderecos_que_encaminham_host_check=CHECK ((host ~ ''^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$''::text)) | frota_enderecos_que_encaminham_motivo_check=CHECK ((motivo = ANY (ARRAY[''antigo''::text, ''www''::text, ''novo-em-preparo''::text]))) | frota_enderecos_que_encaminham_pkey=PRIMARY KEY (host)'
       OR (SELECT string_agg(pg_get_indexdef(i.indexrelid), ' | ' ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid = v_tabela)
       IS DISTINCT FROM 'CREATE INDEX frota_enderecos_que_encaminham_loja_id_idx ON public.frota_enderecos_que_encaminham USING btree (loja_id) | CREATE UNIQUE INDEX frota_enderecos_que_encaminham_pkey ON public.frota_enderecos_que_encaminham USING btree (host)'
       -- A chave estrangeira pelo catálogo (pg_get_constraintdef escreve frota_lojas com ou sem public. conforme o search_path).
       OR (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = v_tabela AND k.contype = 'f') <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_constraint k
                       WHERE k.conrelid = v_tabela AND k.contype = 'f' AND k.conname = 'frota_enderecos_que_encaminham_loja_id_fkey'
                         AND k.confrelid = v_lojas AND k.confdeltype = 'c' AND k.confupdtype = 'a' AND k.confmatchtype = 's'
                         AND k.conkey = ARRAY[2]::int2[]
                         AND k.confkey = (SELECT ARRAY[a.attnum]::int2[] FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attname = 'id'))
       OR NOT (SELECT c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relkind = 'r' AND c.relowner = v_dono FROM pg_class c WHERE c.oid = v_tabela)
       OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_tabela)
       OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                   WHERE c.oid = v_tabela AND g.grantee <> c.relowner)
       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_tabela AND a.attacl IS NOT NULL)
       OR NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_gatilho_fn AND md5(replace(p.prosrc, E'\r', '')) = '874d5af8ef1504daa9e602d6f991353a'
            AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.prorettype = 'trigger'::regtype
            AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[])
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                   WHERE p.oid = v_gatilho_fn AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner)
       OR NOT EXISTS (
         SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = v_tabela AND t.tgname = 'frota_enderecos_que_encaminham_nao_e_principal' AND NOT t.tgisinternal
            AND t.tgfoid = v_gatilho_fn AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL
            AND (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
                  WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = 'host')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_enderecos_que_encaminham, a função do gatilho ou o gatilho já existem e não são os desta migration (colunas, restrições, índice, RLS, política, privilégio, dono, corpo, atributos ou ACL) — meça o banco e revise.';
  END IF;

  -- A porta de leitura: ausente (primeira vez ou depois do rollback comum) ou idêntica (reaplicação). Só existe com a tabela.
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_encaminhamento')
     <> (CASE WHEN v_leitura IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_encaminhamento existe com outra assinatura ou com sobrecarga — meça o banco e revise.';
  END IF;
  IF v_leitura IS NOT NULL AND (
       v_tabela IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_leitura AND md5(replace(p.prosrc, E'\r', '')) = '5ca45d858b56991facb8d2052f0aecfb'
            AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
            AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]
            AND pg_get_function_result(p.oid) = 'TABLE(destino text)')
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                   WHERE p.oid = v_leitura AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner AND g.grantee <> 'anon'::regrole)
       OR NOT has_function_privilege('anon', v_leitura, 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_encaminhamento já existe e não é a desta migration (corpo, atributos, dono ou ACL) — meça o banco e revise.';
  END IF;

  -- A porta de troca: ausente (primeira vez ou depois do rollback comum) ou idêntica (reaplicação). Só existe com a tabela.
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_trocar_dominio')
     <> (CASE WHEN v_troca IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_trocar_dominio existe com outra assinatura ou com sobrecarga — meça o banco e revise.';
  END IF;
  IF v_troca IS NOT NULL AND (
       v_tabela IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_troca AND md5(replace(p.prosrc, E'\r', '')) = '5758ff83113e042fc927d83c254291bd'
            AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
            AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]
            AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, dominio_anterior text)')
       OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                   WHERE p.oid = v_troca AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_trocar_dominio já existe e não é a desta migration (corpo, atributos, dono ou ACL) — meça o banco e revise.';
  END IF;

  -- Fotografia do que esta migration não pode mudar: frota_lojas (colunas, restrições, dono, ACL, gatilhos que não são internos) e as
  -- duas portas da caderneta. A chave estrangeira cria gatilhos INTERNOS em frota_lojas (é como o Postgres a aplica): eles ficam fora.
  PERFORM set_config('ikcous.encaminha1570_base', (
    SELECT jsonb_build_object(
      'lojas', (SELECT to_jsonb(c) - 'reltuples' - 'relpages' - 'relallvisible' - 'relhastriggers' FROM pg_class c WHERE c.oid = v_lojas),
      'colunas', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attnum > 0),
      'restricoes', (SELECT jsonb_agg(k.conname || '=' || pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_lojas),
      'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgname, t.tgfoid, t.tgtype, t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
                    WHERE t.tgrelid = v_lojas AND NOT t.tgisinternal),
      'portas', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado'))))::text, true);
END $preflight_20261570000000$;

CREATE TABLE IF NOT EXISTS public.frota_enderecos_que_encaminham (
  host text NOT NULL,
  loja_id text NOT NULL,
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  quem text NOT NULL DEFAULT session_user,
  CONSTRAINT frota_enderecos_que_encaminham_pkey PRIMARY KEY (host),
  CONSTRAINT frota_enderecos_que_encaminham_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.frota_lojas (id) ON DELETE CASCADE,
  -- O mesmo formato de frota_lojas.dominio_publico (só minúsculas, sem porta, sem caminho): o porteiro compara o host como chega.
  CONSTRAINT frota_enderecos_que_encaminham_host_check CHECK (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  CONSTRAINT frota_enderecos_que_encaminham_motivo_check CHECK (motivo IN ('antigo', 'www', 'novo-em-preparo'))
);
-- O ON DELETE CASCADE procura os endereços da loja apagada por loja_id.
CREATE INDEX IF NOT EXISTS frota_enderecos_que_encaminham_loja_id_idx ON public.frota_enderecos_que_encaminham (loja_id);

-- O ALTER DEFAULT PRIVILEGES do schema public (ver o cabeçalho da 20261141) daria tudo a anon, authenticated e service_role na tabela e
-- na função: os REVOKE fecham (e decidem o acesso no projeto novo, que nasce sem a regra). Revogar o já revogado é no-op.
ALTER TABLE public.frota_enderecos_que_encaminham ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.frota_enderecos_que_encaminham FROM PUBLIC, anon, authenticated, service_role;

-- O gatilho: um endereço principal nunca encaminha.
CREATE OR REPLACE FUNCTION public.frota_enderecos_que_encaminham_nao_e_principal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- O porteiro pergunta à v2 primeiro: um host que é o principal de uma loja e também encaminharia para outra deixaria a caderneta
  -- com duas respostas para o mesmo endereço. A troca de domínio tira o principal de frota_lojas ANTES de gravá-lo aqui.
  IF EXISTS (SELECT 1 FROM public.frota_lojas fl WHERE lower(fl.dominio_publico) = lower(NEW.host)) THEN
    RAISE EXCEPTION 'FROTA_ENDERECO_JA_E_PRINCIPAL: % é o endereço principal de uma loja da caderneta; um endereço principal não encaminha.', NEW.host;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.frota_enderecos_que_encaminham_nao_e_principal() FROM PUBLIC, anon, authenticated, service_role;

-- CREATE OR REPLACE TRIGGER (PostgreSQL 14+): reaplicar não duplica; o pré-voo já garantiu que, se existe, é este.
CREATE OR REPLACE TRIGGER frota_enderecos_que_encaminham_nao_e_principal
  BEFORE INSERT OR UPDATE OF host ON public.frota_enderecos_que_encaminham
  FOR EACH ROW EXECUTE FUNCTION public.frota_enderecos_que_encaminham_nao_e_principal();

-- A porta de leitura do porteiro: o endereço que encaminha devolve o endereço ATUAL da loja dona dele.
CREATE OR REPLACE FUNCTION public.resolver_encaminhamento(p_host text, p_chave text)
RETURNS TABLE (
  destino text
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_hash text;
  v_rapido text;
  v_rapido_de text;
BEGIN
  -- 20261490000000: o bcrypt roda UMA vez por hash (a primeira chamada com a chave certa grava o atalho); dali em diante a conferência
  -- é um sha256. O atalho só vale para o hash bcrypt ATUAL: trocar a chave reescreve hash e o invalida sozinho.
  SELECT fs.hash, fs.hash_rapido, fs.hash_rapido_de INTO v_hash, v_rapido, v_rapido_de
    FROM public.frota_segredo fs
   WHERE fs.id = 1;
  IF v_rapido IS NOT NULL AND v_rapido_de = v_hash THEN
    IF v_rapido IS DISTINCT FROM encode(extensions.digest(p_chave, 'sha256'), 'hex') THEN
      RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
    END IF;
  ELSE
    IF v_hash IS NULL OR v_hash IS DISTINCT FROM extensions.crypt(p_chave, v_hash) THEN
      RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
    END IF;
    -- A chave certa abriu pelo bcrypt: grava o atalho deste hash. Nunca espera (SKIP LOCKED) nem falha em transação só de leitura.
    IF current_setting('transaction_read_only') = 'off' THEN
      PERFORM 1 FROM public.frota_segredo fs WHERE fs.id = 1 AND fs.hash = v_hash FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        UPDATE public.frota_segredo fs
           SET hash_rapido = encode(extensions.digest(p_chave, 'sha256'), 'hex'),
               hash_rapido_de = v_hash
         WHERE fs.id = 1
           AND fs.hash = v_hash;
      END IF;
    END IF;
  END IF;

  -- 20261570000000: o bloco acima é o da v2 (resolver_loja_com_estado), letra por letra. O endereço que encaminha guarda a LOJA, não o
  -- destino: o endereço atual é lido agora, e duas mudanças seguidas nunca viram corrente. A loja com ativa = false é desconhecida
  -- (zero linhas, como na v2), e um destino igual ao próprio host nunca é devolvido (não há como redirecionar para si mesmo).
  RETURN QUERY
  SELECT fl.dominio_publico
    FROM public.frota_enderecos_que_encaminham fe
    JOIN public.frota_lojas fl ON fl.id = fe.loja_id
   WHERE fe.host = lower(p_host)
     AND fl.ativa
     AND lower(fl.dominio_publico) <> lower(p_host);
END;
$$;

-- Só o anon executa (o porteiro chama pelo PostgREST com a chave publicável, como a v2). O REVOKE fecha o ALTER DEFAULT PRIVILEGES do
-- schema public; o GRANT decide o acesso também no projeto novo, que nasce sem a regra.
REVOKE ALL ON FUNCTION public.resolver_encaminhamento(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolver_encaminhamento(text, text) TO anon;

-- A porta de troca: a virada do endereço principal, numa transação, com o próprio desfazer (de e para invertidos).
CREATE OR REPLACE FUNCTION public.frota_trocar_dominio(
  p_id text,
  p_ref text,
  p_de text,
  p_para text,
  p_motivo text,
  p_valido_ate timestamptz
)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  dominio_anterior text
)
LANGUAGE plpgsql
SECURITY INVOKER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  -- O mesmo formato de frota_lojas.dominio_publico e de frota_enderecos_que_encaminham.host.
  v_formato constant text := '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
  v_atual text;
  v_dono_do_para text;
BEGIN
  IF p_valido_ate IS NULL OR clock_timestamp() > p_valido_ate THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_INSTRUCAO_VENCIDA: a instrução valia até % — gere outra.', p_valido_ate;
  END IF;
  IF p_valido_ate > clock_timestamp() + interval '1 hour' THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_VALIDADE_LONGA: a instrução vale até %, mais de 1 hora a partir de agora — gere outra.', p_valido_ate;
  END IF;
  IF p_de IS NULL OR p_para IS NULL OR p_de !~ v_formato OR p_para !~ v_formato THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_HOST_INVALIDO: de (%) e para (%) têm de ser endereços em minúsculas, sem porta e sem caminho.', COALESCE(p_de, 'NULL'), COALESCE(p_para, 'NULL');
  END IF;
  IF p_de = p_para THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_SEM_MUDANCA: de e para são o mesmo endereço (%).', p_para;
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' OR char_length(p_motivo) > 200 THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_MOTIVO: o motivo é obrigatório e tem no máximo 200 caracteres.';
  END IF;

  -- id é a chave de frota_lojas: no máximo uma linha; o ref tem de ser o dela. FOR UPDATE: duas trocas ao mesmo tempo esperam uma pela
  -- outra, e a segunda relê o endereço já trocado (e cai na conferência de p_de logo abaixo).
  SELECT fl.dominio_publico INTO v_atual
    FROM public.frota_lojas fl
   WHERE fl.id = p_id AND fl.project_ref = p_ref
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_LOJA_NAO_ENCONTRADA: nenhuma loja com id % e ref % na caderneta.', COALESCE(p_id, 'NULL'), COALESCE(p_ref, 'NULL');
  END IF;
  IF v_atual IS DISTINCT FROM p_de THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_DIVERGENTE: o endereço principal da loja % é %, não %.', p_id, v_atual, p_de;
  END IF;
  -- O preparo feito: p_para já encaminha para ESTA loja (DNS, certificado e Vercel provados antes da virada).
  SELECT fe.loja_id INTO v_dono_do_para
    FROM public.frota_enderecos_que_encaminham fe
   WHERE fe.host = p_para
     FOR UPDATE;
  IF v_dono_do_para IS DISTINCT FROM p_id THEN
    RAISE EXCEPTION 'FROTA_DOMINIO_SEM_PREPARO: % não é um endereço que encaminha para a loja % — prepare-o antes (motivo novo-em-preparo).', p_para, p_id;
  END IF;

  -- As três escritas, nesta ordem: o gatilho da tabela nova só aceita p_de depois que ele deixou de ser o principal.
  DELETE FROM public.frota_enderecos_que_encaminham fe WHERE fe.host = p_para;
  RETURN QUERY
    WITH mudou AS (
      UPDATE public.frota_lojas fl
         SET dominio_publico = p_para
       WHERE fl.id = p_id AND fl.project_ref = p_ref
      RETURNING fl.id, fl.nome, fl.dominio_publico
    )
    SELECT m.id, m.nome, m.dominio_publico, p_de FROM mudou m;
  INSERT INTO public.frota_enderecos_que_encaminham (host, loja_id, motivo) VALUES (p_de, p_id, 'antigo');

  RAISE NOTICE 'FROTA_DOMINIO_TROCADO: a loja % passou de % para % (motivo: %).', p_id, p_de, p_para, p_motivo;
END;
$$;

REVOKE ALL ON FUNCTION public.frota_trocar_dominio(text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

DO $posvoo_20261570000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_tabela oid := to_regclass('public.frota_enderecos_que_encaminham');
  v_gatilho_fn oid := to_regprocedure('public.frota_enderecos_que_encaminham_nao_e_principal()');
  v_leitura oid := to_regprocedure('public.resolver_encaminhamento(text, text)');
  v_troca oid := to_regprocedure('public.frota_trocar_dominio(text, text, text, text, text, timestamptz)');
  v_dono oid := (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.frota_lojas'));
BEGIN
  IF v_tabela IS NULL OR v_gatilho_fn IS NULL OR v_leitura IS NULL OR v_troca IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: a tabela frota_enderecos_que_encaminham, a função do gatilho, a porta de leitura ou a de troca está ausente';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_troca AND md5(replace(p.prosrc, E'\r', '')) = '5758ff83113e042fc927d83c254291bd'
          AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
          AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_id text, p_ref text, p_de text, p_para text, p_motivo text, p_valido_ate timestamp with time zone'
          AND pg_get_function_result(p.oid) = 'TABLE(id text, nome text, dominio_publico text, dominio_anterior text)')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_trocar_dominio') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: corpo, atributos ou dono de frota_trocar_dominio não são os desta migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_troca AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner)
     OR has_function_privilege('anon', v_troca, 'EXECUTE')
     OR has_function_privilege('authenticated', v_troca, 'EXECUTE')
     OR has_function_privilege('service_role', v_troca, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: alguém além do dono executa frota_trocar_dominio';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_leitura AND md5(replace(p.prosrc, E'\r', '')) = '5ca45d858b56991facb8d2052f0aecfb'
          AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v' AND p.proretset AND NOT p.proisstrict
          AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_host text, p_chave text'
          AND pg_get_function_result(p.oid) = 'TABLE(destino text)')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_encaminhamento') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: corpo, atributos ou dono de resolver_encaminhamento não são os desta migration';
  END IF;
  -- SECURITY DEFINER lê a caderneta como o dono: só o anon (e o dono) executa; nem PUBLIC, nem authenticated, nem service_role.
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_leitura AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner AND g.grantee <> 'anon'::regrole)
     OR NOT has_function_privilege('anon', v_leitura, 'EXECUTE')
     OR has_function_privilege('authenticated', v_leitura, 'EXECUTE')
     OR has_function_privilege('service_role', v_leitura, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: a ACL de resolver_encaminhamento não é "só o anon executa"';
  END IF;
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = v_tabela AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM 'host:text:true::-,loja_id:text:true::-,motivo:text:true::-,criado_em:timestamp with time zone:true::now(),quem:text:true::SESSION_USER'
     OR (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_tabela AND k.contype <> 'f')
     IS DISTINCT FROM 'frota_enderecos_que_encaminham_host_check=CHECK ((host ~ ''^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$''::text)) | frota_enderecos_que_encaminham_motivo_check=CHECK ((motivo = ANY (ARRAY[''antigo''::text, ''www''::text, ''novo-em-preparo''::text]))) | frota_enderecos_que_encaminham_pkey=PRIMARY KEY (host)'
     OR (SELECT string_agg(pg_get_indexdef(i.indexrelid), ' | ' ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid = v_tabela)
     IS DISTINCT FROM 'CREATE INDEX frota_enderecos_que_encaminham_loja_id_idx ON public.frota_enderecos_que_encaminham USING btree (loja_id) | CREATE UNIQUE INDEX frota_enderecos_que_encaminham_pkey ON public.frota_enderecos_que_encaminham USING btree (host)'
     OR (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = v_tabela AND k.contype = 'f') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k
                     WHERE k.conrelid = v_tabela AND k.contype = 'f' AND k.conname = 'frota_enderecos_que_encaminham_loja_id_fkey'
                       AND k.confrelid = v_lojas AND k.confdeltype = 'c' AND k.confupdtype = 'a' AND k.confmatchtype = 's'
                       AND k.conkey = ARRAY[2]::int2[]
                       AND k.confkey = (SELECT ARRAY[a.attnum]::int2[] FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attname = 'id')) THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: frota_enderecos_que_encaminham não tem as colunas, as restrições, a chave estrangeira ou o índice desta migration';
  END IF;
  IF NOT (SELECT c.relrowsecurity AND NOT c.relforcerowsecurity AND c.relowner = v_dono FROM pg_class c WHERE c.oid = v_tabela)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_tabela)
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = v_tabela AND g.grantee <> c.relowner)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_tabela AND a.attacl IS NOT NULL)
     OR has_table_privilege('anon', v_tabela, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', v_tabela, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('service_role', v_tabela, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: frota_enderecos_que_encaminham não está fechada (RLS ligada, nenhuma política, privilégio só do dono)';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_gatilho_fn AND md5(replace(p.prosrc, E'\r', '')) = '874d5af8ef1504daa9e602d6f991353a'
          AND l.lanname = 'plpgsql' AND NOT p.prosecdef AND p.prorettype = 'trigger'::regtype
          AND p.proowner = v_dono AND p.proconfig = ARRAY['search_path=""']::text[])
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_gatilho_fn AND g.privilege_type = 'EXECUTE' AND g.grantee <> p.proowner)
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'frota_enderecos_que_encaminham_nao_e_principal') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: corpo, atributos, dono ou ACL de frota_enderecos_que_encaminham_nao_e_principal não são os desta migration';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = v_tabela AND t.tgname = 'frota_enderecos_que_encaminham_nao_e_principal' AND NOT t.tgisinternal
         AND t.tgfoid = v_gatilho_fn AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL
         AND (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
               WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])) = 'host') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: o gatilho frota_enderecos_que_encaminham_nao_e_principal não é BEFORE INSERT OR UPDATE OF host por linha, habilitado';
  END IF;
  IF (SELECT jsonb_build_object(
        'lojas', (SELECT to_jsonb(c) - 'reltuples' - 'relpages' - 'relallvisible' - 'relhastriggers' FROM pg_class c WHERE c.oid = v_lojas),
        'colunas', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = v_lojas AND a.attnum > 0),
        'restricoes', (SELECT jsonb_agg(k.conname || '=' || pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = v_lojas),
        'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgname, t.tgfoid, t.tgtype, t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
                      WHERE t.tgrelid = v_lojas AND NOT t.tgisinternal),
        'portas', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p
                    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('resolver_loja', 'resolver_loja_com_estado'))))
     IS DISTINCT FROM current_setting('ikcous.encaminha1570_base')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261570000000: frota_lojas (colunas, restrições, dono, ACL, gatilhos) ou as portas da caderneta mudaram';
  END IF;
END $posvoo_20261570000000$;

-- Objetos novos no schema public: recarrega o schema cache do PostgREST (nenhum papel da API os alcança). Idempotente.
NOTIFY pgrst, 'reload schema';
