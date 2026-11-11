"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Fixtures e sabotagens sao desfeitas pelo ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
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

async function mutar(nome, assinatura, trecho, substituto) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

const CONTA = id(20);
const DESTINO = id(21);
async function contas() {
  await pessoa(ADMIN, "admin");
  await P.conexao().query(
    `INSERT INTO public.fin_contas (id,nome,tipo,saldo_inicial,saldo_inicial_em)
    VALUES ($1,'Origem ficticia','banco',1000,public.fin__hoje()-1),($2,'Destino ficticio','banco',0,public.fin__hoje()-1)`,
    [CONTA, DESTINO],
  );
}

const CAIXA = "f1000000-0000-4000-8000-000000000001";
const SIG =
  "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)";
for (const tipo of ["sangria", "suprimento"]) {
  prova(
    `${tipo}: contrapartida manual inativa nao deixa tentativa; reativar mesma chave aceita`,
    () =>
      P.emTransacao(async () => {
        const c = P.conexao();
        await contas();
        const aberto = await P.como(
          "authenticated",
          "SELECT public.fin_caixa_abrir(100,$1) AS r",
          [CAIXA],
          sessao(ADMIN),
        );
        const sessaoId = aberto[0].r.id;
        assert.ok(sessaoId);
        await c.query("UPDATE public.fin_contas SET ativa=false WHERE id=$1", [
          CONTA,
        ]);
        await mutar(
          "caixa-sem-contrapartida-ativa",
          SIG,
          "IF NOT FOUND OR NOT v_contra.ativa OR v_contra.id = v_s.conta_id THEN",
          "IF NOT FOUND OR v_contra.id = v_s.conta_id THEN",
        );
        const foto = async () =>
          (
            await c.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY chave) FROM public.fin_caixa_movimento_tentativas t) AS tentativas,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.fin_lancamentos l) AS lancamentos,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.fin_caixa_sessoes s) AS sessoes`)
          ).rows;
        const antes = await foto();
        const sql =
          "SELECT public.fin_caixa_movimentar_com_chave($1,$2,$3,20,'Movimento ficticio',$4) AS r";
        const params = [sessaoId, id(30), tipo, CONTA];
        const r = await P.tentar("authenticated", sql, params, sessao(ADMIN));
        assert.equal(
          r.codigo,
          "22023",
          "contrapartida inativa gerou movimento de caixa",
        );
        assert.match(r.erro, /Escolha para qual conta o dinheiro vai/);
        assert.deepEqual(
          await foto(),
          antes,
          "recusa deixou tentativa, transferencia ou mudou caixa",
        );
        await c.query("UPDATE public.fin_contas SET ativa=true WHERE id=$1", [
          CONTA,
        ]);
        const ok = await P.tentar("authenticated", sql, params, sessao(ADMIN));
        assert.equal(ok.codigo, undefined, ok.erro);
        const movimento = ok.linhas[0].r;
        assert.equal(movimento.replay, false, "a recusa reservou a chave");
        assert.equal(movimento.status, "realizado");
        assert.deepEqual(
          (
            await c.query(
              "SELECT origem,tipo,valor::text,conta_id,conta_destino_id FROM public.fin_lancamentos WHERE id=$1",
              [movimento.id],
            )
          ).rows,
          [
            {
              origem: tipo,
              tipo: "transferencia",
              valor: "20.00",
              conta_id: tipo === "sangria" ? CAIXA : CONTA,
              conta_destino_id: tipo === "sangria" ? CONTA : CAIXA,
            },
          ],
        );
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM public.fin_caixa_movimento_tentativas WHERE chave=$1 AND lancamento_id=$2",
              [id(30), movimento.id],
            )
          ).rows[0].n,
          1,
        );
      }),
  );
}

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("caixa exige contrapartida ativa");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
