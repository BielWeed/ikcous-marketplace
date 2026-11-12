"use strict";

/**
 * PROVA VIVA: a abertura do caixa vigente (20261370, sem desfazer sucessoras)
 * exige admin ATUAL. Cliente, rebaixados com JWT antigo e anon nao podem
 * criar sessao nem lancamento de ajuste; admin atual abre com ajuste real.
 *
 * So Postgres EFEMERO do rpc-ci.yml, via rodar-isolado.cjs.
 * Fixtures ficticias e mutante sao desfeitos com ROLLBACK em cada caso.
 *
 * MUTANTE_CAIXA_SEM_ADMIN=1 remove apenas o IF is_admin_atual() da definicao
 * VIVA, dentro da transacao. Os dois rebaixados devem ficar VERMELHOS;
 * o is_admin() legado continua bloqueando o cliente comum.
 * Nenhuma migration nem arquivo de producao e alterado.
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const ADMIN = "b1370a00-0000-4000-8000-000000000001";
const CLIENTE = "b1370a00-0000-4000-8000-000000000002";
const REBAIXADO_PERFIL = "b1370a00-0000-4000-8000-000000000003";
const REBAIXADO_AUTH = "b1370a00-0000-4000-8000-000000000004";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const MUTANTE = process.env.MUTANTE_CAIXA_SEM_ADMIN === "1";

const CASOS = [
  { nome: "admin atual abre o caixa e gera ajuste", uid: ADMIN, admin: true },
  { nome: "cliente comum nao abre nem gera ajuste", uid: CLIENTE },
  {
    nome: "rebaixado no perfil com JWT antigo nao abre nem gera ajuste",
    uid: REBAIXADO_PERFIL,
  },
  {
    nome: "rebaixado no auth com JWT antigo nao abre nem gera ajuste",
    uid: REBAIXADO_AUTH,
  },
  { nome: "anon nao abre nem gera ajuste", uid: null },
];

async function semear(c) {
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT apenas permite
  // conferir a identidade como authenticated/anon neste clone descartavel.
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
       ($1, 'admin@caixa.fixture.invalid', '{}'),
       ($2, 'cliente@caixa.fixture.invalid', '{}'),
       ($3, 'rebaixado-perfil@caixa.fixture.invalid', '{}'),
       ($4, 'rebaixado-auth@caixa.fixture.invalid', '{}')`,
    [ADMIN, CLIENTE, REBAIXADO_PERFIL, REBAIXADO_AUTH],
  );
  // INSERT sincroniza o cargo com auth.users. Nao alteramos profiles.role:
  // os gatilhos vigentes (inclusive 20261383) continuam ligados.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Ficticio', 'admin'),
       ($2, 'Cliente Ficticio', 'customer'),
       ($3, 'Rebaixado Perfil Ficticio', 'customer'),
       ($4, 'Rebaixado Auth Ficticio', 'admin')`,
    [ADMIN, CLIENTE, REBAIXADO_PERFIL, REBAIXADO_AUTH],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb
     WHERE id = $1`,
    [REBAIXADO_PERFIL],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"customer"}'::jsonb
     WHERE id = $1`,
    [REBAIXADO_AUTH],
  );
  const papeis = (
    await c.query(
      `SELECT u.id, u.raw_app_meta_data ->> 'role' AS auth, p.role AS perfil
       FROM auth.users u JOIN public.profiles p ON p.id = u.id
       WHERE u.id = ANY($1::uuid[]) ORDER BY u.id`,
      [[ADMIN, CLIENTE, REBAIXADO_PERFIL, REBAIXADO_AUTH]],
    )
  ).rows;
  assert.deepEqual(papeis, [
    { id: ADMIN, auth: "admin", perfil: "admin" },
    { id: CLIENTE, auth: "customer", perfil: "customer" },
    { id: REBAIXADO_PERFIL, auth: "admin", perfil: "customer" },
    { id: REBAIXADO_AUTH, auth: "customer", perfil: "admin" },
  ]);

  // Banco recem-migrado: saldo zero garante que abrir com 37 cria TAMBEM
  // um ajuste, nao so a sessao. Nao limpamos dados para forcar o resultado.
  assert.equal(
    Number(
      (
        await c.query(
          "SELECT saldo FROM public.fin__saldos() WHERE conta_id = $1",
          [CAIXA],
        )
      ).rows[0].saldo,
    ),
    0,
    "a fixture precisa de saldo zero no caixa da loja",
  );
}

async function fotografar(c) {
  // Le como dono do banco: a RLS esconderia linhas de cliente/rebaixado.
  return (
    await c.query(`SELECT
      (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id), '[]'::jsonb)
         FROM public.fin_caixa_sessoes s) AS sessoes,
      (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]'::jsonb)
         FROM public.fin_lancamentos l) AS lancamentos`)
  ).rows[0];
}

async function definicaoViva(c) {
  return (
    await c.query(
      "SELECT pg_get_functiondef('public.fin_caixa_abrir(numeric,uuid)'::regprocedure) AS sql",
    )
  ).rows[0].sql.replace(/\r/g, "");
}

async function removerGuardaNaTransacao(c) {
  const definicao = await definicaoViva(c);
  const guarda = `  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;`;
  assert.equal(
    definicao.split(guarda).length - 1,
    1,
    "o mutante precisa encontrar exatamente uma guarda de admin atual",
  );
  const mutante = definicao.replace(guarda, "");
  await c.query(mutante);
  assert.equal(
    await definicaoViva(c),
    mutante,
    "a definicao viva nao recebeu o mutante",
  );
}

async function chamar(c, caso) {
  const papel = caso.uid ? "authenticated" : "anon";
  const cargo = caso.uid === CLIENTE ? "customer" : "admin";
  const claims = caso.uid
    ? { sub: caso.uid, role: papel, app_metadata: { role: cargo } }
    : { role: "anon" };
  await c.query(
    `SELECT set_config('app.rpc.user_id', $1, true),
            set_config('request.jwt.claims', $2, true)`,
    [caso.uid || "", JSON.stringify(claims)],
  );
  await c.query(
    caso.uid ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon",
  );
  assert.deepEqual(
    (await c.query("SELECT current_user AS papel, auth.uid() AS uid")).rows[0],
    { papel, uid: caso.uid },
    "a chamada precisa executar com o papel e uid do caso",
  );
  // O SAVEPOINT serve so para recuperar uma excecao SQL esperada. Se a
  // chamada PASSAR indevidamente, suas gravacoes ficam visiveis na fotografia
  // ANTES de qualquer rollback: nao escondemos o dano do mutante.
  await c.query("SAVEPOINT abertura");
  let resultado;
  try {
    resultado = {
      ok: true,
      dados: (await c.query("SELECT public.fin_caixa_abrir(37) AS r")).rows[0]
        .r,
    };
  } catch (erro) {
    resultado = { ok: false, codigo: erro.code, mensagem: erro.message };
    await c.query("ROLLBACK TO SAVEPOINT abertura");
  }
  await c.query("RELEASE SAVEPOINT abertura");
  await c.query("RESET ROLE");
  return resultado;
}

async function provar(c, caso) {
  await c.query("BEGIN");
  try {
    await semear(c);
    const antes = await fotografar(c);
    assert.deepEqual(antes, { sessoes: [], lancamentos: [] });
    if (MUTANTE) await removerGuardaNaTransacao(c);

    const resultado = await chamar(c, caso);
    const depois = await fotografar(c);
    if (!caso.admin) {
      assert.deepEqual(
        depois,
        antes,
        `${caso.nome}: abertura proibida gravou sessao ou lancamento`,
      );
      assert.equal(resultado.ok, false, `${caso.nome}: abertura nao recusou`);
      assert.equal(resultado.codigo, "42501");
      if (caso.uid) {
        assert.equal(resultado.mensagem, "Acesso negado.");
      } else {
        // anon nao tem EXECUTE: a ACL recusa antes de entrar no corpo.
        assert.match(
          resultado.mensagem,
          /^permission denied for function fin_caixa_abrir$/,
        );
      }
      return;
    }

    assert.equal(
      resultado.ok,
      true,
      `admin atual recusado: ${resultado.codigo} ${resultado.mensagem}`,
    );
    assert.ok(resultado.dados.id, "admin atual precisa receber id da sessao");
    assert.equal(depois.sessoes.length, 1);
    assert.equal(depois.lancamentos.length, 1);
    const sessao = depois.sessoes[0];
    assert.equal(sessao.id, resultado.dados.id);
    assert.equal(sessao.conta_id, CAIXA);
    assert.equal(sessao.aberto_por, ADMIN);
    assert.equal(sessao.status, "aberto");
    assert.equal(Number(sessao.valor_abertura), 37);
    const ajuste = depois.lancamentos[0];
    assert.equal(ajuste.conta_id, CAIXA);
    assert.equal(ajuste.criado_por, ADMIN);
    assert.equal(ajuste.origem, "ajuste_caixa");
    assert.equal(ajuste.tipo, "entrada");
    assert.equal(ajuste.status, "realizado");
    assert.equal(Number(ajuste.valor), 37);
  } finally {
    await c.query("ROLLBACK");
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  let falhas = 0;
  try {
    const original = await definicaoViva(c);
    // Distingue o corpo sucessor 20261370 do antigo 20261199. Isto nao
    // verifica a guarda de admin: a prova abaixo observa recusa e escrita.
    assert.ok(
      original.includes(
        "Abra o caixa na conta Caixa da loja. Contas personalizadas não recebem as vendas do balcão.",
      ),
      "a prova exige a versao 20261370 instalada, sem desfazer sucessoras",
    );
    for (const caso of CASOS) {
      try {
        await provar(c, caso);
        console.log(`PASS: ${caso.nome}`);
      } catch (erro) {
        falhas += 1;
        console.error(`FAIL: ${caso.nome}\n${erro.stack || erro.message}`);
      }
      assert.equal(
        await definicaoViva(c),
        original,
        "ROLLBACK nao restaurou a definicao original da abertura",
      );
    }
  } finally {
    await c.end();
  }
  const resumo = `${CASOS.length - falhas}/${CASOS.length} provas passaram${MUTANTE ? " (MUTANTE sem admin atual)" : ""}`;
  console.log(resumo);
  anexarAoSummary("Caixa: abrir exige admin atual", resumo);
  if (falhas) falhar("REPROVADO", resumo);
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
