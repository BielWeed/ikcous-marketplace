"use strict";

// Corpo VIVO da 20261310, sem rollback da sucessora nem SQL historico.
// So clone descartavel do rodar-isolado.cjs (CI_BANCO_EFEMERO=1 + localhost).
// MUTANTE_CONFIG_SEM_ADMIN_ATUAL=1 retira so a guarda atual, dentro da transacao.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const U = "b100b002-0000-4000-8000-000000000001";
const SIG = "public.upsert_store_config(jsonb)";
const GUARDA = `  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;
`;
const SQL = "SELECT public.upsert_store_config($1::jsonb) AS r";
const PARAMS = [
  JSON.stringify({
    share_text: "Texto ficticio novo",
    free_shipping_card_style: "compacto",
    local_delivery_days: 3,
  }),
];

async function preparar(perfil, auth, jwt) {
  const c = P.conexao();
  const vivo = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
  ).rows[0].d;
  assert.ok(vivo.includes("free_shipping_card_style"), "corpo anterior a 310");
  if (process.env.MUTANTE_CONFIG_SEM_ADMIN_ATUAL === "1") {
    const definicao = vivo.replace(/\r/g, "");
    assert.equal(definicao.split(GUARDA).length - 1, 1, "guarda nao unica");
    await c.query(definicao.replace(GUARDA, ""));
    console.log("MUTANTE aplicado: configuracao sem checagem de admin atual");
  }
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'config-rebaixado@fixture.invalid', '{}')",
    [U],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia', $2)",
    [U, perfil],
  );
  // Nao deixar a sincronizacao do INSERT apagar a divergencia intencional.
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
  );
  await c.query(`INSERT INTO public.store_config
    (id, share_text, free_shipping_card_style, local_delivery_days)
    VALUES (1, 'Texto ficticio anterior', 'completo', 1)
    ON CONFLICT (id) DO UPDATE SET share_text = EXCLUDED.share_text,
      free_shipping_card_style = EXCLUDED.free_shipping_card_style,
      local_delivery_days = EXCLUDED.local_delivery_days`);
  return {
    uid: U,
    claims: JSON.stringify({
      sub: U,
      role: "authenticated",
      app_metadata: { role: jwt },
    }),
  };
}

async function fotografar() {
  return (
    await P.conexao().query(
      "SELECT to_jsonb(c) AS config FROM public.store_config c ORDER BY id",
    )
  ).rows;
}

for (const [nome, perfil, auth, jwt] of [
  ["cliente", "customer", "customer", "customer"],
  ["rebaixado so em profiles", "customer", "admin", "admin"],
  ["rebaixado so em auth.users", "admin", "customer", "admin"],
]) {
  prova(`${nome}: recusa sem alterar configuracao inteira`, () =>
    P.emTransacao(async () => {
      const sessao = await preparar(perfil, auth, jwt);
      assert.deepEqual(
        await P.como(
          "authenticated",
          "SELECT current_user AS papel, auth.uid() AS uid, public.is_admin() AS jwt, public.rls_admin_atual() AS atual",
          [],
          sessao,
        ),
        [
          {
            papel: "authenticated",
            uid: U,
            jwt: jwt === "admin",
            atual: false,
          },
        ],
      );
      const antes = await fotografar();
      assert.equal(antes.length, 1, "configuracao precisa existir");
      const r = await P.tentar("authenticated", SQL, PARAMS, sessao);
      assert.equal(r.codigo, "P0001", `configuracao foi aceita: ${r.erro}`);
      assert.match(
        r.erro,
        /Não autorizado: Apenas admins podem configurar a loja/,
      );
      assert.deepEqual(
        await fotografar(),
        antes,
        "recusa alterou configuracao",
      );
    }),
  );
}

prova("controle: admin atual salva o mesmo payload valido", () =>
  P.emTransacao(async () => {
    const sessao = await preparar("admin", "admin", "admin");
    const r = await P.tentar("authenticated", SQL, PARAMS, sessao);
    assert.equal(r.codigo, undefined, r.erro);
    const config = (await fotografar())[0].config;
    assert.equal(config.share_text, "Texto ficticio novo");
    assert.equal(config.free_shipping_card_style, "compacto");
    assert.equal(config.local_delivery_days, 3);
    assert.equal(r.linhas[0].r.free_shipping_card_style, "compacto");
  }),
);

async function main() {
  await P.conectar();
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT so permite conferir a identidade
  // como authenticated neste clone descartavel.
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("configuracao recusa admin rebaixado no corpo vivo");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
