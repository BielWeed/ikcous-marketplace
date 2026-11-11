"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Esta corrida precisa COMMIT real: fixtures ficam apenas no clone descartado pelo runner.
// O finally solta as transacoes, fecha B e restaura a funcao viva.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b100c000-0000-4000-8000-000000000001";
const B = "b100c000-0000-4000-8000-000000000002";
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

const CONTA = id(20),
  DESTINO = id(21);
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

const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SIG = "public.fin_lancamento_salvar(jsonb)";

prova(
  "edicao espera a baixa em outra conexao e recusa 22023 sem mudar valor, data nem saldo",
  async () => {
    const c = P.conexao();
    const b = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await b.connect();
    const original = (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [SIG])
    ).rows[0].d;
    let pendente;
    try {
      await c.query("BEGIN");
      await contas();
      const novo = await salvar(dados({ status: "previsto" }));
      assert.equal(novo.codigo, undefined, novo.erro);
      const lancamento = novo.linhas[0].r.ids[0];
      await mutar(
        "edicao-sem-for-update",
        SIG,
        "WHERE id = v_id FOR UPDATE;",
        "WHERE id = v_id;",
      );
      await c.query("COMMIT");
      await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await c.query("SET LOCAL statement_timeout='8s'");
      const hoje = (await c.query("SELECT public.fin__hoje()::text AS d"))
        .rows[0].d;
      await P.como(
        "authenticated",
        "SELECT public.fin_lancamento_baixar($1,$2::date,NULL)",
        [lancamento, hoje],
        sessao(ADMIN),
        c,
      );
      const foto = async () => ({
        linha: (
          await c.query(
            "SELECT to_jsonb(l) AS l FROM public.fin_lancamentos l WHERE id=$1",
            [lancamento],
          )
        ).rows[0].l,
        saldo: Number(
          (
            await P.como(
              "authenticated",
              "SELECT public.fin_contas_listar() AS r",
              [],
              sessao(ADMIN),
              c,
            )
          )[0].r.find((x) => x.id === CONTA).saldo,
        ),
      });
      const baixado = await foto();
      assert.equal(baixado.linha.status, "realizado");
      assert.equal(Number(baixado.linha.valor), 30);
      assert.equal(baixado.linha.data_realizacao, hoje);
      assert.equal(baixado.saldo, 970);

      await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await b.query("SET LOCAL statement_timeout='8s'");
      await b.query("SET LOCAL lock_timeout='6s'");
      const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      const pidA = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      let terminou = false;
      pendente = P.como(
        "authenticated",
        "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
        [
          JSON.stringify(
            dados({
              id: lancamento,
              status: "previsto",
              valor: 99,
              descricao: "Edicao concorrente ficticia",
            }),
          ),
        ],
        sessao(ADMIN),
        b,
      )
        .then(
          (linhas) => ({ linhas }),
          (erro) => ({ codigo: erro.code, erro: erro.message }),
        )
        .finally(() => {
          terminou = true;
        });
      const limite = Date.now() + 3000;
      let bloqueios = [];
      do {
        bloqueios = (
          await c.query("SELECT pg_blocking_pids($1) AS pids", [pidB])
        ).rows[0].pids;
        if (bloqueios.includes(pidA)) break;
        await dormir(25);
      } while (!terminou && Date.now() < limite);
      assert.ok(
        bloqueios.includes(pidA),
        "B nao aguardou a transacao A no banco",
      );
      assert.equal(terminou, false, "B terminou antes de A liberar a baixa");
      await c.query("COMMIT");
      const r = await pendente;
      // Uma edicao indevidamente aceita deve persistir: nao podemos esconder o dano dando ROLLBACK no mutante.
      await b.query(r.codigo ? "ROLLBACK" : "COMMIT");
      await c.query("BEGIN");
      const depois = await foto();
      assert.deepEqual(
        depois,
        baixado,
        "edicao concorrente sobrescreveu a baixa ou mudou saldo",
      );
      assert.equal(
        r.codigo,
        "22023",
        "B nao releu o status realizado depois de esperar",
      );
      assert.match(
        r.erro,
        /Só um lançamento a pagar\/receber pode ser editado/,
      );
      await c.query("ROLLBACK");
    } finally {
      // Soltar A tambem garante que a promessa de B termina em qualquer falha.
      await c.query("ROLLBACK").catch(() => {});
      if (pendente) await pendente;
      await b.query("ROLLBACK").catch(() => {});
      await b.end();
      await c.query(original);
    }
  },
);

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("baixa concorrente protege lancamento");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
