// @ts-nocheck
// O BALCÃO ACHA O PRODUTO PELO CÓDIGO — prova offline do par 20261161000000 +
// rollback (LOTE C1 da venda presencial/PDV, desenho em
// docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.3,
// tarefa C1.2).
//
// O DEFEITO QUE ESTE TESTE FIXA: a C1.1 abriu as duas colunas `codigo_barras`,
// mas ninguém sabe PERGUNTAR por elas. Sem esta RPC, a tela do PDV (C3) teria
// de montar a busca no cliente — e aí cada uma das quatro armadilhas abaixo
// vira dinheiro errado no balcão:
//   (a) buscar com `ILIKE`/`LIKE` joga fora os dois índices únicos parciais da
//       C1.1 (varredura de tabela a cada bipe) e acha o produto ERRADO quando
//       um EAN é prefixo de outro;
//   (b) preço vindo do cliente é preço que o cliente escolhe — o preço tem de
//       sair do banco pela MESMA regra do checkout online,
//       `COALESCE(v.price_override, p.preco_venda)` (20261081000000:227 e
//       src/lib/preco-vendido.ts:19-24), senão a variação com override zero
//       (brinde) é cobrada pelo preço cheio;
//   (c) devolver NULL quando o código não existe obriga a tela a adivinhar se
//       foi "não cadastrado", "inativo" ou "erro" — o contrato é sempre o
//       mesmo jsonb, com as mesmas chaves;
//   (d) função nova nasce com EXECUTE para PUBLIC: sem o REVOKE, o visitante
//       anônimo varre o catálogo inteiro por código (foi esse resíduo que a
//       20261090500000 teve de limpar em massa).
// Cada asserção abaixo está amarrada a uma dessas ameaças, ou à armadilha da
// casa: reintroduzir `BEGIN`/`COMMIT` numa migration (já gravou em produção).
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
const NOME = "20261161000000_o_balcao_acha_o_produto_pelo_codigo.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();

// Por que as asserções de conteúdo NÃO rodam sobre `removerRuido`: ele apaga o
// dollar-quote INTEIRO (scripts/db-prove-rollback.cjs:203-221) — ou seja, todo
// o corpo da função vira um espaço. Um teste escrito sobre ele passaria com a
// função VAZIA. Aqui basta apagar as linhas de comentário `--`: o cabeçalho
// longo descreve o SQL quase palavra por palavra, e sem essa limpeza o teste
// passaria só com o cabeçalho escrito e o SQL ausente. `removerRuido` continua
// sendo quem alimenta a Fase 0 e o detector de transação, como no arquivo-molde
// (tests/migration_o_codigo_de_barras_e_o_canal_nascem_no_banco_test.ts).
const corpo = (s) => norm(s.replace(/^[ \t]*--.*$/gm, ""));
const migrationSql = corpo(migration);
const rollbackSql = corpo(rollback);

const ASSINATURA =
  "CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo text)";

/**
 * Recorta o bloco entre `inicio` e o primeiro `fim` depois dele, já sem
 * comentário e com espaço normalizado. É o que permite afirmar ORDEM (o gate
 * de admin ANTES da primeira leitura de tabela): `assertStringIncludes`
 * sozinho diria "a palavra está lá", nunca "está no lugar certo".
 */
function bloco(sql, inicio, fim) {
  const i = sql.indexOf(inicio);
  assert(i !== -1, `trecho não encontrado: ${inicio}`);
  const j = sql.indexOf(fim, i);
  assert(j !== -1, `fim do trecho não encontrado: ${fim}`);
  return sql.slice(i, j + fim.length);
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

Deno.test("a assinatura e' exatamente a que C3 vai chamar, com o cracha' de RPC admin", () => {
  // Assinatura errada = o job "Código x banco" do CI
  // (scripts/db-check-objetos-do-codigo.mjs:20-27) acusa INALCANÇÁVEL assim
  // que a tela do PDV chamar a RPC. STABLE porque a função só LÊ.
  assertStringIncludes(
    migrationSql,
    norm(
      `${ASSINATURA} RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
       SET search_path = pg_catalog, pg_temp AS $function$`,
    ),
  );
});

Deno.test("o gate de admin e' a PRIMEIRA instrucao do corpo (D6: so' a loja bipa)", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  assertStringIncludes(
    corpoFn,
    norm(
      `IF public.is_admin() IS DISTINCT FROM true THEN
         RAISE EXCEPTION USING ERRCODE='42501',
           MESSAGE='Acesso negado: só a loja consulta código de barras.';
       END IF;`,
    ),
  );
  // ORDEM, não só presença: com SECURITY DEFINER a função roda com o crachá do
  // dono, por cima da RLS. Uma leitura de tabela ANTES do gate já é o catálogo
  // vazando (preço de custo do concorrente é o de menos: `estoque` e `ativo`
  // são inteligência de loja).
  const iGate = corpoFn.indexOf("IF public.is_admin()");
  const iLeitura = corpoFn.indexOf("FROM public.product_variants");
  assert(iGate !== -1 && iLeitura !== -1, "gate ou leitura ausentes");
  assert(
    iGate < iLeitura,
    "o gate de admin tem de vir ANTES de qualquer leitura de tabela",
  );
  assert(
    iGate < corpoFn.indexOf("v_codigo :="),
    "o gate de admin é a PRIMEIRA instrução do corpo, antes até da normalização do parâmetro",
  );
});

Deno.test("codigo vazio e codigo gigante sao recusados com 22023 (o leitor fisico e' um teclado)", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  // O `btrim` de DOIS argumentos não é preciosismo: `btrim(text)` de um
  // argumento só apara ESPAÇO (' '), nunca \n, \r ou \t. Medido no Postgres 16
  // deste repo: `btrim(E'7891000000011\r\n')` devolve os 15 caracteres, com o
  // CRLF inteiro. O leitor físico é um teclado e termina o bipe com Enter
  // (src/lib/leitor/buffer-do-leitor-fisico.ts), e EAN colado de planilha do
  // fornecedor vem com \r\n — com a forma de um argumento a RPC responde
  // "não cadastrado" para produto que ESTÁ cadastrado, e a entrada só-branco
  // escapa do 22023 e ainda ecoa caracteres de controle em `codigo`.
  assertStringIncludes(
    corpoFn,
    norm(String.raw`v_codigo := NULLIF(btrim(p_codigo, E' \t\r\n'), '');`),
  );
  assert(
    !/btrim\s*\(\s*p_codigo\s*\)/.test(corpoFn),
    "btrim(p_codigo) de UM argumento apara só espaço: o Enter do leitor e o \\r\\n da planilha passariam na comparação e o balcão diria 'não cadastrado'",
  );
  assertStringIncludes(
    corpoFn,
    norm(
      `IF v_codigo IS NULL THEN
         RAISE EXCEPTION USING ERRCODE='22023',
           MESSAGE='Informe o código de barras.';
       END IF;`,
    ),
  );
  // Teto de tamanho: buffer estragado do leitor não pode virar uma chave de
  // 1 MB comparada linha a linha.
  assertStringIncludes(
    corpoFn,
    norm(
      `IF length(v_codigo) > 64 THEN
         RAISE EXCEPTION USING ERRCODE='22023',
           MESSAGE='Código de barras inválido.';
       END IF;`,
    ),
  );
});

Deno.test("a busca e' IGUALDADE EXATA nas duas colunas — nenhum ILIKE/LIKE no arquivo", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  // As duas comparações: a da variação primeiro (a embalagem é que é bipada),
  // a do produto pai depois.
  assertStringIncludes(corpoFn, norm("WHERE v.codigo_barras = v_codigo"));
  assertStringIncludes(corpoFn, norm("WHERE p.codigo_barras = v_codigo"));
  // PRECEDÊNCIA — é a regra de negócio que esta tarefa foi criada para decidir
  // (a C1.1 registrou que a unicidade do código é POR TABELA, logo o mesmo EAN
  // pode existir no produto E numa variação). Inverter a ordem parece inócuo
  // num diff, mas devolve origem='produto' com `p.preco_venda` para a caixa
  // que tem `price_override` — o brinde de override zero cobrado pelo preço
  // cheio, exatamente o defeito que src/lib/preco-vendido.ts existe para matar.
  assert(
    corpoFn.indexOf("FROM public.product_variants v JOIN") <
      corpoFn.indexOf("FROM public.produtos p WHERE p.codigo_barras"),
    "a variação é procurada ANTES do produto pai: é a caixa dela que é bipada",
  );
  // `=` é o que faz os índices únicos parciais da C1.1 valerem. Busca
  // aproximada aqui seria varredura de tabela a cada bipe — e acharia o
  // produto errado quando um EAN é prefixo de outro.
  assert(
    !/\bI?LIKE\b/i.test(migrationSql),
    "nenhuma forma de LIKE/ILIKE pode aparecer: a busca por código de barras é igualdade exata",
  );
  assert(
    !/similarity|unaccent|pg_trgm/i.test(migrationSql),
    "nada de similaridade/trigram: a busca aproximada por nome/SKU é assunto de get_admin_products_paged (C3)",
  );
});

Deno.test("produto e variacao desaparecem pelas regras certas: deleted_at (soft delete) e active", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  // Produto com deleted_at preenchido é INEXISTENTE
  // (.claude/commands/nova-migration.md:162) — as DUAS buscas filtram por ele.
  assertEquals(
    corpoFn.split("p.deleted_at IS NULL").length - 1,
    2,
    "as duas buscas (variante e produto pai) têm de filtrar p.deleted_at IS NULL",
  );
  assertStringIncludes(corpoFn, norm("AND v.active = true"));
  // `product_variants` NÃO tem deleted_at (baseline:4041-4053): pedir a coluna
  // lá seria erro de SQL em tempo de execução.
  assert(
    !corpoFn.includes("v.deleted_at") && !corpoFn.includes("v2.deleted_at"),
    "product_variants não tem deleted_at — a variação some por active = false",
  );
  // Produto inativo É devolvido, com ativo:false: "inativo" é um terceiro caso
  // honesto, diferente de "não cadastrado" e de "esgotado". Se a busca
  // filtrasse por ativo, a tela não teria como contar a diferença.
  assert(
    !corpoFn.includes("p.ativo = true"),
    "produto inativo tem de ser DEVOLVIDO (com ativo:false), não escondido",
  );
});

Deno.test("o preco sai do banco pela regra do checkout — nunca do cliente", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  // A MESMA regra do servidor na v23 (20261081000000:227) e do front
  // (src/lib/preco-vendido.ts:19-24): só cai no preço do produto quando o
  // override é NULL, porque zero é preço legítimo.
  assertStringIncludes(
    corpoFn,
    norm("COALESCE(v.price_override, p.preco_venda)"),
  );
  assertStringIncludes(
    corpoFn,
    norm("COALESCE(v2.price_override, p.preco_venda)"),
  );
  // A função recebe UM parâmetro só: preço, estoque e nome não entram por
  // parâmetro nenhum.
  assertStringIncludes(migrationSql, `${ASSINATURA} RETURNS jsonb`);
  for (const proibido of ["p_preco", "p_estoque", "p_nome", "p_quantidade"]) {
    assert(
      !migrationSql.includes(proibido),
      `${proibido} não existe nesta RPC: tudo sai do banco`,
    );
  }
});

Deno.test("o retorno tem SEMPRE as mesmas chaves, inclusive quando nao achou nada", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  const retorno = bloco(corpoFn, "RETURN jsonb_build_object(", ");");
  for (const chave of [
    "'encontrado'",
    "'origem'",
    "'codigo'",
    "'produto'",
    "'variante'",
    "'preco'",
    "'estoque'",
    "'variacoes'",
  ]) {
    assertStringIncludes(retorno, chave);
  }
  // Um RETURN só, no fim: dois caminhos de saída é como uma das chaves some
  // no caso raro. Código não encontrado NÃO é erro — é o mesmo objeto com
  // `encontrado` falso e o resto nulo.
  assertEquals(
    corpoFn.split("RETURN jsonb_build_object(").length - 1,
    1,
    "um único RETURN: o contrato do jsonb não pode depender do caminho",
  );
  assert(
    !/RETURN\s+NULL/i.test(corpoFn),
    "devolver NULL no lugar do objeto obriga a tela a adivinhar — o contrato é o jsonb sempre",
  );
  // `variacoes` nunca volta NULL: SELECT INTO sem linha ZERA todas as
  // variáveis de destino, então o caso "não encontrado" tem de repor a lista
  // vazia.
  // A linha que sustenta o contrato é a reposição EXPLÍCITA no ramo "não
  // encontrado" — o literal '[]'::jsonb sozinho já aparece no DECLARE e no
  // COALESCE do jsonb_agg, então não serve de prova (revisão de C1.2).
  assertStringIncludes(corpoFn, "v_variacoes := '[]'::jsonb;");
  // Os dois rótulos de origem existem E na ordem dos ramos: a variação é
  // testada primeiro (precedência), o produto pai depois.
  const posVariante = corpoFn.indexOf("v_origem := 'variante';");
  const posProduto = corpoFn.indexOf("v_origem := 'produto';");
  assert(posVariante >= 0, "falta v_origem := 'variante' no ramo da variação");
  assert(posProduto >= 0, "falta v_origem := 'produto' no ramo do produto pai");
  assert(
    posVariante < posProduto,
    "a origem 'variante' tem de ser decidida antes da 'produto' (precedência)",
  );
});

Deno.test("o produto pai devolve a folha de escolha completa das variacoes ativas", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  // `tem_variantes` é o MESMO predicado com que a v23 exige variação
  // (20261081000000:276-281): se ele mentir, o balcão vende o produto base de
  // um produto que só existe em combinação.
  assertStringIncludes(
    corpoFn,
    norm(
      `EXISTS ( SELECT 1 FROM public.product_variants v2
         WHERE v2.product_id = p.id AND v2.active = true )`,
    ),
  );
  assertStringIncludes(corpoFn, "'tem_variantes'");
  for (const chave of [
    "'variant_id', v2.id",
    "'nome', v2.name",
    "'valor', v2.value",
    "'estoque', v2.stock_increment",
    "'codigo_barras', v2.codigo_barras",
  ]) {
    assertStringIncludes(corpoFn, norm(chave));
  }
  // Ordem estável na tela: o operador escolhe por leitura, não por sorte do
  // planejador.
  assertStringIncludes(corpoFn, norm("ORDER BY v2.name ASC, v2.value ASC"));
});

Deno.test("a imagem cai para o produto e depois para a primeira do array (Postgres indexa a partir de 1)", () => {
  const corpoFn = bloco(migrationSql, ASSINATURA, "$function$;");
  assertStringIncludes(
    corpoFn,
    norm(
      "COALESCE(NULLIF(v.image_url, ''), NULLIF(p.imagem_url, ''), p.imagem_urls[1])",
    ),
  );
  assertStringIncludes(
    corpoFn,
    norm("COALESCE(NULLIF(p.imagem_url, ''), p.imagem_urls[1])"),
  );
  // `imagem_urls[0]` devolve NULL calado — o array do Postgres começa em 1.
  assert(
    !corpoFn.includes("imagem_urls[0]"),
    "array do Postgres começa em 1: imagem_urls[0] é NULL silencioso",
  );
});

Deno.test("esta migration NAO toca em tabela nenhuma (as colunas vieram da C1.1)", () => {
  const limpo = norm(removerRuido(migration)).toUpperCase();
  assert(
    !limpo.includes("ALTER TABLE"),
    "nenhum ALTER aqui: `codigo_barras`, `canal` e `vendedor_id` nasceram na 20261160000000",
  );
  for (const tabela of ["PRODUTOS", "PRODUCT_VARIANTS", "MARKETPLACE_ORDERS"]) {
    assert(
      !limpo.includes(`INSERT INTO PUBLIC.${tabela}`),
      `migration contém INSERT em ${tabela} — esta migration só cria uma função de LEITURA`,
    );
    assert(
      !limpo.includes(`UPDATE PUBLIC.${tabela}`),
      `migration contém UPDATE em ${tabela} — esta migration só cria uma função de LEITURA`,
    );
    assert(
      !limpo.includes(`DELETE FROM PUBLIC.${tabela}`),
      `migration contém DELETE em ${tabela} — esta migration só cria uma função de LEITURA`,
    );
  }
});

Deno.test("os grants: REVOKE de PUBLIC primeiro, EXECUTE so' para authenticated e service_role", () => {
  // Função nova nasce com EXECUTE para PUBLIC — sem o REVOKE, `anon` (a chave
  // que vai no bundle do site) varre o catálogo por código. Foi exatamente
  // esse resíduo que a 20261090500000 teve de limpar em massa.
  assertStringIncludes(
    migrationSql,
    norm(
      `REVOKE ALL ON FUNCTION public.buscar_por_codigo_barras(text)
         FROM PUBLIC, anon, authenticated, service_role;`,
    ),
  );
  // Sem o GRANT para `authenticated`, o job "Código x banco" acusa
  // INALCANÇÁVEL assim que C3 chamar a RPC.
  assertStringIncludes(
    migrationSql,
    norm(
      "GRANT EXECUTE ON FUNCTION public.buscar_por_codigo_barras(text) TO authenticated;",
    ),
  );
  assertStringIncludes(
    migrationSql,
    norm(
      "GRANT EXECUTE ON FUNCTION public.buscar_por_codigo_barras(text) TO service_role;",
    ),
  );
  assert(
    migrationSql.indexOf(
      "REVOKE ALL ON FUNCTION public.buscar_por_codigo_barras",
    ) <
      migrationSql.indexOf(
        "GRANT EXECUTE ON FUNCTION public.buscar_por_codigo_barras(text) TO authenticated;",
      ),
    "o REVOKE vem ANTES dos GRANT — na ordem inversa ele derrubaria o que acabou de ser dado",
  );
  assert(
    !/GRANT\s+EXECUTE[^;]*TO[^;]*\banon\b/i.test(migrationSql),
    "anon nunca executa esta RPC (D6: só a loja consulta código de barras)",
  );
});

Deno.test("rollback derruba SO' esta funcao, e nao ressuscita corpo nenhum (a funcao e' nova)", () => {
  assertStringIncludes(
    rollbackSql,
    norm("DROP FUNCTION IF EXISTS public.buscar_por_codigo_barras(text);"),
  );
  // Não há corpo anterior para restaurar: a função nasceu na 20261161000000.
  // Um `CREATE FUNCTION` aqui seria inventar um estado que nunca existiu.
  // Comparação por texto, não por RegExp com grupo opcional: o
  // `security/detect-unsafe-regex` do repo acusa a segunda forma, e aqui ela
  // não paga nada — o SQL já vem sem comentário e com espaço normalizado.
  const rollbackMaiusculo = rollbackSql.toUpperCase();
  for (const proibido of ["CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"]) {
    assert(
      !rollbackMaiusculo.includes(proibido),
      `o rollback não recria nada (${proibido}): a função é NOVA nesta migration`,
    );
  }
  // E não encosta nas colunas da C1.1 — desfazer a C1.1 é o rollback DELA.
  assert(
    !rollbackMaiusculo.includes("ALTER TABLE"),
    "o rollback desta tarefa não mexe em coluna: `codigo_barras` é da 20261160000000",
  );
});
