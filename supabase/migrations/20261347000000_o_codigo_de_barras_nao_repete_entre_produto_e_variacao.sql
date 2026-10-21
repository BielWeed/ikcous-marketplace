-- ============================================================================
-- Migration 20261347000000 - o codigo de barras nao repete entre produto e variacao
-- ============================================================================
--
-- O DEFEITO: o codigo de barras de `produtos` e o de `product_variants` so sao
-- unicos DENTRO de cada tabela (dois indices unicos parciais, um por tabela,
-- 20261160000000). O mesmo codigo pode estar num produto e na variacao de outro
-- (inclusive numa variacao desligada). No balcao, quem bipa acha a variacao
-- primeiro (regra de precedencia da RPC buscar_por_codigo_barras, 20261161000000)
-- e o produto dono do mesmo codigo nunca mais e' vendido pelo leitor: o operador
-- ve o item errado. A checagem de duplicidade do formulario do produto roda no
-- navegador (RPC buscar_por_codigo_barras) e e' so aviso: sem rede, nao checa.
--
-- O QUE ESTA MIGRATION FAZ (ADITIVA; nenhuma linha existente e lida para ser
-- alterada, reescrita ou apagada):
--   1. Duas funcoes de gatilho NOVAS, SECURITY DEFINER com search_path fixo
--      (pg_catalog, pg_temp; tudo de `public` vai qualificado):
--        public.produto_codigo_barras_livre_de_variacao()
--        public.variacao_codigo_barras_livre_de_produto()
--      EXECUTE fechado para PUBLIC, anon, authenticated e service_role (gatilho
--      nao precisa de EXECUTE para disparar).
--   2. Dois gatilhos NOVOS, BEFORE INSERT OR UPDATE OF codigo_barras, por linha:
--        tr_produto_codigo_barras_livre_de_variacao   ON public.produtos
--        tr_variacao_codigo_barras_livre_de_produto   ON public.product_variants
--      Cada um pega pg_advisory_xact_lock(hashtextextended('codigo_de_barras:'
--      || codigo, 0)) e, se o MESMO codigo ja existe na OUTRA tabela, recusa com
--      ERRCODE 23505 e a frase "Este codigo de barras ja esta em uso por outro
--      produto ou variacao." A trava e' a mesma para as duas tabelas (mesma
--      chave), entao dois cadastros simultaneos do mesmo codigo, um em cada
--      tabela, nao passam os dois: o segundo espera o primeiro terminar e
--      ENXERGA o que ele gravou (READ COMMITTED, o padrao do PostgREST).
--
-- COMO O CODIGO E' COMPARADO: IGUALDADE EXATA, sem normalizar. E' o que os dois
-- indices unicos atuais fazem e o que a RPC do balcao faz (ela so apara a
-- ENTRADA do bipe com btrim de espaco, TAB, CR e LF e compara `=` com o valor
-- gravado; o formulario ja grava o codigo aparado e sem espaco interno). Duas
-- gravacoes colidem no balcao se e somente se forem IGUAIS, e e' exatamente
-- isso que o gatilho barra. Maiuscula/minuscula e zero a esquerda contam como
-- codigos diferentes (como no indice e como no balcao). Codigo NULL, vazio ou
-- so de branco nao e' codigo: passa (produto sem codigo e' a maioria).
-- Uso dos indices: as duas consultas do gatilho sao igualdade em coluna que ja
-- tem indice unico parcial, entao custam uma busca por indice.
--
-- QUEM CONTA COMO "A OUTRA TABELA":
--   * Gatilho de `produtos` olha TODA linha de product_variants com o codigo,
--     ativa ou desligada (variacao desligada some da loja mas o codigo dela
--     continua reservado pelo indice dela; reativar nao pode criar duplicata).
--   * Gatilho de `product_variants` olha so produtos NAO apagados
--     (deleted_at IS NULL): o delete de produto e' SOFT e produto apagado e'
--     inexistente para o indice e para o balcao.
--   * Produto gravado JA apagado (deleted_at preenchido) nao e' checado.
--   * O MESMO registro nunca conta contra si: as duas tabelas tem chaves
--     diferentes, entao a checagem e' sempre contra a OUTRA tabela, e dentro da
--     mesma tabela quem barra continua sendo o indice unico dela.
--
-- DADOS EXISTENTES (o que acontece com a linha que ja estava la): NADA. Esta
-- migration nao faz UPDATE, DELETE, INSERT nem cria indice (indice unico que
-- cobrisse as duas tabelas falharia com duplicata existente e e' impossivel
-- entre tabelas). Duplicata que JA exista entre as tabelas continua como esta
-- e o balcao continua com a precedencia da variacao para ela; o gatilho so'
-- barra gravacao NOVA do campo:
--   * INSERT com codigo: checa.
--   * UPDATE que MUDA o codigo: checa o valor novo.
--   * UPDATE que lista a coluna mas com o MESMO valor (o painel regrava a linha
--     inteira, inclusive codigo_barras, a cada edicao de preco): NAO checa. Sem
--     isso, uma duplicata antiga travaria toda edicao daquele produto.
--   * UPSERT (INSERT ... ON CONFLICT (id) DO UPDATE): e' como o painel grava as
--     variacoes (e produtos) que ja existem, e o Postgres dispara primeiro o
--     gatilho de INSERT, SEM OLD. Se a MESMA linha (mesmo id) ja guarda o MESMO
--     codigo, NAO checa (sem isso, abrir um produto com duplicata antiga e
--     mudar so' o preco de uma variacao recusaria o upsert de TODAS as variacoes
--     e o salvar ficaria pela metade). Linha NOVA (id novo) com codigo que a
--     outra tabela tem continua recusada, e upsert que MUDA o codigo cai no
--     caminho do UPDATE e e' checado.
--   * UPDATE que nao lista codigo_barras: o gatilho nem dispara (UPDATE OF).
--   * Restaurar produto apagado (deleted_at volta a NULL) tambem nao dispara:
--     hoje o app nao tem essa acao; se um dia tiver, ela precisa checar antes.
-- O pre-voo apenas conta (RAISE NOTICE) quantos codigos ja estao nas duas
-- tabelas, para o log do apply; nao bloqueia.
--
-- CONSULTA PARA RODAR NAS LOJAS ANTES DE APLICAR (so leitura; nao bloqueia o
-- apply, mas mostra quanto codigo repetido ja existe entre as tabelas):
--   SELECT count(DISTINCT p.codigo_barras) AS codigos_nas_duas_tabelas
--     FROM public.produtos p
--     JOIN public.product_variants v ON v.codigo_barras = p.codigo_barras
--    WHERE p.deleted_at IS NULL
--      AND NULLIF(btrim(p.codigo_barras, E' \t\r\n'), '') IS NOT NULL;
--   Para listar quais (ids, sem dado de cliente):
--   SELECT p.codigo_barras, p.id AS produto_id, v.id AS variacao_id, v.active
--     FROM public.produtos p
--     JOIN public.product_variants v ON v.codigo_barras = p.codigo_barras
--    WHERE p.deleted_at IS NULL
--      AND NULLIF(btrim(p.codigo_barras, E' \t\r\n'), '') IS NOT NULL
--    ORDER BY p.codigo_barras;
--   Resultado vazio = nada a limpar. Linha encontrada = a lojista decide qual
--   dos dois fica com o codigo (decisao de catalogo; esta migration nao mexe).
--
-- COMO O FRONT TRATA O ERRO: nao muda. src/hooks/useProducts.ts
-- (mensagemAmigavelErroProduto) ja traduz 23505 cujo texto/detalhe cita
-- `codigo_barras` para "Este codigo de barras ja esta em outro produto ou
-- variacao." A mensagem do banco e' em portugues e o DETAIL traz
-- `Key (codigo_barras)=(...)` justamente para esse reconhecimento. Prova:
-- tests/front/codigo-de-barras-23505-do-gatilho.test.ts.
--
-- ORDEM: depende so' das colunas e dos indices da 20261160000000. Banco antes
-- ou depois do front da no mesmo (o front nao conhece o gatilho). ROLLBACK:
-- rollback-manual-20261347000000_o_codigo_de_barras_nao_repete_entre_produto_e_variacao.sql
-- (apaga so os 2 gatilhos e as 2 funcoes, todos novos; nenhum dado e' tocado).
--
-- LIMITES CONHECIDOS (ditos de proposito):
--   * Vale para transacoes em READ COMMITTED (PostgREST e a RPC). Em
--     REPEATABLE READ/SERIALIZABLE o snapshot antigo nao veria a linha que o
--     outro cadastro acabou de gravar.
--   * Cadastro em lote com varios codigos numa transacao, em ordem trocada em
--     relacao a outra transacao, pode dar deadlock; o Postgres aborta uma das
--     duas (nunca grava duplicata).
--   * Limite das travas: cada codigo gravado segura UMA trava consultiva ate o
--     fim da transacao, e o Postgres guarda as travas numa tabela de tamanho
--     fixo (max_locks_per_transaction x conexoes). Importacao em massa futura
--     (milhares de codigos numa transacao so') deve gravar em pedacos (um
--     COMMIT por lote de algumas centenas), sem mudar nada aqui.
--   * Quem desliga o gatilho (ALTER TABLE ... DISABLE TRIGGER) ou grava como
--     superusuario com session_replication_role = replica passa por cima dele.
--
-- COMO APLICAR: transacao externa (aplicar-migrations.yml / db-apply). Sem
-- BEGIN/COMMIT neste arquivo (regra da casa). Idempotente: reaplicar deixa o
-- mesmo estado (o pre-voo aceita so' os objetos ja iguais aos desenhados aqui).
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_347$
DECLARE
  v_fn_produto oid := to_regprocedure('public.produto_codigo_barras_livre_de_variacao()');
  v_fn_variacao oid := to_regprocedure('public.variacao_codigo_barras_livre_de_produto()');
  v_hash text;
  v_gat record;
  v_repetidos bigint;
BEGIN
  -- As duas tabelas e as colunas que o gatilho le: tem de ser as da 20261160000000.
  IF COALESCE((SELECT count(*) = 1 AND bool_and(relkind = 'r') FROM pg_class WHERE oid = to_regclass('public.produtos')), false) IS NOT TRUE
     OR COALESCE((SELECT count(*) = 1 AND bool_and(relkind = 'r') FROM pg_class WHERE oid = to_regclass('public.product_variants')), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.produtos e public.product_variants precisam existir como tabelas comuns; nada foi alterado.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped
         AND ((a.attrelid = to_regclass('public.produtos') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
           OR (a.attrelid = to_regclass('public.produtos') AND a.attname = 'deleted_at' AND a.atttypid = 'timestamptz'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produtos.codigo_barras (text), produtos.deleted_at (timestamptz) e product_variants.codigo_barras (text) precisam existir (20261160000000); nada foi alterado.';
  END IF;

  -- Os indices unicos por tabela continuam de pe': e' neles que a checagem apoia a busca.
  IF to_regclass('public.produtos_codigo_barras_unico') IS NULL
     OR to_regclass('public.product_variants_codigo_barras_unico') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: os indices produtos_codigo_barras_unico e product_variants_codigo_barras_unico (20261160000000) nao existem; nada foi alterado.';
  END IF;

  -- A funcao e' SECURITY DEFINER para enxergar as duas tabelas inteiras (RLS). Quem aplica tem de ser o dono
  -- delas (ou superusuario/BYPASSRLS), e nenhuma pode ter RLS forcada ao dono: senao a checagem veria so' parte
  -- das linhas e o furo ficaria calado.
  IF EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.oid IN (to_regclass('public.produtos'), to_regclass('public.product_variants'))
          AND NOT (
            (c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND NOT c.relforcerowsecurity)
            OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND (r.rolsuper OR r.rolbypassrls))
          )
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: quem aplica precisa ser dono de produtos e product_variants (sem RLS forcada) ou superusuario; senao o gatilho nao enxerga todas as linhas.';
  END IF;

  -- As funcoes novas: ausentes, ou exatamente as desta migration.
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('produto_codigo_barras_livre_de_variacao', 'variacao_codigo_barras_livre_de_produto')) >
     (CASE WHEN v_fn_produto IS NULL THEN 0 ELSE 1 END + CASE WHEN v_fn_variacao IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: as funcoes do gatilho de codigo de barras existem em public com outra assinatura ou sobrecarga; revise antes de aplicar.';
  END IF;
  IF v_fn_produto IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_fn_produto;
    IF v_hash IS DISTINCT FROM '9283210663c925108532b043c3e03107' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produto_codigo_barras_livre_de_variacao ja existe com corpo desconhecido (hash %); capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
    END IF;
  END IF;
  IF v_fn_variacao IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_fn_variacao;
    IF v_hash IS DISTINCT FROM 'af09872b76b0726f34359d06f1ab34b8' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: variacao_codigo_barras_livre_de_produto ja existe com corpo desconhecido (hash %); capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
    END IF;
  END IF;

  -- Os gatilhos novos: ausentes, ou exatamente os desenhados (BEFORE, por linha, INSERT + UPDATE OF codigo_barras,
  -- sem WHEN e sem argumentos). tgtype 23 = ROW(1) + BEFORE(2) + INSERT(4) + UPDATE(16).
  FOR v_gat IN
    SELECT t.tgname, t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs,
           t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname IN ('tr_produto_codigo_barras_livre_de_variacao', 'tr_variacao_codigo_barras_livre_de_produto')
  LOOP
    IF v_gat.tgname = 'tr_produto_codigo_barras_livre_de_variacao' THEN
      IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.produtos')
         OR v_gat.tgfoid IS DISTINCT FROM v_fn_produto
         OR v_gat.attr IS DISTINCT FROM (SELECT attnum::text FROM pg_attribute WHERE attrelid = to_regclass('public.produtos') AND attname = 'codigo_barras' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ja existe tr_produto_codigo_barras_livre_de_variacao que NAO e o desenhado aqui (outra tabela, outra funcao ou outra coluna); revise antes de aplicar.';
      END IF;
    ELSE
      IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.product_variants')
         OR v_gat.tgfoid IS DISTINCT FROM v_fn_variacao
         OR v_gat.attr IS DISTINCT FROM (SELECT attnum::text FROM pg_attribute WHERE attrelid = to_regclass('public.product_variants') AND attname = 'codigo_barras' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ja existe tr_variacao_codigo_barras_livre_de_produto que NAO e o desenhado aqui (outra tabela, outra funcao ou outra coluna); revise antes de aplicar.';
      END IF;
    END IF;
    IF v_gat.tgtype <> 23 OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho % existe com outro momento, evento, WHEN ou argumentos; revise antes de aplicar.', v_gat.tgname;
    END IF;
  END LOOP;

  -- So' informa: quantos codigos ja estao nas duas tabelas (nao bloqueia, nao altera).
  SELECT count(DISTINCT p.codigo_barras) INTO v_repetidos
    FROM public.produtos p
    JOIN public.product_variants v ON v.codigo_barras = p.codigo_barras
   WHERE p.deleted_at IS NULL
     AND NULLIF(btrim(p.codigo_barras, E' \t\r\n'), '') IS NOT NULL;
  IF v_repetidos > 0 THEN
    RAISE NOTICE '20261347000000: % codigo(s) de barras ja estao em produto E em variacao. Continuam como estao; o gatilho so barra gravacao nova.', v_repetidos;
  END IF;
END $preflight_347$;

CREATE OR REPLACE FUNCTION public.produto_codigo_barras_livre_de_variacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_codigo text := NEW.codigo_barras;
BEGIN
  -- Sem codigo (NULL, vazio ou so de branco) nao ha o que proteger.
  IF NULLIF(btrim(v_codigo, E' \t\r\n'), '') IS NULL THEN
    RETURN NEW;
  END IF;
  -- UPDATE OF dispara quando a coluna esta na lista do SET, mesmo com o MESMO valor (o painel regrava a linha
  -- inteira). Valor que nao mudou nao e' gravacao nova: nao pode travar a edicao de uma duplicata antiga.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.codigo_barras IS NOT DISTINCT FROM OLD.codigo_barras THEN
      RETURN NEW;
    END IF;
  END IF;
  -- UPSERT (INSERT ... ON CONFLICT (id) DO UPDATE): o Postgres dispara este gatilho de INSERT antes do UPDATE,
  -- sem OLD. Se a MESMA linha (mesmo id) ja guarda este MESMO codigo, nao e' gravacao nova do campo: sai cedo
  -- (nao pega trava: nada novo e' reivindicado). Linha nova (id novo) segue para a checagem.
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.produtos x WHERE x.id = NEW.id AND x.codigo_barras = v_codigo) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Produto apagado (soft delete) nao segura codigo: igual ao indice parcial e a busca do balcao.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Mesma chave nos dois gatilhos: cadastros simultaneos do mesmo codigo, um em cada tabela, se enfileiram.
  -- A trava so' solta no fim da transacao, depois da linha estar gravada para o proximo ver.
  PERFORM pg_advisory_xact_lock(hashtextextended('codigo_de_barras:' || v_codigo, 0));
  IF EXISTS (SELECT 1 FROM public.product_variants v WHERE v.codigo_barras = v_codigo) THEN
    RAISE EXCEPTION 'Este código de barras já está em uso por outro produto ou variação.'
      USING ERRCODE = '23505',
            DETAIL = 'Key (codigo_barras)=(' || v_codigo || ') ja esta numa variacao (product_variants).',
            HINT = 'Use outro codigo, ou tire este codigo da variacao antes.',
            SCHEMA = 'public',
            TABLE = 'produtos',
            COLUMN = 'codigo_barras',
            CONSTRAINT = 'codigo_barras_unico_entre_produto_e_variacao';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.variacao_codigo_barras_livre_de_produto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_codigo text := NEW.codigo_barras;
BEGIN
  -- Sem codigo (NULL, vazio ou so de branco) nao ha o que proteger.
  IF NULLIF(btrim(v_codigo, E' \t\r\n'), '') IS NULL THEN
    RETURN NEW;
  END IF;
  -- Valor que nao mudou nao e' gravacao nova (ver o gatilho irmao, em produtos).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.codigo_barras IS NOT DISTINCT FROM OLD.codigo_barras THEN
      RETURN NEW;
    END IF;
  END IF;
  -- UPSERT (INSERT ... ON CONFLICT (id) DO UPDATE): o Postgres dispara este gatilho de INSERT antes do UPDATE,
  -- sem OLD. Se a MESMA linha (mesmo id) ja guarda este MESMO codigo, nao e' gravacao nova do campo: sai cedo
  -- (nao pega trava: nada novo e' reivindicado). Linha nova (id novo) segue para a checagem.
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.product_variants x WHERE x.id = NEW.id AND x.codigo_barras = v_codigo) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Mesma chave do gatilho de produtos: as duas tabelas disputam a mesma fila.
  PERFORM pg_advisory_xact_lock(hashtextextended('codigo_de_barras:' || v_codigo, 0));
  IF EXISTS (SELECT 1 FROM public.produtos p WHERE p.codigo_barras = v_codigo AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Este código de barras já está em uso por outro produto ou variação.'
      USING ERRCODE = '23505',
            DETAIL = 'Key (codigo_barras)=(' || v_codigo || ') ja esta num produto (produtos).',
            HINT = 'Use outro codigo, ou tire este codigo do produto antes.',
            SCHEMA = 'public',
            TABLE = 'product_variants',
            COLUMN = 'codigo_barras',
            CONSTRAINT = 'codigo_barras_unico_entre_produto_e_variacao';
  END IF;
  RETURN NEW;
END;
$function$;

-- Funcao nova nasce com EXECUTE para PUBLIC (e o pacote de privilegios padrao do Supabase): gatilho nao precisa
-- de EXECUTE para disparar, entao ninguem chama isto de fora.
REVOKE ALL ON FUNCTION public.produto_codigo_barras_livre_de_variacao() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.variacao_codigo_barras_livre_de_produto() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.produto_codigo_barras_livre_de_variacao() IS 'Gatilho de produtos (20261347000000): barra gravar codigo de barras que ja esta em product_variants. Nao altera linha existente.';
COMMENT ON FUNCTION public.variacao_codigo_barras_livre_de_produto() IS 'Gatilho de product_variants (20261347000000): barra gravar codigo de barras que ja esta em produto nao apagado. Nao altera linha existente.';

CREATE OR REPLACE TRIGGER tr_produto_codigo_barras_livre_de_variacao
  BEFORE INSERT OR UPDATE OF codigo_barras ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.produto_codigo_barras_livre_de_variacao();

CREATE OR REPLACE TRIGGER tr_variacao_codigo_barras_livre_de_produto
  BEFORE INSERT OR UPDATE OF codigo_barras ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.variacao_codigo_barras_livre_de_produto();

-- CONFERENCIA no instante do apply: aborta (e a transacao externa desfaz tudo) se algo nao ficou como desenhado.
DO $conferencia_347$
DECLARE
  v_fn_produto oid := to_regprocedure('public.produto_codigo_barras_livre_de_variacao()');
  v_fn_variacao oid := to_regprocedure('public.variacao_codigo_barras_livre_de_produto()');
  v_papel text;
BEGIN
  IF v_fn_produto IS NULL OR v_fn_variacao IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261347: uma das duas funcoes nao existe';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.oid IN (v_fn_produto, v_fn_variacao)
         AND p.prosecdef AND p.prorettype = 'trigger'::regtype AND p.pronargs = 0
         AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]) <> 2 THEN
    RAISE EXCEPTION 'conferencia 20261347: as funcoes nao sao SECURITY DEFINER com search_path fixo';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_fn_produto) IS DISTINCT FROM '9283210663c925108532b043c3e03107'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_fn_variacao) IS DISTINCT FROM 'af09872b76b0726f34359d06f1ab34b8' THEN
    RAISE EXCEPTION 'conferencia 20261347: o corpo vivo de uma das funcoes nao e o desta migration';
  END IF;
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_papel, v_fn_produto, 'EXECUTE') OR has_function_privilege(v_papel, v_fn_variacao, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261347: % ainda tem EXECUTE numa das funcoes', v_papel;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN (v_fn_produto, v_fn_variacao) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261347: PUBLIC ainda tem EXECUTE numa das funcoes';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 23 AND t.tgqual IS NULL AND t.tgnargs = 0
         AND ((t.tgname = 'tr_produto_codigo_barras_livre_de_variacao' AND t.tgrelid = to_regclass('public.produtos') AND t.tgfoid = v_fn_produto)
           OR (t.tgname = 'tr_variacao_codigo_barras_livre_de_produto' AND t.tgrelid = to_regclass('public.product_variants') AND t.tgfoid = v_fn_variacao))
         AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = t.tgrelid AND a.attname = 'codigo_barras' AND NOT a.attisdropped)) <> 2 THEN
    RAISE EXCEPTION 'conferencia 20261347: os dois gatilhos nao estao ligados como desenhado (BEFORE INSERT OR UPDATE OF codigo_barras, por linha)';
  END IF;
END $conferencia_347$;

NOTIFY pgrst, 'reload schema';
