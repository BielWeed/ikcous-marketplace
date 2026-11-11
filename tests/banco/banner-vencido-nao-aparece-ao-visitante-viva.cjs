"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// Policy VIVA: banners_select_policy da 20261381000000 (ultima que a redefine; a admin e' a
// banners_admin_select_policy da mesma migration). A guarda provada: o limite de TERMINO
// (`end_date IS NULL OR end_date >= now()`). MUTANTE_R100 troca a policy removendo so esse limite;
// fixtures e mutante voltam no ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b102b000-0000-4000-8000-000000000101";
const CLIENTE = "b102b000-0000-4000-8000-000000000102";
const VENCIDO = "b102b000-0000-4000-8000-000000000110";
const VIGENTE = "b102b000-0000-4000-8000-000000000111";
const LIMITE_DE_TERMINO = "((end_date IS NULL) OR (end_date >= now()))";

async function mutar() {
  const nome = "banner-sem-limite-de-termino";
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query(
        `SELECT pg_get_expr(polqual, polrelid) AS q FROM pg_policy
          WHERE polrelid = 'public.banners'::regclass AND polname = 'banners_select_policy'`,
      )
    ).rows;
  const antes = await ler();
  assert.equal(
    antes.length,
    1,
    `mutante ${nome}: a policy deve existir uma vez`,
  );
  const trecho = ` AND ${LIMITE_DE_TERMINO}`;
  assert.equal(
    antes[0].q.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez em ${antes[0].q}`,
  );
  const alterado = antes[0].q.replace(trecho, "");
  await c.query(
    `ALTER POLICY banners_select_policy ON public.banners USING (${alterado})`,
  );
  const depois = await ler();
  assert.equal(depois.length, 1);
  assert.equal(
    depois[0].q,
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  assert.ok(!depois[0].q.includes("end_date"), "o limite de termino sobrou");
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function pessoa(uid, cargo) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,$3::jsonb)",
    [uid, `${uid}@r102b.fixture.invalid`, JSON.stringify({ role: cargo })],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia',$2)",
    [uid, cargo],
  );
}

const identidade = (uid, cargo) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: cargo },
  }),
});
const LISTAR =
  "SELECT id FROM public.banners WHERE id = ANY($1::uuid[]) ORDER BY id";
const ids = (r) => r.linhas.map((l) => l.id);

prova(
  "banner vencido nao aparece a visitante nem a cliente; so o vigente; o admin ve os dois",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await pessoa(ADMIN, "admin");
      await pessoa(CLIENTE, "customer");
      await c.query(
        `INSERT INTO public.banners (id,image_url,title,active,start_date,end_date) VALUES
          ($1,'https://fixture.invalid/vencido.png','Vencido ficticio',true,now() - interval '10 days',now() - interval '1 day'),
          ($2,'https://fixture.invalid/vigente.png','Vigente ficticio',true,now() - interval '1 day',now() + interval '1 day')`,
        [VENCIDO, VIGENTE],
      );
      await mutar();

      const alvo = [[VENCIDO, VIGENTE]];
      const visitante = await P.tentar("anon", LISTAR, alvo, {});
      assert.equal(visitante.erro, undefined, visitante.erro);
      assert.deepEqual(
        ids(visitante),
        [VIGENTE],
        "o visitante viu o banner vencido (ou nao viu o vigente)",
      );
      const cliente = await P.tentar(
        "authenticated",
        LISTAR,
        alvo,
        identidade(CLIENTE, "customer"),
      );
      assert.equal(cliente.erro, undefined, cliente.erro);
      assert.deepEqual(
        ids(cliente),
        [VIGENTE],
        "o cliente viu o banner vencido (ou nao viu o vigente)",
      );

      // Controle positivo: o painel segue vendo tudo, vencido incluso (a policy de admin e' outra).
      const admin = await P.tentar(
        "authenticated",
        LISTAR,
        alvo,
        identidade(ADMIN, "admin"),
      );
      assert.equal(admin.erro, undefined, admin.erro);
      assert.deepEqual([...ids(admin)].sort(), [VENCIDO, VIGENTE].sort());
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("banner vencido nao aparece ao visitante");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
