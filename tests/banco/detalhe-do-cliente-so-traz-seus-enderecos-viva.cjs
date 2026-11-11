"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Fixtures e sabotagens sao desfeitas pelo ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b100c000-0000-4000-8000-000000000001";
const B = "b100c000-0000-4000-8000-000000000002";
const ADMIN = "b100c000-0000-4000-8000-000000000003";
const id = (n) => `b100c000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessao = (uid) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: uid === ADMIN ? "admin" : "customer" },
  }),
});

async function pessoa(uid, cargo = "customer") {
  await P.conexao().query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}')",
    [uid, `${uid}@r100.fixture.invalid`],
  );
  await P.conexao().query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia',$2)",
    [uid, cargo],
  );
}

async function mutar(nome, assinatura, trecho, substituto) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function endereco(chave, uid, principal) {
  await P.conexao().query(
    `INSERT INTO public.user_addresses
    (id,user_id,name,recipient_name,cep,street,number,neighborhood,city,state,is_default)
    VALUES ($1,$2,'Casa ficticia','Pessoa ficticia','00000000','Rua inventada','123','Bairro ficticio','Cidade ficticia','SP',$3)`,
    [chave, uid, principal],
  );
}

prova("admin consulta A e B com conjuntos exatos de enderecos separados", () =>
  P.emTransacao(async () => {
    await pessoa(ADMIN, "admin");
    await pessoa(A);
    await pessoa(B);
    await endereco(id(10), A, true);
    await endereco(id(11), A, false);
    await endereco(id(12), B, true);
    await mutar(
      "detalhe-sem-dono",
      "public.get_admin_user_detail(uuid)",
      "WHERE a.user_id = p_user_id",
      "WHERE true",
    );
    for (const [uid, ids] of [
      [A, [id(10), id(11)]],
      [B, [id(12)]],
    ]) {
      const r = await P.como(
        "authenticated",
        "SELECT public.get_admin_user_detail($1) AS r",
        [uid],
        sessao(ADMIN),
      );
      assert.equal(r[0].r.profile.id, uid);
      const esperado = (
        await P.conexao().query(
          "SELECT to_jsonb(a) AS a FROM public.user_addresses a WHERE id=ANY($1::uuid[]) ORDER BY id",
          [ids],
        )
      ).rows.map((r) => r.a);
      assert.deepEqual(
        r[0].r.addresses.sort((a, b) => a.id.localeCompare(b.id)),
        JSON.parse(JSON.stringify(esperado)),
        "detalhe devolveu endereco alheio ou omitiu endereco proprio",
      );
    }
  }),
);

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("detalhe do cliente isola enderecos");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
