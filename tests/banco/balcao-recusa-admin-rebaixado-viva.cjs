"use strict";

// Corpo VIVO da 20261280, nove argumentos: nao desfaz sucessoras.
// So clone descartavel do rodar-isolado.cjs (CI_BANCO_EFEMERO=1 + localhost).
// MUTANTE_BALCAO_SEM_ADMIN_ATUAL=1 tira SOMENTE a guarda atual, na transacao.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const U = "b100b001-0000-4000-8000-000000000001";
const PRODUTO = "b100b001-0000-4000-8000-000000000010";
const CHAVE = "b100b001-0000-4000-8000-000000000020";
const SIG =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)";
const GUARDA = `    IF public.is_admin_atual() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
    END IF;
`;
const SQL = `SELECT public.registrar_venda_presencial(
  $1::jsonb, 'cash', NULL::uuid, 'Cliente ficticio', NULL,
  5::numeric, 'Desconto ficticio conferido', $2::uuid, 20::numeric) AS r`;
const PARAMS = [
  JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
  CHAVE,
];
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
    await c.query(
      "SELECT pronargs, pg_get_functiondef(oid) AS d FROM pg_proc WHERE oid = $1::regprocedure",
      [SIG],
    )
  ).rows[0];
  assert.equal(vivo.pronargs, 9, "a prova exige a assinatura atual da 280");
  assert.ok(vivo.d.includes("p_total_esperado"), "corpo anterior a 280");
  if (process.env.MUTANTE_BALCAO_SEM_ADMIN_ATUAL === "1") {
    const definicao = vivo.d.replace(/\r/g, "");
    assert.equal(definicao.split(GUARDA).length - 1, 1, "guarda nao unica");
    await c.query(definicao.replace(GUARDA, ""));
    console.log("MUTANTE aplicado: balcao sem checagem de admin atual");
  }
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'balcao-rebaixado@fixture.invalid', '{}')",
    [U],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia', $2)",
    [U, perfil],
  );
  // O INSERT de profiles sincroniza auth.users; so depois criamos a divergencia.
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
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Produto ficticio', 25, 10, true, 5)",
    [PRODUTO],
  );
}

async function fotografar() {
  return (
    await P.conexao().query(`SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.produtos p) AS produtos,
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.product_variants v) AS grade,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.marketplace_orders o) AS pedidos,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.marketplace_order_items i) AS itens,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.marketplace_order_history h) AS historico,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.marketplace_order_payment_history h) AS pagamentos,
      (SELECT jsonb_agg(to_jsonb(n) ORDER BY order_id) FROM public.marketplace_order_internal_notes n) AS notas,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.fin_lancamentos l) AS financeiro`)
  ).rows[0];
}

for (const [nome, perfil, auth] of [
  ["rebaixado so em profiles", "customer", "admin"],
  ["rebaixado so em auth.users", "admin", "customer"],
]) {
  prova(`${nome}: JWT admin antigo nao vende nem altera dado`, () =>
    P.emTransacao(async () => {
      await preparar(perfil, auth);
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
      const r = await P.tentar("authenticated", SQL, PARAMS, SESSAO);
      assert.equal(r.codigo, "42501", `rebaixado nao pode vender: ${r.erro}`);
      assert.match(r.erro, /Acesso negado: só a loja registra venda no balcão/);
      assert.deepEqual(await fotografar(), antes, "recusa alterou dados");
    }),
  );
}

prova("controle: admin atual registra a venda de nove argumentos", () =>
  P.emTransacao(async () => {
    await preparar("admin", "admin");
    const r = await P.tentar("authenticated", SQL, PARAMS, SESSAO);
    assert.equal(r.codigo, undefined, r.erro);
    const venda = r.linhas[0].r;
    assert.equal(venda.ja_existia, false);
    assert.equal(venda.order.vendedor_id, U);
    assert.equal(Number(venda.order.total), 20);
    assert.equal(venda.items.length, 1);
    const depois = await fotografar();
    assert.equal(depois.produtos.find((p) => p.id === PRODUTO).estoque, 9);
    assert.ok(depois.historico.some((h) => h.order_id === venda.order.id));
    assert.ok(depois.pagamentos.some((h) => h.order_id === venda.order.id));
    assert.ok(
      depois.notas.some(
        (n) =>
          n.order_id === venda.order.id &&
          n.note === "Desconto ficticio conferido",
      ),
    );
  }),
);

async function main() {
  await P.conectar();
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT so permite conferir a identidade
  // como authenticated neste clone descartavel.
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("balcao recusa admin rebaixado no corpo vivo");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
