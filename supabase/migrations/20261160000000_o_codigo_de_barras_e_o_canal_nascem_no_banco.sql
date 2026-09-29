-- ============================================================================
-- Migration 20261160000000 — o código de barras e o canal nascem no banco
-- (LOTE C1 da venda presencial/PDV, tarefa C1.1; desenho em
-- docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.1-5.6,
-- decisões do dono D1 e D6)
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: a loja não consegue vender no balcão
-- pelo app. Duas faltas medidas, as duas no banco:
--   (a) NÃO existe onde guardar o código de barras. A palavra `codigo_barras`
--       não aparece em nenhum .sql, .ts ou .tsx do repositório hoje — quem
--       bipa um EAN-13 no balcão não tem por onde achar o produto, e a
--       variação (a combinação "Branca/PP") muito menos, porque o código de
--       barras de verdade é da EMBALAGEM, não do modelo.
--   (b) `marketplace_orders` não sabe dizer DE ONDE veio o pedido. Toda venda
--       nasce igual à venda da vitrine, então o pedido de balcão entraria no
--       painel misturado com a venda online, sem filtro possível e sem
--       registro de QUEM atendeu.
-- Esta migration só abre o espaço no esquema: a RPC que grava a venda
-- (C1.3), o filtro por canal (C1.4) e as telas (C2/C3/C4/C5) vêm depois e
-- dependem destas colunas existirem ANTES (o job "Código x banco" do CI,
-- .github/workflows/ci.yml:334-366, reprova o PR se a tela chamar o que o
-- banco não tem).
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM (a ordem importa: as views dependem da
-- coluna existir antes de serem recriadas):
--   1. `produtos` e `product_variants` ganham `codigo_barras text` (ADITIVA).
--      TEXT, nunca numérico: EAN-13 tem zero à esquerda ("0" + 12 dígitos é
--      código diferente de 12 dígitos), existe código alfanumérico, e
--      qualquer tipo numérico comeria o zero calado.
--   2. `COMMENT ON COLUMN` nas duas, dizendo o que cada uma significa — a
--      variante tem o próprio código porque é ela que vai na caixa.
--   3. `get_product_recommendations` é RECRIADA com a coluna nova no fim do
--      `SELECT` — não é refatoração de passagem, é a CONTA do passo 1. A
--      função é `RETURNS SETOF public.produtos` e o corpo dela ENUMERA as
--      colunas na mão (é assim que a 20260990000000 faz `custo` e
--      `fornecedor_id` saírem NULOS). Uma 31ª coluna em `produtos` muda o
--      tipo composto de retorno e o plpgsql passa a RECUSAR a consulta em
--      tempo de CHAMADA — «Number of returned columns (30) does not match
--      expected column count (31)», medido num Postgres 16 em 16/09/2026.
--      Sem esta recriação a migration aplicaria verde e a RPC morreria
--      DEPOIS, calada: a página de produto cai no fallback local do catch
--      (src/hooks/useProducts.ts:1248-1281) e a vitrine degrada sem avisar
--      ninguém. O corpo é o de 20260990000000:82-146 byte a byte, com UMA
--      linha a mais; `custo` e `fornecedor_id` continuam NULOS, o crachá
--      continua `SECURITY DEFINER` com `search_path` fixo e o `GRANT EXECUTE`
--      não é tocado. Varredura das demais: `get_active_products_internal` é
--      `SELECT *` (baseline:891-897), `get_admin_orders_paged` devolve jsonb
--      com `o.*` (20261068000000:121-225), `get_products_with_variants` monta
--      `jsonb_build_object` (baseline:2549-2598), todo `INSERT INTO
--      public.marketplace_orders` traz lista de colunas e não existe
--      `%ROWTYPE` destas tabelas — esta é a ÚNICA função afetada.
--   4. Os dois índices ÚNICOS PARCIAIS. A ASSIMETRIA ENTRE ELES PARECE ERRO E
--      NÃO É: o de `produtos` filtra `codigo_barras IS NOT NULL AND
--      deleted_at IS NULL` (o delete de produto aqui é SOFT — a coluna existe
--      e a receita manda usá-la, .claude/commands/nova-migration.md:162 —,
--      então sem esse predicado um produto APAGADO continuaria travando o
--      código de barras de um produto novo); o de `product_variants` filtra
--      SÓ `codigo_barras IS NOT NULL`, porque `product_variants` NÃO TEM
--      `deleted_at` (a tabela nasce sem essa coluna,
--      20260806000000_baseline_do_schema_vivo.sql:4041-4053: variação some por
--      DELETE ou por `active = false`). Pedir `deleted_at` lá seria erro de
--      SQL na hora de aplicar. Os dois são PARCIAIS pelo mesmo motivo: NULL
--      não conflita com NULL num índice único, mas o predicado deixa isso
--      explícito e mantém o índice pequeno (produto sem código é a maioria
--      no dia da aplicação). Molde: 20261038000000_o_pedido_nao_nasce_em_
--      dobro.sql:70-72. O QUE ELES NÃO GARANTEM: os dois índices são de
--      relações DIFERENTES, então a unicidade não cruza — o mesmo EAN pode
--      viver em `produtos.codigo_barras` de um produto e em
--      `product_variants.codigo_barras` de outro ao mesmo tempo. Unicidade
--      entre as duas tabelas exigiria tabela de códigos ou trigger (outro
--      desenho, outra prova) e NÃO é feita aqui; o que fica pendente, por
--      nome, está na seção FORA DO ESCOPO.
--   5. O GRANT por COLUNA de `produtos` ganha `codigo_barras` no fim, virando
--      30 nomes — a lista de 29 de 20261070000000_os_grants_de_coluna_nascem_
--      no_repositorio.sql:56-86 repetida na MESMA ordem. Sem isto a coluna
--      nasce invisível para `authenticated` (o painel lê a tabela por
--      coluna desde aquela migration) e o job "Código x banco" acusaria
--      INALCANÇÁVEL. `custo` continua FORA da lista, como sempre esteve: é a
--      margem da loja, e foi exatamente esse vazamento que a 20261070000000
--      fechou. GRANT de coluna é ADITIVO, então os `REVOKE` daquela migration
--      (:45-54) NÃO são repetidos aqui — repetir seria derrubar de novo um
--      privilégio que já está derrubado. `product_variants` não precisa de
--      GRANT novo: nenhuma migration dá nem revoga privilégio de coluna nela,
--      a porta dela é a RLS (baseline:5664-5688).
--   6. `vw_produtos_public` é recriada com `CREATE OR REPLACE VIEW`: as 26
--      colunas do baseline (:4378-4403) na MESMA ordem + `codigo_barras` no
--      FIM. `OR REPLACE` só aceita coluna nova no fim — reordenar, renomear
--      ou remover faz o Postgres recusar. SEM `security_invoker`: a ausência
--      é decisão registrada (.claude/commands/nova-migration.md:67), e ligar
--      agora deixaria o visitante anônimo (que não tem SELECT em `produtos`)
--      sem vitrine.
--   7. `vw_produtos_admin` idem: as 30 colunas do baseline (:4331-4360) na
--      MESMA ordem + `codigo_barras` no fim, `WHERE public.is_admin()` e
--      `WITH CASCADED CHECK OPTION` repetidos byte a byte. O CHECK OPTION não
--      é enfeite: a view é a porta de ESCRITA do painel (20261024000000:60) e
--      perdê-lo quebra o cadastro de produto. Efeito colateral DESEJADO: com
--      `codigo_barras` no fim da view, o formulário do produto (C5) passa a
--      poder GRAVAR o código por ela, sem tocar na tabela direto.
--   8. `marketplace_orders` ganha `canal text NOT NULL DEFAULT 'online'` e a
--      CHECK nomeada `marketplace_orders_canal_check` (`online`/`presencial`),
--      criada dentro de `DO $$ ... $$` que consulta `pg_constraint` antes —
--      `ADD CONSTRAINT` não aceita `IF NOT EXISTS`, e sem essa guarda
--      reaplicar o arquivo daria erro. Molde: 20261140000000_a_loja_declara_
--      o_seu_dominio_publico.sql:188-202.
--   9. `marketplace_orders` ganha `vendedor_id uuid REFERENCES auth.users(id)`
--      — quem registrou a venda no balcão. COM a chave estrangeira, no
--      precedente de `user_id` (baseline:5158-5160). A coluna irmã
--      `pagamento_recebido_por` foi criada SEM FK (20261020000000:46-47);
--      isso NÃO é consertado aqui (mudar constraint de coluna viva é outra
--      migration, com prova própria).
--  10. Índice PARCIAL `idx_marketplace_orders_presencial` em `(created_at
--      DESC) WHERE canal = 'presencial'`: o chip "Balcão" do painel filtra só
--      esse lado, e `online` é a esmagadora maioria — um índice inteiro seria
--      quase uma cópia da tabela para servir a minoria.
--
-- DADOS EXISTENTES: nenhuma linha é lida, comparada nem reescrita por esta
-- migration. As colunas de `codigo_barras` nascem NULL em todo produto e toda
-- variação (produto sem código cadastrado — e NULL não conflita nos índices
-- únicos parciais). Em `marketplace_orders`, o `DEFAULT 'online'` é o que faz
-- os ~64 pedidos que já existem nascerem COERENTES sem nenhum `UPDATE`: todos
-- eles vieram mesmo da vitrine. `vendedor_id` nasce NULL neles, que é a
-- verdade (não houve balconista). Não há seed nesta migration.
-- ADITIVA é sobre DADO e sobre COLUNA, não sobre OBJETO: um objeto existente
-- MUDA aqui — a função `get_product_recommendations` é recriada (item 3), e
-- ela tem de ser, senão o `ADD COLUMN` a mata. Fora ela, nada mais é
-- substituído além das duas views, que a própria tarefa manda recriar.
--
-- IDEMPOTÊNCIA: `ADD COLUMN IF NOT EXISTS` ×4, `COMMENT ON COLUMN` (sempre
-- sobrescreve), `CREATE UNIQUE INDEX IF NOT EXISTS` ×2, `CREATE INDEX IF NOT
-- EXISTS`, `GRANT` (aditivo, repetir é no-op), `CREATE OR REPLACE FUNCTION`
-- (sempre substitui), `CREATE OR REPLACE VIEW` ×2 e
-- o `DO $$` que só cria a CHECK se ela ainda não existir. Reaplicar o arquivo
-- deixa exatamente o mesmo estado.
--
-- FORA DO ESCOPO, de propósito: aplicar de verdade no banco (é
-- `node scripts/db-apply.cjs`, fora do PR); a RPC `registrar_venda_presencial`
-- (C1.3); o parâmetro `p_canal` de `get_admin_orders_paged` (C1.4 — a coluna
-- `canal` já aparece SOZINHA no retorno dela assim que existir, porque aquele
-- SELECT devolve `o.*`, 20261068000000:225); o leitor de câmera (C2), a tela
-- do PDV (C3), os consumidores do canal (C4) e o campo no formulário do
-- produto (C5); qualquer CHECK de `payment_method` (não existe nenhuma hoje e
-- criar uma recusaria pedido legado, ex.: 'na_entrega'); qualquer mudança na
-- CHECK de `payment_status` (D1: a venda de balcão reaproveita o valor
-- `recebido_na_entrega` que já existe); índice em `produtos.codigo` ou
-- `product_variants.sku` (não existe nenhum hoje e não é assunto daqui);
-- QUALQUER OUTRA FUNÇÃO — `get_product_recommendations` é a única recriada
-- aqui, e só porque o `ADD COLUMN` a quebraria (item 3). `create_marketplace_
-- order_v23`/`v24`, `get_admin_orders_paged`, `get_products_with_variants`,
-- `get_active_products_internal` e as demais não são tocadas: a varredura do
-- item 3 mostra por que nenhuma delas sente a coluna nova.
--
-- PENDÊNCIA REGISTRADA PARA C1.3/C2 (não se resolve no esquema): como a
-- unicidade do código de barras é POR TABELA, uma busca por código pode achar
-- DOIS alvos para o mesmo bipe — um produto sem variação e a variação de
-- outro produto. A regra de precedência (quem ganha, ou se o balcão pergunta)
-- é decisão da busca do PDV, não do índice, e tem de estar escrita lá antes
-- de o leitor de câmera entrar no ar — senão o operador vê o produto errado
-- ou um erro sem explicação.
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs <arquivo.sql>` (uma transação por arquivo) ou
-- `psql -1`. Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da
-- casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar à mão contra o banco):
--
--   0. ANTES de aplicar num clone com dado real — duplicata trava o índice
--      único. As duas consultas têm de voltar VAZIAS:
--      SELECT codigo_barras, count(*) FROM public.produtos
--       WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL
--       GROUP BY 1 HAVING count(*) > 1;
--      SELECT codigo_barras, count(*) FROM public.product_variants
--       WHERE codigo_barras IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--
--   1. SELECT table_name, column_name, data_type FROM information_schema.columns
--       WHERE table_schema='public' AND column_name='codigo_barras';
--      -- esperado: 4 linhas (produtos, product_variants, vw_produtos_admin,
--      -- vw_produtos_public), todas text.
--
--   2. SELECT indexname FROM pg_indexes WHERE schemaname='public'
--       AND indexname IN ('produtos_codigo_barras_unico',
--                         'product_variants_codigo_barras_unico',
--                         'idx_marketplace_orders_presencial');
--      -- esperado: 3 linhas.
--
--   3. SELECT has_column_privilege('authenticated','public.produtos',
--                                  'codigo_barras','SELECT') AS le_codigo,
--             has_column_privilege('authenticated','public.produtos',
--                                  'custo','SELECT') AS le_custo;
--      -- esperado: true, false. (`has_table_privilege` responderia false nos
--      -- dois: grant de coluna não aparece nela — cicatriz da 20260821000100.)
--
--   4. SELECT count(*) FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='vw_produtos_public';
--      -- esperado: 27. E para vw_produtos_admin: 31.
--
--   5. SELECT check_option FROM information_schema.views
--       WHERE table_schema='public' AND table_name='vw_produtos_admin';
--      -- esperado: CASCADED (se vier NONE, o cadastro de produto do painel
--      -- está quebrado).
--
--   6. SELECT canal, count(*) FROM public.marketplace_orders GROUP BY 1;
--      -- esperado: uma única linha, ('online', <total de pedidos>).
--
--   7. INSERT INTO public.marketplace_orders (...) com canal = 'delivery';
--      -- esperado: 23514 marketplace_orders_canal_check.
--
--   8. A RPC de recomendação continua VIVA (é o passo que o item 3 existe
--      para garantir — sem a recriação, esta consulta devolve «structure of
--      query does not match function result type»):
--      SELECT count(*) FROM public.get_product_recommendations(
--        (SELECT id FROM public.produtos WHERE ativo = true LIMIT 1), 4);
--      -- esperado: NÃO erra (o número pode ser 0 se não houver produto
--      -- irmão da mesma categoria/tag com estoque; o que se prova aqui é a
--      -- ausência do erro, não a quantidade).
--
--   9. Prova do par (estática, sem banco):
--      node scripts/db-prove-rollback.cjs \
--        supabase/migrations/20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql
--
-- ROLLBACK: rollback-manual-20261160000000_o_codigo_de_barras_e_o_canal_
-- nascem_no_banco.sql, versionado ao lado — desfaz na ordem INVERSA (índice
-- e colunas de `marketplace_orders`, depois as duas views por `DROP VIEW` +
-- `CREATE VIEW` COM os GRANTs refeitos à mão E com os REVOKE de escrita de
-- `anon`/`authenticated` repetidos logo depois de cada `CREATE VIEW` — o
-- `DROP` faz o pacote do `ALTER DEFAULT PRIVILEGES` renascer na view nova
-- (20261090000000:75-83), e sem eles o rollback reabriria a escrita anônima na
-- vitrine; isto NÃO é preciso aqui na IDA, porque `CREATE OR REPLACE VIEW`
-- preserva a ACL —, depois `get_product_recommendations` de volta às 30
-- colunas, o `REVOKE` da coluna, os dois índices e por fim as duas colunas
-- `codigo_barras`).
-- ============================================================================

ALTER TABLE public.produtos
    ADD COLUMN IF NOT EXISTS codigo_barras text;

ALTER TABLE public.product_variants
    ADD COLUMN IF NOT EXISTS codigo_barras text;

COMMENT ON COLUMN public.produtos.codigo_barras IS 'EAN/GTIN do produto. Único entre os produtos vivos (índice parcial) — a unicidade NÃO cruza com product_variants.codigo_barras, que tem índice próprio. NULL = produto sem código cadastrado.';

COMMENT ON COLUMN public.product_variants.codigo_barras IS 'EAN/GTIN da variação: a combinação (Branca/PP) tem o próprio código, porque é a embalagem dela que é bipada no balcão. NULL = variação sem código cadastrado.';

-- get_product_recommendations RECRIADA — não é refatoração, é a conta do
-- ADD COLUMN acima. A função é `RETURNS SETOF public.produtos` e o corpo dela
-- ENUMERA as colunas na mão, para devolver `custo` e `fornecedor_id` NULOS
-- (20260990000000_fecha_custo_e_fornecedor_do_security_definer.sql:82-146).
-- Uma 31ª coluna em `produtos` muda o tipo composto de retorno, e o plpgsql
-- passa a recusar a consulta em TEMPO DE CHAMADA: «structure of query does not
-- match function result type / Number of returned columns (30) does not match
-- expected column count (31)» (medido num Postgres 16 em 16/09/2026, com a
-- reprodução mínima desta tabela). Sem esta recriação, a migration aplicaria
-- VERDE e a RPC morreria depois, calada: `fetchRecommendations` cai no catch e
-- usa o fallback local sobre o cache (src/hooks/useProducts.ts:1248-1281), a
-- vitrine não quebra na cara do visitante e ninguém fica sabendo. O corpo
-- abaixo é o de 20260990000000 byte a byte, com UMA linha a mais no fim do
-- SELECT — `custo` e `fornecedor_id` continuam saindo NULL, o crachá continua
-- SECURITY DEFINER com search_path fixo, o GRANT de EXECUTE não é tocado.
-- As outras funções que leem estas três tabelas foram varridas e estão imunes:
-- `get_active_products_internal` é `SELECT *` (baseline:891-897),
-- `get_admin_orders_paged` devolve jsonb com `o.*` (20261068000000:121-225),
-- `get_products_with_variants` monta jsonb_build_object (baseline:2549-2598),
-- todo `INSERT INTO public.marketplace_orders` tem lista de colunas e não há
-- `%ROWTYPE` destas tabelas em lugar nenhum.
CREATE OR REPLACE FUNCTION public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4)
 RETURNS SETOF public.produtos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_category text;
    v_tags text[];
BEGIN
    -- Get context from current product
    SELECT categoria, tags INTO v_category, v_tags
    FROM produtos
    WHERE id = p_product_id;

    RETURN QUERY
    SELECT
        p.id,
        p.nome,
        p.descricao,
        p.categoria,
        p.codigo,
        NULL::numeric(10,2),  -- custo: nunca sai desta funcao
        p.preco_venda,
        p.estoque,
        p.estoque_minimo,
        NULL::uuid,           -- fornecedor_id: nunca sai desta funcao
        p.ativo,
        p.tags,
        p.data_cadastro,
        p.ultima_atualizacao,
        p.imagem_url,
        p.meta_title,
        p.meta_description,
        p.imagem_urls,
        p.preco_original,
        p.is_bestseller,
        p.frete_gratis,
        p.sold,
        p.deleted_at,
        p.calculated_points,
        p.rating,
        p.review_count,
        p.peso_kg,
        p.largura_cm,
        p.altura_cm,
        p.comprimento_cm,
        -- 31a coluna, a unica linha nova neste corpo: tem de existir e tem de
        -- ser a ULTIMA, porque e' a ultima coluna de `produtos`.
        p.codigo_barras
    FROM produtos p
    WHERE p.id != p_product_id
      AND p.ativo = true
      AND p.estoque > 0
      AND (
          -- Exact category match (High weight)
          p.categoria = v_category
          OR
          -- Tag overlap (Medium weight)
          p.tags && v_tags
      )
    -- Simple scoring: Category match is prioritized
    ORDER BY
        (p.categoria = v_category) DESC,
        p.data_cadastro DESC
    LIMIT p_limit;
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS produtos_codigo_barras_unico
    ON public.produtos (codigo_barras)
    WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_codigo_barras_unico
    ON public.product_variants (codigo_barras)
    WHERE codigo_barras IS NOT NULL;

GRANT SELECT (
    id,
    nome,
    descricao,
    categoria,
    codigo,
    preco_venda,
    preco_original,
    imagem_url,
    imagem_urls,
    estoque,
    estoque_minimo,
    ativo,
    deleted_at,
    data_cadastro,
    ultima_atualizacao,
    peso_kg,
    altura_cm,
    largura_cm,
    comprimento_cm,
    frete_gratis,
    tags,
    meta_title,
    meta_description,
    rating,
    review_count,
    sold,
    calculated_points,
    fornecedor_id,
    is_bestseller,
    codigo_barras
) ON public.produtos TO authenticated;

CREATE OR REPLACE VIEW public.vw_produtos_public AS
 SELECT id,
    nome,
    descricao,
    preco_venda,
    preco_original,
    estoque,
    imagem_url,
    imagem_urls,
    categoria,
    ativo,
    data_cadastro,
    tags,
    meta_title,
    meta_description,
    is_bestseller,
    frete_gratis,
    sold,
    calculated_points,
    codigo,
    ultima_atualizacao,
    rating,
    review_count,
    peso_kg,
    largura_cm,
    altura_cm,
    comprimento_cm,
    codigo_barras
   FROM public.produtos
  WHERE ativo = true AND deleted_at IS NULL;

CREATE OR REPLACE VIEW public.vw_produtos_admin AS
 SELECT id,
    nome,
    descricao,
    categoria,
    codigo,
    custo,
    preco_venda,
    estoque,
    estoque_minimo,
    fornecedor_id,
    ativo,
    tags,
    data_cadastro,
    ultima_atualizacao,
    imagem_url,
    meta_title,
    meta_description,
    imagem_urls,
    preco_original,
    is_bestseller,
    frete_gratis,
    sold,
    deleted_at,
    calculated_points,
    rating,
    review_count,
    peso_kg,
    largura_cm,
    altura_cm,
    comprimento_cm,
    codigo_barras
   FROM public.produtos
  WHERE public.is_admin()
  WITH CASCADED CHECK OPTION;

ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'online';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.marketplace_orders'::regclass
       AND conname = 'marketplace_orders_canal_check'
  ) THEN
    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_canal_check
      CHECK (canal IN ('online','presencial'));
  END IF;
END $$;

COMMENT ON COLUMN public.marketplace_orders.canal IS 'De onde veio o pedido: online (vitrine, o padrão) ou presencial (balcão/PDV). Pedido antigo nasce online pelo DEFAULT, sem UPDATE.';

ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS vendedor_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.marketplace_orders.vendedor_id IS 'Quem registrou a venda no balcão; sempre auth.uid() dentro da RPC, nunca parâmetro. NULL em pedido online.';

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_presencial
    ON public.marketplace_orders (created_at DESC)
    WHERE canal = 'presencial';
