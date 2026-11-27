// O AVISO DO VALE-TROCA DIZ QUE A LOJA COMBINA: prova offline do par 20261645000000 + rollback.
// O COMPORTAMENTO (a conclusao real do painel grava o texto novo, reembolso/troca iguais, aviso de antes intacto, rollback e
// reaplicar, pre-voo) e' provado em tests/banco/o-aviso-do-vale-troca-diz-que-a-loja-combina-viva.cjs, que so roda no Postgres
// efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const nome = "20261645000000_o_aviso_do_vale_troca_diz_que_a_loja_combina.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const sql1241 = ler(
  "supabase/migrations/20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql",
);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_ANTES = "56502b960dcf3e136c1d0d5c41091c20";
const H_NOVO = "68792e520aa47e6e62330718430d82a8";
const TAG = "$avisa_o_cliente$";

/** A definicao inteira (cabecalho + corpo) de devolucao_avisa_o_cliente no arquivo (a ULTIMA, se houver mais de uma). */
function definicao(arquivo: string): string {
  const i = arquivo.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
  );
  assert.ok(i >= 0, "sem devolucao_avisa_o_cliente");
  const a = arquivo.indexOf(TAG, i) + TAG.length;
  const fim = arquivo.indexOf(`${TAG};`, a);
  return arquivo.slice(i, fim + TAG.length + 1);
}
const corpo = (arquivo: string) =>
  definicao(arquivo)
    .split(`AS ${TAG}`)[1]
    .slice(0, -(TAG.length + 1));
const cabeca = (arquivo: string) => definicao(arquivo).split(`AS ${TAG}`)[0];

const FRASE_ANTIGA =
  "          ELSE 'O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.'";
const FRASE_NOVA =
  "          ELSE 'A devolução ' || NEW.protocolo || ' foi resolvida com vale-troca. A loja combina com você o valor e como usar. Se não tiver notícia, fale com a loja.'";

Deno.test("3645: fase 0 do db-prove-rollback aceita o par (nada de BEGIN/COMMIT de nivel superior)", () => {
  const r = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: rb,
    temRollback: true,
  });
  assert.equal(r.recusado, false, JSON.stringify(r));
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(rb)).achados, []);
});

Deno.test("3645: a ultima migration que definiu a funcao e' a 20261241000000; o rollback devolve o corpo DELA byte a byte", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const definem = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .filter((n) =>
      ler(`supabase/migrations/${n}`).includes(
        "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
      ),
    )
    .sort();
  assert.deepEqual(definem.slice(-2), [
    "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql",
    nome,
  ]);
  assert.equal(md5(corpo(sql1241)), H_ANTES);
  assert.equal(corpo(rb), corpo(sql1241));
  assert.equal(md5(corpo(rb)), H_ANTES);
  // MESMA assinatura e atributos (o cabecalho e' o de antes, nos dois arquivos).
  assert.equal(cabeca(sql), cabeca(sql1241));
  assert.equal(cabeca(rb), cabeca(sql1241));
});

Deno.test("3645: o corpo novo so troca a frase do vale (e o comentario dela); titulo, tipo, reembolso e troca iguais", () => {
  const novo = corpo(sql);
  assert.equal(md5(novo), H_NOVO);
  assert.ok(!novo.includes("foi emitido"), "nao promete vale emitido");
  assert.equal(novo.split(FRASE_NOVA).length - 1, 1);
  // Desfaz a edicao: sobra o corpo da 1241, byte a byte.
  const desfeito = novo
    .replace(
      "        -- 20261645000000: o app NÃO emite vale-troca (a loja o cria por conta própria, ex.: um cupom, e o painel\n" +
        "        -- avisa a lojista disso). O aviso diz o que acontece de fato, com as palavras da ficha do pedido.\n",
      "",
    )
    .replace(FRASE_NOVA, FRASE_ANTIGA);
  assert.equal(desfeito, corpo(sql1241));
  // A ficha do pedido (instrucaoParaOCliente, src/lib/devolucao.ts) abre com a MESMA frase do aviso.
  // Depois dela a ficha pode acrescentar orientacao (ex.: a peca nova comprada com o vale tem
  // devolucao propria), mas nunca troca nem contradiz o que o aviso disse.
  const front = ler("src/lib/devolucao.ts");
  assert.ok(
    front.includes(
      '"A devolução foi resolvida com vale-troca. A loja combina com você o valor e como usar. Se não tiver notícia, fale com a loja.',
    ),
  );
  assert.ok(
    !front.includes("vale-troca foi emitido"),
    "a ficha nao promete vale emitido",
  );
});

Deno.test("3645: pre-voo antes da troca, conferencia depois; nenhum DROP, UPDATE, DELETE, GRANT nem REVOKE; nenhuma linha reescrita", () => {
  const iPre = sql.indexOf("DO $preflight_20261645000000$");
  const iCria = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
  );
  const iConf = sql.indexOf("DO $conferencia_20261645000000$");
  assert.ok(iPre > 0 && iPre < iCria && iCria < iConf, "ordem");
  const semComentario = removerRuido(sql);
  for (const proibido of [
    /\bDROP\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bTRUNCATE\b/i,
    /\bALTER\s+TABLE\b/i,
  ])
    assert.ok(!proibido.test(semComentario), `proibido: ${proibido}`);
  // O pre-voo aceita SO o corpo da 1241 ou o desta; a conferencia exige o desta e compara a fotografia do catalogo.
  assert.ok(sql.includes(`NOT IN ('${H_ANTES}', '${H_NOVO}')`));
  assert.ok(sql.includes(`IS DISTINCT FROM '${H_NOVO}' THEN`));
  assert.ok(sql.includes("current_setting('ikcous.vale_troca_1645')::jsonb"));
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  // O rollback aceita o desta ou o da 1241 e exige o da 1241 no fim.
  assert.ok(rb.includes(`NOT IN ('${H_NOVO}', '${H_ANTES}')`));
  assert.ok(rb.includes(`IS DISTINCT FROM '${H_ANTES}' THEN`));
  assert.ok(!/\bDROP\b/i.test(removerRuido(rb)));
});

Deno.test("3645: as provas que desfazem ou reaplicam a 1241 tiram esta antes (o pre-voo da 1241 so aceita o corpo dela)", () => {
  const helper = ler("tests/banco/reembolso-em-duvida-posterior.cjs");
  assert.ok(
    helper.indexOf("desfazerAvisoDoValeTrocaNaTransacao") >= 0 &&
      helper.indexOf("desfazerAvisoDoValeTrocaNaTransacao") <
        helper.indexOf("cliente.query(REEMBOLSO_EM_DUVIDA.noAr)"),
  );
  const modulo = ler("tests/banco/o-aviso-do-vale-troca-posterior.cjs");
  assert.ok(modulo.includes(`'${H_NOVO}'`), "no ar = o corpo desta");
  assert.ok(modulo.includes(nome));
  const viva1241 = ler("tests/banco/reembolso-em-duvida-viva.cjs");
  assert.ok(
    viva1241.indexOf("desfazerAvisoDoValeTrocaNaTransacao") <
      viva1241.indexOf(
        'assert.equal(await aplicar(ROLLBACK), null, "o rollback não aplicou");',
      ),
  );
  assert.equal(
    viva1241.split("desfazerAvisoDoValeTrocaNaTransacao").length - 1,
    2,
  );
  const portao = ler("tests/banco/reembolso-em-duvida-portao-viva.cjs");
  const noEstado = portao.slice(portao.indexOf("async function noEstado("));
  assert.ok(
    noEstado.indexOf("desfazerAvisoDoValeTrocaNaTransacao") <
      noEstado.indexOf("if (montar) await montar(C);"),
  );
  const pagamentos = ler("tests/banco/pagamentos-rpc-viva.cjs");
  const posteriores = pagamentos.slice(
    pagamentos.indexOf("async function desfazerPosterioresNaTransacao(c)"),
  );
  assert.ok(
    posteriores.indexOf("desfazerAvisoDoValeTrocaNaTransacao") > 0 &&
      posteriores.indexOf("desfazerAvisoDoValeTrocaNaTransacao") <
        posteriores.indexOf("for (const { nome, noAr } of POSTERIORES_A_97)"),
  );
});

Deno.test("3645: a prova viva roda no job do dinheiro e tem linha no LEIA-ME", () => {
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/o-aviso-do-vale-troca-diz-que-a-loja-combina-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "o-aviso-do-vale-troca-diz-que-a-loja-combina-viva.cjs",
    ),
  );
});
