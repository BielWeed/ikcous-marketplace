"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos, ids e chaves fixos desta prova; banco sempre clone descartavel. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  lerDatabaseUrlEfemera,
  falhar,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const NOME = "20261250000000_o_faturamento_potencial_conta_todo_o_estoque.sql";
const DIR = path.join(__dirname, "..", "..", "supabase", "migrations");
const ler = (n) => fs.readFileSync(path.join(DIR, n), "utf8");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const ADMIN = "d1500000-0000-4000-8000-000000000001";
const CLIENTE = "d1500000-0000-4000-8000-000000000002";
const GESTOR = "d1500000-0000-4000-8000-000000000003";
const DEPOIS = "5746d8a1df216ca4a5569901c45a2a07";
const ANTES = "ab25e738a3101cccbb0c09450b660ee0";
const A = "53a-conferir-faturamento-potencial-aplicado";
const B = "53b-antes-faturamento-potencial-base-vigente";
const ANCESTRAIS = [
  "8e-conferir-92-a-202-aplicado",
  "17a-conferir-estoque-do-painel-aplicado",
  "35a-conferir-lucro-so-com-custo-aplicado",
  "45a-conferir-custo-do-dia-aplicado",
  "48a-conferir-lucro-com-desconto-aplicado",
];
const sqlConsulta = (n) =>
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "publicacao",
      "consultas",
      `${n}.sql`,
    ),
    "utf8",
  );

async function catalogo(c) {
  return (
    await c.query(`SELECT md5(replace(prosrc, chr(13), '')) AS hash,
    proacl::text AS acl, proowner, proconfig, provolatile
    FROM pg_proc WHERE oid=to_regprocedure('public.get_admin_analytics_v2(integer)')`)
  ).rows[0];
}
async function como(c, uid, role, f) {
  await c.query("SAVEPOINT papel");
  try {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
      [
        uid,
        JSON.stringify({
          sub: uid,
          role,
          app_metadata: { role: uid === ADMIN ? "admin" : "customer" },
        }),
      ],
    );
    return await f();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT papel");
    await c.query("RELEASE SAVEPOINT papel");
  }
}
const analytics = (c) =>
  como(
    c,
    ADMIN,
    "authenticated",
    async () =>
      (await c.query("SELECT public.get_admin_analytics_v2(1) AS r")).rows[0].r,
  );
async function consulta(c, nome, positiva) {
  const linhas = (await c.query(sqlConsulta(nome))).rows;
  const rol = CONF.ROL_FECHADO_POR_CONSULTA[nome];
  assert.ok(Array.isArray(rol), `${nome}: rol fechado ausente`);
  assert.equal(linhas.length, rol.length);
  assert.deepEqual(linhas.map((l) => l.item).sort(), [...rol].sort());
  assert.equal(
    linhas.every((l) => l.ok === true),
    positiva,
    nome,
  );
}
async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(
    new URL(url).pathname,
    "/prova_faturamento_potencial_viva",
    "Esta prova so aceita o clone proprio de rodar-isolado.cjs.",
  );
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("BEGIN");
  const passou = [];
  const marcar = (nome) => {
    passou.push(nome);
    console.log(`PASSOU ${nome}`);
  };
  try {
    await c.query(
      `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
      ($1,'admin@faturamento.invalid','{"role":"admin"}'::jsonb),
      ($2,'cliente@faturamento.invalid','{}'::jsonb),
      ($3,'gestor@faturamento.invalid','{"role":"admin"}'::jsonb)`,
      [ADMIN, CLIENTE, GESTOR],
    );
    await c.query(
      `INSERT INTO public.profiles(id,full_name,role) VALUES
      ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer'),
      ($3,'Gestor fixture','admin')`,
      [ADMIN, CLIENTE, GESTOR],
    );
    await require("./lucro-do-estoque-posterior.cjs").desfazerLucroDoEstoqueNaTransacao(c);
    const estado = await catalogo(c);
    assert.equal(estado.hash, DEPOIS);
    const antes = await analytics(c);
    const produtos = [
      // preco, custo, pai, ativo, apagado, variantes [estoque, ativa, preco proprio]
      [25, 10, 2, true, false, []],
      [100, null, 3, true, false, []],
      [
        20,
        5,
        999,
        true,
        false,
        [
          [2, true, 30],
          [1, true, null],
          [1000, false, 500],
        ],
      ],
      [100, 1, 100, false, false, []],
      [100, 1, 100, true, true, []],
      [10, 0, 4, true, false, []],
      [5, 2, 7, true, false, [[100, false]]],
      [100, 1, 9, true, false, [[0, true]]],
      [100, 1, 50, true, false, [[2, true, 0]]],
    ];
    for (const [
      i,
      [preco, custo, estoque, ativo, apagado, variantes],
    ] of produtos.entries()) {
      const id = `d1500000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`;
      await c.query(
        `INSERT INTO public.produtos(id,nome,preco_venda,custo,estoque,ativo,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() ELSE NULL END)`,
        [id, `Produto fixture ${i}`, preco, custo, estoque, ativo, apagado],
      );
      for (const [
        j,
        [quantidade, ativa, precoProprio],
      ] of variantes.entries()) {
        await c.query(
          `INSERT INTO public.product_variants(product_id,name,value,stock_increment,active,price_override)
          VALUES($1,'Tamanho',$2,$3,$4,$5)`,
          [id, `V${j}`, quantidade, ativa, precoProprio ?? null],
        );
      }
    }
    const novo = await analytics(c);
    assert.equal(
      Number(novo.inventory.totalRevenue) -
        Number(antes.inventory.totalRevenue),
      505,
    );
    assert.equal(
      Number(novo.inventory.totalValue) - Number(antes.inventory.totalValue),
      385,
    );
    assert.equal(
      Number(novo.inventory.totalCost) - Number(antes.inventory.totalCost),
      51,
    );
    marcar(
      "venda sem custo entra no faturamento; variantes, pausados, apagados e custo zero",
    );
    await c.query("SAVEPOINT vazio");
    await c.query("UPDATE public.produtos SET ativo=false");
    const vazio = await analytics(c);
    assert.equal(Number(vazio.inventory.totalRevenue), 0);
    await c.query("ROLLBACK TO SAVEPOINT vazio");
    await c.query("RELEASE SAVEPOINT vazio");
    marcar("estoque ativo vazio tem faturamento zero");
    await consulta(c, A, true);
    await consulta(c, B, false);
    for (const nome of ANCESTRAIS) await consulta(c, nome, true);
    marcar("portoes ancestrais aceitam a 250 com rol fechado completo");
    await c.query(MIGRATION);
    await c.query(MIGRATION);
    assert.deepEqual(await catalogo(c), estado);
    marcar("reaplicar duas vezes e idempotente e preserva atributos/ACL");

    await c.query(ROLLBACK);
    assert.equal((await catalogo(c)).hash, ANTES);
    const antigo = await analytics(c);
    assert.equal(antigo.inventory.totalRevenue, undefined);
    const semCampo = {
      ...novo,
      inventory: Object.fromEntries(
        Object.entries(novo.inventory).filter(
          ([chave]) => chave !== "totalRevenue",
        ),
      ),
    };
    assert.deepEqual(
      semCampo,
      antigo,
      "nenhum outro numero, chave ou regra muda",
    );
    await consulta(c, A, false);
    await consulta(c, B, true);
    for (const nome of ANCESTRAIS) await consulta(c, nome, true);
    await c.query(MIGRATION.replace(/\r?\n/g, "\r\n"));
    assert.deepEqual(await analytics(c), novo);
    marcar("rollback exato, ida-volta-ida CRLF e consultas antes/depois");

    for (const role of ["authenticated", "anon"]) {
      await assert.rejects(
        como(c, CLIENTE, role, () =>
          c.query("SELECT public.get_admin_analytics_v2(1)"),
        ),
        /Acesso negado|permission denied/i,
      );
    }
    // Um segundo admin prepara o rebaixamento sem desligar os gatilhos de papel.
    await c.query(
      "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
      [
        GESTOR,
        JSON.stringify({
          sub: GESTOR,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ],
    );
    await c.query("UPDATE public.profiles SET role='customer' WHERE id=$1", [
      ADMIN,
    ]);
    // O gatilho sincroniza auth.users; recolocamos apenas essa fonte em admin.
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data='{"role":"admin"}'::jsonb WHERE id=$1`,
      [ADMIN],
    );
    assert.deepEqual(
      (
        await c.query(
          `SELECT p.role AS perfil, u.raw_app_meta_data->>'role' AS auth
           FROM public.profiles p JOIN auth.users u USING(id) WHERE p.id=$1`,
          [ADMIN],
        )
      ).rows[0],
      { perfil: "customer", auth: "admin" },
    );
    await assert.rejects(analytics(c), /Acesso negado/i);
    await c.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [
      ADMIN,
    ]);
    await c.query(
      "UPDATE auth.users SET raw_app_meta_data='{}'::jsonb WHERE id=$1",
      [ADMIN],
    );
    assert.deepEqual(
      (
        await c.query(
          `SELECT p.role AS perfil, u.raw_app_meta_data->>'role' AS auth
           FROM public.profiles p JOIN auth.users u USING(id) WHERE p.id=$1`,
          [ADMIN],
        )
      ).rows[0],
      { perfil: "admin", auth: null },
    );
    await assert.rejects(analytics(c), /Acesso negado/i);
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data='{"role":"admin"}'::jsonb WHERE id=$1`,
      [ADMIN],
    );
    marcar("cliente, anon e admin rebaixado em cada fonte continuam recusados");

    const i = MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
    );
    const def = MIGRATION.slice(i, MIGRATION.indexOf("$$;", i) + 3);
    await c.query(
      def.replace("RETURN result;", "RETURN result; -- divergente"),
    );
    const divergente = await catalogo(c);
    assert.notEqual(divergente.hash, DEPOIS);
    await c.query("SAVEPOINT preflight");
    await assert.rejects(c.query(MIGRATION), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT preflight");
    assert.deepEqual(await catalogo(c), divergente);
    await c.query(def);
    marcar("preflight recusa corpo desconhecido sem reescrever");

    // Controle negativo: o filtro de custo no faturamento deve perder R$ 300.
    const mutante = def.replace(
      "COALESCE(SUM(faturamento), 0)",
      "COALESCE(SUM(faturamento) FILTER (WHERE custo IS NOT NULL), 0)",
    );
    assert.notEqual(mutante, def);
    await c.query(mutante);
    const errado = await analytics(c);
    assert.equal(
      Number(novo.inventory.totalRevenue) -
        Number(errado.inventory.totalRevenue),
      300,
    );
    marcar("controle negativo detecta perder produto sem custo do faturamento");
    console.log(
      `[faturamento-potencial] ${passou.length}/${passou.length} provas passaram.`,
    );
    anexarAoSummary(
      "Faturamento potencial",
      passou.map((n) => `- PASSOU ${n}`).join("\n"),
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
main().catch((e) => falhar("FALHOU", e.message));
