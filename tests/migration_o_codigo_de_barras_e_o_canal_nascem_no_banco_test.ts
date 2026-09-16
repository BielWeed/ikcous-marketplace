// @ts-nocheck
// O CÓDIGO DE BARRAS E O CANAL NASCEM NO BANCO — prova offline do par
// 20261160000000 + rollback (LOTE C1 da venda presencial/PDV, desenho em
// docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.1-5.6,
// tarefa C1.1).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem esta migration não existe onde guardar
// o código de barras do produto nem da variação (a palavra `codigo_barras`
// não aparecia em nenhum .sql do repositório), e `marketplace_orders` não
// sabe dizer se o pedido veio da vitrine ou do balcão — o painel mostraria a
// venda presencial misturada com a venda online, sem filtro possível, e o
// leitor de câmera (C2) não teria por onde procurar o produto. Cada asserção
// abaixo está amarrada a uma dessas ameaças, ou às três armadilhas que já
// custaram caro neste repositório: perder o `WITH CASCADED CHECK OPTION` da
// view do painel (derruba o cadastro de produto), deixar `custo` entrar no
// GRANT por coluna (reabre o vazamento de margem que a 20261070000000
// fechou) e reintroduzir `BEGIN`/`COMMIT` numa migration (gravou em produção
// uma vez).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();

// Por que NÃO usar `removerRuido` nas asserções de conteúdo: ele troca toda
// string literal por `''`, e metade do que esta migration promete ESTÁ na
// string (`DEFAULT 'online'`, `CHECK (canal IN ('online','presencial'))`).
// Aqui basta apagar as linhas de comentário `--` (o cabeçalho longo descreve
// o SQL quase palavra por palavra; sem isso o teste passaria só com o
// cabeçalho escrito e o SQL ausente). `removerRuido` continua sendo quem
// alimenta a Fase 0 e o detector de transação, como no arquivo-molde.
const corpo = (s) => norm(s.replace(/^[ \t]*--.*$/gm, ""));
const migrationSql = corpo(migration);
const rollbackSql = corpo(rollback);

// As 30 colunas de vw_produtos_admin (baseline:4331-4360) + a nova no fim.
const COLUNAS_ADMIN = [
  "id",
  "nome",
  "descricao",
  "categoria",
  "codigo",
  "custo",
  "preco_venda",
  "estoque",
  "estoque_minimo",
  "fornecedor_id",
  "ativo",
  "tags",
  "data_cadastro",
  "ultima_atualizacao",
  "imagem_url",
  "meta_title",
  "meta_description",
  "imagem_urls",
  "preco_original",
  "is_bestseller",
  "frete_gratis",
  "sold",
  "deleted_at",
  "calculated_points",
  "rating",
  "review_count",
  "peso_kg",
  "largura_cm",
  "altura_cm",
  "comprimento_cm",
  "codigo_barras",
];

// As 26 colunas de vw_produtos_public (baseline:4378-4403) + a nova no fim.
const COLUNAS_PUBLIC = [
  "id",
  "nome",
  "descricao",
  "preco_venda",
  "preco_original",
  "estoque",
  "imagem_url",
  "imagem_urls",
  "categoria",
  "ativo",
  "data_cadastro",
  "tags",
  "meta_title",
  "meta_description",
  "is_bestseller",
  "frete_gratis",
  "sold",
  "calculated_points",
  "codigo",
  "ultima_atualizacao",
  "rating",
  "review_count",
  "peso_kg",
  "largura_cm",
  "altura_cm",
  "comprimento_cm",
  "codigo_barras",
];

// As 29 colunas de 20261070000000:56-86, na MESMA ordem, + codigo_barras.
const COLUNAS_GRANT = [
  "id",
  "nome",
  "descricao",
  "categoria",
  "codigo",
  "preco_venda",
  "preco_original",
  "imagem_url",
  "imagem_urls",
  "estoque",
  "estoque_minimo",
  "ativo",
  "deleted_at",
  "data_cadastro",
  "ultima_atualizacao",
  "peso_kg",
  "altura_cm",
  "largura_cm",
  "comprimento_cm",
  "frete_gratis",
  "tags",
  "meta_title",
  "meta_description",
  "rating",
  "review_count",
  "sold",
  "calculated_points",
  "fornecedor_id",
  "is_bestseller",
  "codigo_barras",
];

/**
 * Recorta o bloco entre `inicio` e o primeiro `fim` depois dele, já sem
 * comentário e com espaço normalizado. É o que permite afirmar ORDEM de
 * coluna: `assertStringIncludes` sozinho diria "a palavra está lá", nunca
 * "está no lugar certo" — e `CREATE OR REPLACE VIEW` explode no banco se
 * qualquer coluna antiga trocar de posição.
 */
function bloco(sqlSemComentario, inicio, fim) {
  const i = sqlSemComentario.indexOf(inicio);
  assert(i !== -1, `trecho não encontrado: ${inicio}`);
  const j = sqlSemComentario.indexOf(fim, i);
  assert(j !== -1, `fim do trecho não encontrado: ${fim}`);
  return sqlSemComentario.slice(i, j + fim.length);
}

/** Afirma que cada nome aparece DEPOIS do anterior (cursor crescente). */
function afirmarOrdem(texto, nomes, onde) {
  let cursor = 0;
  for (const nome of nomes) {
    const idx = texto.indexOf(nome, cursor);
    assert(
      idx !== -1 && idx >= cursor,
      `coluna "${nome}" ausente ou fora de ordem em ${onde} (a partir da posição ${cursor})`,
    );
    cursor = idx + nome.length;
  }
}

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

Deno.test("codigo_barras nasce text e aditiva nas duas tabelas (EAN-13 tem zero a esquerda: nunca numerico)", () => {
  assertStringIncludes(
    migrationSql,
    norm(
      "ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS codigo_barras text;",
    ),
  );
  assertStringIncludes(
    migrationSql,
    norm(
      "ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS codigo_barras text;",
    ),
  );
});

Deno.test("os dois indices unicos parciais, com a assimetria do deleted_at (product_variants nao tem soft delete)", () => {
  assertStringIncludes(
    migrationSql,
    norm(
      `CREATE UNIQUE INDEX IF NOT EXISTS produtos_codigo_barras_unico
         ON public.produtos (codigo_barras)
         WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL;`,
    ),
  );
  assertStringIncludes(
    migrationSql,
    norm(
      `CREATE UNIQUE INDEX IF NOT EXISTS product_variants_codigo_barras_unico
         ON public.product_variants (codigo_barras)
         WHERE codigo_barras IS NOT NULL;`,
    ),
  );
  // A assimetria é o ponto: `product_variants` não tem `deleted_at`
  // (baseline:4041-4053), então pedir o predicado lá seria erro de SQL —
  // e copiar o predicado da variante para o produto deixaria um produto
  // APAGADO travando o código de barras de um produto novo.
  const indiceVariante = bloco(
    migrationSql,
    "CREATE UNIQUE INDEX IF NOT EXISTS product_variants_codigo_barras_unico",
    ";",
  );
  assert(
    !indiceVariante.includes("deleted_at"),
    "o índice da variante não pode filtrar por deleted_at — a tabela não tem essa coluna",
  );
});

Deno.test("o GRANT por coluna de produtos lista as 30 colunas na ordem e NUNCA custo", () => {
  const blocoGrant = bloco(
    migrationSql,
    "GRANT SELECT (",
    ") ON public.produtos TO authenticated;",
  );
  afirmarOrdem(blocoGrant, COLUNAS_GRANT, "o GRANT SELECT de produtos");
  assert(
    !blocoGrant.includes("custo"),
    "custo NÃO pode entrar no GRANT — reabriria o vazamento de margem que a 20261070000000 fechou",
  );
  // `codigo_barras` colada no fecha-parêntese prova que ela é o ÚLTIMO nome
  // da lista — a ordem dos 29 anteriores é a de 20261070000000:56-86.
  assertStringIncludes(
    blocoGrant,
    norm("codigo_barras ) ON public.produtos TO authenticated;"),
  );
});

Deno.test("vw_produtos_public: 26 colunas antigas na ordem + codigo_barras no fim, sem security_invoker", () => {
  assertEquals(COLUNAS_PUBLIC.length, 27, "26 antigas + 1 nova");
  const blocoPublic = bloco(
    migrationSql,
    "CREATE OR REPLACE VIEW public.vw_produtos_public AS",
    "WHERE ativo = true AND deleted_at IS NULL;",
  );
  afirmarOrdem(blocoPublic, COLUNAS_PUBLIC, "vw_produtos_public");
  // `codigo_barras` colada no FROM prova que ela é a ÚLTIMA — coluna nova no
  // meio faria `CREATE OR REPLACE VIEW` recusar no banco.
  assertStringIncludes(blocoPublic, "codigo_barras FROM public.produtos");
  assert(
    !blocoPublic.includes("security_invoker"),
    "vw_produtos_public é a exceção deliberada sem security_invoker (.claude/commands/nova-migration.md:67) — ligar isso derruba a vitrine anônima",
  );
});

Deno.test("vw_produtos_admin: 30 colunas antigas na ordem + codigo_barras no fim, is_admin() e WITH CASCADED CHECK OPTION", () => {
  assertEquals(COLUNAS_ADMIN.length, 31, "30 antigas + 1 nova");
  const blocoAdmin = bloco(
    migrationSql,
    "CREATE OR REPLACE VIEW public.vw_produtos_admin AS",
    "WITH CASCADED CHECK OPTION;",
  );
  afirmarOrdem(blocoAdmin, COLUNAS_ADMIN, "vw_produtos_admin");
  assertStringIncludes(blocoAdmin, "codigo_barras FROM public.produtos");
  assertStringIncludes(blocoAdmin, "WHERE public.is_admin()");
  // Sem o CHECK OPTION o cadastro de produto do painel quebra: a view é a
  // porta de ESCRITA do admin (20261024000000:60).
  assertStringIncludes(blocoAdmin, "WITH CASCADED CHECK OPTION;");
  assert(
    !blocoAdmin.includes("security_invoker"),
    "ligar security_invoker aqui muda quem a view enxerga — fora do escopo desta migration",
  );
});

Deno.test("marketplace_orders.canal nasce NOT NULL DEFAULT 'online' com a CHECK criada de forma idempotente", () => {
  assertStringIncludes(
    migrationSql,
    norm(
      "ALTER TABLE public.marketplace_orders ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'online';",
    ),
  );
  assertStringIncludes(
    migrationSql,
    norm(
      `DO $$
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
       END $$;`,
    ),
  );
});

Deno.test("marketplace_orders.vendedor_id e' uuid com FK para auth.users(id)", () => {
  assertStringIncludes(
    migrationSql,
    norm(
      "ALTER TABLE public.marketplace_orders ADD COLUMN IF NOT EXISTS vendedor_id uuid REFERENCES auth.users(id);",
    ),
  );
});

Deno.test("o indice parcial do chip 'Balcao' existe (presencial e' a minoria: indice inteiro seria desperdicio)", () => {
  assertStringIncludes(
    migrationSql,
    norm(
      `CREATE INDEX IF NOT EXISTS idx_marketplace_orders_presencial
         ON public.marketplace_orders (created_at DESC)
         WHERE canal = 'presencial';`,
    ),
  );
});

Deno.test("nenhuma linha de seed: a migration nao escreve DADO em produtos, product_variants nem marketplace_orders", () => {
  // Comparação por texto, não por RegExp montada em tempo de execução: o
  // `security/detect-non-literal-regexp` do repo acusa a segunda forma, e
  // aqui ela não paga nada — o SQL já vem sem comentário e com espaço
  // normalizado, então `INSERT INTO PUBLIC.PRODUTOS` é busca exata.
  const limpo = norm(removerRuido(migration)).toUpperCase();
  for (const tabela of ["PRODUTOS", "PRODUCT_VARIANTS", "MARKETPLACE_ORDERS"]) {
    assert(
      !limpo.includes(`INSERT INTO PUBLIC.${tabela}`),
      `migration contém INSERT em ${tabela} — esta migration é só de esquema`,
    );
    assert(
      !limpo.includes(`UPDATE PUBLIC.${tabela}`),
      `migration contém UPDATE em ${tabela} — o DEFAULT 'online' é o que faz os pedidos antigos nascerem coerentes, sem reescrever linha`,
    );
    assert(
      !limpo.includes(`DELETE FROM PUBLIC.${tabela}`),
      `migration contém DELETE em ${tabela} — esta migration é só de esquema`,
    );
  }
});

Deno.test("rollback: as duas views voltam por DROP VIEW + CREATE VIEW e com os GRANTs refeitos a mao", () => {
  // `CREATE OR REPLACE VIEW` não consegue TIRAR coluna ("cannot drop columns
  // from view"), por isso o rollback derruba e recria — e o DROP leva o ACL
  // junto, daí os GRANTs explícitos logo depois.
  assertStringIncludes(
    rollbackSql,
    "DROP VIEW IF EXISTS public.vw_produtos_admin;",
  );
  assertStringIncludes(
    rollbackSql,
    "DROP VIEW IF EXISTS public.vw_produtos_public;",
  );
  assertStringIncludes(
    rollbackSql,
    norm(
      "GRANT SELECT ON public.vw_produtos_public TO anon, authenticated, service_role;",
    ),
  );
  assertStringIncludes(
    rollbackSql,
    norm(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.vw_produtos_admin TO authenticated;",
    ),
  );
  assertStringIncludes(
    rollbackSql,
    norm("GRANT ALL ON public.vw_produtos_admin TO service_role;"),
  );
});

Deno.test("rollback: depois de cada CREATE VIEW os REVOKEs de escrita voltam (o DROP faz o pacote renascer)", () => {
  // POR QUE ESTE TESTE EXISTE: `ALTER DEFAULT PRIVILEGES` do schema public
  // devolve a `anon` e a `authenticated` o pacote INTEIRO de privilégios em
  // TODA relação nova criada por postgres/supabase_admin — medido pelo próprio
  // repositório em 20261090000000_anon_nao_nasce_com_poder_de_escrever_em_
  // produtos.sql:75-83. `CREATE OR REPLACE VIEW` preserva o ACL antigo (por
  // isso a migration de IDA não precisa disto), mas `DROP VIEW` + `CREATE
  // VIEW` — que é o único caminho do rollback, porque OR REPLACE não tira
  // coluna — faz o pacote RENASCER. Sem estes REVOKEs, o rollback devolveria a
  // `anon` o UPDATE/DELETE na vitrine que a 20260821000100 fechou: com a chave
  // anônima que vai no bundle do site, um visitante zeraria `preco_venda` do
  // catálogo inteiro pela view (e as duas views NÃO são security_invoker, então
  // a escrita por elas roda com o crachá do dono, por cima da RLS de
  // `produtos`). As quatro linhas abaixo são as de 20261090000000:114-129,
  // repetidas aqui porque aquele arquivo exige ser autossuficiente (:123-127) —
  // e este também.
  for (const revoke of [
    "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_admin FROM anon;",
    "REVOKE TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_admin FROM authenticated;",
    "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_public FROM anon;",
    "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_public FROM authenticated;",
  ]) {
    assertStringIncludes(rollbackSql, norm(revoke));
  }
  // E depois do CREATE, nunca antes: revogar de uma view que ainda vai ser
  // derrubada é no-op, e o pacote renasceria intocado.
  for (const view of ["vw_produtos_admin", "vw_produtos_public"]) {
    assert(
      rollbackSql.indexOf(`CREATE VIEW public.${view} AS`) <
        rollbackSql.indexOf(
          `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.${view} FROM anon;`,
        ),
      `os REVOKE de ${view} têm de vir DEPOIS do CREATE VIEW — antes dele são no-op`,
    );
  }
});

Deno.test("rollback: as views recriadas NAO listam codigo_barras (e a admin mantem o CHECK OPTION)", () => {
  const blocoAdmin = bloco(
    rollbackSql,
    "CREATE VIEW public.vw_produtos_admin AS",
    "WITH CASCADED CHECK OPTION;",
  );
  assert(
    !blocoAdmin.includes("codigo_barras"),
    "a view do rollback não pode listar codigo_barras — a coluna é derrubada logo depois",
  );
  afirmarOrdem(
    blocoAdmin,
    COLUNAS_ADMIN.slice(0, -1),
    "vw_produtos_admin do rollback",
  );
  const blocoPublic = bloco(
    rollbackSql,
    "CREATE VIEW public.vw_produtos_public AS",
    "WHERE ativo = true AND deleted_at IS NULL;",
  );
  assert(
    !blocoPublic.includes("codigo_barras"),
    "a view do rollback não pode listar codigo_barras — a coluna é derrubada logo depois",
  );
  afirmarOrdem(
    blocoPublic,
    COLUNAS_PUBLIC.slice(0, -1),
    "vw_produtos_public do rollback",
  );
});

Deno.test("rollback desfaz tudo na ordem inversa: canal/vendedor_id antes, codigo_barras depois", () => {
  assertStringIncludes(
    rollbackSql,
    norm("DROP INDEX IF EXISTS idx_marketplace_orders_presencial;"),
  );
  assertStringIncludes(
    rollbackSql,
    norm(
      "ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS vendedor_id;",
    ),
  );
  assertStringIncludes(
    rollbackSql,
    norm(
      "ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_canal_check;",
    ),
  );
  assertStringIncludes(
    rollbackSql,
    norm("ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS canal;"),
  );
  // O REVOKE por coluna mora dentro de uma guarda `DO $$` e tem teste
  // próprio ("o REVOKE por coluna e' idempotente", mais abaixo): REVOKE de
  // coluna não aceita `IF EXISTS` e explodiria na segunda execução do
  // rollback. Aqui basta provar que ele acontece ANTES dos DROP INDEX.
  assertStringIncludes(
    rollbackSql,
    norm(
      "EXECUTE 'REVOKE SELECT (codigo_barras) ON public.produtos FROM authenticated'",
    ),
  );
  assertStringIncludes(
    rollbackSql,
    norm("DROP INDEX IF EXISTS produtos_codigo_barras_unico;"),
  );
  assertStringIncludes(
    rollbackSql,
    norm("DROP INDEX IF EXISTS product_variants_codigo_barras_unico;"),
  );
  assertStringIncludes(
    rollbackSql,
    norm("ALTER TABLE public.produtos DROP COLUMN IF EXISTS codigo_barras;"),
  );
  assertStringIncludes(
    rollbackSql,
    norm(
      "ALTER TABLE public.product_variants DROP COLUMN IF EXISTS codigo_barras;",
    ),
  );
  // A ordem importa de verdade: a view referencia a coluna, então ela tem de
  // ser recriada ANTES do DROP COLUMN.
  assert(
    rollbackSql.indexOf("DROP VIEW IF EXISTS public.vw_produtos_public;") <
      rollbackSql.indexOf(
        "ALTER TABLE public.produtos DROP COLUMN IF EXISTS codigo_barras;",
      ),
    "as views têm de voltar ANTES de a coluna codigo_barras cair",
  );
});

// As 31 entradas do RETURN QUERY de get_product_recommendations, na ordem em
// que o corpo vivo (20260990000000:88-119) as escreve: `custo` e
// `fornecedor_id` continuam saindo como NULL literal (é o que aquela migration
// fechou) e `codigo_barras` entra no FIM, porque é a 31ª coluna de `produtos`.
const RETORNO_RECOMENDACOES = [
  "p.id",
  "p.nome",
  "p.descricao",
  "p.categoria",
  "p.codigo",
  "NULL::numeric(10,2)",
  "p.preco_venda",
  "p.estoque",
  "p.estoque_minimo",
  "NULL::uuid",
  "p.ativo",
  "p.tags",
  "p.data_cadastro",
  "p.ultima_atualizacao",
  "p.imagem_url",
  "p.meta_title",
  "p.meta_description",
  "p.imagem_urls",
  "p.preco_original",
  "p.is_bestseller",
  "p.frete_gratis",
  "p.sold",
  "p.deleted_at",
  "p.calculated_points",
  "p.rating",
  "p.review_count",
  "p.peso_kg",
  "p.largura_cm",
  "p.altura_cm",
  "p.comprimento_cm",
  "p.codigo_barras",
];

const ASSINATURA_RECOMENDACOES =
  "CREATE OR REPLACE FUNCTION public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4)";

Deno.test("a migration recria get_product_recommendations com a 31a coluna (o ADD COLUMN muda o tipo de retorno RETURNS SETOF public.produtos)", () => {
  // POR QUE ESTE TESTE EXISTE — MEDIDO num Postgres 16 de verdade em
  // 16/09/2026: `get_product_recommendations` é `RETURNS SETOF
  // public.produtos` e o corpo dela ENUMERA as colunas na mão (para trocar
  // `custo` e `fornecedor_id` por NULL, 20260990000000:88-119). Acrescentar a
  // 31ª coluna a `produtos` muda o tipo composto de retorno, e o plpgsql passa
  // a recusar a consulta em TEMPO DE CHAMADA: «structure of query does not
  // match function result type / Number of returned columns (30) does not
  // match expected column count (31)». A migration aplicaria VERDE e a RPC
  // morreria depois, calada: `fetchRecommendations` cai no catch e usa o
  // fallback local (src/hooks/useProducts.ts:1248-1281), então a vitrine não
  // quebra na cara do usuário — ela degrada para sempre com um console.error
  // que ninguém lê. Por isso a companheira entra NESTA migration.
  const blocoFuncao = bloco(
    migrationSql,
    ASSINATURA_RECOMENDACOES,
    "$function$;",
  );
  assertStringIncludes(blocoFuncao, "RETURNS SETOF public.produtos");
  // O crachá não muda: continua SECURITY DEFINER com search_path fixo — é
  // recriação para acompanhar a coluna, não redesenho.
  assertStringIncludes(blocoFuncao, "SECURITY DEFINER");
  assertStringIncludes(blocoFuncao, "SET search_path TO 'public'");
  afirmarOrdem(
    blocoFuncao,
    RETORNO_RECOMENDACOES,
    "o RETURN QUERY de get_product_recommendations",
  );
  // `codigo_barras` colada no FROM prova que ela é a ÚLTIMA — no meio, cada
  // coluna cairia numa posição de tipo diferente do esperado.
  assertStringIncludes(
    blocoFuncao,
    "p.comprimento_cm, p.codigo_barras FROM produtos p",
  );
  // E o que a 20260990000000 fechou continua fechado: nem `custo` nem
  // `fornecedor_id` voltam a sair por aqui.
  assert(
    !blocoFuncao.includes("p.custo"),
    "custo tem de continuar saindo como NULL desta RPC (20260990000000)",
  );
  assert(
    !blocoFuncao.includes("p.fornecedor_id"),
    "fornecedor_id tem de continuar saindo como NULL desta RPC (20260990000000)",
  );
  // A função só pode ser recriada DEPOIS de a coluna existir.
  assert(
    migrationSql.indexOf(
      "ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS codigo_barras text;",
    ) < migrationSql.indexOf(ASSINATURA_RECOMENDACOES),
    "a função tem de ser recriada DEPOIS do ADD COLUMN — antes dele o tipo de retorno ainda tem 30 colunas",
  );
});

Deno.test("rollback: get_product_recommendations volta as 30 colunas ANTES de codigo_barras cair", () => {
  const blocoFuncao = bloco(
    rollbackSql,
    ASSINATURA_RECOMENDACOES,
    "$function$;",
  );
  assert(
    !blocoFuncao.includes("codigo_barras"),
    "a função do rollback não pode listar codigo_barras — a coluna é derrubada logo depois e a RPC morreria do mesmo jeito, ao contrário",
  );
  assertStringIncludes(blocoFuncao, "p.comprimento_cm FROM produtos p");
  assertStringIncludes(blocoFuncao, "RETURNS SETOF public.produtos");
  assert(
    rollbackSql.indexOf(ASSINATURA_RECOMENDACOES) <
      rollbackSql.indexOf(
        "ALTER TABLE public.produtos DROP COLUMN IF EXISTS codigo_barras;",
      ),
    "a função de 30 colunas tem de voltar ANTES do DROP COLUMN",
  );
});

Deno.test("rollback: o REVOKE por coluna e' idempotente (REVOKE de coluna nao aceita IF EXISTS)", () => {
  // MEDIDO no mesmo Postgres 16: `REVOKE SELECT (codigo_barras) ON
  // public.produtos FROM authenticated;` com a coluna já ausente devolve
  // «ERROR: column "codigo_barras" of relation "produtos" does not exist».
  // Como `node scripts/db-apply.cjs` envolve o arquivo INTEIRO numa transação,
  // a segunda execução do rollback abortaria TUDO nesta linha — e a pessoa
  // leria "coluna não existe" no meio de um rollback de emergência, sem saber
  // se ele pegou. Era o único comando do arquivo sem guarda: os outros nove
  // carregam `IF EXISTS`.
  assertStringIncludes(
    rollbackSql,
    norm(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'produtos'
              AND column_name = 'codigo_barras'
         ) THEN
           EXECUTE 'REVOKE SELECT (codigo_barras) ON public.produtos FROM authenticated';
         END IF;
       END $$;`,
    ),
  );
});
