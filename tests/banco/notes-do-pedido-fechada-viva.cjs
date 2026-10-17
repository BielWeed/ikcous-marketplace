"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os
 * da migration, do rollback e das consultas 51a/51b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261248000000_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rodar-isolado.cjs, clone
 * exclusivo; nunca banco real).
 *
 * O DEFEITO: depois da 20261247000000 a anotação interna da lojista mora em outra tabela, mas
 * marketplace_orders.notes (a coluna que a cliente baixa) ainda aceitava UPDATE do authenticated
 * (a 20261060000000 deixou GRANT UPDATE (tracking_code, notes)). Um painel ANTIGO ainda aberto
 * continuaria gravando a anotação interna ali. A migration tira SÓ o UPDATE de notes.
 *
 * O QUE SE PROVA, com papéis reais (SET LOCAL ROLE) e a RLS de produção:
 *   (a) ANTES (controle, por rollback): o authenticated admin grava notes, então a recusa de depois
 *       é obra da migration e não do cenário;
 *   (b) DEPOIS: authenticated (admin, dona do pedido) e anon NÃO atualizam notes (42501, em UPDATE,
 *       UPDATE sem mudar valor, UPDATE junto com o rastreio e UPSERT) e NADA muda; o authenticated
 *       admin ainda atualiza tracking_code; o service_role atualiza notes; uma função SECURITY
 *       DEFINER do tipo das RPCs de pedido ainda grava notes; leitura e INSERT com notes dão o MESMO
 *       resultado de antes, papel a papel;
 *   (c) o que já existia: as linhas de pedido (inclusive uma anotação interna antiga em notes) ficam
 *       byte a byte e a dona ainda a lê; a ACL muda SÓ na entrada de coluna de notes (tabela, as
 *       outras colunas, políticas, gatilhos e funções idênticos);
 *   (d) aplicar 2x é idêntico; rollback devolve a ACL de antes; reaplicar fecha de novo;
 *   (e) transação: um erro depois do REVOKE desfaz o REVOKE (nada de meia mudança); a conferência
 *       final aborta e desfaz quando o REVOKE não revoga (privilégio herdado por papel) e quando um
 *       REVOKE de tabela apagaria o rastreio; aplicar com um painel antigo no MEIO do salvamento não
 *       espera por ele e fecha só notes para o próximo comando dele;
 *   (f) pré-voo recusa, sem escrever, ACL que não é a de antes nem a de depois (tabela inteira para
 *       authenticated/anon/PUBLIC, inclusive herdada; anon/PUBLIC em coluna; coluna a mais; GRANT
 *       OPTION; rastreio sem grant; service_role sem UPDATE; coluna, tabela ou papel ausentes) e,
 *       pelo privilégio EFETIVO, papel herdado ou PUBLIC com UPDATE em OUTRA coluna (total), no
 *       estado de antes e no de depois (WITH INHERIT FALSE e membro NOINHERIT não contam);
 *   (g) portão 51a/51b: o catálogo real lido como authenticated, negativo por objeto;
 *   (h) MUTANTES (sem o REVOKE; REVOKE de coluna que leva o rastreio; REVOKE de tabela inteira;
 *       service_role fechado junto; sem a conferência final; sem o pré-voo; migration que apaga as
 *       anotações antigas): cada um derruba a prova certa.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/notes-do-pedido-fechada-viva.cjs
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

const NOME =
  "20261248000000_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel.sql";
const TAB = "public.marketplace_orders";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");

const ADMIN = "e2480000-0000-4000-8000-000000000001";
const DONA = "e2480000-0000-4000-8000-000000000002";
const OUTRA = "e2480000-0000-4000-8000-000000000003";
const O_DONA = "e248aaaa-0000-4000-8000-000000000001";
const O_ANTIGA = "e248aaaa-0000-4000-8000-000000000002";
const O_NOVO = "e248aaaa-0000-4000-8000-000000000003";
const OBS_CLIENTE = "Observacao da cliente: deixar com o porteiro";
const ANOTACAO_ANTIGA = "Cliente deve R$ 40, nao liberar fiado";

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
  servico: { papel: "service_role", uid: "", jwt: "{}" },
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

// ---------------------------------------------------------------------------
// Semente e fotografias
// ---------------------------------------------------------------------------
async function semente(c) {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const [id, role] of [
    [ADMIN, "admin"],
    [DONA, "customer"],
    [OUTRA, "customer"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, ($1::uuid)::text || '@notes.teste', jsonb_build_object('role', $2::text))",
      [id, role],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova notes do pedido', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role",
      [id, role],
    );
  }
  for (const [id, uid, notes] of [
    [O_DONA, DONA, OBS_CLIENTE],
    // Um pedido que JÁ TINHA uma anotação interna gravada em notes antes da migration.
    [O_ANTIGA, OUTRA, ANOTACAO_ANTIGA],
  ])
    await c.query(
      `INSERT INTO ${TAB}
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, notes)
       VALUES ($1, $2, 'Cliente notes', '{}'::jsonb, 100, 100, 'new', 'online', 'pix', 'pago', $3)`,
      [id, uid, notes],
    );
}

/** O que a migration mexe (ACL) e o que ela NÃO pode mexer (tudo o mais), numa foto só. */
async function foto(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  const T = `to_regclass('${TAB}')`;
  return {
    relacl:
      await q(`SELECT relacl::text, relrowsecurity, relforcerowsecurity, relowner::regrole::text AS dono
                       FROM pg_class WHERE oid = ${T}`),
    colunas: await q(`SELECT attname::text, attacl::text FROM pg_attribute
                       WHERE attrelid = ${T} AND attnum > 0 AND NOT attisdropped ORDER BY attname`),
    politicas:
      await q(`SELECT polname, polcmd, polroles::text, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w
                          FROM pg_policy WHERE polrelid = ${T} ORDER BY polname`),
    gatilhos: await q(
      `SELECT tgname, tgtype, tgenabled FROM pg_trigger WHERE tgrelid = ${T} AND NOT tgisinternal ORDER BY tgname`,
    ),
    funcoes:
      await q(`SELECT md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || coalesce(p.proacl::text, '') || p.prosecdef::text,
                                            ',' ORDER BY p.oid::regprocedure::text)) AS h
                        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`),
    // Se a tabela sumiu (cenário de pré-voo), não há linha para fotografar (e a consulta abortaria a transação).
    linhas: (await q(`SELECT ${T} IS NOT NULL AS existe`))[0].existe
      ? await q(
          `SELECT md5(string_agg(o::text, '|' ORDER BY o.id)) AS h, count(*)::int AS n FROM ${TAB} o`,
        )
      : null,
  };
}
const semNotes = (f) => ({
  ...f,
  colunas: f.colunas.map((x) =>
    x.attname === "notes"
      ? { ...x, attacl: "(entrada de UPDATE de notes)" }
      : x,
  ),
});

async function paraAntes(c) {
  await transacao(c, () => c.query(ROLLBACK));
  const cols = (
    await c.query(
      `SELECT attname::text, attacl::text FROM pg_attribute
        WHERE attrelid = '${TAB}'::regclass AND attacl IS NOT NULL ORDER BY attname`,
    )
  ).rows;
  assert.deepEqual(
    cols.map((x) => x.attname),
    ["notes", "tracking_code"],
    "o estado de antes tem UPDATE de coluna em notes e tracking_code",
  );
  for (const x of cols)
    assert.match(x.attacl, /^\{authenticated=w\/\w+\}$/, "ACL de antes");
}
const aplicar = (c, sql = MIGRATION) => transacao(c, () => c.query(sql));

// ---------------------------------------------------------------------------
// A bateria de comportamento
// ---------------------------------------------------------------------------
const FUNCAO_DEFINER = `
  CREATE FUNCTION public.zz_prova_grava_nota(p uuid, t text) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
  DECLARE n int;
  BEGIN
    UPDATE public.marketplace_orders SET notes = t WHERE id = p;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END $f$;
  GRANT EXECUTE ON FUNCTION public.zz_prova_grava_nota(uuid, text) TO authenticated, anon, service_role`;
const INSERE_COM_NOTES = `INSERT INTO ${TAB} (id, customer_name, customer_data, total, subtotal, notes)
  VALUES ($1, 'Pedido novo', '{}'::jsonb, 10, 10, 'Observacao da cliente na criacao') RETURNING notes`;
const NEGADOS_DA_BATERIA = [
  "notes",
  "notes sem mudar valor",
  "notes e rastreio juntos",
  "upsert",
];
const BATERIA = [
  [
    "notes",
    `UPDATE ${TAB} SET notes = 'VAZOU' WHERE id = $1 RETURNING id::text`,
    [O_DONA],
  ],
  [
    "notes sem mudar valor",
    `UPDATE ${TAB} SET notes = notes WHERE id = $1`,
    [O_DONA],
  ],
  [
    "notes e rastreio juntos",
    `UPDATE ${TAB} SET notes = 'VAZOU', tracking_code = 'ZZ999' WHERE id = $1`,
    [O_DONA],
  ],
  [
    "upsert",
    `INSERT INTO ${TAB} (id, customer_name, customer_data, total, subtotal, notes)
       VALUES ($1, 'Cliente notes', '{}'::jsonb, 100, 100, 'VAZOU')
       ON CONFLICT (id) DO UPDATE SET notes = EXCLUDED.notes`,
    [O_DONA],
  ],
  [
    "rastreio",
    `UPDATE ${TAB} SET tracking_code = 'BR123' WHERE id = $1 RETURNING tracking_code`,
    [O_DONA],
  ],
  ["le", `SELECT notes, tracking_code FROM ${TAB} WHERE id = $1`, [O_DONA]],
  ["insere com notes", INSERE_COM_NOTES, [O_NOVO]],
  [
    "funcao definer",
    "SELECT public.zz_prova_grava_nota($1, 'GRAVOU PELA FUNCAO') AS n",
    [O_DONA],
  ],
];
// O que tem de dar o MESMO resultado antes e depois (sem as gravações de notes, que mudariam a leitura).
const BATERIA_IGUAL = BATERIA.filter(
  ([nome]) => !NEGADOS_DA_BATERIA.includes(nome),
);
const DEPOIS_DA_BATERIA = [
  `SELECT id::text, notes, tracking_code FROM ${TAB} WHERE id::text LIKE 'e248aaaa-%' ORDER BY id`,
];
const bateria = (c, quem, passos = BATERIA) =>
  como(c, quem, passos, {
    preparo: [
      FUNCAO_DEFINER,
      // No Supabase o service_role atravessa a RLS; no clone ele só tem os grants.
      "ALTER ROLE service_role BYPASSRLS",
    ],
    depois: DEPOIS_DA_BATERIA,
  });
const NEGADOS = NEGADOS_DA_BATERIA;
const resumo = (r) => ({
  ok: r.ok,
  n: r.n,
  code: r.code,
  linha: r.linha,
});

/** O estado de DEPOIS, papel a papel. As mensagens são as que os mutantes precisam derrubar. */
async function comportamentoDepois(c) {
  for (const quem of ["admin", "dona", "anon"]) {
    const r = await bateria(c, quem);
    for (const k of NEGADOS) {
      assert.equal(
        r[k].ok,
        false,
        `${quem} ATUALIZOU notes (${k}) — a porta continua aberta`,
      );
      assert.equal(r[k].code, "42501", `${quem} ${k}: ${r[k].message}`);
      assert.match(r[k].message, /permission denied/, `${quem} ${k}`);
    }
    // Nada mudou por causa dos pedidos recusados (o "notes e rastreio juntos" não grava o rastreio).
    const o = r.depois.find((l) => l.id === O_DONA);
    assert.notEqual(o.notes, "VAZOU", `${quem}: notes mudou`);
    assert.notEqual(
      o.tracking_code,
      "ZZ999",
      `${quem}: a gravação recusada gravou o rastreio`,
    );
    if (quem === "admin") {
      assert.equal(
        r.rastreio.ok,
        true,
        `admin NÃO atualizou tracking_code: ${r.rastreio.message}`,
      );
      assert.equal(r.rastreio.n, 1);
      assert.equal(r.rastreio.linha.tracking_code, "BR123");
      assert.equal(o.tracking_code, "BR123");
      assert.equal(r["insere com notes"].ok, true);
    } else if (quem === "dona") {
      // Dona do pedido: continua sem UPDATE de linha (RLS só dá UPDATE ao admin) — 0 linhas, sem erro.
      assert.equal(r.rastreio.ok, true);
      assert.equal(r.rastreio.n, 0, "a dona atualizou a linha");
    } else {
      assert.equal(r.rastreio.ok, false, "anon atualizou tracking_code");
      assert.equal(r.rastreio.code, "42501");
    }
    // A função SECURITY DEFINER (RPC de pedido) grava notes como o dono, para qualquer chamador.
    assert.equal(
      r["funcao definer"].ok,
      true,
      `${quem}: função SECURITY DEFINER não gravou notes: ${r["funcao definer"].message}`,
    );
    assert.equal(r["funcao definer"].linha.n, 1);
    assert.equal(o.notes, "GRAVOU PELA FUNCAO");
  }
  const sv = await bateria(c, "servico");
  for (const k of ["notes", "notes sem mudar valor", "rastreio", "upsert"]) {
    assert.equal(
      sv[k].ok,
      true,
      `service_role NÃO atualizou notes (${k}): ${sv[k].message}`,
    );
  }
  assert.equal(sv.notes.n, 1);
  assert.equal(sv.rastreio.n, 1);
}

/** CONTROLE: no estado de ANTES o painel antigo grava notes — a recusa de DEPOIS é da migration. */
async function controleAntes(c) {
  const r = await bateria(c, "admin");
  for (const k of NEGADOS)
    assert.equal(
      r[k].ok,
      true,
      `controle (antes): admin deveria gravar notes (${k}): ${r[k].message}`,
    );
  assert.equal(r.notes.n, 1);
  const dona = await bateria(c, "dona");
  assert.equal(
    dona.notes.ok,
    true,
    "controle (antes): a dona também podia (0 linhas, sem erro)",
  );
  assert.equal(dona.notes.n, 0);
}

/** Leitura, INSERT com notes, rastreio e função SECURITY DEFINER dão o MESMO resultado antes e depois. */
async function igualAntesEDepois(c, sql = MIGRATION) {
  await paraAntes(c);
  const antes = {};
  for (const quem of ["admin", "dona", "anon", "servico"])
    antes[quem] = await bateria(c, quem, BATERIA_IGUAL);
  await aplicar(c, sql);
  for (const quem of ["admin", "dona", "anon", "servico"]) {
    const depois = await bateria(c, quem, BATERIA_IGUAL);
    for (const k of ["le", "insere com notes", "funcao definer"])
      assert.deepEqual(
        resumo(depois[k]),
        resumo(antes[quem][k]),
        `${quem}: "${k}" mudou depois da migration`,
      );
    if (quem !== "anon")
      assert.deepEqual(
        resumo(depois.rastreio),
        resumo(antes[quem].rastreio),
        `${quem}: o rastreio mudou depois da migration`,
      );
  }
}

// ---------------------------------------------------------------------------
// Efeito, dado existente, idempotência, atomicidade
// ---------------------------------------------------------------------------
async function efeito(c, sql = MIGRATION) {
  await paraAntes(c);
  const f0 = await foto(c);
  const dona0 = await como(c, "dona", [
    ["le", `SELECT notes FROM ${TAB} WHERE id = $1`, [O_DONA]],
  ]);
  assert.equal(dona0.le.linha.notes, OBS_CLIENTE);
  await aplicar(c, sql);
  const f1 = await foto(c);
  // Dado que já existia: nenhuma linha mexida (nem a anotação antiga), mesmas linhas.
  assert.deepEqual(f1.linhas, f0.linhas, "a migration mexeu em dado de pedido");
  assert.equal(f1.linhas[0].n, 2);
  const dona1 = await como(c, "dona", [
    ["le", `SELECT notes FROM ${TAB} WHERE id = $1`, [O_DONA]],
  ]);
  assert.equal(
    dona1.le.linha.notes,
    OBS_CLIENTE,
    "a dona deixou de ler o próprio pedido",
  );
  // O comportamento por papel (a porta fechada, o rastreio e o service_role de pé).
  await comportamentoDepois(c);
  // A ACL mudou SÓ na entrada de coluna de notes; o resto é idêntico.
  assert.deepEqual(
    semNotes(f1),
    semNotes(f0),
    "a migration mexeu em algo além do UPDATE de notes",
  );
  assert.equal(
    f1.colunas.find((x) => x.attname === "notes").attacl,
    null,
    "notes ainda tem entrada de ACL",
  );
  assert.notEqual(f0.colunas.find((x) => x.attname === "notes").attacl, null);
}

async function idempotente(c, sql = MIGRATION) {
  await paraAntes(c);
  await aplicar(c, sql);
  const f1 = await foto(c);
  await aplicar(c, sql);
  assert.deepEqual(await foto(c), f1, "aplicar 2x mudou algo");
  // Rollback devolve a ACL de antes; reaplicar fecha de novo, byte a byte.
  await transacao(c, () => c.query(ROLLBACK));
  const aberta = await foto(c);
  await transacao(c, () => c.query(ROLLBACK));
  assert.deepEqual(await foto(c), aberta, "rollback 2x mudou algo");
  assert.notEqual(
    aberta.colunas.find((x) => x.attname === "notes").attacl,
    null,
    "o rollback não reabriu notes",
  );
  assert.deepEqual(
    semNotes(aberta),
    semNotes(f1),
    "o rollback mexeu em algo além de notes",
  );
  await aplicar(c, sql);
  assert.deepEqual(
    await foto(c),
    f1,
    "reaplicar depois do rollback não restaurou o estado",
  );
}

async function transacaoInterrompida(c) {
  await paraAntes(c);
  const f0 = await foto(c);
  // Sem BEGIN: o arquivo inteiro é UMA transação implícita; um erro DEPOIS do REVOKE desfaz o REVOKE.
  await assert.rejects(c.query(`${MIGRATION}\nSELECT 1 / 0;`), erro("22012"));
  assert.deepEqual(
    await foto(c),
    f0,
    "meia mudança ficou gravada (REVOKE sem o resto)",
  );
  // Idem com a transação aberta pelo aplicador.
  await assert.rejects(
    transacao(c, async () => {
      await c.query(MIGRATION);
      await c.query("SELECT 1 / 0");
    }),
    erro("22012"),
  );
  assert.deepEqual(await foto(c), f0);
}

/** Painel antigo no MEIO do salvamento quando o apply entra: não espera, fecha só notes. */
async function concorrencia(c, url) {
  await paraAntes(c);
  const a = new Client({ connectionString: url });
  await a.connect();
  try {
    await a.query("BEGIN");
    await a.query("SET LOCAL ROLE authenticated");
    await a.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, claims(ADMIN, "admin")],
    );
    const r1 = await a.query(
      `UPDATE ${TAB} SET tracking_code = 'EMVOO' WHERE id = $1`,
      [O_DONA],
    );
    assert.equal(r1.rowCount, 1);
    const t0 = Date.now();
    await aplicar(c); // lock_timeout 5s: se esperasse pela transação aberta, estouraria
    assert(Date.now() - t0 < 4000, "o apply ficou esperando o painel antigo");
    // O próximo comando do painel antigo enxerga a ACL nova.
    await a.query("SAVEPOINT s");
    await assert.rejects(
      a.query(`UPDATE ${TAB} SET notes = 'VAZOU' WHERE id = $1`, [O_DONA]),
      erro("42501", "permission denied"),
      "o painel antigo ainda gravou notes depois do apply",
    );
    await a.query("ROLLBACK TO SAVEPOINT s");
    const r2 = await a.query(
      `UPDATE ${TAB} SET tracking_code = 'EMVOO2' WHERE id = $1`,
      [O_DONA],
    );
    assert.equal(r2.rowCount, 1, "o rastreio parou de gravar");
    await a.query("ROLLBACK");
  } finally {
    await a.end();
  }
}

// ---------------------------------------------------------------------------
// Pré-voo e conferência final
// ---------------------------------------------------------------------------
// Privilégio EFETIVO em OUTRA coluna (total): conta o que vem de papel herdado e de PUBLIC, não só a ACL
// direta. Um detector que lê só o attacl do authenticated aprova estes estados (mutante "só a ACL direta").
const PAPEL_COM_TOTAL = `CREATE ROLE zz_herda NOLOGIN; GRANT UPDATE (total) ON ${TAB} TO zz_herda`;
const HERANCA_EM_OUTRA_COLUNA = [
  [
    "authenticated herda papel com UPDATE em total (WITH INHERIT TRUE)",
    `${PAPEL_COM_TOTAL}; GRANT zz_herda TO authenticated WITH INHERIT TRUE`,
    "authenticated atualiza as colunas",
  ],
  [
    "PUBLIC com UPDATE em total",
    `GRANT UPDATE (total) ON ${TAB} TO PUBLIC`,
    "anon ou PUBLIC",
  ],
  [
    "anon herda papel com UPDATE em total",
    `${PAPEL_COM_TOTAL}; GRANT zz_herda TO anon WITH INHERIT TRUE`,
    "anon ou PUBLIC",
  ],
];
const DIVERGENCIAS_DE_ANTES = [
  [
    "UPDATE de tabela inteira para authenticated",
    `GRANT UPDATE ON ${TAB} TO authenticated`,
    "TABELA inteira",
  ],
  [
    "UPDATE de tabela inteira para anon",
    `GRANT UPDATE ON ${TAB} TO anon`,
    "TABELA inteira",
  ],
  [
    "UPDATE de tabela inteira para PUBLIC",
    `GRANT UPDATE ON ${TAB} TO PUBLIC`,
    "TABELA inteira",
  ],
  [
    "UPDATE de tabela inteira herdado por papel",
    `CREATE ROLE zz_herda NOLOGIN; GRANT UPDATE ON ${TAB} TO zz_herda; GRANT zz_herda TO authenticated`,
    "TABELA inteira",
  ],
  [
    "anon com UPDATE em notes",
    `GRANT UPDATE (notes) ON ${TAB} TO anon`,
    "anon ou PUBLIC",
  ],
  [
    "anon com UPDATE em outra coluna",
    `GRANT UPDATE (status) ON ${TAB} TO anon`,
    "anon ou PUBLIC",
  ],
  [
    "PUBLIC com UPDATE em notes",
    `GRANT UPDATE (notes) ON ${TAB} TO PUBLIC`,
    "anon ou PUBLIC",
  ],
  [
    "authenticated com coluna a mais",
    `GRANT UPDATE (status) ON ${TAB} TO authenticated`,
    "authenticated atualiza as colunas",
  ],
  [
    "authenticated com GRANT OPTION",
    `GRANT UPDATE (notes) ON ${TAB} TO authenticated WITH GRANT OPTION`,
    "GRANT OPTION",
  ],
  [
    "authenticated sem tracking_code (só notes)",
    `REVOKE UPDATE (tracking_code) ON ${TAB} FROM authenticated`,
    "authenticated atualiza as colunas",
  ],
  [
    "authenticated sem coluna alguma",
    `REVOKE UPDATE (notes, tracking_code) ON ${TAB} FROM authenticated`,
    "[nenhuma]",
  ],
  [
    "service_role sem UPDATE",
    `REVOKE UPDATE ON ${TAB} FROM service_role`,
    "service_role",
  ],
  [
    "coluna notes ausente",
    `ALTER TABLE ${TAB} RENAME COLUMN notes TO notes_x`,
    "sem a coluna notes",
  ],
  [
    "tabela ausente",
    `ALTER TABLE ${TAB} RENAME TO marketplace_orders_x`,
    "marketplace_orders ausente",
  ],
  [
    "papel anon ausente",
    "ALTER ROLE anon RENAME TO anon_x",
    "faltam os papéis",
  ],
  ...HERANCA_EM_OUTRA_COLUNA,
];
const DIVERGENCIAS_DE_DEPOIS = [
  [
    "depois + tabela inteira para authenticated",
    `GRANT UPDATE ON ${TAB} TO authenticated`,
    "TABELA inteira",
  ],
  [
    "depois + anon com UPDATE em notes",
    `GRANT UPDATE (notes) ON ${TAB} TO anon`,
    "anon ou PUBLIC",
  ],
  [
    "depois + coluna a mais",
    `GRANT UPDATE (status) ON ${TAB} TO authenticated`,
    "authenticated atualiza as colunas",
  ],
  [
    "depois + rastreio perdido",
    `REVOKE UPDATE (tracking_code) ON ${TAB} FROM authenticated`,
    "[nenhuma]",
  ],
  ...HERANCA_EM_OUTRA_COLUNA.map(([nome, montagem, fragmento]) => [
    `depois + ${nome}`,
    montagem,
    fragmento,
  ]),
];
/** `sql` recusa com B1_BASELINE_DIVERGENT, sem escrever nada, a partir da divergência montada. */
async function recusa(c, nome, montagem, fragmento, sql) {
  await c.query("BEGIN");
  try {
    for (const parte of montagem.split(";"))
      if (parte.trim()) await c.query(parte);
    const estranho = await foto(c);
    await c.query("SAVEPOINT pv");
    await assert.rejects(
      c.query(sql),
      (e) =>
        e.code === "P0001" &&
        e.message.includes("B1_BASELINE_DIVERGENT") &&
        e.message.includes(fragmento),
      `pré-voo aceitou ou recusou pelo motivo errado: ${nome}`,
    );
    await c.query("ROLLBACK TO SAVEPOINT pv");
    assert.deepEqual(
      await foto(c),
      estranho,
      `pré-voo escreveu antes de recusar: ${nome}`,
    );
  } finally {
    await c.query("ROLLBACK");
  }
}
async function preVoo(c, sql = MIGRATION) {
  await paraAntes(c);
  for (const [nome, montagem, fragmento] of DIVERGENCIAS_DE_ANTES)
    await recusa(c, nome, montagem, fragmento, sql);
  await aplicar(c, sql);
  for (const [nome, montagem, fragmento] of DIVERGENCIAS_DE_DEPOIS)
    await recusa(c, nome, montagem, fragmento, sql);
}
async function preVooDoRollback(c) {
  await aplicar(c);
  for (const [nome, montagem, fragmento] of [
    [
      "rollback: anon com UPDATE em notes",
      `GRANT UPDATE (notes) ON ${TAB} TO anon`,
      "anon ou PUBLIC",
    ],
    [
      "rollback: anon com UPDATE de tabela",
      `GRANT UPDATE ON ${TAB} TO anon`,
      "anon ou PUBLIC",
    ],
    [
      "rollback: anon herda papel com UPDATE em total",
      `${PAPEL_COM_TOTAL}; GRANT zz_herda TO anon WITH INHERIT TRUE`,
      "anon ou PUBLIC",
    ],
    [
      "rollback: coluna ausente",
      `ALTER TABLE ${TAB} RENAME COLUMN tracking_code TO tc_x`,
      "sem a coluna",
    ],
    [
      "rollback: tabela ausente",
      `ALTER TABLE ${TAB} RENAME TO marketplace_orders_x`,
      "ausente",
    ],
  ])
    await recusa(c, nome, montagem, fragmento, ROLLBACK);
}

/** Quando o REVOKE não revoga, a conferência final aborta e desfaz TUDO. */
async function conferencia(c, sql = MIGRATION) {
  await paraAntes(c);
  // Privilégio HERDADO por papel: o pré-voo (que lê a ACL direta) deixa passar, o REVOKE não o alcança.
  for (const estado of ["antes", "depois"]) {
    if (estado === "depois") await aplicar(c);
    await c.query("BEGIN");
    try {
      await c.query("CREATE ROLE zz_herda NOLOGIN");
      await c.query(`GRANT UPDATE (notes) ON ${TAB} TO zz_herda`);
      await c.query("GRANT zz_herda TO authenticated");
      const f = await foto(c);
      await c.query("SAVEPOINT cf");
      await assert.rejects(
        c.query(sql),
        erro("P0001", "conferencia 20261248: authenticated ainda atualiza"),
        `a conferência não abortou com ${estado} + herança (o apply terminaria "ok" com a porta aberta)`,
      );
      await c.query("ROLLBACK TO SAVEPOINT cf");
      assert.deepEqual(
        await foto(c),
        f,
        "a conferência abortou mas deixou meia mudança",
      );
      const r = await como2(c);
      assert.equal(
        r,
        true,
        "com a herança a prova de controle devia gravar notes",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    if (estado === "depois") await paraAntes(c);
  }
}
/** Dentro da transação aberta: o authenticated admin grava notes pela herança (controle da prova). */
async function como2(c) {
  await c.query("SAVEPOINT ctl");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, claims(ADMIN, "admin")],
    );
    const r = await c.query(
      `UPDATE ${TAB} SET notes = 'HERDADO' WHERE id = $1`,
      [O_DONA],
    );
    return r.rowCount === 1;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT ctl");
  }
}
/** A conferência TAMBÉM pega o REVOKE de tabela inteira (que levaria o tracking_code junto). */
async function conferenciaDoRastreio(c) {
  await paraAntes(c);
  const f0 = await foto(c);
  const alvo =
    "REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM authenticated;";
  assert.equal(MIGRATION.split(alvo).length, 2);
  await assert.rejects(
    aplicar(
      c,
      MIGRATION.replace(
        alvo,
        "REVOKE UPDATE ON TABLE public.marketplace_orders FROM authenticated;",
      ),
    ),
    erro("P0001", "perdeu o UPDATE em marketplace_orders.tracking_code"),
  );
  assert.deepEqual(await foto(c), f0, "o abort deixou meia mudança");
}

// ---------------------------------------------------------------------------
// Portão 51a/51b: o catálogo real, lido como authenticated.
// ---------------------------------------------------------------------------
const A51 = "51a-conferir-notes-do-pedido-fechada-aplicado";
const B51 = "51b-antes-notes-do-pedido-base-vigente";
/** Lê a consulta do catálogo como authenticated, dentro da transação aberta, e confere o rol fechado. */
async function lerCatalogo(c, nome) {
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
}
const aprovadas = (rows) => rows.every((r) => r.ok === true);

/** Herança que NÃO conta (NOINHERIT): o apply segue, e a 51a/51b não reportam divergência. */
async function herancaQueNaoConta(c) {
  const casos = [
    [
      "GRANT … WITH INHERIT FALSE",
      `${PAPEL_COM_TOTAL}; GRANT zz_herda TO authenticated WITH INHERIT FALSE`,
    ],
    [
      "membro com NOINHERIT",
      `${PAPEL_COM_TOTAL}; ALTER ROLE authenticated NOINHERIT; GRANT zz_herda TO authenticated`,
    ],
  ];
  for (const [nome, montagem] of casos) {
    await paraAntes(c);
    await c.query("BEGIN");
    try {
      for (const parte of montagem.split(";"))
        if (parte.trim()) await c.query(parte);
      assert.equal(
        (
          await c.query(
            `SELECT has_column_privilege('authenticated', '${TAB}'::regclass, 'total', 'UPDATE') AS sim`,
          )
        ).rows[0].sim,
        false,
        `${nome}: o privilégio herdado não deveria contar`,
      );
      assert(
        aprovadas(await lerCatalogo(c, B51)),
        `${nome}: 51b reportou divergência em herança que não conta`,
      );
      await c.query(MIGRATION); // não recusa
      assert(
        aprovadas(await lerCatalogo(c, A51)),
        `${nome}: 51a reportou divergência em herança que não conta`,
      );
      assert(
        (
          await c.query(
            `SELECT has_column_privilege('authenticated', '${TAB}'::regclass, 'notes', 'UPDATE') AS sim`,
          )
        ).rows[0].sim === false,
        `${nome}: notes continua aberta`,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  }
}

async function portao(c) {
  const A = A51;
  const B = B51;
  const consulta = (nome) => lerCatalogo(c, nome);
  const positivas = (rows) => rows.every((r) => r.ok === true);
  const reprovados = (rows) =>
    rows.filter((r) => r.ok !== true).map((r) => r.item);
  const rolA = CONF.ROL_DA_51A;
  const rolB = CONF.ROL_DA_51B;
  // ANTES (estado real de produção): a 51b aprova, a 51a reprova.
  await paraAntes(c);
  await c.query("BEGIN");
  try {
    assert(
      positivas(await consulta(B)),
      "51b deveria aprovar o estado de antes",
    );
    assert(
      !positivas(await consulta(A)),
      "51a deveria reprovar o estado de antes",
    );
    const mutacoesDaB = [
      [
        "authenticated sem notes",
        `REVOKE UPDATE (notes) ON ${TAB} FROM authenticated`,
        [1],
      ],
      [
        "authenticated com coluna a mais",
        `GRANT UPDATE (status) ON ${TAB} TO authenticated`,
        [1],
      ],
      [
        "UPDATE de tabela inteira",
        `GRANT UPDATE ON ${TAB} TO authenticated`,
        [1, 2],
      ],
      [
        "anon com UPDATE em coluna",
        `GRANT UPDATE (notes) ON ${TAB} TO anon`,
        [3],
      ],
      [
        "service_role sem UPDATE",
        `REVOKE UPDATE ON ${TAB} FROM service_role`,
        [4],
      ],
      [
        "coluna ausente",
        `ALTER TABLE ${TAB} RENAME COLUMN tracking_code TO tc_x`,
        [1, 4, 5],
      ],
      [
        "papel herdado com UPDATE em outra coluna (total)",
        `${PAPEL_COM_TOTAL}; GRANT zz_herda TO authenticated WITH INHERIT TRUE`,
        [1],
      ],
      [
        "PUBLIC com UPDATE em total",
        `GRANT UPDATE (total) ON ${TAB} TO PUBLIC`,
        [1, 3],
      ],
      [
        "anon herda papel com UPDATE em total",
        `${PAPEL_COM_TOTAL}; GRANT zz_herda TO anon WITH INHERIT TRUE`,
        [3],
      ],
    ];
    for (const [item, sql, esperados] of mutacoesDaB) {
      await c.query("SAVEPOINT mutacao_portao");
      await c.query(sql);
      assert.deepEqual(
        reprovados(await consulta(B)).sort(),
        esperados.map((i) => rolB[i]).sort(),
        `51b deveria reprovar exatamente os itens de: ${item}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT mutacao_portao");
    }
  } finally {
    await c.query("ROLLBACK");
  }
  // DEPOIS: a 51a aprova, a 51b reprova (authenticated sem notes).
  await aplicar(c);
  await c.query("BEGIN");
  try {
    assert(
      positivas(await consulta(A)),
      "51a deveria aprovar o estado da migration",
    );
    assert(
      !positivas(await consulta(B)),
      "51b deveria reprovar a coluna já fechada",
    );
    const mutacoes = [
      [
        "authenticated volta a gravar notes",
        `GRANT UPDATE (notes) ON ${TAB} TO authenticated`,
        [1, 2],
      ],
      [
        "UPDATE de tabela inteira para authenticated",
        `GRANT UPDATE ON ${TAB} TO authenticated`,
        [1, 2],
      ],
      [
        "notes aberta ao anon",
        `GRANT UPDATE (notes) ON ${TAB} TO anon`,
        [1, 3],
      ],
      [
        "notes aberta ao PUBLIC",
        `GRANT UPDATE (notes) ON ${TAB} TO PUBLIC`,
        [1, 2, 3],
      ],
      [
        "rastreio perdido",
        `REVOKE UPDATE (tracking_code) ON ${TAB} FROM authenticated`,
        [2],
      ],
      [
        "coluna a mais",
        `GRANT UPDATE (status) ON ${TAB} TO authenticated`,
        [2],
      ],
      [
        "service_role sem UPDATE",
        `REVOKE UPDATE ON ${TAB} FROM service_role`,
        [4],
      ],
      [
        "tracking_code com GRANT OPTION",
        `GRANT UPDATE (tracking_code) ON ${TAB} TO authenticated WITH GRANT OPTION`,
        [2],
      ],
      [
        "herança de papel",
        `CREATE ROLE zz_herda NOLOGIN; GRANT UPDATE (notes) ON ${TAB} TO zz_herda; GRANT zz_herda TO authenticated`,
        [1, 2],
      ],
      [
        "coluna ausente",
        `ALTER TABLE ${TAB} RENAME COLUMN notes TO notes_x`,
        [1, 4, 5],
      ],
      [
        "papel herdado com UPDATE em outra coluna (total)",
        `${PAPEL_COM_TOTAL}; GRANT zz_herda TO authenticated WITH INHERIT TRUE`,
        [2],
      ],
      [
        "PUBLIC com UPDATE em total",
        `GRANT UPDATE (total) ON ${TAB} TO PUBLIC`,
        [2, 3],
      ],
      [
        "anon herda papel com UPDATE em total",
        `${PAPEL_COM_TOTAL}; GRANT zz_herda TO anon WITH INHERIT TRUE`,
        [3],
      ],
    ];
    for (const [item, sql, esperados] of mutacoes) {
      await c.query("SAVEPOINT mutacao_portao");
      for (const parte of sql.split(";"))
        if (parte.trim()) await c.query(parte);
      assert.deepEqual(
        reprovados(await consulta(A)).sort(),
        esperados.map((i) => rolA[i]).sort(),
        `51a deveria reprovar exatamente os itens de: ${item}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT mutacao_portao");
    }
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// MUTANTES: a prova certa tem de cair com cada defeito.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql.replace(
    /DO \$conferencia_20261248\$[\s\S]*?END \$conferencia_20261248\$;\n?/,
    "",
  );
const SEM_PREVOO = (sql) =>
  sql.replace(
    /DO \$preflight_20261248\$[\s\S]*?END \$preflight_20261248\$;\n?/,
    "",
  );
/** O trecho tem de aparecer UMA vez: senão o mutante pode cair num comentário e não mudar nada. */
const trocar = (sql, de, para) => {
  assert.equal(
    sql.split(de).length,
    2,
    `mutante: o trecho tem de aparecer UMA vez: ${de.slice(0, 70)}`,
  );
  return sql.replace(de, () => para);
};
const REVOKE_AUTH =
  "REVOKE UPDATE (notes) ON TABLE public.marketplace_orders FROM authenticated;\n";
// [nome, muta, prova que PRECISA derrubá-lo, trecho da mensagem da asserção]
const MUTANTES = [
  [
    "sem o REVOKE de notes",
    (s) => SEM_CONFERENCIA(trocar(s, REVOKE_AUTH, "")),
    efeito,
    "admin ATUALIZOU notes",
  ],
  [
    "REVOKE de coluna que leva o rastreio junto",
    (s) =>
      SEM_CONFERENCIA(
        trocar(
          s,
          REVOKE_AUTH,
          "REVOKE UPDATE (notes, tracking_code) ON TABLE public.marketplace_orders FROM authenticated;\n",
        ),
      ),
    efeito,
    "admin NÃO atualizou tracking_code",
  ],
  [
    "REVOKE de tabela inteira (apaga o grant de coluna do rastreio)",
    (s) =>
      SEM_CONFERENCIA(
        trocar(
          s,
          REVOKE_AUTH,
          "REVOKE UPDATE ON TABLE public.marketplace_orders FROM authenticated;\n",
        ),
      ),
    efeito,
    "admin NÃO atualizou tracking_code",
  ],
  [
    "fecha o service_role junto",
    (s) =>
      SEM_CONFERENCIA(
        trocar(
          s,
          REVOKE_AUTH,
          `${REVOKE_AUTH}REVOKE UPDATE ON TABLE public.marketplace_orders FROM service_role;\n`,
        ),
      ),
    efeito,
    "service_role NÃO atualizou notes",
  ],
  [
    "a migration apaga as anotações antigas",
    (s) =>
      SEM_CONFERENCIA(
        trocar(
          s,
          REVOKE_AUTH,
          `${REVOKE_AUTH}UPDATE public.marketplace_orders SET notes = NULL WHERE notes IS NOT NULL;\n`,
        ),
      ),
    efeito,
    "a migration mexeu em dado de pedido",
  ],
  [
    "sem a conferência final (REVOKE que não revoga passaria em silêncio)",
    (s) => SEM_CONFERENCIA(s),
    conferencia,
    "a conferência não abortou",
  ],
  [
    "pré-voo que ignora o UPDATE de tabela inteira (o REVOKE de coluna não o tira)",
    (s) => {
      const m = /IF has_table_privilege\('anon'[\s\S]*?THEN/.exec(s);
      assert(m, "mutante: pré-voo da tabela inteira não achado");
      return s.replace(m[0], "IF false THEN");
    },
    preVoo,
    "pré-voo aceitou ou recusou pelo motivo errado",
  ],
  [
    "pré-voo que ignora coluna a mais do authenticated",
    (s) =>
      trocar(
        s,
        "IF v_colunas IS DISTINCT FROM 'notes,tracking_code' AND v_colunas IS DISTINCT FROM 'tracking_code' THEN",
        "IF false THEN",
      ),
    preVoo,
    "pré-voo aceitou ou recusou pelo motivo errado",
  ],
  [
    "o detector de colunas do authenticated volta a ler só a ACL DIRETA (papel herdado passa em silêncio)",
    (s) => {
      const efetivo = "has_column_privilege(v_auth, v_t, a.attnum, 'UPDATE')";
      assert.equal(
        s.split(efetivo).length,
        3,
        "mutante: pré-voo e conferência",
      );
      return s
        .split(efetivo)
        .join(
          "EXISTS (SELECT 1 FROM aclexplode(a.attacl) g WHERE g.privilege_type = 'UPDATE' AND g.grantee = v_auth)",
        );
    },
    preVoo,
    "pré-voo aceitou ou recusou pelo motivo errado: authenticated herda papel com UPDATE em total",
  ],
  [
    "o detector de anon e PUBLIC volta a ler só a ACL DIRETA (anon herdado passa em silêncio)",
    (s) => {
      const efetivo =
        /\(has_column_privilege\(v_anon, v_t, a\.attnum, 'UPDATE'\)\s+OR has_column_privilege\('public'::name, v_t, a\.attnum, 'UPDATE'\)\)/g;
      assert.equal(
        (s.match(efetivo) || []).length,
        2,
        "mutante: pré-voo e conferência",
      );
      return s.replace(
        efetivo,
        "EXISTS (SELECT 1 FROM aclexplode(a.attacl) g WHERE g.privilege_type = 'UPDATE' AND g.grantee IN (0, v_anon))",
      );
    },
    preVoo,
    "pré-voo aceitou ou recusou pelo motivo errado: anon herda papel com UPDATE em total",
  ],
  [
    "sem o pré-voo (ACL desconhecida entraria no apply)",
    (s) => SEM_PREVOO(s),
    preVoo,
    "pré-voo aceitou ou recusou pelo motivo errado",
  ],
];
/** Devolve a ACL de produção (um mutante pode ter levado o rastreio ou o service_role junto) e reaplica a real. */
async function restaurar(c) {
  await c.query(`REVOKE UPDATE ON ${TAB} FROM authenticated, anon`);
  await c.query(
    `GRANT UPDATE (notes, tracking_code) ON ${TAB} TO authenticated`,
  );
  await c.query(`GRANT UPDATE ON ${TAB} TO service_role`);
  await paraAntes(c);
  await aplicar(c);
}
async function mutantes(c) {
  await comportamentoDepoisDeAplicar(c); // controle: verde
  let mortos = 0;
  for (const [nome, muta, prova, fragmento] of MUTANTES) {
    const alterada = muta(MIGRATION);
    assert.notEqual(alterada, MIGRATION, `mutante "${nome}" não mudou nada`);
    let motivo;
    try {
      await prova(c, alterada);
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
  await comportamentoDepoisDeAplicar(c); // tudo restaurado: verde de novo
  return mortos;
}
async function comportamentoDepoisDeAplicar(c) {
  await paraAntes(c);
  await aplicar(c);
  await comportamentoDepois(c);
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
    await semente(c);
    await provar(
      "controle: ANTES da migration o painel antigo (authenticated admin) grava notes",
      async () => {
        await paraAntes(c);
        await controleAntes(c);
      },
    );
    await provar(
      "DEPOIS: authenticated (admin e dona) e anon não atualizam notes; rastreio e service_role seguem; função definer grava",
      () => comportamentoDepoisDeAplicar(c),
    );
    await provar(
      "leitura, INSERT com notes, rastreio e função definer dão o mesmo resultado antes e depois, papel a papel",
      () => igualAntesEDepois(c),
    );
    await provar(
      "dado existente intacto (inclusive anotação antiga em notes); a ACL muda só na entrada de notes",
      () => efeito(c),
    );
    await provar(
      "aplicar 2x idêntico; rollback devolve a ACL de antes; reaplicar fecha de novo",
      () => idempotente(c),
    );
    await provar(
      "erro depois do REVOKE desfaz o REVOKE (sem meia mudança)",
      () => transacaoInterrompida(c),
    );
    await provar(
      "painel antigo no meio do salvamento: o apply não espera e fecha só notes",
      () => concorrencia(c, url),
    );
    await provar(
      "pré-voo recusa, sem escrever, a ACL que não é a de antes nem a de depois",
      () => preVoo(c),
    );
    await provar("pré-voo do rollback recusa estado que não reconhece", () =>
      preVooDoRollback(c),
    );
    await provar(
      "herança que não conta (WITH INHERIT FALSE, membro NOINHERIT): o apply segue e 51a/51b não reportam divergência",
      () => herancaQueNaoConta(c),
    );
    await provar(
      "conferência final aborta e desfaz quando o REVOKE não revoga (herança) e quando levaria o rastreio",
      async () => {
        await conferencia(c);
        await conferenciaDoRastreio(c);
      },
    );
    await provar("portão 51a/51b: catálogo real, negativo por objeto", () =>
      portao(c),
    );
    await provar("mutantes", async () => {
      mortos = await mutantes(c);
    });
    console.log(
      `\nnotes-do-pedido-fechada-viva: ${provas} provas ok; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Coluna notes do pedido fechada ao painel (PG17)",
      `${provas} provas com papéis reais, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("NOTES_DO_PEDIDO_FECHADA", e.stack || e.message));
