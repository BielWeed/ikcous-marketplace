"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os da migration 20261500000000, dos dois
 * rollbacks dela e das consultas 187a/187b dentro do repositório. */
/**
 * PROVA VIVA da migration 20261500000000_a_loja_registra_a_saude_da_reconciliacao.sql contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: sem os segredos do Vault a reconciliação de pagamentos nunca roda, e ninguém de fora sabia. Agora a edge grava um batimento
 * (public.saude_da_reconciliacao, linha única) pela porta saude_da_reconciliacao_registrar (só service_role) e quem confere lê pela
 * saude_da_loja() (anon e authenticated), com a idade calculada no banco e sem nenhuma contagem de pagamento.
 *
 * O QUE SE PROVA (o service_role ganha BYPASSRLS só dentro de cada transação, como no Supabase de verdade):
 *   (a) comportamento: anon e authenticated não executam a porta; service_role não executa a leitura; ninguém de aplicação lê nem escreve a
 *       tabela (42501 mesmo com BYPASSRLS); tabela vazia = tudo nulo; a 1a rodada ruim cria a linha com contador 1 e sem saudável; a ruim
 *       soma 1 e não mexe em ultima_saudavel_em; a boa zera o contador e anda ultima_saudavel_em; etapas repetidas viram uma, na ordem fixa;
 *       a idade sai do relógio do banco; 6 recusas (22023) sem gravar;
 *   (b) linha que já existia + reaplicar 2x (LF e CRLF): nada muda (OID, ACL, corpo, linha);
 *   (c) rollback comum (2x) tira as duas funções e mantém tabela e linha; destrutivo só com APAGAR e só depois do comum; reaplicar volta;
 *   (d) pré-voo recusa estado divergente (B1_BASELINE_DIVERGENT) sem escrever; os rollbacks também;
 *   (e) duas conexões reais: a segunda rodada espera a linha da primeira e o contador soma 2 (nenhuma rodada se perde);
 *   (f) transação: sem COMMIT escondido; DDL aberta na tabela faz a reaplicação desistir no lock_timeout de 5 s;
 *   (g) consultas 187a/187b EXECUTADAS no catálogo real (como authenticated), com defeitos plantados;
 *   (h) MUTANTES (GRANT da porta ao anon, contador sem zerar, ultima_saudavel_em andando na rodada ruim): o comportamento cai pelo motivo
 *       certo, e o pós-voo de cada um recusa sozinho.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-registra-a-saude-da-reconciliacao-viva.cjs
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

const NOME = "20261500000000_a_loja_registra_a_saude_da_reconciliacao.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A187 = "187a-conferir-a-saude-da-reconciliacao-aplicado";
const B187 = "187b-antes-a-saude-da-reconciliacao-ausente";

const TAB = "public.saude_da_reconciliacao";
const REGISTRAR = "public.saude_da_reconciliacao_registrar(boolean, text[])";
const SAUDE = "public.saude_da_loja()";
const SQL_REGISTRAR =
  "SELECT public.saude_da_reconciliacao_registrar($1::boolean, $2::text[])";
const SQL_SAUDE = "SELECT public.saude_da_loja() AS s";
const CONFIRMAR_APAGAR =
  "SET LOCAL app.confirmo_apagar_saude_da_reconciliacao = 'APAGAR'";
const CHAVES = [
  "degradado",
  "etapas_com_falha",
  "idade_rodada_s",
  "idade_saudavel_s",
  "medidor",
  "rodadas_degradadas_seguidas",
  "ultima_rodada_em",
  "ultima_saudavel_em",
];

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1500_${++contaSavepoint}`;
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
/** Roda `fn` numa transação SEMPRE desfeita, com o service_role com BYPASSRLS (como no Supabase) só dentro dela. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    await c.query("ALTER ROLE service_role BYPASSRLS");
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
/** Tenta `sql` como `papel` (num savepoint desfeito); devolve o código do erro ("ok" se passou) e as linhas. */
async function como(c, papel, sql, params = []) {
  let linhas = null;
  const e = await tentar(c, async () => {
    await c.query(`SET LOCAL ROLE ${papel}`);
    linhas = (await c.query(sql, params)).rows;
  });
  return { codigo: e ? e.code : "ok", linhas, erro: e };
}
/** Roda `sql` como `papel` e MANTÉM o efeito. Se falhar, o erro sobe com o código original (a transação do chamador é desfeita). */
async function comoEFica(c, papel, sql, params = []) {
  await c.query(`SET LOCAL ROLE ${papel}`);
  const linhas = (await c.query(sql, params)).rows;
  await c.query("RESET ROLE");
  return linhas;
}
/** A linha do batimento, lida como o dono, com as datas comparadas no próprio banco (o fuso da sessão não entra). */
async function linha(c) {
  const r = await c.query(
    `SELECT degradado, etapas_com_falha, rodadas_degradadas_seguidas,
            ultima_rodada_em = now() AS rodada_agora, ultima_saudavel_em = now() AS saudavel_agora,
            ultima_saudavel_em IS NULL AS saudavel_nula,
            ultima_rodada_em = '2001-01-01T00:00:00Z'::timestamptz AS rodada_antiga,
            ultima_saudavel_em = '2000-06-01T00:00:00Z'::timestamptz AS saudavel_antiga
       FROM ${TAB} WHERE id = 1`,
  );
  return r.rows[0] ?? null;
}
/** Retrato inteiro da tabela (como o dono), para "nada mudou". */
async function retrato(c) {
  if ((await c.query("SELECT to_regclass($1) IS NULL AS x", [TAB])).rows[0].x)
    return "(sem tabela)";
  return (
    await c.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) AS h FROM ${TAB} s`,
    )
  ).rows[0];
}
/** Semente ANTIGA (como o dono): uma linha degradada com contador 5 e datas no passado. */
async function semente(c) {
  await c.query(`DELETE FROM ${TAB}`);
  await c.query(
    `INSERT INTO ${TAB} (id, ultima_rodada_em, ultima_saudavel_em, degradado, etapas_com_falha, rodadas_degradadas_seguidas)
     VALUES (1, '2001-01-01T00:00:00Z', '2000-06-01T00:00:00Z', true, '{estornos}', 5)`,
  );
}
async function foto(c) {
  const tb = await c.query(
    `SELECT c.relname, c.oid::int AS oid, c.relowner::int AS dono, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid) AS restricoes,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
       FROM pg_class c WHERE c.oid = to_regclass($1)`,
    [TAB],
  );
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono,
            p.prosecdef, p.provolatile, p.proconfig::text AS config, pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('saude_da_reconciliacao_registrar', 'saude_da_loja') ORDER BY 1, 2`,
  );
  return { tb: tb.rows, fn: fn.rows };
}
/** A foto sem OIDs (o que recriar do zero não preserva). */
const semOid = (f) => ({
  tb: f.tb.map(({ oid: _o, ...r }) => r),
  fn: f.fn.map(({ oid: _o, ...r }) => r),
});
async function funcoesPresentes(c) {
  return (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('saude_da_reconciliacao_registrar', 'saude_da_loja')",
    )
  ).rows[0].n;
}

// ---------------------------------------------------------------------------
// (a) comportamento (o MESMO que os mutantes têm de derrubar)
// ---------------------------------------------------------------------------
async function comportamento(c) {
  // Quem executa o quê (a tentativa; o catálogo fica com a 187a).
  for (const papel of ["anon", "authenticated"]) {
    const r = await como(c, papel, SQL_REGISTRAR, [false, []]);
    assert.equal(r.codigo, "42501", `${papel} não executa a porta da edge`);
    const s = await como(c, papel, SQL_SAUDE);
    assert.equal(s.codigo, "ok", `${papel} lê a saúde: ${s.erro?.message}`);
  }
  assert.equal(
    (await como(c, "service_role", SQL_SAUDE)).codigo,
    "42501",
    "service_role não executa a leitura pública",
  );
  assert.equal(
    (await como(c, "service_role", SQL_REGISTRAR, [false, []])).codigo,
    "ok",
    "service_role executa a porta da edge",
  );
  for (const papel of ["anon", "authenticated", "service_role"])
    for (const [sql, rotulo] of [
      [`SELECT * FROM ${TAB}`, "SELECT"],
      [`SELECT id FROM ${TAB}`, "SELECT de coluna"],
      [
        `INSERT INTO ${TAB} (id, ultima_rodada_em, degradado, etapas_com_falha, rodadas_degradadas_seguidas) VALUES (1, now(), false, '{}', 0)`,
        "INSERT",
      ],
      [`UPDATE ${TAB} SET rodadas_degradadas_seguidas = 0`, "UPDATE"],
      [`DELETE FROM ${TAB}`, "DELETE"],
    ])
      assert.equal(
        (await como(c, papel, sql)).codigo,
        "42501",
        `${papel} não faz ${rotulo} direto na tabela`,
      );

  // Tabela vazia: tudo nulo, menos o medidor; as 8 chaves e nenhuma outra.
  await c.query(`DELETE FROM ${TAB}`);
  const vazia = (await como(c, "anon", SQL_SAUDE)).linhas[0].s;
  assert.deepEqual(Object.keys(vazia).sort(), CHAVES, "as 8 chaves da saúde");
  assert.deepEqual(
    vazia,
    Object.fromEntries(CHAVES.map((k) => [k, k === "medidor" ? 1 : null])),
    "sem linha: tudo nulo (nunca registrou)",
  );

  // 1a rodada, ruim, na tabela vazia: cria a linha com contador 1 e sem saudável.
  await comoEFica(c, "service_role", SQL_REGISTRAR, [true, ["pagamentos"]]);
  assert.deepEqual(
    await linha(c),
    {
      degradado: true,
      etapas_com_falha: ["pagamentos"],
      rodadas_degradadas_seguidas: 1,
      rodada_agora: true,
      saudavel_agora: null,
      saudavel_nula: true,
      rodada_antiga: false,
      saudavel_antiga: null,
    },
    "1a rodada ruim: contador 1, sem rodada saudável",
  );

  // Rodada ruim sobre uma linha antiga: soma 1, etapas repetidas viram uma (na ordem fixa) e ultima_saudavel_em não anda.
  await semente(c);
  await comoEFica(c, "service_role", SQL_REGISTRAR, [
    true,
    ["estornos", "pagamentos", "estornos"],
  ]);
  const ruim = await linha(c);
  assert.equal(
    ruim.saudavel_antiga,
    true,
    "rodada ruim não mexe em ultima_saudavel_em",
  );
  assert.equal(
    ruim.rodadas_degradadas_seguidas,
    6,
    "rodada ruim soma 1 ao contador",
  );
  assert.deepEqual(
    [ruim.degradado, ruim.etapas_com_falha, ruim.rodada_agora],
    [true, ["pagamentos", "estornos"], true],
    "rodada ruim: etapas uma vez cada, na ordem fixa; a rodada anda",
  );

  // Rodada boa: zera o contador, a saudável anda junto com a rodada, sem etapa.
  await comoEFica(c, "service_role", SQL_REGISTRAR, [false, []]);
  const boa = await linha(c);
  assert.equal(
    boa.rodadas_degradadas_seguidas,
    0,
    "rodada boa zera o contador",
  );
  assert.deepEqual(
    [boa.degradado, boa.etapas_com_falha, boa.rodada_agora, boa.saudavel_agora],
    [false, [], true, true],
    "rodada boa: sem etapa, e ultima_saudavel_em anda junto com a rodada",
  );

  // A idade sai do relógio do banco (now() da transação), em segundos inteiros; anon e authenticated leem o mesmo.
  await c.query(`DELETE FROM ${TAB}`);
  await c.query(
    `INSERT INTO ${TAB} (id, ultima_rodada_em, ultima_saudavel_em, degradado, etapas_com_falha, rodadas_degradadas_seguidas)
     VALUES (1, now() - interval '1234.6 seconds', now() - interval '99999 seconds', true, '{contestacoes}', 7)`,
  );
  const lida = (await como(c, "anon", SQL_SAUDE)).linhas[0].s;
  assert.deepEqual(Object.keys(lida).sort(), CHAVES);
  assert.deepEqual(
    {
      medidor: lida.medidor,
      idade_rodada_s: lida.idade_rodada_s,
      idade_saudavel_s: lida.idade_saudavel_s,
      degradado: lida.degradado,
      etapas_com_falha: lida.etapas_com_falha,
      rodadas_degradadas_seguidas: lida.rodadas_degradadas_seguidas,
    },
    {
      medidor: 1,
      idade_rodada_s: 1234,
      idade_saudavel_s: 99999,
      degradado: true,
      etapas_com_falha: ["contestacoes"],
      rodadas_degradadas_seguidas: 7,
    },
    "a saúde lida pelo anon",
  );
  assert.equal(
    (
      await c.query(
        "SELECT ($1::text)::timestamptz = now() - interval '1234.6 seconds' AND ($2::text)::timestamptz = now() - interval '99999 seconds' AS x",
        [lida.ultima_rodada_em, lida.ultima_saudavel_em],
      )
    ).rows[0].x,
    true,
    "os instantes devolvidos são os guardados",
  );
  assert.deepEqual(
    (await como(c, "authenticated", SQL_SAUDE)).linhas[0].s,
    lida,
    "authenticated lê o mesmo que o anon",
  );

  // Recusas: 22023, nada gravado.
  const antes = await retrato(c);
  for (const [args, rotulo] of [
    [[null, []], "degradado nulo"],
    [[false, null], "lista nula"],
    [[true, ["estornos", null]], "etapa nula"],
    [[true, ["boletos"]], "etapa fora das 4"],
    [[true, []], "degradado sem etapa"],
    [[false, ["estornos"]], "etapa sem degradado"],
  ]) {
    const r = await como(c, "service_role", SQL_REGISTRAR, args);
    assert.equal(
      r.codigo,
      "22023",
      `recusa: ${rotulo} (${r.erro?.message ?? "gravou"})`,
    );
  }
  assert.deepEqual(await retrato(c), antes, "nenhuma recusa gravou");
}

// ---------------------------------------------------------------------------
// (b) linha que já existia + reaplicar 2x (LF e CRLF)
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    const antesDe = await foto(c);
    const dados = await retrato(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antesDe,
      "reaplicar (LF, CRLF, LF) não muda OID, ACL, coluna, CHECK nem corpo",
    );
    assert.deepEqual(
      await retrato(c),
      dados,
      "reaplicar não toca a linha que já existia",
    );
  });
}

// ---------------------------------------------------------------------------
// (c) rollbacks
// ---------------------------------------------------------------------------
async function rollbacks(c) {
  await desfeita(c, async () => {
    await semente(c);
    const depois = await foto(c);
    const dados = await retrato(c);
    // O destrutivo recusa antes do comum, mesmo confirmado.
    let e = await tentar(c, async () => {
      await c.query(CONFIRMAR_APAGAR);
      await c.query(DESTRUTIVO);
    });
    assert.match(
      e?.message ?? "(apagou)",
      /ROLLBACK_COMUM_PRIMEIRO/,
      "destrutivo antes do comum",
    );
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      assert.equal(
        await funcoesPresentes(c),
        0,
        `rollback comum ${vez}: as duas funções saem`,
      );
      assert.deepEqual(
        await retrato(c),
        dados,
        `rollback comum ${vez}: a tabela e a linha ficam`,
      );
    }
    assert.deepEqual(
      (await foto(c)).tb,
      depois.tb,
      "o comum não mexe na tabela (OID, ACL, colunas, CHECKs)",
    );
    // Reaplicar depois do comum: as funções voltam e a linha guardada continua lá.
    await c.query(MIGRATION);
    assert.deepEqual(
      semOid(await foto(c)),
      semOid(depois),
      "reaplicar depois do comum volta ao estado da migration",
    );
    assert.deepEqual(await retrato(c), dados, "e a linha guardada continua");
    await c.query(ROLLBACK);
    e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "(apagou)",
      /SO_COM_O_DONO/,
      "destrutivo sem confirmação",
    );
    for (const vez of [1, 2]) {
      await c.query(CONFIRMAR_APAGAR);
      await c.query(DESTRUTIVO);
      assert.equal(
        await retrato(c),
        "(sem tabela)",
        `destrutivo ${vez}: a tabela sai`,
      );
    }
    await c.query(MIGRATION);
    assert.deepEqual(
      semOid(await foto(c)),
      semOid(depois),
      "reaplicar depois do destrutivo recria tudo",
    );
    assert.equal((await retrato(c)).n, 0, "e a tabela renasce vazia");
  });
}

// ---------------------------------------------------------------------------
// (d) pré-voo da migration e dos rollbacks
// ---------------------------------------------------------------------------
const CRIAR_OUTRO = "CREATE ROLE prova_1500_outro NOLOGIN";
const LIMPAR = [ROLLBACK, CONFIRMAR_APAGAR, DESTRUTIVO];
const SABOTAGENS = [
  [
    "tabela com uma coluna a mais",
    [`ALTER TABLE ${TAB} ADD COLUMN intrusa int`],
  ],
  [
    "tabela com coluna de outro tipo",
    [`ALTER TABLE ${TAB} ALTER COLUMN rodadas_degradadas_seguidas TYPE bigint`],
  ],
  [
    "outro objeto com o nome da tabela (view)",
    [...LIMPAR, `CREATE VIEW ${TAB} AS SELECT 1::smallint AS id`],
  ],
  [
    "porta da edge com outro corpo",
    [
      "CREATE OR REPLACE FUNCTION public.saude_da_reconciliacao_registrar(p_degradado boolean, p_etapas_com_falha text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN END $f$",
    ],
  ],
  [
    "sobrecarga da leitura",
    [
      "CREATE FUNCTION public.saude_da_loja(p int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ],
  ],
  [
    "leitura só com outra assinatura",
    [
      `DROP FUNCTION ${SAUDE}`,
      "CREATE FUNCTION public.saude_da_loja(p int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ],
  ],
  [
    "porta da edge só com outra assinatura",
    [
      `DROP FUNCTION ${REGISTRAR}`,
      "CREATE FUNCTION public.saude_da_reconciliacao_registrar(p boolean) RETURNS void LANGUAGE sql AS ''",
    ],
  ],
];
async function preVoo(c) {
  await desfeita(c, async () => {
    await semente(c);
    const base = await foto(c);
    const dados = await retrato(c);
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
    assert.deepEqual(await foto(c), base, "nenhuma recusa escreveu nada");
    assert.deepEqual(await retrato(c), dados);
    assert.equal(
      await tentar(c, () => c.query(MIGRATION)),
      null,
      "controle: sem sabotagem, a mesma base aplica",
    );
    // Os rollbacks: o comum recusa corpo desconhecido; o destrutivo recusa tabela de outra forma.
    let r = await tentar(c, async () => {
      await c.query(SABOTAGENS[3][1][0]);
      await c.query(ROLLBACK);
    });
    assert.match(
      r?.message ?? "(desfez)",
      /B1_BASELINE_DIVERGENT/,
      "rollback comum recusa corpo desconhecido",
    );
    r = await tentar(c, async () => {
      await c.query(SABOTAGENS[4][1][0]);
      await c.query(ROLLBACK);
    });
    assert.match(
      r?.message ?? "(desfez)",
      /B1_BASELINE_DIVERGENT/,
      "rollback comum recusa sobrecarga",
    );
    r = await tentar(c, async () => {
      await c.query(ROLLBACK);
      await c.query(SABOTAGENS[0][1][0]);
      await c.query(CONFIRMAR_APAGAR);
      await c.query(DESTRUTIVO);
    });
    assert.match(
      r?.message ?? "(apagou)",
      /B1_BASELINE_DIVERGENT/,
      "destrutivo recusa tabela de outra forma",
    );
    assert.deepEqual(
      await foto(c),
      base,
      "as recusas dos rollbacks não escreveram nada",
    );
  });
  return SABOTAGENS.length;
}

// ---------------------------------------------------------------------------
// (e) duas conexões reais: nenhuma rodada se perde
// ---------------------------------------------------------------------------
async function concorrencia(c, url) {
  await c.query("BEGIN");
  await semente(c); // contador 5, COMMITADO no clone exclusivo
  await c.query("COMMIT");
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  try {
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await a.query("BEGIN");
    await a.query("SET LOCAL ROLE service_role");
    await a.query(SQL_REGISTRAR, [true, ["estornos"]]);
    await b.query("BEGIN");
    await b.query("SET LOCAL ROLE service_role");
    const segunda = b.query(SQL_REGISTRAR, [true, ["pagamentos"]]);
    let esperando = false;
    for (let i = 0; i < 50 && !esperando; i++) {
      await new Promise((r) => setTimeout(r, 100));
      esperando =
        (
          await c.query(
            "SELECT wait_event_type = 'Lock' AS x FROM pg_stat_activity WHERE pid = $1",
            [pidB],
          )
        ).rows[0]?.x === true;
    }
    assert.equal(
      esperando,
      true,
      "a segunda rodada espera a linha da primeira",
    );
    await a.query("COMMIT");
    await segunda;
    await b.query("COMMIT");
    const r = (
      await c.query(
        `SELECT rodadas_degradadas_seguidas AS n, etapas_com_falha AS e FROM ${TAB} WHERE id = 1`,
      )
    ).rows[0];
    assert.deepEqual(
      r,
      { n: 7, e: ["pagamentos"] },
      "duas rodadas ruins simultâneas somam 2 (nenhuma se perde)",
    );
  } finally {
    await a.end();
    await b.end();
    await c.query(`DELETE FROM ${TAB}`); // o clone volta ao estado do apply: tabela vazia
  }
}

// ---------------------------------------------------------------------------
// (f) transação: sem COMMIT escondido; DDL aberta faz desistir em 5 s
// ---------------------------------------------------------------------------
async function transacao(c, url) {
  await c.query("BEGIN");
  for (const s of LIMPAR) await c.query(s);
  await c.query("COMMIT");
  try {
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("ROLLBACK");
    assert.equal(
      await retrato(c),
      "(sem tabela)",
      "aplicar e desfazer não deixa a tabela: não há COMMIT dentro da migration",
    );
    assert.equal(await funcoesPresentes(c), 0, "nem as funções");
    await c.query("BEGIN");
    await c.query(MIGRATION);
    await c.query("COMMIT");
    const base = await foto(c);
    const outro = new Client({ connectionString: url });
    await outro.connect();
    try {
      await outro.query("BEGIN");
      await outro.query(`ALTER TABLE ${TAB} ENABLE ROW LEVEL SECURITY`);
      const t0 = Date.now();
      await c.query("BEGIN");
      let e = null;
      try {
        await c.query(MIGRATION);
      } catch (err) {
        e = err;
      } finally {
        await c.query("ROLLBACK");
      }
      const ms = Date.now() - t0;
      assert.equal(e?.code, "55P03", "DDL aberta na tabela: lock_timeout");
      assert(
        ms >= 4500 && ms < 20000,
        `desistiu em ${ms} ms (lock_timeout de 5 s)`,
      );
      await outro.query("ROLLBACK");
    } finally {
      await outro.end();
    }
    assert.deepEqual(await foto(c), base, "a desistência não escreveu nada");
  } finally {
    if ((await funcoesPresentes(c)) !== 2) {
      await c.query("BEGIN");
      await c.query(MIGRATION);
      await c.query("COMMIT");
    }
  }
}

// ---------------------------------------------------------------------------
// (g) as consultas 187a/187b, EXECUTADAS no catálogo real
// ---------------------------------------------------------------------------
async function consulta(c, nome) {
  const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
  assert.equal(CONF.contarStatements(sql), 1);
  await c.query("SAVEPOINT leitura_catalogo");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const rows = (await c.query(sql)).rows;
    assert.equal(
      CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
      null,
      `${nome}: rol fechado`,
    );
    return rows
      .filter((r) => r.ok !== true)
      .map((r) => r.item)
      .sort();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
  }
}
async function portao(c) {
  const item = (rol, inicio) => {
    const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
      i.startsWith(inicio),
    );
    assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
    return x[0];
  };
  let defeitos = 0;
  const plantar = async (rol, sabotagem, esperados) => {
    await c.query("SAVEPOINT defeito");
    try {
      for (const s of [].concat(sabotagem)) await c.query(s);
      assert.deepEqual(
        await consulta(c, rol),
        esperados.map((i) => item(rol, i)).sort(),
        `${rol} com o defeito "${[].concat(sabotagem).join("; ").slice(0, 90)}" reprova exatamente o item certo`,
      );
      defeitos++;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT defeito");
    }
  };
  const FORMA = "saude_da_reconciliacao: tabela comum";
  const FECHADA = "saude_da_reconciliacao: RLS ligada";
  const REG_CORPO = "saude_da_reconciliacao_registrar: uma so";
  const REG_EXEC = "saude_da_reconciliacao_registrar: EXECUTE";
  const SAU_CORPO = "saude_da_loja: uma so";
  const SAU_EXEC = "saude_da_loja: EXECUTE";
  const DONO = "as duas funcoes";
  await desfeita(c, async () => {
    await semente(c); // a linha não muda o veredito (as consultas não leem linha)
    assert.deepEqual(
      await consulta(c, A187),
      [],
      "187a positiva depois da migration",
    );
    assert.deepEqual(
      await consulta(c, B187),
      [
        item(B187, "saude_da_reconciliacao: a tabela"),
        item(B187, "saude_da_reconciliacao_registrar"),
        item(B187, "saude_da_loja"),
      ].sort(),
      "187b reprova só os três objetos que a migration criou",
    );
    for (const [sabotagem, esperados] of [
      [`ALTER TABLE ${TAB} ADD COLUMN intrusa int`, [FORMA]],
      [
        `ALTER TABLE ${TAB} ALTER COLUMN ultima_saudavel_em SET DEFAULT now()`,
        [FORMA],
      ],
      [
        `ALTER TABLE ${TAB} DROP CONSTRAINT saude_da_reconciliacao_coerencia_check`,
        [FORMA],
      ],
      [`GRANT SELECT ON ${TAB} TO anon`, [FECHADA]],
      [`GRANT SELECT (degradado) ON ${TAB} TO service_role`, [FECHADA]],
      [`GRANT SELECT ON ${TAB} TO PUBLIC`, [FECHADA]],
      [
        `CREATE POLICY aberta ON ${TAB} FOR SELECT TO anon USING (true)`,
        [FECHADA],
      ],
      [`ALTER TABLE ${TAB} FORCE ROW LEVEL SECURITY`, [FECHADA]],
      [SABOTAGENS[3][1][0], [REG_CORPO]],
      [`ALTER FUNCTION ${REGISTRAR} SECURITY INVOKER`, [REG_CORPO]],
      [`GRANT EXECUTE ON FUNCTION ${REGISTRAR} TO anon`, [REG_EXEC]],
      [`REVOKE EXECUTE ON FUNCTION ${REGISTRAR} FROM service_role`, [REG_EXEC]],
      [`ALTER FUNCTION ${SAUDE} VOLATILE`, [SAU_CORPO]],
      [`GRANT EXECUTE ON FUNCTION ${SAUDE} TO service_role`, [SAU_EXEC]],
      [`REVOKE EXECUTE ON FUNCTION ${SAUDE} FROM authenticated`, [SAU_EXEC]],
      [`GRANT EXECUTE ON FUNCTION ${SAUDE} TO PUBLIC`, [SAU_EXEC]],
      [SABOTAGENS[4][1][0], [SAU_CORPO, SAU_EXEC, DONO]],
      [
        [CRIAR_OUTRO, `ALTER FUNCTION ${SAUDE} OWNER TO prova_1500_outro`],
        [DONO],
      ],
    ])
      await plantar(A187, sabotagem, esperados);
    // Depois dos dois rollbacks: a 187b é POSITIVA e a 187a reprova tudo menos o controle.
    for (const s of LIMPAR) await c.query(s);
    assert.deepEqual(
      await consulta(c, B187),
      [],
      "187b positiva antes da migration",
    );
    assert.deepEqual(
      await consulta(c, A187),
      CONF.ROL_FECHADO_POR_CONSULTA[A187]
        .filter((i) => !i.startsWith("controle"))
        .sort(),
      "187a reprova os 7 itens sem a migration",
    );
    for (const [sabotagem, esperados] of [
      [`CREATE TABLE ${TAB} (id int)`, ["saude_da_reconciliacao: a tabela"]],
      [
        "CREATE FUNCTION public.saude_da_reconciliacao_registrar() RETURNS void LANGUAGE sql AS ''",
        ["saude_da_reconciliacao_registrar"],
      ],
      [
        "CREATE FUNCTION public.saude_da_loja(p int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        ["saude_da_loja"],
      ],
    ])
      await plantar(B187, sabotagem, esperados);
  });
  return defeitos;
}

// ---------------------------------------------------------------------------
// (h) MUTANTES: a MESMA prova de comportamento tem de cair com cada defeito; e o pós-voo de cada um recusa sozinho.
// ---------------------------------------------------------------------------
const SEM_CONFERENCIA = (sql) =>
  sql
    .replace(
      /DO \$preflight_20261500000000\$[\s\S]*?END \$preflight_20261500000000\$;\n?/,
      "",
    )
    .replace(
      /DO \$posvoo_20261500000000\$[\s\S]*?END \$posvoo_20261500000000\$;\n?/,
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
const MUTANTES = [
  [
    "GRANT da porta da edge ao anon",
    (s) =>
      trocar(
        s,
        `GRANT EXECUTE ON FUNCTION ${REGISTRAR} TO service_role;`,
        `GRANT EXECUTE ON FUNCTION ${REGISTRAR} TO service_role, anon;`,
      ),
    "anon não executa a porta da edge",
  ],
  [
    "contador sem zerar na rodada boa",
    (s) =>
      trocar(
        s,
        "THEN s.rodadas_degradadas_seguidas + 1 ELSE 0 END;",
        "THEN s.rodadas_degradadas_seguidas + 1 ELSE s.rodadas_degradadas_seguidas END;",
      ),
    "rodada boa zera o contador",
  ],
  [
    "ultima_saudavel_em andando na rodada ruim",
    (s) =>
      trocar(
        s,
        "ultima_saudavel_em = CASE WHEN EXCLUDED.degradado THEN s.ultima_saudavel_em ELSE EXCLUDED.ultima_rodada_em END,",
        "ultima_saudavel_em = EXCLUDED.ultima_rodada_em,",
      ),
    "rodada ruim não mexe em ultima_saudavel_em",
  ],
];
async function mutantes(c) {
  const rodar = (sql) =>
    desfeita(c, async () => {
      await c.query(ROLLBACK);
      await c.query(sql);
      await comportamento(c);
    });
  await rodar(SEM_CONFERENCIA(MIGRATION)); // controle: verde
  let mortos = 0;
  for (const [nome, muta, fragmento] of MUTANTES) {
    const alterada = SEM_CONFERENCIA(muta(MIGRATION));
    assert.notEqual(
      alterada,
      SEM_CONFERENCIA(MIGRATION),
      `mutante "${nome}" não mudou nada`,
    );
    let motivo = null;
    try {
      await rodar(alterada);
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
    // O mesmo defeito COM as conferências: o pós-voo recusa sem deixar nada.
    await desfeita(c, async () => {
      const e = await tentar(c, () => c.query(muta(MIGRATION)));
      assert.match(
        e?.message ?? "(aplicou)",
        /B2_POSVOO_DIVERGENTE/,
        `pós-voo deveria recusar: ${nome}`,
      );
    });
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
    assert.equal(
      await funcoesPresentes(c),
      2,
      "o clone deve estar com a migration aplicada",
    );
    assert.equal((await retrato(c)).n, 0, "a tabela nasce vazia no apply");
    await provar(
      "comportamento: porta só do service_role, leitura de anon e authenticated, tabela fechada, contador, saudável, idade, 6 recusas sem gravar",
      () => desfeita(c, () => comportamento(c)),
    );
    await provar(
      "linha que já existia + reaplicar 2x (LF e CRLF): nada muda",
      () => reaplicar(c),
    );
    await provar(
      "rollback comum (2x) mantém a tabela; destrutivo só com APAGAR e depois do comum; reaplicar volta",
      () => rollbacks(c),
    );
    const recusas = await provar(
      "pré-voo recusa estado divergente sem escrever; os rollbacks também",
      () => preVoo(c),
    );
    await provar(
      "duas conexões reais: a segunda rodada espera a primeira e o contador soma 2",
      () => concorrencia(c, url),
    );
    await provar(
      "transação: sem COMMIT escondido; DDL aberta faz a reaplicação desistir em 5 s",
      () => transacao(c, url),
    );
    const defeitos = await provar(
      "consultas 187a/187b: catálogo real, defeitos plantados, rollbacks",
      () => portao(c),
    );
    const mortos = await provar("mutantes da migration", () => mutantes(c));
    console.log(
      `\na-loja-registra-a-saude-da-reconciliacao-viva: ${provas} provas ok; ${recusas} recusas do pré-voo; ${defeitos} defeitos plantados nas consultas; ${mortos} mutantes mortos`,
    );
    anexarAoSummary(
      "Saúde da reconciliação (PG17)",
      `${provas} provas, ${defeitos} defeitos plantados nas consultas 187a/187b, ${mortos} mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("A_LOJA_REGISTRA_A_SAUDE_DA_RECONCILIACAO", e.stack || e.message),
);
