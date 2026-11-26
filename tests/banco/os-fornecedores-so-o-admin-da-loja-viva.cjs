"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os
 * da migration, dos rollbacks e das consultas 181a/181b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261450000000_a_loja_guarda_os_fornecedores.sql contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: a lojista não tinha onde guardar quem vende para ela. O contato de fornecedor é dado
 * comercial PRIVADO da loja: tabela nova, só do admin DE AGORA, acesso direto pelo PostgREST com RLS.
 *
 * O QUE SE PROVA, com papéis reais (SET LOCAL ROLE) e a mesma RLS de produção:
 *   (a) admin atual (nas duas fontes) insere, lê, faz upsert por id (repetir o Salvar não duplica),
 *       atualiza, favorita e apaga; as datas e o id vêm do servidor (o que o app enviar é ignorado);
 *   (b) cliente logado, anon, service_role e admin REBAIXADO (nas duas direções, com JWT ainda dizendo
 *       admin) NÃO leem nem escrevem nada, e o CONTROLE com is_admin() mostra que é a política que barra;
 *   (c) os CHECKs (nome, WhatsApp, Instagram, site, cidade, UF, observações): cada limite, dos dois lados;
 *   (d) criado_em é preservado e atualizado_em renova entre transações DIFERENTES;
 *   (e) corrida real: duas conexões gravando o MESMO id ao mesmo tempo terminam com UMA linha;
 *   (f) catálogo: anon, PUBLIC e service_role sem privilégio; authenticated só os quatro; RLS; quatro
 *       políticas; gatilho; função sem EXECUTE; fora do realtime;
 *   (g) aplicar 2x não muda nada nem as linhas; o pré-voo recusa 9 estados divergentes sem escrever; o
 *       rollback comum fecha e PRESERVA as linhas (2x igual; reaplicar reabre); o destrutivo exige a
 *       confirmação e o rollback comum antes;
 *   (h) consultas 181a/181b EXECUTADAS no catálogo real, com defeitos plantados;
 *   (i) MUTANTES da migration: cada um derruba pelo menos uma asserção, pelo motivo certo.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/os-fornecedores-so-o-admin-da-loja-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const { tirarOLivroDoClone } = require("./o-livro-de-registro-posterior.cjs");

const NOME = "20261450000000_a_loja_guarda_os_fornecedores.sql";
const T = "public.fornecedores";
const FN = "public.fornecedores_carimba_atualizado_em()";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const MD5_FUNCAO = "e05593617f77fa8e7caf14479400b6b1";

const ADMIN = "f1450000-0000-4000-8000-000000000001";
const CLIENTE = "f1450000-0000-4000-8000-000000000002";
const REB_PERFIL = "f1450000-0000-4000-8000-000000000003";
const REB_AUTH = "f1450000-0000-4000-8000-000000000004";
const F1 = "f145aaaa-0000-4000-8000-000000000001";
const F2 = "f145aaaa-0000-4000-8000-000000000002";
const F3 = "f145aaaa-0000-4000-8000-000000000003";
const SEGREDO = "Atacado Fixture Reservado";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = {
  postgres: { papel: null },
  anon: { papel: "anon", uid: "", jwt: "{}" },
  service: { papel: "service_role", uid: "", jwt: "{}" },
  cliente: {
    papel: "authenticated",
    uid: CLIENTE,
    jwt: claims(CLIENTE, null),
  },
  admin: { papel: "authenticated", uid: ADMIN, jwt: claims(ADMIN, "admin") },
  // Rebaixado só no profiles (auth.users ainda admin) e só no auth.users; o JWT velho diz admin.
  rebaixadoPerfil: {
    papel: "authenticated",
    uid: REB_PERFIL,
    jwt: claims(REB_PERFIL, "admin"),
  },
  rebaixadoAuth: {
    papel: "authenticated",
    uid: REB_AUTH,
    jwt: claims(REB_AUTH, "admin"),
  },
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  if (q.papel) await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid ?? "", q.jwt ?? "{}"],
  );
}
/** Roda `passos` ([nome, sql, params]) como `quem` numa transação SEMPRE desfeita; cada passo num savepoint. */
async function como(
  c,
  quem,
  passos,
  { preparo = [], depois = null, dentro = false } = {},
) {
  // `dentro`: já existe uma transação do chamador; usa SAVEPOINT em vez de BEGIN/ROLLBACK
  // (um ROLLBACK aqui desfaria a transação inteira do chamador).
  await c.query(dentro ? "SAVEPOINT como_dentro" : "BEGIN");
  try {
    for (const s of preparo) await c.query(...(Array.isArray(s) ? s : [s]));
    await entrar(c, quem);
    const out = {};
    for (const [nome, sql, params] of passos) {
      await c.query("SAVEPOINT passo");
      try {
        const r = await c.query(sql, params || []);
        out[nome] = {
          ok: true,
          n: r.rowCount,
          linha: r.rows[0],
          linhas: r.rows,
        };
        await c.query("RELEASE SAVEPOINT passo");
      } catch (e) {
        out[nome] = { ok: false, code: e.code, message: e.message };
        await c.query("ROLLBACK TO SAVEPOINT passo");
      }
    }
    if (depois) {
      await c.query("RESET ROLE");
      out.depois = (await c.query(depois[0], depois[1] || [])).rows;
    }
    return out;
  } finally {
    await c.query(dentro ? "ROLLBACK TO SAVEPOINT como_dentro" : "ROLLBACK");
    if (dentro) await c.query("RELEASE SAVEPOINT como_dentro");
  }
}
async function transacao(c, fn) {
  await c.query("BEGIN");
  try {
    const r = await fn();
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

const PREPARO_LINHA = [
  [`INSERT INTO ${T} (id, nome) VALUES ($1, $2)`, [F1, SEGREDO]],
];
const LINHAS_COMO_DONO = `SELECT id::text, nome FROM ${T} ORDER BY id`;

async function semente(c) {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const [id, role, meta] of [
    [ADMIN, "admin", "admin"],
    [CLIENTE, "customer", "customer"],
    [REB_PERFIL, "customer", "admin"],
    [REB_AUTH, "admin", "customer"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, ($1::uuid)::text || '@fornecedores.teste', jsonb_build_object('role', $2::text))",
      [id, meta],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova fornecedores', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role",
      [id, role],
    );
  }
  // O gatilho sincroniza profiles -> auth.users: recria a divergência nas DUAS direções depois dos perfis.
  for (const [id, meta] of [
    [REB_PERFIL, "admin"],
    [REB_AUTH, "customer"],
  ])
    await c.query(
      "UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('role', $2::text) WHERE id = $1",
      [id, meta],
    );
  const r = await c.query(
    `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS a, p.role AS p
       FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id::text LIKE 'f1450000-%' ORDER BY u.id`,
  );
  assert.deepEqual(
    r.rows.map((l) => [l.id, l.a, l.p]),
    [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", "customer"],
      [REB_PERFIL, "admin", "customer"],
      [REB_AUTH, "customer", "admin"],
    ],
    "fixtures de papel (admin atual, dois rebaixados em direções opostas)",
  );
}

// ---------------------------------------------------------------------------
// (a) o admin atual
// ---------------------------------------------------------------------------
async function provaAdmin(c) {
  const r = await como(c, "admin", [
    [
      // datas forjadas pelo app: o servidor sobrescreve
      "insere",
      `INSERT INTO ${T} (id, nome, whatsapp, favorito, criado_em, atualizado_em)
       VALUES ($1, 'Atacado Fixture', '5511900000000', true, '2000-01-01', '2000-01-01')
       RETURNING id::text, favorito, criado_em = now() AS criado_agora, atualizado_em = now() AS atualizado_agora`,
      [F1],
    ],
    ["le", `SELECT nome, whatsapp FROM ${T} WHERE id = $1`, [F1]],
    [
      // repetir o Salvar (resposta perdida / toque duplo): upsert pelo MESMO id
      "upsert 1",
      `INSERT INTO ${T} (id, nome) VALUES ($1, 'Atacado Fixture v2') ON CONFLICT (id)
       DO UPDATE SET nome = EXCLUDED.nome RETURNING nome`,
      [F1],
    ],
    [
      "upsert 2",
      `INSERT INTO ${T} (id, nome) VALUES ($1, 'Atacado Fixture v3') ON CONFLICT (id)
       DO UPDATE SET nome = EXCLUDED.nome RETURNING nome`,
      [F1],
    ],
    ["conta o id", `SELECT count(*)::int AS n FROM ${T} WHERE id = $1`, [F1]],
    [
      // id e criado_em forjados num UPDATE: ficam como estavam
      "atualiza forjando",
      `UPDATE ${T} SET id = $2, criado_em = '2001-01-01', favorito = false WHERE id = $1
       RETURNING id::text, favorito, criado_em = now() AS criado_agora`,
      [F1, F2],
    ],
    [
      "outro",
      `INSERT INTO ${T} (id, nome) VALUES ($1, 'Outro') RETURNING id::text`,
      [F3],
    ],
    ["apaga", `DELETE FROM ${T} WHERE id = $1`, [F3]],
    ["resta", `SELECT count(*)::int AS n FROM ${T}`],
  ]);
  for (const k of [
    "insere",
    "le",
    "upsert 1",
    "upsert 2",
    "atualiza forjando",
    "outro",
    "apaga",
  ])
    assert.equal(r[k].ok, true, `admin atual: ${k} falhou: ${r[k].message}`);
  assert.equal(r.insere.linha.id, F1);
  assert.equal(
    r.insere.linha.criado_agora,
    true,
    "as datas vêm do servidor, não do app (criado_em)",
  );
  assert.equal(
    r.insere.linha.atualizado_agora,
    true,
    "as datas vêm do servidor, não do app (atualizado_em)",
  );
  assert.equal(r.le.linha.whatsapp, "5511900000000");
  assert.equal(
    r["conta o id"].linha.n,
    1,
    "repetir o Salvar com o mesmo id duplicou a linha",
  );
  assert.equal(r["upsert 2"].linha.nome, "Atacado Fixture v3");
  assert.equal(
    r["atualiza forjando"].linha.id,
    F1,
    "o id não pode mudar num UPDATE",
  );
  assert.equal(r["atualiza forjando"].linha.criado_agora, true);
  assert.equal(r["atualiza forjando"].linha.favorito, false);
  assert.equal(r.apaga.n, 1);
  assert.equal(r.resta.linha.n, 1, "só o primeiro fornecedor resta");
}

// ---------------------------------------------------------------------------
// (d) o carimbo entre transações DIFERENTES (dentro de uma só, now() não anda)
// ---------------------------------------------------------------------------
async function provaCarimbo(c) {
  await c.query(`DELETE FROM ${T} WHERE id = $1`, [F3]);
  await transacao(c, () =>
    c.query(`INSERT INTO ${T} (id, nome) VALUES ($1, 'Carimbo')`, [F3]),
  );
  const antes = (
    await c.query(
      `SELECT criado_em::text AS criado, atualizado_em::text AS atualizado FROM ${T} WHERE id = $1`,
      [F3],
    )
  ).rows[0];
  await dorme(40);
  await transacao(c, async () => {
    await entrar(c, "admin");
    await c.query(`UPDATE ${T} SET favorito = true WHERE id = $1`, [F3]);
  });
  const depois = (
    await c.query(
      `SELECT criado_em::text AS criado, atualizado_em::text AS atualizado, atualizado_em > criado_em AS renovou FROM ${T} WHERE id = $1`,
      [F3],
    )
  ).rows[0];
  assert.equal(
    depois.criado,
    antes.criado,
    "criado_em tem de ser preservado no UPDATE",
  );
  assert.notEqual(
    depois.atualizado,
    antes.atualizado,
    "atualizado_em tem de renovar no UPDATE (as datas vêm do servidor)",
  );
  assert.equal(depois.renovou, true);
  await c.query(`DELETE FROM ${T} WHERE id = $1`, [F3]);
}

// ---------------------------------------------------------------------------
// (b) quem NÃO acessa
// ---------------------------------------------------------------------------
const INS = `INSERT INTO ${T} (id, nome) VALUES ($1, $2) RETURNING id::text`;
const SEM_ACESSO = [
  ["le tudo", `SELECT id::text FROM ${T}`],
  ["le por id", `SELECT nome FROM ${T} WHERE id = $1`, [F1]],
  ["insere", INS, [F2, "Eu escrevo aqui"]],
  [
    // sem RETURNING: o RETURNING exige a política de SELECT e esconderia um INSERT aberto demais
    "insere sem retorno",
    `INSERT INTO ${T} (id, nome) VALUES ($1, $2)`,
    [F2, "Eu escrevo aqui sem retorno"],
  ],
  [
    "upsert",
    `INSERT INTO ${T} (id, nome) VALUES ($1, 'Troquei') ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
    [F1],
  ],
  ["atualiza", `UPDATE ${T} SET nome = 'Troquei' WHERE id = $1`, [F1]],
  ["favorita", `UPDATE ${T} SET favorito = true WHERE id = $1`, [F1]],
  ["apaga", `DELETE FROM ${T} WHERE id = $1`, [F1]],
];
async function provaSemAcesso(c) {
  for (const quem of ["cliente", "rebaixadoPerfil", "rebaixadoAuth"]) {
    const r = await como(c, quem, SEM_ACESSO, {
      preparo: PREPARO_LINHA,
      depois: [LINHAS_COMO_DONO],
    });
    const o = `${quem}:`;
    assert.equal(
      r["le tudo"].ok,
      true,
      `${o} SELECT deveria rodar e voltar vazio`,
    );
    assert.equal(r["le tudo"].n, 0, `${o} LEU os fornecedores`);
    assert.equal(r["le por id"].n, 0, `${o} LEU o fornecedor pelo id`);
    for (const k of ["insere", "insere sem retorno", "upsert"]) {
      assert.equal(r[k].ok, false, `${o} ESCREVEU (${k})`);
      assert.equal(r[k].code, "42501", `${o} ${k}: ${r[k].message}`);
    }
    for (const k of ["atualiza", "favorita", "apaga"])
      assert.equal(r[k].n, 0, `${o} ${k} afetou linha`);
    assert.deepEqual(
      r.depois,
      [{ id: F1, nome: SEGREDO }],
      `${o} o fornecedor mudou`,
    );
  }
  for (const quem of ["anon", "service"]) {
    const r = await como(
      c,
      quem,
      SEM_ACESSO.slice(0, 1).concat(SEM_ACESSO.slice(2, 3)),
      {},
    );
    const leitura = r["le tudo"];
    const escrita = r.insere;
    assert.equal(leitura.ok, false, `${quem}: le passou`);
    assert.equal(leitura.code, "42501", `${quem} le: ${leitura.message}`);
    assert.equal(escrita.ok, false, `${quem} tem privilégio de escrita`);
    assert.equal(escrita.code, "42501", `${quem} insere: ${escrita.message}`);
    for (const [k, sql] of [
      ["atualiza", `UPDATE ${T} SET nome = 'x'`],
      ["apaga", `DELETE FROM ${T}`],
    ]) {
      const rr = await como(c, quem, [[k, sql]]);
      assert.equal(rr[k].ok, false, `${quem}: ${k} passou`);
      assert.equal(rr[k].code, "42501", `${quem} ${k}: ${rr[k].message}`);
    }
  }
}
/** CONTROLE: com a política do JWT (is_admin()) o rebaixado entra: é a política, e não outra coisa, que barra. */
async function controleDoJwt(c) {
  await c.query("BEGIN");
  try {
    for (const [acao, ext] of [
      ["select", "USING"],
      ["delete", "USING"],
    ])
      await c.query(
        `DROP POLICY fornecedores_admin_${acao}_policy ON ${T}; CREATE POLICY fornecedores_admin_${acao}_policy ON ${T} FOR ${acao.toUpperCase()} TO authenticated ${ext} ((SELECT public.is_admin()))`,
      );
    await c.query(`INSERT INTO ${T} (id, nome) VALUES ($1, $2)`, [F1, SEGREDO]);
    await entrar(c, "rebaixadoPerfil");
    const r = await c.query(`SELECT id FROM ${T}`);
    assert.equal(
      r.rowCount,
      1,
      "controle: com is_admin() (JWT) o admin rebaixado no banco ainda leria",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// (c) os CHECKs, dos dois lados do limite
// ---------------------------------------------------------------------------
const A = (n) => "a".repeat(n);
const BASE = `INSERT INTO ${T} (nome, whatsapp, instagram, site, cidade, uf, observacoes) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
const col = (o = {}) => [
  o.nome ?? "Fornecedor",
  o.whatsapp ?? null,
  o.instagram ?? null,
  o.site ?? null,
  o.cidade ?? null,
  o.uf ?? null,
  o.observacoes ?? null,
];
const RECUSADOS = [
  ["nome vazio", { nome: "" }],
  ["nome só espaços", { nome: "     " }],
  ["nome com 81", { nome: A(81) }],
  ["nome com 81 emojis (conta caractere, não byte)", { nome: "😀".repeat(81) }],
  ["whatsapp com 9 dígitos", { whatsapp: "119000000" }],
  ["whatsapp com 14 dígitos", { whatsapp: "55119000000000" }],
  ["whatsapp com letra", { whatsapp: "11abc000000" }],
  ["whatsapp com quebra de linha no fim", { whatsapp: "11900000000\n" }],
  ["whatsapp com espaço", { whatsapp: " 11900000000" }],
  ["whatsapp vazio ('' não é nulo)", { whatsapp: "" }],
  ["instagram com espaço", { instagram: "loja fixture" }],
  ["instagram com 31", { instagram: A(31) }],
  ["instagram com barra", { instagram: "loja/fixture" }],
  ["instagram vazio", { instagram: "" }],
  ["site em http", { site: "http://x.fixture.invalid" }],
  ["site javascript:", { site: "javascript:alert(1)" }],
  ["site com espaço", { site: "https://a b.fixture.invalid" }],
  ["site com 201", { site: `https://${A(193)}` }],
  ["site vazio", { site: "" }],
  ["cidade só espaços", { cidade: "   " }],
  ["cidade com 81", { cidade: A(81) }],
  ["uf inexistente", { uf: "XX" }],
  ["uf minúscula", { uf: "sp" }],
  ["uf vazia", { uf: "" }],
  ["observações com 501", { observacoes: A(501) }],
];
const ACEITOS = [
  ["nome com 80", { nome: A(80) }],
  ["nome com 80 emojis", { nome: "😀".repeat(80) }],
  ["whatsapp com 10", { whatsapp: "1190000000" }],
  ["whatsapp com 13", { whatsapp: "5511900000000" }],
  ["instagram com 30", { instagram: A(30) }],
  ["instagram com ponto e sublinhado", { instagram: "A_b.c9" }],
  ["site com 200", { site: `https://${A(192)}` }],
  ["cidade com 80", { cidade: A(80) }],
  ["uf AC", { uf: "AC" }],
  ["uf TO", { uf: "TO" }],
  ["observações com 500 e quebra de linha", { observacoes: `${A(499)}\n` }],
  ["tudo nulo menos o nome", {}],
];
async function provaLimites(c) {
  const rec = await como(
    c,
    "postgres",
    RECUSADOS.map(([nome, o]) => [nome, BASE, col(o)]),
  );
  for (const [nome] of RECUSADOS) {
    assert.equal(rec[nome].ok, false, `limite: "${nome}" foi aceito`);
    assert.equal(
      rec[nome].code,
      "23514",
      `limite "${nome}": ${rec[nome].message}`,
    );
  }
  const nulo = await como(c, "postgres", [
    [
      "nome nulo",
      `INSERT INTO ${T} (id, nome) VALUES (gen_random_uuid(), NULL)`,
    ],
  ]);
  assert.equal(
    nulo["nome nulo"].code,
    "23502",
    "nome nulo tem de ser recusado",
  );
  const ok = await como(
    c,
    "postgres",
    ACEITOS.map(([nome, o]) => [nome, BASE, col(o)]),
  );
  for (const [nome] of ACEITOS)
    assert.equal(
      ok[nome].ok,
      true,
      `limite: "${nome}" foi recusado: ${ok[nome].message}`,
    );
}

// ---------------------------------------------------------------------------
// (e) corrida real: duas conexões, o MESMO id
// ---------------------------------------------------------------------------
async function provaCorrida(c, url) {
  const abre = async () => {
    const x = new Client({ connectionString: url });
    await x.connect();
    return x;
  };
  const [x1, x2] = [await abre(), await abre()];
  try {
    const grava = async (x, nome) => {
      await x.query("BEGIN");
      try {
        await entrar(x, "admin");
        await x.query(
          `INSERT INTO ${T} (id, nome) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
          [F2, nome],
        );
        await dorme(60);
        await x.query("COMMIT");
      } catch (e) {
        await x.query("ROLLBACK");
        throw e;
      }
    };
    await Promise.all([grava(x1, "Corrida A"), grava(x2, "Corrida B")]);
    const r = await c.query(
      `SELECT count(*)::int AS n, min(nome) AS nome FROM ${T} WHERE id = $1`,
      [F2],
    );
    assert.equal(
      r.rows[0].n,
      1,
      "duas gravações simultâneas do mesmo id duplicaram a linha",
    );
    assert.match(r.rows[0].nome, /^Corrida [AB]$/);
  } finally {
    await x1.end();
    await x2.end();
    await c.query(`DELETE FROM ${T} WHERE id = $1`, [F2]);
  }
}

// ---------------------------------------------------------------------------
// (f) o catálogo
// ---------------------------------------------------------------------------
async function catalogo(c) {
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const cls = (
    await q(
      `SELECT relkind, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = to_regclass('${T}')`,
    )
  )[0];
  assert.deepEqual(
    [cls.relkind, cls.relrowsecurity, cls.relforcerowsecurity],
    ["r", true, false],
    "RLS ligada, sem FORCE, tabela comum",
  );
  const pol = await q(
    `SELECT polname, polcmd::text AS cmd, polpermissive, pg_get_expr(polqual, polrelid) AS qual,
            pg_get_expr(polwithcheck, polrelid) AS chk,
            array_to_string(ARRAY(SELECT x::regrole::text FROM unnest(polroles) x), ',') AS papeis
       FROM pg_policy WHERE polrelid = to_regclass('${T}') ORDER BY polname`,
  );
  assert.deepEqual(
    pol.map((p) => [p.polname, p.cmd]),
    [
      ["fornecedores_admin_delete_policy", "d"],
      ["fornecedores_admin_insert_policy", "a"],
      ["fornecedores_admin_select_policy", "r"],
      ["fornecedores_admin_update_policy", "w"],
    ],
    "quatro políticas, uma por ação",
  );
  for (const p of pol) {
    assert.equal(p.papeis, "authenticated", `${p.polname}: só authenticated`);
    assert.equal(p.polpermissive, true);
    const expr = `${p.qual ?? ""} ${p.chk ?? ""}`;
    assert.match(
      expr,
      /rls_admin_atual/,
      `${p.polname}: tem de usar rls_admin_atual()`,
    );
    assert.doesNotMatch(
      expr,
      /is_admin\(\)|true/,
      `${p.polname}: não pode usar is_admin() nem true`,
    );
  }
  const priv = (papel, p) =>
    q(`SELECT has_table_privilege($1, to_regclass('${T}'), $2) AS v`, [
      papel,
      p,
    ]).then((r) => r[0].v);
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"])
    assert.equal(
      await priv("authenticated", p),
      true,
      `authenticated sem ${p}`,
    );
  for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"])
    assert.equal(
      await priv("authenticated", p),
      false,
      `authenticated com ${p}`,
    );
  for (const papel of ["anon", "service_role"])
    for (const p of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ])
      assert.equal(await priv(papel, p), false, `${papel} tem privilégio ${p}`);
  const publico = await q(
    `SELECT count(*)::int AS n FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = to_regclass('${T}') AND a.grantee = 0`,
  );
  assert.equal(publico[0].n, 0, "PUBLIC tem privilégio");
  const publicacao = await q(
    "SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fornecedores'",
  );
  assert.equal(publicacao.length, 0, "a tabela não pode estar no realtime");
  const fn = (
    await q(
      `SELECT p.prosecdef, p.proconfig, md5(replace(p.prosrc, chr(13), '')) AS h, pg_get_function_result(p.oid) AS r,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS au,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS s
       FROM pg_proc p WHERE p.oid = to_regprocedure('${FN}')`,
    )
  )[0];
  assert.equal(
    fn.prosecdef,
    false,
    "a função do gatilho NÃO é SECURITY DEFINER",
  );
  assert.deepEqual(fn.proconfig, ["search_path=public"]);
  assert.equal(fn.h, MD5_FUNCAO, "corpo da função diferente do esperado");
  assert.equal(fn.r, "trigger");
  assert.deepEqual(
    [fn.a, fn.au, fn.s],
    [false, false, false],
    "a função tem EXECUTE para papel de aplicação",
  );
  const trg = await q(
    `SELECT t.tgname, t.tgtype, t.tgenabled FROM pg_trigger t WHERE t.tgrelid = to_regclass('${T}') AND NOT t.tgisinternal`,
  );
  assert.deepEqual(
    trg.map((t) => [t.tgname, t.tgtype, t.tgenabled]),
    [["fornecedores_carimba_atualizado_em", 23, "O"]],
    "um gatilho BEFORE INSERT OR UPDATE por linha",
  );
}

/** A prova de COMPORTAMENTO inteira (a mesma que os mutantes têm de derrubar). */
async function comportamento(c, url) {
  await provaAdmin(c);
  await provaSemAcesso(c);
  await provaLimites(c);
  await provaCarimbo(c);
  await provaCorrida(c, url);
  await catalogo(c);
}

// ---------------------------------------------------------------------------
// (g) aplicação, pré-voo, rollbacks
// ---------------------------------------------------------------------------
async function foto(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  return {
    colunas: await q(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) t, a.attnotnull, a.attacl::text, pg_get_expr(d.adbin, d.adrelid) def
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass('${T}') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
    ),
    classe: await q(
      `SELECT relrowsecurity, relforcerowsecurity, relacl::text, relowner::regrole::text FROM pg_class WHERE oid = to_regclass('${T}')`,
    ),
    restricoes: await q(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass('${T}') ORDER BY conname`,
    ),
    politicas: await q(
      `SELECT polname, polcmd::text, polroles::text, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w
         FROM pg_policy WHERE polrelid = to_regclass('${T}') ORDER BY polname`,
    ),
    gatilhos: await q(
      `SELECT tgname, tgtype, tgenabled FROM pg_trigger WHERE tgrelid = to_regclass('${T}') AND NOT tgisinternal ORDER BY tgname`,
    ),
    funcao: await q(
      `SELECT prosrc, proacl::text, prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
    ),
    linhas: await q(`SELECT * FROM ${T} ORDER BY id`),
  };
}
async function aplicacao(c) {
  await c.query("BEGIN");
  try {
    await c.query(
      `INSERT INTO ${T} (id, nome, favorito) VALUES ($1, $2, true)`,
      [F1, SEGREDO],
    );
    const antes = await foto(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antes,
      "aplicar 2x mudou o estado ou as linhas",
    );

    // rollback COMUM: fecha a porta e PRESERVA a tabela e as linhas.
    await c.query(ROLLBACK);
    const selado = await foto(c);
    await c.query(ROLLBACK);
    assert.deepEqual(await foto(c), selado, "rollback comum 2x mudou algo");
    assert.equal(
      selado.politicas.length,
      0,
      "o rollback comum deixou política",
    );
    assert.equal(selado.gatilhos.length, 0, "o rollback comum deixou gatilho");
    assert.equal(selado.funcao.length, 0, "o rollback comum deixou a função");
    assert.equal(
      selado.classe[0].relrowsecurity,
      true,
      "a tabela selada precisa seguir com RLS",
    );
    assert.equal(
      selado.classe[0].relacl,
      `{${selado.classe[0].relowner}=arwdDxtm/${selado.classe[0].relowner}}`.replace(
        "arwdDxtm",
        "arwdDxtm",
      ),
      "só o dono com acesso à tabela selada",
    );
    assert.deepEqual(
      selado.linhas,
      antes.linhas,
      "o rollback comum apagou ou mudou as linhas",
    );
    const fechado = await como(c, "admin", [["le", `SELECT id FROM ${T}`]], {
      dentro: true,
    });
    assert.equal(fechado.le.ok, false, "tabela selada ainda lida pelo admin");
    assert.equal(fechado.le.code, "42501");

    // reaplicar reabre, com as mesmas linhas.
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antes,
      "reaplicar depois do rollback comum não voltou ao estado de antes",
    );
    const aberto = await como(
      c,
      "admin",
      [["le", `SELECT nome FROM ${T} WHERE id = $1`, [F1]]],
      { dentro: true },
    );
    assert.equal(
      aberto.le.linha?.nome,
      SEGREDO,
      "o admin não voltou a ler a linha que sobreviveu",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}

async function preVoo(c) {
  const casos = [
    ["coluna extra", `ALTER TABLE ${T} ADD COLUMN estranha text`],
    [
      "política extra aberta",
      `CREATE POLICY aberta ON ${T} FOR SELECT TO authenticated USING (true)`,
    ],
    ["grant ao anon", `GRANT SELECT ON ${T} TO anon`],
    ["RLS desligada", `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`],
    ["RLS forçada", `ALTER TABLE ${T} FORCE ROW LEVEL SECURITY`],
    [
      "CHECK a menos",
      `ALTER TABLE ${T} DROP CONSTRAINT fornecedores_site_check`,
    ],
    [
      "chave estrangeira que a migration não cria",
      `ALTER TABLE ${T} ADD CONSTRAINT fornecedores_fk FOREIGN KEY (id) REFERENCES public.profiles(id)`,
    ],
    [
      "gatilho desconhecido",
      `CREATE TRIGGER intruso BEFORE INSERT ON ${T} FOR EACH ROW EXECUTE FUNCTION ${FN}`,
    ],
    [
      "corpo da função diferente (sucessora no ar?)",
      `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$`,
    ],
    [
      "na publicação do realtime",
      `ALTER PUBLICATION supabase_realtime ADD TABLE ${T}`,
    ],
    [
      "EXECUTE do rls_admin_atual() tirado do authenticated",
      "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
    ],
    [
      "EXECUTE do rls_admin_atual() dado ao anon",
      "GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO anon",
    ],
  ];
  for (const [nome, sabotagem] of casos) {
    await c.query("BEGIN");
    try {
      await c.query(sabotagem);
      const antes = await foto(c);
      await c.query("SAVEPOINT tentativa");
      await assert.rejects(
        c.query(MIGRATION),
        /B1_BASELINE_DIVERGENT/,
        `pré-voo deveria recusar: ${nome}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT tentativa");
      assert.deepEqual(
        await foto(c),
        antes,
        `o pré-voo escreveu algo antes de recusar: ${nome}`,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  }
  // O rollback comum também recusa a função desconhecida, sem apagar nada.
  await c.query("BEGIN");
  try {
    await c.query(
      `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$`,
    );
    const antes = await foto(c);
    await c.query("SAVEPOINT tentativa");
    await assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    assert.deepEqual(
      await foto(c),
      antes,
      "o rollback escreveu algo antes de recusar",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}

async function destrutivo(c) {
  await c.query("BEGIN");
  try {
    await c.query(`INSERT INTO ${T} (id, nome) VALUES ($1, $2)`, [F1, SEGREDO]);
    // sem a confirmação
    await c.query("SAVEPOINT a");
    await assert.rejects(c.query(DESTRUTIVO), /FORNECEDORES_SO_COM_O_DONO/);
    await c.query("ROLLBACK TO SAVEPOINT a");
    // com a confirmação, mas sem o rollback comum antes
    await c.query("SET LOCAL app.confirmo_apagar_fornecedores = 'APAGAR'");
    await c.query("SAVEPOINT b");
    await assert.rejects(
      c.query(DESTRUTIVO),
      /FORNECEDORES_ROLLBACK_COMUM_PRIMEIRO/,
    );
    await c.query("ROLLBACK TO SAVEPOINT b");
    assert.equal(
      (await c.query(`SELECT count(*)::int n FROM ${T}`)).rows[0].n,
      1,
      "recusou mas apagou",
    );
    // na ordem certa
    await c.query(ROLLBACK);
    await c.query(DESTRUTIVO);
    assert.equal(
      (await c.query("SELECT to_regclass('public.fornecedores') AS t")).rows[0]
        .t,
      null,
      "o destrutivo não apagou a tabela",
    );
    await c.query(DESTRUTIVO); // idempotente
    // e a migration recria a tabela VAZIA
    await c.query(MIGRATION);
    assert.equal(
      (await c.query(`SELECT count(*)::int n FROM ${T}`)).rows[0].n,
      0,
      "a tabela recriada devia nascer vazia",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// (h) as consultas 181a/181b, EXECUTADAS no catálogo real
// ---------------------------------------------------------------------------
async function portao(c) {
  const A_ = "181a-conferir-os-fornecedores-aplicado";
  const B_ = "181b-antes-os-fornecedores-ausentes";
  const consulta = async (nome) => {
    const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
    assert.equal(CONF.contarStatements(sql), 1);
    await c.query("SAVEPOINT leitura_catalogo");
    try {
      await c.query("SET LOCAL ROLE authenticated");
      const rows = (await c.query(sql)).rows;
      assert.equal(
        CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
        null,
      );
      return rows;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
    }
  };
  const positivas = (rows) => rows.every((r) => r.ok === true);
  const reprovados = (rows) =>
    rows.filter((r) => r.ok !== true).map((r) => r.item);
  const rol = CONF.ROL_FECHADO_POR_CONSULTA[A_];
  await c.query("BEGIN");
  try {
    assert(
      positivas(await consulta(A_)),
      "181a deveria aprovar o estado da migration",
    );
    const b = await consulta(B_);
    assert.deepEqual(
      reprovados(b).sort(),
      [
        rol && "fornecedores: a tabela ainda NAO existe",
        "fornecedores_carimba_atualizado_em: ainda NAO existe",
      ].sort(),
      "181b deveria reprovar só a presença dos objetos novos",
    );
    // defeitos plantados: cada um reprova exatamente o item certo da 181a
    const mutacoes = [
      ["coluna extra", `ALTER TABLE ${T} ADD COLUMN estranha text`, [4]],
      [
        "política extra aberta",
        `CREATE POLICY aberta ON ${T} FOR SELECT TO authenticated USING (true)`,
        [6],
      ],
      [
        "política de select com is_admin()",
        `DROP POLICY fornecedores_admin_select_policy ON ${T}; CREATE POLICY fornecedores_admin_select_policy ON ${T} FOR SELECT TO authenticated USING ((SELECT public.is_admin()))`,
        [6],
      ],
      [
        "sem a política de delete",
        `DROP POLICY fornecedores_admin_delete_policy ON ${T}`,
        [6],
      ],
      ["grant ao anon", `GRANT SELECT ON ${T} TO anon`, [7]],
      ["grant de coluna ao anon", `GRANT SELECT (nome) ON ${T} TO anon`, [7]],
      ["service_role com acesso", `GRANT SELECT ON ${T} TO service_role`, [7]],
      [
        "authenticated sem DELETE",
        `REVOKE DELETE ON ${T} FROM authenticated`,
        [7],
      ],
      ["RLS desligada", `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`, [3]],
      ["RLS forçada", `ALTER TABLE ${T} FORCE ROW LEVEL SECURITY`, [3]],
      [
        "CHECK a menos",
        `ALTER TABLE ${T} DROP CONSTRAINT fornecedores_uf_check`,
        [5],
      ],
      [
        "sem o gatilho",
        `DROP TRIGGER fornecedores_carimba_atualizado_em ON ${T}`,
        [8],
      ],
      [
        "gatilho só no INSERT",
        `DROP TRIGGER fornecedores_carimba_atualizado_em ON ${T}; CREATE TRIGGER fornecedores_carimba_atualizado_em BEFORE INSERT ON ${T} FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        [8],
      ],
      [
        "corpo da função diferente",
        `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$`,
        [1],
      ],
      [
        "função com EXECUTE para authenticated",
        `GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`,
        [2],
      ],
      [
        "na publicação do realtime",
        `ALTER PUBLICATION supabase_realtime ADD TABLE ${T}`,
        [3],
      ],
    ];
    for (const [nome, sql, posicoes] of mutacoes) {
      await c.query("SAVEPOINT planta");
      await c.query(sql);
      const rows = await consulta(A_);
      const esperados = posicoes.map((p) => rol[p]).sort();
      assert.deepEqual(
        reprovados(rows).sort(),
        esperados,
        `defeito "${nome}" reprovou o item errado na 181a`,
      );
      await c.query("ROLLBACK TO SAVEPOINT planta");
    }
    // depois do rollback comum, a 181a reprova e a 181b só reprova a tabela (selada, com linhas, de propósito)
    await c.query(ROLLBACK);
    assert(
      !positivas(await consulta(A_)),
      "181a deveria reprovar a porta fechada",
    );
    assert.deepEqual(reprovados(await consulta(B_)), [
      "fornecedores: a tabela ainda NAO existe",
    ]);
    // depois do destrutivo, a 181b é POSITIVA e a 181a reprova
    await c.query("SET LOCAL app.confirmo_apagar_fornecedores = 'APAGAR'");
    await c.query(DESTRUTIVO);
    assert(
      positivas(await consulta(B_)),
      "181b deveria aprovar a base de antes",
    );
    assert(!positivas(await consulta(A_)));
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// (i) MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261450000000\$[\s\S]*?END \$preflight_20261450000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posflight_20261450000000\$[\s\S]*?END \$posflight_20261450000000\$;\n?/,
      "",
    );
const trocar = (sql, de, para) => {
  assert.equal(
    sql.split(de).length,
    2,
    `mutante: o trecho tem de aparecer UMA vez: ${de.slice(0, 60)}`,
  );
  return sql.replace(de, () => para);
};
const PORTA = /\(SELECT public\.rls_admin_atual\(\)\)/g;
const POLITICA = (acao) =>
  new RegExp(
    `CREATE POLICY fornecedores_admin_${acao}_policy ON[\\s\\S]*?\\(SELECT public\\.rls_admin_atual\\(\\)\\)\\);\\n`,
  );
const GRANT_AUTH = `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${T} TO authenticated;\n`;
const MUTANTES = [
  [
    "sem a política de select",
    (s) => trocar(s, POLITICA("select").exec(s)[0], ""),
    "admin atual:",
  ],
  [
    "políticas com is_admin() (a porta do JWT)",
    (s) => s.replace(PORTA, "(SELECT public.is_admin())"),
    "LEU os fornecedores",
  ],
  [
    "políticas com is_admin_atual() direto (privada: o admin tomaria permission denied)",
    (s) => s.replace(PORTA, "(SELECT public.is_admin_atual())"),
    "permission denied for function is_admin_atual",
  ],
  [
    "sem o GRANT ao authenticated",
    (s) => trocar(s, GRANT_AUTH, ""),
    "permission denied for table",
  ],
  [
    "sem ligar a RLS",
    (s) => trocar(s, `ALTER TABLE ${T} ENABLE ROW LEVEL SECURITY;\n`, ""),
    "LEU os fornecedores",
  ],
  [
    "grant extra ao anon",
    (s) =>
      trocar(
        s,
        GRANT_AUTH,
        `${GRANT_AUTH}GRANT SELECT ON TABLE ${T} TO anon;\n`,
      ),
    "anon: le passou",
  ],
  [
    "service_role fica com o acesso de fábrica",
    (s) =>
      trocar(
        s,
        "FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT",
        "FROM PUBLIC, anon, authenticated;\nGRANT SELECT",
      ),
    "service: le passou",
  ],
  [
    "o cliente logado também lê (select com OR true)",
    (s) =>
      trocar(
        s,
        POLITICA("select").exec(s)[0],
        `CREATE POLICY fornecedores_admin_select_policy ON ${T}\n  FOR SELECT TO authenticated\n  USING (true);\n`,
      ),
    "LEU os fornecedores",
  ],
  [
    "o cliente logado também insere (insert com true)",
    (s) =>
      trocar(
        s,
        POLITICA("insert").exec(s)[0],
        `CREATE POLICY fornecedores_admin_insert_policy ON ${T}\n  FOR INSERT TO authenticated\n  WITH CHECK (true);\n`,
      ),
    "ESCREVEU",
  ],
  [
    "sem o CHECK do nome",
    (s) =>
      trocar(
        s,
        "  CONSTRAINT fornecedores_nome_check CHECK (char_length(btrim(nome)) BETWEEN 1 AND 80),\n",
        "",
      ),
    'limite: "nome vazio" foi aceito',
  ],
  [
    "WhatsApp aceita até 14 dígitos",
    (s) => trocar(s, "'^[0-9]{10,13}$'", "'^[0-9]{10,14}$'"),
    'limite: "whatsapp com 14 dígitos" foi aceito',
  ],
  [
    "site aceita http",
    (s) => trocar(s, "'^https://[^[:space:]]+$'", "'^https?://[^[:space:]]+$'"),
    'limite: "site em http" foi aceito',
  ],
  [
    "Instagram aceita espaço",
    (s) => trocar(s, "'^[A-Za-z0-9._]{1,30}$'", "'^[A-Za-z0-9._ ]{1,30}$'"),
    'limite: "instagram com espaço" foi aceito',
  ],
  [
    "observações até 5000",
    (s) =>
      trocar(
        s,
        "char_length(observacoes) <= 500",
        "char_length(observacoes) <= 5000",
      ),
    'limite: "observações com 501" foi aceito',
  ],
  [
    "sem o gatilho do carimbo",
    (s) => s.replace(/CREATE TRIGGER[\s\S]*?\(\);\n/, ""),
    "as datas vêm do servidor",
  ],
];
async function restaurar(c) {
  await c.query(`DROP TABLE IF EXISTS ${T}`);
  await transacao(c, () => c.query(MIGRATION));
}
async function mutantes(c, url) {
  await c.query(`DELETE FROM ${T}`); // as linhas das provas de aplicação saem: o controle parte do vazio
  await comportamento(c, url); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento] of MUTANTES) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    await c.query(`DROP TABLE IF EXISTS ${T}`);
    let motivo;
    try {
      await transacao(c, () => c.query(alterada));
      await comportamento(c, url);
    } catch (e) {
      motivo = e;
    } finally {
      await restaurar(c);
    }
    assert(motivo, `MUTANTE SOBREVIVEU: ${nome}`);
    assert.equal(
      motivo.code,
      "ERR_ASSERTION",
      `mutante "${nome}" morreu por erro inesperado (e não por asserção): ${motivo.message}`,
    );
    assert(
      motivo.message.includes(fragmento),
      `mutante "${nome}" morreu pelo motivo errado: ${motivo.message.split("\n")[0]}`,
    );
    mortos++;
    console.log(
      `    mutante morto: ${nome}: ${motivo.message.split("\n")[0].slice(0, 150)}`,
    );
  }
  await comportamento(c, url); // depois de tudo restaurado: verde de novo
  return mortos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  let mortos = 0;
  const provar = async (nome, fn) => {
    await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
  };
  try {
    assert.notEqual(
      (await c.query("SELECT to_regclass('public.fornecedores') AS t")).rows[0]
        .t,
      null,
      "o clone deve estar com a migration nova",
    );
    // A 20261510 (livro de registro) poe gatilhos tr_livro_* em public.fornecedores; o pre-voo e o pos-voo desta migration exigem
    // so o gatilho dela. No clone exclusivo, o livro sai ANTES (rollback comum, gravado); ver o-livro-de-registro-posterior.cjs.
    await tirarOLivroDoClone(c);
    await semente(c);
    await provar(
      "admin atual: insere, lê, upsert por id (não duplica), atualiza, favorita, apaga; datas e id vêm do servidor",
      () => provaAdmin(c),
    );
    await provar(
      "cliente logado, anon, service_role e admin rebaixado (duas direções, JWT de admin) não leem nem escrevem",
      () => provaSemAcesso(c),
    );
    await provar(
      "controle: com a política do JWT (is_admin()) o rebaixado entra: é a política que barra",
      () => controleDoJwt(c),
    );
    await provar(
      "CHECKs: nome, WhatsApp, Instagram, site, cidade, UF e observações, dos dois lados do limite",
      () => provaLimites(c),
    );
    await provar(
      "criado_em preservado e atualizado_em renovado entre transações diferentes",
      () => provaCarimbo(c),
    );
    await provar(
      "corrida real: duas conexões no mesmo id terminam com uma linha",
      () => provaCorrida(c, url),
    );
    await provar(
      "catálogo: anon, PUBLIC e service_role sem nada; authenticated só os quatro; RLS; quatro políticas; gatilho; função sem EXECUTE; fora do realtime",
      () => catalogo(c),
    );
    await provar(
      "aplicar 2x não muda nada; rollback comum fecha e preserva as linhas (2x igual); reaplicar reabre",
      () => aplicacao(c),
    );
    await provar(
      "pré-voo e rollback recusam estado divergente sem escrever (12 sabotagens)",
      () => preVoo(c),
    );
    await provar(
      "destrutivo: exige confirmação e o rollback comum antes; idempotente; a migration recria vazia",
      () => destrutivo(c),
    );
    await provar(
      "consultas 181a/181b: catálogo real, 16 defeitos plantados, rollback comum e destrutivo",
      () => portao(c),
    );
    await provar("mutantes da migration", async () => {
      mortos = await mutantes(c, url);
    });
    console.log(
      `\nos-fornecedores-so-o-admin-da-loja-viva: ${provas} provas ok; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Fornecedores da loja (PG17)",
      `${provas} provas com papéis reais, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("FORNECEDORES_SO_O_ADMIN", e.stack || e.message));
