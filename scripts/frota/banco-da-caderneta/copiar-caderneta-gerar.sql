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
--      (COPIA_ORIGEM_DIVERGENTE); se falta tabela no destino (COPIA_DESTINO_SEM_CADERNETA); trava as três tabelas contra
--      escrita (LOCK ... SHARE ROW EXCLUSIVE: duas cópias ao mesmo tempo, a segunda espera e recusa); recusa se a forma de
--      alguma tabela difere da origem (COPIA_FORMA_DIVERGENTE), se as portas não têm os corpos da 20261490/20261470
--      (COPIA_PORTAS_DIVERGENTES), se falta o gatilho (COPIA_GATILHO_AUSENTE) e, por último, se o destino já tem QUALQUER
--      linha nas três tabelas (COPIA_DESTINO_NAO_VAZIO: rodar duas vezes recusa, nada é sobrescrito);
--   2. liga a variável da porta (SET LOCAL ikcous.frota_estado_pela_porta) — sem ela o gatilho recusa a loja adormecida ou
--      encerrada — e grava: frota_segredo (id, hash, updated_at: o ATALHO hash_rapido/hash_rapido_de NÃO viaja, o destino
--      o grava sozinho na primeira chamada certa do porteiro), frota_lojas (todas as colunas, inclusive estado, estado_desde e
--      estado_sha) e frota_estado_historico (todas as colunas, com o id da origem: OVERRIDING SYSTEM VALUE);
--   3. ajusta a sequência do histórico ao último id entregue na origem (a próxima linha no destino nasce depois dele);
--   4. desliga a variável da porta e confere (POSVOO_COPIAR_CADERNETA): contagens, md5 do hash, atalho vazio, sequência.
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
colunas AS (
  SELECT v.tabela, array_agg(a.attname::text ORDER BY a.attnum) AS nomes
    FROM (VALUES ('frota_lojas'), ('frota_segredo'), ('frota_estado_historico')) v(tabela)
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
    FROM (VALUES ('frota_lojas'), ('frota_segredo'), ('frota_estado_historico')) v(tabela)
),
medidas AS (
  SELECT (SELECT count(*) FROM public.frota_lojas) AS n_lojas,
         (SELECT count(*) FROM public.frota_segredo) AS n_segredo,
         (SELECT count(*) FROM public.frota_estado_historico) AS n_historico,
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
  -- O destino: as três tabelas da caderneta.
  IF to_regclass('public.frota_lojas') IS NULL OR to_regclass('public.frota_segredo') IS NULL OR to_regclass('public.frota_estado_historico') IS NULL THEN
    RAISE EXCEPTION 'COPIA_DESTINO_SEM_CADERNETA: falta frota_lojas, frota_segredo ou frota_estado_historico — aplique as migrations da caderneta pelo canal antes; nada foi gravado.';
  END IF;
  -- Ninguém escreve nas três até o fim desta transação (outra cópia ao mesmo tempo espera aqui e depois recusa).
  LOCK TABLE public.frota_lojas, public.frota_segredo, public.frota_estado_historico IN SHARE ROW EXCLUSIVE MODE;
  FOR v_tabela, v_esperada IN
    SELECT x.t, x.f FROM (VALUES ('frota_lojas', v_forma_lojas), ('frota_segredo', v_forma_segredo), ('frota_estado_historico', v_forma_historico)) x(t, f)
  LOOP
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
       IS DISTINCT FROM '58d85afbab0acb79eef70d03c304fb80' THEN
    RAISE EXCEPTION 'COPIA_PORTAS_DIVERGENTES: resolver_loja, resolver_loja_com_estado, frota_mudar_estado ou a função do gatilho não têm os corpos da 20261490000000/20261470000000 — aplique-as pelo canal antes; nada foi gravado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.frota_lojas'::regclass AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal
                    AND t.tgfoid = to_regprocedure('public.frota_lojas_estado_so_pela_porta()')::oid AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'COPIA_GATILHO_AUSENTE: o gatilho frota_lojas_estado_so_pela_porta não está ligado em public.frota_lojas — aplique a 20261470000000 antes; nada foi gravado.';
  END IF;
  -- Por último: o destino vazio. Rodar duas vezes cai aqui (nada é sobrescrito nem duplicado).
  IF EXISTS (SELECT 1 FROM public.frota_lojas) OR EXISTS (SELECT 1 FROM public.frota_segredo) OR EXISTS (SELECT 1 FROM public.frota_estado_historico) THEN
    RAISE EXCEPTION 'COPIA_DESTINO_NAO_VAZIO: o destino já tem linha em frota_lojas, frota_segredo ou frota_estado_historico — a cópia só entra em caderneta vazia; nada foi gravado.';
  END IF;
END $preflight_copiar_caderneta$;

-- Sem esta variável o gatilho recusa gravar loja adormecida ou encerrada (ela vale só até o fim da transação).
SET LOCAL ikcous.frota_estado_pela_porta = 'sim';

$m$
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_segredo'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_lojas'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_estado_historico'), '')
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
  || '  v_md5_hash text := ' || quote_nullable(m.md5_hash) || E';\n'
  || '  v_sequencia bigint := ' || CASE WHEN m.sequencia > 0 THEN m.sequencia::text ELSE 'NULL' END || E';\n'
  || $m$BEGIN
  IF (SELECT count(*) FROM public.frota_lojas) <> v_lojas OR (SELECT count(*) FROM public.frota_segredo) <> 1
     OR (SELECT count(*) FROM public.frota_estado_historico) <> v_historico THEN
    RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA: as contagens do destino não batem com a origem (% lojas, 1 segredo, % linhas de histórico).', v_lojas, v_historico;
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
       (SELECT f.forma FROM formas f WHERE f.tabela = 'frota_estado_historico') f_historico;
