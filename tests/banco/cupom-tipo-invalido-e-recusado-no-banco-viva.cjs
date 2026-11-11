"use strict";

// CHECK coupons_type_check vem do baseline 20260806000000 e segue vivo.
// So clone descartavel de rodar-isolado.cjs, com as migrations em ordem:
// fixtures e DDL voltam no ROLLBACK; nenhum SQL de producao muda.
// MUTANTE_R104F=cupom-sem-check-de-tipo remove somente essa constraint:
// INSERT e UPDATE com 'percentual' devem reprovar pela ausencia de 23514.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b1040000-0000-4000-8000-000000000f01";
const FIXO = "b1040000-0000-4000-8000-000000000f10";
const PERCENTUAL = "b1040000-0000-4000-8000-000000000f11";
const INVALIDO = "b1040000-0000-4000-8000-000000000f12";
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

async function mutar() {
  const nome = "cupom-sem-check-de-tipo";
  const c = P.conexao();
  const restricoes = async () =>
    (
      await c.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conrelid='public.coupons'::regclass ORDER BY conname`,
      )
    ).rows;
  const antes = await restricoes();
  const check = antes.find((r) => r.conname === "coupons_type_check");
  assert.ok(check, "a prova exige a constraint viva do tipo de cupom");
  assert.equal(check.contype, "c");
  assert.equal(
    check.def,
    "CHECK ((type = ANY (ARRAY['fixed'::text, 'percentage'::text])))",
  );
  if (process.env.MUTANTE_R104F !== nome) return;
  await c.query(
    "ALTER TABLE public.coupons DROP CONSTRAINT coupons_type_check",
  );
  assert.deepEqual(
    await restricoes(),
    antes.filter((r) => r.conname !== "coupons_type_check"),
    "o banco deve remover somente coupons_type_check",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

for (const operacao of ["INSERT", "UPDATE"]) {
  prova(`${operacao} de tipo invalido recusa 23514 sem mudar os cupons`, () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await c.query(
        `INSERT INTO auth.users(id,email,raw_app_meta_data)
         VALUES($1,'admin@r104f.fixture.invalid','{"role":"admin"}'::jsonb)`,
        [ADMIN],
      );
      await c.query(
        "INSERT INTO public.profiles(id,full_name,role) VALUES($1,'Admin ficticio','admin')",
        [ADMIN],
      );
      assert.deepEqual(
        await P.como(
          "authenticated",
          "SELECT current_user AS papel, auth.uid() AS uid, public.rls_admin_atual() AS atual",
          [],
          SESSAO,
        ),
        [{ papel: "authenticated", uid: ADMIN, atual: true }],
      );
      const inserir = (id, codigo, tipo) =>
        P.tentar(
          "authenticated",
          `INSERT INTO public.coupons(id,code,type,value,active)
           VALUES($1,$2,$3,10,true) RETURNING id,code,type`,
          [id, codigo, tipo],
          SESSAO,
        );
      // Os dois tipos validos passam pelo MESMO papel e pelas mesmas permissoes.
      for (const [id, codigo, tipo] of [
        [FIXO, "R104FFIXO", "fixed"],
        [PERCENTUAL, "R104FPERCENT", "percentage"],
      ]) {
        const controle = await inserir(id, codigo, tipo);
        assert.equal(controle.codigo, undefined, controle.erro);
        assert.deepEqual(controle.linhas, [{ id, code: codigo, type: tipo }]);
      }
      const foto = async () =>
        (
          await c.query(
            "SELECT to_jsonb(c) AS r FROM public.coupons c ORDER BY id",
          )
        ).rows;
      const antes = await foto();
      await mutar();
      const recusa =
        operacao === "INSERT"
          ? await inserir(INVALIDO, "R104FINVALIDO", "percentual")
          : await P.tentar(
              "authenticated",
              "UPDATE public.coupons SET type='percentual' WHERE id=$1 RETURNING id,type",
              [FIXO],
              SESSAO,
            );
      assert.equal(
        recusa.codigo,
        "23514",
        `${operacao} com tipo percentual foi aceito pelo banco`,
      );
      assert.equal(
        recusa.restricao,
        "coupons_type_check",
        "a recusa deve vir do CHECK de type, nao de outra constraint",
      );
      assert.deepEqual(await foto(), antes, "a recusa alterou os cupons");
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM public.coupons WHERE code='R104FINVALIDO'",
          )
        ).rows[0].n,
        0,
        "nenhum cupom invalido foi gravado",
      );
      assert.deepEqual(
        (await c.query("SELECT type FROM public.coupons WHERE id=$1", [FIXO]))
          .rows,
        [{ type: "fixed" }],
        "o UPDATE recusado preserva o tipo fixed",
      );
    }),
  );
}

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("tipo invalido de cupom e recusado no banco");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
