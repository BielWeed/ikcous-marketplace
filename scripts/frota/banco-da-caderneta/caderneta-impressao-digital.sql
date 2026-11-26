-- ============================================================================
-- Impressão digital da caderneta da frota (26/11/2026) — SÓ LEITURA, um SELECT
-- NÃO É MIGRATION. Roda nos DOIS bancos da virada (o antigo, de IKCOUS_FROTA_URL, e o da IKCOUS), pelo MCP, com execute_sql
-- (nunca apply_migration). Roteiro: docs/runbooks/caderneta-muda-de-banco.md.
-- ============================================================================
--
-- O QUE DEVOLVE: linhas `bloco | valor`, em ordem de bloco. Dois bancos com a MESMA caderneta dão as MESMAS linhas; a linha que
-- difere diz o que divergiu:
--   <tabela>.linhas / <tabela>.conteudo  contagem e md5 de TODAS as colunas de cada linha (frota_lojas, frota_estado_historico,
--                                        frota_enderecos_que_encaminham; de frota_segredo, tudo menos hash, hash_rapido e
--                                        hash_rapido_de);
--   frota_segredo.hash                   md5 do hash bcrypt da chave (o hash nunca sai em claro; a chave nunca está no banco);
--   frota_segredo.hash_rapido_nulo       sim/nao. O atalho (sha256 da chave) NUNCA sai, nem em md5. Depois da cópia o destino
--                                        tem "sim" (a cópia não leva o atalho de propósito) e a origem "nao": é a ÚNICA diferença
--                                        esperada; vira "nao" no destino na primeira chamada do porteiro com a chave certa;
--   frota_estado_historico.sequencia     o último id entregue pela sequência ("nunca chamada" se nenhum);
--   tabela.<nome>.forma / .acl           md5 de colunas, restrições, RLS, dono, políticas e gatilhos; ACL da tabela e das colunas
--                                        (também da sequência do histórico), em claro;
--   funcao.<nome>.corpo/.atributos/.acl  md5 do corpo (sem \r, como o resto do repositório mede), linguagem, SECURITY DEFINER,
--                                        volatilidade, search_path, dono, retorno e sobrecargas; ACL em claro — das 7 funções
--                                        da caderneta (as 4 até a 20261490 e as 3 da 20261570: o gatilho dos endereços, a porta
--                                        resolver_encaminhamento e a porta frota_trocar_dominio);
--   ledger.<versão>                      registrada/ausente, para as 6 migrations da caderneta. INFORMATIVO: no banco antigo
--                                        as migrations da caderneta foram à mão e podem não estar no histórico; o que prova que
--                                        os objetos são os mesmos são os blocos tabela.* e funcao.*.
--
-- NÃO DEPENDE DO BANCO: texto ordenado com a colação "C" (dois bancos com colação padrão diferente dariam md5 diferente) e
-- data com fuso normalizada para UTC (dois bancos com TimeZone diferente dariam texto diferente para o mesmo instante).
--
-- O QUE ELE NÃO FAZ: não escreve nada (roda em transação READ ONLY), não chama resolver_loja nem resolver_loja_com_estado (elas
-- gravam o atalho; resolver_encaminhamento também), não devolve dado de loja nem endereço que encaminha (só contagens e md5).
--
-- EXIGE as tabelas das migrations 20261141 a 20261470: sem frota_estado_historico (a 20261470) a consulta falha com "relation
-- does not exist" — o que já é a resposta (o banco não está pronto para a virada). A 20261570 NÃO é exigida (o banco antigo da
-- caderneta pode não tê-la): sem frota_enderecos_que_encaminham, tabela ausente = zero endereços DE PROPÓSITO —
-- frota_enderecos_que_encaminham.linhas = 0 e .conteudo = md5 vazio, os mesmos de um destino com a tabela vazia; o que a
-- 20261570 cria (tabela.frota_enderecos_que_encaminham.* e funcao.* das 3 funções dela) sai "ausente", e essa é a diferença
-- esperada entre um banco sem ela e um com ela. Prova viva: tests/banco/a-caderneta-muda-de-banco-viva.cjs (rpc-ci.yml).
-- ============================================================================
WITH
-- A tabela dos endereços é a ÚNICA que a origem pode não ter: o banco antigo da caderneta não recebe migration pelo canal, e
-- a 20261570 não precisa ir até lá. Tabela ausente = zero endereços (não há endereço a esquecer). A leitura é dinâmica: um
-- FROM direto falharia ao PLANEJAR ("relation does not exist"), mesmo sem linha; o query_to_xml só roda quando a tabela existe
-- (to_regclass), e o XMLTABLE devolve o texto do to_jsonb de cada linha byte a byte (o XML escapa e o XMLTABLE desfaz).
enderecos_da_origem AS (
  SELECT x.j::jsonb AS j
    FROM XMLTABLE('/table/row' PASSING
           CASE WHEN to_regclass('public.frota_enderecos_que_encaminham') IS NULL THEN '<table/>'::xml
                ELSE query_to_xml('SELECT to_jsonb(fe)::text AS j FROM public.frota_enderecos_que_encaminham fe', false, false, '') END
           COLUMNS j text PATH 'j') x
),
linhas AS (
  SELECT 'frota_lojas'::text AS tabela, fl.id::text AS chave, to_jsonb(fl) AS j FROM public.frota_lojas fl
  UNION ALL
  SELECT 'frota_estado_historico', lpad(h.id::text, 20, '0'), to_jsonb(h) FROM public.frota_estado_historico h
  UNION ALL
  SELECT 'frota_segredo', fs.id::text, to_jsonb(fs) - 'hash' - 'hash_rapido' - 'hash_rapido_de' FROM public.frota_segredo fs
  UNION ALL
  SELECT 'frota_enderecos_que_encaminham', e.j ->> 'host', e.j FROM enderecos_da_origem e
),
normalizadas AS (
  SELECT l.tabela, l.chave,
         (SELECT COALESCE(jsonb_object_agg(e.key,
                   CASE WHEN a.atttypid = 'timestamptz'::regtype AND jsonb_typeof(e.value) = 'string'
                        THEN to_jsonb(to_char((e.value #>> '{}')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))
                        ELSE e.value END), '{}'::jsonb)
            FROM jsonb_each(l.j) e
            LEFT JOIN pg_attribute a
              ON a.attrelid = to_regclass('public.' || l.tabela) AND a.attname = e.key AND a.attnum > 0 AND NOT a.attisdropped
         )::text AS linha
    FROM linhas l
),
conteudo AS (
  SELECT t.tabela,
         (SELECT count(*) FROM normalizadas n WHERE n.tabela = t.tabela) AS linhas,
         (SELECT md5(COALESCE(string_agg(n.linha, E'\n' ORDER BY n.chave COLLATE "C"), ''))
            FROM normalizadas n WHERE n.tabela = t.tabela) AS md5
    FROM (VALUES ('frota_lojas'), ('frota_segredo'), ('frota_estado_historico'), ('frota_enderecos_que_encaminham')) t(tabela)
),
tabelas AS (
  SELECT v.nome, to_regclass('public.' || v.nome)::oid AS oid
    FROM (VALUES ('frota_lojas'), ('frota_segredo'), ('frota_estado_historico'), ('frota_estado_historico_id_seq'),
                 ('frota_enderecos_que_encaminham')) v(nome)
),
funcoes AS (
  SELECT f.nome, to_regprocedure(f.assinatura)::oid AS oid,
         (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f.nome) AS versoes
    FROM (VALUES ('resolver_loja', 'public.resolver_loja(text, text)'),
                 ('resolver_loja_com_estado', 'public.resolver_loja_com_estado(text, text)'),
                 ('frota_mudar_estado', 'public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)'),
                 ('frota_lojas_estado_so_pela_porta', 'public.frota_lojas_estado_so_pela_porta()'),
                 ('frota_enderecos_que_encaminham_nao_e_principal', 'public.frota_enderecos_que_encaminham_nao_e_principal()'),
                 ('resolver_encaminhamento', 'public.resolver_encaminhamento(text, text)'),
                 ('frota_trocar_dominio', 'public.frota_trocar_dominio(text, text, text, text, text, timestamptz)')) f(nome, assinatura)
)
SELECT d.bloco, d.valor
  FROM (
    SELECT c.tabela || '.linhas' AS bloco, c.linhas::text AS valor FROM conteudo c
    UNION ALL
    SELECT c.tabela || '.conteudo', c.md5 FROM conteudo c
    UNION ALL
    SELECT 'frota_segredo.hash', COALESCE((SELECT md5(fs.hash) FROM public.frota_segredo fs WHERE fs.id = 1), 'sem linha')
    UNION ALL
    SELECT 'frota_segredo.hash_rapido_nulo',
           COALESCE((SELECT CASE WHEN (to_jsonb(fs) ->> 'hash_rapido') IS NULL THEN 'sim' ELSE 'nao' END
                       FROM public.frota_segredo fs WHERE fs.id = 1), 'sem linha')
    UNION ALL
    SELECT 'frota_estado_historico.sequencia',
           COALESCE((SELECT COALESCE(s.last_value::text, 'nunca chamada') FROM pg_sequences s
                      WHERE s.schemaname = 'public' AND s.sequencename = 'frota_estado_historico_id_seq'), 'ausente')
    UNION ALL
    SELECT 'tabela.' || t.nome || '.forma',
           CASE WHEN t.oid IS NULL THEN 'ausente' ELSE md5(concat_ws(' | ',
             (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                                || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'),
                                ',' ORDER BY a.attname COLLATE "C")
                FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
               WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped),
             (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname COLLATE "C")
                FROM pg_constraint k WHERE k.conrelid = t.oid),
             (SELECT c.relkind::text || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':'
                     || pg_get_userbyid(c.relowner)
                FROM pg_class c WHERE c.oid = t.oid),
             (SELECT 'politicas=' || count(*) FROM pg_policy p WHERE p.polrelid = t.oid),
             (SELECT string_agg(tg.tgname || ':' || pn.nspname || '.' || pp.proname || ':' || tg.tgtype::text || ':' || tg.tgenabled::text,
                                ',' ORDER BY tg.tgname COLLATE "C")
                FROM pg_trigger tg JOIN pg_proc pp ON pp.oid = tg.tgfoid JOIN pg_namespace pn ON pn.oid = pp.pronamespace
               WHERE tg.tgrelid = t.oid AND NOT tg.tgisinternal))) END
      FROM tabelas t
    UNION ALL
    SELECT 'tabela.' || t.nome || '.acl',
           CASE WHEN t.oid IS NULL THEN 'ausente' ELSE
             (SELECT COALESCE(c.relacl::text, 'padrao') FROM pg_class c WHERE c.oid = t.oid)
             || ' colunas:' || COALESCE((SELECT string_agg(a.attname || '=' || a.attacl::text, ',' ORDER BY a.attname COLLATE "C")
                                           FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attacl IS NOT NULL), '-') END
      FROM tabelas t
    UNION ALL
    SELECT 'funcao.' || f.nome || '.corpo',
           COALESCE((SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = f.oid), 'ausente')
      FROM funcoes f
    UNION ALL
    SELECT 'funcao.' || f.nome || '.atributos',
           COALESCE((SELECT l.lanname || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || COALESCE(p.proconfig::text, '-')
                            || ':' || pg_get_userbyid(p.proowner) || ':' || pg_get_function_result(p.oid) || ':sobrecargas=' || f.versoes
                       FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = f.oid), 'ausente')
      FROM funcoes f
    UNION ALL
    SELECT 'funcao.' || f.nome || '.acl',
           COALESCE((SELECT COALESCE(p.proacl::text, 'padrao') FROM pg_proc p WHERE p.oid = f.oid), 'ausente')
      FROM funcoes f
    UNION ALL
    SELECT 'ledger.' || v.versao,
           CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = v.versao)
                THEN 'registrada' ELSE 'ausente' END
      FROM (VALUES ('20261141000000'), ('20261460000000'), ('20261470000000'), ('20261480000000'), ('20261490000000'),
                   ('20261570000000')) v(versao)
  ) d
 ORDER BY d.bloco COLLATE "C";
