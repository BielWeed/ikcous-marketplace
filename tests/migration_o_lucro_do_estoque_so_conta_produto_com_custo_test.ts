// @ts-nocheck
// O LUCRO DO ESTOQUE SÓ CONTA PRODUTO COM CUSTO — prova offline do par
// 20261214000000 + rollback (painel simples, onda I, item I6; 09/10/2026). O
// COMPORTAMENTO (totalCost/totalValue por delta numa semente com e sem custo,
// o corpo antigo dando o número inflado, as chaves do JSON idênticas) é
// provado em tests/banco/inventario-so-com-custo-viva.cjs; aqui fica o que se
// prova só lendo o texto, no `npm run test:unit`.
//
// Riscos amarrados: corpo que não é o vigente (o da 20261199000000, com a
// guarda do admin atual) apaga a guarda em silêncio; trocar mais do que a
// linha do valor de venda muda outro número do painel (estoque baixo, custo,
// receita); chave do JSON renomeada quebra o front; hash de preflight que não
// é o md5 real; rollback que não volta byte a byte; GRANT/REVOKE escondido.
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
const NOME = "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql";
const NOVENTA_E_NOVE = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const HASH_VIGENTE = "6abc7e44b0aae3b2e542e87daf055451";
const ASSINATURA = "public.get_admin_analytics_v2(integer)";

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

const RE_CRIA_O_ANALYTICS =
  /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.")get_admin_analytics_v2"?\(/gm;

// 20261199000000:1757 — o valor de venda do estoque inteiro, com ou sem custo.
const LINHA_ANTIGA = "        COALESCE(SUM(preco_venda * estoque), 0)\n";
// Só produto COM custo: o "Lucro se vender tudo" (totalValue - totalCost)
// deixa de contar como lucro a venda inteira de quem não tem custo.
const LINHA_NOVA =
  "        COALESCE(SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL), 0)\n";

const antes = corpo(funcao(ler(NOVENTA_E_NOVE), "get_admin_analytics_v2"));
const depois = funcao(migration, "get_admin_analytics_v2");
const desfeito = funcao(rollback, "get_admin_analytics_v2");

/** As chaves do json_build_object final, na ordem. */
const chavesDoJson = (c) => {
  const final = c.slice(c.indexOf("result := json_build_object("));
  return [...final.matchAll(/^\s*'([A-Za-z]+)',/gm)].map((m) => m[1]);
};

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

Deno.test("só get_admin_analytics_v2 é redefinida, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, ["get_admin_analytics_v2"]);
  }
});

Deno.test("o ponto de partida é a ÚLTIMA definição antes desta migration (a 20261199000000), com o md5 citado nas notas", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const re = RE_CRIA_O_ANALYTICS;
  const com = nomes.filter((n) => {
    re.lastIndex = 0;
    return re.test(ler(n));
  });
  assert.equal(com.at(-1), NOVENTA_E_NOVE);
  assert.equal(md5(antes), HASH_VIGENTE);
});

Deno.test("o corpo novo é o da 20261199000000 byte a byte, com SÓ a linha do valor de venda trocada (mais um comentário de uma linha)", () => {
  assert.equal(antes.split(LINHA_ANTIGA).length - 1, 1);
  const c = corpo(depois);
  const i = c.indexOf(LINHA_NOVA);
  assert.ok(i > 0, "a linha nova não está no corpo");
  const iniComentario = c.lastIndexOf("\n", i - 2) + 1;
  const comentario = c.slice(iniComentario, i);
  assert.match(comentario, /^ {8}-- [^\n]+\n$/, "um comentário de uma linha");
  assert.equal(
    c.slice(0, iniComentario) + c.slice(i),
    antes.replace(LINHA_ANTIGA, LINHA_NOVA),
  );
  assert.equal(
    cabecalho(depois),
    cabecalho(funcao(ler(NOVENTA_E_NOVE), "get_admin_analytics_v2")),
    "assinatura, RETURNS, SECURITY DEFINER e search_path iguais (sem STABLE)",
  );
  assert.ok(!cabecalho(depois).includes("STABLE"));
  assert.ok(!c.includes("$$"), "$$ dentro do corpo");
});

Deno.test("nenhuma chave do JSON muda; o estoque baixo (low_stock_count, COALESCE(estoque_minimo, 5)) e o custo ficam; a guarda do admin atual fica", () => {
  const c = corpo(depois);
  assert.deepEqual(chavesDoJson(c), chavesDoJson(antes));
  assert.ok(chavesDoJson(c).includes("totalValue"));
  for (const fica of [
    "COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),",
    "        COALESCE(SUM(custo * estoque), 0),\n",
    "INTO low_stock_count, inv_cost_total, inv_value_total",
    "'inventoryAlerts', low_stock_count,",
  ]) {
    assert.ok(c.includes(fica), fica);
  }
  assert.equal(c.split("public.is_admin_atual()").length - 1, 1);
});

Deno.test("o rollback devolve o corpo da 20261199000000 byte a byte (md5 vigente), com o mesmo cabeçalho", () => {
  assert.equal(corpo(desfeito), antes);
  assert.equal(md5(corpo(desfeito)), HASH_VIGENTE);
  assert.equal(cabecalho(desfeito), cabecalho(depois));
});

Deno.test("os preflights citam o md5 REAL dos dois corpos e recusam com B1_BASELINE_DIVERGENT", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261214$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261214$"),
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
  assert.ok(!preflightRb.includes(`'${HASH_VIGENTE}'`));
  for (const sql of [preflight, preflightRb]) {
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql));
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261214$"],
    [rollback, "DO $preflight_rollback_20261214$"],
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

Deno.test("os cabeçalhos dizem a ordem do rollback (ANTES do da 20261199000000) e apontam a prova viva", () => {
  for (const sql of [migration, rollback]) {
    assert.match(sql, /ANTES do rollback da 20261199000000/);
  }
  assert.ok(migration.includes("tests/banco/inventario-so-com-custo-viva.cjs"));
  // M1 da revisão de risco: a consulta 8e fixa o corpo da 99; aplicar antes
  // do backfill 92-202 deixaria a 8e sem "tudo true" sem ninguém avisar.
  for (const sql of [migration, rollback]) {
    assert.ok(
      sql.includes(
        "-- Aplicar numa loja SÓ depois do backfill 92-202 (consulta 8e positiva)",
      ),
      "o cabeçalho não declara a ordem com a consulta 8e",
    );
  }
  assert.ok(migration.includes("get_admin_analytics_v2 da 20261199"));
  assert.ok(migration.includes(`rollback-manual-${NOME}`));
});
