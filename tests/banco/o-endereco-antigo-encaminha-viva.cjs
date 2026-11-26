"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos caminhos de arquivo são os da migration 20261570 e dos rollbacks dela, dentro do repositório. */
/**
 * PROVA VIVA da migration 20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: quando uma loja troca de endereço, o endereço antigo (link no Instagram, favorito, app instalado) fica para sempre em
 * "manutenção", porque a caderneta só conhece o endereço principal. A tabela nova public.frota_enderecos_que_encaminham guarda os
 * endereços que encaminham para a loja (a loja, não o destino: o 308 sempre lê o endereço atual).
 *
 * O QUE SE PROVA:
 *   (a) a tabela: existe, fechada (RLS ligada, nenhuma política, nenhum privilégio para PUBLIC, anon, authenticated nem service_role,
 *       nem em coluna); o gatilho recusa host que já é o endereço principal de alguma loja; o CHECK de formato do host e o de motivo;
 *       apagar a loja apaga os endereços dela;
 *   (b) reaplicar (LF, CRLF, LF) não muda catálogo nem linha;
 *   (c) o arquivo não tem BEGIN/COMMIT de nível superior, e aplicar dentro de uma transação desfeita não deixa nada;
 *   (d) o pré-voo recusa sem a 20261490 (e com a tabela de outra forma), sem escrever; o destrutivo exige a confirmação.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-endereco-antigo-encaminha-viva.cjs
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
const {
  desfazerChaveSemBcryptNaTransacao,
} = require("./a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs");
const {
  ENDERECO_ANTIGO,
  desfazerEnderecoAntigoNaTransacao,
} = require("./o-endereco-antigo-encaminha-posterior.cjs");

const NOME = ENDERECO_ANTIGO.nome;
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);

const TABELA = "public.frota_enderecos_que_encaminham";
const PAPEIS = ["anon", "authenticated", "service_role"];
const LOJA_A = {
  id: "l1570-a",
  nome: "Loja A da prova 1570",
  dominio_publico: "loja-a.l1570.teste",
  project_ref: "aaaaaaaaaaaaaaaa1570",
};
const LOJA_B = {
  id: "l1570-b",
  nome: "Loja B da prova 1570",
  dominio_publico: "loja-b.l1570.teste",
  project_ref: "bbbbbbbbbbbbbbbb1570",
};

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1570_${++contaSavepoint}`;
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
async function semente(c) {
  for (const l of [LOJA_A, LOJA_B])
    await c.query(
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (id) DO NOTHING",
      [
        l.id,
        l.nome,
        l.dominio_publico,
        l.project_ref,
        `https://${l.project_ref}.supabase.co`,
        `pk_${l.id}`,
      ],
    );
}
const encaminhar = (c, host, lojaId, motivo = "antigo") =>
  c.query(`INSERT INTO ${TABELA} (host, loja_id, motivo) VALUES ($1, $2, $3)`, [
    host,
    lojaId,
    motivo,
  ]);
const enderecos = async (c) =>
  (
    await c.query(
      `SELECT host, loja_id, motivo, quem FROM ${TABELA} ORDER BY host`,
    )
  ).rows;
const existe = async (c) =>
  (await c.query("SELECT to_regclass($1) IS NOT NULL AS sim", [TABELA])).rows[0]
    .sim;
/** O catálogo do que a migration cria e do que ela não pode tocar (frota_lojas). */
async function foto(c) {
  const r = await c.query(
    `SELECT c.relname, c.oid::int AS oid, c.relowner::int AS dono, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid) AS restricoes,
            (SELECT string_agg(t.tgname || ':' || t.tgfoid::int || ':' || t.tgtype || ':' || t.tgenabled::text, ',' ORDER BY t.tgname)
               FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS gatilhos,
            (SELECT string_agg(i.indexrelid::int::text, ',' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid = c.oid) AS indices,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
       FROM pg_class c WHERE c.oid IN ('public.frota_lojas'::regclass, to_regclass('${TABELA}')) ORDER BY 1`,
  );
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono,
            p.prosecdef, p.provolatile, p.proconfig::text AS config
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('frota_enderecos_que_encaminham_nao_e_principal', 'resolver_encaminhamento', 'frota_trocar_dominio') ORDER BY 1`,
  );
  return { tb: r.rows, fn: fn.rows };
}

// ---------------------------------------------------------------------------
// (a) a tabela
// ---------------------------------------------------------------------------
async function tabela(c) {
  assert.equal(await existe(c), true, "a tabela existe");
  const cat = (
    await c.query(
      "SELECT relrowsecurity, (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS politicas FROM pg_class c WHERE c.oid = $1::regclass",
      [TABELA],
    )
  ).rows[0];
  assert.deepEqual(
    cat,
    { relrowsecurity: true, politicas: 0 },
    "RLS ligada e nenhuma política",
  );
  // Nenhum privilégio para PUBLIC (o grantee 0 do ACL) nem para os três papéis da API, na tabela e em coluna.
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = $1::regclass AND g.grantee <> c.relowner",
        [TABELA],
      )
    ).rows[0].n,
    0,
    "a ACL da tabela é só do dono",
  );
  for (const papel of PAPEIS) {
    for (const p of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ])
      assert.equal(
        (
          await c.query(
            "SELECT has_table_privilege($1::name, $2::regclass, $3::text) AS x",
            [papel, TABELA, p],
          )
        ).rows[0].x,
        false,
        `${papel} sem ${p} na tabela`,
      );
    assert.equal(
      (
        await c.query(
          "SELECT has_any_column_privilege($1::name, $2::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') AS x",
          [papel, TABELA],
        )
      ).rows[0].x,
      false,
      `${papel} sem privilégio em coluna`,
    );
  }
  // Como anon (o PostgREST): nem ler.
  const e = await tentar(c, async () => {
    await c.query("SET LOCAL ROLE anon");
    await c.query(`SELECT * FROM ${TABELA}`);
  });
  assert.equal(e?.code, "42501", "anon não lê a tabela");

  await semente(c);
  // O caminho feliz: um endereço antigo e um www da loja A; quem = session_user.
  await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id, "antigo");
  await encaminhar(c, "www.loja-a.l1570.teste", LOJA_A.id, "www");
  await encaminhar(c, "novo-a.l1570.teste", LOJA_A.id, "novo-em-preparo");
  const quem = (await c.query("SELECT session_user::text AS q")).rows[0].q;
  assert.deepEqual(
    await enderecos(c),
    [
      {
        host: "antigo-a.l1570.teste",
        loja_id: LOJA_A.id,
        motivo: "antigo",
        quem,
      },
      {
        host: "novo-a.l1570.teste",
        loja_id: LOJA_A.id,
        motivo: "novo-em-preparo",
        quem,
      },
      {
        host: "www.loja-a.l1570.teste",
        loja_id: LOJA_A.id,
        motivo: "www",
        quem,
      },
    ],
    "três endereços gravados, quem = session_user",
  );

  // O gatilho: o endereço principal de QUALQUER loja não encaminha (nem como alias da própria loja nem de outra).
  for (const [rotulo, host, loja] of [
    ["o principal da própria loja", LOJA_A.dominio_publico, LOJA_A.id],
    ["o principal de outra loja", LOJA_B.dominio_publico, LOJA_A.id],
  ]) {
    const erro = await tentar(c, () => encaminhar(c, host, loja));
    assert.match(
      erro?.message ?? "(gravou)",
      /FROTA_ENDERECO_JA_E_PRINCIPAL/,
      `o gatilho recusa ${rotulo}`,
    );
  }
  // ... também quando o host muda por UPDATE.
  const erroUpdate = await tentar(c, () =>
    c.query(`UPDATE ${TABELA} SET host = $1 WHERE host = $2`, [
      LOJA_B.dominio_publico,
      "antigo-a.l1570.teste",
    ]),
  );
  assert.match(
    erroUpdate?.message ?? "(gravou)",
    /FROTA_ENDERECO_JA_E_PRINCIPAL/,
    "o gatilho recusa UPDATE para o principal de outra loja",
  );
  // Controle: UPDATE de outra coluna não esbarra no gatilho.
  assert.equal(
    await tentar(c, () =>
      c.query(`UPDATE ${TABELA} SET motivo = 'antigo' WHERE host = $1`, [
        "novo-a.l1570.teste",
      ]),
    ),
    null,
    "UPDATE do motivo passa",
  );

  // O CHECK de formato (o mesmo de frota_lojas.dominio_publico) e o de motivo.
  for (const host of [
    "Maiuscula.l1570.teste",
    "sem-ponto",
    "com espaco.l1570.teste",
    "-hifen.l1570.teste",
    "porta.l1570.teste:8080",
    "barra.l1570.teste/x",
    "",
  ]) {
    const erro = await tentar(c, () => encaminhar(c, host, LOJA_B.id));
    assert.equal(erro?.code, "23514", `o CHECK de formato recusa "${host}"`);
    assert.match(erro.message, /frota_enderecos_que_encaminham_host_check/);
  }
  for (const motivo of ["", "Antigo", "principal", null]) {
    const erro = await tentar(c, () =>
      encaminhar(c, "motivo.l1570.teste", LOJA_B.id, motivo),
    );
    assert.equal(
      erro?.code,
      motivo === null ? "23502" : "23514",
      `motivo ${JSON.stringify(motivo)} recusado`,
    );
  }
  // Host repetido (a chave) e loja que não existe.
  assert.equal(
    (await tentar(c, () => encaminhar(c, "antigo-a.l1570.teste", LOJA_B.id)))
      ?.code,
    "23505",
    "o mesmo host não encaminha para duas lojas",
  );
  assert.equal(
    (await tentar(c, () => encaminhar(c, "orfao.l1570.teste", "nao-existe")))
      ?.code,
    "23503",
    "endereço de loja que não existe é recusado",
  );

  // Apagar a loja apaga os endereços dela (e só os dela).
  await encaminhar(c, "antigo-b.l1570.teste", LOJA_B.id);
  await c.query("DELETE FROM public.frota_lojas WHERE id = $1", [LOJA_A.id]);
  assert.deepEqual(
    (await enderecos(c)).map((r) => [r.host, r.loja_id]),
    [["antigo-b.l1570.teste", LOJA_B.id]],
    "apagar a loja A apaga os endereços dela; os da B ficam",
  );
}

// ---------------------------------------------------------------------------
// (b) reaplicar
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id);
    const antes = await foto(c);
    const linhas = await enderecos(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antes,
      "reaplicar (LF, CRLF, LF) não muda tabela, gatilho, função nem frota_lojas",
    );
    assert.deepEqual(await enderecos(c), linhas, "reaplicar não toca linha");
  });
}

// ---------------------------------------------------------------------------
// (c) transação
// ---------------------------------------------------------------------------
async function transacao(c) {
  // O texto: nenhum BEGIN/COMMIT/ROLLBACK/END/START TRANSACTION de nível superior. Fora os comentários e os corpos entre $tag$ (o
  // BEGIN/END de um bloco DO ou de uma função é plpgsql, não controle de transação), nenhuma dessas palavras pode sobrar.
  const nivelSuperior = (sql) =>
    sql
      .replace(/--[^\n]*/g, " ")
      .replace(/\$([A-Za-z_0-9]*)\$[\s\S]*?\$\1\$/g, " ");
  for (const [rotulo, sql] of [
    ["migration", MIGRATION],
    ["destrutivo", DESTRUTIVO],
  ])
    assert.equal(
      /\b(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)\b/i.test(
        nivelSuperior(sql),
      ),
      false,
      `${rotulo} sem BEGIN/COMMIT de nível superior`,
    );
  // Controle do detector: um COMMIT de nível superior plantado é visto.
  assert.equal(
    /\b(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)\b/i.test(
      nivelSuperior(`${MIGRATION}\nCOMMIT;\n`),
    ),
    true,
    "controle: o detector vê um COMMIT plantado",
  );
  // O comportamento: aplicar numa transação desfeita, a partir da base de antes, não deixa nada.
  await desfeita(c, async () => {
    await desfazerEnderecoAntigoNaTransacao(c);
    await c.query("SAVEPOINT antes_1570");
    const antes = await foto(c);
    await c.query(MIGRATION);
    assert.equal(await existe(c), true, "a migration criou a tabela");
    await c.query("ROLLBACK TO SAVEPOINT antes_1570");
    assert.deepEqual(
      await foto(c),
      antes,
      "aplicar e desfazer não deixa nada: não há COMMIT dentro da migration",
    );
  });
}

// ---------------------------------------------------------------------------
// (d) pré-voo e destrutivo
// ---------------------------------------------------------------------------
async function preVoo(c) {
  await desfeita(c, async () => {
    // A base de antes desta migration.
    assert.equal(
      await desfazerEnderecoAntigoNaTransacao(c),
      true,
      "a migration estava no ar",
    );
    assert.equal(await existe(c), false, "o destrutivo tirou a tabela");
    const base = await foto(c);
    const sabotagens = [
      [
        "a 20261490 ausente (rollback comum e destrutivo dela)",
        async () => {
          assert.equal(await desfazerChaveSemBcryptNaTransacao(c), true);
        },
      ],
      [
        "a tabela já existe com outra forma",
        () =>
          c.query(
            `CREATE TABLE ${TABELA} (host text PRIMARY KEY, loja_id text, motivo text, criado_em timestamptz, quem text)`,
          ),
      ],
      [
        "a tabela já existe aberta ao anon",
        async () => {
          await c.query(MIGRATION);
          await c.query(`GRANT SELECT ON ${TABELA} TO anon`);
        },
      ],
      [
        "a função do gatilho existe com outro corpo",
        () =>
          c.query(
            "CREATE FUNCTION public.frota_enderecos_que_encaminham_nao_e_principal() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RETURN NEW; END $f$",
          ),
      ],
      [
        "frota_lojas ausente",
        () => c.query("DROP TABLE public.frota_lojas CASCADE"),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      const e = await tentar(c, async () => {
        await sabotar();
        await c.query(MIGRATION);
      });
      assert.match(
        e?.message ?? "(aplicou)",
        /B1_BASELINE_DIVERGENT/,
        `pré-voo deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base, "nenhuma recusa escreveu nada");
    assert.equal(
      await tentar(c, () => c.query(MIGRATION)),
      null,
      "controle: sem sabotagem, a mesma base aplica",
    );
  });
  // O destrutivo: sem a confirmação recusa; com a tabela com linha recusa sem a segunda confirmação; com as duas apaga, 2x.
  await desfeita(c, async () => {
    await semente(c);
    await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id);
    let e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "(apagou)",
      /ENDERECOS_QUE_ENCAMINHAM_SO_COM_O_DONO/,
      "destrutivo sem confirmação",
    );
    e = await tentar(c, async () => {
      await c.query(
        "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
      );
      await c.query(DESTRUTIVO);
    });
    assert.match(
      e?.message ?? "(apagou)",
      /CADERNETA_SEMEADA/,
      "destrutivo com endereço gravado e sem a confirmação da caderneta",
    );
    assert.equal((await enderecos(c)).length, 1, "a recusa não apagou nada");
    await c.query(
      "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
    );
    await c.query("SET LOCAL ikcous.apagar_caderneta = 'sim'");
    await c.query(DESTRUTIVO);
    await c.query(DESTRUTIVO);
    assert.equal(await existe(c), false, "o destrutivo tira a tabela");
    assert.equal(
      (await foto(c)).fn.length,
      0,
      "o destrutivo tira a função do gatilho",
    );
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.frota_lojas"))
        .rows[0].n >= 2,
      true,
      "as lojas ficam",
    );
    await c.query(MIGRATION);
    assert.equal(await existe(c), true, "reaplicar depois do destrutivo");
    assert.deepEqual(await enderecos(c), [], "a tabela recomeça vazia");
  });
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
    await provar(
      "a tabela: fechada, gatilho do principal, CHECK de host e motivo, apagar a loja apaga os endereços",
      () => desfeita(c, () => tabela(c)),
    );
    await provar("reaplicar (LF, CRLF, LF) não muda nada", () => reaplicar(c));
    await provar(
      "sem BEGIN/COMMIT; aplicar numa transação desfeita não deixa nada",
      () => transacao(c),
    );
    await provar(
      "pré-voo recusa sem a 20261490 e com objeto de outra forma, sem escrever; destrutivo com as confirmações",
      () => preVoo(c),
    );
    console.log(`\no-endereco-antigo-encaminha-viva: ${provas} provas ok`);
    anexarAoSummary(
      "O endereço antigo encaminha para o novo (PG17)",
      `${provas} provas.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("O_ENDERECO_ANTIGO_ENCAMINHA", e.stack || e.message),
);
