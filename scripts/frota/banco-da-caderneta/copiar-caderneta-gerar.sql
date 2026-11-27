-- ============================================================================
-- Gerador da cópia da caderneta da frota (26/11/2026) — roda na ORIGEM, SÓ LEITURA, um SELECT
-- NÃO É MIGRATION. Pelo MCP, com execute_sql (nunca apply_migration), no banco de onde a caderneta SAI (o de IKCOUS_FROTA_URL).
-- Roteiro: docs/runbooks/caderneta-muda-de-banco.md.
-- ============================================================================
--
-- O QUE DEVOLVE: UMA linha, UMA coluna (`script`): o texto que roda no banco de DESTINO, com "begin;" antes e "commit;" depois,
-- na mesma chamada do execute_sql. Antes de rodar no destino, o texto vai para a revisão (Opus).
--
-- O QUE O TEXTO GERADO FAZ NO DESTINO, nesta ordem (tudo ou nada: a transação é de quem executa):
--   1. pré-voo, sem escrever: recusa se a ORIGEM estava vazia (COPIA_ORIGEM_VAZIA) ou fora dos corpos da 20261490
--      (COPIA_ORIGEM_DIVERGENTE); se falta tabela no destino (COPIA_DESTINO_SEM_CADERNETA); trava as quatro tabelas contra
--      escrita (LOCK ... SHARE ROW EXCLUSIVE: duas cópias ao mesmo tempo, a segunda espera e recusa); recusa se a forma de
--      alguma tabela difere da origem (COPIA_FORMA_DIVERGENTE), se as portas não têm os corpos da 20261490/20261470/20261570
--      (COPIA_PORTAS_DIVERGENTES), se falta um dos dois gatilhos (COPIA_GATILHO_AUSENTE) e, por último, se o destino já tem
--      QUALQUER linha nas quatro tabelas (COPIA_DESTINO_NAO_VAZIO: rodar duas vezes recusa, nada é sobrescrito);
--   2. liga a variável da porta (SET LOCAL ikcous.frota_estado_pela_porta) — sem ela o gatilho recusa a loja adormecida ou
--      encerrada — e grava: frota_segredo (id, hash, updated_at: o ATALHO hash_rapido/hash_rapido_de NÃO viaja, o destino
--      o grava sozinho na primeira chamada certa do porteiro), frota_lojas (todas as colunas, inclusive estado, estado_desde e
--      estado_sha), frota_estado_historico (todas as colunas, com o id da origem: OVERRIDING SYSTEM VALUE) e, por último,
--      frota_enderecos_que_encaminham (todas as colunas, inclusive quem e criado_em da origem; depois das lojas porque a chave
--      estrangeira e o gatilho que recusa um endereço principal olham frota_lojas);
--   3. ajusta a sequência do histórico ao último id entregue na origem (a próxima linha no destino nasce depois dele);
--   4. desliga a variável da porta e confere (POSVOO_COPIAR_CADERNETA): contagens, md5 do hash, atalho vazio, sequência.
--
-- A 20261570000000 é exigida SÓ no DESTINO (a tabela dos endereços, o gatilho dela e as duas portas: COPIA_DESTINO_SEM_CADERNETA,
-- COPIA_PORTAS_DIVERGENTES, COPIA_GATILHO_AUSENTE). Na ORIGEM, sem frota_enderecos_que_encaminham, tabela ausente = zero
-- endereços: o texto não grava endereço, o pós-voo confere 0 no destino e a forma da tabela dos endereços não é comparada (não
-- há forma na origem nem linha para gravar). Com a tabela na origem, tudo como antes: forma comparada e linhas copiadas.
--
-- DADO SENSÍVEL: o texto gerado carrega o hash bcrypt da IKCOUS_FROTA_CHAVE (irreversível; a chave em si nunca passa). Ele só
-- transita pela saída do MCP: não colar em conversa, bastão, arquivo nem commit.
--
-- NÃO DEPENDE DO BANCO: as colunas saem do catálogo (todas, na ordem delas; o INSERT as nomeia); cada valor vai como literal
-- citado (format %L) a partir do texto do to_jsonb, que leva o fuso junto (o instante não muda com o TimeZone do destino);
-- linhas em ordem de chave com a colação "C".
--
-- Sem BEGIN/COMMIT aqui nem no texto gerado. Prova viva: tests/banco/a-caderneta-muda-de-banco-viva.cjs (rpc-ci.yml).
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
colunas AS (
  SELECT v.tabela, array_agg(a.attname::text ORDER BY a.attnum) AS nomes
    FROM (VALUES ('frota_lojas'), ('frota_segredo'), ('frota_estado_historico'), ('frota_enderecos_que_encaminham')) v(tabela)
    JOIN pg_attribute a ON a.attrelid = to_regclass('public.' || v.tabela) AND a.attnum > 0 AND NOT a.attisdropped
   WHERE NOT (v.tabela = 'frota_segredo' AND a.attname IN ('hash_rapido', 'hash_rapido_de'))
   GROUP BY v.tabela
),
linhas AS (
  SELECT 'frota_lojas'::text AS tabela, fl.id::text AS chave, to_jsonb(fl) AS j FROM public.frota_lojas fl
  UNION ALL
  SELECT 'frota_segredo', fs.id::text, to_jsonb(fs) FROM public.frota_segredo fs
  UNION ALL
  SELECT 'frota_estado_historico', lpad(h.id::text, 20, '0'), to_jsonb(h) FROM public.frota_estado_historico h
  UNION ALL
  SELECT 'frota_enderecos_que_encaminham', e.j ->> 'host', e.j FROM enderecos_da_origem e
),
tuplas AS (
  SELECT l.tabela, l.chave,
         '(' || (SELECT string_agg(format('%L', l.j ->> n.nome), ', ' ORDER BY n.ordem)
                   FROM unnest(c.nomes) WITH ORDINALITY AS n(nome, ordem)) || ')' AS tupla
    FROM linhas l JOIN colunas c ON c.tabela = l.tabela
),
insercoes AS (
  SELECT c.tabela,
         'INSERT INTO public.' || c.tabela || ' ('
           || (SELECT string_agg(quote_ident(n.nome), ', ' ORDER BY n.ordem) FROM unnest(c.nomes) WITH ORDINALITY AS n(nome, ordem))
           || ')' || CASE WHEN c.tabela = 'frota_estado_historico' THEN ' OVERRIDING SYSTEM VALUE' ELSE '' END || E'\nVALUES\n'
           || (SELECT string_agg('  ' || t.tupla, E',\n' ORDER BY t.chave COLLATE "C") FROM tuplas t WHERE t.tabela = c.tabela)
           || E';\n\n' AS sql
    FROM colunas c
),
formas AS (
  SELECT v.tabela,
         (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                            || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'),
                            ',' ORDER BY a.attname COLLATE "C")
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
           WHERE a.attrelid = to_regclass('public.' || v.tabela) AND a.attnum > 0 AND NOT a.attisdropped) AS forma
    FROM (VALUES ('frota_lojas'), ('frota_segredo'), ('frota_estado_historico'), ('frota_enderecos_que_encaminham')) v(tabela)
),
medidas AS (
  SELECT (SELECT count(*) FROM public.frota_lojas) AS n_lojas,
         (SELECT count(*) FROM public.frota_segredo) AS n_segredo,
         (SELECT count(*) FROM public.frota_estado_historico) AS n_historico,
         (SELECT count(*) FROM enderecos_da_origem) AS n_enderecos,
         to_regclass('public.frota_enderecos_que_encaminham') IS NOT NULL AS tem_enderecos,
         (SELECT md5(fs.hash) FROM public.frota_segredo fs WHERE fs.id = 1) AS md5_hash,
         -- O último id entregue: o maior entre o maior id copiado e o que a sequência já deu (id queimado por transação desfeita).
         GREATEST((SELECT COALESCE(max(h.id), 0) FROM public.frota_estado_historico h),
                  COALESCE((SELECT s.last_value FROM pg_sequences s
                             WHERE s.schemaname = 'public' AND s.sequencename = 'frota_estado_historico_id_seq'), 0)) AS sequencia,
         (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja(text, text)')) AS md5_v1,
         (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
           WHERE p.oid = to_regprocedure('public.resolver_loja_com_estado(text, text)')) AS md5_v2
)
SELECT
     $m$-- ============================================================================
-- Cópia da caderneta da frota — texto GERADO por scripts/frota/banco-da-caderneta/copiar-caderneta-gerar.sql.
-- Rodar SÓ no banco de DESTINO, pelo execute_sql, com "begin;" antes e "commit;" depois, na mesma chamada
-- (roteiro: docs/runbooks/caderneta-muda-de-banco.md). Leva o hash bcrypt da chave da frota (nunca a chave, nunca o atalho):
-- não colar em conversa, bastão, arquivo nem commit.
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_copiar_caderneta$
DECLARE
$m$
  || '  v_origem_lojas bigint := ' || m.n_lojas || E';\n'
  || '  v_origem_segredo bigint := ' || m.n_segredo || E';\n'
  || '  v_origem_md5_v1 text := ' || quote_nullable(m.md5_v1) || E';\n'
  || '  v_origem_md5_v2 text := ' || quote_nullable(m.md5_v2) || E';\n'
  || '  v_forma_lojas text := ' || quote_nullable(f_lojas.forma) || E';\n'
  || '  v_forma_segredo text := ' || quote_nullable(f_segredo.forma) || E';\n'
  || '  v_forma_historico text := ' || quote_nullable(f_historico.forma) || E';\n'
  || '  v_forma_enderecos text := ' || quote_nullable(f_enderecos.forma) || E';\n'
  || '  v_origem_tem_enderecos boolean := ' || m.tem_enderecos || E';\n'
  || $m$  v_tabela text;
  v_esperada text;
BEGIN
  -- A origem: o banco certo (com a caderneta semeada) e com os corpos da 20261490 (o gerador rodou no banco errado?).
  IF v_origem_segredo <> 1 OR v_origem_lojas < 1 THEN
    RAISE EXCEPTION 'COPIA_ORIGEM_VAZIA: a origem tinha % segredo(s) e % loja(s) — o gerador rodou num banco sem a caderneta semeada; nada foi gravado.', v_origem_segredo, v_origem_lojas;
  END IF;
  IF v_origem_md5_v1 IS DISTINCT FROM '0c60eb13c0016d2129b51def3ec7c255' OR v_origem_md5_v2 IS DISTINCT FROM 'a30e752cff5ae4edc2db612866eb8bcd' THEN
    RAISE EXCEPTION 'COPIA_ORIGEM_DIVERGENTE: as portas da origem não tinham os corpos da 20261490000000 — meça a origem com a impressão digital; nada foi gravado.';
  END IF;
  -- O destino: as quatro tabelas da caderneta.
  IF to_regclass('public.frota_lojas') IS NULL OR to_regclass('public.frota_segredo') IS NULL OR to_regclass('public.frota_estado_historico') IS NULL
     OR to_regclass('public.frota_enderecos_que_encaminham') IS NULL THEN
    RAISE EXCEPTION 'COPIA_DESTINO_SEM_CADERNETA: falta frota_lojas, frota_segredo, frota_estado_historico ou frota_enderecos_que_encaminham — aplique as migrations da caderneta (até a 20261570000000) pelo canal antes; nada foi gravado.';
  END IF;
  -- Ninguém escreve nas quatro até o fim desta transação (outra cópia ao mesmo tempo espera aqui e depois recusa).
  LOCK TABLE public.frota_lojas, public.frota_segredo, public.frota_estado_historico, public.frota_enderecos_que_encaminham IN SHARE ROW EXCLUSIVE MODE;
  FOR v_tabela, v_esperada IN
    SELECT x.t, x.f FROM (VALUES ('frota_lojas', v_forma_lojas), ('frota_segredo', v_forma_segredo), ('frota_estado_historico', v_forma_historico),
                                 ('frota_enderecos_que_encaminham', v_forma_enderecos)) x(t, f)
  LOOP
    -- A origem sem a 20261570 (tabela ausente = zero endereços): não há forma para comparar nem linha para gravar. A tabela, o
    -- gatilho e as portas da 20261570 no destino continuam exigidos (acima e abaixo).
    CONTINUE WHEN v_tabela = 'frota_enderecos_que_encaminham' AND NOT v_origem_tem_enderecos;
    IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                          || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'),
                          ',' ORDER BY a.attname COLLATE "C")
          FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = to_regclass('public.' || v_tabela) AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM v_esperada THEN
      RAISE EXCEPTION 'COPIA_FORMA_DIVERGENTE: public.% não tem a mesma forma da origem (colunas, tipos, NOT NULL, identidade ou padrão) — aplique as migrations da caderneta antes; nada foi gravado.', v_tabela;
    END IF;
  END LOOP;
  IF (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja(text, text)'))
       IS DISTINCT FROM '0c60eb13c0016d2129b51def3ec7c255'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_loja_com_estado(text, text)'))
       IS DISTINCT FROM 'a30e752cff5ae4edc2db612866eb8bcd'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)'))
       IS DISTINCT FROM 'd1dd1ae579be7a6f5c8687ea039cb3b8'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.frota_lojas_estado_so_pela_porta()'))
       IS DISTINCT FROM '58d85afbab0acb79eef70d03c304fb80'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.frota_enderecos_que_encaminham_nao_e_principal()'))
       IS DISTINCT FROM '874d5af8ef1504daa9e602d6f991353a'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.resolver_encaminhamento(text, text)'))
       IS DISTINCT FROM '5ca45d858b56991facb8d2052f0aecfb'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.frota_trocar_dominio(text, text, text, text, text, timestamptz)'))
       IS DISTINCT FROM '5758ff83113e042fc927d83c254291bd' THEN
    RAISE EXCEPTION 'COPIA_PORTAS_DIVERGENTES: resolver_loja, resolver_loja_com_estado, frota_mudar_estado, a função do gatilho do estado, a do gatilho dos endereços, resolver_encaminhamento ou frota_trocar_dominio não têm os corpos da 20261490000000/20261470000000/20261570000000 — aplique-as pelo canal antes; nada foi gravado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.frota_lojas'::regclass AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal
                    AND t.tgfoid = to_regprocedure('public.frota_lojas_estado_so_pela_porta()')::oid AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'COPIA_GATILHO_AUSENTE: o gatilho frota_lojas_estado_so_pela_porta não está ligado em public.frota_lojas — aplique a 20261470000000 antes; nada foi gravado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.frota_enderecos_que_encaminham'::regclass
                    AND t.tgname = 'frota_enderecos_que_encaminham_nao_e_principal' AND NOT t.tgisinternal
                    AND t.tgfoid = to_regprocedure('public.frota_enderecos_que_encaminham_nao_e_principal()')::oid AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'COPIA_GATILHO_AUSENTE: o gatilho frota_enderecos_que_encaminham_nao_e_principal não está ligado em public.frota_enderecos_que_encaminham — aplique a 20261570000000 antes; nada foi gravado.';
  END IF;
  -- Por último: o destino vazio. Rodar duas vezes cai aqui (nada é sobrescrito nem duplicado).
  IF EXISTS (SELECT 1 FROM public.frota_lojas) OR EXISTS (SELECT 1 FROM public.frota_segredo) OR EXISTS (SELECT 1 FROM public.frota_estado_historico)
     OR EXISTS (SELECT 1 FROM public.frota_enderecos_que_encaminham) THEN
    RAISE EXCEPTION 'COPIA_DESTINO_NAO_VAZIO: o destino já tem linha em frota_lojas, frota_segredo, frota_estado_historico ou frota_enderecos_que_encaminham — a cópia só entra em caderneta vazia; nada foi gravado.';
  END IF;
END $preflight_copiar_caderneta$;

-- Sem esta variável o gatilho recusa gravar loja adormecida ou encerrada (ela vale só até o fim da transação).
SET LOCAL ikcous.frota_estado_pela_porta = 'sim';

$m$
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_segredo'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_lojas'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_estado_historico'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_enderecos_que_encaminham'), '')
  || $m$-- A próxima linha de histórico no destino nasce depois do último id entregue na origem.
SELECT setval(pg_get_serial_sequence('public.frota_estado_historico', 'id'), $m$
  || CASE WHEN m.sequencia > 0 THEN m.sequencia || ', true' ELSE '1, false' END
  || $m$);

SET LOCAL ikcous.frota_estado_pela_porta = '';

DO $posvoo_copiar_caderneta$
DECLARE
$m$
  || '  v_lojas bigint := ' || m.n_lojas || E';\n'
  || '  v_historico bigint := ' || m.n_historico || E';\n'
  || '  v_enderecos bigint := ' || m.n_enderecos || E';\n'
  || '  v_md5_hash text := ' || quote_nullable(m.md5_hash) || E';\n'
  || '  v_sequencia bigint := ' || CASE WHEN m.sequencia > 0 THEN m.sequencia::text ELSE 'NULL' END || E';\n'
  || $m$BEGIN
  IF (SELECT count(*) FROM public.frota_lojas) <> v_lojas OR (SELECT count(*) FROM public.frota_segredo) <> 1
     OR (SELECT count(*) FROM public.frota_estado_historico) <> v_historico
     OR (SELECT count(*) FROM public.frota_enderecos_que_encaminham) <> v_enderecos THEN
    RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA: as contagens do destino não batem com a origem (% lojas, 1 segredo, % linhas de histórico, % endereços que encaminham).', v_lojas, v_historico, v_enderecos;
  END IF;
  IF (SELECT md5(fs.hash) FROM public.frota_segredo fs WHERE fs.id = 1) IS DISTINCT FROM v_md5_hash THEN
    RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA: o hash da chave no destino não é o da origem.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.frota_segredo fs WHERE fs.hash_rapido IS NOT NULL OR fs.hash_rapido_de IS NOT NULL) THEN
    RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA: o atalho da chave (hash_rapido) veio junto — ele não viaja; o destino o grava sozinho.';
  END IF;
  IF (SELECT s.last_value FROM pg_sequences s WHERE s.schemaname = 'public' AND s.sequencename = 'frota_estado_historico_id_seq')
     IS DISTINCT FROM v_sequencia THEN
    RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA: a sequência do histórico não ficou no último id entregue na origem (%).', COALESCE(v_sequencia::text, 'nenhum');
  END IF;
  IF COALESCE(current_setting('ikcous.frota_estado_pela_porta', true), '') <> '' THEN
    RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA: a variável da porta ficou ligada.';
  END IF;
END $posvoo_copiar_caderneta$;
$m$ AS script
  FROM medidas m,
       (SELECT f.forma FROM formas f WHERE f.tabela = 'frota_lojas') f_lojas,
       (SELECT f.forma FROM formas f WHERE f.tabela = 'frota_segredo') f_segredo,
       (SELECT f.forma FROM formas f WHERE f.tabela = 'frota_estado_historico') f_historico,
       (SELECT f.forma FROM formas f WHERE f.tabela = 'frota_enderecos_que_encaminham') f_enderecos;
