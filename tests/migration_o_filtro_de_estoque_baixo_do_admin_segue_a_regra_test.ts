// @ts-nocheck
// O FILTRO DE ESTOQUE BAIXO DO ADMIN SEGUE A REGRA — prova offline do par
// 20261213000000 + rollback (painel simples, onda I, 09/10/2026). O
// COMPORTAMENTO (`p_stock = 'low'` conta os mesmos produtos que o Início, o
// analytics e o front; `'all'` e a busca com acento devolvem o mesmo de antes)
// é provado em tests/banco/estoque-baixo-uma-regra-viva.cjs; aqui fica o que
// se prova só lendo o texto, no `npm run test:unit`.
//
// Riscos amarrados: corpo da baseline copiado com 1 byte de diferença (o
// `SELECT ` com espaço no fim de linha entra no md5); trocar mais do que os
// dois `p.estoque <= 5`; guarda do admin atual acrescentada a uma RPC de
// catálogo (a 20261199000000 a deixou de fora de propósito); parâmetros,
// defaults, SECURITY DEFINER ou search_path diferentes; rollback que não volta
// byte a byte; GRANT/REVOKE/DROP escondido.
//
// Asserções por `node:assert/strict` (embutido no Deno): roda sem rede.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql";
const BASELINE = "20260806000000_baseline_do_schema_vivo.sql";
const HASH_VIGENTE = "1d5a5544dd55c78ba4dc729755916754";
const ASSINATURA =
  "public.get_admin_products_paged(text,text,text,text,integer,integer)";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função num arquivo, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
/** O que o Postgres grava em prosrc: entre `AS $$` e `$$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $$") + "AS $$".length,
    texto.length - "$$;".length,
  );
const cabecalho = (texto) => texto.slice(0, texto.indexOf("AS $$"));

const RE_CRIA_O_FILTRO =
  /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.")get_admin_products_paged"?\(/gm;

/** O prosrc da definição da baseline (pg_dump: `    AS $$` … `$$;`). */
const antes = (() => {
  const t = ler(BASELINE);
  const i = t.indexOf("\nCREATE FUNCTION public.get_admin_products_paged(");
  assert.ok(i >= 0);
  const resto = t.slice(i + 1);
  const ini = resto.indexOf("AS $$") + "AS $$".length;
  return resto.slice(ini, resto.indexOf("$$;", ini));
})();

// Linhas 1736 e 1764 da baseline: o limiar fixo 5 sobre a coluna crua.
const TRECHO_ANTIGO =
  "(p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))";
// A regra da loja: estoque efetivo (soma das variações ATIVAS, ou a coluna)
// <= COALESCE(estoque_minimo, 5).
const TRECHO_NOVO =
  "(p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))";

const CABECALHO_DA_FUNCAO = `CREATE OR REPLACE FUNCTION public.get_admin_products_paged(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
`;

const depois = funcao(migration, "get_admin_products_paged");
const desfeito = funcao(rollback, "get_admin_products_paged");

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("só get_admin_products_paged é redefinida, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, ["get_admin_products_paged"]);
  }
});

Deno.test("o ponto de partida é a baseline (ninguém redefiniu a função depois dela), com o md5 medido do texto", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const re = RE_CRIA_O_FILTRO;
  const com = nomes.filter((n) => {
    re.lastIndex = 0;
    return re.test(ler(n));
  });
  assert.deepEqual(com, [BASELINE]);
  assert.equal(md5(antes), HASH_VIGENTE);
  // O espaço no fim de `SELECT ` (baseline:1750) faz parte do corpo.
  assert.ok(antes.includes("\n        SELECT \n            p.*,\n"));
});

Deno.test("o corpo novo é o da baseline byte a byte, com SÓ os dois filtros de estoque baixo trocados", () => {
  assert.equal(antes.split(TRECHO_ANTIGO).length - 1, 2);
  assert.equal(corpo(depois), antes.split(TRECHO_ANTIGO).join(TRECHO_NOVO));
  assert.ok(
    corpo(depois).includes("\n        SELECT \n"),
    "o espaço no fim de linha da baseline sumiu",
  );
  assert.ok(!corpo(depois).includes("$$"), "$$ dentro do corpo");
});

Deno.test("mesma assinatura, defaults, SECURITY DEFINER e search_path da baseline; sem STABLE", () => {
  assert.equal(cabecalho(depois), CABECALHO_DA_FUNCAO);
  assert.equal(cabecalho(desfeito), CABECALHO_DA_FUNCAO);
  const baseline = ler(BASELINE);
  for (const pedaco of [
    `"p_search" "text" DEFAULT ''::"text", "p_category" "text" DEFAULT 'all'::"text", "p_status" "text" DEFAULT 'all'::"text", "p_stock" "text" DEFAULT 'all'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"`,
    "    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'public', 'extensions'\n    AS $$\nDECLARE\n    v_total_count BIGINT;",
  ]) {
    assert.ok(baseline.includes(pedaco), pedaco);
  }
});

Deno.test("a regra é a da loja nas DUAS consultas (contagem e página); o limiar fixo sumiu; nenhuma guarda nova", () => {
  const c = corpo(depois);
  assert.ok(!c.includes("p.estoque <= 5"), "limiar fixo ficou");
  assert.equal(c.split("<= COALESCE(p.estoque_minimo, 5)").length - 1, 2);
  // Catálogo: a 20261199000000 deixou de fora de propósito (20261199:57).
  assert.ok(!c.includes("is_admin_atual"), "guarda nova numa RPC de catálogo");
  assert.equal(c.split("public.is_admin()").length - 1, 1);
});

Deno.test("o rollback devolve o corpo da baseline byte a byte (md5 vigente)", () => {
  assert.equal(corpo(desfeito), antes);
  assert.equal(md5(corpo(desfeito)), HASH_VIGENTE);
});

Deno.test("os preflights citam o md5 REAL dos dois corpos e recusam com B1_BASELINE_DIVERGENT", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261213$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261213$"),
  );
  const novo = md5(corpo(depois));
  assert.notEqual(novo, HASH_VIGENTE);
  assert.ok(
    preflight.includes(`('${ASSINATURA}', '${HASH_VIGENTE}', '${novo}')`),
    "preflight da migration",
  );
  assert.ok(
    preflightRb.includes(`('${ASSINATURA}', '${novo}')`),
    "preflight do rollback",
  );
  assert.ok(
    !preflightRb.includes(`'${HASH_VIGENTE}'`),
    "o rollback só desfaz o corpo NOVO",
  );
  for (const sql of [preflight, preflightRb]) {
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql));
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261213$"],
    [rollback, "DO $preflight_rollback_20261213$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert.ok(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert.ok(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    const c = semComentarios(sql);
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
    ]) {
      assert.ok(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("o cabeçalho aponta o rollback e a prova viva", () => {
  assert.ok(migration.includes(`rollback-manual-${NOME}`));
  assert.ok(migration.includes("tests/banco/estoque-baixo-uma-regra-viva.cjs"));
});
