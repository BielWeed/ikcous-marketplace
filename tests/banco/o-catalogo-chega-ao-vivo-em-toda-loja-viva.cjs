"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio (a migration, o rollback e as consultas), nunca de entrada de rede. */
// Prova viva da migration 20261610000000 (o catalogo e a configuracao chegam ao vivo em toda loja). Executada SO pelo rpc-ci, num clone
// descartavel do rodar-isolado.cjs (efemero.cjs recusa qualquer outro alvo); nunca em banco de loja.
//
// O que se prova, cada caso numa transacao desfeita (menos o ultimo, que COMITA no clone e recusa rodar fora de um banco prova_*):
//   1. loja nova (a Savy em 27/11/2026: so as 3 da 20261061): as 11 entram, as 3 ficam, nada mais entra; 197a/197b viram;
//   2. a IKCOUS (as 14 ja la, postas a mao): NO-OP, o catalogo da publicacao fica identico (nenhum DROP/ADD por baixo);
//   3. loja pela metade: so as que faltam entram;
//   4. reaplicar (LF e CRLF) nao erra e nao mexe;
//   5. o pre-voo recusa (B1) e nada entra: tabela sem RLS, sem chave primaria, com REPLICA IDENTITY NOTHING, ausente;
//   6. sem a publicacao: nao erra e nao cria nada; publicacao FOR ALL TABLES: no-op sem erro (e o rollback recusa);
//   7. rollback: sem a confirmacao recusa; com ela tira SO as 11 e deixa as 3; repetir e' no-op; reaplicar devolve as 14;
//   8. o realtime entrega o que o SELECT ja entrega: as politicas de SELECT das 11 sao as do comentario da migration, e o carrinho, o
//      favorito e o cupom de uma conta nao aparecem para outra nem para o visitante; o custo do produto nao sai para ninguem;
//   9. trava: gravacao e leitura em voo nao seguram o apply; quem segura SHARE UPDATE EXCLUSIVE (VACUUM/ANALYZE) faz o apply desistir
//      em 5 s (55P03) sem deixar nada.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  ROL_FECHADO_POR_CONSULTA,
} = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA));

const NOME =
  "20261610000000_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql";
const PASTA = path.join(__dirname, "../../supabase/migrations");
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const norm = (s) => s.replace(/\r\n/g, "\n");
const MIGRATION = norm(fs.readFileSync(path.join(PASTA, NOME), "utf8"));
const ROLLBACK = norm(
  fs.readFileSync(path.join(PASTA, `rollback-manual-${NOME}`), "utf8"),
);
const A = "197a-conferir-o-catalogo-chega-ao-vivo-aplicado";
const B = "197b-antes-o-catalogo-chega-ao-vivo-ausente";
const lerConsulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");

const ONZE = [
  "answers",
  "banners",
  "cart_items",
  "categorias",
  "coupons",
  "favorites",
  "product_variants",
  "produtos",
  "questions",
  "reviews",
  "store_config",
];
const TRES = ["marketplace_order_items", "marketplace_orders", "notificacoes"];
const CATORZE = [...ONZE, ...TRES].sort();
const CONFIRMA =
  "SELECT set_config('app.confirmo_tirar_do_realtime_20261610', 'TIRAR', true)";

let c;
const casos = [];
const caso = (nome, corpo) => casos.push({ nome, corpo });

async function membros() {
  const r = await c.query(
    `SELECT tablename::text AS t FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' ORDER BY 1`,
  );
  return r.rows.map((x) => x.t);
}
/** O catalogo cru da publicacao: o oid de cada pg_publication_rel muda se alguem tirar e repuser a tabela. */
async function retrato() {
  const r = await c.query(
    `SELECT pr.oid::text AS oid, pr.prrelid::regclass::text AS tabela FROM pg_publication_rel pr
       JOIN pg_publication p ON p.oid = pr.prpubid WHERE p.pubname = 'supabase_realtime' ORDER BY 2`,
  );
  return JSON.stringify(r.rows);
}
async function semAsOnze() {
  for (const t of ONZE)
    if ((await membros()).includes(t))
      await c.query(
        `ALTER PUBLICATION supabase_realtime DROP TABLE public.${t}`,
      );
}
async function comAsOnze() {
  for (const t of ONZE)
    if (!(await membros()).includes(t))
      await c.query(
        `ALTER PUBLICATION supabase_realtime ADD TABLE public.${t}`,
      );
}
async function tentar(sql, params) {
  await c.query("SAVEPOINT tentativa");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT tentativa");
    return { erro: null, codigo: null };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    return { erro: e.message, codigo: e.code };
  }
}
async function aplicar(sql = MIGRATION) {
  const r = await tentar(sql);
  assert.equal(r.erro, null, `a migration errou: ${r.erro}`);
}
/** Roda a consulta de rol fechado e devolve {item: ok}; o rol tem de bater com o de conferir-banco.cjs. */
async function conferencia(nome) {
  const r = await c.query(lerConsulta(nome));
  const rol = ROL.get(nome);
  assert.ok(rol, `${nome} sem rol em conferir-banco.cjs`);
  assert.deepEqual(
    r.rows.map((x) => x.item).sort(),
    [...rol].sort(),
    `${nome}: o rol devolvido nao e' o declarado`,
  );
  return Object.fromEntries(r.rows.map((x) => [x.item, x.ok]));
}
const tudoOk = (m) => Object.values(m).every((v) => v === true);
const falsos = (m) =>
  Object.entries(m)
    .filter(([, v]) => v !== true)
    .map(([k]) => k);
async function identidades() {
  const r = await c.query(
    `SELECT relname::text AS t, relreplident::text AS ri FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) ORDER BY 1`,
    [CATORZE],
  );
  return new Map(r.rows.map((x) => [x.t, x.ri]));
}

caso(
  "loja nova (so as 3 da 20261061): as 11 entram, as 3 ficam e nada mais entra",
  async () => {
    await semAsOnze();
    assert.deepEqual(await membros(), TRES, "simulei a loja nova");
    const antesA = await conferencia(A);
    const antesB = await conferencia(B);
    assert.deepEqual(
      falsos(antesA),
      ["as 11 tabelas do catalogo e da configuracao estao na publicacao"],
      "a 197a antes do apply: so o item das 11 diz nao",
    );
    assert.ok(tudoOk(antesB), `a 197b antes do apply: ${falsos(antesB)}`);
    const ri = await identidades();
    await aplicar();
    assert.deepEqual(await membros(), CATORZE, "exatamente as 14 depois");
    assert.deepEqual(await identidades(), ri, "replica identity intocada");
    assert.ok(
      ONZE.every((t) => ri.get(t) === "d") &&
        TRES.every((t) => ri.get(t) === "f"),
      "as 11 default, as 3 da 1061 FULL",
    );
    const depoisA = await conferencia(A);
    assert.ok(tudoOk(depoisA), `a 197a depois: ${falsos(depoisA)}`);
    assert.deepEqual(
      falsos(await conferencia(B)),
      ["pelo menos uma das 11 tabelas ainda esta fora da publicacao"],
      "a 197b depois do apply: so o item da ausencia diz nao",
    );
  },
);

caso(
  "a IKCOUS (as 14 ja la, postas a mao): NO-OP, o catalogo da publicacao fica identico",
  async () => {
    await comAsOnze();
    const antes = await retrato();
    await aplicar();
    await aplicar(MIGRATION.replace(/\n/g, "\r\n"));
    assert.equal(await retrato(), antes, "nenhum DROP/ADD por baixo");
    assert.deepEqual(await membros(), CATORZE);
    assert.ok(tudoOk(await conferencia(A)));
  },
);

caso("loja pela metade: so as que faltam entram", async () => {
  await semAsOnze();
  for (const t of ["produtos", "store_config", "cart_items"])
    await c.query(`ALTER PUBLICATION supabase_realtime ADD TABLE public.${t}`);
  const antes = JSON.parse(await retrato()).filter((x) =>
    ["produtos", "store_config", "cart_items"].includes(x.tabela),
  );
  await aplicar();
  assert.deepEqual(await membros(), CATORZE);
  const depois = JSON.parse(await retrato()).filter((x) =>
    ["produtos", "store_config", "cart_items"].includes(x.tabela),
  );
  assert.deepEqual(
    depois,
    antes,
    "as que ja estavam nao foram tiradas e repostas",
  );
});

caso("reaplicar (LF e CRLF) na loja nova nao erra e nao mexe", async () => {
  await semAsOnze();
  await aplicar();
  const uma = await retrato();
  await aplicar();
  await aplicar(MIGRATION.replace(/\n/g, "\r\n"));
  assert.equal(await retrato(), uma);
});

for (const [rotulo, estrago, padrao] of [
  [
    "coupons sem RLS",
    "ALTER TABLE public.coupons DISABLE ROW LEVEL SECURITY",
    /B1_BASELINE_DIVERGENT: public\.coupons esta sem RLS/,
  ],
  [
    "favorites sem chave primaria",
    "ALTER TABLE public.favorites DROP CONSTRAINT favorites_pkey",
    /B1_BASELINE_DIVERGENT: public\.favorites sem identidade de replicacao/,
  ],
  [
    "store_config com REPLICA IDENTITY NOTHING",
    "ALTER TABLE public.store_config REPLICA IDENTITY NOTHING",
    /B1_BASELINE_DIVERGENT: public\.store_config sem identidade de replicacao/,
  ],
  [
    "categorias ausente",
    "ALTER TABLE public.categorias RENAME TO categorias_fora",
    /B1_BASELINE_DIVERGENT: public\.categorias nao existe/,
  ],
]) {
  caso(`o pre-voo recusa e nada entra: ${rotulo}`, async () => {
    await semAsOnze();
    await c.query(estrago);
    const r = await tentar(MIGRATION);
    assert.match(String(r.erro), padrao);
    assert.deepEqual(await membros(), TRES, "nenhuma das 11 entrou");
  });
}

caso("sem a publicacao: nao erra e nao cria nada", async () => {
  await c.query("DROP PUBLICATION supabase_realtime");
  await aplicar();
  const r = await c.query(
    "SELECT count(*)::int AS n FROM pg_publication WHERE pubname = 'supabase_realtime'",
  );
  assert.equal(r.rows[0].n, 0);
});

caso(
  "publicacao FOR ALL TABLES: a migration e' no-op sem erro e o rollback recusa",
  async () => {
    await c.query("DROP PUBLICATION supabase_realtime");
    await c.query("CREATE PUBLICATION supabase_realtime FOR ALL TABLES");
    await aplicar();
    await c.query(CONFIRMA);
    const r = await tentar(ROLLBACK);
    assert.match(String(r.erro), /B1_BASELINE_DIVERGENT: .*FOR ALL TABLES/);
  },
);

caso(
  "rollback: sem a confirmacao recusa; com ela tira so as 11 e deixa as 3; repetir e' no-op; reaplicar devolve as 14",
  async () => {
    await semAsOnze();
    await aplicar();
    const semConfirmar = await tentar(ROLLBACK);
    assert.match(String(semConfirmar.erro), /REALTIME_SO_LOJA_QUE_NAO_TINHA/);
    assert.deepEqual(await membros(), CATORZE, "nada saiu sem a confirmacao");
    await c.query(CONFIRMA);
    const r = await tentar(ROLLBACK);
    assert.equal(r.erro, null, String(r.erro));
    assert.deepEqual(await membros(), TRES, "so as 11 sairam");
    assert.ok(tudoOk(await conferencia(B)), "a 197b volta a dizer sim");
    assert.deepEqual(falsos(await conferencia(A)), [
      "as 11 tabelas do catalogo e da configuracao estao na publicacao",
    ]);
    const de_novo = await tentar(ROLLBACK);
    assert.equal(de_novo.erro, null, "rollback repetido e' no-op");
    assert.deepEqual(await membros(), TRES);
    await aplicar();
    assert.deepEqual(await membros(), CATORZE, "reaplicar depois do rollback");
  },
);

caso(
  "o rollback com a confirmacao de outra transacao nao vale (SET LOCAL)",
  async () => {
    await semAsOnze();
    await aplicar();
    await c.query("SAVEPOINT outra");
    await c.query(CONFIRMA);
    await c.query("ROLLBACK TO SAVEPOINT outra");
    const r = await tentar(ROLLBACK);
    assert.match(String(r.erro), /REALTIME_SO_LOJA_QUE_NAO_TINHA/);
    assert.deepEqual(await membros(), CATORZE);
  },
);

// As politicas de SELECT (e ALL) que decidem o que o realtime entrega. Se uma delas mudar, o comentario da migration e o que o
// realtime manda para cada papel tem de ser reconferido: esta lista falha de proposito.
const POLITICAS = [
  ["answers", "answers_select_policy", "SELECT", "{public}", "true"],
  [
    "banners",
    "banners_admin_select_policy",
    "SELECT",
    "{authenticated}",
    "( SELECT rls_admin_atual() AS rls_admin_atual)",
  ],
  [
    "banners",
    "banners_select_policy",
    "SELECT",
    "{public}",
    "((active = true) AND ((start_date IS NULL) OR (start_date <= now())) AND ((end_date IS NULL) OR (end_date >= now())))",
  ],
  [
    "cart_items",
    "cart_items_select_policy",
    "SELECT",
    "{authenticated}",
    "((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT rls_admin_atual() AS rls_admin_atual))",
  ],
  ["categorias", "categorias_select_policy", "SELECT", "{public}", "true"],
  [
    "coupons",
    "coupons_select_policy",
    "SELECT",
    "{authenticated}",
    "( SELECT rls_admin_atual() AS rls_admin_atual)",
  ],
  [
    "favorites",
    "favorites_all_policy",
    "ALL",
    "{authenticated}",
    "(( SELECT auth.uid() AS uid) = user_id)",
  ],
  [
    "product_variants",
    "product_variants_select_policy",
    "SELECT",
    "{public}",
    "true",
  ],
  [
    "produtos",
    "produtos_select_policy",
    "SELECT",
    "{authenticated}",
    "((ativo = true) OR ((( SELECT auth.role() AS role) = 'authenticated'::text) AND ( SELECT rls_admin_atual() AS rls_admin_atual)))",
  ],
  ["questions", "questions_select_policy", "SELECT", "{authenticated}", "true"],
  [
    "reviews",
    "reviews_select_policy",
    "SELECT",
    "{authenticated}",
    "((status = 'publicada'::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT rls_admin_atual() AS rls_admin_atual))",
  ],
  ["store_config", "store_config_select_policy", "SELECT", "{public}", "true"],
];

caso(
  "o realtime entrega o que o SELECT ja entrega: as politicas de SELECT das 11 sao as do comentario",
  async () => {
    const r = await c.query(
      `SELECT tablename::text, policyname::text, cmd::text, roles::text, qual FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1) AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE'
      ORDER BY 1, 2`,
      [ONZE],
    );
    assert.deepEqual(
      r.rows.map((x) => [x.tablename, x.policyname, x.cmd, x.roles, x.qual]),
      POLITICAS,
    );
    const restritivas = await c.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1) AND permissive <> 'PERMISSIVE'",
      [ONZE],
    );
    assert.equal(restritivas.rows[0].n, 0);
    const rls = await c.query(
      `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)
        AND relrowsecurity AND NOT relforcerowsecurity`,
      [ONZE],
    );
    assert.equal(rls.rows[0].n, 11, "RLS ligada nas 11");
    // O realtime tira da mensagem a coluna que o papel nao pode ler: o custo do produto nao sai para ninguem; o visitante nem le produtos.
    const p = await c.query(
      `SELECT has_table_privilege('anon', 'public.produtos', 'SELECT') AS anon_tabela,
            has_any_column_privilege('anon', 'public.produtos', 'SELECT') AS anon_coluna,
            has_column_privilege('authenticated', 'public.produtos', 'custo', 'SELECT') AS auth_custo,
            has_column_privilege('authenticated', 'public.produtos', 'nome', 'SELECT') AS auth_nome`,
    );
    assert.deepEqual(p.rows[0], {
      anon_tabela: false,
      anon_coluna: false,
      auth_custo: false,
      auth_nome: true,
    });
  },
);

caso(
  "o carrinho, o favorito e o cupom de uma conta nao aparecem para outra nem para o visitante (a regra que o realtime aplica)",
  async () => {
    await aplicar();
    const ana = "00000000-0000-4000-8000-0000000016a1";
    const bia = "00000000-0000-4000-8000-0000000016b2";
    await c.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, 'ana.ficticia@exemplo.test'), ($2, 'bia.ficticia@exemplo.test')",
      [ana, bia],
    );
    await c.query(
      "INSERT INTO public.cart_items (user_id, product_id, quantity) VALUES ($1, 'produto-ficticio-1610', 1)",
      [ana],
    );
    await c.query(
      "INSERT INTO public.favorites (user_id, product_id) VALUES ($1, 'produto-ficticio-1610')",
      [ana],
    );
    await c.query(
      "INSERT INTO public.coupons (code, type, value, alcance, active) VALUES ('EXCLUSIVO1610', 'fixed', 5, 'exclusivo', true)",
    );
    const contar = async (papel, uid) => {
      await c.query("SAVEPOINT papel");
      try {
        await c.query(
          "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
          [
            uid ?? "",
            JSON.stringify(uid ? { sub: uid, role: papel } : { role: papel }),
          ],
        );
        await c.query(`SET LOCAL ROLE ${papel}`);
        const r = await c.query(
          `SELECT (SELECT count(*) FROM public.cart_items WHERE product_id = 'produto-ficticio-1610')::int AS carrinho,
                (SELECT count(*) FROM public.favorites WHERE product_id = 'produto-ficticio-1610')::int AS favorito,
                (SELECT count(*) FROM public.coupons WHERE code = 'EXCLUSIVO1610')::int AS cupom`,
        );
        return r.rows[0];
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT papel");
      }
    };
    assert.deepEqual(await contar("authenticated", ana), {
      carrinho: 1,
      favorito: 1,
      cupom: 0,
    });
    assert.deepEqual(await contar("authenticated", bia), {
      carrinho: 0,
      favorito: 0,
      cupom: 0,
    });
    assert.deepEqual(await contar("anon", null), {
      carrinho: 0,
      favorito: 0,
      cupom: 0,
    });
  },
);

async function trava() {
  // Este caso COMITA a loja sem as 11 no banco: so no clone do rodar-isolado.cjs (que some no fim).
  const banco = (await c.query("SELECT current_database() AS d")).rows[0].d;
  assert.match(banco, /^prova_/, "a trava so roda no clone do rodar-isolado");
  await semAsOnze();
  const outro = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await outro.connect();
  try {
    for (const modo of ["ROW EXCLUSIVE", "ACCESS SHARE"]) {
      await outro.query("BEGIN");
      await outro.query(`LOCK TABLE public.cart_items IN ${modo} MODE`);
      await c.query("BEGIN");
      try {
        await aplicar();
        assert.deepEqual(await membros(), CATORZE, `${modo} em voo nao segura`);
      } finally {
        await c.query("ROLLBACK");
        await outro.query("ROLLBACK");
      }
    }
    await outro.query("BEGIN");
    await outro.query(
      "LOCK TABLE public.cart_items IN SHARE UPDATE EXCLUSIVE MODE",
    );
    await c.query("BEGIN");
    try {
      const t0 = Date.now();
      const r = await tentar(MIGRATION);
      const ms = Date.now() - t0;
      assert.equal(r.codigo, "55P03", String(r.erro));
      assert.ok(ms >= 4500 && ms < 20000, `desistiu em ${ms} ms`);
      assert.deepEqual(await membros(), TRES, "nada entrou");
    } finally {
      await c.query("ROLLBACK");
      await outro.query("ROLLBACK");
    }
  } finally {
    await outro.end();
  }
}

async function main() {
  c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  let falhou = 0;
  try {
    for (const { nome, corpo } of casos) {
      await c.query("BEGIN");
      try {
        await corpo();
        console.log(`  PASSOU ${nome}`);
      } catch (e) {
        falhou += 1;
        console.error(`  FALHOU ${nome}\n${e.stack || e.message}`);
      } finally {
        await c.query("ROLLBACK");
      }
    }
    try {
      await trava();
      console.log(
        "  PASSOU trava: gravacao e leitura em voo nao seguram; SHARE UPDATE EXCLUSIVE faz desistir em 5 s sem deixar nada",
      );
    } catch (e) {
      falhou += 1;
      console.error(`  FALHOU trava\n${e.stack || e.message}`);
    }
  } finally {
    await c.end();
  }
  if (falhou) falhar("FALHOU", `${falhou} caso(s) da 20261610000000`);
  console.log(
    `PASSOU o catalogo chega ao vivo em toda loja: ${casos.length + 1} casos.`,
  );
}
main().catch((e) => falhar("FALHOU", e.stack || e.message));
