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

const PRODUTO = id(10),
  REVIEW = id(11);
const GUARDA = `    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;`;

async function fotografar() {
  return (
    await P.conexao().query(
      `SELECT
    (SELECT to_jsonb(r) FROM public.reviews r WHERE id=$1) AS review,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notificacoes n) AS avisos,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.push_notifications_log l) AS push`,
      [REVIEW],
    )
  ).rows;
}
for (const nargs of [2, 3]) {
  for (const fonte of ["perfil", "auth", "atual"]) {
    prova(
      `reply_review_atomic ${nargs} argumentos: ${fonte} ${fonte === "atual" ? "responde" : "rebaixado recusa"}`,
      () =>
        P.emTransacao(async () => {
          const c = P.conexao();
          await pessoa(A);
          await pessoa(ADMIN, fonte === "perfil" ? "customer" : "admin");
          // Reproduz admin antigo divergindo em uma fonte, sem desligar gatilho de cargo.
          if (fonte !== "atual")
            await c.query(
              "UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('role',$2::text) WHERE id=$1",
              [ADMIN, fonte === "perfil" ? "admin" : "customer"],
            );
          await c.query(
            "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo) VALUES ($1,'Produto ficticio',10,10,true)",
            [PRODUTO],
          );
          await c.query(
            "INSERT INTO public.reviews (id,user_id,product_id,rating,comment,status) VALUES ($1,$2,$3,5,'Avaliacao inventada','publicada')",
            [REVIEW, A, PRODUTO],
          );
          const assinatura =
            nargs === 2
              ? "public.reply_review_atomic(uuid,text)"
              : "public.reply_review_atomic(uuid,text,uuid)";
          await mutar(`resposta-sem-admin-${nargs}`, assinatura, GUARDA, "");
          assert.deepEqual(
            await P.como(
              "authenticated",
              "SELECT public.is_admin() AS jwt,public.rls_admin_atual() AS atual",
              [],
              sessao(ADMIN),
            ),
            [{ jwt: true, atual: fonte === "atual" }],
          );
          const antes = await fotografar();
          const sql =
            nargs === 2
              ? "SELECT public.reply_review_atomic($1,'Resposta ficticia')"
              : "SELECT public.reply_review_atomic($1,'Resposta ficticia',$2)";
          const r = await P.tentar(
            "authenticated",
            sql,
            nargs === 2 ? [REVIEW] : [REVIEW, ADMIN],
            sessao(ADMIN),
          );
          if (fonte === "atual") {
            assert.equal(r.codigo, undefined, r.erro);
            const depois = await fotografar();
            assert.equal(depois[0].review.merchant_reply, "Resposta ficticia");
            assert.equal(depois[0].avisos.length, 1);
            assert.equal(depois[0].avisos[0].usuario_id, A);
          } else {
            assert.equal(
              r.codigo,
              "P0001",
              "admin rebaixado respondeu a avaliacao",
            );
            assert.match(
              r.erro,
              /Unauthorized: Only admins can reply to reviews/,
            );
            assert.deepEqual(
              await fotografar(),
              antes,
              "recusa mudou avaliacao ou avisos",
            );
          }
        }),
    );
  }
}

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("resposta recusa admin rebaixado");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
