"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os
 * da migration, dos rollbacks e das consultas 50a/50b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261247000000_a_nota_interna_do_pedido_nao_chega_a_cliente.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rodar-isolado.cjs, clone
 * exclusivo; nunca banco real).
 *
 * O DEFEITO: a "Anotação interna" da lojista morava em marketplace_orders.notes, que o celular da
 * cliente lê. A nota agora mora em marketplace_order_internal_notes, só do admin DE AGORA.
 *
 * O QUE SE PROVA, com papéis reais (SET LOCAL ROLE) e a mesma RLS de produção:
 *   (a) admin atual (nas duas fontes) insere, lê, faz upsert, atualiza e apaga; quem escreveu e
 *       quando vêm do servidor (o que o painel enviar é ignorado);
 *   (b) a cliente DONA do pedido, outra cliente e o anon NÃO leem nem escrevem (0 linhas ou 42501);
 *       admin REBAIXADO no banco, com JWT ainda dizendo admin, também não — e o CONTROLE com a
 *       política trocada por is_admin() mostra que é a política, e não outra coisa, que barra;
 *   (c) nota vazia, só espaço/tabulação/quebra de linha e acima de 2000 caracteres são recusadas;
 *   (d) apagar o pedido apaga a nota; apagar a conta de quem escreveu NÃO é travado (sem FK);
 *   (e) catálogo: anon, PUBLIC e service_role sem privilégio; authenticated só os quatro; RLS
 *       ligada; uma política; fora da publicação do realtime;
 *   (f) aplicar 2x não muda nada nem as linhas; o pré-voo recusa tabela/função/ACL divergente sem
 *       escrever; o rollback comum fecha a porta e PRESERVA as linhas (2x igual; reaplicar reabre);
 *       o destrutivo exige a confirmação e o rollback comum antes;
 *   (g) portão 50a/50b: o catálogo real lido como authenticated, negativo por objeto;
 *   (h) MUTANTES (tirar a política; is_admin() e is_admin_atual() no lugar de rls_admin_atual();
 *       soltar o grant; sem RLS; grant a anon e a service_role; dona lê; sem CHECK; sem cascata;
 *       FK para auth.users; limite maior): cada um derruba pelo menos uma asserção.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/nota-interna-do-pedido-viva.cjs
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const NOME = "20261247000000_a_nota_interna_do_pedido_nao_chega_a_cliente.sql";
const TABELA = "public.marketplace_order_internal_notes";
const FUNCAO = "public.carimba_nota_interna_do_pedido()";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");

const ADMIN = "e2470000-0000-4000-8000-000000000001";
const ADMIN2 = "e2470000-0000-4000-8000-000000000002";
const DONA = "e2470000-0000-4000-8000-000000000003";
const OUTRA = "e2470000-0000-4000-8000-000000000004";
const REB_PERFIL = "e2470000-0000-4000-8000-000000000005";
const REB_AUTH = "e2470000-0000-4000-8000-000000000006";
const O_DONA = "e247aaaa-0000-4000-8000-000000000001";
const O_OUTRA = "e247aaaa-0000-4000-8000-000000000002";
const O_APAGAR = "e247aaaa-0000-4000-8000-000000000003";
const SEGREDO = "Cliente deve R$ 40, nao liberar fiado";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
const QUEM = {
  postgres: { papel: null },
  anon: { papel: "anon", uid: "", jwt: "{}" },
  dona: { papel: "authenticated", uid: DONA, jwt: claims(DONA, null) },
  outra: { papel: "authenticated", uid: OUTRA, jwt: claims(OUTRA, null) },
  admin: { papel: "authenticated", uid: ADMIN, jwt: claims(ADMIN, "admin") },
  // Rebaixado só no profiles (auth.users ainda admin) e rebaixado só no auth.users; o JWT velho diz admin.
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
/** Roda `passos` ([nome, sql, params]) como `quem` numa transação SEMPRE desfeita; cada passo num
 * savepoint. `preparo`: SQL do dono do banco antes de entrar. `depois`: SQL do dono depois dos passos. */
async function como(c, quem, passos, { preparo = [], depois = null } = {}) {
  await c.query("BEGIN");
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
    await c.query("ROLLBACK");
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
const erro = (code, texto) => (e) =>
  e.code === code && (!texto || e.message.includes(texto));

const INS = `INSERT INTO ${TABELA} (order_id, note) VALUES ($1, $2) RETURNING order_id::text, note, updated_by::text, updated_at = now() AS carimbado`;
const PREPARO_NOTA = [
  [`INSERT INTO ${TABELA} (order_id, note) VALUES ($1, $2)`, [O_DONA, SEGREDO]],
];
const NOTAS_COMO_DONO = `SELECT order_id::text, note FROM ${TABELA} ORDER BY order_id`;

async function semente(c) {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const [id, role, meta] of [
    [ADMIN, "admin", "admin"],
    [ADMIN2, "admin", "admin"],
    [DONA, "customer", "customer"],
    [OUTRA, "customer", "customer"],
    [REB_PERFIL, "customer", "admin"],
    [REB_AUTH, "admin", "customer"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, ($1::uuid)::text || '@nota.teste', jsonb_build_object('role', $2::text))",
      [id, meta],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova nota interna', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role",
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
       FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id::text LIKE 'e2470000-%' ORDER BY u.id`,
  );
  assert.deepEqual(
    r.rows.map((l) => [l.id, l.a, l.p]),
    [
      [ADMIN, "admin", "admin"],
      [ADMIN2, "admin", "admin"],
      [DONA, "customer", "customer"],
      [OUTRA, "customer", "customer"],
      [REB_PERFIL, "admin", "customer"],
      [REB_AUTH, "customer", "admin"],
    ],
    "fixtures de papel (admin atual, dois rebaixados em direções opostas)",
  );
  for (const [id, uid] of [
    [O_DONA, DONA],
    [O_OUTRA, OUTRA],
    [O_APAGAR, DONA],
  ])
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status)
       VALUES ($1, $2, 'Cliente nota', '{}'::jsonb, 100, 100, 'new', 'online', 'pix', 'pago')`,
      [id, uid],
    );
}

// ---------------------------------------------------------------------------
// As provas de COMPORTAMENTO. Cada uma só usa asserção (os mutantes têm de cair em ERR_ASSERTION).
// ---------------------------------------------------------------------------
async function provaAdmin(c) {
  const r = await como(c, "admin", [
    // updated_at e updated_by forjados pelo cliente: o servidor sobrescreve.
    [
      "insere",
      `INSERT INTO ${TABELA} (order_id, note, updated_at, updated_by) VALUES ($1, 'Embrulhar para presente', '2000-01-01', $2)
       RETURNING order_id::text, updated_by::text, updated_at = now() AS carimbado`,
      [O_DONA, randomUUID()],
    ],
    ["le", `SELECT note FROM ${TABELA} WHERE order_id = $1`, [O_DONA]],
    [
      "upsert",
      `INSERT INTO ${TABELA} (order_id, note) VALUES ($1, 'Segunda versao') ON CONFLICT (order_id)
       DO UPDATE SET note = EXCLUDED.note RETURNING note, updated_by::text`,
      [O_DONA],
    ],
    [
      "atualiza",
      `UPDATE ${TABELA} SET note = 'Terceira', updated_by = $2 WHERE order_id = $1 RETURNING updated_by::text`,
      [O_DONA, randomUUID()],
    ],
    ["insere sem enviar quem", INS, [O_OUTRA, "Outro pedido"]],
    ["apaga", `DELETE FROM ${TABELA} WHERE order_id = $1`, [O_DONA]],
    ["resta", `SELECT count(*)::int AS n FROM ${TABELA}`],
  ]);
  for (const k of [
    "insere",
    "le",
    "upsert",
    "atualiza",
    "insere sem enviar quem",
    "apaga",
  ])
    assert.equal(r[k].ok, true, `admin atual: ${k} falhou: ${r[k].message}`);
  assert.equal(
    r.insere.linha.updated_by,
    ADMIN,
    "quem escreveu vem do servidor",
  );
  assert.equal(
    r.insere.linha.carimbado,
    true,
    "quando escreveu vem do servidor",
  );
  assert.equal(r.le.n, 1);
  assert.equal(r.upsert.linha.note, "Segunda versao");
  assert.equal(r.upsert.linha.updated_by, ADMIN);
  assert.equal(
    r.atualiza.linha.updated_by,
    ADMIN,
    "update ignora o updated_by enviado",
  );
  assert.equal(r["insere sem enviar quem"].linha.updated_by, ADMIN);
  assert.equal(r["insere sem enviar quem"].linha.carimbado, true);
  assert.equal(r.apaga.n, 1);
  assert.equal(r.resta.linha.n, 1, "só a nota do outro pedido resta");
}

const SEM_ACESSO = [
  ["le tudo", `SELECT order_id::text FROM ${TABELA}`],
  ["le por pedido", `SELECT note FROM ${TABELA} WHERE order_id = $1`, [O_DONA]],
  ["insere no pedido dela", INS, [O_DONA, "Eu escrevo aqui"]],
  ["insere no outro", INS, [O_OUTRA, "Eu escrevo la"]],
  [
    "upsert",
    `INSERT INTO ${TABELA} (order_id, note) VALUES ($1, 'Troquei') ON CONFLICT (order_id) DO UPDATE SET note = EXCLUDED.note`,
    [O_DONA],
  ],
  [
    "atualiza",
    `UPDATE ${TABELA} SET note = 'Troquei' WHERE order_id = $1`,
    [O_DONA],
  ],
  ["apaga", `DELETE FROM ${TABELA} WHERE order_id = $1`, [O_DONA]],
];
async function provaSemAcesso(c) {
  for (const quem of ["dona", "outra", "rebaixadoPerfil", "rebaixadoAuth"]) {
    const r = await como(c, quem, SEM_ACESSO, {
      preparo: PREPARO_NOTA,
      depois: [NOTAS_COMO_DONO],
    });
    const o = `${quem}:`;
    assert.equal(
      r["le tudo"].ok,
      true,
      `${o} SELECT deveria rodar e voltar vazio`,
    );
    assert.equal(r["le tudo"].n, 0, `${o} LEU a nota interna`);
    assert.equal(r["le por pedido"].n, 0, `${o} LEU a nota do pedido dela`);
    for (const k of ["insere no pedido dela", "insere no outro", "upsert"]) {
      assert.equal(r[k].ok, false, `${o} ESCREVEU (${k})`);
      assert.equal(r[k].code, "42501", `${o} ${k}: ${r[k].message}`);
    }
    for (const k of ["atualiza", "apaga"])
      assert.equal(r[k].n, 0, `${o} ${k} afetou linha`);
    assert.deepEqual(
      r.depois,
      [{ order_id: O_DONA, note: SEGREDO }],
      `${o} a nota mudou`,
    );
  }
  const anon = await como(c, "anon", [
    ["le", `SELECT 1 FROM ${TABELA}`],
    ["insere", INS, [O_DONA, "anon escreve"]],
    ["atualiza", `UPDATE ${TABELA} SET note = 'x'`],
    ["apaga", `DELETE FROM ${TABELA}`],
  ]);
  for (const k of ["le", "insere", "atualiza", "apaga"]) {
    assert.equal(anon[k].ok, false, `anon: ${k} passou`);
    assert.equal(anon[k].code, "42501", `anon ${k}: ${anon[k].message}`);
  }
}
/** CONTROLE: com a política antiga (is_admin(), o JWT), o rebaixado com JWT de admin lê e escreve. */
async function controleDoJwt(c) {
  for (const quem of ["rebaixadoPerfil", "rebaixadoAuth"]) {
    const r = await como(
      c,
      quem,
      [
        ["le", `SELECT note FROM ${TABELA}`],
        ["insere", INS, [O_OUTRA, "rebaixado escreve"]],
      ],
      {
        preparo: [
          ...PREPARO_NOTA,
          `DROP POLICY nota_interna_so_admin_atual ON ${TABELA}`,
          `CREATE POLICY nota_interna_so_admin_atual ON ${TABELA} FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))`,
        ],
      },
    );
    assert.equal(r.le.n, 1, `controle ${quem}: com is_admin() ele deveria ler`);
    assert.equal(
      r.insere.ok,
      true,
      `controle ${quem}: com is_admin() ele deveria escrever`,
    );
  }
}
async function provaLimites(c) {
  const mil = (n, ch = "a") => ch.repeat(n);
  const passos = [
    ["vazia", INS, [O_DONA, ""]],
    ["espacos", INS, [O_DONA, "     "]],
    ["tab e quebra", INS, [O_DONA, "\t \r\n \n"]],
    ["nula", INS, [O_DONA, null]],
    ["2000", INS, [O_DONA, mil(2000)]],
    ["2000 multibyte", INS, [O_OUTRA, mil(2000, "€")]],
    ["2001", INS, [O_APAGAR, mil(2001)]],
    ["pedido que nao existe", INS, [randomUUID(), "x"]],
    ["com acento e espaco nas pontas", INS, [O_APAGAR, "  ação — ok  "]],
    ["duplicada", INS, [O_APAGAR, "de novo"]],
  ];
  const r = await como(c, "admin", passos);
  const cod = (k) => (r[k].ok ? "ok" : r[k].code);
  assert.equal(cod("vazia"), "23514", "nota vazia aceita");
  assert.equal(cod("espacos"), "23514", "nota de espacos aceita");
  assert.equal(cod("tab e quebra"), "23514", "nota de tab e quebra aceita");
  assert.equal(cod("nula"), "23502", "nota nula aceita");
  assert.equal(cod("2000"), "ok", "limite: 2000 caracteres foi recusado");
  assert.equal(cod("2000 multibyte"), "ok", "limite: 2000 multibyte recusado");
  assert.equal(cod("2001"), "23514", "limite: 2001 caracteres foi aceito");
  assert.equal(
    cod("pedido que nao existe"),
    "23503",
    "nota de pedido inexistente aceita",
  );
  assert.equal(
    cod("com acento e espaco nas pontas"),
    "ok",
    "nota normal recusada",
  );
  assert.equal(cod("duplicada"), "23505", "duas notas para o mesmo pedido");
}
async function provaCascataESemFk(c) {
  const r = await como(
    c,
    "postgres",
    [
      [
        "apaga pedido",
        "DELETE FROM public.marketplace_orders WHERE id = $1",
        [O_APAGAR],
      ],
    ],
    {
      preparo: [
        [
          `INSERT INTO ${TABELA} (order_id, note) VALUES ($1, 'vai junto')`,
          [O_APAGAR],
        ],
      ],
      depois: [
        `SELECT count(*)::int AS n FROM ${TABELA} WHERE order_id = $1`,
        [O_APAGAR],
      ],
    },
  );
  assert.equal(
    r["apaga pedido"].ok,
    true,
    `apagar pedido falhou: ${r["apaga pedido"].message}`,
  );
  assert.deepEqual(
    r.depois,
    [{ n: 0 }],
    "a nota ficou depois de apagar o pedido",
  );
  // Conta de quem escreveu apagada: NÃO é travada (sem FK) e a nota fica.
  const e = await como(
    c,
    "postgres",
    [
      ["apaga perfil", "DELETE FROM public.profiles WHERE id = $1", [ADMIN2]],
      ["apaga login", "DELETE FROM auth.users WHERE id = $1", [ADMIN2]],
    ],
    {
      preparo: [
        ["SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN2]],
        [
          `INSERT INTO ${TABELA} (order_id, note) VALUES ($1, 'escrita pela ADMIN2')`,
          [O_OUTRA],
        ],
      ],
      depois: [
        `SELECT updated_by::text FROM ${TABELA} WHERE order_id = $1`,
        [O_OUTRA],
      ],
    },
  );
  assert.equal(
    e["apaga login"].ok,
    true,
    `apagar a conta foi travado: ${e["apaga login"].message}`,
  );
  assert.deepEqual(e.depois, [{ updated_by: ADMIN2 }]);
}
async function catalogo(c) {
  const priv = async (papel) =>
    (
      await c.query(
        `SELECT p AS privilegio, has_table_privilege($1, '${TABELA}', p) AS sim
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`,
        [papel],
      )
    ).rows
      .filter((x) => x.sim)
      .map((x) => x.privilegio);
  assert.deepEqual(await priv("anon"), [], "anon tem privilégio");
  assert.deepEqual(
    await priv("service_role"),
    [],
    "service_role tem privilégio",
  );
  assert.deepEqual(
    (await priv("authenticated")).sort(),
    ["DELETE", "INSERT", "SELECT", "UPDATE"],
    "authenticated com privilégio a mais ou a menos",
  );
  const g = (
    await c.query(
      `SELECT (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid = '${TABELA}'::regclass AND a.grantee = 0)::int AS publico,
              relrowsecurity AS rls, relforcerowsecurity AS forca,
              (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid)::int AS politicas,
              (SELECT count(*) FROM pg_publication_tables WHERE tablename = 'marketplace_order_internal_notes')::int AS realtime,
              (SELECT count(*) FROM pg_attribute WHERE attrelid = c.oid AND attacl IS NOT NULL)::int AS colunas,
              (SELECT count(*) FROM pg_constraint WHERE conrelid = c.oid AND contype = 'f')::int AS fks
         FROM pg_class c WHERE c.oid = '${TABELA}'::regclass`,
    )
  ).rows[0];
  assert.deepEqual(g, {
    publico: 0,
    rls: true,
    forca: false,
    politicas: 1,
    realtime: 0,
    colunas: 0,
    fks: 1,
  });
}
async function comportamento(c) {
  await provaAdmin(c);
  await provaSemAcesso(c);
  await provaLimites(c);
  await provaCascataESemFk(c);
  await catalogo(c);
}

// ---------------------------------------------------------------------------
// Aplicação, pré-voo, rollbacks.
// ---------------------------------------------------------------------------
async function foto(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  return {
    tabela:
      await q(`SELECT a.attname, format_type(a.atttypid, a.atttypmod) t, a.attnotnull, a.attacl::text,
                            pg_get_expr(d.adbin, d.adrelid) def
                       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                      WHERE a.attrelid = to_regclass('${TABELA}') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`),
    classe: await q(
      `SELECT relrowsecurity, relforcerowsecurity, relacl::text, relowner::regrole::text FROM pg_class WHERE oid = to_regclass('${TABELA}')`,
    ),
    restricoes: await q(
      `SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = to_regclass('${TABELA}') ORDER BY conname`,
    ),
    politicas: await q(
      `SELECT polname, polcmd, polroles::text, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w FROM pg_policy WHERE polrelid = to_regclass('${TABELA}') ORDER BY polname`,
    ),
    gatilhos: await q(
      `SELECT tgname, tgtype, tgenabled FROM pg_trigger WHERE tgrelid = to_regclass('${TABELA}') AND NOT tgisinternal`,
    ),
    funcao: await q(
      `SELECT md5(prosrc) h, proacl::text, proconfig::text, prosecdef, proowner::regrole::text FROM pg_proc WHERE oid = to_regprocedure('${FUNCAO.replace("public.", "public.")}')`,
    ),
    linhas: (await to_regclass(c))
      ? await q(`SELECT * FROM ${TABELA} ORDER BY order_id`)
      : null,
  };
}
const to_regclass = async (c) =>
  (await c.query(`SELECT to_regclass('${TABELA}') AS t`)).rows[0].t;

async function aplicacao(c) {
  // Uma linha viva (commit) para provar que NADA do que roda abaixo a toca.
  await c.query(
    `INSERT INTO ${TABELA} (order_id, note) VALUES ($1, $2) ON CONFLICT (order_id) DO UPDATE SET note = EXCLUDED.note`,
    [O_DONA, SEGREDO],
  );
  const f0 = await foto(c);
  assert.equal(f0.linhas.length, 1);
  await transacao(c, () => c.query(MIGRATION));
  await transacao(c, () => c.query(MIGRATION));
  assert.deepEqual(
    await foto(c),
    f0,
    "aplicar 2x mudou tabela, política, ACL, gatilho, função ou linhas",
  );

  // Rollback comum: fecha a porta, preserva tabela e linhas; 2x igual.
  await transacao(c, () => c.query(ROLLBACK));
  const fechada = await foto(c);
  await transacao(c, () => c.query(ROLLBACK));
  assert.deepEqual(await foto(c), fechada, "rollback 2x mudou algo");
  assert.deepEqual(
    fechada.linhas,
    f0.linhas,
    "rollback apagou ou mexeu nas linhas",
  );
  assert.equal(fechada.politicas.length, 0);
  assert.equal(
    fechada.classe[0].relrowsecurity,
    true,
    "rollback desligou a RLS",
  );
  assert.deepEqual(
    fechada.tabela,
    f0.tabela.map((x) => ({ ...x })),
    "rollback mudou colunas",
  );
  const adm = await como(c, "admin", [["le", `SELECT 1 FROM ${TABELA}`]]);
  assert.equal(adm.le.ok, false, "porta fechada: nem o admin lê");
  assert.equal(adm.le.code, "42501");
  // Reaplicar reabre e as notas voltam, byte a byte.
  await transacao(c, () => c.query(MIGRATION));
  assert.deepEqual(
    await foto(c),
    f0,
    "reaplicar depois do rollback não restaurou o estado",
  );
  const volta = await como(c, "admin", [["le", `SELECT note FROM ${TABELA}`]]);
  assert.equal(volta.le.linha.note, SEGREDO);
}

const DIVERGENCIAS = [
  ["coluna extra", `ALTER TABLE ${TABELA} ADD COLUMN estranha text`],
  [
    "coluna updated_by com FK para auth.users",
    `ALTER TABLE ${TABELA} ADD CONSTRAINT fk_estranha FOREIGN KEY (updated_by) REFERENCES auth.users(id)`,
  ],
  [
    "restrição CHECK trocada",
    `ALTER TABLE ${TABELA} DROP CONSTRAINT marketplace_order_internal_notes_note_check; ALTER TABLE ${TABELA} ADD CONSTRAINT marketplace_order_internal_notes_note_check CHECK (length(note) <= 5000)`,
  ],
  [
    "política extra aberta",
    `CREATE POLICY aberta ON ${TABELA} FOR SELECT TO authenticated USING (true)`,
  ],
  [
    "política com a porta do JWT",
    `DROP POLICY nota_interna_so_admin_atual ON ${TABELA}; CREATE POLICY nota_interna_so_admin_atual ON ${TABELA} FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))`,
  ],
  ["grant a anon", `GRANT SELECT ON ${TABELA} TO anon`],
  ["grant a service_role", `GRANT SELECT ON ${TABELA} TO service_role`],
  ["grant a PUBLIC", `GRANT SELECT ON ${TABELA} TO PUBLIC`],
  ["grant de coluna", `GRANT SELECT (note) ON ${TABELA} TO anon`],
  ["RLS desligada", `ALTER TABLE ${TABELA} DISABLE ROW LEVEL SECURITY`],
  ["RLS forçada", `ALTER TABLE ${TABELA} FORCE ROW LEVEL SECURITY`],
  [
    "gatilho desligado",
    `ALTER TABLE ${TABELA} DISABLE TRIGGER nota_interna_carimba_quem_e_quando`,
  ],
  [
    "gatilho ausente",
    `DROP TRIGGER nota_interna_carimba_quem_e_quando ON ${TABELA}`,
  ],
  [
    "função do carimbo com outro corpo",
    `CREATE OR REPLACE FUNCTION ${FUNCAO} RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$ BEGIN RETURN NEW; END; $$`,
  ],
  [
    "função do carimbo executável pelo anon",
    `GRANT EXECUTE ON FUNCTION ${FUNCAO} TO anon`,
  ],
  [
    "na publicação do realtime",
    `ALTER PUBLICATION supabase_realtime ADD TABLE ${TABELA}`,
  ],
  [
    "rls_admin_atual sem EXECUTE para authenticated",
    "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
  ],
  [
    "tabela trocada por uma mínima",
    `DROP TABLE ${TABELA}; CREATE TABLE ${TABELA} (order_id uuid PRIMARY KEY, note text)`,
  ],
];
async function preVoo(c) {
  const f0 = await foto(c);
  for (const [nome, sql] of DIVERGENCIAS) {
    await c.query("BEGIN");
    try {
      await c.query(sql);
      const estranho = await foto(c);
      await c.query("SAVEPOINT pv");
      await assert.rejects(
        c.query(MIGRATION),
        erro("P0001", "B1_BASELINE_DIVERGENT"),
        `pré-voo da migration aceitou: ${nome}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT pv");
      assert.deepEqual(
        await foto(c),
        estranho,
        `pré-voo escreveu antes de recusar: ${nome}`,
      );
      // O rollback comum também recusa estado que não reconhece (não "conserta" nem fecha às cegas).
      await c.query("SAVEPOINT pv2");
      await assert.rejects(
        c.query(ROLLBACK),
        erro("P0001", "B1_BASELINE_DIVERGENT"),
        `rollback comum aceitou: ${nome}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT pv2");
      assert.deepEqual(
        await foto(c),
        estranho,
        `rollback escreveu antes de recusar: ${nome}`,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  }
  assert.deepEqual(await foto(c), f0);
  // Ausência de marketplace_orders: recusa antes de criar qualquer coisa.
  await c.query("BEGIN");
  try {
    await c.query(
      "ALTER TABLE public.marketplace_orders RENAME TO marketplace_orders_x",
    );
    await c.query(`DROP TABLE ${TABELA}`);
    await c.query("SAVEPOINT pv");
    await assert.rejects(
      c.query(MIGRATION),
      erro("P0001", "B1_BASELINE_DIVERGENT"),
    );
    await c.query("ROLLBACK TO SAVEPOINT pv");
    assert.equal(
      await to_regclass(c),
      null,
      "criou a tabela sem marketplace_orders",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}
async function destrutivo(c) {
  await assert.rejects(
    transacao(c, () => c.query(DESTRUTIVO)),
    erro("P0001", "SO_COM_O_DONO"),
  );
  await assert.rejects(
    transacao(c, async () => {
      await c.query("SET LOCAL app.confirmo_apagar_notas_internas = 'APAGAR'");
      await c.query(DESTRUTIVO);
    }),
    erro("P0001", "ROLLBACK_COMUM_PRIMEIRO"),
    "o destrutivo apagou com a porta ainda aberta",
  );
  assert.equal(
    (await c.query(`SELECT count(*)::int n FROM ${TABELA}`)).rows[0].n,
    1,
    "a recusa do destrutivo apagou linha",
  );
  await c.query("BEGIN");
  try {
    await c.query(ROLLBACK);
    await c.query("SET LOCAL app.confirmo_apagar_notas_internas = 'APAGAR'");
    await c.query(DESTRUTIVO);
    assert.equal(await to_regclass(c), null);
    assert.equal(
      (await c.query(`SELECT to_regprocedure('${FUNCAO}') AS f`)).rows[0].f,
      null,
    );
    await c.query(DESTRUTIVO); // idempotente
    await c.query(MIGRATION); // aplica também com tudo ausente
    assert.deepEqual(
      (await c.query(`SELECT * FROM ${TABELA}`)).rows,
      [],
      "volta sem dado",
    );
    await c.query(MIGRATION);
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// Portão 50a/50b: o catálogo real, lido como authenticated.
// ---------------------------------------------------------------------------
async function portao(c) {
  const A = "50a-conferir-nota-interna-do-pedido-aplicado";
  const B = "50b-antes-nota-interna-do-pedido-base-vigente";
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
  const rol = CONF.ROL_DA_50A;
  await c.query("BEGIN");
  try {
    assert(
      positivas(await consulta(A)),
      "50a deveria aprovar o estado da migration",
    );
    assert(
      !positivas(await consulta(B)),
      "50b deveria reprovar a tabela aberta",
    );
    const mutacoes = [
      ["coluna extra", `ALTER TABLE ${TABELA} ADD COLUMN estranha text`, [1]],
      [
        "política extra aberta",
        `CREATE POLICY aberta ON ${TABELA} FOR SELECT TO authenticated USING (true)`,
        [2],
      ],
      [
        "política com is_admin()",
        `DROP POLICY nota_interna_so_admin_atual ON ${TABELA}; CREATE POLICY nota_interna_so_admin_atual ON ${TABELA} FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))`,
        [2],
      ],
      [
        "sem política",
        `DROP POLICY nota_interna_so_admin_atual ON ${TABELA}`,
        [2],
      ],
      ["grant a anon", `GRANT SELECT ON ${TABELA} TO anon`, [3]],
      [
        "service_role com acesso",
        `GRANT SELECT ON ${TABELA} TO service_role`,
        [3],
      ],
      [
        "authenticated sem DELETE",
        `REVOKE DELETE ON ${TABELA} FROM authenticated`,
        [3],
      ],
      [
        "RLS desligada",
        `ALTER TABLE ${TABELA} DISABLE ROW LEVEL SECURITY`,
        [2, 4],
      ],
      [
        "no realtime",
        `ALTER PUBLICATION supabase_realtime ADD TABLE ${TABELA}`,
        [4],
      ],
      [
        "gatilho desligado",
        `ALTER TABLE ${TABELA} DISABLE TRIGGER nota_interna_carimba_quem_e_quando`,
        [1],
      ],
      [
        "função do carimbo trocada",
        `CREATE OR REPLACE FUNCTION ${FUNCAO} RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$ BEGIN RETURN NEW; END; $$`,
        [5],
      ],
      [
        "rls_admin_atual sem EXECUTE",
        "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
        [5],
      ],
    ];
    for (const [item, sql, esperados] of mutacoes) {
      await c.query("SAVEPOINT mutacao_portao");
      await c.query(sql);
      const ruins = reprovados(await consulta(A));
      assert.deepEqual(
        ruins.sort(),
        esperados.map((i) => rol[i]).sort(),
        `50a deveria reprovar exatamente os itens de: ${item}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT mutacao_portao");
    }
    // Rollback comum: a 50b passa (preservada fechada) e a 50a reprova.
    await c.query(ROLLBACK);
    assert(
      positivas(await consulta(B)),
      "50b aceita a tabela preservada fechada",
    );
    assert(!positivas(await consulta(A)));
    // Destrutivo: a 50b aceita a ausência.
    await c.query("SET LOCAL app.confirmo_apagar_notas_internas = 'APAGAR'");
    await c.query(DESTRUTIVO);
    assert(positivas(await consulta(B)), "50b aceita a tabela ausente");
    assert(!positivas(await consulta(A)));
    // Aplicar de novo: a 50a volta a aprovar.
    await c.query(MIGRATION);
    assert(positivas(await consulta(A)));
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql.replace(
    /DO \$conferencia_20261247\$[\s\S]*?END \$conferencia_20261247\$;\n?/,
    "",
  );
/** O trecho tem de aparecer UMA vez: senão o mutante pode cair num comentário ou no pré-voo e não mudar nada. */
const trocar = (sql, de, para) => {
  assert.equal(
    sql.split(de).length,
    2,
    `mutante: o trecho tem de aparecer UMA vez: ${de.slice(0, 60)}`,
  );
  return sql.replace(de, () => para);
};
const GRANT_AUTH = `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${TABELA} TO authenticated;\n`;
const POLITICA =
  /CREATE POLICY nota_interna_so_admin_atual ON[\s\S]*?\(SELECT public\.rls_admin_atual\(\)\)\);\n/;
const PORTA = /\(SELECT public\.rls_admin_atual\(\)\)/g;
const CHECK_LINHA =
  /,\n {2}CONSTRAINT marketplace_order_internal_notes_note_check CHECK \([^\n]*\)\n/;
// [nome, função que muta a migration, trecho da mensagem da asserção que PRECISA derrubá-lo]
const MUTANTES = [
  [
    "sem a política",
    (s) => trocar(s, POLITICA.exec(s)[0], ""),
    "admin atual: insere falhou",
  ],
  [
    "política com is_admin() (a porta do JWT)",
    (s) => s.replace(PORTA, "(SELECT public.is_admin())"),
    "LEU a nota interna",
  ],
  [
    "política com is_admin_atual() direto (privada: o admin tomaria permission denied)",
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
    (s) => trocar(s, `ALTER TABLE ${TABELA} ENABLE ROW LEVEL SECURITY;\n`, ""),
    "LEU a nota interna",
  ],
  [
    "grant extra ao anon",
    (s) =>
      trocar(
        s,
        GRANT_AUTH,
        `${GRANT_AUTH}GRANT SELECT ON TABLE ${TABELA} TO anon;\n`,
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
    "service_role tem privilégio",
  ],
  [
    "a dona do pedido também lê",
    (s) =>
      s.replace(
        /USING \(\(SELECT public\.rls_admin_atual\(\)\)\)/,
        "USING ((SELECT public.rls_admin_atual()) OR EXISTS (SELECT 1 FROM public.marketplace_orders o WHERE o.id = order_id AND o.user_id = (SELECT auth.uid())))",
      ),
    "dona: LEU a nota interna",
  ],
  [
    "sem a restrição de nota em branco e de tamanho",
    (s) => {
      assert(CHECK_LINHA.test(s));
      return s.replace(CHECK_LINHA, "\n");
    },
    "aceita",
  ],
  [
    "limite de 5000 no lugar de 2000",
    (s) =>
      trocar(
        s,
        "CHECK (note ~ '[^[:space:]]' AND length(note) <= 2000)",
        "CHECK (note ~ '[^[:space:]]' AND length(note) <= 5000)",
      ),
    "limite: 2001 caracteres foi aceito",
  ],
  [
    "sem apagar a nota com o pedido",
    (s) =>
      trocar(
        s,
        "REFERENCES public.marketplace_orders(id) ON DELETE CASCADE",
        "REFERENCES public.marketplace_orders(id)",
      ),
    "apagar pedido falhou",
  ],
  [
    "updated_by com chave estrangeira para auth.users",
    (s) =>
      trocar(
        s,
        "updated_by uuid DEFAULT auth.uid(),",
        "updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),",
      ),
    "apagar a conta foi travado",
  ],
  [
    "sem o gatilho que carimba quem e quando",
    (s) => s.replace(/CREATE TRIGGER[\s\S]*?\(\);\n/, ""),
    "quem escreveu vem do servidor",
  ],
];
async function restaurar(c) {
  await c.query(`DROP TABLE IF EXISTS ${TABELA}`);
  await transacao(c, () => c.query(MIGRATION));
}
async function mutantes(c) {
  await c.query(`DELETE FROM ${TABELA}`); // a linha viva das provas de aplicação sai: o controle parte do vazio
  await comportamento(c); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento] of MUTANTES) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    await c.query(`DROP TABLE IF EXISTS ${TABELA}`);
    let motivo;
    try {
      await transacao(c, () => c.query(alterada));
      await comportamento(c);
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
  await comportamento(c); // depois de tudo restaurado: verde de novo
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
      await to_regclass(c),
      null,
      "o clone deve estar com a migration nova",
    );
    await semente(c);
    await provar(
      "admin atual: insere, lê, upsert, atualiza, apaga; quem e quando vêm do servidor",
      () => provaAdmin(c),
    );
    await provar(
      "dona, outra cliente, anon e admin rebaixado (duas direções, JWT de admin) não leem nem escrevem",
      () => provaSemAcesso(c),
    );
    await provar(
      "controle: com a política do JWT (is_admin()) o rebaixado entra — é a política que barra",
      () => controleDoJwt(c),
    );
    await provar(
      "nota vazia, só espaço/tab/quebra, nula, 2001, pedido inexistente e duplicada recusadas; 2000 passa",
      () => provaLimites(c),
    );
    await provar(
      "apagar o pedido apaga a nota; apagar a conta de quem escreveu não é travado",
      () => provaCascataESemFk(c),
    );
    await provar(
      "catálogo: anon, PUBLIC e service_role sem nada; authenticated só os quatro; RLS; uma política; fora do realtime",
      () => catalogo(c),
    );
    await provar(
      "aplicar 2x não muda nada; rollback comum fecha e preserva; reaplicar reabre",
      () => aplicacao(c),
    );
    await provar(
      "pré-voo e rollback recusam estado divergente sem escrever",
      () => preVoo(c),
    );
    await provar(
      "destrutivo: exige confirmação e a porta fechada; idempotente",
      () => destrutivo(c),
    );
    await provar(
      "portão 50a/50b: catálogo real, negativos por objeto, rollback e ausência",
      () => portao(c),
    );
    await provar("mutantes", async () => {
      mortos = await mutantes(c);
    });
    console.log(
      `\nnota-interna-do-pedido-viva: ${provas} provas ok; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Anotação interna do pedido (PG17)",
      `${provas} provas com papéis reais, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("NOTA_INTERNA_DO_PEDIDO", e.stack || e.message));
