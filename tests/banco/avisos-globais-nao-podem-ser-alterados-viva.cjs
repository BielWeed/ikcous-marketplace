"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Fixtures e sabotagens sao desfeitas pelo ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b100c000-0000-4000-8000-000000000001";
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

async function sabotar() {
  const nome = process.env.MUTANTE_R100;
  const c = P.conexao();
  if (nome === "aviso-sem-check") {
    await c.query(
      "ALTER POLICY notificacoes_update_policy ON public.notificacoes WITH CHECK (true)",
    );
  } else if (nome === "aviso-global-update" || nome === "aviso-global-delete") {
    const politica =
      nome === "aviso-global-update"
        ? "notificacoes_update_policy"
        : "notificacoes_delete_policy";
    const qual = (
      await c.query(
        "SELECT pg_get_expr(polqual,polrelid) AS q FROM pg_policy WHERE polrelid='public.notificacoes'::regclass AND polname=$1",
        [politica],
      )
    ).rows[0].q;
    assert.ok(qual.includes("usuario_id"));
    await c.query(
      `ALTER POLICY ${politica} ON public.notificacoes USING ((${qual}) OR usuario_id IS NULL)`,
    );
  } else return;
  console.log(`MUTANTE aplicado: ${nome}`);
}
for (const operacao of [
  "transformar em global",
  "editar global",
  "apagar global",
]) {
  prova(`cliente nao pode ${operacao}`, () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await pessoa(A);
      await c.query(
        `INSERT INTO public.notificacoes (id,usuario_id,tipo,titulo,mensagem)
      VALUES ($1,$3,'info','Proprio','Inventado'),($2,NULL,'info','Global','Inventado')`,
        [id(10), id(11), A],
      );
      await sabotar();
      assert.equal(
        (
          await P.como(
            "authenticated",
            "SELECT id FROM public.notificacoes ORDER BY id",
            [],
            sessao(A),
          )
        ).length,
        2,
        "global precisa ser legivel",
      );
      const antes = (
        await c.query("SELECT * FROM public.notificacoes ORDER BY id")
      ).rows;
      if (operacao === "transformar em global") {
        const r = await P.tentar(
          "authenticated",
          "UPDATE public.notificacoes SET usuario_id=NULL WHERE id=$1 RETURNING id",
          [id(10)],
          sessao(A),
        );
        assert.equal(
          r.codigo,
          "42501",
          "WITH CHECK deixou o cliente transformar seu aviso em global",
        );
        assert.match(r.erro, /row-level security/);
      } else {
        // Tentar se apropriar do recado satisfaria o WITH CHECK; so o USING protege a linha global.
        const sql =
          operacao === "editar global"
            ? "UPDATE public.notificacoes SET mensagem='Alterado',usuario_id=$2 WHERE id=$1 RETURNING id"
            : "DELETE FROM public.notificacoes WHERE id=$1 RETURNING id";
        const params = operacao === "editar global" ? [id(11), A] : [id(11)];
        assert.deepEqual(
          await P.como("authenticated", sql, params, sessao(A)),
          [],
          "cliente alterou recado global",
        );
      }
      assert.deepEqual(
        (await c.query("SELECT * FROM public.notificacoes ORDER BY id")).rows,
        antes,
        "recusa mudou avisos",
      );
      assert.deepEqual(
        await P.como(
          "authenticated",
          "UPDATE public.notificacoes SET lida=true WHERE id=$1 RETURNING id",
          [id(10)],
          sessao(A),
        ),
        [{ id: id(10) }],
        "controle: marcar proprio aviso precisa funcionar",
      );
    }),
  );
}

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("avisos globais protegidos");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
