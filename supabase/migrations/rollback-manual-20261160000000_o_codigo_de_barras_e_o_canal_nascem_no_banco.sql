-- ============================================================================
-- Rollback manual — o código de barras e o canal nascem no banco
-- (20261160000000)
-- ============================================================================
-- Reverte na ordem INVERSA da criação:
--   1. o índice parcial do chip "Balcão", depois `vendedor_id`, depois a
--      CHECK de canal e por fim a coluna `canal` — nesta ordem, porque a
--      CHECK referencia a coluna e um `DROP COLUMN` com a constraint viva
--      levaria a constraint junto em silêncio (aqui ela cai por nome, de
--      propósito, para o arquivo dizer o que está desfazendo);
--   2. as DUAS views voltam ao corpo do baseline, SEM `codigo_barras` — elas
--      têm de voltar ANTES de a coluna cair, porque view não pode referenciar
--      coluna que já não existe;
--   3. `get_product_recommendations` volta às 30 colunas — ela também tem de
--      voltar ANTES de a coluna cair, pela mesma razão das views: o corpo
--      dela enumera as colunas na mão sobre `RETURNS SETOF public.produtos`;
--   4. `authenticated` perde o SELECT da coluna (dentro de uma guarda `DO $$`,
--      porque `REVOKE` por coluna não aceita `IF EXISTS`), os dois índices
--      únicos caem e por fim as duas colunas `codigo_barras`.
--
-- POR QUE `DROP VIEW` + `CREATE VIEW` (nunca `CREATE OR REPLACE VIEW`) NAS
-- DUAS VIEWS: `OR REPLACE` não consegue TIRAR coluna de uma view existente —
-- o Postgres recusa com "cannot drop columns from view". No banco em que este
-- rollback roda, as views TÊM `codigo_barras` (foi a migration que a pôs); o
-- alvo tem uma coluna a MENOS. Mesmo motivo documentado no rollback da
-- 20261150000000 (:27-40) e no da 20261140000000.
--
-- POR QUE OS `GRANT` EXPLÍCITOS DEPOIS DE CADA `CREATE VIEW`: `DROP VIEW`
-- apaga o ACL da view junto. Sem refazer os grants, a view voltaria a existir
-- mas MUDA — a vitrine anônima (`anon` lendo `vw_produtos_public`) e o painel
-- (`authenticated` gravando por `vw_produtos_admin`) parariam na hora, com
-- "permission denied", e o rollback teria feito um estrago MAIOR que a
-- migration. O quadro refeito abaixo é o quadro VIVO, medido em
-- 20261090000000_anon_nao_nasce_com_poder_de_escrever_em_produtos.sql:142-160:
-- `anon` NÃO escreve em nenhuma das duas (só LÊ — inclusive a `vw_produtos_
-- admin`, onde enxerga 0 linhas porque o `WHERE public.is_admin()` do corpo
-- filtra; resíduo registrado como pendência em 20261090000000:84-89);
-- `authenticated` lê as duas e escreve SÓ na `vw_produtos_admin` (é a porta de
-- cadastro de produto do painel). O `COMMENT ON VIEW` de `vw_produtos_admin`
-- (baseline:4370) também morre com o `DROP VIEW`, por isso é reescrito: o
-- rollback tem de reproduzir o objeto vivo, comentário incluído.
--
-- E POR QUE OS `REVOKE` DEPOIS DE CADA `CREATE VIEW` — a parte que quase
-- passou batida: refazer só os grants NÃO basta, porque o `CREATE VIEW` não
-- nasce sem ACL. O `ALTER DEFAULT PRIVILEGES` do schema `public` deste banco
-- devolve a `anon` E a `authenticated` o PACOTE INTEIRO de privilégios em toda
-- relação nova criada por `postgres`/`supabase_admin` (medido em 04/09/2026 e
-- escrito com prazo em 20261090000000:75-83: «CREATE OR REPLACE VIEW preserva
-- a ACL, mas DROP+CREATE não — a próxima mudança de coluna em
-- vw_produtos_admin a faz RENASCER com o pacote inteiro. Foi exatamente assim
-- que a porta que este arquivo fecha nasceu»). É por isso que a migration de
-- IDA não precisa de REVOKE nenhum (ela usa `CREATE OR REPLACE`, que preserva
-- a ACL) e este rollback precisa: aqui o `DROP` é inevitável, porque
-- `OR REPLACE` não tira coluna. Sem os quatro `REVOKE` abaixo, o rollback
-- DEVOLVERIA a `anon` o INSERT/UPDATE/DELETE que a 20260821000100 e a
-- 20261090000000 fecharam — e nenhuma das duas views é `security_invoker`,
-- então uma escrita por elas roda com o crachá do DONO, por cima da RLS de
-- `produtos`: com a chave anônima que vai no bundle do site, um visitante
-- zeraria `preco_venda` do catálogo inteiro. As quatro linhas são as de
-- 20261090000000:114-129, repetidas aqui de propósito — aquele arquivo exige
-- ser autossuficiente «se um DROP+CREATE da view fizer o pacote renascer»
-- (:123-127), e este, que É o DROP+CREATE, também.
--
-- O QUE ESTES `GRANT` NÃO REFAZEM, dito de propósito: privilégio de ESCRITA
-- de `service_role` em `vw_produtos_public`. O repositório nunca mediu esse
-- canto (a varredura de 20261090000000:142-160 cobre `anon` e
-- `authenticated`, não `service_role`), e este arquivo não inventa privilégio
-- que ninguém conferiu. Na prática não falta a ninguém: as sete chamadas de
-- `vw_produtos_public` em `src/` são todas `.from(...)` de leitura, e nenhuma
-- edge function escreve nessa view. Se um dia alguém medir e faltar, é um
-- `GRANT` a mais aqui — não um redesenho.
--
-- ATENÇÃO — ORDEM DE INTEGRAÇÃO: reverter ANTES o código que lê/escreve as
-- colunas novas (C2 a C5: leitor de câmera, tela do PDV, filtro de canal e o
-- campo do formulário do produto). Se este rollback rodar com aquelas telas
-- ainda no ar, a próxima gravação de produto pelo painel manda uma coluna que
-- a view não tem mais e falha; e a RPC da venda presencial (C1.3), se
-- existir, some junto com a coluna `canal` de que ela depende — derrube-a
-- primeiro. `get_product_recommendations` NÃO precisa de cuidado nenhum do
-- lado do app: ela volta aqui, no mesmo arquivo, à versão de 30 colunas que
-- estava viva antes — a página de produto nem percebe.
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa) — aplicar via
-- node scripts/db-apply.cjs (uma transação por arquivo) ou psql -1.
-- ============================================================================

DROP INDEX IF EXISTS idx_marketplace_orders_presencial;

ALTER TABLE public.marketplace_orders
    DROP COLUMN IF EXISTS vendedor_id;

ALTER TABLE public.marketplace_orders
    DROP CONSTRAINT IF EXISTS marketplace_orders_canal_check;

ALTER TABLE public.marketplace_orders
    DROP COLUMN IF EXISTS canal;

DROP VIEW IF EXISTS public.vw_produtos_admin;

CREATE VIEW public.vw_produtos_admin AS
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
    comprimento_cm
   FROM public.produtos
  WHERE public.is_admin()
  WITH CASCADED CHECK OPTION;

COMMENT ON VIEW public.vw_produtos_admin IS 'Porta do admin para produtos, custo incluso. Guardada por is_admin() no WHERE, não por GRANT: no Supabase o admin é o mesmo papel authenticated do cliente. Recriada em 05/08/2026 (BANCO-010, #119) — existia, sumiu do banco sem deixar migration, e o cadastro de produto ficou quebrado.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vw_produtos_admin TO authenticated;
GRANT ALL ON public.vw_produtos_admin TO service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_admin FROM anon;
REVOKE TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_admin FROM authenticated;

DROP VIEW IF EXISTS public.vw_produtos_public;

CREATE VIEW public.vw_produtos_public AS
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
    comprimento_cm
   FROM public.produtos
  WHERE ativo = true AND deleted_at IS NULL;

GRANT SELECT ON public.vw_produtos_public TO anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN
  ON public.vw_produtos_public FROM authenticated;

-- get_product_recommendations VOLTA às 30 colunas, antes de a coluna cair.
-- Pelo mesmo motivo que a migration a recriou com 31: a função é `RETURNS
-- SETOF public.produtos` e enumera as colunas na mão, então o `DROP COLUMN`
-- lá embaixo a mataria ao contrário — «Number of returned columns (31) does
-- not match expected column count (30)» na primeira chamada depois do
-- rollback. O corpo abaixo é o de 20260990000000:82-146, sem uma vírgula a
-- mais: é a versão que estava viva ANTES desta migration.
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
        p.comprimento_cm
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

-- O SELECT de coluna some de `authenticated`. Este é o ÚNICO comando do
-- arquivo que não aceita `IF EXISTS` — `REVOKE` por COLUNA não tem essa
-- cláusula e explode com «column "codigo_barras" of relation "produtos" does
-- not exist» quando a coluna já não está lá (medido num Postgres 16 em
-- 16/09/2026). Como `node scripts/db-apply.cjs` envolve o arquivo INTEIRO numa
-- transação, a segunda execução do rollback — a conexão caiu no meio, ou a
-- pessoa rodou de novo para ter certeza — abortaria TUDO nesta linha e
-- devolveria um erro que aponta para o lugar errado, justamente na hora ruim
-- em que rollback é usado. Daí a guarda, no mesmo molde da que a migration usa
-- para a CHECK. A linha é no-op na primeira execução (o `DROP COLUMN` logo
-- abaixo leva o ACL da coluna junto), e fica assim mesmo: o arquivo tem de
-- DIZER em voz alta que o privilégio de coluna some, senão o próximo leitor
-- procura o REVOKE e não acha.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'produtos'
       AND column_name = 'codigo_barras'
  ) THEN
    EXECUTE 'REVOKE SELECT (codigo_barras) ON public.produtos FROM authenticated';
  END IF;
END $$;

DROP INDEX IF EXISTS produtos_codigo_barras_unico;

DROP INDEX IF EXISTS product_variants_codigo_barras_unico;

ALTER TABLE public.produtos
    DROP COLUMN IF EXISTS codigo_barras;

ALTER TABLE public.product_variants
    DROP COLUMN IF EXISTS codigo_barras;
