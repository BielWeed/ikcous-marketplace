// @ts-nocheck
/* eslint-disable security/detect-object-injection -- teste: chaves vêm de fixtures fechadas deste arquivo. */
/**
 * O INSTALADOR DO BANCO da loja nova (L4b, T6–T8; scripts/frota/instalador-banco.mjs).
 *
 * O QUE ESTES TESTES MEDEM (sem rede, sem banco; a prova viva num Postgres 17
 * descartável é tests/banco/instalador-nova-loja-viva.cjs, no db-ci.yml):
 *  T6 planejarInstalacao — banco com tabelas e ledger vazio RECUSA (e aponta a
 *     receita de reset); ledger NÃO vazio só se retoma com a MARCA de
 *     instalação em curso (supabase_migrations.ikcous_instalacao): sem marca
 *     (todas as lojas de hoje) ou com a marca concluída é "loja já instalada"
 *     e RECUSA — loja que vende e está atrasada nunca é "retomada" por fora do
 *     portão de publicação; retomada = fila menos o ledger; versão do ledger
 *     que o repositório não tem RECUSA; lacuna RECUSA; ordem por TEXTO;
 *     rollback-manual-* e _arquivadas/ fora; estado ilegível nunca vira "nada
 *     falta".
 *  T7 envelopeDoArquivo — exatamente BEGIN + corpo + INSERT (version, name) no
 *     ledger, SEM ON CONFLICT (versão repetida = 23505 = a transação inteira
 *     volta; com ON CONFLICT um reenvio regredia uma função de dinheiro em
 *     silêncio — achado da revisão Opus) + COMMIT; controle de transação no
 *     topo RECUSA, e o BEGIN/END de dentro de DO $tag1$ não; ddlDoLedger cria
 *     o ledger E a marca na mesma transação.
 *  T8 instalar — com cliente falso: para na primeira falha mostrando arquivo e
 *     código; timeout = ESTADO DESCONHECIDO, sem repetir; sem `aplicar: true`
 *     só leituras; a marca só fica concluída depois da conferência, e se a
 *     resposta dessa marca se perder a próxima rodada dá "nada" e marca.
 */
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  SQL_CONCLUIR,
  SQL_ESTADO,
  SQL_LEDGER,
  SQL_MARCA,
  arquivosDoRepo,
  ddlDoLedger,
  envelopeDoArquivo,
  instalar,
  planejarInstalacao,
} from "../scripts/frota/instalador-banco.mjs";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));

const arq = (nome: string, corpo = "SELECT 1;") => ({ arquivo: nome, corpo });
const est = (tabelasEmPublic, versoesNoLedger, marca, ledgerExiste = true) => ({
  tabelasEmPublic,
  ledgerExiste,
  versoesNoLedger,
  marca,
});
const VAZIO = est(0, [], "ausente", false);
const nomes = (plano) => plano.fila.map((i) => i.arquivo);

const REPO = [
  arq("20261110000000_b.sql"),
  arq("2026110000000_estorno.sql"),
  arq("20260806000000_baseline.sql"),
  arq("20261099000000_a.sql"),
];
const EM_ORDEM = [
  "20260806000000_baseline.sql",
  "20261099000000_a.sql",
  "2026110000000_estorno.sql",
  "20261110000000_b.sql",
];
const VERSOES = EM_ORDEM.map((n) => n.split("_")[0]);

// ─── T6 ──────────────────────────────────────────────────────────────────────

Deno.test("T6: banco vazio e sem ledger → instala a fila INTEIRA em ordem de TEXTO (13 dígitos no meio, não no começo)", () => {
  const plano = planejarInstalacao(VAZIO, REPO);
  assertEquals(plano.acao, "instalar");
  assertEquals(nomes(plano), EM_ORDEM);
  assertEquals(plano.jaNoLedger, 0);
  assertEquals(plano.total, 4);
  assertEquals(
    plano.fila.map((i) => i.versao),
    ["20260806000000", "20261099000000", "2026110000000", "20261110000000"],
  );
});

Deno.test("T6: ledger vazio e public vazio instala com marca ausente ou em curso (DDL rodou, a 1ª falhou)", () => {
  for (const estado of [
    est(0, [], "ausente", true),
    est(0, [], "em_curso", true),
  ]) {
    assertEquals(planejarInstalacao(estado, REPO).acao, "instalar");
  }
});

Deno.test("T6: rollback-manual-*, _arquivadas/ e o que não é .sql de migration ficam FORA da fila", () => {
  const plano = planejarInstalacao(VAZIO, [
    ...REPO,
    arq("rollback-manual-20261099000000_a.sql", "DROP TABLE x;"),
    arq("_arquivadas/20260101000000_velha.sql"),
    arq("supabase/migrations/_arquivadas/20260102000000_velha.sql"),
    arq("_arquivadas\\20260103000000_velha.sql"),
    arq("20261099000000_a.sql.bak"),
    arq("LEIA-ME.md", "# nada"),
  ]);
  assertEquals(plano.acao, "instalar");
  assertEquals(nomes(plano), EM_ORDEM);
});

Deno.test("T6: fila vazia (pasta errada?) → recusa, nunca 'nada a fazer'", () => {
  const plano = planejarInstalacao(VAZIO, [arq("LEIA-ME.md", "# nada")]);
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "fila vazia");
});

Deno.test("T6: public com tabelas e ledger AUSENTE → recusa e aponta a receita de reset", () => {
  const plano = planejarInstalacao(est(3, [], "ausente", false), REPO);
  assertEquals(plano.acao, "recusar");
  assertEquals(plano.fila, []);
  for (const trecho of [
    "não está vazio",
    "receita de reset",
    "storage.objects",
    "storage.buckets",
    "cron.job",
    "DROP SCHEMA public CASCADE",
  ])
    assertStringIncludes(plano.motivo, trecho);
});

Deno.test("T6: public com tabelas e ledger que EXISTE mas está vazio → recusa igual (com ou sem marca)", () => {
  for (const marca of ["ausente", "em_curso"]) {
    const plano = planejarInstalacao(est(1, [], marca), REPO);
    assertEquals(plano.acao, "recusar");
    assertStringIncludes(plano.motivo, "receita de reset");
  }
});

Deno.test("T6 (bloqueante 2): ledger PREFIXO da fila + tabelas + SEM marca → recusa: loja já instalada (a que vende e está atrasada)", () => {
  // 3 de 4: o caso "273 de 276" de uma loja real atrasada
  const plano = planejarInstalacao(
    est(80, VERSOES.slice(0, 3), "ausente"),
    REPO,
  );
  assertEquals(plano.acao, "recusar");
  assertEquals(plano.fila, []);
  assertStringIncludes(plano.motivo, "loja já instalada");
  assertStringIncludes(plano.motivo, "aplicar-migrations.yml");
});

Deno.test("T6 (bloqueante 2): marca CONCLUÍDA → recusa (prefixo ou ledger completo)", () => {
  for (const versoes of [VERSOES.slice(0, 2), VERSOES]) {
    const plano = planejarInstalacao(est(80, versoes, "concluida"), REPO);
    assertEquals(plano.acao, "recusar", versoes.join(","));
    assertStringIncludes(plano.motivo, "loja já instalada");
    assertStringIncludes(plano.motivo, "aplicar-migrations.yml");
  }
});

Deno.test("T6: marca concluída com ledger VAZIO → recusa (estado incoerente)", () => {
  const plano = planejarInstalacao(est(0, [], "concluida"), REPO);
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "incoerente");
});

Deno.test("T6: retomada (marca em curso) = fila menos o ledger, na mesma ordem", () => {
  const plano = planejarInstalacao(
    est(9, ["20261099000000", "20260806000000"], "em_curso"),
    REPO,
  );
  assertEquals(plano.acao, "instalar");
  assertEquals(nomes(plano), EM_ORDEM.slice(2));
  assertEquals(plano.jaNoLedger, 2);
});

Deno.test("T6: versão no ledger que NÃO existe no repositório → recusa, dizendo qual", () => {
  const plano = planejarInstalacao(
    est(9, ["20260806000000", "20991231000000"], "em_curso"),
    REPO,
  );
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "20991231000000");
  assertStringIncludes(plano.motivo, "não existe");
});

Deno.test("T6: ledger com LACUNA (tem a 3ª sem a 2ª) → recusa: retomar aplicaria fora de ordem", () => {
  const plano = planejarInstalacao(
    est(9, ["20260806000000", "2026110000000"], "em_curso"),
    REPO,
  );
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "20261099000000_a.sql");
  assertStringIncludes(plano.motivo, "fora de ordem");
});

Deno.test("T6: ledger completo com a marca EM CURSO → nada a aplicar (só falta marcar concluída)", () => {
  const plano = planejarInstalacao(est(9, VERSOES, "em_curso"), REPO);
  assertEquals(plano.acao, "nada");
  assertEquals(plano.fila, []);
  assertEquals(plano.jaNoLedger, 4);
  assertStringIncludes(plano.motivo, "marcar");
});

Deno.test("T6: ledger com versões mas public SEM tabela nenhuma → recusa (estado incoerente)", () => {
  const plano = planejarInstalacao(
    est(0, ["20260806000000"], "em_curso"),
    REPO,
  );
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "incoerente");
});

Deno.test("T6: estado ilegível nunca vira 'nada falta' (recusa)", () => {
  for (const estado of [
    null,
    undefined,
    {},
    { ...VAZIO, tabelasEmPublic: "0" },
    { ...VAZIO, tabelasEmPublic: -1 },
    { ...VAZIO, ledgerExiste: "false" },
    { tabelasEmPublic: 0, ledgerExiste: true, marca: "ausente" },
    est(0, [20260806000000], "em_curso"),
    est(0, ["20260806000000"], "ausente", false),
    { tabelasEmPublic: 0, ledgerExiste: false, versoesNoLedger: [] },
    est(0, [], "concluída"),
    est(0, [], "em_curso", false),
  ]) {
    const plano = planejarInstalacao(estado, REPO);
    assertEquals(plano.acao, "recusar", JSON.stringify(estado));
    assertStringIncludes(plano.motivo, "ilegível");
  }
});

Deno.test("T6: duas migrations com a MESMA versão → recusa (o ledger só guardaria uma)", () => {
  const plano = planejarInstalacao(VAZIO, [
    ...REPO,
    arq("20261099000000_outra.sql"),
  ]);
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "20261099000000");
  assertStringIncludes(plano.motivo, "repetida");
});

Deno.test("T6: migration da fila com nome fora do padrão → recusa (não some em silêncio)", () => {
  const plano = planejarInstalacao(VAZIO, [
    ...REPO,
    arq("20261200000000_Nome Estranho'.sql"),
  ]);
  assertEquals(plano.acao, "recusar");
  assertStringIncludes(plano.motivo, "Nome Estranho");
});

Deno.test("T6: arquivo da fila com COMMIT no topo recusa o PLANO inteiro, antes de qualquer gravação", () => {
  const plano = planejarInstalacao(VAZIO, [
    ...REPO,
    arq("20261200000000_com_commit.sql", "CREATE TABLE t (id int);\nCOMMIT;"),
  ]);
  assertEquals(plano.acao, "recusar");
  assertEquals(plano.fila, []);
  assertStringIncludes(plano.motivo, "20261200000000_com_commit.sql");
});

Deno.test("T6 (repo real): 276 na fila, os dois de 13 dígitos nas posições 83/84, nenhum recusado, nenhuma versão repetida", () => {
  const repo = arquivosDoRepo(join(RAIZ, "supabase/migrations"));
  const plano = planejarInstalacao(VAZIO, repo);
  assertEquals(plano.acao, "instalar", plano.motivo);
  assert(plano.fila.length >= 276, `fila com ${plano.fila.length}`);
  assertEquals(plano.fila[83].versao, "2026110000000");
  assertEquals(plano.fila[84].versao, "2026110000100");
  assertEquals(
    plano.fila[0].arquivo,
    "20260806000000_baseline_do_schema_vivo.sql",
  );
  assert(nomes(plano).every((n) => !n.startsWith("rollback-manual-")));
  const ordenada = [...nomes(plano)].sort();
  assertEquals(nomes(plano), ordenada);
});

// ─── T7 ──────────────────────────────────────────────────────────────────────

Deno.test("T7: envelope = EXATAMENTE BEGIN + corpo + INSERT (version, name) no ledger, SEM ON CONFLICT + COMMIT", () => {
  const corpo = "CREATE TABLE public.t (id int);\n-- fim\n";
  const env = envelopeDoArquivo(arq("20260806000000_baseline.sql", corpo));
  assertEquals(
    env,
    `BEGIN;\n${corpo}\nINSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260806000000', 'baseline');\nCOMMIT;\n`,
  );
  assert(!/ON\s+CONFLICT/i.test(env), "ON CONFLICT voltou ao envelope");
  assertEquals(
    env.split(corpo).length - 1,
    1,
    "statements = NULL: o corpo não vai copiado ao ledger",
  );
});

Deno.test("T7: versão de 13 dígitos vai ao ledger com os 13 dígitos", () => {
  assertStringIncludes(
    envelopeDoArquivo(arq("2026110000000_o_estorno_nasce_no_ledger.sql")),
    "VALUES ('2026110000000', 'o_estorno_nasce_no_ledger');",
  );
});

Deno.test("T7: controle de transação no nível de topo é RECUSADO (todas as formas)", () => {
  for (const corpo of [
    "BEGIN;\nCREATE TABLE t (id int);",
    "CREATE TABLE t (id int);\nCOMMIT;",
    "CREATE TABLE t (id int);\ncommit;",
    "SELECT 1;\n  -- comentário\nEND;",
    "SELECT 1;\n/* a /* aninhado; */ ainda comentário */ COMMIT;",
    "SELECT 1;\nROLLBACK;",
    "START TRANSACTION;\nSELECT 1;",
    "SELECT 1;\nABORT;",
    "SELECT 1;\nPREPARE TRANSACTION 'x';",
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;\nSELECT 1;",
    "SELECT E'\\'';\nCOMMIT;",
  ]) {
    const e = assertThrows(() =>
      envelopeDoArquivo(arq("20261200000000_x.sql", corpo)),
    );
    assertStringIncludes(e.message, "RECUSADO", corpo);
    assertStringIncludes(e.message, "20261200000000_x.sql");
  }
});

Deno.test("T7: BEGIN/END/COMMIT que NÃO são de topo passam (DO com tag de dígito, string, comentário, SAVEPOINT)", () => {
  for (const corpo of [
    "DO $preflight_20261180$\nBEGIN\n  IF true THEN RAISE NOTICE 'x'; END IF;\nEND $preflight_20261180$;",
    "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN COMMIT; END $$;",
    "SELECT 'COMMIT;';",
    "-- COMMIT;\nSELECT 1;",
    "/* BEGIN; */ SELECT 1;",
    "SAVEPOINT a;\nSELECT 1;\nROLLBACK TO SAVEPOINT a;\nRELEASE SAVEPOINT a;",
    'SELECT 1 AS "commit";',
  ]) {
    assertStringIncludes(
      envelopeDoArquivo(arq("20261200000000_x.sql", corpo)),
      corpo,
    );
  }
});

Deno.test("T7: corpo que termina sem ';' é recusado (o INSERT do ledger grudaria no último comando)", () => {
  for (const corpo of [
    "SELECT 1",
    "SELECT 1;\nSELECT 2",
    "SELECT 1; /* sem fim",
    "",
  ]) {
    const e = assertThrows(() =>
      envelopeDoArquivo(arq("20261200000000_x.sql", corpo)),
    );
    assertStringIncludes(e.message, "RECUSADO");
  }
  // comentário depois do último ';' não é comando: passa
  envelopeDoArquivo(arq("20261200000000_x.sql", "SELECT 1; -- fim"));
});

Deno.test("T7: nome fora do padrão é recusado (entra literal no SQL)", () => {
  for (const nome of [
    "20261200000000_x'); DROP TABLE t; --.sql",
    "20261200000000_Maiuscula.sql",
    "rollback-manual-20261200000000_x.sql",
    "_arquivadas/20261200000000_x.sql",
  ]) {
    assertThrows(() => envelopeDoArquivo(arq(nome)));
  }
});

Deno.test("T7: ddlDoLedger cria o ledger do CLI E a marca de instalação na MESMA transação, com IF NOT EXISTS", () => {
  assertEquals(
    ddlDoLedger(),
    "BEGIN;\n" +
      "CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n" +
      "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY);\n" +
      "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];\n" +
      "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;\n" +
      "CREATE TABLE IF NOT EXISTS supabase_migrations.ikcous_instalacao (id int PRIMARY KEY CHECK (id = 1), iniciada_em timestamptz NOT NULL DEFAULT now(), concluida_em timestamptz);\n" +
      "INSERT INTO supabase_migrations.ikcous_instalacao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;\n" +
      "COMMIT;\n",
  );
  assertEquals(
    SQL_CONCLUIR,
    "UPDATE supabase_migrations.ikcous_instalacao SET concluida_em = now() WHERE id = 1 AND concluida_em IS NULL;",
  );
});

// ─── T8 ──────────────────────────────────────────────────────────────────────

/** Banco de mentira: responde às leituras do estado, cria ledger + marca no
 * DDL, "aplica" envelope (versão já no ledger = 23505, nada gravado, como o
 * PRIMARY KEY sem ON CONFLICT) e marca concluída. `falhas[arquivo|"(ledger)"|
 * "(marca)"] = {quando, erro}`: `antes` = falha sem executar; `depois` =
 * executa (comita) e perde a resposta; `outro_instalador` = alguém registra a
 * versão um instante antes deste envio. */
function bancoFalso({
  tabelas = 0,
  ledger = null,
  marca = null,
  falhas = {},
  ignorarLedgerDe = [],
  ddlSemMarca = false,
} = {}) {
  const b = {
    tabelas,
    ledger: ledger === null ? null : new Set(ledger),
    marca,
    chamadas: [],
    async consultar(sql) {
      b.chamadas.push(sql);
      if (sql === SQL_ESTADO) {
        return [
          {
            tabelas_em_public: b.tabelas,
            ledger_existe: b.ledger !== null,
            marca_existe: b.marca !== null,
          },
        ];
      }
      if (sql === SQL_LEDGER) {
        if (b.ledger === null)
          throw Object.assign(new Error("relation does not exist"), {
            tipo: "sql",
            codigo: "42P01",
          });
        return [...b.ledger].map((version) => ({ version }));
      }
      if (sql === SQL_MARCA) {
        return [{ concluida: b.marca === "concluida" }];
      }
      if (sql === ddlDoLedger()) {
        if (falhas["(ledger)"]) throw falhas["(ledger)"].erro;
        if (b.ledger === null) b.ledger = new Set();
        if (b.marca === null && !ddlSemMarca) b.marca = "em_curso";
        return [];
      }
      if (sql === SQL_CONCLUIR) {
        const f = falhas["(marca)"];
        if (f?.quando === "antes") throw f.erro;
        b.marca = "concluida";
        if (f?.quando === "depois") throw f.erro;
        return [];
      }
      const m = /VALUES \('(\d{13,14})', '([a-z0-9_-]+)'/.exec(sql);
      assert(
        m && sql.startsWith("BEGIN;\n"),
        `chamada inesperada: ${sql.slice(0, 80)}`,
      );
      const arquivo = `${m[1]}_${m[2]}.sql`;
      const f = falhas[arquivo];
      if (f?.quando === "outro_instalador") {
        b.tabelas += 1;
        b.ledger.add(m[1]);
      }
      if (f?.quando === "antes") throw f.erro;
      if (b.ledger.has(m[1])) {
        // Com ON CONFLICT o Postgres engole a versão repetida e o CORPO fica
        // gravado (a regressão silenciosa do bloqueante 1); sem ele, 23505.
        if (/ON\s+CONFLICT/i.test(sql)) {
          b.tabelas += 1;
          return [];
        }
        throw erroSql(
          "23505",
          'duplicate key value violates unique constraint "schema_migrations_pkey"',
        );
      }
      b.tabelas += 1;
      if (!ignorarLedgerDe.includes(arquivo)) b.ledger.add(m[1]);
      if (f?.quando === "depois") throw f.erro;
      return [];
    },
  };
  return b;
}

const erroSql = (codigo, msg) =>
  Object.assign(new Error(msg), { tipo: "sql", codigo });
const erroTimeout = () =>
  Object.assign(new Error("tempo esgotado"), { tipo: "timeout" });
const ehLeitura = (sql) =>
  sql === SQL_ESTADO || sql === SQL_LEDGER || sql === SQL_MARCA;
const escritas = (b) => b.chamadas.filter((s) => !ehLeitura(s));
const estadoDo = (b) =>
  est(
    b.tabelas,
    [...(b.ledger ?? [])],
    b.marca ?? "ausente",
    b.ledger !== null,
  );

Deno.test("T8: aplicar → ledger+marca primeiro, cada envelope NA ORDEM, confere o ledger e SÓ ENTÃO marca concluída", async () => {
  const b = bancoFalso();
  const plano = planejarInstalacao(VAZIO, REPO);
  const r = await instalar(b, plano, { aplicar: true });
  assertEquals(r.estado, "OK", r.mensagem);
  assertEquals(r.aplicados, EM_ORDEM);
  const w = escritas(b);
  assertEquals(w[0], ddlDoLedger());
  assertEquals(
    w.slice(1, -1),
    plano.fila.map((i) => i.envelope),
  );
  assertEquals(w.at(-1), SQL_CONCLUIR);
  const iConcluir = b.chamadas.lastIndexOf(SQL_CONCLUIR);
  assert(
    ehLeitura(b.chamadas[iConcluir - 1]),
    "a conferência do ledger vem ANTES de marcar concluída",
  );
  assertEquals(b.marca, "concluida");
});

Deno.test("T8 (bloqueante 1): outro instalador registra a versão um instante antes → 23505 FALHOU, o corpo deste envio não grava", async () => {
  const b = bancoFalso({
    falhas: { [EM_ORDEM[1]]: { quando: "outro_instalador" } },
  });
  const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
    aplicar: true,
  });
  assertEquals(r.estado, "FALHOU", r.mensagem);
  assertEquals(r.codigo, "23505");
  assertEquals(r.arquivo, EM_ORDEM[1]);
  assertEquals(
    b.tabelas,
    2,
    "1º aplicado + o do outro instalador; nenhum corpo duplicado",
  );
  assertEquals(b.marca, "em_curso");
});

Deno.test("T8: falha de SQL no 2º arquivo → PARA ali, mostrando arquivo e código; nada depois", async () => {
  const b = bancoFalso({
    falhas: {
      [EM_ORDEM[1]]: {
        quando: "antes",
        erro: erroSql("42P07", 'relation "t" already exists'),
      },
    },
  });
  const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
    aplicar: true,
  });
  assertEquals(r.estado, "FALHOU");
  assertEquals(r.arquivo, EM_ORDEM[1]);
  assertEquals(r.codigo, "42P07");
  assertEquals(r.aplicados, [EM_ORDEM[0]]);
  assertStringIncludes(r.mensagem, EM_ORDEM[1]);
  assertStringIncludes(r.mensagem, "42P07");
  assertStringIncludes(r.mensagem, "nada deste arquivo foi gravado");
  assertEquals(
    escritas(b).length,
    3,
    "ledger + 1º + o 2º que falhou; nenhum depois",
  );
  assertEquals(b.marca, "em_curso");
});

Deno.test("T8: TIMEOUT → 'ESTADO DESCONHECIDO: confira o ledger', sem repetir e sem seguir", async () => {
  const b = bancoFalso({
    falhas: { [EM_ORDEM[1]]: { quando: "depois", erro: erroTimeout() } },
  });
  const plano = planejarInstalacao(VAZIO, REPO);
  const r = await instalar(b, plano, { aplicar: true });
  assertEquals(r.estado, "ESTADO_DESCONHECIDO");
  assertEquals(r.arquivo, EM_ORDEM[1]);
  assertStringIncludes(r.mensagem, "ESTADO DESCONHECIDO: confira o ledger");
  assertStringIncludes(r.mensagem, EM_ORDEM[1].split("_")[0]);
  const env2 = plano.fila[1].envelope;
  assertEquals(
    b.chamadas.filter((s) => s === env2).length,
    1,
    "enviado UMA vez",
  );
  assertEquals(b.chamadas.at(-1), env2, "nada depois do timeout, nem leitura");
});

Deno.test("T8: erro sem tipo (rede, HTTP, qualquer coisa) também é ESTADO DESCONHECIDO", async () => {
  for (const erro of [
    new Error("fetch failed"),
    Object.assign(new Error("502"), { tipo: "http", codigo: 502 }),
    Object.assign(new Error("413"), { tipo: "http", codigo: 413 }),
    "texto solto",
  ]) {
    const b = bancoFalso({
      falhas: { [EM_ORDEM[0]]: { quando: "antes", erro } },
    });
    const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
      aplicar: true,
    });
    assertEquals(r.estado, "ESTADO_DESCONHECIDO", String(erro));
  }
});

Deno.test("T8: timeout no DDL do ledger → ESTADO DESCONHECIDO e NENHUM arquivo enviado", async () => {
  const b = bancoFalso({ falhas: { "(ledger)": { erro: erroTimeout() } } });
  const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
    aplicar: true,
  });
  assertEquals(r.estado, "ESTADO_DESCONHECIDO");
  assertEquals(escritas(b), [ddlDoLedger()]);
});

Deno.test("T8: resposta da MARCA se perde → ESTADO DESCONHECIDO; a próxima rodada dá 'nada' e marca concluída", async () => {
  const b = bancoFalso({
    falhas: { "(marca)": { quando: "antes", erro: erroTimeout() } },
  });
  const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
    aplicar: true,
  });
  assertEquals(r.estado, "ESTADO_DESCONHECIDO", r.mensagem);
  assertEquals(r.arquivo, "(marca de conclusão)");
  assertEquals(b.marca, "em_curso");
  assertEquals(b.ledger.size, 4);

  const plano2 = planejarInstalacao(estadoDo(b), REPO);
  assertEquals(plano2.acao, "nada");
  b.chamadas = [];
  const ensaio = await instalar(b, plano2);
  assertEquals(ensaio.estado, "ENSAIO");
  assertEquals(escritas(b), [], "ensaio do 'nada' não marca");
  const semFalha = bancoFalso({
    tabelas: b.tabelas,
    ledger: [...b.ledger],
    marca: "em_curso",
  });
  const r2 = await instalar(semFalha, plano2, { aplicar: true });
  assertEquals(r2.estado, "NADA_A_FAZER", r2.mensagem);
  assertEquals(escritas(semFalha), [SQL_CONCLUIR]);
  assertEquals(semFalha.marca, "concluida");
  // e agora a loja está instalada: a rodada seguinte RECUSA
  assertEquals(planejarInstalacao(estadoDo(semFalha), REPO).acao, "recusar");
});

Deno.test("T8: sem aplicar → SÓ leituras (ensaio), e diz o que aplicaria", async () => {
  for (const opcoes of [
    undefined,
    {},
    { aplicar: false },
    { aplicar: "true" },
    { aplicar: 1 },
  ]) {
    const b = bancoFalso();
    const r = await instalar(b, planejarInstalacao(VAZIO, REPO), opcoes);
    assertEquals(r.estado, "ENSAIO", JSON.stringify(opcoes));
    assertEquals(r.aplicaria, EM_ORDEM);
    assertEquals(escritas(b), [], JSON.stringify(opcoes));
    assert(b.chamadas.length > 0, "o ensaio confere o estado (leitura)");
  }
});

Deno.test("T8: plano de recusa → RECUSADO sem NENHUMA chamada ao banco (inclusive loja já instalada)", async () => {
  for (const estado of [
    est(4, [], "ausente", false),
    est(80, VERSOES.slice(0, 3), "ausente"),
    est(80, VERSOES, "concluida"),
  ]) {
    const b = bancoFalso({ tabelas: estado.tabelasEmPublic });
    const r = await instalar(b, planejarInstalacao(estado, REPO), {
      aplicar: true,
    });
    assertEquals(r.estado, "RECUSADO");
    assertEquals(b.chamadas, []);
  }
});

Deno.test("T8: o banco mudou desde o plano (outro instalador?) → RECUSADO sem gravar", async () => {
  const plano = planejarInstalacao(VAZIO, REPO);
  const b = bancoFalso({
    tabelas: 3,
    ledger: ["20260806000000"],
    marca: "em_curso",
  });
  const r = await instalar(b, plano, { aplicar: true });
  assertEquals(r.estado, "RECUSADO");
  assertStringIncludes(r.mensagem, "mudou");
  assertEquals(escritas(b), []);
});

Deno.test("T8: só a MARCA mudou desde o plano (em curso → concluída) → RECUSADO sem gravar", async () => {
  const estado = est(9, VERSOES.slice(0, 2), "em_curso");
  const plano = planejarInstalacao(estado, REPO);
  assertEquals(plano.acao, "instalar");
  const b = bancoFalso({
    tabelas: 9,
    ledger: VERSOES.slice(0, 2),
    marca: "concluida",
  });
  const r = await instalar(b, plano, { aplicar: true });
  assertEquals(r.estado, "RECUSADO");
  assertStringIncludes(r.mensagem, "mudou");
  assertEquals(escritas(b), []);
});

Deno.test("T8: a conferência final acha versão que NÃO foi ao ledger → FALHOU e NÃO marca concluída", async () => {
  const b = bancoFalso({ ignorarLedgerDe: [EM_ORDEM[2]] });
  const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
    aplicar: true,
  });
  assertEquals(r.estado, "FALHOU");
  assertStringIncludes(r.mensagem, EM_ORDEM[2].split("_")[0]);
  assertEquals(b.marca, "em_curso");
  assert(!b.chamadas.includes(SQL_CONCLUIR));
});

Deno.test("T8: a marca não está em curso na conferência (o DDL não a criou) → FALHOU e NÃO manda concluir", async () => {
  const b = bancoFalso({ ddlSemMarca: true });
  const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
    aplicar: true,
  });
  assertEquals(r.estado, "FALHOU", r.mensagem);
  assertEquals(r.fase, "conferência");
  assertStringIncludes(r.mensagem, "marca");
  assert(!b.chamadas.includes(SQL_CONCLUIR));
});

Deno.test("T8: leitura do estado com resposta torta → FALHOU na leitura, sem gravar", async () => {
  for (const linha of [
    { tabelas_em_public: "0", ledger_existe: false, marca_existe: false },
    { tabelas_em_public: 0, ledger_existe: false },
  ]) {
    const b = bancoFalso();
    b.consultar = async (sql) => {
      b.chamadas.push(sql);
      return [linha];
    };
    const r = await instalar(b, planejarInstalacao(VAZIO, REPO), {
      aplicar: true,
    });
    assertEquals(r.estado, "FALHOU", JSON.stringify(linha));
    assertEquals(r.fase, "leitura");
    assertEquals(escritas(b), []);
  }
});

Deno.test("T8 + T6: retomada depois do timeout pega a partir do ledger (a versão que comitou não se repete)", async () => {
  const b = bancoFalso({
    falhas: { [EM_ORDEM[1]]: { quando: "depois", erro: erroTimeout() } },
  });
  await instalar(b, planejarInstalacao(VAZIO, REPO), { aplicar: true });
  const plano2 = planejarInstalacao(estadoDo(b), REPO);
  assertEquals(nomes(plano2), EM_ORDEM.slice(2));
  b.chamadas = [];
  const r = await instalar(b, plano2, { aplicar: true });
  assertEquals(r.estado, "OK", r.mensagem);
  assertEquals(r.aplicados, EM_ORDEM.slice(2));
  assertEquals(b.marca, "concluida");
});

// ─── T9 (registro): a prova viva roda no db-ci e dispara quando o instalador muda ───

Deno.test("T9: db-ci.yml roda a prova viva do instalador e dispara quando o instalador ou a prova mudam", () => {
  const yml = Deno.readTextFileSync(join(RAIZ, ".github/workflows/db-ci.yml"));
  assertStringIncludes(
    yml,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/instalador-nova-loja-viva.cjs",
  );
  for (const gatilho of [
    '"scripts/frota/instalador-banco.mjs"',
    '"tests/banco/instalador-nova-loja-viva.cjs"',
  ]) {
    assertEquals(
      yml.split(gatilho).length - 1,
      2,
      `${gatilho} em pull_request e push`,
    );
  }
});
