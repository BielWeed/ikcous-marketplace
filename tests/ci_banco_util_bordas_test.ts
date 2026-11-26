// @ts-nocheck
/**
 * scripts/ci/banco/util.cjs — as BORDAS do utilitário que toda ferramenta do
 * CI-BANCO usa para obter conexão e aplicar migration num banco EFÊMERO.
 *
 * tests/ci_banco_trava_dupla_test.ts e tests/ci_banco_cron_emulado_test.ts
 * provam a trava de banco real e o caminho principal da reaplicação. Uma caça
 * por mutação (plantar um defeito de uma linha no util.cjs e ver se algum
 * teste cai) achou o que ficava sem teste, e este arquivo fecha:
 *
 *  - os códigos de saída de `sair` (OK 0, FALHOU 1, RECUSADO 2, INDETERMINADO
 *    5, estado desconhecido 1) — é o que o job do GitHub lê;
 *  - `DATABASE_URL` ausente recusa com a MENSAGEM de ausência (não com a de
 *    URL inválida);
 *  - a fila de migrations: só `<13 ou 14 dígitos>_*.sql`, nunca
 *    `rollback-manual-*`, nunca subpasta, na ordem de string;
 *  - o que `aplicarComProvisionamento` devolve em cada ramo (nativo, falhou,
 *    pulado sem linha de extensão, emulado, pulado depois da emulação, falhou
 *    depois da emulação), e que ROLLBACK sai antes de cada nova tentativa;
 *  - a neutralização de `CREATE EXTENSION ... pg_cron|pg_net` (inclusive no
 *    caractere 0 do arquivo e em chamadas repetidas);
 *  - `codigoSemLiteral` e `instrucoesDeNivelDeTopo`: comentário, string e
 *    dollar-quote opacos, abertos sem fechamento, `$1` que não é dollar-quote;
 *  - a tag de dollar-quote com DÍGITO (`$preflight_20261460000000$`): metade
 *    das migrations usa uma, e o regex antigo (`[A-Za-z_]*`) não a reconhecia
 *    — o corpo da função vazava como código e cada BEGIN/END de PL/pgSQL
 *    virava uma instrução de nível de topo. O corpus inteiro de
 *    supabase/migrations é conferido contra `dividirEmStatements`
 *    (scripts/publicacao/conferir-banco.cjs) como oráculo;
 *  - o resumo do job só vai para o arquivo quando GITHUB_STEP_SUMMARY existe.
 *
 * Nenhum teste abre conexão: o cliente de banco é um dublê.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  EXCECOES_DE_PROVISIONAMENTO,
  aplicarComProvisionamento,
  anexarAoSummaryDoJob,
  codigoSemLiteral,
  excecaoDeProvisionamento,
  instrucoesDeNivelDeTopo,
  lerDatabaseUrlEfemero,
  listarMigrations,
  neutralizarProvisionamento,
  sair,
} = require("../scripts/ci/banco/util.cjs");

/** Troca process.exit e console.log por dublês (o exit LANÇA, como em Node real
 * ele nunca volta) e devolve o que saiu. */
function capturando(executar) {
  const exitOriginal = process.exit;
  const logOriginal = console.log;
  const linhas = [];
  let codigoSaida;
  process.exit = (codigo) => {
    codigoSaida = codigo;
    throw new Error(`process.exit(${codigo})`);
  };
  console.log = (...a) => linhas.push(a.join(" "));
  try {
    executar();
    return { saiu: false, codigoSaida, texto: linhas.join("\n") };
  } catch {
    return { saiu: true, codigoSaida, texto: linhas.join("\n") };
  } finally {
    process.exit = exitOriginal;
    console.log = logOriginal;
  }
}

function comEnv(pares, executar) {
  const chaves = ["DATABASE_URL", "CI_BANCO_EFEMERO", "GITHUB_STEP_SUMMARY"];
  const antes = chaves.map((c) => [c, Deno.env.get(c)]);
  for (const c of chaves) Deno.env.delete(c);
  for (const [c, v] of Object.entries(pares)) Deno.env.set(c, v);
  try {
    return executar();
  } finally {
    for (const [c, v] of antes) {
      if (v === undefined) Deno.env.delete(c);
      else Deno.env.set(c, v);
    }
  }
}

Deno.test("sair: cada estado sai com o seu código e o estado desconhecido sai com 1 (nunca 0)", () => {
  const codigoDe = (estado) =>
    capturando(() => sair(estado, "detalhe")).codigoSaida;
  assertEquals(codigoDe("OK"), 0);
  assertEquals(codigoDe("FALHOU"), 1);
  assertEquals(codigoDe("RECUSADO"), 2);
  assertEquals(codigoDe("INDETERMINADO"), 5);
  assertEquals(codigoDe("ESTADO-QUE-NAO-EXISTE"), 1);
  const r = capturando(() => sair("FALHOU", "o detalhe"));
  assertStringIncludes(r.texto, "[ci-banco] FALHOU");
  assertStringIncludes(r.texto, "o detalhe");
});

Deno.test("lerDatabaseUrlEfemero: DATABASE_URL ausente recusa com a mensagem de AUSÊNCIA, mesmo com CI_BANCO_EFEMERO=1", () => {
  const r = comEnv({ CI_BANCO_EFEMERO: "1" }, () =>
    capturando(() => lerDatabaseUrlEfemero()),
  );
  assertEquals(r.codigoSaida, 2);
  assertStringIncludes(r.texto, "DATABASE_URL ausente");
  assert(!r.texto.includes("não é uma URL"), r.texto);
});

Deno.test("lerDatabaseUrlEfemero: host de Supabase gerenciado recusa em qualquer forma (igual, subdomínio, pooler); localhost passa", () => {
  const com = (url) =>
    comEnv({ DATABASE_URL: url, CI_BANCO_EFEMERO: "1" }, () =>
      capturando(() => lerDatabaseUrlEfemero()),
    );
  for (const url of [
    "postgresql://u:p@supabase.co:5432/postgres",
    "postgresql://u:p@db.abc.supabase.co:5432/postgres",
    "postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
    "postgresql://u:p@x.supabase.net:5432/postgres",
    "postgresql://u:p@supabase.co.evil.example:5432/postgres",
  ]) {
    const r = com(url);
    assertEquals(r.codigoSaida, 2, url);
    assertStringIncludes(r.texto, "NUNCA conecta a banco real");
  }
  for (const url of [
    "postgresql://u:p@localhost:5432/postgres",
    "postgresql://u:p@127.0.0.1:5432/postgres",
    "postgresql://u:p@postgres:5432/postgres",
  ]) {
    const r = com(url);
    assertEquals(r.saiu, false, url);
  }
});

Deno.test("listarMigrations: só <13 ou 14 dígitos>_*.sql da raiz, na ordem de string; rollback-manual, subpasta, outro sufixo e prefixo curto ficam de fora", () => {
  const pasta = Deno.makeTempDirSync();
  try {
    const escrever = (nome) => Deno.writeTextFileSync(`${pasta}/${nome}`, "x");
    escrever("20260102000000_b.sql");
    escrever("2026110000000_treze_digitos.sql");
    escrever("20260101000000_a.sql");
    escrever("rollback-manual-20260101000000_a.sql");
    escrever("20260103000000_c.md");
    escrever("readme.sql");
    escrever("2026_curto.sql");
    Deno.mkdirSync(`${pasta}/_arquivadas`);
    Deno.writeTextFileSync(`${pasta}/_arquivadas/20260104000000_d.sql`, "x");
    const nomes = listarMigrations(pasta).map((c) => c.split(/[\\/]/).pop());
    assertEquals(nomes, [
      "20260101000000_a.sql",
      "20260102000000_b.sql",
      "2026110000000_treze_digitos.sql",
    ]);
  } finally {
    Deno.removeSync(pasta, { recursive: true });
  }
});

const ARQUIVO_COM_EXCECAO = "20260807000000_reserva_com_expiracao.sql";

Deno.test("excecaoDeProvisionamento: só arquivo da lista E mensagem de provisionamento; mensagem ausente ou de SQL real não", () => {
  assert(Object.hasOwn(EXCECOES_DE_PROVISIONAMENTO, ARQUIVO_COM_EXCECAO));
  assertEquals(
    excecaoDeProvisionamento(
      ARQUIVO_COM_EXCECAO,
      'schema "cron" does not exist',
    ),
    true,
  );
  assertEquals(
    excecaoDeProvisionamento(
      ARQUIVO_COM_EXCECAO,
      'relation "x" does not exist',
    ),
    false,
  );
  assertEquals(excecaoDeProvisionamento(ARQUIVO_COM_EXCECAO, undefined), false);
  assertEquals(
    excecaoDeProvisionamento(
      "20260101000000_qualquer.sql",
      'schema "cron" does not exist',
    ),
    false,
  );
});

Deno.test("neutralizarProvisionamento: troca só o comando de extensão por comentário de BLOCO (o código da mesma linha continua), inclusive no caractere 0 e em chamadas repetidas", () => {
  const sozinho = "CREATE EXTENSION IF NOT EXISTS pg_cron;";
  for (let vez = 0; vez < 3; vez++) {
    const r = neutralizarProvisionamento(sozinho);
    assertEquals(r.avisos, [
      "pg_cron emulado por stub (provisionar-efemero.cjs)",
    ]);
    assertEquals(
      r.texto,
      "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */",
    );
  }
  const misto = neutralizarProvisionamento(
    "create   extension if not exists PG_NET ;\nCREATE EXTENSION IF NOT EXISTS pg_cron; SELECT 1/0;",
  );
  assertEquals(misto.avisos.length, 2);
  assertStringIncludes(
    misto.texto,
    "pg_net só vive dentro de comando agendado",
  );
  assertStringIncludes(misto.texto, " */ SELECT 1/0;");
  assert(!/create\s+extension/i.test(misto.texto));
  assertEquals(neutralizarProvisionamento("SELECT 1;"), {
    texto: "SELECT 1;",
    avisos: [],
  });
});

/** Cliente falso: cada consulta é anotada; `falhas` decide quais lançam. */
function clienteFalso(falhas = []) {
  const consultas = [];
  return {
    consultas,
    query: async (sql) => {
      consultas.push(sql);
      const falha = falhas.find((f) => f.quando(sql, consultas.length));
      if (falha) throw new Error(falha.mensagem);
      return {};
    },
  };
}
const PROVISIONAMENTO = 'schema "cron" does not exist';

Deno.test("aplicarComProvisionamento: nativo aplica e devolve 'nativo' sem ROLLBACK", async () => {
  const c = clienteFalso();
  const r = await aplicarComProvisionamento(
    c,
    ARQUIVO_COM_EXCECAO,
    "SELECT 1;",
  );
  assertEquals(r, { estado: "nativo" });
  assertEquals(c.consultas.length, 2);
  assertEquals(c.consultas[1], "SELECT 1;");
});

Deno.test("aplicarComProvisionamento: erro de SQL real fora da lista é 'falhou' com o erro, e o ROLLBACK sai", async () => {
  const c = clienteFalso([
    { quando: (sql) => sql === "SELECT 1/0;", mensagem: "division by zero" },
  ]);
  const r = await aplicarComProvisionamento(
    c,
    "20260101000000_x.sql",
    "SELECT 1/0;",
  );
  assertEquals(r.estado, "falhou");
  assertEquals(r.erro.message, "division by zero");
  assert(c.consultas.includes("ROLLBACK"));
});

Deno.test("aplicarComProvisionamento: erro de provisionamento SEM linha de extensão a neutralizar é 'pulado' com o erro nativo (não tenta de novo)", async () => {
  const c = clienteFalso([
    {
      quando: (sql) => sql === "SELECT cron.schedule();",
      mensagem: PROVISIONAMENTO,
    },
  ]);
  const r = await aplicarComProvisionamento(
    c,
    ARQUIVO_COM_EXCECAO,
    "SELECT cron.schedule();",
  );
  assertEquals(r.estado, "pulado");
  assertEquals(r.erro.message, PROVISIONAMENTO);
  assertEquals(
    c.consultas.filter((s) => s === "SELECT cron.schedule();").length,
    1,
    "sem linha de extensão não há 2ª tentativa",
  );
});

const COM_EXTENSAO =
  "CREATE EXTENSION IF NOT EXISTS pg_cron; SELECT cron.schedule();";

Deno.test("aplicarComProvisionamento: com linha de extensão, repete com ela comentada e devolve 'emulado' com os avisos", async () => {
  const c = clienteFalso([
    { quando: (sql) => sql === COM_EXTENSAO, mensagem: PROVISIONAMENTO },
  ]);
  const r = await aplicarComProvisionamento(
    c,
    ARQUIVO_COM_EXCECAO,
    COM_EXTENSAO,
  );
  assertEquals(r.estado, "emulado");
  assertEquals(r.avisos, [
    "pg_cron emulado por stub (provisionar-efemero.cjs)",
  ]);
  assertEquals(r.erroNativo.message, PROVISIONAMENTO);
  assert(c.consultas.includes("ROLLBACK"));
  assertStringIncludes(c.consultas.at(-1), "/* [ci-banco] pg_cron emulado");
});

Deno.test("aplicarComProvisionamento: se a reaplicação ainda esbarra em provisionamento é 'pulado'; se esbarra em SQL real é 'falhou' (e nunca o contrário)", async () => {
  const falhaNativa = {
    quando: (sql) => sql === COM_EXTENSAO,
    mensagem: PROVISIONAMENTO,
  };
  const pulado = await aplicarComProvisionamento(
    clienteFalso([
      falhaNativa,
      {
        quando: (sql) => sql.includes("/* [ci-banco]"),
        mensagem: PROVISIONAMENTO,
      },
    ]),
    ARQUIVO_COM_EXCECAO,
    COM_EXTENSAO,
  );
  assertEquals(pulado.estado, "pulado");
  assertEquals(pulado.erro.message, PROVISIONAMENTO);

  const falhou = await aplicarComProvisionamento(
    clienteFalso([
      falhaNativa,
      {
        quando: (sql) => sql.includes("/* [ci-banco]"),
        mensagem: "syntax error",
      },
    ]),
    ARQUIVO_COM_EXCECAO,
    COM_EXTENSAO,
  );
  assertEquals(falhou.estado, "falhou");
  assertEquals(falhou.erro.message, "syntax error");
});

Deno.test("codigoSemLiteral: comentário, string e dollar-quote ficam opacos; o que não fecha come o resto; $1 não é dollar-quote", () => {
  const casos = [
    ["SELECT 1 -- x\nSELECT 2", "SELECT 1 \nSELECT 2"],
    ["SELECT 1 -- sem quebra", "SELECT 1 "],
    ["-- só comentário", ""],
    ["A /* x */ B", "A  B"],
    ["A /* aberto", "A "],
    ["/* -- */ A", " A"],
    ["x = 'it''s' ;", "x = '' ;"],
    ["x = 'aberta", "x = ''"],
    ["'a -- b' c", "'' c"],
    ["'x' -- 'y'\n'z'", "'' \n''"],
    ["a $$ corpo; -- $$ b", "a   b"],
    ["$fn$ x $fn$ y", "  y"],
    ["a $$ aberto", "a  "],
    ["$1 + $2", "$1 + $2"],
  ];
  for (const [entrada, esperado] of casos) {
    assertEquals(codigoSemLiteral(entrada), esperado, JSON.stringify(entrada));
  }
});

Deno.test("instrucoesDeNivelDeTopo: parte no ';' de fora de literal, tira o espaço do começo e descarta pedaço vazio", () => {
  assertEquals(instrucoesDeNivelDeTopo("SELECT 1;\n  INSERT x; ; ;  \n"), [
    "SELECT 1",
    "INSERT x",
  ]);
  assertEquals(instrucoesDeNivelDeTopo("SELECT 'a;b'; DROP x"), [
    "SELECT ''",
    "DROP x",
  ]);
  // pedaço de UM caractere é instrução válida (não pode ser filtrado como vazio)
  assertEquals(instrucoesDeNivelDeTopo("x; y"), ["x", "y"]);
  assertEquals(instrucoesDeNivelDeTopo(";;;"), []);
  assertEquals(instrucoesDeNivelDeTopo("-- nada\n"), []);
});

Deno.test("codigoSemLiteral: tag de dollar-quote com dígito no meio ou no fim é tag (o corpo some inteiro)", () => {
  const casos = [
    [
      "DO $preflight_20261460000000$ BEGIN x; END $preflight_20261460000000$;",
      "DO  ;",
    ],
    ["$a1b$ BEGIN; $a1b$ y", "  y"],
    ["$t9$ END; $t9$", " "],
    // Letra fora do ASCII também abre tag no Postgres (identificador).
    ["$função$ BEGIN; $função$ z", "  z"],
  ];
  for (const [entrada, esperado] of casos) {
    assertEquals(codigoSemLiteral(entrada), esperado, JSON.stringify(entrada));
  }
  assertEquals(
    instrucoesDeNivelDeTopo(
      "CREATE FUNCTION f() RETURNS void AS $fn_2026$\nBEGIN\n  PERFORM 1;\nEND;\n$fn_2026$ LANGUAGE plpgsql;\nSELECT 1;",
    ),
    ["CREATE FUNCTION f() RETURNS void AS   LANGUAGE plpgsql", "SELECT 1"],
  );
});

Deno.test("codigoSemLiteral: `$` seguido de DÍGITO é parâmetro, nunca tag (nem `$1$`); `$$` continua sendo dollar-quote", () => {
  // A tag segue a regra do identificador sem aspas: não começa com dígito.
  assertEquals(codigoSemLiteral("SELECT $1, $10 ; $2"), "SELECT $1, $10 ; $2");
  assertEquals(codigoSemLiteral("$1$ a; $1$"), "$1$ a; $1$");
  assertEquals(instrucoesDeNivelDeTopo("$1$ a; $1$"), ["$1$ a", "$1$"]);
  assertEquals(codigoSemLiteral("DO $$ BEGIN; END $$;"), "DO  ;");
  assertEquals(codigoSemLiteral("a $$ x $$ b $_$ y $_$ c"), "a   b   c");
});

/** Primeira palavra de cada instrução, em caixa alta. */
function primeiraPalavra(instrucao) {
  return (/^[A-Za-z]+/.exec(instrucao)?.[0] ?? "").toUpperCase();
}

/** O mesmo filtro de "statement vazio" de scripts/publicacao/conferir-banco.cjs
 * (lá não é exportado). */
function semComentarios(sql) {
  return sql
    .replace(/--[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

const CONTROLE_DE_TRANSACAO = new Set([
  "BEGIN",
  "END",
  "COMMIT",
  "ROLLBACK",
  "START",
]);

Deno.test("instrucoesDeNivelDeTopo: em TODAS as migrations, BEGIN/END/COMMIT de nível de topo são os mesmos que o lexer de conferir-banco vê (nenhum vazado de corpo de função)", () => {
  const {
    dividirEmStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const pasta = new URL("../supabase/migrations/", import.meta.url);
  const arquivos = [...Deno.readDirSync(pasta)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
  // Guarda contra passar no vazio: o corpus existe e exercita a tag com dígito.
  assert(arquivos.length > 200, `só ${arquivos.length} migrations lidas`);
  const textos = arquivos.map((nome) => [
    nome,
    Deno.readTextFileSync(new URL(nome, pasta)),
  ]);
  assert(
    textos.some(([, t]) =>
      /\$[A-Za-z_][A-Za-z_0-9]*[0-9][A-Za-z_0-9]*\$/.test(t),
    ),
    "nenhuma migration com tag de dollar-quote com dígito: o teste não prova nada",
  );

  const divergentes = [];
  const sequenciaDiferente = [];
  for (const [nome, texto] of textos) {
    const palavrasDoUtil = instrucoesDeNivelDeTopo(texto).map(primeiraPalavra);
    const palavrasDoOraculo = dividirEmStatements(texto)
      .map(semComentarios)
      .filter((s) => s !== "")
      .map(primeiraPalavra);
    const doUtil = palavrasDoUtil.filter((p) => CONTROLE_DE_TRANSACAO.has(p));
    const doOraculo = palavrasDoOraculo.filter((p) =>
      CONTROLE_DE_TRANSACAO.has(p),
    );
    if (doUtil.join(",") !== doOraculo.join(",")) {
      divergentes.push(
        `${nome}: util=${doUtil.length} [${doUtil.slice(0, 4)}…] oráculo=[${doOraculo}]`,
      );
    }
    // Mais forte: a mesma lista de instruções, uma a uma, pela 1ª palavra.
    if (palavrasDoUtil.join(",") !== palavrasDoOraculo.join(",")) {
      sequenciaDiferente.push(
        `${nome}: util=${palavrasDoUtil.length} oráculo=${palavrasDoOraculo.length}`,
      );
    }
  }
  assertEquals(divergentes, []);
  assertEquals(sequenciaDiferente, []);
});

Deno.test("nenhum script de scripts/ reconhece tag de dollar-quote com o regex sem dígito (`$[A-Za-z_]*$`)", () => {
  // O mesmo regex tinha sido copiado para outras provas de banco. Esta trava
  // impede a cópia de voltar: a forma certa é a de PADRAO_TAG_DOLLAR_QUOTE.
  const defeituoso = /\\\$\(?\[(?:A-Za-z_|a-zA-Z_)\]\*\)?\\\$/;
  const raiz = new URL("../scripts/", import.meta.url);
  const achados = [];
  const varrer = (pasta) => {
    for (const e of Deno.readDirSync(pasta)) {
      if (e.isDirectory) {
        varrer(new URL(`${e.name}/`, pasta));
      } else if (/\.(c|m)?js$/.test(e.name)) {
        const url = new URL(e.name, pasta);
        Deno.readTextFileSync(url)
          .split("\n")
          .forEach((linha, n) => {
            if (defeituoso.test(linha)) {
              achados.push(`${url.pathname.split("/scripts/")[1]}:${n + 1}`);
            }
          });
      }
    }
  };
  varrer(raiz);
  assertEquals(achados, []);
});

Deno.test("anexarAoSummaryDoJob: com GITHUB_STEP_SUMMARY grava o bloco no arquivo; sem a variável só imprime", () => {
  const dir = Deno.makeTempDirSync();
  const resumo = `${dir}/resumo.md`;
  try {
    const impresso = [];
    const log = console.log;
    const cwdAntes = Deno.cwd();
    console.log = (...a) => impresso.push(a.join(" "));
    try {
      // Sem a variável, um appendFileSync(undefined, ...) gravaria um arquivo
      // chamado "undefined" na pasta ATUAL: roda de dentro da pasta temporária
      // e confere que ela segue vazia.
      Deno.chdir(dir);
      comEnv({}, () => anexarAoSummaryDoJob("Titulo", "  corpo  "));
      assertEquals(impresso.length, 1);
      assertStringIncludes(impresso[0], "### Titulo");
      assertEquals(
        [...Deno.readDirSync(dir)].length,
        0,
        "nada gravado sem a variável",
      );
      Deno.chdir(cwdAntes);
      comEnv({ GITHUB_STEP_SUMMARY: resumo }, () =>
        anexarAoSummaryDoJob("Titulo", "  corpo  "),
      );
    } finally {
      Deno.chdir(cwdAntes);
      console.log = log;
    }
    assertEquals(Deno.readTextFileSync(resumo), "\n### Titulo\n\ncorpo\n");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
