// @ts-nocheck
/**
 * O workflow "Conferir banco da loja" (.github/workflows/conferir-banco-da-loja.yml)
 * e o script que ele chama (scripts/publicacao/conferir-banco.cjs) — a
 * ferramenta que deixa o coordenador rodar, sob demanda, as conferências de
 * pré/pós-publicação que antes eram feitas à mão no SQL Editor
 * (docs/runbooks/publicar-painel-cartao-devolucoes.md §0/§1).
 *
 * RODADA 2 (26/09/2026) — revisão de risco "passa com ressalva". O que
 * mudou e o que este arquivo passou a medir:
 *
 * 1. `PROJETO` é fechado em loja/sandbox (`resolverRef`), nunca mais texto
 *    livre indo para o path da URL — os dois payloads provados contra um
 *    stub ("<ref>/restart#", "x/../outroref.../database/query#") têm de
 *    ser recusados ANTES de qualquer `fetch`.
 * 2. `rodarLedger` pré-confere o schema da faixa (2a+2b ou 1a+1b) pelo
 *    caminho só-leitura ANTES do INSERT, e aborta (sem gravar) se vier 0
 *    linha ou qualquer linha com `ok !== true` (fora a exceção da linha de
 *    dado ao vivo do 2b).
 * 3. Toda leitura (consulta e a verificação pós-ledger) vai para
 *    `POST /database/query/read-only` — sem guard, sem `read_only`. A
 *    ÚNICA escrita (o INSERT do ledger) continua em
 *    `POST /database/query`, também sem guard/flag.
 * 4. `contarStatements` não erra mais nos 4 casos adversariais (P1-P4:
 *    string `E''` com escape de barra, identificador `x$y$`, comentário
 *    `--` terminado só por `\r`, dollar-quote com tag não-ASCII).
 * 5. `resumoDeBackups`: `backups[]` vazio + PITR físico disponível imprime
 *    a data do PITR em vez de "(nenhum)".
 *
 * RODADA 3 (26/09/2026) — re-revisão "passa com ressalva". O que mudou e
 * o que este arquivo passou a medir a mais:
 *
 * 1. Os dois workflows (`conferir-banco-da-loja.yml`,
 *    `aplicar-migrations.yml`) ganharam `queue: max` no `concurrency` — sem
 *    isto, a fila padrão CANCELA um run pendente em vez de esperar a vez
 *    (A aplica 72, B=73 é cancelado por C=74, que aplica sem 73 no meio).
 * 2. "75 política padrão" e "76 cartão nasce desligado" (1a) entraram em
 *    `IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER` — são dado ao vivo (prazo que o
 *    dono pode mudar; flag que vira `false` de propósito depois do passo 6
 *    do runbook), não checagem estrutural.
 * 3. Nova consulta `4a-definer-alcancavel-pelo-leitor`: lista função
 *    `SECURITY DEFINER` em `public` alcançável por `supabase_read_only_user`
 *    — o papel sozinho NÃO barra uma função dessas que escreve.
 * 4. `contarStatements` corrigido para mais 4 casos adversariais (P5-P8:
 *    identificador terminado em e/E colado numa string, `$` depois de
 *    símbolo não-ASCII ou letra fora do BMP, tag de dollar-quote sem ser
 *    letra Unicode "de verdade" — a regra real do Postgres é "todo code
 *    point ≥ U+0080 conta"). O INSERT do ledger agora também tem o
 *    SHA-256 pinado (`conferirHashDoLedger`) como segunda checagem,
 *    independente da contagem de statements.
 *
 * RODADA 4 (26/09/2026) — re-revisão "passa" para rodar em produção. Achado
 * #2 (o único de código; achado #1 era só o merge de outro branch, sem
 * teste próprio deste arquivo — ver `docs/runbooks/...md`):
 *
 * `4a-definer-alcancavel-pelo-leitor.sql` só olhava o schema `public` — o
 * revisor provou (cenário E do `q4a.cjs`) que uma função `SECURITY
 * DEFINER` concedida a `PUBLIC` em QUALQUER OUTRO schema também escreve
 * quando chamada pelo papel de leitura. A consulta agora varre todo schema
 * (menos `pg_catalog`/`information_schema`) e projeta `schema.função`, e
 * ganhou uma linha sentinela para "o papel não existe neste projeto" — sem
 * ela, "0 linhas" seria ambíguo entre "nada alcançável" e "não dava pra
 * saber".
 *
 * O QUE ESTES TESTES MEDEM (visão geral):
 * - O workflow, do jeito que está no arquivo: só dispara à mão, nenhum
 *   `node -e` inline, `consulta` bate com os arquivos do disco, `projeto`
 *   é choice loja/sandbox, `queue: max` no concurrency, o ledger só roda
 *   com `confirmar == 'GRAVAR'`.
 * - `resolverRef`: loja/sandbox resolvem certo; qualquer outra coisa
 *   (inclusive os payloads do stub e chaves de prototype) é recusada.
 * - `contarStatements`/`dividirEmStatements`: P1-P8 e os casos que já
 *   funcionavam antes, mais todo arquivo real de
 *   `scripts/publicacao/consultas/`.
 * - `conferirAntesDeGravar`: aborta com 0 linha ou `ok !== true` (fora as
 *   3 linhas de dado ao vivo); NÃO aborta quando só essas 3 vêm `false`.
 * - `conferirHashDoLedger`: aceita o conteúdo real do arquivo, recusa
 *   qualquer alteração.
 * - `main()`, com `fetch` global stubado: o request vai para o endpoint
 *   certo (leitura vs. escrita), erro no corpo vira `exit(1)`, PROJETO
 *   inválido nunca gera request nenhum, e o token NUNCA aparece em nada
 *   que o script imprime.
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
const MIGRATIONS_DIR = `${RAIZ}/supabase/migrations`;
const SCRIPT = "../scripts/publicacao/conferir-banco.cjs";

// A 20261182000000 (o_cpf_da_janela_sai_do_endereco) ainda não está nesta
// árvore (mora em fix/cpf-sai-do-endereco, outra frente) — a guarda de WHERE
// de 3a-cpf-no-endereco.sql contra ela precisa saber disso ANTES de
// registrar o teste (Deno.test não aceita `ignore` assíncrono).
const MIGRACAO_82 = `${MIGRATIONS_DIR}/20261182000000_o_cpf_da_janela_sai_do_endereco.sql`;
let MIGRACAO_82_EXISTE = false;
try {
  await Deno.stat(MIGRACAO_82);
  MIGRACAO_82_EXISTE = true;
} catch {
  MIGRACAO_82_EXISTE = false;
}

const TOKEN_FALSO = "sbp_segredo-de-teste-nunca-pode-aparecer-no-log";
const REF_LOJA = "cafkrminfnokvgjqtkle";
const REF_SANDBOX = "lofznuxcvezrhxsgjqyg";

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
      assert(
        opcoes.includes("3a-cpf-no-endereco"),
        "falta a opção `3a-cpf-no-endereco` (janela 23/09-26/09 do CPF no endereço)",
      );
      assert(
        opcoes.includes("4a-definer-alcancavel-pelo-leitor"),
        "falta a opção `4a-definer-alcancavel-pelo-leitor` (achado #3, rodada 3)",
      );
      assert(
        opcoes.includes("5a-antes-da-79-e-80"),
        "falta a opção `5a-antes-da-79-e-80` (pré-voo da 79/80)",
      );
    },
  );

  await t.step(
    "`projeto` é choice fechado loja/sandbox — nunca mais projeto_ref de texto livre (achado #1, rodada 2)",
    () => {
      assert(
        !yaml.includes("projeto_ref:"),
        "o workflow ainda declara o input projeto_ref (texto livre)",
      );
      assertStringIncludes(yaml, "projeto:");
      assertStringIncludes(
        yaml,
        "options:\n          - loja\n          - sandbox",
      );
      assertStringIncludes(yaml, "default: loja");
    },
  );

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

  await t.step(
    "o job do ledger compartilha o grupo de concorrência com aplicar-migrations, com queue: max (achado #1, rodada 3)",
    () => {
      const iLedger = yaml.indexOf("\n  ledger:");
      const blocoLedger = yaml.slice(iLedger);
      assertStringIncludes(blocoLedger, "group: banco-da-loja");
      assertStringIncludes(blocoLedger, "cancel-in-progress: false");
      // Sem `queue: max` a fila padrão ("single") CANCELA o run pendente
      // em vez de esperar a vez — a fila padrão nunca deveria ser usada
      // aqui (o ledger não pode pular uma faixa no meio).
      assertStringIncludes(blocoLedger, "queue: max");
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

Deno.test("resolverRef — projeto fechado loja/sandbox (achado #1, rodada 2)", () => {
  const { resolverRef, REFS_POR_PROJETO } = require(SCRIPT);

  assertEquals(resolverRef("loja"), REF_LOJA);
  assertEquals(resolverRef("sandbox"), REF_SANDBOX);
  assertEquals(REFS_POR_PROJETO.loja, REF_LOJA);
  assertEquals(REFS_POR_PROJETO.sandbox, REF_SANDBOX);

  // Os dois payloads provados contra o stub da revisão de risco (guard.cjs
  // não se aplica aqui — é ref.cjs): nenhum chega a virar ref.
  for (const malicioso of [
    "cafkrminfnokvgjqtkle/restart#",
    "cafkrminfnokvgjqtkle/pause?",
    "x/../outroprojetoabcdefgh/database/query#",
    "producao",
    "",
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ]) {
    let lancou = false;
    try {
      resolverRef(malicioso);
    } catch {
      lancou = true;
    }
    assert(lancou, `resolverRef("${malicioso}") deveria lançar`);
  }
});

Deno.test("dividirEmStatements/contarStatements — o lexer, inclusive P1-P8", async (t) => {
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

  await t.step("`;` dentro de comentário de linha (\\n) não conta", () => {
    assertEquals(contarStatements("SELECT 1; -- troque por 2; e 3;\n"), 1);
  });

  await t.step("`;` dentro de string simples '...' não conta", () => {
    assertEquals(contarStatements("SELECT 'a;b;c' AS x;"), 1);
  });

  await t.step(
    "P1 — string E'' com escape de barra (\\') não engana mais o lexer",
    () => {
      const sql =
        "SELECT E'\\'' AS a; COMMIT; INSERT INTO alvo VALUES (1); SELECT 'x' AS b";
      assertEquals(contarStatements(sql), 4);
    },
  );

  await t.step(
    "P2 — identificador com $ colado (x$y$) não abre dollar-quote",
    () => {
      const sql =
        "SELECT 1 AS x$y$; COMMIT; INSERT INTO alvo VALUES (2); SELECT 1";
      assertEquals(contarStatements(sql), 4);
    },
  );

  await t.step(
    "P3 — comentário -- terminado só por \\r fecha do mesmo jeito que \\n",
    () => {
      const sql =
        "SELECT 1 AS a; --nota\rCOMMIT; INSERT INTO alvo VALUES (3); SELECT 1 AS b";
      assertEquals(contarStatements(sql), 4);
    },
  );

  await t.step("P4 — dollar-quote com tag não-ASCII ($é$) fecha certo", () => {
    const sql =
      "SELECT $é$ ' $é$ AS a; COMMIT; INSERT INTO alvo VALUES (4); SELECT ' ' AS b";
    assertEquals(contarStatements(sql), 4);
  });

  await t.step(
    "P5 — identificador terminado em e/E colado numa string não abre E-string (rodada 3)",
    () => {
      const sql =
        "SELECT name'\\' AS a; COMMIT; INSERT INTO alvo VALUES (5); SELECT 'x\\' AS b";
      assertEquals(contarStatements(sql), 4);
    },
  );

  await t.step(
    "P6 — $ depois de símbolo não-ASCII (x€$a$) não abre dollar-quote (rodada 3)",
    () => {
      const sql =
        "SELECT 1 AS x€$a$; COMMIT; INSERT INTO alvo VALUES (6); SELECT 1";
      assertEquals(contarStatements(sql), 4);
    },
  );

  await t.step(
    "P7 — tag de dollar-quote sem ser letra Unicode ($€$) fecha certo (rodada 3)",
    () => {
      const sql =
        "SELECT $€$ ' $€$ AS a; COMMIT; INSERT INTO alvo VALUES (7); SELECT ' ' AS b";
      assertEquals(contarStatements(sql), 4);
    },
  );

  await t.step(
    "P8 — $ depois de letra fora do BMP (𝑥$a$) não abre dollar-quote (rodada 3)",
    () => {
      const sql =
        "SELECT 1 AS 𝑥$a$; COMMIT; INSERT INTO alvo VALUES (8); SELECT 1";
      assertEquals(contarStatements(sql), 4);
    },
  );

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

  await t.step(
    "3a-cpf-no-endereco.sql: a lista do SELECT só tem agregados (e a data de agrupamento) — nunca customer_data cru",
    async () => {
      const sql = await Deno.readTextFile(
        `${CONSULTAS_DIR}/3a-cpf-no-endereco.sql`,
      );
      const inicio = sql.indexOf("SELECT\n") + "SELECT\n".length;
      const fim = sql.indexOf("\nFROM public.marketplace_orders");
      assert(inicio > 0 && fim > inicio, "não achei a lista do SELECT de 3a");
      const listaDeColunas = sql.slice(inicio, fim);
      // Separa por vírgula NO NÍVEL 0 de parênteses — uma coluna como
      // `so_apaga_por_opcao_de_frete` tem vírgula DENTRO do FILTER (...) e
      // quebra em várias linhas; splitar por "\n" ingenuamente cortaria essa
      // coluna ao meio.
      const colunas: string[] = [];
      let atual = "";
      let profundidade = 0;
      for (const ch of listaDeColunas) {
        if (ch === "(") profundidade++;
        if (ch === ")") profundidade--;
        if (ch === "," && profundidade === 0) {
          colunas.push(atual);
          atual = "";
        } else {
          atual += ch;
        }
      }
      if (atual.trim()) colunas.push(atual);
      assertEquals(colunas.length, 13, "3a deveria ter 13 colunas no SELECT");
      for (const coluna of colunas) {
        const c = coluna.trim();
        assert(
          /^\(o\.created_at AT TIME ZONE/.test(c) ||
            /^count\(|^min\(|^max\(/.test(c),
          `coluna fora do padrão agregado/data de agrupamento: ${c.slice(0, 80)}`,
        );
      }
      assert(
        !/\bAS\s+customer_data\b/i.test(sql),
        "customer_data não pode ser projetado cru na saída",
      );
    },
  );

  await t.step(
    "4a-definer-alcancavel-pelo-leitor.sql confere SECURITY DEFINER em QUALQUER schema, com sentinela de papel ausente (rodada 4)",
    async () => {
      const sql = await Deno.readTextFile(
        `${CONSULTAS_DIR}/4a-definer-alcancavel-pelo-leitor.sql`,
      );
      assertStringIncludes(sql, "prosecdef");
      assertStringIncludes(sql, "has_function_privilege");
      assertStringIncludes(
        sql,
        "to_regrole('supabase_read_only_user')",
        "sem to_regrole, a consulta ERRA (em vez de ficar muda) se o papel não existir",
      );
      // Rodada 4: não pode mais filtrar só `public` — uma definer alcançável
      // em QUALQUER OUTRO schema também escreve (achado E do revisor).
      assert(
        !/pronamespace\s*=\s*'public'/.test(sql),
        "a consulta não pode mais filtrar só o schema public",
      );
      assertStringIncludes(
        sql,
        "pg_catalog",
        "precisa excluir pg_catalog explicitamente ao olhar todos os schemas",
      );
      assertStringIncludes(
        sql,
        "information_schema",
        "precisa excluir information_schema explicitamente ao olhar todos os schemas",
      );
      // Rodada 4: sentinela — "0 linhas" não pode significar a mesma coisa
      // quando o papel não existe e quando ele existe e nada é alcançável.
      assertStringIncludes(
        sql,
        "AUSENTE",
        "precisa de uma linha sentinela distinguindo 'papel ausente' de 'nada alcançável'",
      );
      assertStringIncludes(
        sql,
        "IS NULL",
        "a sentinela precisa disparar quando to_regrole(...) vier NULL",
      );
      // Combina schema + nome — não é mais só o nome cru da função, porque
      // agora o mesmo nome pode existir em dois schemas diferentes.
      assertStringIncludes(sql, "pronamespace::regnamespace || '.' || proname");
      // Rodada 5 (achado do revisor, 26/09/2026): sem estas duas guardas a
      // consulta lista 7 falsos positivos contra o schema do zero (5
      // funções de gatilho + `forma_de_pagamento_aceita`, STABLE) — provado
      // num Postgres efêmero. `provolatile`/`prorettype` tiram esse ruído
      // sem esconder uma definer VOLATILE de verdade.
      assertStringIncludes(
        sql,
        "provolatile = 'v'",
        "sem filtrar por VOLATILE, função STABLE/IMMUTABLE (que o Postgres recusa escrever) vira falso positivo",
      );
      assertStringIncludes(
        sql,
        "prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)",
        "sem excluir RETURNS trigger, toda função de gatilho vira falso positivo (EXECUTE direto nem é uma chamada válida para ela)",
      );
    },
  );
});

Deno.test("5a-antes-da-79-e-80.sql — os hashes embutidos batem com o que a árvore REALMENTE tem (guarda md5)", async (t) => {
  const { createHash } = require("node:crypto");

  /** prosrc é o texto EXATO entre os delimitadores `$$` de uma função
   * `AS $$ ... $$` — inclusive a quebra de linha logo depois do "AS $$" e
   * a que vem antes do "$$;" de fechamento (confirmado contra o hash
   * `8bda9131ed0a7929ef5aa13df84238e3` que o preflight da 80 já cita para
   * o corpo que a 75 deixa). */
  function extrairCorpoDeFuncao(
    sqlMigracao: string,
    marcadorCreate: string,
  ): string {
    const inicioCreate = sqlMigracao.indexOf(marcadorCreate);
    assert(inicioCreate >= 0, `não achei "${marcadorCreate}" na migration`);
    const asIdx = sqlMigracao.indexOf("AS $$", inicioCreate);
    assert(asIdx >= 0, `não achei "AS $$" depois de "${marcadorCreate}"`);
    const inicioCorpo = asIdx + "AS $$".length;
    const fimCorpo = sqlMigracao.indexOf("\n$$;", inicioCorpo);
    assert(fimCorpo >= 0, "não achei o fechamento $$; do corpo");
    return sqlMigracao.slice(inicioCorpo, fimCorpo + 1);
  }

  function md5Normalizado(corpo: string): string {
    return createHash("md5").update(corpo.replace(/\r/g, "")).digest("hex");
  }

  await t.step(
    "cancelar_devolucao: o hash em 5a é o md5 REAL do corpo que a 20261175000000 deixa NESTA árvore " +
      "(escolha: computado do arquivo local, não só copiado do runbook §7.0 externo — dá para verificar sem sair da árvore, e bate com o valor que o runbook cita)",
    async () => {
      const sql75 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261175000000_a_devolucao_nasce_no_pedido.sql`,
      );
      const corpo = extrairCorpoDeFuncao(
        sql75,
        "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
      );
      const hash = md5Normalizado(corpo);
      assertEquals(
        hash,
        "45c56a39cc29f31ec5ff904f1929737e",
        "o corpo de cancelar_devolucao na 75 mudou nesta árvore — recalcule o valor de 5a e do runbook §7.0",
      );

      const sql5a = await Deno.readTextFile(
        `${CONSULTAS_DIR}/5a-antes-da-79-e-80.sql`,
      );
      assertStringIncludes(sql5a, hash);
    },
  );

  await t.step(
    "update_order_status_atomic: os hashes que 5a aceita são os MESMOS dois que o preflight da 80 aceita",
    async () => {
      const sql80 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261180000000_cliente_nao_cancela_com_cartao_vivo.sql`,
      );
      const inicioPreflight = sql80.indexOf("DO $preflight_20261180$");
      const fimPreflight = sql80.indexOf(
        "$preflight_20261180$;",
        inicioPreflight + 1,
      );
      assert(
        inicioPreflight >= 0 && fimPreflight > inicioPreflight,
        "não achei o bloco DO $preflight_20261180$ na 80",
      );
      const bloco = sql80.slice(inicioPreflight, fimPreflight);
      const hashes = [...bloco.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
      assertEquals(
        hashes.length,
        2,
        "o preflight da 80 deveria citar exatamente 2 hashes md5 (o da 75 e o dela própria)",
      );

      const sql5a = await Deno.readTextFile(
        `${CONSULTAS_DIR}/5a-antes-da-79-e-80.sql`,
      );
      for (const hash of hashes) {
        assertStringIncludes(
          sql5a,
          hash,
          `5a não cita o hash ${hash} que o preflight da 80 aceita`,
        );
      }

      // O 2º hash do preflight é, de fato, o que a PRÓPRIA 80 deixa no
      // corpo dela (comentado assim no arquivo: "corpo que ESTA migration
      // (80) deixa — reaplicação idempotente").
      const corpo80 = extrairCorpoDeFuncao(
        sql80,
        "CREATE OR REPLACE FUNCTION public.update_order_status_atomic(",
      );
      assertEquals(md5Normalizado(corpo80), hashes[1]);
    },
  );
});

Deno.test({
  name: MIGRACAO_82_EXISTE
    ? "3a-cpf-no-endereco.sql — o WHERE bate com a CTE `alvo` da migration 82 (normalizando espaço em branco)"
    : "3a-cpf-no-endereco.sql — guarda de WHERE contra a migration 82 (IGNORADO: 20261182000000_o_cpf_da_janela_sai_do_endereco.sql ainda não está nesta árvore — mora em fix/cpf-sai-do-endereco, outra frente em andamento; ver a prova manual contra `git show 86df9432:...` no relatório da tarefa)",
  ignore: !MIGRACAO_82_EXISTE,
  fn: async () => {
    function normalizar(s: string): string {
      return s.replace(/\s+/g, " ").trim();
    }

    const sqlMigracao = await Deno.readTextFile(MIGRACAO_82);
    const inicioAlvo = sqlMigracao.indexOf("alvo AS (");
    assert(inicioAlvo >= 0, "não achei a CTE `alvo` na migration 82");
    const blocoAlvo = sqlMigracao.slice(inicioAlvo, inicioAlvo + 2000);
    const mMigracao = blocoAlvo.match(
      /FROM\s+public\.marketplace_orders\s+o\s+(WHERE[\s\S]*?)\s*FOR UPDATE OF o/,
    );
    assert(mMigracao, "não achei o WHERE da CTE `alvo` na migration 82");
    const whereMigracao = normalizar(mMigracao[1]);

    const sql3a = await Deno.readTextFile(
      `${CONSULTAS_DIR}/3a-cpf-no-endereco.sql`,
    );
    const mConsulta = sql3a.match(
      /FROM public\.marketplace_orders o\s*(WHERE[\s\S]*?)\s*GROUP BY/,
    );
    assert(mConsulta, "não achei o WHERE de 3a-cpf-no-endereco.sql");
    const whereConsulta = normalizar(mConsulta[1]);

    assertEquals(
      whereConsulta,
      whereMigracao,
      "o WHERE de 3a tem de alcançar EXATAMENTE o mesmo conjunto de linhas que a CTE `alvo` da 82 vai tocar",
    );
  },
});

Deno.test("ehCaractereDeIdentificador — a regra real do Postgres (rodada 3)", () => {
  const { ehCaractereDeIdentificador } = require(SCRIPT);
  for (const ch of ["a", "Z", "0", "_", "$"]) {
    assert(
      ehCaractereDeIdentificador(ch),
      `"${ch}" deveria contar como identificador`,
    );
  }
  // Símbolo não-ASCII (não é "letra" pela categoria Unicode) — P6/P7.
  assert(
    ehCaractereDeIdentificador("€"),
    "€ (U+20AC) deveria contar — todo code point ≥ U+0080 conta",
  );
  // Metade de par substituto de uma letra fora do BMP (𝑥 = U+1D465) — P8.
  assert(
    ehCaractereDeIdentificador("𝑥"[0]),
    "a primeira metade do par substituto de 𝑥 deveria contar (valor numérico ≥ U+0080)",
  );
  for (const ch of [" ", ";", "'", "\n", "", undefined]) {
    assert(
      !ehCaractereDeIdentificador(ch),
      `"${ch}" NÃO deveria contar como identificador`,
    );
  }
});

Deno.test("comGuardaSomenteLeitura — o guard continua correto, mesmo não sendo mais o caminho quente", () => {
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

Deno.test("extrairLinhas — os formatos de resposta da API", () => {
  const { extrairLinhas } = require(SCRIPT);

  const achatado = JSON.stringify([{ um: 1, rotulo: "ok" }]);
  assertEquals(extrairLinhas(achatado), [{ um: 1, rotulo: "ok" }]);

  const porStatement = JSON.stringify([
    { columns: [], rows: [] },
    { columns: ["um", "rotulo"], rows: [[1, "ok"]] },
  ]);
  assertEquals(extrairLinhas(porStatement), [{ um: 1, rotulo: "ok" }]);
});

Deno.test("conferirHashDoLedger — segunda checagem do INSERT, independente da contagem de statements (achado #4, rodada 3)", async (t) => {
  const { conferirHashDoLedger, SHA256_DO_LEDGER } = require(SCRIPT);

  await t.step(
    "o conteúdo REAL dos dois arquivos bate com o hash pinado",
    async () => {
      for (const faixa of ["72-74", "75-78"]) {
        const conteudo = await Deno.readTextFile(
          `${CONSULTAS_DIR}/ledger-${faixa}.sql`,
        );
        // Não lança = passou.
        conferirHashDoLedger(faixa, conteudo);
        // eslint-disable-next-line security/detect-object-injection -- `faixa` vem só do array literal ["72-74", "75-78"] três linhas acima, nunca de entrada externa.
        const hashPinado = SHA256_DO_LEDGER[faixa];
        assert(hashPinado, `SHA256_DO_LEDGER não tem entrada para ${faixa}`);
      }
    },
  );

  await t.step("qualquer alteração no conteúdo é recusada", () => {
    let lancou = false;
    try {
      conferirHashDoLedger(
        "72-74",
        "INSERT INTO supabase_migrations.schema_migrations VALUES ('99999999999999', 'malicioso');",
      );
    } catch {
      lancou = true;
    }
    assert(lancou, "conteúdo alterado deveria ser recusado pelo hash pinado");
  });
});

Deno.test("resumoDeBackups — inclusive o PITR sem backup discreto (achado #5, rodada 2)", async (t) => {
  const { resumoDeBackups } = require(SCRIPT);

  await t.step("backup discreto existe: usa ele", () => {
    const resumo = resumoDeBackups({
      pitr_enabled: true,
      backups: [
        { status: "COMPLETED", inserted_at: "2026-09-20T03:00:00Z" },
        { status: "COMPLETED", inserted_at: "2026-09-25T03:00:00Z" },
        { status: "FAILED", inserted_at: "2026-09-24T03:00:00Z" },
      ],
    });
    assertEquals(resumo.ultimoEm, "2026-09-25T03:00:00Z");
    assertEquals(resumo.fonte, "backup");
    assertEquals(resumo.status, "COMPLETED");
    assertEquals(resumo.pitrHabilitado, true);
    assertEquals(resumo.total, 3);
  });

  await t.step(
    "backups[] vazio + PITR físico disponível: usa a data do PITR",
    () => {
      const resumo = resumoDeBackups({
        pitr_enabled: true,
        backups: [],
        physical_backup_data: {
          earliest_physical_backup_date_unix: 1758700000,
          latest_physical_backup_date_unix: 1758800000,
        },
      });
      assertEquals(resumo.fonte, "pitr");
      assertEquals(resumo.ultimoEm, new Date(1758800000 * 1000).toISOString());
      assertEquals(resumo.pitrHabilitado, true);
    },
  );

  await t.step("nem backup nem PITR: nenhum dos dois", () => {
    const resumo = resumoDeBackups({ pitr_enabled: false, backups: [] });
    assertEquals(resumo.fonte, "nenhum");
    assertEquals(resumo.ultimoEm, null);
  });
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

const CHAVES = ["SUPABASE_ACCESS_TOKEN", "PROJETO", "CONSULTA", "LEDGER"];
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

/** Stuba `globalThis.fetch`, chama `executar`, e sempre restaura — devolve
 * as chamadas feitas (url + opts). */
async function comFetchStubado<T>(
  respostas: Array<
    | { ok: true; status?: number; corpo: string }
    | { ok: false; status: number; corpo: string }
  >,
  executar: () => Promise<T>,
): Promise<{
  resultado: T;
  chamadas: Array<{ url: string; opts: RequestInit }>;
}> {
  const chamadas: Array<{ url: string; opts: RequestInit }> = [];
  const fetchOriginal = globalThis.fetch;
  let n = 0;
  // @ts-ignore -- stub
  globalThis.fetch = async (url: string, opts: RequestInit = {}) => {
    chamadas.push({ url, opts });
    const r = respostas[Math.min(n, respostas.length - 1)];
    n++;
    return { ok: r.ok, status: r.status ?? 200, text: async () => r.corpo };
  };
  try {
    const resultado = await executar();
    return { resultado, chamadas };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

Deno.test("main() — request certo, stubando fetch", async (t) => {
  const { main } = require(SCRIPT);

  await t.step(
    "consulta real: vai para /database/query/read-only, corpo é só {query} SEM guard; sem exit; sem vazar o token",
    async () => {
      const { chamadas, resultado: _ } = await comFetchStubado(
        [{ ok: true, corpo: JSON.stringify([{ base_74: 1, t75: null }]) }],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                CONSULTA: "0a-antes-base-e-nada-aplicado",
              },
              () => main(),
            ),
          ),
      );
      const { saida } = _;
      assertEquals(chamadas.length, 1);
      assertStringIncludes(
        chamadas[0].url,
        `/v1/projects/${REF_LOJA}/database/query/read-only`,
      );
      assertEquals(chamadas[0].opts.method, "POST");
      const corpo = JSON.parse(String(chamadas[0].opts.body));
      assert(
        !String(corpo.query).includes("BEGIN READ ONLY"),
        "a consulta não pode mais levar o guard — a barreira é o endpoint dedicado",
      );
      assertEquals(
        corpo.read_only,
        undefined,
        "o endpoint dedicado não usa (nem precisa de) read_only",
      );
      assertEquals(Object.keys(corpo).sort(), ["query"]);
      assertStringIncludes(
        String(chamadas[0].opts.headers.Authorization),
        `Bearer ${TOKEN_FALSO}`,
      );
      assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída");
      assertStringIncludes(saida, "base_74");
    },
  );

  await t.step("erro no corpo -> exit(1), e o token não vaza", async () => {
    const { resultado } = await comFetchStubado(
      [
        {
          ok: true,
          corpo: JSON.stringify({ error: "boom", message: "deu ruim" }),
        },
      ],
      () =>
        comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              PROJETO: "loja",
              CONSULTA: "0a-antes-base-e-nada-aplicado",
            },
            () => comSaidaCapturada(() => main()),
          ),
        ),
    );
    assertEquals(resultado.valor?.retornou, false);
    assertEquals(resultado.valor?.codigoSaida, 1);
    assert(
      !resultado.saida.includes(TOKEN_FALSO),
      "o token vazou na saída de erro",
    );
  });

  await t.step("HTTP não-2xx -> exit(1)", async () => {
    const { resultado } = await comFetchStubado(
      [{ ok: false, status: 500, corpo: "erro interno" }],
      () =>
        comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              PROJETO: "loja",
              CONSULTA: "0a-antes-base-e-nada-aplicado",
            },
            () => comSaidaCapturada(() => main()),
          ),
        ),
    );
    assertEquals(resultado.valor?.retornou, false);
    assertEquals(resultado.valor?.codigoSaida, 1);
  });

  await t.step(
    "PROJETO malicioso (payloads da revisão de risco) nunca gera request nenhum — exit(1) antes de qualquer fetch",
    async () => {
      for (const projetoMalicioso of [
        "cafkrminfnokvgjqtkle/restart#",
        "cafkrminfnokvgjqtkle/pause?",
        "x/../outroprojetoabcdefgh/database/query#",
      ]) {
        const { chamadas, resultado } = await comFetchStubado([], () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: projetoMalicioso,
                CONSULTA: "0a-antes-base-e-nada-aplicado",
              },
              () => comSaidaCapturada(() => main()),
            ),
          ),
        );
        assertEquals(
          chamadas.length,
          0,
          `"${projetoMalicioso}" não pode gerar NENHUM request`,
        );
        assertEquals(resultado.valor?.retornou, false);
        assertEquals(resultado.valor?.codigoSaida, 1);
      }
    },
  );

  await t.step(
    "ledger: pré-checagem ok=true em todas as linhas -> grava (endpoint de escrita, sem guard/read_only) e confere 72-78 (endpoint de leitura, sem guard)",
    async () => {
      const linhaOk2a = {
        migration: "20261172000000",
        funcao: "x",
        esperado: 1,
        achado: 1,
        ok: true,
      };
      const linhaOk2b = { item: "fn get_my_cpf", ok: true };
      const linhaLiveDataFalsa2b = {
        item: "loja existente com as 3 formas ligadas",
        ok: false,
      };
      const { chamadas, resultado } = await comFetchStubado(
        [
          { ok: true, corpo: JSON.stringify([linhaOk2a]) }, // 2a
          {
            ok: true,
            corpo: JSON.stringify([linhaOk2b, linhaLiveDataFalsa2b]),
          }, // 2b (a linha "ao vivo" é ignorada)
          { ok: true, status: 201, corpo: "[]" }, // INSERT do ledger
          {
            ok: true,
            corpo: JSON.stringify([
              { version: "20261172000000", name: "o_cpf_..." },
            ]),
          }, // verificação 72-78
        ],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "72-74",
              },
              () => main(),
            ),
          ),
      );
      const { saida } = resultado;
      assertEquals(chamadas.length, 4);

      // 1 e 2: pré-checagem — vão para o endpoint de LEITURA.
      assertStringIncludes(chamadas[0].url, "/database/query/read-only");
      assertStringIncludes(chamadas[1].url, "/database/query/read-only");

      // 3: o INSERT — vai para o endpoint de ESCRITA, sem guard/read_only.
      assertStringIncludes(
        chamadas[2].url,
        `/v1/projects/${REF_LOJA}/database/query`,
      );
      assert(
        !chamadas[2].url.includes("read-only"),
        "o INSERT não pode ir para o endpoint de leitura",
      );
      const corpoGravacao = JSON.parse(String(chamadas[2].opts.body));
      assert(
        !String(corpoGravacao.query).includes("BEGIN READ ONLY"),
        "a gravação do ledger NÃO pode levar o guard read-only",
      );
      assertEquals(corpoGravacao.read_only, undefined);
      assertStringIncludes(
        corpoGravacao.query,
        "INSERT INTO supabase_migrations",
      );

      // 4: a verificação pós-gravação — endpoint de LEITURA, sem guard.
      assertStringIncludes(chamadas[3].url, "/database/query/read-only");
      const corpoVerificacao = JSON.parse(String(chamadas[3].opts.body));
      assert(!String(corpoVerificacao.query).includes("BEGIN READ ONLY"));
      assertStringIncludes(corpoVerificacao.query, "schema_migrations");

      assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída do ledger");
      assertStringIncludes(saida, "20261172000000");
    },
  );

  await t.step(
    "ledger 75-78: cartão já ligado e prazos de devolução mudados (ok=false nas 2 linhas de dado ao vivo) -> GRAVA do mesmo jeito (achado #2, rodada 3)",
    async () => {
      // 1a com as DUAS linhas de dado ao vivo em ok=false (cenário real:
      // o dono já ligou o cartão no passo 6, e mudou os prazos de
      // devolução em Ajustes) — e outras linhas estruturais em ok=true.
      const linhasDeDadoAoVivoFalsas = [
        {
          checagem: "75 política padrão",
          valor: "14/60/90",
          esperado: "7/30/90",
          ok: false,
        },
        {
          checagem: "76 cartão nasce desligado",
          valor: "true/true/12",
          esperado: "false/false/1",
          ok: false,
        },
        {
          checagem: "77 contas de sistema",
          valor: "3",
          esperado: "3",
          ok: true,
        },
      ];
      const linhaOk1b = {
        migration: "20261175000000",
        funcao: "x",
        esperado: 1,
        achado: 1,
        ok: true,
      };
      const { chamadas, resultado } = await comFetchStubado(
        [
          { ok: true, corpo: JSON.stringify(linhasDeDadoAoVivoFalsas) }, // 1a
          { ok: true, corpo: JSON.stringify([linhaOk1b]) }, // 1b
          { ok: true, status: 201, corpo: "[]" }, // INSERT do ledger
          {
            ok: true,
            corpo: JSON.stringify([{ version: "20261175000000", name: "x" }]),
          }, // verificação
        ],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "75-78",
              },
              () => main(),
            ),
          ),
      );
      assertEquals(
        chamadas.length,
        4,
        `deveria ter chegado no INSERT — pré-checagem não podia abortar por dado ao vivo; saída: ${resultado.saida}`,
      );
      const corpoGravacao = JSON.parse(String(chamadas[2].opts.body));
      assertStringIncludes(
        corpoGravacao.query,
        "INSERT INTO supabase_migrations",
      );
    },
  );

  await t.step(
    "ledger: pré-checagem com ok=false (fora da exceção) -> ABORTA sem gravar (o INSERT nunca é chamado)",
    async () => {
      const linhaFalha = {
        migration: "20261172000000",
        funcao: "x",
        esperado: 1,
        achado: 0,
        ok: false,
      };
      const { chamadas, resultado } = await comFetchStubado(
        [{ ok: true, corpo: JSON.stringify([linhaFalha]) }],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "72-74",
              },
              () => comSaidaCapturada(() => main()),
            ),
          ),
      );
      assertEquals(resultado.valor?.retornou, false);
      assertEquals(resultado.valor?.codigoSaida, 1);
      // Só a PRIMEIRA consulta da pré-checagem (2a) rodou — nem a segunda
      // (2b), nem o INSERT.
      assertEquals(chamadas.length, 1);
      assertStringIncludes(chamadas[0].url, "/database/query/read-only");
    },
  );

  await t.step(
    "ledger: pré-checagem com 0 linhas -> ABORTA sem gravar",
    async () => {
      const { chamadas, resultado } = await comFetchStubado(
        [{ ok: true, corpo: "[]" }],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "75-78",
              },
              () => comSaidaCapturada(() => main()),
            ),
          ),
      );
      assertEquals(resultado.valor?.retornou, false);
      assertEquals(resultado.valor?.codigoSaida, 1);
      assertEquals(chamadas.length, 1);
    },
  );

  await t.step("LEDGER fora de 72-74/75-78 é recusado", async () => {
    const { chamadas, resultado } = await comFetchStubado([], () =>
      comConsoleCapturado(() =>
        comEnv(
          {
            SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
            PROJETO: "loja",
            LEDGER: "99-99",
          },
          () => comSaidaCapturada(() => main()),
        ),
      ),
    );
    assertEquals(resultado.valor?.retornou, false);
    assertEquals(resultado.valor?.codigoSaida, 1);
    assertEquals(chamadas.length, 0);
  });

  await t.step("CONSULTA desconhecida é recusada", async () => {
    const { chamadas, resultado } = await comFetchStubado([], () =>
      comConsoleCapturado(() =>
        comEnv(
          {
            SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
            PROJETO: "loja",
            CONSULTA: "naoexiste",
          },
          () => comSaidaCapturada(() => main()),
        ),
      ),
    );
    assertEquals(resultado.valor?.retornou, false);
    assertEquals(resultado.valor?.codigoSaida, 1);
    assertEquals(chamadas.length, 0);
  });

  await t.step("sem SUPABASE_ACCESS_TOKEN é recusado", async () => {
    const { resultado } = await comFetchStubado([], () =>
      comConsoleCapturado(() =>
        comEnv(
          { PROJETO: "loja", CONSULTA: "0a-antes-base-e-nada-aplicado" },
          () => comSaidaCapturada(() => main()),
        ),
      ),
    );
    assertEquals(resultado.valor?.retornou, false);
    assertEquals(resultado.valor?.codigoSaida, 1);
  });

  await t.step("PROJETO ausente usa loja por padrão", async () => {
    const { chamadas } = await comFetchStubado(
      [{ ok: true, corpo: JSON.stringify([{ x: 1 }]) }],
      () =>
        comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              CONSULTA: "0a-antes-base-e-nada-aplicado",
            },
            () => main(),
          ),
        ),
    );
    assertStringIncludes(chamadas[0].url, `/v1/projects/${REF_LOJA}/`);
  });

  await t.step(
    "backups: GET, e imprime só hora/status/PITR/total",
    async () => {
      const { chamadas, resultado } = await comFetchStubado(
        [
          {
            ok: true,
            corpo: JSON.stringify({
              pitr_enabled: false,
              backups: [
                { status: "COMPLETED", inserted_at: "2026-09-25T03:00:00Z" },
              ],
            }),
          },
        ],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                CONSULTA: "backups",
              },
              () => main(),
            ),
          ),
      );
      const { saida } = resultado;
      assertEquals(chamadas.length, 1);
      assertStringIncludes(
        chamadas[0].url,
        `/v1/projects/${REF_LOJA}/database/backups`,
      );
      assertEquals(chamadas[0].opts?.method ?? "GET", "GET");
      assertStringIncludes(saida, "2026-09-25T03:00:00Z");
      assertStringIncludes(saida, "COMPLETED");
      assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída de backups");
    },
  );

  await t.step("backups: sandbox resolve para o ref certo", async () => {
    const { chamadas } = await comFetchStubado(
      [
        {
          ok: true,
          corpo: JSON.stringify({ pitr_enabled: false, backups: [] }),
        },
      ],
      () =>
        comConsoleCapturado(() =>
          comEnv(
            {
              SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
              PROJETO: "sandbox",
              CONSULTA: "backups",
            },
            () => main(),
          ),
        ),
    );
    assertStringIncludes(chamadas[0].url, `/v1/projects/${REF_SANDBOX}/`);
  });
});
