-- IMPRESSAO DIGITAL NO LIMITE DE CADA DDL — usada por
-- .github/workflows/aplicar-migrations.yml (migration E rollback-manual).
--
-- O QUE E: cada arquivo aplicado vira UMA transacao
--   BEGIN ISOLATION LEVEL REPEATABLE READ;
--   <secao abrir>   impressao digital ANTES  (no snapshot da transacao)
--   <o corpo do arquivo>
--   <secao fechar>  impressao digital DEPOIS (no MESMO snapshot) + comparacao
--   COMMIT;
-- Se a impressao digital divergir, o RAISE EXCEPTION da secao `fechar` acontece
-- ANTES do COMMIT: a transacao inteira volta e nada fica gravado. Checagem so e
-- controle onde ainda da para recusar.
--
-- POR QUE REPEATABLE READ: o cron (*/10) e o webhook mudam pedidos de forma
-- legitima enquanto o workflow roda; comparar duas leituras de conexoes
-- diferentes acusaria (ou esconderia) mudanca que nao e da migration. Dentro de
-- um snapshot so, escrita concorrente nao entra na comparacao — qualquer
-- diferenca so pode vir do corpo do proprio arquivo (um UPDATE/INSERT/DELETE,
-- um DEFAULT que reescreve linha existente, um DROP COLUMN).
--
-- O QUE E MEDIDO, por tabela (as que as funcoes dessas migrations escrevem):
--   * count(*) e md5 do string_agg dos md5 de cada linha (to_jsonb), ordenado
--     pela PK — SO das colunas que existiam ANTES. Coluna nova (ADD COLUMN
--     nullable da 92 e da 96) muda o to_jsonb sem alterar dado; por isso sai da
--     conta e e conferida a parte:
--   * para cada coluna nova, quantas linhas JA EXISTENTES tem valor NAO nulo
--     nela — tem de ser 0 (um ADD COLUMN ... DEFAULT <nao nulo> ou um backfill
--     cai aqui; o `SET DEFAULT true` da 201 nao altera linha existente e passa).
--   * coluna que existia ANTES e sumiu (DROP COLUMN) recusa — com dado ou sem
--     dado: perda de coluna nunca passa calada nem quebra o calculo.
--   * tabela publica que existia ANTES e sumiu (DROP TABLE) recusa, e a mensagem
--     diz se ela tinha linhas. Vale para TODA tabela de public, nao so as 11.
--   * DEFAULT novo/alterado em coluna que ja existia: nao altera linha, entao nao
--     recusa — mas e LISTADO (coluna defaults_alterados da saida). Em coluna nova,
--     o DEFAULT cai na regua da coluna nova (linha existente com valor = recusa).
--   * TABELA nova: nao entra na comparacao (nao existia ANTES), mas e LISTADA na
--     saida (resultado = tabela_nova, com a contagem de linhas que nasceu).
--   Tabela ausente ou sem PK nas 11 recusa (falha fechado: nao mede = nao libera).
--
-- SAIDA: so contagens e hashes; nenhum conteudo de linha. A ultima consulta
-- antes do COMMIT devolve uma linha por tabela (linhas/md5 antes e depois, as
-- colunas novas); o workflow imprime como FP_ANTES / FP_DEPOIS. A secao `fresca`
-- e uma leitura FORA do snapshot, depois do COMMIT: mostra o que o cron/webhook
-- mudaram enquanto isso (informativo, nao e falha).
--
-- ESTADO ENTRE AS DUAS MEDIDAS: set_config(..., true) — variavel local da
-- transacao (some no COMMIT/ROLLBACK). Nenhum objeto e criado no banco.
--
-- A secao gate e o GATE DE TRANSPORTE (so leitura): uma unica requisicao
-- BEGIN ... REPEATABLE READ READ ONLY; sonda; sleep; sonda; COMMIT; que o
-- workflow roda ANTES de tudo e so libera o envelope se a API se comportar como
-- uma transacao unica de sessao (mesmo backend, now() igual, relogio avancando).
-- Os marcadores de secao (as quatro linhas abaixo que comecam por dois hifens,
-- um espaco, dois arrobas e a palavra SECAO) sao lidos pelo workflow: nao
-- renomear sem atualizar o workflow e tests/ci_aplicar_migrations_test.ts. A
-- lista de tabelas aparece nas secoes abrir e fresca (o teste exige que sejam
-- iguais).

-- @@SECAO abrir
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $fp_antes$
DECLARE
  v_tabelas text[] := ARRAY[
    'marketplace_orders', 'marketplace_order_items', 'marketplace_order_history',
    'marketplace_order_payment_history', 'order_refunds', 'devolucoes',
    'devolucao_itens', 'fin_lancamentos', 'fin_caixa_sessoes', 'produtos',
    'product_variants'
  ];
  v_t text;
  v_oid oid;
  v_cols text[];
  v_ordem text;
  v_n bigint;
  v_h text;
  v_fp jsonb := '{}'::jsonb;
  v_pub jsonb := '{}'::jsonb;
  v_tem boolean;
  v_defaults jsonb;
BEGIN
  -- Toda tabela de public que existe ANTES (e se tem linha): so para recusar
  -- DROP TABLE depois. Nao entra na comparacao de conteudo.
  FOR v_t IN
    SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_t) INTO v_tem;
    v_pub := v_pub || jsonb_build_object(v_t, v_tem);
  END LOOP;
  FOREACH v_t IN ARRAY v_tabelas LOOP
    v_oid := to_regclass(format('public.%I', v_t));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FP_TABELA_AUSENTE: public.% nao existe — impressao digital impossivel, nada foi aplicado.', v_t;
    END IF;
    SELECT array_agg(attname::text ORDER BY attnum) INTO v_cols
      FROM pg_attribute
     WHERE attrelid = v_oid AND attnum > 0 AND NOT attisdropped;
    SELECT string_agg(format('t.%I', a.attname), ', ' ORDER BY k.ord) INTO v_ordem
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = v_oid AND i.indisprimary;
    IF v_ordem IS NULL THEN
      RAISE EXCEPTION 'FP_SEM_PK: public.% nao tem chave primaria — impressao digital impossivel, nada foi aplicado.', v_t;
    END IF;
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(md5((to_jsonb(t) - $1)::text), %L ORDER BY %s), %L)) FROM public.%I t',
      '', v_ordem, '', v_t)
      INTO v_n, v_h USING ARRAY[]::text[];
    SELECT coalesce(jsonb_object_agg(a.attname, pg_get_expr(d.adbin, d.adrelid)), '{}'::jsonb) INTO v_defaults
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = v_oid AND NOT a.attisdropped;
    v_fp := v_fp || jsonb_build_object(v_t, jsonb_build_object('n', v_n, 'h', v_h, 'cols', to_jsonb(v_cols), 'defaults', v_defaults));
  END LOOP;
  PERFORM set_config('ikcous.fp_antes', v_fp::text, true);
  PERFORM set_config('ikcous.fp_antes_tabelas', v_pub::text, true);
END
$fp_antes$;

-- @@SECAO fechar
DO $fp_depois$
DECLARE
  v_antes jsonb := nullif(current_setting('ikcous.fp_antes', true), '')::jsonb;
  v_t text;
  v_oid oid;
  v_cols text[];
  v_novas text[];
  v_sumiram text[];
  v_c text;
  v_ordem text;
  v_n bigint;
  v_h text;
  v_nao_nulos bigint;
  v_fp jsonb := '{}'::jsonb;
  v_diverg text := '';
  v_pub_antes jsonb := nullif(current_setting('ikcous.fp_antes_tabelas', true), '')::jsonb;
  v_novas_tabelas jsonb := '{}'::jsonb;
  v_defaults_antes jsonb;
  v_defaults_agora jsonb;
  v_defaults_txt text;
  v_k text;
BEGIN
  IF v_antes IS NULL OR v_pub_antes IS NULL THEN
    RAISE EXCEPTION 'FP_SEM_ANTES: a impressao digital de ANTES nao esta na transacao — o envelope foi montado sem a secao abrir.';
  END IF;
  -- DROP TABLE de qualquer tabela de public: recusa. Tabela nova: so lista.
  FOR v_t IN SELECT k FROM jsonb_object_keys(v_pub_antes) AS k ORDER BY 1 LOOP
    IF to_regclass(format('public.%I', v_t)) IS NULL THEN
      v_diverg := v_diverg || format(' [tabela %s removida%s]', v_t,
        CASE WHEN (v_pub_antes ->> v_t)::boolean THEN ' (TINHA LINHAS: perda de dado)' ELSE ' (estava vazia)' END);
    END IF;
  END LOOP;
  FOR v_t IN
    SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1
  LOOP
    IF NOT (v_pub_antes ? v_t) THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
      v_novas_tabelas := v_novas_tabelas || jsonb_build_object(v_t, v_n);
    END IF;
  END LOOP;
  FOR v_t IN SELECT k FROM jsonb_object_keys(v_antes) AS k ORDER BY 1 LOOP
    v_oid := to_regclass(format('public.%I', v_t));
    IF v_oid IS NULL THEN
      v_diverg := v_diverg || format(' [%s: a tabela deixou de existir]', v_t);
      CONTINUE;
    END IF;
    SELECT array_agg(attname::text ORDER BY attnum) INTO v_cols
      FROM pg_attribute
     WHERE attrelid = v_oid AND attnum > 0 AND NOT attisdropped;
    v_novas := ARRAY(SELECT c FROM unnest(v_cols) AS c WHERE NOT ((v_antes -> v_t -> 'cols') ? c));
    v_sumiram := ARRAY(SELECT c FROM jsonb_array_elements_text(v_antes -> v_t -> 'cols') AS c WHERE NOT (c = ANY (v_cols)));
    IF cardinality(v_sumiram) > 0 THEN
      v_diverg := v_diverg || format(' [%s: coluna(s) removida(s): %s]', v_t, array_to_string(v_sumiram, ','));
      CONTINUE;
    END IF;
    SELECT string_agg(format('t.%I', a.attname), ', ' ORDER BY k.ord) INTO v_ordem
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = v_oid AND i.indisprimary;
    IF v_ordem IS NULL THEN
      v_diverg := v_diverg || format(' [%s: perdeu a chave primaria]', v_t);
      CONTINUE;
    END IF;
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(md5((to_jsonb(t) - $1)::text), %L ORDER BY %s), %L)) FROM public.%I t',
      '', v_ordem, '', v_t)
      INTO v_n, v_h USING v_novas;
    IF v_n IS DISTINCT FROM (v_antes -> v_t ->> 'n')::bigint
       OR v_h IS DISTINCT FROM (v_antes -> v_t ->> 'h') THEN
      v_diverg := v_diverg || format(' [%s: linhas %s -> %s, md5 %s -> %s]',
        v_t, v_antes -> v_t ->> 'n', v_n, v_antes -> v_t ->> 'h', v_h);
    END IF;
    FOREACH v_c IN ARRAY v_novas LOOP
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.%I IS NOT NULL', v_t, v_c) INTO v_nao_nulos;
      IF v_nao_nulos > 0 THEN
        v_diverg := v_diverg || format(' [%s.%s: coluna nova com valor nao nulo em %s linha(s) que ja existiam]', v_t, v_c, v_nao_nulos);
      END IF;
    END LOOP;
    -- DEFAULT alterado em coluna que ja existia: nao muda linha; so listado.
    v_defaults_antes := v_antes -> v_t -> 'defaults';
    SELECT coalesce(jsonb_object_agg(a.attname, pg_get_expr(d.adbin, d.adrelid)), '{}'::jsonb) INTO v_defaults_agora
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = v_oid AND NOT a.attisdropped;
    v_defaults_txt := '';
    FOR v_k IN SELECT k FROM (SELECT jsonb_object_keys(v_defaults_antes) AS k UNION SELECT jsonb_object_keys(v_defaults_agora)) u ORDER BY 1 LOOP
      IF NOT (v_k = ANY (v_novas)) AND (v_defaults_antes -> v_k) IS DISTINCT FROM (v_defaults_agora -> v_k) THEN
        v_defaults_txt := v_defaults_txt || format('%s%s: %s -> %s', CASE WHEN v_defaults_txt = '' THEN '' ELSE '; ' END,
          v_k, coalesce(v_defaults_antes ->> v_k, 'sem default'), coalesce(v_defaults_agora ->> v_k, 'sem default'));
      END IF;
    END LOOP;
    v_fp := v_fp || jsonb_build_object(v_t, jsonb_build_object('n', v_n, 'h', v_h, 'novas', to_jsonb(v_novas), 'defaults', v_defaults_txt));
  END LOOP;
  IF v_diverg <> '' THEN
    RAISE EXCEPTION 'FP_DIVERGIU: a impressao digital de DEPOIS nao e a de ANTES no mesmo snapshot — o arquivo alterou dado existente. A transacao inteira volta, nada foi gravado.%', v_diverg;
  END IF;
  PERFORM set_config('ikcous.fp_depois', v_fp::text, true);
  PERFORM set_config('ikcous.fp_tabelas_novas', v_novas_tabelas::text, true);
END
$fp_depois$;
SELECT a.key AS tabela,
       (a.value ->> 'n')::bigint AS linhas_antes,
       a.value ->> 'h' AS md5_antes,
       (d.value ->> 'n')::bigint AS linhas_depois,
       d.value ->> 'h' AS md5_depois,
       coalesce(nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(d.value -> 'novas')), ','), ''), '-') AS colunas_novas,
       coalesce(nullif(d.value ->> 'defaults', ''), '-') AS defaults_alterados,
       'igual'::text AS resultado
  FROM jsonb_each(current_setting('ikcous.fp_antes')::jsonb) AS a
  JOIN jsonb_each(current_setting('ikcous.fp_depois')::jsonb) AS d ON d.key = a.key
UNION ALL
SELECT n.key, NULL, NULL, n.value::text::bigint, NULL, '-', '-', 'tabela_nova'
  FROM jsonb_each(current_setting('ikcous.fp_tabelas_novas')::jsonb) AS n
 ORDER BY 1;
COMMIT;

-- @@SECAO fresca
SELECT t.tabela,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t.tabela), false, true, '')))[1]::text::bigint AS linhas_agora
  FROM unnest(ARRAY[
    'marketplace_orders', 'marketplace_order_items', 'marketplace_order_history',
    'marketplace_order_payment_history', 'order_refunds', 'devolucoes',
    'devolucao_itens', 'fin_lancamentos', 'fin_caixa_sessoes', 'produtos',
    'product_variants'
  ]) AS t(tabela)
 ORDER BY t.tabela;

-- @@SECAO gate
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT set_config('ikcous.sonda1', json_build_object(
  'isolamento', current_setting('transaction_isolation'),
  'somente_leitura', current_setting('transaction_read_only'),
  'pid', pg_backend_pid(),
  'agora', now()::text,
  'relogio', extract(epoch FROM clock_timestamp()))::text, true);
SELECT pg_sleep(0.2);
SELECT current_setting('ikcous.sonda1') AS sonda1,
       json_build_object(
         'isolamento', current_setting('transaction_isolation'),
         'somente_leitura', current_setting('transaction_read_only'),
         'pid', pg_backend_pid(),
         'agora', now()::text,
         'relogio', extract(epoch FROM clock_timestamp()))::text AS sonda2;
COMMIT;
