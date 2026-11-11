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

prova(
  "promover principal de A preserva principal de B e desmarca apenas o antigo de A",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await pessoa(A);
      await pessoa(B);
      await endereco(id(10), A, true);
      await endereco(id(11), B, true);
      await endereco(id(12), A, false);
      assert.deepEqual(
        (
          await c.query(
            "SELECT id,is_default FROM public.user_addresses ORDER BY id",
          )
        ).rows,
        [
          { id: id(10), is_default: true },
          { id: id(11), is_default: true },
          { id: id(12), is_default: false },
        ],
      );
      await mutar(
        "endereco-sem-dono",
        "public.handle_default_address()",
        "user_id = NEW.user_id AND ",
        "",
      );
      const r = await P.como(
        "authenticated",
        "UPDATE public.user_addresses SET is_default=true WHERE id=$1 RETURNING id",
        [id(12)],
        sessao(A),
      );
      assert.deepEqual(r, [{ id: id(12) }]);
      assert.deepEqual(
        (
          await c.query(
            "SELECT id,is_default FROM public.user_addresses ORDER BY id",
          )
        ).rows,
        [
          { id: id(10), is_default: false },
          { id: id(11), is_default: true },
          { id: id(12), is_default: true },
        ],
        "promover A desmarcou o endereco principal de B",
      );
    }),
);

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("endereco principal restrito a conta");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
