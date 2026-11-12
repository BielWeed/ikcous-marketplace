"use strict";

// Somente Postgres descartavel de rodar-isolado.cjs; o clone leva as fixtures.
// O primeiro cancelamento e commitado; a repeticao e o mutante voltam no ROLLBACK.
// Duas transacoes tornam observavel uma eventual reescrita de cancelado_em=now().
// Corpo vivo: 20261199000000, public.fin_lancamento_cancelar(uuid,text).
// MUTANTE_R100=financeiro-recancelar-sobrescreve-auditoria remove so a guarda
// de status cancelado; a segunda chamada deve reprovar pela ausencia de 22023.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b1020000-0000-4000-8000-000000000001";
const B = "b1020000-0000-4000-8000-000000000002";
const LANCAMENTO = "b1020000-0000-4000-8000-000000000010";
const FN = "public.fin_lancamento_cancelar(uuid,text)";

const sessao = (uid) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
});

async function mutar() {
  const nome = "financeiro-recancelar-sobrescreve-auditoria";
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  const trecho = `  IF v_l.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este lançamento já está cancelado.' USING ERRCODE = '22023';
  END IF;
`;
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

prova(
  "segundo admin nao recancela nem reescreve a auditoria do primeiro",
  async () => {
    const c = P.conexao();
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL TIME ZONE 'UTC'");
      for (const uid of [A, B]) {
        await c.query(
          'INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,\'{"role":"admin"}\'::jsonb)',
          [uid, `${uid}@r102h.fixture.invalid`],
        );
        await c.query(
          "INSERT INTO public.profiles(id,full_name,role) VALUES($1,'Admin ficticio','admin')",
          [uid],
        );
        const ator = await P.como(
          "authenticated",
          "SELECT current_user AS papel, auth.uid() AS uid, public.is_admin() AS admin, public.rls_admin_atual() AS atual",
          [],
          sessao(uid),
        );
        assert.deepEqual(ator, [
          { papel: "authenticated", uid, admin: true, atual: true },
        ]);
      }
      // Movimento manual realizado em conta bancaria, sem sessao de caixa.
      await c.query(
        `INSERT INTO public.fin_lancamentos
        (id,tipo,status,valor,conta_id,categoria_id,descricao,data_competencia,data_realizacao)
       VALUES($1,'saida','realizado',17.35,
         'f1000000-0000-4000-8000-000000000002',
         'f2000000-0000-4000-8000-000000000020',
         'Despesa ficticia R102H',current_date,current_date)`,
        [LANCAMENTO],
      );
      const foto = async () =>
        (
          await c.query(
            "SELECT to_jsonb(l) AS r FROM public.fin_lancamentos l WHERE id=$1",
            [LANCAMENTO],
          )
        ).rows[0].r;
      const inicial = await foto();
      assert.equal(inicial.status, "realizado");
      assert.equal(inicial.caixa_sessao_id, null);
      assert.equal(inicial.cancelado_por, null);
      assert.equal(inicial.cancelado_em, null);
      assert.equal(inicial.motivo_cancelamento, null);

      const cancelar = (uid, motivo) =>
        P.tentar(
          "authenticated",
          "SELECT public.fin_lancamento_cancelar($1::uuid,$2::text) AS r",
          [LANCAMENTO, motivo],
          sessao(uid),
        );
      const primeiro = await cancelar(A, "Motivo A ficticio");
      assert.equal(primeiro.codigo, undefined, primeiro.erro);
      assert.deepEqual(primeiro.linhas, [
        { r: { id: LANCAMENTO, status: "cancelado" } },
      ]);
      const antes = await foto();
      assert.equal(antes.status, "cancelado");
      assert.equal(antes.cancelado_por, A);
      assert.ok(antes.cancelado_em, "primeiro cancelamento precisa ter data");
      assert.equal(antes.motivo_cancelamento, "Motivo A ficticio");

      // now() e constante dentro da transacao: repetir nela nao provaria a data.
      await c.query("COMMIT");
      await c.query("SELECT pg_sleep(0.01)");
      await c.query("BEGIN");
      await c.query("SET LOCAL TIME ZONE 'UTC'");
      assert.equal(
        (
          await c.query("SELECT now() > $1::timestamptz AS posterior", [
            antes.cancelado_em,
          ])
        ).rows[0].posterior,
        true,
        "a repeticao precisa ter um now() posterior ao primeiro cancelamento",
      );
      await mutar();
      const repetido = await cancelar(B, "Motivo B ficticio");
      const depois = await foto();
      assert.equal(
        repetido.codigo,
        "22023",
        "segundo cancelamento foi aceito e sobrescreveu a auditoria do primeiro",
      );
      assert.equal(repetido.erro, "Este lançamento já está cancelado.");
      assert.deepEqual(
        depois,
        antes,
        "recusa alterou a linha, inclusive cancelado_por, cancelado_em ou motivo_cancelamento",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("recancelar nao sobrescreve a auditoria");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
