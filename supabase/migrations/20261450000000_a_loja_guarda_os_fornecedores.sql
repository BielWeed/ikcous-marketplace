-- A LOJA GUARDA OS FORNECEDORES, E SO O ADMIN DA LOJA ENXERGA (Central de Fornecedores, etapa E1; permissao + dado de cliente; 25/11/2026)
-- Ainda nao aplicada em loja alguma. ADITIVA pelos criterios da carta branca: nao apaga tabela, coluna nem dado, nao le nem
-- escreve linha de tabela existente (cria 1 tabela VAZIA, 1 funcao de gatilho e 1 gatilho; nenhum objeto existente e'
-- redefinido). Mesmo assim e' tabela nova com RLS e permissao: so aplicar depois da revisao Opus do SQL e da consulta de estado
-- (181b: objetos ausentes).
--
-- DEFEITO (o que falta hoje): a lojista nao tem onde guardar QUEM VENDE PARA ELA (nome, WhatsApp, Instagram, site, cidade,
-- observacoes). O contato mora em caderno de papel, no celular ou na memoria. A unica pista que o banco tem e' produtos.fornecedor_id,
-- uma coluna sem chave estrangeira, sem uso no app e LEGIVEL POR QUALQUER USUARIO LOGADO (20261070000000): nao serve de base para
-- guardar contato de fornecedor, porque o contato e o apelido que a lojista da ao atacadista sao segredo comercial da loja.
-- Esta migration NAO reaproveita essa coluna e NAO a toca.
--
-- O QUE ENTRA (3 objetos novos; nenhum objeto existente e' redefinido):
--   (1) public.fornecedores_carimba_atualizado_em(): funcao de GATILHO (NAO e' SECURITY DEFINER, search_path = public, sem
--       EXECUTE para ninguem de aplicacao). Quem escreveu a data vem do SERVIDOR: no INSERT grava criado_em e atualizado_em = now();
--       no UPDATE preserva criado_em e id (OLD) e renova atualizado_em = now(). O que o app enviar nessas tres colunas e' ignorado.
--       O helper handle_updated_at() da baseline nao serve: so cuida de updated_at.
--   (2) public.fornecedores: id uuid (default gen_random_uuid(); o app tambem pode mandar o proprio id, e e' isso que torna a
--       gravacao repetivel sem duplicar: upsert por id), nome (obrigatorio, 1 a 80 caracteres apos btrim), whatsapp (so digitos,
--       10 a 13), instagram (so o usuario: letras, numeros, ponto e sublinhado, ate 30), site (https://, sem espaco, ate 200),
--       cidade (1 a 80), uf (as 27 siglas), observacoes (ate 500), favorito (boolean, default false), criado_em e atualizado_em.
--       Os CHECKs espelham a validacao do formulario (src/lib/fornecedores.ts) e sao a SEGUNDA parede: o link de WhatsApp, de
--       Instagram e de site que o app monta nunca nasce de texto que o banco aceitou sem regra. Nasce VAZIA: sem semente.
--       Sem chave estrangeira (nao liga a produto, a pedido nem a usuario).
--   (3) o gatilho fornecedores_carimba_atualizado_em (BEFORE INSERT OR UPDATE, por linha).
--
-- QUEM LE E ESCREVE: RLS ligada. QUATRO politicas, uma por acao (select, insert, update, delete), TO authenticated, todas com
-- (SELECT public.rls_admin_atual()) -- a porta feita para politicas (20261197000000): le o papel de AGORA em auth.users E em
-- profiles, nunca o app_metadata do JWT. Admin rebaixado no banco, ainda com JWT de admin, e' recusado. Cliente logado, anon e
-- service_role nao leem nem escrevem nada. Grants: REVOKE ALL explicito de PUBLIC, anon, authenticated e service_role (a ACL
-- varia entre lojas), depois so SELECT, INSERT, UPDATE e DELETE ao authenticated. A tabela NAO entra na publicacao do realtime.
-- Nao ha funcao nova com SECURITY DEFINER: o app fala direto com a tabela pelo PostgREST e a RLS decide.
--
-- DADOS EXISTENTES: nenhuma linha de nenhuma tabela existente e' lida ou escrita ao aplicar; a tabela nasce vazia. Quem ja e'
-- admin continua admin; ninguem ganha nem perde acesso a nada que ja existia. Aplicar de novo sobre a tabela que ja tem linhas NAO
-- as toca: CREATE TABLE IF NOT EXISTS pula a tabela existente (o pre-voo exige que ela tenha EXATAMENTE a forma desta migration).
--
-- ATOMICIDADE E REAPLICACAO: sem BEGIN/COMMIT de nivel superior (regra da casa, AGENTS.md: o aplicador -- scripts/db-apply.cjs ou
-- o workflow aplicar-migrations.yml -- abre a transacao inteira; um COMMIT dentro do arquivo faria o ROLLBACK da prova virar
-- no-op). Tudo ou nada: qualquer erro do pre-voo, do corpo ou do pos-voo aborta a transacao do aplicador e NADA fica gravado.
-- O PRE-VOO exige o que esta migration SUPOE (rls_admin_atual com o corpo da 20261197 e EXECUTE so para authenticated) e aceita,
-- para cada objeto proprio, "ausente" ou "exatamente o desta migration" (colunas por nome/tipo/nulidade, nomes dos CHECKs, corpo
-- da funcao por md5 sem CR, gatilho); a tabela pode estar tambem no estado "selado" que o rollback comum deixa (sem politica e
-- sem privilegio). Qualquer outra coisa recusa com B1_BASELINE_DIVERGENT e nada e' escrito. O POS-VOO exige TODO o estado novo
-- (corpo, atributos e ACL da funcao; RLS, privilegios, CHECKs, politicas e gatilho da tabela). Rodar duas vezes deixa o mesmo
-- estado (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY/TRIGGER IF EXISTS + CREATE, REVOKE/GRANT repetiveis).
--
-- ORDEM: depois da 20261197 (rls_admin_atual). Banco ANTES do front: a tela "Meus fornecedores" le esta tabela. Front antigo
-- continua funcionando (nada que ele usa mudou). Desfazer ESTA antes de desfazer a 20261197 (as politicas citam rls_admin_atual()).
--
-- FORA DO ESCOPO (de proposito): vincular fornecedor a produto (etapa E2, tabela propria), ordem de compra, recebimento de
-- estoque, catalogo global, qualquer escrita em dinheiro. Nenhum indice alem da chave: a tabela e' de dezenas de linhas por loja.
--
-- COMO APLICAR: node scripts/db-apply.cjs supabase/migrations/20261450000000_a_loja_guarda_os_fornecedores.sql (ou o workflow
-- aplicar-migrations.yml), sem BEGIN/COMMIT de nivel superior neste arquivo (regra da casa). Antes: consulta 181b (objetos ausentes).
-- Depois: consulta 181a (estado aplicado, rol fechado de itens, todos ok).
--
-- FICHA DE VERIFICACAO a mao (psql, depois de aplicar):
--   1. SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.fornecedores'::regclass;   -- t | f
--   2. SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.fornecedores'::regclass ORDER BY 1;    -- 4 linhas: d, a, r, w
--   3. SELECT grantee::regrole, privilege_type FROM pg_class c, aclexplode(c.relacl) WHERE c.oid = 'public.fornecedores'::regclass;
--      -- so o dono (postgres) e authenticated com SELECT/INSERT/UPDATE/DELETE; anon, PUBLIC e service_role: nenhuma linha
--   4. SELECT count(*) FROM public.fornecedores;   -- 0 na primeira aplicacao
--
-- PROVAS: tests/banco/os-fornecedores-so-o-admin-da-loja-viva.cjs (rpc-ci, Postgres efemero, papeis reais: admin le e escreve;
-- admin rebaixado, cliente, anon e service_role nada; CHECKs; gatilho; reaplicar; rollback comum e destrutivo; pre-voo e pos-voo
-- divergentes; mutantes) e tests/migration_a_loja_guarda_os_fornecedores_test.ts (texto, hashes, sem BEGIN/COMMIT).
--
-- ROLLBACK MANUAL: rollback-manual-20261450000000_a_loja_guarda_os_fornecedores.sql (comum: tira as 4 politicas, o gatilho, a
-- funcao e TODOS os privilegios; preserva a tabela, as linhas e a RLS ligada, seladas) e
-- rollback-manual-destrutivo-20261450000000_a_loja_guarda_os_fornecedores.sql (so com o dono: apaga a tabela e os contatos).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261450000000$
DECLARE
  r record;
  v_t oid := to_regclass('public.fornecedores');
  v_colunas text;
BEGIN
  -- A porta do admin de agora (20261197): corpo, seguranca e EXECUTE so para authenticated.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.rls_admin_atual()')
        AND md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305'
        AND p.prosecdef) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: rls_admin_atual() ausente ou divergente (a 20261197 e a base desta migration).';
  END IF;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE de rls_admin_atual() divergente (a politica nova precisa dele para authenticated e nao para anon).';
  END IF;
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gen_random_uuid() ausente (PostgreSQL 13 ou mais novo).';
  END IF;

  -- A funcao do gatilho: ausente, ou exatamente a desta migration (sem sobrecarga, sem outro dono de corpo).
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fornecedores_carimba_atualizado_em') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fornecedores_carimba_atualizado_em tem sobrecarga em public.';
  END IF;
  IF to_regprocedure('public.fornecedores_carimba_atualizado_em()') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.fornecedores_carimba_atualizado_em()')
          AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND NOT p.prosecdef
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'trigger'
          AND md5(replace(p.prosrc, chr(13), '')) = 'e05593617f77fa8e7caf14479400b6b1') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fornecedores_carimba_atualizado_em ja existe com corpo ou atributos diferentes (sucessora no ar?) - nao reaplique por cima.';
  END IF;

  -- A tabela: ausente, ou exatamente a desta migration (estado aplicado OU estado selado do rollback comum).
  IF v_t IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
      INTO v_colunas FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relkind = 'r')
       OR v_colunas IS DISTINCT FROM 'id:uuid:true,nome:text:true,whatsapp:text:false,instagram:text:false,site:text:false,cidade:text:false,uf:text:false,observacoes:text:false,favorito:boolean:true,criado_em:timestamp with time zone:true,atualizado_em:timestamp with time zone:true' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fornecedores existe e nao tem a forma desta migration (%).', v_colunas;
    END IF;
    IF (SELECT string_agg(conname::text, ',' ORDER BY conname::text COLLATE "C") FROM pg_constraint
         WHERE conrelid = v_t AND contype IN ('p', 'c'))
         IS DISTINCT FROM 'fornecedores_cidade_check,fornecedores_instagram_check,fornecedores_nome_check,fornecedores_observacoes_check,fornecedores_pkey,fornecedores_site_check,fornecedores_uf_check,fornecedores_whatsapp_check'
       OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_t AND contype NOT IN ('p', 'c', 'n')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: constraints de public.fornecedores divergentes (nomes dos CHECKs, ou chave estrangeira/unique que esta migration nao cria).';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_t AND NOT tgisinternal
               AND tgname <> 'fornecedores_carimba_atualizado_em') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fornecedores tem gatilho que esta migration nao conhece.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relrowsecurity AND NOT relforcerowsecurity)
       OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fornecedores') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fornecedores sem RLS (ou com FORCE), ou na publicacao do realtime.';
    END IF;
    -- Estado aplicado (4 politicas + 4 privilegios do authenticated) OU selado (nenhuma politica, nenhum privilegio).
    IF NOT (
         ((SELECT count(*) FROM pg_policy WHERE polrelid = v_t) = 4
           AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = v_t AND g.grantee <> c.relowner) = 4
           AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = v_t AND g.grantee = 'authenticated'::regrole AND NOT g.is_grantable
                   AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) = 4)
         OR (NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t)
           AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                            WHERE c.oid = v_t AND g.grantee <> c.relowner))
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politicas ou privilegios de public.fornecedores nao sao nem os desta migration nem o estado selado do rollback comum.';
    END IF;
  END IF;
END $preflight_20261450000000$;

-- ===== (1) o carimbo de quem e quando: vem do servidor =====

CREATE OR REPLACE FUNCTION public.fornecedores_carimba_atualizado_em()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  -- As datas e o id vem do SERVIDOR: o app nao envia, e o que enviar nestas colunas e' ignorado.
  IF TG_OP = 'INSERT' THEN
    NEW.criado_em := now();
  ELSE
    NEW.id := OLD.id;
    NEW.criado_em := OLD.criado_em;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fornecedores_carimba_atualizado_em() FROM PUBLIC, anon, authenticated, service_role;

-- ===== (2) a tabela: nasce vazia, so o admin de agora =====

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  whatsapp text,
  instagram text,
  site text,
  cidade text,
  uf text,
  observacoes text,
  favorito boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedores_pkey PRIMARY KEY (id),
  CONSTRAINT fornecedores_nome_check CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),
  CONSTRAINT fornecedores_whatsapp_check CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,13}$'),
  CONSTRAINT fornecedores_instagram_check CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  CONSTRAINT fornecedores_site_check CHECK (site IS NULL OR (char_length(site) <= 200 AND site ~ '^https://[^[:space:]]+$')),
  CONSTRAINT fornecedores_cidade_check CHECK (cidade IS NULL OR char_length(btrim(cidade)) BETWEEN 1 AND 80),
  CONSTRAINT fornecedores_uf_check CHECK (uf IS NULL OR uf IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  CONSTRAINT fornecedores_observacoes_check CHECK (observacoes IS NULL OR char_length(observacoes) <= 500)
);
COMMENT ON TABLE public.fornecedores IS 'Fornecedores da loja (Central de Fornecedores, E1): contato e observacoes de quem vende para a lojista. Dado comercial PRIVADO: so o admin de agora (rls_admin_atual()) le e escreve. Nao reaproveita produtos.fornecedor_id (legivel por qualquer logado).';

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fornecedores FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fornecedores TO authenticated;

DROP POLICY IF EXISTS fornecedores_admin_select_policy ON public.fornecedores;
CREATE POLICY fornecedores_admin_select_policy ON public.fornecedores
  FOR SELECT TO authenticated
  USING ((SELECT public.rls_admin_atual()));

DROP POLICY IF EXISTS fornecedores_admin_insert_policy ON public.fornecedores;
CREATE POLICY fornecedores_admin_insert_policy ON public.fornecedores
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.rls_admin_atual()));

DROP POLICY IF EXISTS fornecedores_admin_update_policy ON public.fornecedores;
CREATE POLICY fornecedores_admin_update_policy ON public.fornecedores
  FOR UPDATE TO authenticated
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

DROP POLICY IF EXISTS fornecedores_admin_delete_policy ON public.fornecedores;
CREATE POLICY fornecedores_admin_delete_policy ON public.fornecedores
  FOR DELETE TO authenticated
  USING ((SELECT public.rls_admin_atual()));

-- ===== (3) o gatilho =====

DROP TRIGGER IF EXISTS fornecedores_carimba_atualizado_em ON public.fornecedores;
CREATE TRIGGER fornecedores_carimba_atualizado_em
  BEFORE INSERT OR UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.fornecedores_carimba_atualizado_em();

-- ===== pos-voo: o estado novo INTEIRO, ou a transacao do aplicador aborta =====

DO $posflight_20261450000000$
DECLARE
  v_t oid := to_regclass('public.fornecedores');
  v_caminho text;
  r record;
BEGIN
  -- A funcao: uma so, corpo, atributos e ACL (nenhum grant fora do dono).
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fornecedores_carimba_atualizado_em') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure('public.fornecedores_carimba_atualizado_em()')
          AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND NOT p.prosecdef
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'trigger'
          AND md5(replace(p.prosrc, chr(13), '')) = 'e05593617f77fa8e7caf14479400b6b1'
          AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee <> p.proowner)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL de fornecedores_carimba_atualizado_em divergentes.';
  END IF;

  -- A tabela: comum, RLS ligada sem FORCE, fora do realtime, sem privilegio de coluna avulso.
  IF v_t IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity)
     OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fornecedores')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_t AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fornecedores sem RLS, com FORCE, no realtime ou com privilegio por coluna.';
  END IF;

  -- Privilegios: so o dono e o authenticated (os 4, sem grant option); anon, PUBLIC e service_role nada.
  IF (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
       WHERE c.oid = v_t AND g.grantee <> c.relowner) <> 4
     OR (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
          WHERE c.oid = v_t AND g.grantee = 'authenticated'::regrole AND NOT g.is_grantable
            AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) <> 4
     OR has_any_column_privilege('anon', v_t, 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_any_column_privilege('service_role', v_t, 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_table_privilege('service_role', v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: privilegios de public.fornecedores divergentes (so o authenticated, com SELECT/INSERT/UPDATE/DELETE).';
  END IF;

  -- Constraints (so os NOMES; ordem de bytes para nao depender do collation do banco).
  IF (SELECT string_agg(conname::text, ',' ORDER BY conname::text COLLATE "C") FROM pg_constraint
       WHERE conrelid = v_t AND contype IN ('p', 'c'))
        IS DISTINCT FROM 'fornecedores_cidade_check,fornecedores_instagram_check,fornecedores_nome_check,fornecedores_observacoes_check,fornecedores_pkey,fornecedores_site_check,fornecedores_uf_check,fornecedores_whatsapp_check' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: constraints de public.fornecedores divergentes.';
  END IF;

  -- O gatilho: um so, BEFORE INSERT OR UPDATE por linha (tgtype 23), habilitado, apontando para a funcao.
  IF (SELECT string_agg(t.tgname || ':' || t.tgtype::text || ':' || t.tgenabled::text || ':' || p.proname, ',' ORDER BY t.tgname)
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = v_t AND NOT t.tgisinternal)
       IS DISTINCT FROM 'fornecedores_carimba_atualizado_em:23:O:fornecedores_carimba_atualizado_em' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gatilho de public.fornecedores divergente.';
  END IF;

  -- Politicas (forma deparseada com search_path = pg_catalog): exatamente QUATRO, uma por acao, so do admin de agora.
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('fornecedores_admin_select_policy', 'r'),
    ('fornecedores_admin_insert_policy', 'a'),
    ('fornecedores_admin_update_policy', 'w'),
    ('fornecedores_admin_delete_policy', 'd')
  ) AS esperado(politica, acao) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid = v_t AND p.polname = r.politica AND p.polcmd::text = r.acao AND p.polpermissive
         AND array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END FROM unnest(p.polroles) x ORDER BY 1), ',') = 'authenticated'
         AND ((r.acao IN ('r', 'w', 'd') AND pg_get_expr(p.polqual, p.polrelid) = '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
              OR (r.acao = 'a' AND p.polqual IS NULL))
         AND ((r.acao IN ('a', 'w') AND pg_get_expr(p.polwithcheck, p.polrelid) = '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
              OR (r.acao IN ('r', 'd') AND p.polwithcheck IS NULL))) THEN
      PERFORM set_config('search_path', v_caminho, true);
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % de public.fornecedores ausente ou divergente.', r.politica;
    END IF;
  END LOOP;
  PERFORM set_config('search_path', v_caminho, true);
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = v_t) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fornecedores tem de ter exatamente quatro politicas (select, insert, update, delete).';
  END IF;
END $posflight_20261450000000$;

NOTIFY pgrst, 'reload schema';
