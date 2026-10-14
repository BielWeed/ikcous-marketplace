"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM) ou do
 * catálogo do Postgres efêmero; os caminhos de arquivo são montados de
 * literais do próprio teste. Nunca entrada de rede nem de terceiro. */

/**
 * PROVA VIVA da migration
 * 20261234000000_a_cliente_pede_exclusao_da_conta_e_correcao_do_email.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O QUE SE PROVA (a tabela public.pedidos_de_privacidade — dado de cliente):
 *   (a) a cliente lê SÓ os pedidos dela e insere o dela; leitura cruzada
 *       (A vê o de B) não acontece;
 *   (b) A não insere em nome de B, nem decide sozinha (situação, carimbos,
 *       observação), nem muda o e-mail depois de pedido;
 *   (c) no máximo UM pedido ABERTO por (cliente, tipo): o segundo vira 23505;
 *       tipos diferentes convivem; depois de decidido, abre outro;
 *   (d) a cliente não atualiza a situação (0 linhas) — nem a do próprio pedido;
 *   (e) anon não lê nem insere;
 *   (f) o admin de AGORA lê tudo e atende (carimbo vindo do servidor, decisão
 *       final); o admin rebaixado com JWT velho NÃO lê nem decide;
 *   (g) NINGUÉM apaga: DELETE e TRUNCATE recusados para anon, cliente, admin e
 *       service_role (sem grant, sem política de DELETE);
 *   (h) as regras de forma (e-mail do tipo certo, formato, tipo) e a chave
 *       estrangeira SEM cascata (o login do pedido não se apaga);
 *   (i) estrutura: RLS ligada, 3 políticas, índice único parcial, ACL;
 *   (j) o rollback RECUSA apagar com pedido registrado, desfaz sem pedido, e a
 *       migration reaplicada por cima de objeto já existente recusa.
 *
 * Toda prova roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/pedidos-de-privacidade-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const NOME_MIGRATION =
  "20261234000000_a_cliente_pede_exclusao_da_conta_e_correcao_do_email.sql";
const DIR = path.join(__dirname, "..", "..", "supabase", "migrations");
const ler = (nome) => fs.readFileSync(path.join(DIR, nome), "utf8");

const U_ADMIN = "9a1c0000-0000-4000-8000-000000000001";
const U_A = "9a1c0000-0000-4000-8000-000000000002";
const U_B = "9a1c0000-0000-4000-8000-000000000003";
const U_REBAIXADO = "9a1c0000-0000-4000-8000-000000000004";
const T = "public.pedidos_de_privacidade";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  a: { papel: "authenticated", uid: U_A, jwt: claims(U_A, null) },
  b: { papel: "authenticated", uid: U_B, jwt: claims(U_B, null) },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  // Rebaixado no profiles; o JWT velho ainda diz admin.
  rebaixado: {
    papel: "authenticated",
    uid: U_REBAIXADO,
    jwt: claims(U_REBAIXADO, "admin"),
  },
  servico: { papel: "service_role", uid: "", jwt: "" },
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}

// Roda `passos` ([nome, sql, params]) como `quem` numa transação SEMPRE
// desfeita; cada passo num savepoint (a recusa de um não derruba os outros).
// `preparo`: SQL rodado como dono do banco antes de entrar.
async function como(c, quem, passos, { preparo = [] } = {}) {
  await c.query("BEGIN");
  try {
    for (const s of preparo) await c.query(s);
    await entrar(c, quem);
    const out = {};
    for (const [nome, sql, params] of passos) {
      await c.query("SAVEPOINT passo");
      try {
        const r = await c.query(sql, params || []);
        out[nome] = { ok: true, n: r.rowCount, linhas: r.rows };
        await c.query("RELEASE SAVEPOINT passo");
      } catch (e) {
        out[nome] = { ok: false, code: e.code, message: e.message };
        await c.query("ROLLBACK TO SAVEPOINT passo");
      }
    }
    return out;
  } finally {
    await c.query("ROLLBACK");
  }
}

const INSERIR = (tipo, email = null) => [
  `INSERT INTO ${T} (user_id, tipo, email_novo) VALUES (current_setting('app.rpc.user_id')::uuid, $1, $2) RETURNING id, situacao`,
  [tipo, email],
];

// Dois pedidos de partida (um de A, um de B), inseridos como dono do banco.
const SEMENTE = [
  `INSERT INTO ${T} (id, user_id, tipo) VALUES ('9a1caaaa-0000-4000-8000-00000000000a', '${U_A}', 'excluir_conta')`,
  `INSERT INTO ${T} (id, user_id, tipo, email_novo) VALUES ('9a1caaaa-0000-4000-8000-00000000000b', '${U_B}', 'corrigir_email', 'b.novo@exemplo.com')`,
];
const ID_A = "9a1caaaa-0000-4000-8000-00000000000a";
const ID_B = "9a1caaaa-0000-4000-8000-00000000000b";

const PROVAS = [];

PROVAS.push({
  nome: "(0) fixtures: admin atual, rebaixado, duas clientes; a fábrica do Supabase que o provisionar não emula",
  corpo: async (c) => {
    // Só neste CLONE (rodar-isolado): a política lê auth.uid()/auth.users.
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    for (const id of [U_ADMIN, U_A, U_B, U_REBAIXADO]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@privacidade.teste', '{}'::jsonb)`,
        [id],
      );
    }
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Atual', 'admin'), ($2, 'Cliente A', 'customer'),
         ($3, 'Cliente B', 'customer'), ($4, 'Admin Rebaixado', 'customer')`,
      [U_ADMIN, U_A, U_B, U_REBAIXADO],
    );
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = ANY($1::uuid[])`,
      [[U_ADMIN, U_REBAIXADO]],
    );
    const r = await c.query(`SELECT count(*)::int AS n FROM ${T}`);
    assert.strictEqual(r.rows[0].n, 0, "a tabela deveria nascer vazia");
  },
});

PROVAS.push({
  nome: "(a) a cliente lê SÓ os dela e insere o dela; A não vê o pedido de B",
  corpo: async (c) => {
    const r = await como(
      c,
      "a",
      [
        ["le", `SELECT id FROM ${T} ORDER BY id`],
        ["le_de_b", `SELECT id FROM ${T} WHERE id = '${ID_B}'`],
        ["insere", ...INSERIR("corrigir_email", "a.novo@exemplo.com")],
        ["le_depois", `SELECT id FROM ${T} ORDER BY id`],
      ],
      { preparo: SEMENTE },
    );
    assert.deepStrictEqual(
      r.le.linhas.map((l) => l.id),
      [ID_A],
      "A deveria ver só o pedido dela",
    );
    assert.strictEqual(r.le_de_b.n, 0, "A não pode ver o pedido de B");
    assert.ok(r.insere.ok, `A deveria inserir o dela: ${r.insere.message}`);
    assert.strictEqual(r.insere.linhas[0].situacao, "aberto");
    assert.strictEqual(r.le_depois.n, 2, "A vê os dois dela, e nenhum de B");
    const b = await como(c, "b", [["le", `SELECT id FROM ${T}`]], {
      preparo: SEMENTE,
    });
    assert.deepStrictEqual(
      b.le.linhas.map((l) => l.id),
      [ID_B],
      "B deveria ver só o dele",
    );
  },
});

PROVAS.push({
  nome: "(b) A não insere em nome de B, nem decide sozinha, nem muda o e-mail depois",
  corpo: async (c) => {
    const r = await como(
      c,
      "a",
      [
        [
          "em_nome_de_b",
          `INSERT INTO ${T} (user_id, tipo) VALUES ('${U_B}', 'excluir_conta')`,
        ],
        ["sem_user_id", `INSERT INTO ${T} (tipo) VALUES ('excluir_conta')`],
        [
          "ja_atendido",
          `INSERT INTO ${T} (user_id, tipo, situacao) VALUES ('${U_A}', 'corrigir_email', 'atendido')`,
        ],
        [
          "com_observacao",
          `INSERT INTO ${T} (user_id, tipo, email_novo, observacao) VALUES ('${U_A}', 'corrigir_email', 'x@y.com', 'ja resolvido')`,
        ],
        [
          "carimbo_forjado",
          `INSERT INTO ${T} (user_id, tipo, email_novo, atendido_em) VALUES ('${U_A}', 'corrigir_email', 'x@y.com', now())`,
        ],
        [
          "id_escolhido",
          `INSERT INTO ${T} (id, user_id, tipo) VALUES (gen_random_uuid(), '${U_A}', 'excluir_conta')`,
        ],
        [
          "troca_o_email",
          `UPDATE ${T} SET email_novo = 'outro@exemplo.com' WHERE id = '${ID_A}'`,
        ],
        [
          "troca_o_dono",
          `UPDATE ${T} SET user_id = '${U_B}' WHERE id = '${ID_A}'`,
        ],
      ],
      { preparo: SEMENTE },
    );
    // Em nome de B: a política de INSERT recusa (42501). Sem user_id: o
    // Postgres confere a política (42501) antes da restrição NOT NULL (23502);
    // qualquer das duas recusas serve, o que não pode é o pedido nascer.
    assert.ok(!r.em_nome_de_b.ok, "A inseriu em nome de B");
    assert.strictEqual(r.em_nome_de_b.code, "42501");
    assert.ok(!r.sem_user_id.ok, "inseriu sem user_id");
    assert.ok(["42501", "23502"].includes(r.sem_user_id.code));
    // Colunas que a cliente não pode escrever: falta de privilégio de coluna.
    for (const k of [
      "ja_atendido",
      "com_observacao",
      "carimbo_forjado",
      "id_escolhido",
      "troca_o_email",
      "troca_o_dono",
    ]) {
      assert.ok(!r[k].ok, `${k}: a cliente conseguiu escrever`);
      assert.strictEqual(r[k].code, "42501", `${k}: ${r[k].message}`);
    }
  },
});

PROVAS.push({
  nome: "(c) no máximo UM pedido aberto por (cliente, tipo); tipos diferentes convivem; depois de decidido, abre outro",
  corpo: async (c) => {
    const r = await como(
      c,
      "a",
      [
        ["primeiro", ...INSERIR("corrigir_email", "a1@exemplo.com")],
        ["segundo_igual", ...INSERIR("corrigir_email", "a2@exemplo.com")],
        // 'excluir_conta' já existe aberto (semente de A): o outro tipo é o da semente
        ["excluir_repetido", ...INSERIR("excluir_conta")],
      ],
      { preparo: SEMENTE },
    );
    assert.ok(r.primeiro.ok, "o primeiro pedido de e-mail devia passar");
    assert.ok(!r.segundo_igual.ok, "o segundo aberto do mesmo tipo passou");
    assert.strictEqual(r.segundo_igual.code, "23505");
    assert.ok(!r.excluir_repetido.ok, "exclusão repetida passou");
    assert.strictEqual(r.excluir_repetido.code, "23505");

    // B tem o dele em aberto e A tem o dela: o índice é POR cliente, não global.
    const b = await como(
      c,
      "b",
      [["excluir_de_b", ...INSERIR("excluir_conta")]],
      { preparo: SEMENTE },
    );
    assert.ok(b.excluir_de_b.ok, "o índice único não pode ser global");

    // Decidido o aberto, a cliente abre outro do mesmo tipo.
    const depois = await como(c, "a", [["novo", ...INSERIR("excluir_conta")]], {
      preparo: [
        ...SEMENTE,
        `UPDATE ${T} SET situacao = 'recusado' WHERE id = '${ID_A}'`,
      ],
    });
    assert.ok(
      depois.novo.ok,
      `reabrir depois de decidido: ${depois.novo.message}`,
    );
  },
});

PROVAS.push({
  nome: "(d) a cliente não atualiza a situação — nem a do pedido dela (0 linhas)",
  corpo: async (c) => {
    const r = await como(
      c,
      "a",
      [
        [
          "propria_situacao",
          `UPDATE ${T} SET situacao = 'atendido' WHERE id = '${ID_A}'`,
        ],
        [
          "propria_observacao",
          `UPDATE ${T} SET observacao = 'oi' WHERE id = '${ID_A}'`,
        ],
        [
          "do_outro",
          `UPDATE ${T} SET situacao = 'atendido' WHERE id = '${ID_B}'`,
        ],
        ["carimbo", `UPDATE ${T} SET atendido_em = now() WHERE id = '${ID_A}'`],
      ],
      { preparo: SEMENTE },
    );
    assert.ok(r.propria_situacao.ok && r.propria_situacao.n === 0);
    assert.ok(r.propria_observacao.ok && r.propria_observacao.n === 0);
    assert.ok(r.do_outro.ok && r.do_outro.n === 0);
    assert.ok(!r.carimbo.ok && r.carimbo.code === "42501");
    // Retrato como dono: nada mudou.
    await c.query("BEGIN");
    try {
      for (const s of SEMENTE) await c.query(s);
      const x = await c.query(
        `SELECT situacao FROM ${T} WHERE id IN ('${ID_A}', '${ID_B}')`,
      );
      assert.deepStrictEqual(
        x.rows.map((l) => l.situacao),
        ["aberto", "aberto"],
      );
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(e) anon não lê nem insere",
  corpo: async (c) => {
    const r = await como(
      c,
      "anon",
      [
        ["le", `SELECT id FROM ${T}`],
        [
          "insere",
          `INSERT INTO ${T} (user_id, tipo) VALUES ('${U_A}', 'excluir_conta')`,
        ],
        [
          "atualiza",
          `UPDATE ${T} SET situacao = 'atendido' WHERE id = '${ID_A}'`,
        ],
      ],
      { preparo: SEMENTE },
    );
    for (const k of ["le", "insere", "atualiza"]) {
      assert.ok(!r[k].ok, `anon: ${k} passou`);
      assert.strictEqual(r[k].code, "42501", `anon ${k}: ${r[k].message}`);
    }
  },
});

PROVAS.push({
  nome: "(f) o admin de agora lê tudo e atende (carimbo do servidor, decisão final); o rebaixado não lê nem decide",
  corpo: async (c) => {
    const r = await como(
      c,
      "admin",
      [
        ["le", `SELECT id FROM ${T} ORDER BY id`],
        [
          "atende",
          `UPDATE ${T} SET situacao = 'atendido', observacao = 'anonimizado' WHERE id = '${ID_A}' RETURNING situacao, observacao, atendido_por::text AS por, (atendido_em IS NOT NULL) AS tem_hora`,
        ],
        [
          "atende_de_novo",
          `UPDATE ${T} SET situacao = 'recusado' WHERE id = '${ID_A}'`,
        ],
        ["reabre", `UPDATE ${T} SET situacao = 'aberto' WHERE id = '${ID_A}'`],
        [
          "forja_o_atendente",
          `UPDATE ${T} SET atendido_por = '${U_B}' WHERE id = '${ID_B}'`,
        ],
        [
          "troca_o_dono",
          `UPDATE ${T} SET user_id = '${U_ADMIN}' WHERE id = '${ID_B}'`,
        ],
        [
          "situacao_invalida",
          `UPDATE ${T} SET situacao = 'sumiu' WHERE id = '${ID_B}'`,
        ],
        [
          "insere_em_nome_de_b",
          `INSERT INTO ${T} (user_id, tipo) VALUES ('${U_B}', 'excluir_conta')`,
        ],
      ],
      { preparo: SEMENTE },
    );
    assert.deepStrictEqual(
      r.le.linhas.map((l) => l.id),
      [ID_A, ID_B],
      "o admin deveria ler os dois",
    );
    assert.ok(r.atende.ok && r.atende.n === 1, r.atende.message);
    assert.strictEqual(r.atende.linhas[0].situacao, "atendido");
    assert.strictEqual(r.atende.linhas[0].por, U_ADMIN, "carimbo de quem");
    assert.strictEqual(r.atende.linhas[0].tem_hora, true, "carimbo de quando");
    assert.ok(!r.atende_de_novo.ok, "decisão tomada não se muda");
    assert.strictEqual(r.atende_de_novo.code, "55000");
    assert.ok(!r.reabre.ok, "decisão tomada não reabre");
    assert.strictEqual(r.reabre.code, "55000");
    assert.ok(!r.forja_o_atendente.ok, "o admin forjou atendido_por");
    assert.strictEqual(r.forja_o_atendente.code, "42501");
    assert.ok(!r.troca_o_dono.ok, "o admin trocou o dono do pedido");
    assert.strictEqual(r.troca_o_dono.code, "42501");
    assert.ok(!r.situacao_invalida.ok);
    assert.strictEqual(r.situacao_invalida.code, "23514");
    // O admin não é a cliente: não insere pedido em nome de outra pessoa.
    assert.ok(!r.insere_em_nome_de_b.ok);
    assert.strictEqual(r.insere_em_nome_de_b.code, "42501");

    const reb = await como(
      c,
      "rebaixado",
      [
        ["le", `SELECT id FROM ${T}`],
        [
          "decide",
          `UPDATE ${T} SET situacao = 'atendido' WHERE id = '${ID_A}'`,
        ],
      ],
      { preparo: SEMENTE },
    );
    assert.strictEqual(reb.le.n, 0, "o rebaixado leu pedido alheio");
    assert.ok(reb.decide.ok && reb.decide.n === 0, "o rebaixado decidiu");
  },
});

PROVAS.push({
  nome: "(g) NINGUÉM apaga: DELETE e TRUNCATE recusados para anon, cliente, admin e service_role; sem grant e sem política de DELETE",
  corpo: async (c) => {
    for (const quem of ["anon", "a", "admin", "rebaixado", "servico"]) {
      const r = await como(
        c,
        quem,
        [
          ["apaga_um", `DELETE FROM ${T} WHERE id = '${ID_A}'`],
          ["apaga_todos", `DELETE FROM ${T}`],
          ["trunca", `TRUNCATE ${T}`],
        ],
        { preparo: SEMENTE },
      );
      for (const k of ["apaga_um", "apaga_todos", "trunca"]) {
        assert.ok(!r[k].ok, `${quem}: ${k} passou`);
        assert.strictEqual(r[k].code, "42501", `${quem} ${k}: ${r[k].message}`);
      }
    }
    // O fato por trás da recusa: sem privilégio e sem política de DELETE.
    const g = await c.query(
      `SELECT
         has_table_privilege('anon', '${T}', 'DELETE') AS anon,
         has_table_privilege('authenticated', '${T}', 'DELETE') AS auth,
         has_table_privilege('service_role', '${T}', 'DELETE') AS servico,
         has_table_privilege('public', '${T}', 'DELETE') AS publico,
         has_table_privilege('authenticated', '${T}', 'TRUNCATE') AS trunca,
         (SELECT count(*)::int FROM pg_policy
           WHERE polrelid = '${T}'::regclass AND polcmd IN ('d', '*')) AS politicas_de_delete`,
    );
    assert.deepStrictEqual(g.rows[0], {
      anon: false,
      auth: false,
      servico: false,
      publico: false,
      trunca: false,
      politicas_de_delete: 0,
    });
  },
});

PROVAS.push({
  nome: "(h) forma: e-mail só no tipo certo e com formato; tipo fechado; o login do pedido não se apaga (sem cascata)",
  corpo: async (c) => {
    const ins = (tipo, email) => [
      `INSERT INTO ${T} (user_id, tipo, email_novo) VALUES ('${U_A}', $1, $2)`,
      [tipo, email],
    ];
    const r = await como(c, "a", [
      ["correcao_sem_email", ...ins("corrigir_email", null)],
      ["exclusao_com_email", ...ins("excluir_conta", "a@b.com")],
      ["email_sem_arroba", ...ins("corrigir_email", "semarroba.com")],
      ["email_sem_ponto", ...ins("corrigir_email", "a@semponto")],
      ["email_com_espaco", ...ins("corrigir_email", "a b@c.com")],
      ["email_gigante", ...ins("corrigir_email", `${"a".repeat(250)}@c.com`)],
      ["tipo_inventado", ...ins("apagar_tudo", null)],
      [
        "email_bom",
        ...ins("corrigir_email", "Nome.Sobrenome+loja@exemplo.com.br"),
      ],
    ]);
    for (const k of [
      "correcao_sem_email",
      "exclusao_com_email",
      "email_sem_arroba",
      "email_sem_ponto",
      "email_com_espaco",
      "email_gigante",
      "tipo_inventado",
    ]) {
      assert.ok(!r[k].ok, `${k}: o banco aceitou`);
      assert.strictEqual(r[k].code, "23514", `${k}: ${r[k].message}`);
    }
    assert.ok(r.email_bom.ok, `e-mail bom recusado: ${r.email_bom.message}`);

    // Sem cascata: o login de quem tem pedido não se apaga.
    await c.query("BEGIN");
    try {
      for (const s of SEMENTE) await c.query(s);
      await c.query("SAVEPOINT apagar_login");
      await assert.rejects(
        c.query("DELETE FROM auth.users WHERE id = $1", [U_A]),
        (e) => e.code === "23503",
        "apagar o login com pedido registrado devia violar a chave estrangeira",
      );
      await c.query("ROLLBACK TO SAVEPOINT apagar_login");
      const x = await c.query(`SELECT count(*)::int AS n FROM ${T}`);
      assert.strictEqual(x.rows[0].n, 2, "o pedido sumiu junto com o login");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(i) estrutura: RLS ligada, 3 políticas (a, r, w), índice único parcial por (user_id, tipo), colunas de INSERT e UPDATE exatas, função do gatilho fechada",
  corpo: async (c) => {
    const r = await c.query(`
      SELECT
        (SELECT relrowsecurity FROM pg_class WHERE oid = '${T}'::regclass) AS rls,
        (SELECT string_agg(polcmd::text, ',' ORDER BY polcmd::text) FROM pg_policy WHERE polrelid = '${T}'::regclass) AS comandos,
        (SELECT pg_get_indexdef(indexrelid) FROM pg_index
          WHERE indrelid = '${T}'::regclass AND indisunique AND indpred IS NOT NULL) AS indice,
        (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = '${T}'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('authenticated', '${T}'::regclass, a.attnum, 'INSERT')) AS insert_cols,
        (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = '${T}'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('authenticated', '${T}'::regclass, a.attnum, 'UPDATE')) AS update_cols,
        has_function_privilege('anon', 'public.pedidos_de_privacidade__carimbar()', 'EXECUTE') AS fn_anon,
        has_function_privilege('authenticated', 'public.pedidos_de_privacidade__carimbar()', 'EXECUTE') AS fn_auth,
        (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = '${T}'::regclass AND NOT tgisinternal) AS gatilhos
    `);
    const x = r.rows[0];
    assert.strictEqual(x.rls, true, "RLS desligada");
    assert.strictEqual(x.comandos, "a,r,w", "políticas inesperadas");
    assert.match(
      x.indice,
      /UNIQUE INDEX uq_pedidos_de_privacidade_um_aberto ON public\.pedidos_de_privacidade USING btree \(user_id, tipo\) WHERE \(situacao = 'aberto'::text\)/,
    );
    assert.strictEqual(x.insert_cols, "email_novo,tipo,user_id");
    assert.strictEqual(x.update_cols, "observacao,situacao");
    assert.strictEqual(x.fn_anon, false);
    assert.strictEqual(x.fn_auth, false);
    assert.strictEqual(x.gatilhos, 1);
  },
});

PROVAS.push({
  nome: "(j) o rollback RECUSA com pedido registrado, desfaz sem pedido e a migration reaplicada recusa; tudo desfeito no fim",
  corpo: async (c) => {
    const migration = ler(NOME_MIGRATION);
    const rollback = ler(`rollback-manual-${NOME_MIGRATION}`);
    await c.query("BEGIN");
    try {
      // 1. Reaplicar por cima do que existe: o pré-voo recusa, sem escrever.
      await c.query("SAVEPOINT reaplicar");
      await assert.rejects(
        c.query(migration),
        /B1_BASELINE_DIVERGENT/,
        "reaplicar a migration devia recusar",
      );
      await c.query("ROLLBACK TO SAVEPOINT reaplicar");

      // 2. Rollback com pedido registrado: recusa e NADA é apagado.
      for (const s of SEMENTE) await c.query(s);
      await c.query("SAVEPOINT com_pedido");
      await assert.rejects(
        c.query(rollback),
        /há 2 pedido\(s\) de privacidade registrado\(s\)/,
        "o rollback devia recusar apagar com pedido registrado",
      );
      await c.query("ROLLBACK TO SAVEPOINT com_pedido");
      const ainda = await c.query(`SELECT count(*)::int AS n FROM ${T}`);
      assert.strictEqual(ainda.rows[0].n, 2, "o rollback recusado apagou");

      // 3. Sem pedido: desfaz tudo; a segunda vez recusa (nada a desfazer).
      await c.query(`DELETE FROM ${T}`);
      await c.query(rollback);
      const sumiu = await c.query(
        `SELECT to_regclass('${T}') AS t, to_regprocedure('public.pedidos_de_privacidade__carimbar()') AS f`,
      );
      assert.strictEqual(sumiu.rows[0].t, null, "a tabela sobrou");
      assert.strictEqual(sumiu.rows[0].f, null, "a função sobrou");
      await c.query("SAVEPOINT segundo");
      await assert.rejects(
        c.query(rollback),
        /não existe/,
        "o 2o rollback devia recusar",
      );
      await c.query("ROLLBACK TO SAVEPOINT segundo");

      // 4. A migration volta a aplicar do estado de antes (a conferência final roda).
      await c.query(migration);
      const volta = await c.query(`SELECT to_regclass('${T}') AS t`);
      assert.ok(volta.rows[0].t, "a migration não recriou a tabela");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva dos pedidos de privacidade da cliente (rpc-ci)";
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(titulo, linhas.join("\n"));
        falhar(
          "FALHOU",
          "Uma regra dos pedidos de privacidade foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[pedidos-de-privacidade] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
