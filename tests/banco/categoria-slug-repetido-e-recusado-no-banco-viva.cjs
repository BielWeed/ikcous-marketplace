"use strict";

// Criar categoria faz INSERT direto no useCategories, sob a RLS do admin atual.
// O nome diferente isola UNIQUE(slug) de UNIQUE(nome). So o clone descartavel.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b104ca00-0000-4000-8000-000000000001";
const PRIMEIRA = "b104ca00-0000-4000-8000-000000000010";
const SEGUNDA = "b104ca00-0000-4000-8000-000000000020";
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

async function mutar() {
  const nome = "categoria-sem-slug-unico";
  if (process.env.MUTANTE_R104 !== nome) return;
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
         WHERE conrelid='public.categorias'::regclass AND conname='categorias_slug_key'`,
      )
    ).rows;
  assert.deepEqual(await ler(), [{ d: "UNIQUE (slug)" }], "alvo do mutante");
  await c.query(
    "ALTER TABLE public.categorias DROP CONSTRAINT categorias_slug_key",
  );
  assert.deepEqual(await ler(), [], "o banco nao removeu a constraint");
  console.log(`MUTANTE aplicado: ${nome}`);
}

const inserir = (id, nome, slug) =>
  P.tentar(
    "authenticated",
    "INSERT INTO public.categorias (id,nome,slug,ativo) VALUES ($1,$2,$3,true)",
    [id, nome, slug],
    SESSAO,
  );
const foto = async () =>
  (
    await P.conexao().query(
      "SELECT id,nome,slug,ativo FROM public.categorias ORDER BY id",
    )
  ).rows;

prova(
  "criar categoria com slug repetido recusa 23505 sem duplicar ou alterar a primeira",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await c.query(
        "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}')",
        [ADMIN, "admin@categorias-r104.fixture.invalid"],
      );
      // O gatilho de profiles copia o papel para auth.users, nas duas fontes.
      await c.query(
        "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Admin ficticio','admin')",
        [ADMIN],
      );
      await c.query("DELETE FROM public.categorias");
      await mutar();

      const primeira = await inserir(PRIMEIRA, "Vestuário", "vestuario");
      assert.equal(primeira.codigo, undefined, primeira.erro);
      const antes = await foto();
      assert.deepEqual(antes, [
        { id: PRIMEIRA, nome: "Vestuário", slug: "vestuario", ativo: true },
      ]);

      const repetida = await inserir(SEGUNDA, "VESTUARIO", "vestuario");
      assert.equal(
        repetida.codigo,
        "23505",
        "criacao com slug repetido foi aceita",
      );
      assert.equal(repetida.restricao, "categorias_slug_key");
      assert.deepEqual(
        await foto(),
        antes,
        "a recusa mudou a categoria existente",
      );
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM public.categorias WHERE slug='vestuario'",
          )
        ).rows[0].n,
        1,
        "so uma categoria pode ter este slug",
      );

      // Mesmo id/nome que falharam; somente o slug muda. Nao e recusa geral de INSERT.
      const distinta = await inserir(SEGUNDA, "VESTUARIO", "outro-vestuario");
      assert.equal(distinta.codigo, undefined, distinta.erro);
      assert.deepEqual(await foto(), [
        ...antes,
        {
          id: SEGUNDA,
          nome: "VESTUARIO",
          slug: "outro-vestuario",
          ativo: true,
        },
      ]);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("categoria com slug repetido e recusada na criacao");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
