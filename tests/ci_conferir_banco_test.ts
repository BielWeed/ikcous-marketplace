// @ts-nocheck
/**
 * O workflow "Conferir banco da loja" (.github/workflows/conferir-banco-da-loja.yml)
 * e o script que ele chama (scripts/publicacao/conferir-banco.cjs) — a
 * ferramenta que deixa o coordenador rodar, sob demanda, as conferências de
 * pré/pós-publicação que antes eram feitas à mão no SQL Editor
 * (docs/runbooks/publicar-painel-cartao-devolucoes.md §0/§1).
 *
 * O QUE ESTES TESTES MEDEM:
 *
 * 1. O workflow, do jeito que está no arquivo: só dispara à mão
 *    (workflow_dispatch, nunca push/PR), nenhum `node -e` inline (a lição de
 *    aplicar-migrations.yml: crase dentro de `node -e "…"` vira substituição
 *    de comando do bash), a lista `choice` de `consulta` bate com os arquivos
 *    de `scripts/publicacao/consultas/` (mais "backups"), e o job do ledger só
 *    roda com `confirmar == 'GRAVAR'`.
 * 2. `contarStatements`/`dividirEmStatements`: cada arquivo de consulta real
 *    (inclusive os do ledger) tem exatamente 1 statement — é essa contagem
 *    que garante que a API (que só devolve o resultado do ÚLTIMO statement)
 *    nunca devolve outra coisa que não a consulta pedida.
 * 3. `comGuardaSomenteLeitura`: o guard (`BEGIN READ ONLY;`, sem COMMIT) está
 *    na frente de toda consulta de conferência.
 * 4. `main()`, com `fetch` global stubado: o request tem o formato certo (URL,
 *    método, corpo com o guard e `read_only:true` nas consultas; SEM os dois
 *    na gravação do ledger), erro no corpo vira `exit(1)`, e o token NUNCA
 *    aparece em nada que o script imprime.
 */
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`;
const CONSULTAS_DIR = `${RAIZ}/scripts/publicacao/consultas`;
const SCRIPT = "../scripts/publicacao/conferir-banco.cjs";

const TOKEN_FALSO = "sbp_segredo-de-teste-nunca-pode-aparecer-no-log";

function semComentarios(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** Lista os nomes (sem `.sql`) dos arquivos de consulta que NÃO são do ledger. */
async function listarNomesDeConsultaNoDisco(): Promise<string[]> {
  const nomes: string[] = [];
  for await (const entrada of Deno.readDir(CONSULTAS_DIR)) {
    if (
      entrada.isFile &&
      entrada.name.endsWith(".sql") &&
      !entrada.name.startsWith("ledger-")
    ) {
      nomes.push(entrada.name.slice(0, -4));
    }
  }
  return nomes.sort();
}

Deno.test("o workflow, do jeito que está no arquivo", async (t) => {
  const yaml = semComentarios(await Deno.readTextFile(WORKFLOW));

  await t.step(
    "só dispara à mão: workflow_dispatch e nenhum gatilho automático",
    () => {
      assertStringIncludes(yaml, "workflow_dispatch:");
      for (const gatilho of [
        "\n  push:",
        "\n  pull_request:",
        "\n  schedule:",
        "\n  release:",
      ]) {
        assert(
          !yaml.includes(gatilho),
          `gatilho automático no workflow: ${gatilho.trim()}`,
        );
      }
    },
  );

  await t.step("nenhum `node -e` inline — a lógica mora no script", () => {
    assert(!yaml.includes("node -e"), "o workflow chama node -e inline");
    assertStringIncludes(yaml, "node scripts/publicacao/conferir-banco.cjs");
  });

  await t.step(
    "a lista `choice` de `consulta` bate com os arquivos da pasta, mais backups",
    async () => {
      const arquivosNoDisco = await listarNomesDeConsultaNoDisco();
      const m = yaml.match(
        /* eslint-disable-next-line security/detect-unsafe-regex --
         * Entrada é sempre o próprio conferir-banco-da-loja.yml deste
         * repositório (poucos KB), nunca rede — mesma classe de justificativa
         * de tests/migration_a_loja_declara_a_sua_configuracao_publica_test.ts. */
        /consulta:[\s\S]*?options:\n((?:\s{6,}- .+\n?)+)/,
      );
      assert(m, "não achei a lista `options` do input `consulta`");
      const opcoes = m[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^- /, ""));
      assertEquals(
        opcoes.filter((o) => o !== "backups").sort(),
        arquivosNoDisco,
        "a lista `options` de `consulta` não bate com os arquivos de scripts/publicacao/consultas/",
      );
      assert(opcoes.includes("backups"), "falta a opção `backups`");
      // Regressão específica: 26/09/2026, a checagem de CPF-no-endereço
      // (janela 23/09-26/09) entrou depois das 8 consultas originais — sem
      // isto, um refactor que trocasse a extração da lista de `options`
      // continuaria "batendo" mesmo perdendo esta entrada, porque o teste
      // acima compara CONTRA o disco, não contra um valor fixo.
      assert(
        opcoes.includes("3a-cpf-no-endereco"),
        "falta a opção `3a-cpf-no-endereco` (janela 23/09-26/09 do CPF no endereço)",
      );
    },
  );

  await t.step("o projeto_ref por padrão é o da loja", () => {
    assertStringIncludes(yaml, 'default: "cafkrminfnokvgjqtkle"');
  });

  await t.step(
    "o job do ledger só roda com gravar_ledger != nao E confirmar == GRAVAR",
    () => {
      const iLedger = yaml.indexOf("\n  ledger:");
      assert(iLedger > 0, "não achei o job `ledger`");
      const blocoLedger = yaml.slice(iLedger);
      assertStringIncludes(blocoLedger, "inputs.confirmar == 'GRAVAR'");
      assertStringIncludes(blocoLedger, "inputs.gravar_ledger != 'nao'");
    },
  );

  await t.step("gravar_ledger é choice fechado nao/72-74/75-78", () => {
    assertStringIncludes(
      yaml,
      "options:\n          - nao\n          - 72-74\n          - 75-78",
    );
  });

  await t.step("o segredo é o SUPABASE_ACCESS_TOKEN, nunca literal", () => {
    assertStringIncludes(yaml, "${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    assert(
      !/SUPABASE_ACCESS_TOKEN:\s*["']?(sbp_|eyJ)/.test(yaml),
      "token literal no workflow",
    );
  });
});

Deno.test("dividirEmStatements/contarStatements — o guard de 1-statement-só", async (t) => {
  const { contarStatements, dividirEmStatements } = require(SCRIPT);

  await t.step("um SELECT simples conta 1", () => {
    assertEquals(contarStatements("SELECT 1;"), 1);
  });

  await t.step("SELECT sem ; final ainda conta 1", () => {
    assertEquals(contarStatements("SELECT 1"), 1);
  });

  await t.step("dois statements de verdade contam 2", () => {
    assertEquals(contarStatements("SELECT 1; SELECT 2;"), 2);
  });

  await t.step(
    "`;` dentro de string $tag$...$tag$ não conta como fim de statement",
    () => {
      const sql = "SELECT $marcador$a; b; c$marcador$ AS x;";
      assertEquals(contarStatements(sql), 1);
    },
  );

  await t.step("`;` dentro de comentário de linha não conta", () => {
    assertEquals(contarStatements("SELECT 1; -- troque por 2; e 3;\n"), 1);
  });

  await t.step("`;` dentro de string simples '...' não conta", () => {
    assertEquals(contarStatements("SELECT 'a;b;c' AS x;"), 1);
  });

  await t.step(
    "todo arquivo real de scripts/publicacao/consultas/ (inclusive ledger) tem exatamente 1 statement",
    async () => {
      for await (const entrada of Deno.readDir(CONSULTAS_DIR)) {
        if (!entrada.isFile || !entrada.name.endsWith(".sql")) continue;
        const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${entrada.name}`);
        assertEquals(
          contarStatements(sql),
          1,
          `${entrada.name} deveria ter exatamente 1 statement`,
        );
      }
    },
  );

  await t.step("dividirEmStatements devolve os pedaços na ordem", () => {
    const pedacos = dividirEmStatements("SELECT 1; SELECT 2;");
    assertEquals(pedacos.length, 2);
    assertStringIncludes(pedacos[0], "SELECT 1");
    assertStringIncludes(pedacos[1], "SELECT 2");
  });

  await t.step(
    "3a-cpf-no-endereco.sql só devolve contagem — nenhum CPF na saída",
    async () => {
      const sql = await Deno.readTextFile(
        `${CONSULTAS_DIR}/3a-cpf-no-endereco.sql`,
      );
      // A lista de SELECT só tem colunas de data e count(*)/count(*) FILTER —
      // nenhuma delas devolve o valor do CPF. Se alguém adicionar uma coluna
      // que projete `... ->> 'cpf'` FORA de um count/regexp (ex.: para
      // "conferir visualmente"), este teste tem de acusar.
      // Cada coluna do SELECT mora numa linha (o estilo deste diretório) —
      // qualquer linha que toque `->> 'cpf'` tem de estar dentro de um
      // `count(`/`regexp_replace(` NA MESMA linha; senão é o valor cru
      // vazando para a saída.
      for (const linha of sql.split("\n")) {
        if (/->>?\s*'cpf'/i.test(linha)) {
          assert(
            /count\(|regexp_replace\(/i.test(linha),
            `esta linha projeta o CPF fora de count()/regexp_replace(): ${linha.trim()}`,
          );
        }
      }
      assertStringIncludes(sql, "count(*)");
    },
  );
});

Deno.test("comGuardaSomenteLeitura — o guard read-only por construção", () => {
  const { comGuardaSomenteLeitura } = require(SCRIPT);
  const guardada = comGuardaSomenteLeitura("SELECT 1;");
  assertStringIncludes(guardada, "BEGIN READ ONLY;\n");
  assert(
    guardada.startsWith("BEGIN READ ONLY;"),
    "o guard tem de vir ANTES da consulta",
  );
  assert(
    !/COMMIT/i.test(guardada),
    "o guard não pode levar COMMIT (o design é 'sem COMMIT')",
  );
  assertStringIncludes(guardada, "SELECT 1;");
});

Deno.test("extrairLinhas — os dois formatos de resposta da API", () => {
  const { extrairLinhas } = require(SCRIPT);

  const achatado = JSON.stringify([{ um: 1, rotulo: "ok" }]);
  assertEquals(extrairLinhas(achatado), [{ um: 1, rotulo: "ok" }]);

  const porStatement = JSON.stringify([
    { columns: [], rows: [] },
    { columns: ["um", "rotulo"], rows: [[1, "ok"]] },
  ]);
  assertEquals(extrairLinhas(porStatement), [{ um: 1, rotulo: "ok" }]);
});

Deno.test("resumoDeBackups — só o que a §5 pede, nada de segredo", () => {
  const { resumoDeBackups } = require(SCRIPT);
  const json = {
    pitr_enabled: true,
    backups: [
      { status: "COMPLETED", inserted_at: "2026-09-20T03:00:00Z" },
      { status: "COMPLETED", inserted_at: "2026-09-25T03:00:00Z" },
      { status: "FAILED", inserted_at: "2026-09-24T03:00:00Z" },
    ],
  };
  const resumo = resumoDeBackups(json);
  assertEquals(resumo.ultimoEm, "2026-09-25T03:00:00Z");
  assertEquals(resumo.status, "COMPLETED");
  assertEquals(resumo.pitrHabilitado, true);
  assertEquals(resumo.total, 3);
});

/** Captura tudo que o script manda para console.log/error, para a checagem
 * "o token nunca aparece" e para inspecionar a tabela impressa. */
function comConsoleCapturado<T>(executar: () => Promise<T>): Promise<{
  valor?: T;
  saida: string;
  erro?: unknown;
}> {
  const logOriginal = console.log;
  const errOriginal = console.error;
  const linhas: string[] = [];
  console.log = (...args: unknown[]) => linhas.push(args.join(" "));
  console.error = (...args: unknown[]) => linhas.push(args.join(" "));
  return (async () => {
    try {
      const valor = await executar();
      return { valor, saida: linhas.join("\n") };
    } catch (erro) {
      return { saida: linhas.join("\n"), erro };
    } finally {
      console.log = logOriginal;
      console.error = errOriginal;
    }
  })();
}

/** Troca process.exit por um stub que LANÇA (mesmo padrão de
 * tests/ci_banco_trava_dupla_test.ts), guardando o código de saída. */
function comSaidaCapturada<T>(executar: () => Promise<T>): Promise<{
  retornou: boolean;
  valor?: T;
  codigoSaida?: number;
}> {
  const original = process.exit;
  let codigoSaida: number | undefined;
  // @ts-ignore -- stub de teste
  process.exit = (codigo?: number) => {
    codigoSaida = codigo;
    throw new Error(`process.exit(${codigo})`);
  };
  return (async () => {
    try {
      const valor = await executar();
      return { retornou: true, valor };
    } catch {
      return { retornou: false, codigoSaida };
    } finally {
      process.exit = original;
    }
  })();
}

const CHAVES = ["SUPABASE_ACCESS_TOKEN", "PROJETO_REF", "CONSULTA", "LEDGER"];
function comEnv<T>(
  pares: Record<string, string | undefined>,
  executar: () => Promise<T>,
) {
  const anteriores = CHAVES.map((c) => [c, Deno.env.get(c)] as const);
  for (const c of CHAVES) Deno.env.delete(c);
  for (const [c, v] of Object.entries(pares))
    if (v !== undefined) Deno.env.set(c, v);
  return (async () => {
    try {
      return await executar();
    } finally {
      for (const [c, v] of anteriores) {
        if (v === undefined) Deno.env.delete(c);
        else Deno.env.set(c, v);
      }
    }
  })();
}

Deno.test("main() — request certo, stubando fetch", async (t) => {
  const { main } = require(SCRIPT);

  await t.step(
    "consulta real: guard + read_only:true na URL certa; sem exit; sem vazar o token",
    async () => {
      const chamadas: Array<{ url: string; opts: RequestInit }> = [];
      const fetchOriginal = globalThis.fetch;
      // @ts-ignore -- stub
      globalThis.fetch = async (url: string, opts: RequestInit) => {
        chamadas.push({ url, opts });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ base_74: 1, t75: null }]),
        };
      };
      try {
        const { saida } = await comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              PROJETO_REF: "cafkrminfnokvgjqtkle",
              CONSULTA: "0a-antes-base-e-nada-aplicado",
            },
            () => main(),
          ),
        );
        assertEquals(chamadas.length, 1);
        assertStringIncludes(
          chamadas[0].url,
          "/v1/projects/cafkrminfnokvgjqtkle/database/query",
        );
        assertEquals(chamadas[0].opts.method, "POST");
        const corpo = JSON.parse(String(chamadas[0].opts.body));
        assertStringIncludes(corpo.query, "BEGIN READ ONLY;\n");
        assertEquals(corpo.read_only, true);
        assertStringIncludes(
          String(chamadas[0].opts.headers.Authorization),
          `Bearer ${TOKEN_FALSO}`,
        );
        assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída");
        assertStringIncludes(saida, "base_74");
      } finally {
        globalThis.fetch = fetchOriginal;
      }
    },
  );

  await t.step("erro no corpo -> exit(1), e o token não vaza", async () => {
    const fetchOriginal = globalThis.fetch;
    // @ts-ignore -- stub
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: "boom", message: "deu ruim" }),
    });
    try {
      const { saida, valor } = await comConsoleCapturado(() =>
        comEnv(
          {
            SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
            PROJETO_REF: "cafkrminfnokvgjqtkle",
            CONSULTA: "0a-antes-base-e-nada-aplicado",
          },
          () => comSaidaCapturada(() => main()),
        ),
      );
      assertEquals(valor?.retornou, false);
      assertEquals(valor?.codigoSaida, 1);
      assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída de erro");
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  await t.step("HTTP não-2xx -> exit(1)", async () => {
    const fetchOriginal = globalThis.fetch;
    // @ts-ignore -- stub
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => "erro interno",
    });
    try {
      const { valor } = await comConsoleCapturado(() =>
        comEnv(
          {
            SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
            PROJETO_REF: "cafkrminfnokvgjqtkle",
            CONSULTA: "0a-antes-base-e-nada-aplicado",
          },
          () => comSaidaCapturada(() => main()),
        ),
      );
      assertEquals(valor?.retornou, false);
      assertEquals(valor?.codigoSaida, 1);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  await t.step(
    "ledger: grava SEM o guard/read_only, depois confere 72-78 COM o guard",
    async () => {
      const chamadas: Array<{ url: string; opts: RequestInit }> = [];
      const fetchOriginal = globalThis.fetch;
      let n = 0;
      // @ts-ignore -- stub
      globalThis.fetch = async (url: string, opts: RequestInit) => {
        chamadas.push({ url, opts });
        n++;
        if (n === 1) return { ok: true, status: 201, text: async () => "[]" };
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([{ version: "20261172000000", name: "o_cpf_..." }]),
        };
      };
      try {
        const { saida } = await comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              PROJETO_REF: "cafkrminfnokvgjqtkle",
              LEDGER: "72-74",
            },
            () => main(),
          ),
        );
        assertEquals(chamadas.length, 2);
        const corpoGravacao = JSON.parse(String(chamadas[0].opts.body));
        assert(
          !corpoGravacao.query.includes("BEGIN READ ONLY"),
          "a gravação do ledger NÃO pode levar o guard read-only",
        );
        assertEquals(
          corpoGravacao.read_only,
          undefined,
          "a gravação do ledger NÃO pode pedir read_only:true",
        );
        assertStringIncludes(
          corpoGravacao.query,
          "INSERT INTO supabase_migrations",
        );

        const corpoVerificacao = JSON.parse(String(chamadas[1].opts.body));
        assertStringIncludes(corpoVerificacao.query, "BEGIN READ ONLY;\n");
        assertEquals(corpoVerificacao.read_only, true);
        assertStringIncludes(corpoVerificacao.query, "schema_migrations");

        assert(
          !saida.includes(TOKEN_FALSO),
          "o token vazou na saída do ledger",
        );
        assertStringIncludes(saida, "20261172000000");
      } finally {
        globalThis.fetch = fetchOriginal;
      }
    },
  );

  await t.step("LEDGER fora de 72-74/75-78 é recusado", async () => {
    const { valor } = await comConsoleCapturado(() =>
      comEnv(
        {
          SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
          PROJETO_REF: "cafkrminfnokvgjqtkle",
          LEDGER: "99-99",
        },
        () => comSaidaCapturada(() => main()),
      ),
    );
    assertEquals(valor?.retornou, false);
    assertEquals(valor?.codigoSaida, 1);
  });

  await t.step("CONSULTA desconhecida é recusada", async () => {
    const { valor } = await comConsoleCapturado(() =>
      comEnv(
        {
          SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
          PROJETO_REF: "cafkrminfnokvgjqtkle",
          CONSULTA: "naoexiste",
        },
        () => comSaidaCapturada(() => main()),
      ),
    );
    assertEquals(valor?.retornou, false);
    assertEquals(valor?.codigoSaida, 1);
  });

  await t.step("sem SUPABASE_ACCESS_TOKEN é recusado", async () => {
    const { valor } = await comConsoleCapturado(() =>
      comEnv({ CONSULTA: "0a-antes-base-e-nada-aplicado" }, () =>
        comSaidaCapturada(() => main()),
      ),
    );
    assertEquals(valor?.retornou, false);
    assertEquals(valor?.codigoSaida, 1);
  });

  await t.step(
    "backups: GET, e imprime só hora/status/PITR/total",
    async () => {
      const chamadas: Array<{ url: string; opts: RequestInit }> = [];
      const fetchOriginal = globalThis.fetch;
      // @ts-ignore -- stub
      globalThis.fetch = async (url: string, opts: RequestInit) => {
        chamadas.push({ url, opts });
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              pitr_enabled: false,
              backups: [
                { status: "COMPLETED", inserted_at: "2026-09-25T03:00:00Z" },
              ],
            }),
        };
      };
      try {
        const { saida } = await comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              PROJETO_REF: "cafkrminfnokvgjqtkle",
              CONSULTA: "backups",
            },
            () => main(),
          ),
        );
        assertEquals(chamadas.length, 1);
        assertStringIncludes(
          chamadas[0].url,
          "/v1/projects/cafkrminfnokvgjqtkle/database/backups",
        );
        assertEquals(chamadas[0].opts?.method ?? "GET", "GET");
        assertStringIncludes(saida, "2026-09-25T03:00:00Z");
        assertStringIncludes(saida, "COMPLETED");
        assert(
          !saida.includes(TOKEN_FALSO),
          "o token vazou na saída de backups",
        );
      } finally {
        globalThis.fetch = fetchOriginal;
      }
    },
  );
});
