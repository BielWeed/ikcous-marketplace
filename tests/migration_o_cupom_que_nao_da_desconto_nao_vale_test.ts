import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

Deno.test("4058: frota e CI reconhecem a consulta aplicada e a da base anterior", async () => {
  const a = "160a-conferir-o-cupom-que-nao-da-desconto-aplicado";
  const b = "160b-antes-o-cupom-que-nao-da-desconto-base-vigente";
  const lerRepo = (caminho: string) =>
    Deno.readTextFileSync(new URL(`../${caminho}`, import.meta.url));
  const {
    contarStatements,
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  const par = JSON.parse(
    lerRepo("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((r: { consulta: string }) => r.consulta === a);
  assert.deepEqual(par?.versoes, ["20261405800000"]);
  assert.equal(par?.ausenciaConfirmadaPor, b);
  for (const consulta of [a, b]) {
    const caminho = `scripts/publicacao/consultas/${consulta}.sql`;
    const sql = lerRepo(caminho);
    assert.equal(contarStatements(sql), 1);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assert.deepEqual(
      [...sql.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]),
      // eslint-disable-next-line security/detect-object-injection -- Duas consultas literais.
      ROL_FECHADO_POR_CONSULTA[consulta],
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${consulta}\n`,
      ),
    );
    assert.equal(
      lerRepo(".github/workflows/rpc-ci.yml").split(`"${caminho}"`).length - 1,
      2,
    );
  }
  // eslint-disable-next-line security/detect-object-injection -- MIG é literal deste teste.
  const [checagem] = VERIFICACOES[MIG];
  assert.equal(
    avaliarChecagem(corpo(definicao(ler(MIG))), checagem).situacao,
    "verificada",
  );
  assert.equal(
    avaliarChecagem(corpo(definicao(ler(BASE))), checagem).situacao,
    "falhou",
  );
});

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
const MIG = "20261405800000_o_cupom_que_nao_da_desconto_nao_vale.sql";
const BASE = "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql";
const ler = (nome: string) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
const definicao = (sql: string) => {
  const trecho = sql.match(
    /^CREATE OR REPLACE FUNCTION public\.validate_coupon_secure_v2\([\s\S]*?^\$\$;/m,
  )?.[0];
  assert.ok(trecho, "definição ausente");
  return trecho;
};
const corpo = (def: string) => def.slice(def.indexOf("AS $$") + 5, -3);
const md5 = (texto: string) =>
  createHash("md5").update(texto.replace(/\r/g, "")).digest("hex");

const TETO =
  "        IF v_discount > p_subtotal THEN v_discount := p_subtotal; END IF;";
const GUARDA = `
        IF v_discount <= 0 THEN
            v_is_valid := FALSE;
            v_discount := 0;
            v_error := 'Este cupom não dá desconto em uma compra deste valor.';
        END IF;`;

Deno.test("4058: a única mudança na RPC é recusar o desconto zero depois do teto", () => {
  const base = definicao(ler(BASE));
  const nova = definicao(ler(MIG));
  assert.equal(nova.split(GUARDA).length - 1, 1);
  assert.ok(nova.includes(`${TETO}${GUARDA}\n    END IF;`));
  assert.equal(nova.replace(GUARDA, ""), base);
  assert.equal(definicao(ler(`rollback-manual-${MIG}`)), base);
});

Deno.test("4058: hashes do cabeçalho batem com os corpos; aplicador controla a transação", () => {
  const sql = ler(MIG);
  const rb = ler(`rollback-manual-${MIG}`);
  const antes = md5(corpo(definicao(ler(BASE))));
  const depois = md5(corpo(definicao(sql)));
  assert.equal(antes, "61b90bb7f7c9729abeb94b5596914eb4");
  assert.equal(depois, "98ccd81ae2e6440dd0c5378910736d0b");

  for (const texto of [sql, rb]) {
    assert.ok(
      texto.includes(
        `-- Corpo anterior (20261397000000), MD5 sem CR: ${antes}`,
      ),
    );
    assert.ok(
      texto.includes(`-- Corpo novo (20261405800000), MD5 sem CR: ${depois}`),
    );
    assert.equal(texto.match(/^CREATE OR REPLACE FUNCTION/gm)?.length, 1);
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assert.doesNotMatch(texto, /^\s*(?:BEGIN|COMMIT)\s*;/im);
    assert.equal(
      avaliarFase0({ sqlMigration: texto, sqlRollback: rb, temRollback: true })
        .recusado,
      false,
    );
  }
});
