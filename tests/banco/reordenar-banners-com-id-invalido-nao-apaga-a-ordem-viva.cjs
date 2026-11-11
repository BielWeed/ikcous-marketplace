"use strict";

// So o clone descartavel de rodar-isolado.cjs; nenhuma migration muda.
// Sem a recusa de id alheio/inexistente, a normalizacao grava e uma ordem vira NULL.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b104ba00-0000-4000-8000-000000000001";
const id = (n) => `b104ba00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

async function mutar() {
  const nome = "reordenar-sem-recusa-de-banner-inexistente";
  if (process.env.MUTANTE_R104 !== nome) return;
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query(
        "SELECT pg_get_functiondef('public.reorder_banners_atomic(text,uuid,uuid)'::regprocedure) AS d",
      )
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  const trecho =
    "  IF v_order_1 IS NULL OR v_order_2 IS NULL THEN\n" +
    "    RAISE EXCEPTION 'Banner não encontrado.';\n" +
    "  END IF;\n";
  assert.equal(original.split(trecho).length - 1, 1, "alvo unico do mutante");
  const alterado = original.replace(trecho, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  assert.equal(await ler(), alterado, "o banco nao instalou o mutante exato");
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function semear() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}')",
    [ADMIN, "admin@banners-r104.fixture.invalid"],
  );
  // O gatilho de profiles sincroniza o papel em auth.users: admin nas duas fontes.
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Admin ficticio','admin')",
    [ADMIN],
  );
  await c.query("DELETE FROM public.banners");
  for (const [n, posicao, ordem] of [
    [10, "home_top", 10],
    [20, "home_top", 30],
    [30, "home_top", 70],
    [40, "home_middle", 50],
  ]) {
    await c.query(
      `INSERT INTO public.banners (id,image_url,"position","order")
       VALUES ($1,'https://fixture.invalid/banner.png',$2,$3)`,
      [id(n), posicao, ordem],
    );
  }
  await mutar();
}

const foto = async () =>
  (
    await P.conexao().query(
      'SELECT id,"position","order" FROM public.banners ORDER BY id',
    )
  ).rows;
const reordenar = (primeiro, segundo) =>
  P.tentar(
    "authenticated",
    "SELECT public.reorder_banners_atomic('home_top',$1,$2)",
    [primeiro, segundo],
    SESSAO,
  );

for (const [rotulo, segundo] of [
  ["inexistente", id(99)],
  ["de outra posicao", id(40)],
]) {
  prova(`banner ${rotulo} recusa e preserva ids e ordens sem normalizar`, () =>
    P.emTransacao(async () => {
      await semear();
      const antes = await foto();
      assert.deepEqual(
        antes.filter((b) => b.position === "home_top").map((b) => b.order),
        [10, 30, 70],
        "fixture precisa de lacunas para detectar normalizacao indevida",
      );
      const r = await reordenar(id(10), segundo);
      assert.equal(r.codigo, "P0001", `banner ${rotulo} foi aceito`);
      assert.equal(r.erro, "Banner não encontrado.");
      const depois = await foto();
      assert.deepEqual(
        depois,
        antes,
        "a recusa alterou ids, posicoes ou ordens",
      );
      assert.ok(
        depois.every((b) => b.order !== null),
        "nenhuma ordem vira NULL",
      );
    }),
  );
}

prova("dois banners validos normalizam e trocam apenas suas ordens", () =>
  P.emTransacao(async () => {
    await semear();
    const r = await reordenar(id(10), id(30));
    assert.equal(r.codigo, undefined, r.erro);
    assert.deepEqual(await foto(), [
      { id: id(10), position: "home_top", order: 3 },
      { id: id(20), position: "home_top", order: 2 },
      { id: id(30), position: "home_top", order: 1 },
      { id: id(40), position: "home_middle", order: 50 },
    ]);
  }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("reordenar banners com id invalido preserva a ordem");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
