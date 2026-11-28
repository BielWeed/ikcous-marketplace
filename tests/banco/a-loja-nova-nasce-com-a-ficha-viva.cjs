"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os da migration 20261540000000, do rollback dela e
 * das consultas 191a/191b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261540000000_a_loja_nova_nasce_com_a_ficha.sql contra o Postgres EFÊMERO com as migrations aplicadas do zero
 * (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: loja recém-instalada ficava com public.store_config VAZIA (ninguém gravava a linha id = 1). Sem ela o porteiro (que lê
 * v_store_config com id = 1, como anon) responde 503 em todas as rotas, forma_de_pagamento_aceita recusa todo pedido e a identidade não acha a
 * ficha. A migration semeia a ficha (INSERT ... ON CONFLICT DO NOTHING) e deixa a MARCA no catálogo (COMMENT ON TABLE).
 *
 * O QUE SE PROVA:
 *   (a) no banco recém-montado pela fila: a ficha existe (com os defaults, dominio_publico NULL), a marca está lá, v_store_config devolve
 *       exatamente 1 linha para anon e authenticated (o porteiro e a identidade), forma_de_pagamento_aceita('pix') é true;
 *   (b) CONTROLE do defeito: sem a ficha, v_store_config devolve 0 linha e o pix é recusado; aplicar a migration cura os dois;
 *   (c) a linha que JÁ existia (IKCOUS/Savy, com dado da lojista) e uma linha de outro id ficam byte a byte com a migration aplicada 3x
 *       (LF, CRLF, LF); só o comentário muda (de NULL para a marca);
 *   (d) reaplicar 2x no estado da fila não muda catálogo nem linha;
 *   (e) rollback (2x) tira SÓ a marca e mantém a ficha byte a byte; reaplicar devolve a marca;
 *   (f) pré-voo recusa (B1_BASELINE_DIVERGENT) sem escrever: comentário alheio, tabela ausente, sem chave em id, coluna NOT NULL sem default;
 *       o rollback recusa comentário alheio;
 *   (g) transação: sem COMMIT escondido; tabela travada por outra conexão faz a migration desistir no lock_timeout de 5 s;
 *   (h) duas conexões reais aplicando ao mesmo tempo numa loja sem ficha: a segunda espera a primeira, não erra, e fica UMA ficha;
 *   (i) consultas 191a/191b EXECUTADAS (como authenticated) em três estados (loja nova antes, loja que já vende antes, depois) e com defeitos
 *       plantados; o informativo da 191b diz se a ficha já existia;
 *   (j) MUTANTES (sem o INSERT, ON CONFLICT que reescreve a linha, sem a marca): o comportamento cai pelo motivo certo.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-nova-nasce-com-a-ficha-viva.cjs
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

const NOME = "20261540000000_a_loja_nova_nasce_com_a_ficha.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A191 = "191a-conferir-a-loja-nova-nasce-com-a-ficha-aplicado";
const B191 = "191b-antes-a-loja-nova-nasce-com-a-ficha-ausente";
const MARCA = "ficha_da_loja_20261540000000";
const SEM_MARCA = "COMMENT ON TABLE public.store_config IS NULL";
const SEM_FICHA = "DELETE FROM public.store_config";

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1540_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` numa transação SEMPRE desfeita. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
/** Roda `sql` como `papel` (num savepoint desfeito); devolve as linhas (o erro sobe). */
async function como(c, papel, sql, params = []) {
  let linhas = null;
  const e = await tentar(c, async () => {
    await c.query(`SET LOCAL ROLE ${papel}`);
    linhas = (await c.query(sql, params)).rows;
  });
  if (e) throw e;
  return linhas;
}
async function comentario(c) {
  return (
    await c.query(
      "SELECT obj_description('public.store_config'::regclass, 'pg_class') AS d",
    )
  ).rows[0].d;
}
/** A ficha inteira (como o dono), ou null. */
async function ficha(c) {
  const r = await c.query(
    "SELECT to_jsonb(s) AS j FROM public.store_config s WHERE id = 1",
  );
  return r.rows[0]?.j ?? null;
}
/**
 * A ficha sem o que muda a cada INSERT (o carimbo da sequência e as datas) e sem o carimbo da 20261652000000
 * (entrega_confirmada_em e pagamento_confirmado_em): no banco sem a marca de instalação (supabase_migrations.ikcous_instalacao,
 * o caso da fila do CI) elas recebem a hora do apply, e um INSERT só com id as deixa NULL. A loja nova COM a marca (as duas
 * nascem NULL) é provada em a-loja-nova-confirma-entrega-e-pagamento-viva.cjs; aqui lojaNova() só confere que nascem juntas.
 */
const semCarimbo = (j) => {
  if (!j) return j;
  const {
    identity_revision: _r,
    created_at: _c,
    updated_at: _u,
    entrega_confirmada_em: _e,
    pagamento_confirmado_em: _p,
    ...resto
  } = j;
  return resto;
};
/** Todas as linhas da tabela (como o dono), para "nada mudou". */
async function linhas(c) {
  return (
    await c.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) AS h FROM public.store_config s`,
    )
  ).rows[0];
}
/** O catálogo de store_config (menos o comentário, que é a marca e tem prova própria). */
async function foto(c) {
  const r = await c.query(
    `SELECT c.oid::int AS oid, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' ||
                               coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY a.attnum)
               FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid) AS restricoes,
            (SELECT string_agg(t.tgname || '=' || pg_get_triggerdef(t.oid), ' | ' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS gatilhos,
            (SELECT string_agg(p.polname, ',' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
       FROM pg_class c WHERE c.oid = 'public.store_config'::regclass`,
  );
  return r.rows[0];
}
/** O que o porteiro e a identidade leem: v_store_config com id = 1, como anon e como authenticated. */
async function leituraPublica(c) {
  const sql = "SELECT id FROM public.v_store_config WHERE id = 1";
  return {
    anon: (await como(c, "anon", sql)).length,
    authenticated: (await como(c, "authenticated", sql)).length,
  };
}
async function aceita(c, metodo) {
  return (
    await c.query("SELECT public.forma_de_pagamento_aceita($1) AS ok", [metodo])
  ).rows[0].ok;
}
/** A ficha que um INSERT só com id produz HOJE (os defaults vivos), sem carimbo. */
async function fichaDeFabrica(c) {
  let j = null;
  const e = await tentar(c, async () => {
    await c.query(SEM_FICHA);
    await c.query("INSERT INTO public.store_config (id) VALUES (1)");
    j = await ficha(c);
  });
  if (e) throw e;
  return semCarimbo(j);
}
/** Estado de "loja que já vende" (IKCOUS/Savy antes do apply): ficha com dado da lojista, uma linha de outro id, comentário NULL. */
async function lojaQueJaVende(c) {
  await c.query(
    `UPDATE public.store_config SET store_name = 'Loja que ja vendia', primary_color = '#123456', formas_pagamento_entrega = '{pix}',
            free_shipping_min = 250, dominio_publico = 'loja-antiga.exemplo' WHERE id = 1`,
  );
  await c.query("INSERT INTO public.store_config (id) VALUES (2)");
  await c.query(SEM_MARCA);
}

// ---------------------------------------------------------------------------
// (a) o banco recém-montado pela fila
// ---------------------------------------------------------------------------
async function lojaNova(c) {
  assert.equal(await comentario(c), MARCA, "a marca está no catálogo");
  const j = await ficha(c);
  assert(j, "a ficha (store_config id = 1) existe no banco recém-montado");
  assert.equal(
    (await linhas(c)).n,
    1,
    "uma linha só: a ficha que a migration semeou",
  );
  assert.equal(j.dominio_publico, null, "dominio_publico fica NULL");
  assert.equal(j.pagamento_online, false);
  assert.equal(j.manutencao, false);
  assert(
    Number(j.identity_revision) > 0,
    "o gatilho branding_a5 carimbou a revisão",
  );
  // As confirmações da 20261652000000 nascem no MESMO apply: iguais e não nulas (banco sem a marca, now() do ADD COLUMN) ou as duas
  // NULL (loja nova com a marca). Com a 1652 desfeita as colunas não existem e as duas vêm undefined, o que conta como NULL.
  const entrega = j.entrega_confirmada_em;
  const pagamento = j.pagamento_confirmado_em;
  assert(
    (entrega == null && pagamento == null) ||
      (entrega != null && entrega === pagamento),
    `as confirmações nascem juntas: iguais e não nulas, ou as duas NULL (entrega=${entrega}, pagamento=${pagamento})`,
  );
  await desfeita(c, async () => {
    assert.deepEqual(
      semCarimbo(j),
      await fichaDeFabrica(c),
      "a ficha nasce só com os defaults",
    );
    assert.deepEqual(
      await leituraPublica(c),
      { anon: 1, authenticated: 1 },
      "porteiro e identidade: v_store_config devolve exatamente 1 linha",
    );
  });
  assert.equal(await aceita(c, "pix"), true, "pix aceito");
  assert.equal(await aceita(c, "card"), true);
  assert.equal(await aceita(c, "cash"), true);
  assert.equal(
    await aceita(c, "online"),
    false,
    "pagamento pelo app nasce desligado",
  );
  return semCarimbo(j);
}

// ---------------------------------------------------------------------------
// (b) o defeito, e a cura
// ---------------------------------------------------------------------------
async function defeitoECura(c, sql, fabrica) {
  await desfeita(c, async () => {
    await c.query(SEM_FICHA);
    await c.query(SEM_MARCA);
    assert.deepEqual(
      await leituraPublica(c),
      { anon: 0, authenticated: 0 },
      "CONTROLE: sem a ficha o porteiro não acha nada (503)",
    );
    assert.equal(
      await aceita(c, "pix"),
      false,
      "CONTROLE: sem a ficha o pix é recusado",
    );
    await c.query(sql);
    assert.deepEqual(
      semCarimbo(await ficha(c)),
      fabrica,
      "a loja nova ganha a ficha, só com os defaults",
    );
    assert.deepEqual(
      await leituraPublica(c),
      { anon: 1, authenticated: 1 },
      "depois: v_store_config devolve 1 linha",
    );
    assert.equal(await aceita(c, "pix"), true, "depois: pix aceito");
    assert.equal(await comentario(c), MARCA, "a marca fica no catálogo");
  });
}

// ---------------------------------------------------------------------------
// (c) a linha que já existia + (d) reaplicar
// ---------------------------------------------------------------------------
async function linhaQueJaExistia(c, sql) {
  await desfeita(c, async () => {
    await lojaQueJaVende(c);
    const antes = await ficha(c);
    const todas = await linhas(c);
    const catalogo = await foto(c);
    await c.query(sql);
    await c.query(sql.replace(/\n/g, "\r\n"));
    await c.query(sql);
    assert.deepEqual(
      await ficha(c),
      antes,
      "a linha que já existia fica byte a byte (inclusive revisão e datas)",
    );
    assert.deepEqual(
      await linhas(c),
      todas,
      "nenhuma linha nasce nem muda (a de outro id também)",
    );
    assert.deepEqual(
      await foto(c),
      catalogo,
      "catálogo intacto (OID, ACL, colunas, restrições, gatilhos, políticas)",
    );
    assert.equal(
      await comentario(c),
      MARCA,
      "só o comentário muda: de NULL para a marca",
    );
  });
}
async function reaplicar(c) {
  await desfeita(c, async () => {
    const catalogo = await foto(c);
    const todas = await linhas(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    assert.deepEqual(
      await foto(c),
      catalogo,
      "reaplicar 2x não muda o catálogo",
    );
    assert.deepEqual(await linhas(c), todas, "reaplicar 2x não muda a linha");
    assert.equal(await comentario(c), MARCA);
  });
}

// ---------------------------------------------------------------------------
// (e) rollback
// ---------------------------------------------------------------------------
async function rollback(c) {
  await desfeita(c, async () => {
    await lojaQueJaVende(c);
    await c.query(MIGRATION);
    const catalogo = await foto(c);
    const todas = await linhas(c);
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      assert.equal(await comentario(c), null, `rollback ${vez}: a marca sai`);
      assert.deepEqual(
        await linhas(c),
        todas,
        `rollback ${vez}: a ficha (e toda linha) FICA`,
      );
      assert.deepEqual(
        await foto(c),
        catalogo,
        `rollback ${vez}: nada mais muda`,
      );
    }
    await c.query(MIGRATION);
    assert.equal(await comentario(c), MARCA, "reaplicar devolve a marca");
    assert.deepEqual(await linhas(c), todas);
  });
}

// ---------------------------------------------------------------------------
// (f) pré-voo
// ---------------------------------------------------------------------------
const SABOTAGENS = [
  [
    "comentário alheio na tabela",
    ["COMMENT ON TABLE public.store_config IS 'comentario de outra pessoa'"],
  ],
  [
    "tabela ausente",
    ["ALTER TABLE public.store_config RENAME TO store_config_fora"],
  ],
  [
    "sem chave em id",
    ["ALTER TABLE public.store_config DROP CONSTRAINT store_config_pkey"],
  ],
  [
    "coluna NOT NULL sem default",
    [
      SEM_FICHA,
      "ALTER TABLE public.store_config ADD COLUMN intrusa int NOT NULL",
    ],
  ],
];
async function preVoo(c) {
  await desfeita(c, async () => {
    const catalogo = await foto(c);
    const todas = await linhas(c);
    for (const [nome, sabotagem] of SABOTAGENS) {
      const e = await tentar(c, async () => {
        for (const s of sabotagem) await c.query(s);
        await c.query(MIGRATION);
      });
      assert.match(
        e?.message ?? "(aplicou)",
        /B1_BASELINE_DIVERGENT/,
        `pré-voo deveria recusar: ${nome}`,
      );
    }
    assert.equal(
      await tentar(c, () => c.query(MIGRATION)),
      null,
      "controle: sem sabotagem, a mesma base aplica",
    );
    const r = await tentar(c, async () => {
      await c.query(SABOTAGENS[0][1][0]);
      await c.query(ROLLBACK);
    });
    assert.match(
      r?.message ?? "(desfez)",
      /B1_BASELINE_DIVERGENT/,
      "o rollback recusa comentário alheio",
    );
    assert.deepEqual(await foto(c), catalogo, "nenhuma recusa escreveu nada");
    assert.deepEqual(await linhas(c), todas);
    assert.equal(await comentario(c), MARCA);
  });
  return SABOTAGENS.length;
}

// ---------------------------------------------------------------------------
// (g) transação
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  await desfeita(c, async () => {
    await c.query(SEM_FICHA);
    await c.query(SEM_MARCA);
    await c.query("SAVEPOINT antes_da_migration");
    await c.query(MIGRATION);
    assert(await ficha(c));
    // Um COMMIT escondido na migration faria este ROLLBACK TO falhar (o savepoint some com a transação).
    await c.query("ROLLBACK TO SAVEPOINT antes_da_migration");
    assert.equal(
      await ficha(c),
      null,
      "desfazer a transação leva a ficha: não há COMMIT dentro da migration",
    );
    assert.equal(await comentario(c), null, "e a marca");
  });
  const catalogo = await foto(c);
  const todas = await linhas(c);
  const outro = new Client({ connectionString: url });
  await outro.connect();
  try {
    await outro.query("BEGIN");
    await outro.query("LOCK TABLE public.store_config IN SHARE MODE");
    const t0 = Date.now();
    let e = null;
    await c.query("BEGIN");
    try {
      await c.query(MIGRATION);
    } catch (err) {
      e = err;
    } finally {
      await c.query("ROLLBACK");
    }
    const ms = Date.now() - t0;
    assert.equal(e?.code, "55P03", "tabela travada: lock_timeout");
    assert(
      ms >= 4500 && ms < 20000,
      `desistiu em ${ms} ms (lock_timeout de 5 s)`,
    );
    await outro.query("ROLLBACK");
  } finally {
    await outro.end();
  }
  assert.deepEqual(await foto(c), catalogo, "a desistência não escreveu nada");
  assert.deepEqual(await linhas(c), todas);
}

// ---------------------------------------------------------------------------
// (h) duas conexões reais
// ---------------------------------------------------------------------------
async function concorrencia(c, url, fabrica) {
  await c.query("BEGIN");
  await c.query(SEM_FICHA);
  await c.query(SEM_MARCA);
  await c.query("COMMIT"); // clone exclusivo: a loja volta a ser "recém-instalada sem ficha"
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  try {
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await a.query("BEGIN");
    await a.query(MIGRATION);
    await b.query("BEGIN");
    const segunda = b.query(MIGRATION).then(
      () => null,
      (e) => e,
    );
    let esperando = false;
    for (let i = 0; i < 30 && !esperando; i++) {
      await new Promise((r) => setTimeout(r, 100));
      esperando =
        (
          await c.query(
            "SELECT wait_event_type = 'Lock' AS x FROM pg_stat_activity WHERE pid = $1",
            [pidB],
          )
        ).rows[0]?.x === true;
    }
    assert.equal(esperando, true, "a segunda aplicação espera a primeira");
    await a.query("COMMIT");
    const erro = await segunda;
    assert.equal(erro, null, `a segunda aplicação não erra (${erro?.message})`);
    await b.query("COMMIT");
    assert.equal((await linhas(c)).n, 1, "fica UMA ficha");
    assert.deepEqual(semCarimbo(await ficha(c)), fabrica);
    assert.equal(await comentario(c), MARCA);
  } finally {
    await a.end();
    await b.end();
    if (!(await ficha(c)) || (await comentario(c)) !== MARCA) {
      await c.query("BEGIN");
      await c.query(MIGRATION);
      await c.query("COMMIT");
    }
  }
}

// ---------------------------------------------------------------------------
// (i) as consultas 191a/191b, EXECUTADAS
// ---------------------------------------------------------------------------
async function consulta(c, nome) {
  const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
  assert.equal(CONF.contarStatements(sql), 1);
  await c.query("SAVEPOINT leitura_191");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const rows = (await c.query(sql)).rows;
    assert.equal(
      CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
      null,
      `${nome}: rol fechado`,
    );
    return {
      reprovados: rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item)
        .sort(),
      informativo:
        rows.find((r) => r.item.startsWith("informativo:"))?.vivo ?? null,
    };
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT leitura_191");
  }
}
const item = (rol, inicio) => {
  const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
    i.startsWith(inicio),
  );
  assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
  return x[0];
};
async function portao(c) {
  const MARCA_A = item(A191, "store_config: o comentario");
  const FICHA_A = item(A191, "store_config: a ficha");
  const LEITURA_A = item(A191, "v_store_config");
  const CHAVE_B = item(B191, "store_config: a tabela existe");
  const NOTNULL_B = item(B191, "store_config: toda coluna");
  const COMENT_B = item(B191, "store_config: o comentario");
  let defeitos = 0;
  await desfeita(c, async () => {
    // Depois da migration (o estado da fila).
    assert.deepEqual(
      await consulta(c, A191),
      { reprovados: [], informativo: null },
      "191a positiva depois",
    );
    assert.deepEqual(
      await consulta(c, B191),
      { reprovados: [COMENT_B], informativo: "sim" },
      "191b reprova só o comentário depois",
    );
    // Loja que já vende, antes do apply: a ficha existe e a marca não. É o estado que PARARIA o portão sem a marca.
    await c.query("SAVEPOINT ja_vende");
    await lojaQueJaVende(c);
    assert.deepEqual(
      await consulta(c, A191),
      { reprovados: [MARCA_A], informativo: null },
      "loja que já vende, antes: 191a NEGATIVA (só a marca falta)",
    );
    assert.deepEqual(
      await consulta(c, B191),
      { reprovados: [], informativo: "sim" },
      "loja que já vende, antes: 191b POSITIVA e o informativo diz que a ficha já existe",
    );
    await c.query("ROLLBACK TO SAVEPOINT ja_vende");
    // Loja recém-instalada sem esta migration: nem ficha nem marca.
    await c.query("SAVEPOINT nova");
    await c.query(SEM_FICHA);
    await c.query(SEM_MARCA);
    assert.deepEqual(
      await consulta(c, A191),
      { reprovados: [FICHA_A, MARCA_A, LEITURA_A].sort(), informativo: null },
      "loja nova, antes: 191a reprova marca, ficha e leitura pública",
    );
    assert.deepEqual(
      await consulta(c, B191),
      { reprovados: [], informativo: "nao" },
      "loja nova, antes: 191b POSITIVA e o informativo diz que a ficha não existe",
    );
    // Defeitos plantados na base de antes.
    for (const [sabotagem, esperados] of [
      [
        "COMMENT ON TABLE public.store_config IS 'comentario de outra pessoa'",
        [COMENT_B],
      ],
      [
        "ALTER TABLE public.store_config DROP CONSTRAINT store_config_pkey",
        [CHAVE_B],
      ],
      [
        "ALTER TABLE public.store_config ADD COLUMN intrusa int NOT NULL",
        [NOTNULL_B],
      ],
    ]) {
      const e = await tentar(c, async () => {
        await c.query(sabotagem);
        assert.deepEqual(
          (await consulta(c, B191)).reprovados,
          esperados.sort(),
          `191b com "${sabotagem}" reprova exatamente o item certo`,
        );
      });
      if (e) throw e;
      defeitos++;
    }
    await c.query("ROLLBACK TO SAVEPOINT nova");
    // Defeitos plantados no estado de depois.
    for (const [sabotagem, esperados] of [
      [
        "COMMENT ON TABLE public.store_config IS 'comentario de outra pessoa'",
        [MARCA_A],
      ],
      [SEM_FICHA, [FICHA_A, LEITURA_A]],
    ]) {
      const e = await tentar(c, async () => {
        await c.query(sabotagem);
        assert.deepEqual(
          (await consulta(c, A191)).reprovados,
          esperados.sort(),
          `191a com "${sabotagem}" reprova exatamente o item certo`,
        );
      });
      if (e) throw e;
      defeitos++;
    }
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
// (j) MUTANTES: o mesmo comportamento tem de cair com cada defeito
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261540000000\$[\s\S]*?END \$preflight_20261540000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261540000000\$[\s\S]*?END \$posvoo_20261540000000\$;\n?/,
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
const INSERT_DA_FICHA =
  "\nINSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;\n";
const A_MARCA = `\nCOMMENT ON TABLE public.store_config IS '${MARCA}';\n`;
const MUTANTES = [
  [
    "sem o INSERT da ficha",
    (s) => trocar(s, INSERT_DA_FICHA, "\n"),
    "a loja nova ganha a ficha",
    true,
  ],
  [
    "ON CONFLICT que reescreve a linha que já existia",
    (s) =>
      trocar(
        s,
        INSERT_DA_FICHA,
        "\nINSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET store_name = NULL;\n",
      ),
    "a linha que já existia fica byte a byte",
    false,
  ],
  [
    "sem a marca",
    (s) => trocar(s, A_MARCA, "\n"),
    "a marca fica no catálogo",
    true,
  ],
];
async function comportamento(c, sql, fabrica) {
  await defeitoECura(c, sql, fabrica);
  await linhaQueJaExistia(c, sql);
}
async function mutantes(c, fabrica) {
  await comportamento(c, SEM_CONFERENCIA(MIGRATION), fabrica); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento, posVooPega] of MUTANTES) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    let motivo = null;
    try {
      await comportamento(c, alterada, fabrica);
    } catch (e) {
      motivo = e;
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
    if (posVooPega) {
      // O mesmo defeito COM as conferências, numa loja sem ficha nem marca: o pós-voo recusa sem deixar nada.
      await desfeita(c, async () => {
        await c.query(SEM_FICHA);
        await c.query(SEM_MARCA);
        const e = await tentar(c, () => c.query(muta(MIGRATION)));
        assert.match(
          e?.message ?? "(aplicou)",
          /B2_POSVOO_DIVERGENTE/,
          `pós-voo deveria recusar: ${nome}`,
        );
      });
    }
    mortos++;
    console.log(
      `    mutante morto: ${nome}: ${motivo.message.split("\n")[0].slice(0, 150)}`,
    );
  }
  return mortos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    const fabrica = await provar(
      "banco recém-montado pela fila: a ficha existe com os defaults, a marca está lá, v_store_config devolve 1 linha, pix aceito",
      () => lojaNova(c),
    );
    await provar(
      "CONTROLE do defeito (sem ficha: 0 linha e pix recusado) e a cura",
      () => defeitoECura(c, MIGRATION, fabrica),
    );
    await provar(
      "linha que já existia (e a de outro id) fica byte a byte com a migration 3x (LF, CRLF, LF); só o comentário muda",
      () => linhaQueJaExistia(c, MIGRATION),
    );
    await provar("reaplicar 2x no estado da fila: nada muda", () =>
      reaplicar(c),
    );
    await provar(
      "rollback (2x) tira só a marca e mantém a ficha; reaplicar devolve a marca",
      () => rollback(c),
    );
    const recusas = await provar(
      "pré-voo recusa estado divergente sem escrever; o rollback também",
      () => preVoo(c),
    );
    await provar(
      "transação: sem COMMIT escondido; tabela travada faz desistir em 5 s",
      () => transacao(c, url),
    );
    await provar(
      "duas conexões reais numa loja sem ficha: a segunda espera e fica UMA ficha",
      () => concorrencia(c, url, fabrica),
    );
    const defeitos = await provar(
      "consultas 191a/191b: três estados, informativo e defeitos plantados",
      () => portao(c),
    );
    const mortos = await provar("mutantes da migration", () =>
      mutantes(c, fabrica),
    );
    console.log(
      `\na-loja-nova-nasce-com-a-ficha-viva: ${provas} provas ok; ${recusas} recusas do pré-voo; ${defeitos} defeitos plantados nas consultas; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "A loja nova nasce com a ficha (PG17)",
      `${provas} provas, ${defeitos} defeitos plantados nas consultas 191a/191b, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("A_LOJA_NOVA_NASCE_COM_A_FICHA", e.stack || e.message),
);
