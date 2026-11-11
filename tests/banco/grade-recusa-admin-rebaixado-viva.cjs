"use strict";

// Corpo VIVO da 20261395100000: nao desfaz a recusa de ressuscitar variacao.
// So clone descartavel do rodar-isolado.cjs (CI_BANCO_EFEMERO=1 + localhost).
// MUTANTE_GRADE_SEM_ADMIN_ATUAL=1 remove apenas a guarda atual na transacao.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const U = "b100b003-0000-4000-8000-000000000001";
const PRODUTO = "b100b003-0000-4000-8000-000000000010";
const VARIANTE = "b100b003-0000-4000-8000-000000000011";
const SIG =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";
const GUARDA = `  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
`;
const SQL = `SELECT public.salvar_produto_com_grade(
  $1::uuid, $2::timestamptz, $3::jsonb, $4::jsonb, $5::uuid[]) AS r`;
const SESSAO = {
  uid: U,
  claims: JSON.stringify({
    sub: U,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

async function preparar(perfil, auth) {
  const c = P.conexao();
  const vivo = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d;
  assert.ok(
    vivo.includes("20261395100000: variacao que alguem excluiu"),
    "a prova precisa do corpo vivo da 3951, nao da 352",
  );
  if (process.env.MUTANTE_GRADE_SEM_ADMIN_ATUAL === "1") {
    const definicao = vivo.replace(/\r/g, "");
    assert.equal(definicao.split(GUARDA).length - 1, 1, "guarda nao unica");
    await c.query(definicao.replace(GUARDA, ""));
    console.log("MUTANTE aplicado: grade sem checagem de admin atual");
  }
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'grade-rebaixado@fixture.invalid', '{}')",
    [U],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia', $2)",
    [U, perfil],
  );
  await c.query(
    "UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('role', $2::text) WHERE id = $1",
    [U, auth],
  );
  assert.deepEqual(
    (
      await c.query(
        "SELECT p.role AS perfil, u.raw_app_meta_data->>'role' AS auth FROM public.profiles p JOIN auth.users u USING (id) WHERE p.id = $1",
        [U],
      )
    ).rows,
    [{ perfil, auth }],
    "a fixture precisa divergir em SOMENTE uma fonte",
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Produto ficticio anterior', 25, 10, true, 5)",
    [PRODUTO],
  );
  await c.query(
    `INSERT INTO public.product_variants
      (id, product_id, name, value, stock_increment, active, sku)
      VALUES ($1, $2, 'Tamanho', 'P', 10, true, 'GRADE-REBAIXADO-P')`,
    [VARIANTE, PRODUTO],
  );
  // Manter microssegundos: converter timestamptz em Date no JS perderia precisao.
  const base = (
    await c.query(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [PRODUTO],
    )
  ).rows[0].v;
  assert.ok(base, "a alteracao de estoque precisa de versao valida");
  return [
    PRODUTO,
    base,
    JSON.stringify({ nome: "Produto ficticio novo", estoque: 8 }),
    JSON.stringify([
      {
        id: VARIANTE,
        name: "Tamanho",
        value: "M",
        sku: "GRADE-REBAIXADO-M",
        active: true,
        stock_increment: 7,
      },
    ]),
    [],
  ];
}

async function fotografar() {
  return (
    await P.conexao().query(
      `SELECT
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.produtos p WHERE id = $1) AS produtos,
        (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.product_variants v WHERE product_id = $1) AS grade`,
      [PRODUTO],
    )
  ).rows[0];
}

for (const [nome, perfil, auth] of [
  ["rebaixado so em profiles", "customer", "admin"],
  ["rebaixado so em auth.users", "admin", "customer"],
]) {
  prova(`${nome}: JWT antigo nao altera produto, grade nem estoques`, () =>
    P.emTransacao(async () => {
      const params = await preparar(perfil, auth);
      assert.deepEqual(
        await P.como(
          "authenticated",
          "SELECT current_user AS papel, auth.uid() AS uid, public.is_admin() AS jwt, public.rls_admin_atual() AS atual",
          [],
          SESSAO,
        ),
        [{ papel: "authenticated", uid: U, jwt: true, atual: false }],
      );
      const antes = await fotografar();
      const r = await P.tentar("authenticated", SQL, params, SESSAO);
      assert.equal(r.codigo, "42501", `rebaixado salvou a grade: ${r.erro}`);
      assert.match(r.erro, /Acesso negado/);
      assert.deepEqual(
        await fotografar(),
        antes,
        "recusa alterou produto/grade",
      );
    }),
  );
}

prova("controle: admin atual altera produto, grade e ambos os estoques", () =>
  P.emTransacao(async () => {
    const params = await preparar("admin", "admin");
    const r = await P.tentar("authenticated", SQL, params, SESSAO);
    assert.equal(r.codigo, undefined, r.erro);
    assert.ok(r.linhas[0].r.ultima_atualizacao);
    const depois = await fotografar();
    assert.equal(depois.produtos[0].nome, "Produto ficticio novo");
    assert.equal(depois.produtos[0].estoque, 8);
    assert.equal(depois.grade.length, 1);
    assert.equal(depois.grade[0].id, VARIANTE);
    assert.equal(depois.grade[0].value, "M");
    assert.equal(depois.grade[0].stock_increment, 7);
  }),
);

async function main() {
  await P.conectar();
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT so permite conferir a identidade
  // como authenticated neste clone descartavel.
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("grade recusa admin rebaixado no corpo vivo");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
