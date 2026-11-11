"use strict";

// UNIQUE(code) coupons_code_key vem do baseline 20260806000000 e segue vivo.
// So clone descartavel de rodar-isolado.cjs; fixtures/DDL voltam no ROLLBACK.
// MUTANTE_R100=cupom-sem-codigo-unico remove somente essa constraint:
// INSERT e UPDATE duplicados devem reprovar pela ausencia de 23505.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b1020000-0000-4000-8000-000000000101";
const CUPOM = "b1020000-0000-4000-8000-000000000110";
const OUTRO = "b1020000-0000-4000-8000-000000000111";
const REPETIDO = "b1020000-0000-4000-8000-000000000112";
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};

async function mutar() {
  const nome = "cupom-sem-codigo-unico";
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
  assert.deepEqual(
    antes.filter((r) => r.conname === "coupons_code_key"),
    [{ conname: "coupons_code_key", contype: "u", def: "UNIQUE (code)" }],
    "a prova exige a constraint viva de codigo unico",
  );
  if (process.env.MUTANTE_R100 !== nome) return;
  await c.query("ALTER TABLE public.coupons DROP CONSTRAINT coupons_code_key");
  assert.deepEqual(
    await restricoes(),
    antes.filter((r) => r.conname !== "coupons_code_key"),
    "o banco deve remover somente coupons_code_key",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

for (const operacao of ["INSERT", "UPDATE"]) {
  prova(`${operacao} de codigo repetido recusa 23505 sem mudar os cupons`, () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await c.query(
        "INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,'admin@r102h.fixture.invalid','{\"role\":\"admin\"}'::jsonb)",
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
      const inserir = (id, codigo) =>
        P.tentar(
          "authenticated",
          `INSERT INTO public.coupons(id,code,type,value,active)
           VALUES($1,$2,'percentage',10,true) RETURNING id,code`,
          [id, codigo],
          SESSAO,
        );
      const primeiro = await inserir(CUPOM, "PROMO10");
      assert.equal(primeiro.codigo, undefined, primeiro.erro);
      assert.deepEqual(primeiro.linhas, [{ id: CUPOM, code: "PROMO10" }]);
      // Controle de permissao e validade: outro codigo e aceito pelo MESMO admin.
      const diferente = await inserir(OUTRO, "PROMO20");
      assert.equal(diferente.codigo, undefined, diferente.erro);
      assert.deepEqual(diferente.linhas, [{ id: OUTRO, code: "PROMO20" }]);
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
          ? await inserir(REPETIDO, "PROMO10")
          : await P.tentar(
              "authenticated",
              "UPDATE public.coupons SET code='PROMO10' WHERE id=$1 RETURNING id,code",
              [OUTRO],
              SESSAO,
            );
      const depois = await foto();
      assert.equal(
        recusa.codigo,
        "23505",
        `${operacao} com codigo repetido foi aceito pelo banco`,
      );
      assert.equal(
        recusa.restricao,
        "coupons_code_key",
        "a recusa deve vir da unicidade de code, nao de outra constraint",
      );
      assert.deepEqual(depois, antes, "a recusa alterou as linhas dos cupons");
    }),
  );
}

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("codigo repetido de cupom e recusado no banco");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
