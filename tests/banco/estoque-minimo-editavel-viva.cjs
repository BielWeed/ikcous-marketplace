"use strict";

/**
 * PROVA VIVA (Onda I do painel simples, item I5 — só caracterização, nenhuma
 * migration): o "Avisar quando o estoque chegar a" do formulário de produto
 * GRAVA sem mudar o banco. O admin escreve `estoque_minimo` (número e NULL)
 * pelos dois caminhos que o app usa; cliente e anon não escrevem.
 *
 * Por que já passa (fatos do banco, citados para o revisor):
 *   * vw_produtos_admin expõe `estoque_minimo`, filtra `WHERE is_admin()` e
 *     tem `WITH CASCADED CHECK OPTION` (20261160:407-441);
 *   * anon perdeu INSERT/UPDATE/DELETE na tabela e na view; authenticated
 *     mantém (20261090:109-118);
 *   * na tabela, a escrita de authenticated passa pela política
 *     produtos_admin_update_policy (is_admin(), baseline:5715);
 *   * o único gatilho de UPDATE em produtos (set_ultima_atualizacao,
 *     20261012:119-122) só carimba a data;
 *   * a coluna é `integer DEFAULT 5`, sem CHECK (baseline:815).
 *
 * O QUE SE PROVA:
 *   (a) admin pela vw_produtos_admin (caminho online do useProducts):
 *       `SET estoque_minimo = 7 … RETURNING` devolve 7 e grava 7;
 *       `= NULL` devolve e grava NULL ("vazio usa o padrão 5");
 *   (b) admin direto em produtos (a fila offline grava na tabela):
 *       `SET estoque_minimo = 2` passa e grava 2;
 *   (c) admin cria produto pela view: com `estoque_minimo` NULL nasce NULL;
 *       sem a coluna nasce 5 (o DEFAULT da tabela);
 *   (d) cliente comum: UPDATE pela view e pela tabela afetam 0 linhas, o
 *       INSERT pela view é recusado ou não grava — e o valor continua 2;
 *   (e) anon: UPDATE/INSERT pela view e UPDATE na tabela recusados com
 *       42501 (permission denied) — e o valor continua 2.
 *
 * O produto é ATIVO de propósito: a política de SELECT de produtos
 * (baseline:5722) libera linha ativa para qualquer um e, para inativa, exige
 * auth.role() = 'authenticated' — que o auth.role() emulado do efêmero
 * (provisionar.cjs) não devolve. Com a linha ativa a prova mede a política de
 * UPDATE, não o limite do emulador.
 *
 * Tudo roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/estoque-minimo-editavel-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO = "Prova viva: o estoque mínimo é editável só pelo admin (rpc-ci)";

const U_ADMIN = "e5a00000-0000-4000-8000-000000000001";
const U_CLIENTE = "e5a00000-0000-4000-8000-000000000002";
const P_PRODUTO = "e5aaaaaa-0000-4000-8000-000000000001";
const P_NOVO_NULO = "e5aaaaaa-0000-4000-8000-000000000002";
const P_NOVO_PADRAO = "e5aaaaaa-0000-4000-8000-000000000003";
const P_DO_CLIENTE = "e5aaaaaa-0000-4000-8000-000000000004";
const P_DO_ANON = "e5aaaaaa-0000-4000-8000-000000000005";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// papel do Postgres (o SET ROLE do PostgREST), login (o auth.uid() desta
// suíte lê app.rpc.user_id) e o JWT.
const QUEM = new Map(
  Object.entries({
    anon: { papel: "anon", uid: "", jwt: "" },
    cliente: {
      papel: "authenticated",
      uid: U_CLIENTE,
      jwt: claims(U_CLIENTE, null),
    },
    admin: {
      papel: "authenticated",
      uid: U_ADMIN,
      jwt: claims(U_ADMIN, "admin"),
    },
  }),
);

/** Roda `sql` COMO `quem` dentro da transação aberta; erro vira {ok:false}. */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, n: r.rowCount, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** O valor gravado, lido pelo dono do banco (sem RLS nem grant no caminho). */
async function gravado(c, id) {
  const r = await c.query(
    "SELECT estoque_minimo FROM public.produtos WHERE id = $1",
    [id],
  );
  return r.rowCount === 0 ? undefined : r.rows[0].estoque_minimo;
}

const SQL_VIEW_UPDATE =
  "UPDATE public.vw_produtos_admin SET estoque_minimo = $2 WHERE id = $1 RETURNING estoque_minimo";
const SQL_TABELA_UPDATE =
  "UPDATE public.produtos SET estoque_minimo = $2 WHERE id = $1 RETURNING estoque_minimo";
const SQL_VIEW_INSERT_COM =
  "INSERT INTO public.vw_produtos_admin (id, nome, preco_venda, custo, estoque, estoque_minimo) VALUES ($1, 'Novo pela view', 10, 4, 0, $2) RETURNING estoque_minimo";
const SQL_VIEW_INSERT_SEM =
  "INSERT INTO public.vw_produtos_admin (id, nome, preco_venda, custo, estoque) VALUES ($1, 'Novo sem mínimo', 10, 4, 0) RETURNING estoque_minimo";

const PROVAS = [];

PROVAS.push({
  nome: "admin grava estoque_minimo (número e NULL) pela view e pela tabela; cliente e anon não gravam",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
           ($1, 'admin@minimo.teste', '{"role":"admin"}'::jsonb),
           ($2, 'cliente@minimo.teste', '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [U_ADMIN, U_CLIENTE],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Mínimo', 'admin')
         ON CONFLICT (id) DO NOTHING`,
        [U_ADMIN],
      );
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo)
         VALUES ($1, 'Produto do mínimo', 25, 10, 8, true)`,
        [P_PRODUTO],
      );
      assert.equal(await gravado(c, P_PRODUTO), 5, "nasce com o DEFAULT 5");

      // (a) admin pela view (o update online do useProducts)
      let r = await como(c, "admin", SQL_VIEW_UPDATE, [P_PRODUTO, 7]);
      assert.ok(r.ok, `admin pela view (7): ${r.message}`);
      assert.equal(r.n, 1);
      assert.equal(r.rows[0].estoque_minimo, 7, "RETURNING devolve 7");
      assert.equal(await gravado(c, P_PRODUTO), 7, "gravou 7");

      r = await como(c, "admin", SQL_VIEW_UPDATE, [P_PRODUTO, null]);
      assert.ok(r.ok, `admin pela view (NULL): ${r.message}`);
      assert.equal(r.n, 1);
      assert.equal(r.rows[0].estoque_minimo, null, "RETURNING devolve NULL");
      assert.equal(await gravado(c, P_PRODUTO), null, "gravou NULL, não 5");

      // (b) admin direto na tabela (a fila offline)
      r = await como(c, "admin", SQL_TABELA_UPDATE, [P_PRODUTO, 2]);
      assert.ok(r.ok, `admin na tabela (2): ${r.message}`);
      assert.equal(r.n, 1);
      assert.equal(r.rows[0].estoque_minimo, 2);
      assert.equal(await gravado(c, P_PRODUTO), 2, "gravou 2");

      // (c) admin cria pela view
      r = await como(c, "admin", SQL_VIEW_INSERT_COM, [P_NOVO_NULO, null]);
      assert.ok(r.ok, `admin cria com NULL: ${r.message}`);
      assert.equal(r.rows[0].estoque_minimo, null);
      assert.equal(await gravado(c, P_NOVO_NULO), null, "nasceu NULL");
      r = await como(c, "admin", SQL_VIEW_INSERT_SEM, [P_NOVO_PADRAO]);
      assert.ok(r.ok, `admin cria sem a coluna: ${r.message}`);
      assert.equal(r.rows[0].estoque_minimo, 5);
      assert.equal(await gravado(c, P_NOVO_PADRAO), 5, "nasceu com o padrão 5");

      // (d) cliente comum: 0 linhas ou erro, nunca gravar
      for (const [rotulo, sql, params] of [
        ["UPDATE pela view", SQL_VIEW_UPDATE, [P_PRODUTO, 99]],
        ["UPDATE na tabela", SQL_TABELA_UPDATE, [P_PRODUTO, 99]],
        ["INSERT pela view", SQL_VIEW_INSERT_COM, [P_DO_CLIENTE, 99]],
      ]) {
        r = await como(c, "cliente", sql, params);
        assert.ok(
          !r.ok || r.n === 0,
          `cliente ${rotulo} gravou ${r.n} linha(s)`,
        );
        console.log(
          `    cliente ${rotulo}: ${r.ok ? `${r.n} linha(s)` : `recusado (${r.code}) ${r.message}`}`,
        );
      }
      assert.equal(
        await gravado(c, P_PRODUTO),
        2,
        "o cliente não mudou o mínimo",
      );
      assert.equal(
        await gravado(c, P_DO_CLIENTE),
        undefined,
        "o cliente não criou produto",
      );

      // (e) anon: sem privilégio de escrita na view nem na tabela
      for (const [rotulo, sql, params] of [
        ["UPDATE pela view", SQL_VIEW_UPDATE, [P_PRODUTO, 99]],
        ["UPDATE na tabela", SQL_TABELA_UPDATE, [P_PRODUTO, 99]],
        ["INSERT pela view", SQL_VIEW_INSERT_COM, [P_DO_ANON, 99]],
      ]) {
        r = await como(c, "anon", sql, params);
        assert.equal(r.ok, false, `anon ${rotulo} passou`);
        assert.equal(r.code, "42501", `anon ${rotulo}: ${r.message}`);
        assert.match(r.message, /permission denied/);
      }
      assert.equal(await gravado(c, P_PRODUTO), 2, "o anon não mudou o mínimo");
      assert.equal(
        await gravado(c, P_DO_ANON),
        undefined,
        "o anon não criou produto",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(TITULO, linhas.join("\n"));
        falhar(
          "FALHOU",
          "A escrita do estoque mínimo saiu do esperado — ver acima.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[estoque-minimo-editavel] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    TITULO,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
