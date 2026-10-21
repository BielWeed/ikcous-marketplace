// Prova estática da preparação das provas históricas; não substitui o Postgres efêmero.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

const ler = (caminho: string) =>
  Deno.readTextFileSync(new URL(`../${caminho}`, import.meta.url));
const MODULO = "pagamento-adiantado-posterior.cjs";
const CHAMADA = "desfazerPagamentoAdiantadoNaTransacao";
const NOME =
  "20261270000000_pagamento_adiantado_e_estorno_antes_da_confirmacao.sql";
const NOVO = "1738457c2b95c5c3709beed42e656394";
const ANTIGO = "662daf0dfc065a820231e9d30f4f6275";

Deno.test("as quatro provas históricas tiram a 270 antes de medir corpos antigos", () => {
  for (const nome of [
    "reemissao-do-reembolso-viva.cjs",
    "reemissao-do-reembolso-portao-viva.cjs",
    "reembolso-em-duvida-viva.cjs",
    "reembolso-em-duvida-portao-viva.cjs",
  ]) {
    const texto = ler(`tests/banco/${nome}`);
    assert.ok(
      texto.includes(`require("./${MODULO}")`),
      `${nome}: falta importar a sucessora 270`,
    );
    assert.equal(texto.split(`await ${CHAMADA}(C)`).length - 1, 1, nome);
    if (nome.startsWith("reemissao-")) {
      const inicio = texto.indexOf("async function comecarSem1241()");
      const trecho = texto.slice(inicio, texto.indexOf("\n}", inicio));
      assert.ok(
        trecho.indexOf(`await ${CHAMADA}(C)`) >
          trecho.indexOf('await C.query("BEGIN")'),
      );
      assert.ok(
        trecho.indexOf(`await ${CHAMADA}(C)`) <
          trecho.indexOf("await desfazerReembolsoEmDuvidaNaTransacao(C)"),
      );
    } else if (nome === "reembolso-em-duvida-viva.cjs") {
      const inicio = texto.indexOf('"MIGRATION: reaplicar 2x');
      assert.ok(
        texto.indexOf(`await ${CHAMADA}(C)`) > inicio,
        "só a prova MIGRATION desmonta a 270",
      );
      assert.ok(
        texto.indexOf(`await ${CHAMADA}(C)`) <
          texto.indexOf("const sigs = Object.values(SIG)", inicio),
      );
    } else {
      const inicio = texto.indexOf("async function noEstado(");
      const trecho = texto.slice(inicio, texto.indexOf("if (montar)", inicio));
      assert.ok(
        trecho.indexOf(`await ${CHAMADA}(C)`) >
          trecho.indexOf('await C.query("BEGIN")'),
      );
    }
  }
});

Deno.test("o helper da 270 fixa os hashes reais de ida e volta e confere a restauração", () => {
  assert.ok(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminho fixo desta prova, sem entrada externa.
    existsSync(new URL(`banco/${MODULO}`, import.meta.url)),
    "falta o helper da sucessora 270",
  );
  const texto = ler(`tests/banco/${MODULO}`);
  assert.ok(texto.includes(`nome: "${NOME}"`));
  assert.ok(texto.includes(NOVO), "no ar é o corpo exato da 270");
  assert.ok(texto.includes(ANTIGO), "o corpo restaurado é afirmado");
  assert.ok(texto.includes("assert.equal("));
  assert.ok(
    texto.includes("return false"),
    "uma segunda chamada não reaplica o rollback",
  );
  const hashCorpo = (sql: string) => {
    const inicio = sql.indexOf("AS $$") + "AS $$".length;
    assert.ok(inicio > "AS $$".length);
    const fim = sql.indexOf("$$;", inicio);
    assert.ok(fim > inicio);
    return createHash("md5")
      .update(sql.slice(inicio, fim).replace(/\r/g, ""))
      .digest("hex");
  };
  const migration = ler(`supabase/migrations/${NOME}`);
  assert.equal(
    hashCorpo(migration.slice(migration.indexOf("ROLLBACK_FIM"))),
    NOVO,
  );
  assert.equal(
    hashCorpo(ler(`supabase/migrations/rollback-manual-${NOME}`)),
    ANTIGO,
  );
});
