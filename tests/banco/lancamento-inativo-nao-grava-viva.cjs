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
const CATEGORIA = "f2000000-0000-4000-8000-000000000020";
async function contas() {
  await pessoa(ADMIN, "admin");
  await P.conexao().query(
    `INSERT INTO public.fin_contas (id,nome,tipo,saldo_inicial,saldo_inicial_em)
    VALUES ($1,'Origem ficticia','banco',1000,public.fin__hoje()-1),($2,'Destino ficticio','banco',0,public.fin__hoje()-1)`,
    [CONTA, DESTINO],
  );
}
const dados = (mais = {}) => ({
  tipo: "saida",
  status: "realizado",
  valor: 30,
  descricao: "Despesa ficticia",
  conta_id: CONTA,
  categoria_id: CATEGORIA,
  ...mais,
});
const salvar = (p) =>
  P.tentar(
    "authenticated",
    "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
    [JSON.stringify(p)],
    sessao(ADMIN),
  );

for (const tipo of ["origem", "destino"]) {
  prova(`conta ${tipo} inativa recusa sem gravar; reativar aceita`, () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await contas();
      const conta = tipo === "origem" ? CONTA : DESTINO;
      await c.query("UPDATE public.fin_contas SET ativa=false WHERE id=$1", [
        conta,
      ]);
      await mutar(
        "lancamento-sem-origem-ativa",
        "public.fin_lancamento_salvar(jsonb)",
        "IF NOT FOUND OR NOT v_conta.ativa THEN",
        "IF NOT FOUND THEN",
      );
      await mutar(
        "lancamento-sem-destino-ativo",
        "public.fin_lancamento_salvar(jsonb)",
        "IF NOT FOUND OR NOT v_destino.ativa OR v_destino.id = v_conta.id THEN",
        "IF NOT FOUND OR v_destino.id = v_conta.id THEN",
      );
      const p = dados(
        tipo === "destino"
          ? {
              tipo: "transferencia",
              conta_destino_id: DESTINO,
              categoria_id: null,
              chave_idempotencia: id(30),
            }
          : { chave_idempotencia: id(31) },
      );
      const foto = async () =>
        (
          await c.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.fin_lancamentos l) AS lancamentos,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY chave) FROM public.fin_lancamento_tentativas t) AS tentativas`)
        ).rows;
      const antes = await foto();
      const r = await salvar(p);
      assert.equal(
        r.codigo,
        "22023",
        `conta ${tipo} inativa gravou lancamento`,
      );
      assert.match(
        r.erro,
        tipo === "origem"
          ? /Escolha uma conta ativa/
          : /Escolha a conta de destino/,
      );
      assert.deepEqual(
        await foto(),
        antes,
        "recusa deixou lancamento ou tentativa",
      );
      await c.query("UPDATE public.fin_contas SET ativa=true WHERE id=$1", [
        conta,
      ]);
      const ok = await salvar(p);
      assert.equal(ok.codigo, undefined, ok.erro);
      const ids = ok.linhas[0].r.ids;
      assert.equal(ids.length, 1);
      const linha = (
        await c.query(
          "SELECT tipo,status,valor::text,conta_id,conta_destino_id FROM public.fin_lancamentos WHERE id=$1",
          [ids[0]],
        )
      ).rows;
      assert.deepEqual(linha, [
        {
          tipo: tipo === "destino" ? "transferencia" : "saida",
          status: "realizado",
          valor: "30.00",
          conta_id: CONTA,
          conta_destino_id: tipo === "destino" ? DESTINO : null,
        },
      ]);
      assert.deepEqual(
        (
          await c.query(
            "SELECT ids FROM public.fin_lancamento_tentativas WHERE chave=$1",
            [p.chave_idempotencia],
          )
        ).rows,
        [{ ids }],
      );
    }),
  );
}

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("lancamento exige contas ativas");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
