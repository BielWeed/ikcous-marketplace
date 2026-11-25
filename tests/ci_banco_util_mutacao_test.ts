/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste e as chaves vêm de constantes e mapas fechados do arquivo, nunca de entrada externa. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
// @ts-nocheck
/**
 * scripts/ci/banco/util.cjs — as peças do job `db-ci` que decidem o veredito.
 *
 * Achado por mutação (trocar uma linha e ver se algum teste reclama): dos 87
 * defeitos plantados em util.cjs, só 21 eram pegos. Os testes vizinhos
 * (ci_banco_trava_dupla_test.ts, ci_banco_cron_emulado_test.ts) cobrem a trava
 * de banco real e o regex de provisionamento, mas nada olhava:
 *
 *   - o código de saída de cada estado (`sair`): OK 0 / FALHOU 1 / RECUSADO 2 /
 *     INDETERMINADO 5 — é o que o GitHub Actions lê para pintar o job;
 *   - o filtro de arquivos de migration (`listarMigrations`): 13 OU 14 dígitos,
 *     `.sql`, ordem de string — migration fora da fila ou fora de ordem é
 *     banco de CI diferente do de produção;
 *   - o tokenizador de SQL (`codigoSemLiteral`/`instrucoesDeNivelDeTopo`) que
 *     alimenta o classificador de idempotência da prova de dupla aplicação:
 *     um `'` mal pulado e a prova passa a classificar texto de string como
 *     comando, ou a ignorar comando de verdade;
 *   - o ciclo "nativo -> emulado -> pulado -> falhou"
 *     (`aplicarComProvisionamento`) e o texto que as neutralizações escrevem.
 *
 * Padrão do arquivo irmão: `createRequire` (o módulo é CommonJS) e um stub de
 * `process.exit` que LANÇA, para a função "nunca voltar" sem matar o runner.
 */
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const util = require("../scripts/ci/banco/util.cjs");

// ---------------------------------------------------------------------------
// auxiliares
// ---------------------------------------------------------------------------

/** Executa `executar` com process.exit e console.log capturados. */
function capturar<T>(executar: () => T) {
  const exitOriginal = process.exit;
  const logOriginal = console.log;
  const linhas: string[] = [];
  let codigo: number | undefined;
  // @ts-ignore -- stub de teste
  process.exit = (c?: number) => {
    codigo = c;
    throw new Error(`process.exit(${c})`);
  };
  console.log = (...a: unknown[]) => {
    linhas.push(a.join(" "));
  };
  let valor: T | undefined;
  let saiu = false;
  try {
    valor = executar();
  } catch (e) {
    if (!String(e?.message).startsWith("process.exit(")) throw e;
    saiu = true;
  } finally {
    process.exit = exitOriginal;
    console.log = logOriginal;
  }
  return { saiu, codigo, linhas, valor };
}

// ---------------------------------------------------------------------------
// sair
// ---------------------------------------------------------------------------

Deno.test("sair: cada estado vira o código de saída que o Actions lê", () => {
  const esperado: Array<[string, number]> = [
    ["OK", 0],
    ["FALHOU", 1],
    ["RECUSADO", 2],
    ["INDETERMINADO", 5],
    ["ESTADO_QUE_NAO_EXISTE", 1], // desconhecido falha FECHADO, nunca 0
  ];
  for (const [estado, codigo] of esperado) {
    const r = capturar(() => util.sair(estado));
    assertEquals(r.saiu, true, estado);
    assertEquals(r.codigo, codigo, estado);
  }
});

Deno.test("sair: imprime `[ci-banco] ESTADO` e só imprime os detalhes quando existem", () => {
  const com = capturar(() => util.sair("FALHOU", "o motivo"));
  assertEquals(com.linhas, ["\n[ci-banco] FALHOU", "o motivo"]);
  const sem = capturar(() => util.sair("OK"));
  assertEquals(sem.linhas, ["\n[ci-banco] OK"]);
  const vazio = capturar(() => util.sair("OK", ""));
  assertEquals(vazio.linhas, ["\n[ci-banco] OK"]);
});

// ---------------------------------------------------------------------------
// lerDatabaseUrlEfemero — o que o vizinho não amarra
// ---------------------------------------------------------------------------

function comEnv<T>(
  pares: Record<string, string | undefined>,
  executar: () => T,
) {
  const chaves = ["DATABASE_URL", "CI_BANCO_EFEMERO"];
  const antes = chaves.map((c) => [c, Deno.env.get(c)]);
  for (const c of chaves) Deno.env.delete(c);
  for (const [c, v] of Object.entries(pares))
    if (v !== undefined) Deno.env.set(c, v);
  try {
    return executar();
  } finally {
    for (const [c, v] of antes) {
      if (v === undefined) Deno.env.delete(c);
      else Deno.env.set(c, v);
    }
  }
}

Deno.test("lerDatabaseUrlEfemero: cada recusa explica o motivo certo (e é RECUSADO, 2)", () => {
  const semUrl = comEnv({}, () => capturar(() => util.lerDatabaseUrlEfemero()));
  assertEquals(semUrl.codigo, 2);
  assertStringIncludes(semUrl.linhas.join("\n"), "DATABASE_URL ausente.");

  const semFlag = comEnv(
    { DATABASE_URL: "postgres://postgres@localhost:5432/postgres" },
    () => capturar(() => util.lerDatabaseUrlEfemero()),
  );
  assertEquals(semFlag.codigo, 2);
  assertStringIncludes(
    semFlag.linhas.join("\n"),
    "CI_BANCO_EFEMERO=1 ausente no ambiente.",
  );

  const invalida = comEnv(
    { DATABASE_URL: "isto não é uma url", CI_BANCO_EFEMERO: "1" },
    () => capturar(() => util.lerDatabaseUrlEfemero()),
  );
  assertEquals(invalida.codigo, 2);
  assertStringIncludes(
    invalida.linhas.join("\n"),
    "DATABASE_URL não é uma URL de postgres válida.",
  );
});

Deno.test("lerDatabaseUrlEfemero: host gerenciado recusa citando o host e o domínio; host efêmero devolve a URL INTACTA", () => {
  for (const [url, dominio] of [
    ["postgres://u@db.abc.supabase.co:5432/postgres", "supabase.co"],
    // o primeiro domínio da lista que casa é o citado: "supabase.com" contém "supabase.co"
    ["postgres://u@x.supabase.com:5432/postgres", "supabase.co"],
    ["postgres://u@x.supabase.net:5432/postgres", "supabase.net"],
    ["postgres://u@aws-0-us.pooler.supabase.com:6543/postgres", "supabase.co"],
    ["postgres://u@supabase.co:5432/postgres", "supabase.co"],
    ["postgres://u@meu-supabase.co.exemplo.test:5432/postgres", "supabase.co"],
  ]) {
    const r = comEnv({ DATABASE_URL: url, CI_BANCO_EFEMERO: "1" }, () =>
      capturar(() => util.lerDatabaseUrlEfemero()),
    );
    assertEquals(r.codigo, 2, url);
    const texto = r.linhas.join("\n");
    assertStringIncludes(texto, `host gerenciado "${dominio}"`);
    assertStringIncludes(texto, "NUNCA conecta a banco real");
  }
  for (const url of [
    "postgres://postgres@localhost:5432/postgres",
    "postgres://postgres@127.0.0.1:5432/postgres",
    "postgres://postgres@postgres:5432/postgres",
  ]) {
    const r = comEnv({ DATABASE_URL: url, CI_BANCO_EFEMERO: "1" }, () =>
      capturar(() => util.lerDatabaseUrlEfemero()),
    );
    assertEquals(r.saiu, false, url);
    assertEquals(r.valor, url);
  }
});

// ---------------------------------------------------------------------------
// listarMigrations
// ---------------------------------------------------------------------------

Deno.test("listarMigrations: só timestamp de 13 ou 14 dígitos + `_` + `.sql`, em ordem de STRING, sem subpasta nem rollback-manual", () => {
  const pasta = mkdtempSync(join(tmpdir(), "h36-migs-"));
  const leitorOriginal = fs.readdirSync;
  try {
    const entram = [
      "20260101000000_a.sql", // 14 dígitos
      "2026110000000_b.sql", // 13 dígitos (o par do estorno)
      "20260102000000_c.sql",
    ];
    const ficam = [
      "202601010000_curto.sql", // 12
      "202601010000000_longo.sql", // 15
      "20260101000000_a.txt",
      "20260101000000_a.sql.bak",
      "rollback-manual-20260101000000_x.sql",
      "x20260101000000_y.sql",
      "20260101000000.sql", // sem `_`
      "LEIA.md",
    ];
    for (const nome of [...entram, ...ficam])
      writeFileSync(join(pasta, nome), "-- x");
    mkdirSync(join(pasta, "_arquivadas"));
    writeFileSync(
      join(pasta, "_arquivadas", "20260101000000_velha.sql"),
      "-- velha",
    );
    mkdirSync(join(pasta, "20260109000000_pasta.sql")); // pasta com cara de migration

    // O sistema de arquivos devolve na ordem INVERSA: quem ordena é a função.
    fs.readdirSync = (p, ...resto) =>
      [...leitorOriginal(p, ...resto)].reverse();
    const lista = util
      .listarMigrations(pasta)
      .map((c) => c.replaceAll("\\", "/"));
    const base = pasta.replaceAll("\\", "/");
    assertEquals(lista, [
      `${base}/20260101000000_a.sql`,
      `${base}/20260102000000_c.sql`,
      // o filtro é por NOME: pasta com nome de migration também passa
      `${base}/20260109000000_pasta.sql`,
      // 13 dígitos: na ordem de STRING cai depois (2026110... > 2026010...)
      `${base}/2026110000000_b.sql`,
    ]);
  } finally {
    fs.readdirSync = leitorOriginal;
    rmSync(pasta, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// excecaoDeProvisionamento
// ---------------------------------------------------------------------------

Deno.test("excecaoDeProvisionamento: as cinco migrations da lista, cada mensagem de 'a extensão não existe NESTA bancada'", () => {
  const arquivos = [
    "20260807000000_reserva_com_expiracao.sql",
    "20260807000001_agenda_expiracao.sql",
    "20260808000100_reconciliacao.sql",
    "20260823000000_ltv_do_cliente_conta_so_dinheiro_reconhecido.sql",
    "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql",
  ];
  assertEquals(Object.keys(util.EXCECOES_DE_PROVISIONAMENTO), arquivos);
  const mensagens = [
    "can only create extension in database postgres",
    'schema "cron" does not exist',
    "function cron.schedule(unknown, unknown, unknown) does not exist",
    'extension "pg_cron" is not available',
    "extension pg_net is not available",
    'extension "pg_net" is not available',
    "could not open extension control file /usr/share/postgresql/extension/pg_cron.control",
    "ERRO: CAN ONLY CREATE EXTENSION IN DATABASE POSTGRES", // case-insensitive
  ];
  for (const arquivo of arquivos) {
    for (const mensagem of mensagens) {
      assertEquals(
        util.excecaoDeProvisionamento(arquivo, mensagem),
        true,
        `${arquivo}: ${mensagem}`,
      );
    }
  }
});

Deno.test("excecaoDeProvisionamento: erro de SQL de verdade, arquivo fora da lista ou sem mensagem NÃO é exceção", () => {
  const listado = "20260807000000_reserva_com_expiracao.sql";
  for (const mensagem of [
    'relation "x" does not exist',
    "syntax error at or near",
    'extension "pg_outra" is not available',
    "function cronx(", // o ponto de `function cron\.` é literal
    "",
    undefined,
    null,
  ]) {
    assertEquals(
      util.excecaoDeProvisionamento(listado, mensagem),
      false,
      String(mensagem),
    );
  }
  assertEquals(
    util.excecaoDeProvisionamento(
      "20260101000000_qualquer.sql",
      'schema "cron" does not exist',
    ),
    false,
  );
  assertEquals(
    util.excecaoDeProvisionamento(undefined, 'schema "cron" does not exist'),
    false,
  );
});

// ---------------------------------------------------------------------------
// neutralizarProvisionamento
// ---------------------------------------------------------------------------

Deno.test("neutralizarProvisionamento: troca SÓ o comando por comentário de BLOCO; o resto da linha sobrevive", () => {
  const r = util.neutralizarProvisionamento(
    "CREATE EXTENSION IF NOT EXISTS pg_cron; SELECT 1/0;\nSELECT 2;",
  );
  assertEquals(
    r.texto,
    "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */ SELECT 1/0;\nSELECT 2;",
  );
  assertEquals(r.avisos, [
    "pg_cron emulado por stub (provisionar-efemero.cjs)",
  ]);
});

Deno.test("neutralizarProvisionamento: pg_net, variações de caixa/espaço, os dois juntos e várias ocorrências", () => {
  const dois = util.neutralizarProvisionamento(
    "create   extension\n  if not exists PG_NET ;\nCREATE EXTENSION IF NOT EXISTS pg_cron;\nCREATE EXTENSION IF NOT EXISTS pg_cron;",
  );
  assertEquals(
    dois.texto,
    [
      "/* [ci-banco] pg_net só vive dentro de comando agendado — sem instância aqui */",
      "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */",
      "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */",
    ].join("\n"),
  );
  // Ordem dos avisos: a da lista de neutralizações (pg_cron primeiro), uma vez cada.
  assertEquals(dois.avisos, [
    "pg_cron emulado por stub (provisionar-efemero.cjs)",
    "pg_net só vive dentro de comando agendado — sem instância aqui",
  ]);
});

Deno.test("neutralizarProvisionamento: sem linha de extensão devolve o texto igual e nenhum aviso; chamadas repetidas dão o mesmo resultado", () => {
  const sem = util.neutralizarProvisionamento(
    "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
  );
  assertEquals(sem, {
    texto: "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
    avisos: [],
  });
  const entrada = "CREATE EXTENSION IF NOT EXISTS pg_cron;";
  const a = util.neutralizarProvisionamento(entrada);
  const b = util.neutralizarProvisionamento(entrada);
  const c = util.neutralizarProvisionamento(entrada);
  assertEquals(b, a);
  assertEquals(c, a);
  assertEquals(a.avisos.length, 1);
});

// ---------------------------------------------------------------------------
// aplicarComProvisionamento — o ciclo nativo / emulado / pulado / falhou
// ---------------------------------------------------------------------------

const BUSCA = 'SET search_path = "$user", public, extensions';
const ARQUIVO_DA_LISTA = "20260807000000_reserva_com_expiracao.sql";
const NATIVO_FALTA_CRON = new Error('schema "cron" does not exist');

/** Cliente falso: `respostas` mapeia o texto da consulta -> erro a lançar. */
function clienteFalso(
  falhas: Record<string, Error | Error[]> = {},
  rollbackFalha = false,
) {
  const log: string[] = [];
  const contagem = new Map<string, number>();
  return {
    log,
    query: async (sql: string) => {
      log.push(sql);
      if (sql === "ROLLBACK" && rollbackFalha) throw new Error("sem transação");
      const falha = falhas[sql];
      if (falha) {
        const vez = contagem.get(sql) ?? 0;
        contagem.set(sql, vez + 1);
        const erro = Array.isArray(falha) ? falha[vez] : falha;
        if (erro) throw erro;
      }
      return { rows: [] };
    },
  };
}

Deno.test("aplicarComProvisionamento: nativo que passa — só SET search_path e o arquivo", async () => {
  const c = clienteFalso();
  const r = await util.aplicarComProvisionamento(
    c,
    ARQUIVO_DA_LISTA,
    "SELECT 1;",
  );
  assertEquals(r, { estado: "nativo" });
  assertEquals(c.log, [BUSCA, "SELECT 1;"]);
});

Deno.test("aplicarComProvisionamento: erro de SQL de verdade = falhou, com ROLLBACK e SEM segunda tentativa", async () => {
  const erro = new Error('relation "x" does not exist');
  const c = clienteFalso({ "SELECT bug;": erro });
  const r = await util.aplicarComProvisionamento(
    c,
    ARQUIVO_DA_LISTA,
    "SELECT bug;",
  );
  assertEquals(r.estado, "falhou");
  assertEquals(r.erro, erro);
  assertEquals(c.log, [BUSCA, "SELECT bug;", "ROLLBACK"]);
});

Deno.test("aplicarComProvisionamento: erro de provisionamento em arquivo FORA da lista também é falhou", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;";
  const c = clienteFalso({ [texto]: NATIVO_FALTA_CRON });
  const r = await util.aplicarComProvisionamento(
    c,
    "20260101000000_nao_listada.sql",
    texto,
  );
  assertEquals(r.estado, "falhou");
  assertEquals(c.log, [BUSCA, texto, "ROLLBACK"]);
});

Deno.test("aplicarComProvisionamento: lista + erro de provisionamento + UMA linha de extensão = emulado (reaplica comentada)", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;\nSELECT 1;";
  const neutro =
    "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */\nSELECT 1;";
  const c = clienteFalso({ [texto]: NATIVO_FALTA_CRON });
  const r = await util.aplicarComProvisionamento(c, ARQUIVO_DA_LISTA, texto);
  assertEquals(r.estado, "emulado");
  assertEquals(r.avisos, [
    "pg_cron emulado por stub (provisionar-efemero.cjs)",
  ]);
  assertEquals(r.erroNativo, NATIVO_FALTA_CRON);
  assertEquals(c.log, [BUSCA, texto, "ROLLBACK", BUSCA, neutro]);
});

Deno.test("aplicarComProvisionamento: duas linhas de extensão (pg_cron + pg_net) também emulam, com os dois avisos", async () => {
  const texto =
    "CREATE EXTENSION IF NOT EXISTS pg_cron;\nCREATE EXTENSION IF NOT EXISTS pg_net;";
  const c = clienteFalso({ [texto]: NATIVO_FALTA_CRON });
  const r = await util.aplicarComProvisionamento(c, ARQUIVO_DA_LISTA, texto);
  assertEquals(r.estado, "emulado");
  assertEquals(r.avisos.length, 2);
});

Deno.test("aplicarComProvisionamento: lista + erro de provisionamento mas NADA a neutralizar = pulado com o erro à vista", async () => {
  const texto = "SELECT cron.schedule('x', '* * * * *', 'select 1');";
  const erro = new Error("function cron.schedule(unknown) does not exist");
  const c = clienteFalso({ [texto]: erro });
  const r = await util.aplicarComProvisionamento(c, ARQUIVO_DA_LISTA, texto);
  assertEquals(r.estado, "pulado");
  assertEquals(r.erro, erro);
  assertEquals(c.log, [BUSCA, texto, "ROLLBACK"]); // sem segunda tentativa
});

Deno.test("aplicarComProvisionamento: a reaplicação esbarra em erro de provisionamento = pulado (com o erro da REAPLICAÇÃO)", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;\nSELECT 1;";
  const neutro =
    "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */\nSELECT 1;";
  const erroEmulado = new Error('schema "cron" does not exist (segunda)');
  const c = clienteFalso({ [texto]: NATIVO_FALTA_CRON, [neutro]: erroEmulado });
  const r = await util.aplicarComProvisionamento(c, ARQUIVO_DA_LISTA, texto);
  assertEquals(r.estado, "pulado");
  assertEquals(r.erro, erroEmulado);
  assertEquals(c.log.at(-1), "ROLLBACK");
});

Deno.test("aplicarComProvisionamento: a reaplicação falha por OUTRO motivo = falhou (com o erro da REAPLICAÇÃO), nunca pulado", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;\nSELECT 1/0;";
  const neutro =
    "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */\nSELECT 1/0;";
  const divisao = new Error("division by zero");
  const c = clienteFalso({ [texto]: NATIVO_FALTA_CRON, [neutro]: divisao });
  const r = await util.aplicarComProvisionamento(c, ARQUIVO_DA_LISTA, texto);
  assertEquals(r.estado, "falhou");
  assertEquals(r.erro, divisao);
});

Deno.test("aplicarComProvisionamento: ROLLBACK que falha (sem transação) não derruba o ciclo", async () => {
  const c = clienteFalso({ "SELECT bug;": new Error("boom") }, true);
  const r = await util.aplicarComProvisionamento(
    c,
    ARQUIVO_DA_LISTA,
    "SELECT bug;",
  );
  assertEquals(r.estado, "falhou");
});

// ---------------------------------------------------------------------------
// codigoSemLiteral / instrucoesDeNivelDeTopo — o tokenizador
// ---------------------------------------------------------------------------

Deno.test("codigoSemLiteral: comentário de linha some até o \\n (que fica); no fim do texto some inteiro", () => {
  assertEquals(util.codigoSemLiteral("-- um\nSELECT 1;"), "\nSELECT 1;");
  assertEquals(
    util.codigoSemLiteral("SELECT 1; -- fim sem quebra"),
    "SELECT 1; ",
  );
  assertEquals(util.codigoSemLiteral("-- só comentário"), "");
  assertEquals(util.codigoSemLiteral("SELECT 1 - 2;"), "SELECT 1 - 2;"); // um hífen só é operador
});

Deno.test("codigoSemLiteral: comentário de bloco some inteiro; sem fechamento come até o fim; `/` e `*` soltos ficam", () => {
  assertEquals(util.codigoSemLiteral("/* a */ SELECT /* b */ 1"), " SELECT  1");
  assertEquals(util.codigoSemLiteral("SELECT 1 /* nunca fecha"), "SELECT 1 ");
  assertEquals(util.codigoSemLiteral("SELECT 4 / 2 * 3;"), "SELECT 4 / 2 * 3;");
  // O fechamento é procurado DEPOIS da abertura: `/*/` não fecha sozinho.
  assertEquals(util.codigoSemLiteral("/*/ oculto */ ok"), " ok");
  assertEquals(util.codigoSemLiteral("a/**/b"), "ab");
});

Deno.test("codigoSemLiteral: string vira '' e esconde -- /* ; $$ de dentro; '' escapado não fecha", () => {
  assertEquals(util.codigoSemLiteral("SELECT 'abc';"), "SELECT '';");
  assertEquals(
    util.codigoSemLiteral("SELECT 'it''s; -- não é comentário';"),
    "SELECT '';",
  );
  assertEquals(
    util.codigoSemLiteral("SELECT '/* não */', 'x';"),
    "SELECT '', '';",
  );
  assertEquals(
    util.codigoSemLiteral("SELECT '$$ não é dollar';"),
    "SELECT '';",
  );
  assertEquals(util.codigoSemLiteral("SELECT '';"), "SELECT '';");
  assertEquals(
    util.codigoSemLiteral("SELECT 'a''''b' || 'c';"),
    "SELECT '' || '';",
  );
  // Sem fechamento: a string vai até o fim e o resto não vaza como código.
  assertEquals(
    util.codigoSemLiteral("SELECT 'aberta; DROP TABLE x;"),
    "SELECT ''",
  );
  // Depois da string o código volta ao normal, caractere a caractere.
  assertEquals(util.codigoSemLiteral("'a'b"), "''b");
  assertEquals(util.codigoSemLiteral("'a''"), "''"); // `''` colado no fim: continua dentro
});

Deno.test("codigoSemLiteral: dollar-quote anônimo e com tag viram UM espaço; a tag tem de fechar com a MESMA tag", () => {
  assertEquals(
    util.codigoSemLiteral("DO $$ BEGIN DROP TABLE x; END $$;"),
    "DO  ;",
  );
  assertEquals(
    util.codigoSemLiteral("DO $corpo$ x; $outro$ y; $corpo$;"),
    "DO  ;",
  );
  assertEquals(util.codigoSemLiteral("DO $_a$ ; $_a$ ;"), "DO   ;");
  // Sem fechamento: vai até o fim.
  assertEquals(util.codigoSemLiteral("SELECT $$ aberto ; DROP"), "SELECT  ");
  // `$1` (parâmetro) e `$` solto não são dollar-quote.
  assertEquals(util.codigoSemLiteral("SELECT $1, $2;"), "SELECT $1, $2;");
  assertEquals(util.codigoSemLiteral("SELECT 5 $ 3;"), "SELECT 5 $ 3;");
  // Um `$tag$` que aparece no MEIO do texto também abre dollar-quote.
  assertEquals(util.codigoSemLiteral("a $t$ x $t$ b"), "a   b");
  assertEquals(util.codigoSemLiteral("x$y$ z $y$"), "x ");
});

Deno.test("codigoSemLiteral: `$1` NÃO abre dollar-quote só porque há um `$$` mais adiante (a tag tem de começar no próprio `$`)", () => {
  // Sem a âncora do começo, o regex acharia o `$$` de DEPOIS, trataria `$1`
  // como abertura e engoliria o DROP — a prova de dupla aplicação deixaria de
  // ver o comando.
  assertEquals(
    util.codigoSemLiteral("SELECT $1; DROP TABLE x; DO $$ BEGIN END $$;"),
    "SELECT $1; DROP TABLE x; DO  ;",
  );
  assertEquals(
    util.instrucoesDeNivelDeTopo("SELECT $1; DROP TABLE x; DO $$ a $$;"),
    ["SELECT $1", "DROP TABLE x", "DO  "],
  );
});

Deno.test("codigoSemLiteral: texto vazio e texto sem nada especial passam intactos", () => {
  assertEquals(util.codigoSemLiteral(""), "");
  assertEquals(
    util.codigoSemLiteral("CREATE TABLE a (x int);"),
    "CREATE TABLE a (x int);",
  );
  assertEquals(util.codigoSemLiteral("é ã ç ✓"), "é ã ç ✓");
});

Deno.test("instrucoesDeNivelDeTopo: divide em `;` fora de literal/comentário, tira o espaço do COMEÇO e descarta vazias", () => {
  assertEquals(
    util.instrucoesDeNivelDeTopo(
      "CREATE TABLE a (x int);  \n  ALTER TABLE a ADD y int;;  ;\n",
    ),
    ["CREATE TABLE a (x int)", "ALTER TABLE a ADD y int"],
  );
  // Só o espaço do começo sai; o do fim fica.
  assertEquals(util.instrucoesDeNivelDeTopo("SELECT 1 ; SELECT 2"), [
    "SELECT 1 ",
    "SELECT 2",
  ]);
  // Pedaço de UM caractere não é descartado.
  assertEquals(util.instrucoesDeNivelDeTopo("x;y"), ["x", "y"]);
});

Deno.test("instrucoesDeNivelDeTopo: `;` dentro de string, dollar-quote e comentário NÃO divide", () => {
  const sql = [
    "-- um; dois",
    "INSERT INTO t VALUES ('a;b');",
    "/* x; y */ CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;",
  ].join("\n");
  assertEquals(util.instrucoesDeNivelDeTopo(sql), [
    "INSERT INTO t VALUES ('')",
    "CREATE FUNCTION f() RETURNS int AS   LANGUAGE plpgsql",
  ]);
});

// ---------------------------------------------------------------------------
// anexarAoSummaryDoJob
// ---------------------------------------------------------------------------

Deno.test("anexarAoSummaryDoJob: imprime o bloco com título e markdown SEM o espaço das pontas", () => {
  const original = Deno.env.get("GITHUB_STEP_SUMMARY");
  Deno.env.delete("GITHUB_STEP_SUMMARY");
  try {
    const r = capturar(() =>
      util.anexarAoSummaryDoJob("Prova H36", "  \n| a | b |\n  \n"),
    );
    assertEquals(r.linhas, ["\n### Prova H36\n\n| a | b |\n"]);
  } finally {
    if (original !== undefined) Deno.env.set("GITHUB_STEP_SUMMARY", original);
  }
});

Deno.test("anexarAoSummaryDoJob: com GITHUB_STEP_SUMMARY, ANEXA ao arquivo (não sobrescreve) o mesmo bloco", () => {
  const pasta = mkdtempSync(join(tmpdir(), "h36-summary-"));
  const arquivo = join(pasta, "summary.md");
  const original = Deno.env.get("GITHUB_STEP_SUMMARY");
  try {
    writeFileSync(arquivo, "ANTES\n");
    Deno.env.set("GITHUB_STEP_SUMMARY", arquivo);
    capturar(() => util.anexarAoSummaryDoJob("Um", " primeiro "));
    capturar(() => util.anexarAoSummaryDoJob("Dois", "segundo\n"));
    assertEquals(
      readFileSync(arquivo, "utf8"),
      "ANTES\n\n### Um\n\nprimeiro\n\n### Dois\n\nsegundo\n",
    );
  } finally {
    if (original === undefined) Deno.env.delete("GITHUB_STEP_SUMMARY");
    else Deno.env.set("GITHUB_STEP_SUMMARY", original);
    rmSync(pasta, { recursive: true, force: true });
  }
});

Deno.test("o rótulo da frente é o que aparece nos logs", () => {
  assertEquals(util.ROTULO, "ci-banco");
});
