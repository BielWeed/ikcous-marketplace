"use strict";

// So o clone descartavel de rodar-isolado.cjs. Exercita o SQL dos arquivos
// reais, fora de uma transacao explicita, como uma consulta multipla do pg.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const INDICE = "coupons_code_upper_uidx";
const AUSENCIA = "cupom: indice de codigo em maiusculas ausente";
const COLISOES = "cupom: grupos de codigos em colisao";
const PRESENTE = "cupom: indice unico de codigo em maiusculas valido";

const ler = (arquivo) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminhos versionados e fixos.
  readFileSync(path.join(__dirname, "../..", arquivo), "utf8");

async function conferir(c, arquivo, esperado) {
  const { rows } = await c.query(
    ler(`scripts/publicacao/consultas/${arquivo}.sql`),
  );
  assert.deepEqual(rows, esperado);
}

const antes = "167a-antes-o-cupom-nao-repete-o-codigo-base-vigente";
const depois = "167b-conferir-o-cupom-nao-repete-o-codigo-aplicado";
const semColisoes = { item: COLISOES, esperado: "0", vivo: "0", ok: true };
const indiceAusente = {
  item: AUSENCIA,
  esperado: "sim",
  vivo: "sim",
  ok: true,
};
const indicePresente = {
  item: PRESENTE,
  esperado: "sim",
  vivo: "sim",
  ok: true,
};

async function provas(c) {
  const migracao = ler(
    "supabase/migrations/20261411000000_o_cupom_nao_repete_o_codigo_em_outra_grafia.sql",
  );
  const rollback = ler(
    "supabase/migrations/rollback-manual-20261411000000_o_cupom_nao_repete_o_codigo_em_outra_grafia.sql",
  );
  const inserir = (code, active) =>
    c.query(
      "INSERT INTO public.coupons(code, type, value, active) VALUES ($1, 'percentage', 10, $2)",
      [code, active],
    );

  await conferir(c, depois, [indicePresente]);
  await c.query(migracao); // reaplicar sem erro nao altera o indice
  await inserir("verao10", false);
  await inserir("SOL10", true);
  await assert.rejects(inserir("VERAO10", true), {
    code: "23505",
    constraint: INDICE,
  });
  await assert.rejects(
    c.query("UPDATE public.coupons SET code = 'VERAO10' WHERE code = 'SOL10'"),
    { code: "23505", constraint: INDICE },
  );
  console.log("[21411] INSERT e UPDATE nao podem duplicar nem cupom inativo");

  await c.query(rollback);
  await conferir(c, depois, [{ ...indicePresente, vivo: "nao", ok: false }]);
  await conferir(c, antes, [semColisoes, indiceAusente]);
  await assert.rejects(inserir("verao10", true), {
    code: "23505",
    constraint: "coupons_code_key",
  });
  // A grafia diferente volta a entrar apos o rollback: o indice antigo ficou.
  await inserir("VERAO10", true);
  const comColisao = { ...semColisoes, vivo: "1", ok: false };
  await conferir(c, antes, [comColisao, indiceAusente]);
  await assert.rejects(c.query(migracao), {
    code: "P0001",
    message:
      "B1_BASELINE_DIVERGENT: trate as colisoes de codigos de cupom antes de aplicar a migration.",
  });
  await conferir(c, depois, [{ ...indicePresente, vivo: "nao", ok: false }]);
  await conferir(c, antes, [comColisao, indiceAusente]);
  console.log(
    "[21411] rollback preserva UNIQUE(code); colisao antiga aborta sem criar indice",
  );
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(
    new URL(url).pathname,
    "/prova_o_cupom_nao_repete_o_codigo_em_outra_grafia_viva",
    "Rode somente no clone criado por rodar-isolado.cjs.",
  );
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await provas(c);
  } finally {
    await c.end();
  }
}

main().catch((erro) => {
  console.error("[21411]", erro);
  process.exitCode = 1;
});
