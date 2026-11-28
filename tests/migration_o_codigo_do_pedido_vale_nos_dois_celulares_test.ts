// Contrato offline. O comportamento roda só no Postgres efêmero do RPC CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const NOME = "20261665000000_o_codigo_do_pedido_vale_nos_dois_celulares.sql";
const A = "221a-conferir-o-codigo-do-pedido-vale-nos-dois-celulares-aplicado";
const B = "221b-antes-o-codigo-do-pedido-vale-nos-dois-celulares-base-vigente";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .trimStart();
const sql = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const definicao = (arquivo: string, fn: string) => {
  const inicio = arquivo.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const fim = arquivo.indexOf("\n$$;", inicio);
  assert.ok(inicio >= 0 && fim > inicio, fn);
  return arquivo.slice(inicio, fim + "\n$$;".length);
};
const hash = (d: string) =>
  createHash("md5")
    .update(d.slice(d.indexOf("AS $$") + 5, -3))
    .digest("hex");

const FONTES = [
  [
    "generate_order_otp_v2",
    "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql",
  ],
  [
    "get_orders_by_otp_v2",
    "20261410000000_a_lista_do_painel_e_o_rastreio_levam_o_nome_antigo_da_opcao.sql",
  ],
];
const {
  dividirEmStatements,
  ROL_FECHADO_POR_CONSULTA: rol,
} = require("../scripts/publicacao/conferir-banco.cjs");

Deno.test("1665: só troca as duas funções, com rollback byte a byte e sem controlar a transação", () => {
  for (const [fn, fonte] of FONTES) {
    const antes = definicao(ler(`supabase/migrations/${fonte}`), fn);
    assert.equal(definicao(rollback, fn), antes);
    const depois = definicao(sql, fn);
    assert.equal(depois.split("AS $$")[0], antes.split("AS $$")[0]);
    assert.notEqual(hash(depois), hash(antes));
    for (const arquivo of [sql, rollback]) {
      assert.ok(arquivo.includes(hash(depois)));
      assert.ok(arquivo.includes(hash(antes)));
    }
  }
  for (const arquivo of [sql, rollback]) {
    const comandos: string[] = dividirEmStatements(arquivo).map(semComentarios);
    assert.equal(
      comandos.filter((s: string) => /^CREATE OR REPLACE FUNCTION\b/i.test(s))
        .length,
      2,
    );
    const permitidos = ["SET LOCAL ", "DO $", "CREATE OR REPLACE FUNCTION "];
    assert.ok(
      comandos.every((s) =>
        permitidos.some((prefixo) => s.startsWith(prefixo)),
      ),
    );
  }
});

Deno.test("221a/221b: catálogo, estados exatos, ACL específica e sete linhas fechadas", () => {
  for (const [nome, estado] of [
    [A, sql],
    [B, rollback],
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${nome}.sql`);
    assert.equal(dividirEmStatements(consulta).length, 1);
    const corpo = semComentarios(consulta);
    assert.ok(corpo.startsWith("WITH "));
    const catalogo = new Set([
      "alvo",
      "fn",
      "itens",
      "pg_proc",
      "pg_language",
      "aclexplode",
    ]);
    for (const [, relacao] of corpo.matchAll(/\b(?:FROM|JOIN) +([a-z_]+)/gi))
      assert.ok(catalogo.has(relacao), relacao);
    const esperado = FONTES.map(([fn]) => hash(definicao(estado, fn))).sort();
    const vivo = [...consulta.matchAll(/'([a-f0-9]{32})'/g)]
      .map((m) => m[1])
      .sort();
    assert.deepEqual(vivo, esperado);
    const itens = [...consulta.matchAll(/SELECT '([^']+)',/g)].map((m) => m[1]);
    assert.equal(itens.length, 7);
    assert.equal(new Set(itens).size, 7);
    assert.deepEqual(
      itens.sort(),
      [...(new Map(Object.entries(rol)).get(nome) as string[])].sort(),
    );
    assert.match(
      consulta,
      /has_function_privilege\('anon', p\.oid, 'EXECUTE'\) = t\.visitante/,
    );
    assert.match(
      consulta,
      /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\) = t\.visitante/,
    );
    assert.match(
      consulta,
      /has_function_privilege\('service_role', p\.oid, 'EXECUTE'\)/,
    );
    assert.match(consulta, /a\.grantee = 0 AND a\.privilege_type = 'EXECUTE'/);
  }
});

Deno.test("1665: mapa, menu, publicador e RPC CI concordam com a ficha 221", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const mapa = new Map(Object.entries(VERIFICACOES));
  const verificacoes = mapa.get(NOME) as Array<{
    funcao: string;
    esperado: Array<{ texto: string; vezes: number }>;
  }>;
  assert.deepEqual(
    verificacoes.map((v) => v.funcao),
    FONTES.map(([fn]) => fn),
  );
  for (const v of verificacoes)
    for (const { texto, vezes } of v.esperado)
      assert.equal(definicao(sql, v.funcao).split(texto).length - 1, vezes);

  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter(
    ({ versoes }: { versoes: string[] }) => versoes.includes("20261665000000"),
  );
  assert.equal(lotes.length, 1);
  assert.deepEqual(lotes[0].versoes, ["20261665000000"]);
  assert.equal(lotes[0].consulta, A);
  assert.equal(lotes[0].ausenciaConfirmadaPor, B);
  const workflow = ler(".github/workflows/conferir-banco-da-loja.yml");
  const publicador = ler("scripts/frota/publicar-release.mjs");
  const rpc = ler(".github/workflows/rpc-ci.yml");
  for (const nome of [A, B]) {
    assert.ok(workflow.includes(`- ${nome}\n`));
    assert.ok(publicador.includes(`"${nome}"`));
    assert.equal(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
    );
  }
  assert.ok(
    rpc.includes(
      "node tests/banco/rodar-isolado.cjs tests/banco/codigo-do-pedido-em-dois-celulares-viva.cjs",
    ),
  );
});
