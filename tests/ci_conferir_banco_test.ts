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
 * RODADA 5 (27/09/2026) — a faixa 79-82 ganha ferramenta. As migrations 79
 * (via `aplicar-migrations.yml`, run à parte), 80, 81 e 82 já estavam
 * aplicadas em produção sem passar pelo ledger. `gravar_ledger` ganhou a
 * opção `79-82` e `consulta` ganhou `6a-conferir-79-a-82` — uma consulta só
 * (não duas como 1a+1b ou 2a+2b), porque cada migration da faixa mexe numa
 * coisa diferente (RPC de devolução, RPC de pedido, ACL de RPC de
 * convidado, dado). Os hashes/ACLs de 6a são conferidos contra a árvore
 * (extraídos dos arquivos de migration, mesmo desenho do guard de 5a) num
 * teste próprio, não só copiados do runbook. A leitura pós-gravação também
 * passou a depender da faixa: 72–78 para as duas faixas antigas, 72–82 para
 * a nova (`VERIFICACAO_POS_LEDGER` no script).
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
      assert(
        opcoes.includes("6a-conferir-79-a-82"),
        "falta a opção `6a-conferir-79-a-82` (pré-checagem do ledger 79-82)",
      );
      assert(
        opcoes.includes("7a-conferir-83"),
        "falta a opção `7a-conferir-83` (pré-checagem do ledger 83)",
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

  await t.step(
    "gravar_ledger é choice fechado nao/72-74/75-78/79-82/83",
    () => {
      assertStringIncludes(
        yaml,
        // "83" entre aspas de propósito (achado 10, revisão de risco): sem
        // aspas é um YAML bare scalar NUMÉRICO — as outras opções têm hífen
        // (72-74 etc.) e nunca são ambíguas, só esta é um inteiro puro.
        'options:\n          - nao\n          - 72-74\n          - 75-78\n          - 79-82\n          - "83"',
      );
    },
  );

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

Deno.test("6a-conferir-79-a-82.sql — os hashes/ACLs embutidos batem com o que a árvore REALMENTE tem (guarda contra a faixa 79-82)", async (t) => {
  const { createHash } = require("node:crypto");

  /** Mesma extração do teste de 5a (prosrc entre "AS $$" e o "\n$$;" de
   * fechamento) — repetida aqui, não importada, para este teste continuar
   * autocontido se o de 5a mudar de forma no futuro. */
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

  const sql6a = await Deno.readTextFile(
    `${CONSULTAS_DIR}/6a-conferir-79-a-82.sql`,
  );

  await t.step(
    "79 — cancelar_devolucao e admin_devolucao_liberar_vinculo_reverso: os hashes em 6a são o md5 REAL dos corpos que a 20261179000000 deixa NESTA árvore",
    async () => {
      const sql79 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`,
      );

      const corpoCancelar = extrairCorpoDeFuncao(
        sql79,
        "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
      );
      const hashCancelar = md5Normalizado(corpoCancelar);
      assertEquals(
        hashCancelar,
        "74fd42d04f8ea55257a0aec73bfcabc1",
        "o corpo de cancelar_devolucao na 79 mudou nesta árvore — recalcule o valor de 6a e do runbook §7.2",
      );
      assertStringIncludes(sql6a, hashCancelar);

      const corpoLiberar = extrairCorpoDeFuncao(
        sql79,
        "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
      );
      const hashLiberar = md5Normalizado(corpoLiberar);
      assertEquals(
        hashLiberar,
        "83144be5ac2bc52f07f02274023a83ab",
        "o corpo de admin_devolucao_liberar_vinculo_reverso na 79 mudou nesta árvore — recalcule o valor de 6a e do runbook §7.2",
      );
      assertStringIncludes(sql6a, hashLiberar);
    },
  );

  await t.step(
    "80 — update_order_status_atomic: o hash em 6a é o md5 REAL do corpo que a 20261180000000 deixa NESTA árvore",
    async () => {
      const sql80 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261180000000_cliente_nao_cancela_com_cartao_vivo.sql`,
      );
      const corpo80 = extrairCorpoDeFuncao(
        sql80,
        "CREATE OR REPLACE FUNCTION public.update_order_status_atomic(",
      );
      const hash80 = md5Normalizado(corpo80);
      assertEquals(
        hash80,
        "ed2f7fd3e0177c027720049b2fe55d3b",
        "o corpo de update_order_status_atomic na 80 mudou nesta árvore — recalcule o valor de 6a",
      );
      assertStringIncludes(sql6a, hash80);
    },
  );

  await t.step(
    "81 — os mesmos três has_function_privilege() do bloco DO $$ final da 20261181000000 aparecem em 6a",
    async () => {
      const sql81 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261181000000_pedido_por_whatsapp_fecha_para_anon.sql`,
      );
      const inicioBlindagem = sql81.indexOf("DO $$");
      assert(
        inicioBlindagem >= 0,
        "não achei o bloco DO $$ de blindagem na 81",
      );
      const blocoBlindagem = sql81.slice(inicioBlindagem);
      const checagens = [
        ...blocoBlindagem.matchAll(
          /has_function_privilege\('(anon|authenticated)', '(public\.get_orders_by_(?:whatsapp_v3\(text,text,text\)|otp_v1\(text,text\)))', 'EXECUTE'\)/g,
        ),
      ].map((m) => m[0]);
      assert(
        checagens.length >= 3,
        `esperava pelo menos 3 checagens de has_function_privilege no bloco de blindagem da 81, achei ${checagens.length}`,
      );
      for (const checagem of checagens) {
        assertStringIncludes(
          sql6a,
          checagem,
          `6a não cita a checagem "${checagem}" que o bloco de blindagem da 81 usa`,
        );
      }
    },
  );

  await t.step(
    "82 — o predicado de 6a (cpf dentro de customer_data.address) bate com a VERIFICAÇÃO FINAL da 20261182000000",
    async () => {
      function normalizar(s: string): string {
        return s.replace(/\s+/g, " ").trim();
      }

      const sql82 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261182000000_o_cpf_da_janela_sai_do_endereco.sql`,
      );
      const m82 = sql82.match(
        /SELECT count\(\*\) INTO v_restantes\s+FROM public\.marketplace_orders o\s+(WHERE[\s\S]*?);/,
      );
      assert(
        m82,
        "não achei a VERIFICAÇÃO FINAL (v_restantes) na migration 82",
      );
      const wherePredicado82 = normalizar(m82[1]);

      const m6a = sql6a.match(
        /'82 zero pedidos com cpf no endereco', \(SELECT count\(\*\)::text FROM public\.marketplace_orders o (WHERE[\s\S]*?)\), '0'\)/,
      );
      assert(
        m6a,
        "não achei a linha '82 zero pedidos com cpf no endereco' em 6a",
      );
      const wherePredicado6a = normalizar(m6a[1]);

      assertEquals(
        wherePredicado6a,
        wherePredicado82,
        "o predicado de 6a para a 82 tem de ser EXATAMENTE o mesmo da verificação final da migration (mesmo conjunto de linhas)",
      );
    },
  );
});

Deno.test("7a-conferir-83.sql — os hashes/ACLs embutidos batem com o que a árvore REALMENTE tem (guarda contra a faixa 83)", async (t) => {
  const { createHash } = require("node:crypto");

  /** Mesma extração do teste de 6a — repetida aqui, autocontida. */
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

  const sql7a = await Deno.readTextFile(`${CONSULTAS_DIR}/7a-conferir-83.sql`);
  const sql83 = await Deno.readTextFile(
    `${MIGRATIONS_DIR}/20261183000000_o_crm_ve_todo_mundo.sql`,
  );

  const FUNCOES_83: readonly [string, string, string][] = [
    [
      "crm__pedidos_nao_pagos",
      "CREATE OR REPLACE FUNCTION public.crm__pedidos_nao_pagos(p_ate timestamptz)",
      "cb48ff1b4cae231cf79a965f06578f82",
    ],
    [
      "crm__nunca_comprou",
      "CREATE OR REPLACE FUNCTION public.crm__nunca_comprou(p_ate timestamptz)",
      "9a83cf34789b8b67c245648c8d82fc42",
    ],
    [
      "crm_visao",
      "CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)",
      "0e76e93760b7db349c294c40b4477c18",
    ],
    [
      "crm_clientes",
      "CREATE OR REPLACE FUNCTION public.crm_clientes(",
      "f31396c2f583756da56ae63a44cf09dc",
    ],
  ];

  for (const [nome, marcador, hashEsperado] of FUNCOES_83) {
    await t.step(
      `83 — ${nome}: o hash em 7a é o md5 REAL do corpo que a 20261183000000 deixa NESTA árvore`,
      () => {
        const corpo = extrairCorpoDeFuncao(sql83, marcador);
        const hash = md5Normalizado(corpo);
        assertEquals(
          hash,
          hashEsperado,
          `o corpo de ${nome} na 83 mudou nesta árvore — recalcule o valor de 7a e de SHA256_DO_LEDGER["83"]`,
        );
        assertStringIncludes(sql7a, hash);
      },
    );
  }

  await t.step(
    "83 — os 2 ajudantes novos SAEM de anon E authenticated em 7a (mesma régua de crm__vendas/crm__clientes_rfm)",
    () => {
      for (const funcao of [
        "crm__pedidos_nao_pagos(timestamptz)",
        "crm__nunca_comprou(timestamptz)",
      ]) {
        for (const papel of ["anon", "authenticated"]) {
          assertStringIncludes(
            sql7a,
            `has_function_privilege('${papel}', 'public.${funcao}', 'EXECUTE')::text, 'false'`,
          );
        }
      }
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

// ---------------------------------------------------------------------------
// 8a..8g (04/10/2026) — as consultas do lote do método de publicação na CAF.
// ---------------------------------------------------------------------------
const CONSULTAS_8 = [
  "8a-antes-92-a-202-objetos-e-corpos",
  "8b-papeis-contraditorios",
  "8c-subtotal-divergente",
  "8d-orfas-pos-drain",
  "8e-conferir-92-a-202-aplicado",
  "8f-conferir-201",
  "8g-cron-reconciliar",
];

/** Referência CONGELADA da 8i de 084c52dc (antes do snapshot de visibilidade): o
 * oráculo de que a impressão continua saindo igual. Não é consulta do menu. */
const REFERENCIA_8I_084C52DC = `${RAIZ}/tests/banco/referencia/8i-084c52dc.sql`;

/** As CTEs de um WITH, por nome (o corpo com o espaço em branco colapsado):
 * "soma", "div", "alvo"... O nome vale sem a lista de colunas `alvo(ordem, tabela)`. */
function ctesDe(sql: string): Map<string, string> {
  const limpo = sqlSemComentarios(sql).replace(/\r/g, "");
  const ini = limpo.indexOf("WITH ");
  const fim = limpo.lastIndexOf("\n)\nSELECT item, esperado");
  assert(ini >= 0 && fim > ini, "não achei o WITH ... SELECT final");
  const partes = limpo.slice(ini + 5, fim + 2).split(/\n\), /);
  const mapa = new Map<string, string>();
  partes.forEach((parte, i) => {
    // eslint-disable-next-line security/detect-unsafe-regex -- o grupo opcional roda no máximo uma vez, `\w+` e `\(` não se sobrepõem, e a entrada é SQL do próprio repositório.
    const m = parte.match(/^(\w+)(?:\([^)]*\))? AS \(([\s\S]*)$/);
    assert(m, `CTE ilegível: ${parte.slice(0, 40)}`);
    const corpo = i === partes.length - 1 ? m[2].replace(/\n\)\s*$/, "") : m[2];
    mapa.set(m[1], corpo.replace(/\s+/g, " ").trim());
  });
  return mapa;
}

/** O SQL sem comentários de linha (o cabeçalho EXPLICA o que a consulta não faz). */
function sqlSemComentarios(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

Deno.test("8a..8g — estão no menu do workflow, são UM SELECT só leitura, e a saída é item/esperado/vivo/ok", async (t) => {
  const { contarStatements } = require(SCRIPT);
  const yaml = await Deno.readTextFile(WORKFLOW);
  const m = yaml.match(/consulta:[\s\S]*?options:\n((?:\s{6,}- .+\n?)+)/);
  assert(m, "não achei as options de `consulta`");
  const opcoes = m[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim());
  for (const nome of CONSULTAS_8) {
    await t.step(nome, async () => {
      assert(opcoes.includes(nome), `falta a opção ${nome} no workflow`);
      const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
      assertEquals(contarStatements(sql), 1, `${nome}: exatamente 1 statement`);
      const limpo = sqlSemComentarios(sql);
      assert(
        /^\s*(WITH|SELECT)\b/i.test(limpo),
        `${nome}: tem de começar por WITH/SELECT`,
      );
      assert(
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
          limpo.replace(/'(?:[^']|'')*'/g, "''"),
        ),
        `${nome}: palavra de escrita fora de comentário/string`,
      );
      assert(
        /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok/.test(
          limpo,
        ),
        `${nome}: a saída final tem de ser item, esperado, vivo, ok`,
      );
      assert(/ORDER BY ok, item/.test(limpo), `${nome}: reprovadas primeiro`);
    });
  }
  await t.step("8b, 8c, 8d e 8g têm controle de visibilidade", async () => {
    for (const nome of CONSULTAS_8.filter((n) => /^8[bcdg]/.test(n))) {
      const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
      assert(
        sqlSemComentarios(sql).includes("'controle:"),
        `${nome}: sem linha de controle de visibilidade`,
      );
    }
  });
  await t.step(
    "8g nunca seleciona `command` nem `return_message` do cron",
    async () => {
      const limpo = sqlSemComentarios(
        await Deno.readTextFile(`${CONSULTAS_DIR}/8g-cron-reconciliar.sql`),
      );
      assert(
        !/\b(command|return_message)\b/i.test(limpo),
        "8g leria o comando do job (que consulta segredos do vault) ou a mensagem de retorno",
      );
    },
  );
  await t.step(
    "8c cita de onde vem a fórmula (a RPC que grava subtotal)",
    async () => {
      const sql = await Deno.readTextFile(
        `${CONSULTAS_DIR}/8c-subtotal-divergente.sql`,
      );
      assertStringIncludes(
        sql,
        "20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql",
      );
      assertStringIncludes(sql, "SUM(oi.quantity * oi.price)");
    },
  );
});

// 8h (04/10/2026) — PERFIL dos divergentes da 8c, só diagnóstico. Não é
// portão: a saída é secao/chave/pedidos, não item/esperado/vivo/ok.
Deno.test("8h — no menu, UM SELECT só leitura, mesma população da 8c, controles e nenhum dado pessoal ou de gateway", async (t) => {
  const { contarStatements } = require(SCRIPT);
  const nome = "8h-perfil-dos-pedidos-divergentes";
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
  const limpo = sqlSemComentarios(sql);
  await t.step("está no menu do workflow", async () => {
    const yaml = await Deno.readTextFile(WORKFLOW);
    const m = yaml.match(/consulta:[\s\S]*?options:\n((?:\s{6,}- .+\n?)+)/);
    assert(m, "não achei as options de `consulta`");
    const opcoes = m[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim());
    assert(opcoes.includes(nome), `falta a opção ${nome} no workflow`);
  });
  await t.step(
    "um statement, começa por WITH/SELECT, sem palavra de escrita",
    () => {
      assertEquals(contarStatements(sql), 1);
      assert(/^\s*(WITH|SELECT)\b/i.test(limpo));
      assert(
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
          limpo.replace(/'(?:[^']|'')*'/g, "''"),
        ),
        "palavra de escrita fora de comentário/string",
      );
    },
  );
  await t.step(
    "a saída é secao, chave, pedidos e tem os controles de visibilidade",
    () => {
      assert(
        /SELECT secao, chave, pedidos\s+FROM r\s+ORDER BY ordem, chave;/.test(
          limpo,
        ),
      );
      assertStringIncludes(limpo, "'controle', 'pedidos visiveis'");
      assertStringIncludes(limpo, "'controle', 'itens de pedido visiveis'");
      for (const tabela of [
        "historico de status visivel",
        "registros de pagamento visiveis",
        "estornos visiveis",
        "devolucoes visiveis",
      ]) {
        assertStringIncludes(limpo, `'controle', '${tabela}'`);
      }
    },
  );
  await t.step(
    "nenhum campo agrupado sai cru: lista fixa ou '(fora da lista, nao impresso)'",
    () => {
      const campos = [
        "status",
        "payment_status",
        "payment_method",
        "metodo_online",
        "canal",
      ];
      for (const f of campos) {
        assert(
          new RegExp(
            `SELECT \\d+, '${f}', cat_${f}, count\\(\\*\\)::text FROM div GROUP BY 3`,
          ).test(limpo),
          `a seção ${f} tem de agrupar pela categoria cat_${f}`,
        );
        assert(
          new RegExp(
            `CASE WHEN o\\.${f} IS NULL THEN '\\(nulo\\)'\\s+WHEN o\\.${f} IN \\([^)]*\\)\\s+THEN o\\.${f}\\s+ELSE '\\(fora da lista, nao impresso\\)' END AS cat_${f}`,
          ).test(limpo),
          `cat_${f} tem de ser nulo / lista fixa / fora da lista`,
        );
      }
      assertEquals(
        (limpo.match(/'\(fora da lista, nao impresso\)'/g) ?? []).length,
        campos.length,
      );
      assert(
        /CASE WHEN subtotal IS NULL THEN '\(nulo\)'/.test(limpo),
        "subtotal nulo nunca cai em '> 1000'",
      );
      assertStringIncludes(limpo, "'payment_status estornado'");
    },
  );
  await t.step(
    "a CTE `soma` é IDÊNTICA à da 8c (mesma população)",
    async () => {
      const soma = (texto: string) => {
        const m = sqlSemComentarios(texto).match(
          /WITH soma AS \(([\s\S]*?)\n\), /,
        );
        assert(m, "não achei a CTE soma");
        return m[1].replace(/\s+/g, " ").trim();
      };
      const sql8c = await Deno.readTextFile(
        `${CONSULTAS_DIR}/8c-subtotal-divergente.sql`,
      );
      assertEquals(soma(sql), soma(sql8c));
      assertStringIncludes(
        limpo,
        "WHERE s.subtotal IS DISTINCT FROM s.soma_itens",
      );
    },
  );
  await t.step(
    "nenhuma coluna de cliente, e o gateway só como presença",
    () => {
      assert(
        !/\b(customer_name|customer_data|user_id|email|telefone|phone|endereco|address|cpf|full_name)\b/i.test(
          limpo,
        ),
        "a 8h leria dado pessoal",
      );
      const usos = limpo.match(/gateway_payment_id[^,\n)]*/g) ?? [];
      assertEquals(usos.length, 1, "gateway_payment_id aparece uma vez só");
      assert(
        /gateway_payment_id IS NOT NULL/.test(usos[0]),
        "gateway_payment_id só como IS NOT NULL",
      );
    },
  );
});

// 8i (05/10/2026) — os divergentes da 8c são os atestados, no mesmo estado? Não
// substitui a 8c: prende uma decisão do dono a uma IMPRESSÃO DE INTEGRIDADE do
// conjunto e do estado (sha256 de uma serialização canônica; muda se qualquer
// campo coberto mudar; não diz origem; não substitui auditoria). Formato da 8c
// (item/esperado/vivo/ok), com a regra de privacidade da 8h: nenhum id sai.
// Versão com PAPEL E VISIBILIDADE NO MESMO SNAPSHOT (05/10/2026): a visibilidade
// das seis tabelas vem da derivação da 8j, calculada no mesmo statement; os
// sinais das tabelas auxiliares só são conclusivos com a tabela VISIVEL_*; e a
// impressão sai IDÊNTICA à de 084c52dc (referência congelada em tests/banco/referencia).
Deno.test("8i — no menu, UM SELECT só leitura no formato da 8c, mesma população, impressão idêntica à de 084c52dc, papel e visibilidade das seis tabelas no mesmo statement, sinal auxiliar só conclusivo com tabela visível, e nenhum id sai", async (t) => {
  const { contarStatements } = require(SCRIPT);
  const nome = "8i-divergentes-contra-base-atestada";
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
  const limpo = sqlSemComentarios(sql);
  await t.step("está no menu do workflow", async () => {
    const yaml = await Deno.readTextFile(WORKFLOW);
    const i = yaml.indexOf("consulta:");
    assert(i >= 0, "não achei a entrada `consulta`");
    assert(
      yaml.indexOf(`\n          - ${nome}\n`, i) > i,
      `falta a opção ${nome} no workflow`,
    );
  });
  await t.step(
    "um statement, começa por WITH/SELECT, sem palavra de escrita, saída item/esperado/vivo/ok com reprovadas primeiro",
    () => {
      assertEquals(contarStatements(sql), 1);
      assert(/^\s*(WITH|SELECT)\b/i.test(limpo));
      assert(
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
          limpo.replace(/'(?:[^']|'')*'/g, "''"),
        ),
        "palavra de escrita fora de comentário/string",
      );
      assert(
        /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok\s+FROM r\s+ORDER BY ok, item;/.test(
          limpo,
        ),
        "a saída final tem de ser item, esperado, vivo, ok, reprovadas primeiro",
      );
    },
  );
  await t.step(
    "a CTE `soma` é IDÊNTICA à da 8c, e a população é só os divergentes",
    async () => {
      const soma = (texto: string) => {
        const m = sqlSemComentarios(texto).match(
          /WITH soma AS \(([\s\S]*?)\n\), /,
        );
        assert(m, "não achei a CTE soma");
        return m[1].replace(/\s+/g, " ").trim();
      };
      const sql8c = await Deno.readTextFile(
        `${CONSULTAS_DIR}/8c-subtotal-divergente.sql`,
      );
      assertEquals(soma(sql), soma(sql8c));
      assertStringIncludes(
        limpo,
        "WHERE s.subtotal IS DISTINCT FROM s.soma_itens",
      );
    },
  );
  await t.step(
    "PRESERVAÇÃO: soma, div, enc e imp são IDÊNTICAS às da 084c52dc (referência congelada e pinada por sha256): o hash sai igual sobre os mesmos dados",
    async () => {
      const refTexto = await Deno.readTextFile(REFERENCIA_8I_084C52DC);
      const digest = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(refTexto),
        ),
      );
      const hex = Array.from(digest, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      assertEquals(
        hex,
        "d9585cdf8534f778761b01f51d0803057a8db3a2538c4eb3a0a0da7c9c8ea48a",
        "a referência congelada da 8i (084c52dc) mudou: ela é o oráculo da impressão",
      );
      const novas = ctesDe(sql);
      const antigas = ctesDe(refTexto);
      for (const nomeCte of ["soma", "div", "enc", "imp"]) {
        const nova = novas.get(nomeCte);
        assert(nova, `a 8i nova perdeu a CTE ${nomeCte}`);
        assertEquals(
          nova,
          antigas.get(nomeCte),
          `a CTE ${nomeCte} mudou: a impressão deixaria de sair igual à de 084c52dc`,
        );
      }
    },
  );
  await t.step(
    "PAPEL E VISIBILIDADE: alvo, vis, meta e julga são IDÊNTICAS às da 8j; o papel lê as mesmas duas colunas de pg_roles; o veredito é o mesmo CASE de quatro valores",
    async () => {
      const sql8j = await Deno.readTextFile(
        `${CONSULTAS_DIR}/8j-visibilidade-das-tabelas-auxiliares.sql`,
      );
      const novas = ctesDe(sql);
      const da8j = ctesDe(sql8j);
      for (const nomeCte of ["alvo", "vis", "meta", "julga"]) {
        const nova = novas.get(nomeCte);
        assert(nova, `a 8i perdeu a CTE ${nomeCte}`);
        assertEquals(
          nova,
          da8j.get(nomeCte),
          `a CTE ${nomeCte} diverge da 8j: a derivação tem de ser a MESMA`,
        );
      }
      const papel = novas.get("papel") ?? "";
      assertStringIncludes(papel, "current_user::text AS nome");
      assertStringIncludes(
        papel,
        "(SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS bypass",
      );
      assertStringIncludes(
        papel,
        "(SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) AS super",
      );
      const caso = (corpo: string) =>
        (corpo.match(/CASE WHEN[\s\S]*?END AS resultado/) ?? [""])[0];
      assert(caso(novas.get("veredito") ?? ""), "veredito sem CASE");
      assertEquals(
        caso(novas.get("veredito") ?? ""),
        caso(da8j.get("veredito") ?? ""),
        "o veredito tem de ter os mesmos quatro valores e a mesma ordem de ramos da 8j",
      );
      // o `apto` confere row_security_active contra a derivação, e exige SELECT
      const julga = novas.get("julga") ?? "";
      assertStringIncludes(julga, "AND m.pode_ler");
      assertStringIncludes(julga, "AND m.rls_ativa IS NOT NULL");
      assertStringIncludes(julga, "AND m.rls_ativa = (m.rls_ligada");
      assertStringIncludes(julga, "AND NOT (p.bypass OR p.super)");
      assertStringIncludes(julga, "AND NOT (m.dono AND NOT m.rls_forcada)");
      // as seis tabelas, as MESMAS da 8j, e a 8i não faz SQL dinâmico
      assertEquals(
        (novas.get("alvo") ?? "").match(/\(\d, '[a-z_]+'\)/g)?.length,
        6,
      );
      assert(!/\b(EXECUTE|format\s*\()/i.test(limpo), "SQL dinâmico");
    },
  );
  await t.step(
    "linhas novas: `papel efetivo` contra supabase_read_only_user (vivo = current_user), uma `<tabela>: visibilidade` por tabela, e os controles de pedidos e itens seguem '>0'",
    () => {
      assertStringIncludes(
        limpo,
        "SELECT 'papel efetivo', 'supabase_read_only_user', p.nome",
      );
      assertEquals(
        (limpo.match(/'papel efetivo'/g) ?? []).length,
        1,
        "uma linha de papel efetivo só",
      );
      assertStringIncludes(limpo, "SELECT lt.tabela || ': visibilidade',");
      assertEquals((limpo.match(/': visibilidade'/g) ?? []).length, 1);
      assertStringIncludes(
        limpo,
        "CASE WHEN lt.conclusivo THEN lt.resultado ELSE 'VISIVEL_VAZIA ou VISIVEL_COM_LINHAS' END",
      );
      assertStringIncludes(
        limpo,
        "(v.resultado IN ('VISIVEL_VAZIA', 'VISIVEL_COM_LINHAS')) AS conclusivo",
      );
      for (const c of [
        "controle: pedidos visiveis",
        "controle: itens de pedido visiveis",
      ]) {
        assertStringIncludes(limpo, `'${c}', '>0'`);
      }
      // os atributos do papel só INFORMAM (esperado = vivo) e saem em formato fechado
      assertStringIncludes(
        limpo,
        "'atributos do papel (so informa; nunca reprova)', a.texto, a.texto",
      );
      assertStringIncludes(
        limpo,
        "'rolbypassrls=' || COALESCE(p.bypass::text, '?') || '; rolsuper=' || COALESCE(p.super::text, '?')",
      );
    },
  );
  await t.step(
    "os três controles '>0' de tabela auxiliar SAÍRAM (zero visível de verdade não reprova) e cada sinal só é conclusivo quando a tabela é VISIVEL_*; senão sai INCONCLUSIVO (nunca ok)",
    () => {
      for (const c of [
        "controle: registros de pagamento visiveis",
        "controle: estornos visiveis",
        "controle: devolucoes visiveis",
      ]) {
        assert(!limpo.includes(c), `o controle '${c}' exigia linha e saiu`);
      }
      assert(
        !limpo.includes("tabela sem linha visivel"),
        "o texto antigo do inconclusivo por falta de linha saiu",
      );
      const plano = limpo.replace(/\s+/g, " ");
      for (const [tabela, campo] of [
        ["marketplace_order_payment_history", "tem_registro_de_pagamento"],
        ["order_refunds", "tem_estorno"],
        ["devolucoes", "tem_devolucao"],
      ]) {
        assertStringIncludes(
          plano,
          `CASE WHEN (SELECT lt.conclusivo FROM leitura lt WHERE lt.tabela = '${tabela}') THEN (SELECT count(*) FILTER (WHERE ${campo}) FROM div)::text ELSE 'INCONCLUSIVO (a tabela nao esta visivel para o papel; ver a linha de visibilidade)' END`,
        );
      }
      assertEquals(
        (limpo.match(/'INCONCLUSIVO \(/g) ?? []).length,
        3,
        "exatamente os três sinais auxiliares podem ser INCONCLUSIVO",
      );
      // um sinal nunca é decidido por EXISTS direto na tabela auxiliar na parte
      // que sai: a decisão é só a `leitura` (a `div` e a `vis` ficam antes)
      const fora = limpo.slice(
        limpo.indexOf("), r(item, esperado, vivo) AS ("),
      );
      assert(
        !/EXISTS \(SELECT 1 FROM public\.(marketplace_order_payment_history|order_refunds|devolucoes)/.test(
          fora,
        ),
        "a parte que sai não decide sinal por EXISTS direto",
      );
    },
  );
  await t.step(
    "as perguntas da base atestada: 3 divergentes, todos cancelled, sem item, sem cobrança, sem status de pagamento",
    () => {
      assertStringIncludes(
        limpo,
        "'pedidos divergentes (mesma regra da 8c; base atestada)', '3'",
      );
      assertStringIncludes(
        limpo,
        "count(*) FILTER (WHERE NOT cancelado) FROM div",
      );
      assertStringIncludes(
        limpo,
        "(o.status IS NOT DISTINCT FROM 'cancelled') AS cancelado",
      );
      assertStringIncludes(
        limpo,
        "count(*) FILTER (WHERE n_itens > 0) FROM div",
      );
      assertStringIncludes(
        limpo,
        "count(*) FILTER (WHERE tem_cobranca_no_gateway) FROM div",
      );
      assertStringIncludes(
        limpo,
        "o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')",
      );
      assertStringIncludes(
        limpo,
        "count(*) FILTER (WHERE tem_status_de_pagamento) FROM div",
      );
    },
  );
  await t.step(
    "a impressão de integridade: a impressão ATESTADA pelo dono (05/10/2026, run 37377459724) UMA vez só, no esperado da linha da impressão, contra o sha256 completo (64 hex) da serialização",
    () => {
      const atestada =
        "6382d110fb62af00bcf3be7868185662f46b10faa3206af0fa8e01d3776d1b7b";
      assertEquals(
        sql.split(`'${atestada}'`).length - 1,
        1,
        "a impressão atestada tem de aparecer UMA vez (o teste de banco a troca em memória)",
      );
      assertEquals(limpo.split(`'${atestada}'`).length - 1, 1);
      assertEquals(
        (sql.match(/'[0-9a-f]{64}'/g) ?? []).length,
        1,
        "nenhum outro literal de 64 hex no arquivo",
      );
      assertEquals(
        (sql.match(/'A_ATESTAR'/g) ?? []).length,
        0,
        "o marcador do modo medir saiu do arquivo commitado",
      );
      assertEquals(
        limpo.split(
          "encode(sha256(convert_to(string_agg(linha, '#' ORDER BY id), 'UTF8')), 'hex')",
        ).length - 1,
        1,
        "a impressão é encode(sha256(convert_to(<serialização>, 'UTF8')), 'hex'): os 64 hex inteiros",
      );
      assert(
        !/\bmd5\b|\bleft\(/i.test(limpo),
        "nada de md5 nem de prefixo truncado",
      );
      assert(
        /SELECT 'impressao de integridade do conjunto e do estado \(sha256, 64 hex\)', '6382d110fb62af00bcf3be7868185662f46b10faa3206af0fa8e01d3776d1b7b',\s+COALESCE\(\(SELECT hash FROM imp\), '\(sem divergentes\)'\)/.test(
          limpo,
        ),
        "a linha da impressão compara a constante com o hash vivo",
      );
    },
  );
  await t.step(
    "a serialização é canônica: 19 campos em ordem fixa, comprimento:texto, NULL = N, numeric(12,2) em texto nos de escala fixa e trim_scale (nunca numeric(12,2)) em total_amount e shipping_cost, timestamptz em UTC ISO, uma linha por divergente ordenada por id",
    () => {
      assertStringIncludes(
        limpo,
        "string_agg(CASE WHEN f.v IS NULL THEN 'N' ELSE length(f.v)::text || ':' || f.v END,",
      );
      assertStringIncludes(limpo, "';' ORDER BY f.n) AS linha");
      const campos = [
        "d.id::text",
        "to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')",
        "to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')",
        "d.status",
        "d.payment_status",
        "d.payment_method",
        "d.metodo_online",
        "d.canal",
        "d.subtotal::numeric(12,2)::text",
        "d.total::numeric(12,2)::text",
        "d.shipping::numeric(12,2)::text",
        "d.discount::numeric(12,2)::text",
        "d.valor_estornado::numeric(12,2)::text",
        "to_char(d.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')",
        "d.tem_cobranca_no_gateway::text",
        "d.n_itens::text",
        "d.soma_itens::numeric(12,2)::text",
        // numeric SEM escala: ::numeric(12,2) arredondaria a 3ª casa e a esconderia
        "trim_scale(d.total_amount)::text",
        "trim_scale(d.shipping_cost)::text",
      ];
      campos.forEach((c, i) => {
        assertStringIncludes(limpo, `(${i + 1}, ${c})`);
      });
      // só dentro da `enc` (a `alvo` da visibilidade também tem linhas `(n, 'texto')`)
      const soEnc = limpo.slice(
        limpo.indexOf("), enc AS ("),
        limpo.indexOf("), imp AS ("),
      );
      assertEquals((soEnc.match(/\(\d+, [^\n]+\),?\n/g) ?? []).length, 19);
      for (const col of ["total_amount", "shipping_cost"]) {
        assert(
          // eslint-disable-next-line security/detect-non-literal-regexp -- `col` vem só do array literal ["total_amount", "shipping_cost"] da linha acima, nunca de entrada externa.
          !new RegExp(`d\\.${col}::numeric`).test(limpo),
          `${col} não pode entrar por ::numeric(12,2): arredonda a 3ª casa`,
        );
        // e as duas colunas vêm do pedido, na CTE que alimenta a serialização
        assertStringIncludes(limpo, `o.${col}`);
      }
      assertStringIncludes(limpo, ") AS f(n, v)");
      assertStringIncludes(limpo, "GROUP BY d.id");
    },
  );
  await t.step(
    "o `id` nunca sai: fora da população (soma/div/enc/imp), a parte que sai (r e o SELECT final) não tem `id` nem `.id`, só `(SELECT hash FROM imp)`",
    () => {
      const marcador = "), r(item, esperado, vivo) AS (";
      const i = limpo.indexOf(marcador);
      assert(i > 0, "não achei a CTE r");
      const saida = limpo.slice(i);
      const semTexto = saida.replace(/'(?:[^']|'')*'/g, "''");
      assert(
        !/(\bid\b|\.id\b)/i.test(semTexto),
        "a 8i expôs `id` na parte que sai",
      );
      assertEquals(
        (saida.match(/\bFROM imp\b/g) ?? []).length,
        1,
        "a impressão sai só por (SELECT hash FROM imp)",
      );
    },
  );
  await t.step(
    "nenhuma coluna de cliente, e o gateway só como presença",
    () => {
      assert(
        !/\b(customer_name|customer_data|user_id|email|telefone|phone|endereco|address|cpf|full_name)\b/i.test(
          limpo,
        ),
        "a 8i leria dado pessoal",
      );
      const usos = limpo.match(/gateway_payment_id[^,\n)]*/g) ?? [];
      assertEquals(usos.length, 1, "gateway_payment_id aparece uma vez só");
      assert(
        /gateway_payment_id IS NOT NULL/.test(usos[0]),
        "gateway_payment_id só como IS NOT NULL",
      );
    },
  );
});

// 8j (05/10/2026) — as seis tabelas que a 8h e a 8i leem estão VISÍVEIS para o
// papel que lê? Diagnóstico: separa "tabela vazia" de "tabela com linhas que a RLS
// esconde". Não substitui a 8c/8h/8i e não atesta a impressão da 8i. Formato da 8c
// (item/esperado/vivo/ok); só metadado e 0/>0; nenhum id, dinheiro ou dado pessoal.
Deno.test("8j — no menu, UM SELECT só leitura no formato da 8c, cobre as seis tabelas da 8h/8i, usa row_security_active, contagem 0/>0 por EXISTS, quatro vereditos e nenhum dado pessoal ou financeiro", async (t) => {
  const { contarStatements } = require(SCRIPT);
  const nome = "8j-visibilidade-das-tabelas-auxiliares";
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
  const limpo = sqlSemComentarios(sql);
  const semTexto = limpo.replace(/'(?:[^']|'')*'/g, "''");
  const TABELAS = [
    "marketplace_orders",
    "marketplace_order_items",
    "marketplace_order_history",
    "marketplace_order_payment_history",
    "order_refunds",
    "devolucoes",
  ];
  await t.step("está no menu do workflow", async () => {
    const yaml = await Deno.readTextFile(WORKFLOW);
    const i = yaml.indexOf("consulta:");
    assert(i >= 0, "não achei a entrada `consulta`");
    assert(
      yaml.indexOf(`\n          - ${nome}\n`, i) > i,
      `falta a opção ${nome} no workflow`,
    );
  });
  await t.step(
    "um statement, começa por WITH/SELECT, sem palavra de escrita nem SQL dinâmico, saída item/esperado/vivo/ok com reprovadas primeiro",
    () => {
      assertEquals(contarStatements(sql), 1);
      assert(/^\s*(WITH|SELECT)\b/i.test(limpo));
      assert(
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
          semTexto,
        ),
        "palavra de escrita fora de comentário/string",
      );
      assert(
        !/\b(EXECUTE|query_to_xml\w*|dblink\w*|format|pg_read_file|lo_import)\b/i.test(
          semTexto,
        ),
        "SQL dinâmico (ou leitura de arquivo) fora do que a consulta aceita",
      );
      assert(
        /SELECT item, esperado, vivo, ok\s+FROM r\s+ORDER BY ok, item;/.test(
          limpo,
        ),
        "a saída final tem de ser item, esperado, vivo, ok, reprovadas primeiro",
      );
    },
  );
  await t.step(
    "cobre as seis tabelas da 8h/8i, cada uma com um EXISTS exato (nunca a estimativa do catálogo, nunca count)",
    () => {
      for (const tabela of TABELAS) {
        assertStringIncludes(limpo, `, '${tabela}')`);
        assertStringIncludes(limpo, `EXISTS (SELECT 1 FROM public.${tabela})`);
      }
      assertEquals(
        (limpo.match(/EXISTS \(SELECT 1 FROM public\./g) ?? []).length,
        6,
      );
      assertEquals((limpo.match(/\bFROM public\./g) ?? []).length, 6);
      assert(
        !/reltuples|n_live_tup|pg_stat\w*|\bcount\s*\(|\bsum\s*\(/i.test(
          semTexto,
        ),
        "a contagem é só 0/>0 por EXISTS: nada de estimativa do catálogo nem agregado",
      );
      assertStringIncludes(limpo, "WHEN v.tem_linha THEN '>0' ELSE '0' END");
    },
  );
  await t.step(
    "mostra os metadados do papel efetivo e usa row_security_active (nunca relrowsecurity sozinho)",
    () => {
      for (const trecho of [
        "current_user::text AS nome",
        "r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.rolname = current_user",
        "r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user",
        "current_setting('row_security')",
        "c.relkind::text AS relkind",
        "c.relrowsecurity AS rls_ligada",
        "c.relforcerowsecurity AS rls_forcada",
        "pg_has_role(current_user, c.relowner, 'USAGE') AS dono",
        "has_table_privilege(current_user, c.oid, 'SELECT') AS pode_ler",
        "row_security_active(c.oid) AS rls_ativa",
        "m.relkind = 'r'",
      ]) {
        assertStringIncludes(limpo, trecho);
      }
      // a derivação independente que cruza com row_security_active
      assertStringIncludes(
        limpo.replace(/\s+/g, " "),
        "m.rls_ativa = (m.rls_ligada AND NOT (p.bypass OR p.super) AND NOT (m.dono AND NOT m.rls_forcada))",
      );
    },
  );
  await t.step(
    "os quatro vereditos, e só os dois conclusivos são ok; VISIVEL_VAZIA exige RLS NÃO ativa",
    () => {
      const usados = new Set(
        [
          ...limpo.matchAll(/'(VISIVEL_[A-Z_]+|RLS_ATIVA_[A-Z_]+|BLOQUEIA)'/g),
        ].map((m) => m[1]),
      );
      assertEquals([...usados].sort(), [
        "BLOQUEIA",
        "RLS_ATIVA_INCONCLUSIVO",
        "VISIVEL_COM_LINHAS",
        "VISIVEL_VAZIA",
      ]);
      const plano = limpo.replace(/\s+/g, " ");
      assertStringIncludes(
        plano,
        "WHEN j.apto AND NOT j.rls_ativa AND NOT j.tem_linha THEN 'VISIVEL_VAZIA'",
      );
      assertStringIncludes(
        plano,
        "WHEN j.apto AND NOT j.rls_ativa AND j.tem_linha THEN 'VISIVEL_COM_LINHAS'",
      );
      assertStringIncludes(
        plano,
        "WHEN j.apto AND j.rls_ativa THEN 'RLS_ATIVA_INCONCLUSIVO'",
      );
      assertStringIncludes(plano, "ELSE 'BLOQUEIA' END AS resultado");
      assertStringIncludes(
        plano,
        "v.resultado IN ('VISIVEL_VAZIA', 'VISIVEL_COM_LINHAS')",
      );
    },
  );
  await t.step(
    "nenhum id, valor de dinheiro, coluna de cliente ou id de gateway: só metadado",
    () => {
      assert(
        !/\b(customer_name|customer_data|user_id|email|telefone|phone|endereco|address|cpf|full_name|subtotal|total|price|valor_estornado|amount|shipping|discount|gateway_payment_id|payment_status|paid_at|quantity)\b/i.test(
          semTexto,
        ),
        "a 8j leria dado pessoal ou financeiro",
      );
      assert(
        !/(\bid\b|\.id\b)/i.test(semTexto),
        "a 8j expôs `id` (nenhuma coluna de linha de tabela entra: só o catálogo e EXISTS)",
      );
    },
  );
  await t.step(
    "o cabeçalho diz o que ela NÃO faz: não atesta a 8i, não dispensa a 8c, cita a fonte de row_security_active",
    () => {
      assertStringIncludes(sql, "NÃO atesta o hash da 8i nem dispensa a 8c");
      assertStringIncludes(sql, "src/backend/utils/misc/rls.c");
      assertStringIncludes(sql, "check_enable_rls");
      // SELECT só de COLUNA roda a consulta e a linha sai BLOQUEIA: o cabeçalho
      // não pode voltar a dizer que esse ramo é inalcançável (revisão 05/10/2026).
      assertStringIncludes(
        sql,
        'a ramificação BLOQUEIA de "sem SELECT" É alcançável',
      );
      assert(
        !/não é alcançável|inalcançável/i.test(sql),
        "o cabeçalho voltou a afirmar que o ramo BLOQUEIA de 'sem SELECT' não é alcançável",
      );
    },
  );
});

// 8k (07/10/2026) — a 8c com a prova de loja VAZIA. Substitui a 8c nas
// `conferenciasAntesDoApply` do lote 92-202 (a 8c fica no menu, LEGADA). Mesma
// população e mesma fórmula da 8c; em todos os ramos exige tabela comum, SELECT de
// tabela inteira, row_security_active=false (coerente com a derivação) e os tipos;
// a vazia só é provada para AS DUAS tabelas. O rol fechado tem 20 itens.
Deno.test("8k — no menu, UM SELECT só leitura, `soma` IDÊNTICA à da 8c, sem ONLY, tabelas achadas pelo schema public, pré-condição em todos os ramos, vazia CONJUNTA, rol fechado de 20 itens e nenhum dado pessoal ou financeiro", async (t) => {
  const { contarStatements, ROL_DA_8K, ROL_FECHADO_POR_CONSULTA } =
    require(SCRIPT);
  const nome = "8k-subtotal-divergente-ou-vazia-provada";
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
  const limpo = sqlSemComentarios(sql);
  const semTexto = limpo.replace(/'(?:[^']|'')*'/g, "''");
  const plano = limpo.replace(/\s+/g, " ");
  await t.step("está no menu do workflow", async () => {
    const yaml = await Deno.readTextFile(WORKFLOW);
    const i = yaml.indexOf("consulta:");
    assert(i >= 0, "não achei a entrada `consulta`");
    assert(
      yaml.indexOf(`\n          - ${nome}\n`, i) > i,
      `falta a opção ${nome} no workflow`,
    );
    // a 8c LEGADA continua no menu
    assert(yaml.indexOf("\n          - 8c-subtotal-divergente\n", i) > i);
  });
  await t.step(
    "um statement, começa por WITH, sem palavra de escrita nem SQL dinâmico nem ONLY, saída item/esperado/vivo/ok com reprovadas primeiro",
    () => {
      assertEquals(contarStatements(sql), 1);
      assert(/^\s*WITH\b/i.test(limpo));
      assert(
        !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
          semTexto,
        ),
        "palavra de escrita fora de comentário/string",
      );
      assert(
        !/\b(EXECUTE|query_to_xml\w*|dblink\w*|format|pg_read_file|lo_import)\b/i.test(
          semTexto,
        ),
        "SQL dinâmico (ou leitura de arquivo)",
      );
      assert(
        !/\bONLY\b/i.test(semTexto),
        "ONLY esconderia as linhas dos filhos por herança sob um pai vazio",
      );
      assert(
        !/::regclass/i.test(semTexto),
        "tabela achada por ::regclass seguiria o search_path",
      );
      assert(
        /SELECT item, esperado, vivo, ok\s+FROM r\s+ORDER BY ok, item;/.test(
          limpo,
        ),
        "a saída final tem de ser item, esperado, vivo, ok, reprovadas primeiro",
      );
    },
  );
  await t.step(
    "a CTE `soma` é IDÊNTICA à da 8c (mesma população e fórmula) e o cabeçalho cita de onde vem a fórmula",
    async () => {
      const sql8c = await Deno.readTextFile(
        `${CONSULTAS_DIR}/8c-subtotal-divergente.sql`,
      );
      assertEquals(ctesDe(sql).get("soma"), ctesDe(sql8c).get("soma"));
      assertStringIncludes(
        sql,
        "20260951000000_frete_do_pedido_e_do_proprio_carrinho.sql",
      );
      assertStringIncludes(sql, "SUM(oi.quantity * oi.price)");
      // as contagens e os divergentes são os da 8c
      assertStringIncludes(
        plano,
        "(SELECT count(*) FROM soma WHERE subtotal IS DISTINCT FROM soma_itens) AS divergentes",
      );
      assertStringIncludes(
        plano,
        "(SELECT count(*) FROM soma WHERE subtotal IS DISTINCT FROM soma_itens AND n_itens = 0) AS divergentes_sem_item",
      );
      assertStringIncludes(
        plano,
        "(SELECT count(*) FROM public.marketplace_order_items) AS itens",
      );
    },
  );
  await t.step(
    "as duas tabelas são achadas pelo schema public (relnamespace) e pelo nome; os metadados são os de row_security_active, has_table_privilege (tabela inteira), relkind e format_type",
    () => {
      for (const tabela of ["marketplace_orders", "marketplace_order_items"])
        assertStringIncludes(
          plano,
          `ON c.relname = '${tabela}' AND c.relnamespace = 'public'::regnamespace`,
        );
      assertEquals(
        (limpo.match(/c\.relnamespace = 'public'::regnamespace/g) ?? []).length,
        2,
      );
      for (const trecho of [
        "has_table_privilege(current_user, c.oid, 'SELECT') AS pode_ler",
        "row_security_active(c.oid) AS rls_ativa",
        "c.relkind::text AS relkind",
        "pg_has_role(current_user, c.relowner, 'USAGE') AS dono",
        "format_type(a.atttypid, a.atttypmod)",
        "current_setting('row_security')",
      ])
        assertStringIncludes(plano, trecho);
      assert(
        !/has_column_privilege|has_any_column_privilege/i.test(semTexto),
        "SELECT só de coluna não serve",
      );
    },
  );
  await t.step(
    "pré-condição em TODOS os ramos: relkind r, SELECT de tabela, row_security_active falso E igual à derivação (a mesma da 8j), nas duas tabelas",
    () => {
      assertStringIncludes(
        plano,
        "(po.rls_ligada AND NOT (p.bypass OR p.super) AND NOT (po.dono AND NOT po.rls_forcada)) AS ped",
      );
      assertStringIncludes(
        plano,
        "(it.rls_ligada AND NOT (p.bypass OR p.super) AND NOT (it.dono AND NOT it.rls_forcada)) AS ite",
      );
      assertStringIncludes(
        plano,
        "COALESCE(po.relkind = 'r' AND po.pode_ler AND po.rls_ativa IS NOT NULL AND po.rls_ativa = d.ped AND NOT po.rls_ativa, false) AS ped_pronta",
      );
      assertStringIncludes(
        plano,
        "COALESCE(it.relkind = 'r' AND it.pode_ler AND it.rls_ativa IS NOT NULL AND it.rls_ativa = d.ite AND NOT it.rls_ativa, false) AS ite_pronta",
      );
      // as linhas de metadado reprovam em qualquer ramo (o `ok` delas não depende das contagens)
      assertStringIncludes(
        plano,
        "COALESCE(po.rls_ativa = d.ped AND NOT po.rls_ativa, false)",
      );
      assertStringIncludes(
        plano,
        "COALESCE(it.rls_ativa = d.ite AND NOT it.rls_ativa, false)",
      );
      assertStringIncludes(plano, "COALESCE(po.pode_ler, false)");
      assertStringIncludes(plano, "COALESCE(it.pode_ler, false)");
      assertStringIncludes(plano, "COALESCE(po.relkind = 'r', false)");
      assertStringIncludes(plano, "COALESCE(it.relkind = 'r', false)");
    },
  );
  await t.step(
    "a vazia é CONJUNTA (as duas contagens em 0 E as duas tabelas prontas) e os controles só passam com mais de 0 ou vazia provada",
    () => {
      assertStringIncludes(
        plano,
        "(j.zero_nas_duas AND j.ped_pronta AND j.ite_pronta) AS vazia_provada",
      );
      assertStringIncludes(
        plano,
        "(v.pedidos = 0 AND v.itens = 0) AS zero_nas_duas",
      );
      assertStringIncludes(plano, "(j.pedidos > 0 OR j.vazia_provada)");
      assertStringIncludes(plano, "(j.itens > 0 OR j.vazia_provada)");
      assertStringIncludes(plano, "(NOT j.zero_nas_duas OR j.vazia_provada)");
      assertStringIncludes(plano, "(j.divergentes = 0)");
      assertStringIncludes(plano, "(j.divergentes_sem_item = 0)");
    },
  );
  await t.step(
    "o rol fechado do código tem 20 itens, sem repetição, é o contrato desta consulta, e CADA item aparece como literal no .sql (e só eles)",
    () => {
      assertEquals(ROL_DA_8K.length, 20);
      assertEquals(new Set(ROL_DA_8K).size, ROL_DA_8K.length);
      assertEquals(
        Object.entries(ROL_FECHADO_POR_CONSULTA).find(([n]) => n === nome)?.[1],
        ROL_DA_8K,
      );
      for (const item of ROL_DA_8K)
        assertStringIncludes(
          limpo,
          `'${item}'`,
          `o item do rol "${item}" não existe no .sql`,
        );
      const doSql = [...limpo.matchAll(/SELECT\s+'([^']+)',\s+'[^']*',/g)].map(
        (m) => m[1],
      );
      assertEquals(doSql.length, 20, "o .sql monta 20 linhas de resultado");
      for (const item of doSql)
        assert(
          ROL_DA_8K.includes(item),
          `o .sql monta "${item}" e o rol do código não o tem`,
        );
    },
  );
  await t.step(
    "nenhum id, valor de dinheiro, coluna de cliente ou id de gateway sai na resposta: só agregados e metadado",
    () => {
      assert(
        !/\b(customer_name|customer_data|user_id|email|telefone|phone|endereco|address|cpf|full_name|valor_estornado|amount|shipping|discount|gateway_payment_id|payment_status|paid_at)\b/i.test(
          semTexto,
        ),
        "a 8k leria dado pessoal ou financeiro",
      );
      // a parte que MONTA a saída (r) só usa agregados e metadados, nunca colunas de linha
      const r = semTexto.slice(
        semTexto.indexOf("r(item, esperado, vivo, ok) AS ("),
      );
      assert(
        !/\b(o|oi|soma)\.(id|subtotal|price|quantity|order_id|soma_itens)\b/.test(
          r,
        ),
        "a saída leria uma coluna de linha de pedido ou item",
      );
    },
  );
  await t.step(
    "o cabeçalho declara os limites: evidência local não prova a Savy vazia, RLS ativa reprova (lado seguro), PG17, ONLY, falha alta, e cita a fonte de row_security_active",
    () => {
      assertStringIncludes(sql, "Evidência LOCAL não prova a Savy vazia");
      assertStringIncludes(sql, "src/backend/utils/misc/rls.c");
      assertStringIncludes(sql, "check_enable_rls");
      assertStringIncludes(sql, "Postgres 17");
      assertStringIncludes(sql, "42P01");
      assertStringIncludes(sql, "42501");
      assertStringIncludes(sql, "ONLY");
      assertStringIncludes(sql, "VAZIA PROVADA");
      assertStringIncludes(sql, "estritamente igual ou mais forte que a 8c");
      assertStringIncludes(sql, "BYPASSRLS");
    },
  );
});

Deno.test("8a/8e — os md5 embutidos batem com o que as migrations 92..202 desta árvore REALMENTE definem", async (t) => {
  const { createHash } = require("node:crypto");
  const nomes: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS_DIR)) {
    if (
      e.isFile &&
      /^2026119[2-9]|^2026120[0-2]/.test(e.name) &&
      !e.name.startsWith("rollback") &&
      e.name.endsWith(".sql")
    )
      nomes.push(e.name);
  }
  nomes.sort();
  assertEquals(
    nomes.length,
    10,
    "esperava as 10 migrations 92..202 (a 93 não existe)",
  );
  const textos: Record<string, string> = {};
  for (const n of nomes)
    textos[n] = await Deno.readTextFile(`${MIGRATIONS_DIR}/${n}`);

  const pares = (sql: string) =>
    new Map<string, string>(
      [...sql.matchAll(/\('([a-z_0-9]+)', '([0-9a-f]{32})'\)/g)].map(
        (x) => [x[1], x[2]] as [string, string],
      ),
    );
  const sql8a = await Deno.readTextFile(
    `${CONSULTAS_DIR}/8a-antes-92-a-202-objetos-e-corpos.sql`,
  );
  const sql8e = await Deno.readTextFile(
    `${CONSULTAS_DIR}/8e-conferir-92-a-202-aplicado.sql`,
  );
  // 8a tem DUAS listas de md5: `base` (as 53 funções que 92..202 substituem) e
  // `base_90_91` (o que a 90/91 já têm de ter deixado). Cada uma é lida do seu CTE.
  const fatia = (sql: string, de: string, ate: string) => {
    const i = sql.indexOf(de);
    const j = sql.indexOf(ate, i);
    assert(i >= 0 && j > i, `não achei o trecho ${de} … ${ate} em 8a`);
    return sql.slice(i, j);
  };
  const base = pares(fatia(sql8a, "base(fn, h) AS (VALUES", "corpos_sig AS ("));
  // base_90_91 tem 3 colunas: fn, assinatura exata e md5.
  const trio9091 = [
    ...fatia(
      sql8a,
      "base_90_91(fn, assinatura, h) AS (VALUES",
      "tabelas_90_91(",
    ).matchAll(
      /\('([a-z_0-9]+)', '([a-z_0-9]+\([a-z_0-9[\], ]*\))', '([0-9a-f]{32})'\)/g,
    ),
  ];
  const base9091 = new Map<string, string>(trio9091.map((x) => [x[1], x[3]]));
  const assinaturas9091 = new Map<string, string>(
    trio9091.map((x) => [x[1], x[2]]),
  );
  const final = pares(sql8e);

  /** Corpo da ÚLTIMA definição da função nas migrations 92..202. */
  function corpoFinal(fn: string): string {
    let ultima: { n: string; i: number } | null = null;
    for (const n of nomes) {
      const re = new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`,
        "gi",
      );
      let r: RegExpExecArray | null;
      while ((r = re.exec(textos[n]))) ultima = { n, i: r.index };
    }
    assert(ultima, `${fn}: nenhuma migration 92..202 a define`);
    const resto = textos[ultima.n].slice(ultima.i);
    const abre = /\bAS\s+(\$[a-z_0-9]*\$)/i.exec(resto);
    assert(abre, `${fn}: não achei o corpo`);
    const ini = abre.index + abre[0].length;
    const fim = resto.indexOf(abre[1], ini);
    assert(fim > ini, `${fn}: não achei o fechamento do corpo`);
    return resto.slice(ini, fim);
  }

  await t.step(
    "as listas têm o tamanho esperado (61 funções finais, 53 de base, 8 novas)",
    () => {
      assertEquals(final.size, 61);
      assertEquals(base.size, 53);
      const novas = [...final.keys()].filter((f) => !base.has(f)).sort();
      assertEquals(novas.length, 8);
      for (const f of novas) assertStringIncludes(sql8a, `('${f}')`);
      for (const f of base.keys())
        assert(final.has(f), `${f} está na base e não no final`);
    },
  );

  await t.step(
    "todo md5 FINAL de 8e é o md5 do corpo da última definição da função na árvore",
    () => {
      for (const [fn, h] of final) {
        const calculado = createHash("md5")
          .update(corpoFinal(fn).replace(/\r/g, ""))
          .digest("hex");
        assertEquals(
          calculado,
          h,
          `${fn}: o corpo na árvore mudou — recalcule 8e`,
        );
      }
    },
  );

  await t.step(
    "todo md5 de BASE de 8a aparece literalmente no preflight de uma migration 92..202",
    () => {
      const todo = Object.values(textos).join("\n");
      for (const [fn, h] of base) {
        assertStringIncludes(
          todo,
          h,
          `${fn}: o baseline de 8a não está em nenhum preflight`,
        );
      }
    },
  );

  await t.step(
    "8a — a lista base_90_91 (5 funções): o md5 é o do corpo que a 90/91 desta árvore deixam, e consta no pré-voo do rollback delas",
    async () => {
      assertEquals([...base9091.keys()].sort(), [
        "confirmar_aviso_ao_lojista",
        "liberar_aviso_ao_lojista",
        "marcar_visitas_da_reconciliacao",
        "pagamentos_a_reconciliar",
        "reservar_aviso_ao_lojista",
      ]);
      const arq = async (prefixo: string) => {
        const achados: string[] = [];
        for await (const e of Deno.readDir(MIGRATIONS_DIR))
          if (e.isFile && e.name.startsWith(prefixo)) achados.push(e.name);
        assertEquals(achados.length, 1, `esperava 1 arquivo ${prefixo}*`);
        return await Deno.readTextFile(`${MIGRATIONS_DIR}/${achados[0]}`);
      };
      const m90 = await arq("20261190000000_");
      const m91 = await arq("20261191000000_");
      const rb90 = await arq("rollback-manual-20261190000000_");
      const rb91 = await arq("rollback-manual-20261191000000_");
      const corpoDe = (texto: string, fn: string) => {
        const r = new RegExp(
          `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`,
          "i",
        ).exec(texto);
        assert(r, `${fn}: não definida nesta migration`);
        const resto = texto.slice(r.index);
        const abre = /\bAS\s+(\$[a-z_0-9]*\$)/i.exec(resto);
        assert(abre, `${fn}: sem corpo`);
        const ini = abre.index + abre[0].length;
        return resto.slice(ini, resto.indexOf(abre[1], ini));
      };
      const donos: Record<string, [string, string]> = {
        pagamentos_a_reconciliar: [m90, rb90],
        marcar_visitas_da_reconciliacao: [m90, rb90],
        reservar_aviso_ao_lojista: [m91, rb91],
        confirmar_aviso_ao_lojista: [m91, rb91],
        liberar_aviso_ao_lojista: [m91, rb91],
      };
      // a ASSINATURA em 8a = a do CREATE FUNCTION da migration (tipos, na ordem)
      const assinaturaDe = (texto: string, fn: string) => {
        const r = new RegExp(
          `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(([^)]*)\\)`,
          "i",
        ).exec(texto);
        assert(r, `${fn}: não definida nesta migration`);
        const tipos = r[1]
          .split(",")
          .map((a) =>
            a
              .trim()
              .replace(/\s+/g, " ")
              .replace(/ DEFAULT .*$/i, ""),
          )
          .filter((a) => a !== "")
          .map((a) => a.split(" ").slice(1).join(" "));
        return `${fn}(${tipos.join(", ")})`;
      };
      assertEquals(assinaturas9091.size, 5);
      for (const [fn, assinatura] of assinaturas9091) {
        assertEquals(
          assinatura,
          assinaturaDe(donos[fn][0], fn),
          `${fn}: a assinatura em 8a difere da do CREATE FUNCTION na migration 90/91`,
        );
      }
      for (const [fn, h] of base9091) {
        const [mig, rb] = donos[fn];
        assertEquals(
          createHash("md5")
            .update(corpoDe(mig, fn).replace(/\r/g, ""))
            .digest("hex"),
          h,
          `${fn}: o corpo na migration 90/91 mudou — recalcule o baseline de 8a`,
        );
        assertStringIncludes(
          rb,
          h,
          `${fn}: o pré-voo do rollback não tem o mesmo md5`,
        );
      }
    },
  );

  await t.step(
    "8a — as tabelas/colunas da 90/91 em 8a existem nas migrations (nome, coluna e RLS)",
    async () => {
      const m90 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql`,
      );
      const m91 = await Deno.readTextFile(
        `${MIGRATIONS_DIR}/20261191000000_aviso_de_cobranca_duplicada_sai_uma_vez.sql`,
      );
      const bloco = fatia(sql8a, "tabelas_90_91(tabela", "novas(fn)");
      const linhas = [
        ...bloco.matchAll(
          /\('([a-z_]+)', '([a-z_]+)', '([a-z ]+)', '(9[01])'\)/g,
        ),
      ];
      assertEquals(linhas.length, 6);
      for (const [, tabela, coluna, , mig] of linhas) {
        const texto = mig === "90" ? m90 : m91;
        const ini = texto.indexOf(
          `CREATE TABLE IF NOT EXISTS public.${tabela}`,
        );
        assert(ini >= 0, `${tabela}: CREATE TABLE não achado na ${mig}`);
        const def = texto.slice(ini, texto.indexOf(");", ini));
        assert(
          def.includes(coluna),
          `${tabela}.${coluna}: não está no CREATE TABLE da ${mig}`,
        );
        assertStringIncludes(
          texto,
          `ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY`,
        );
      }
    },
  );

  await t.step(
    "as funções de 8a/8e são exatamente as que 92..202 criam ou substituem",
    () => {
      const definidas = new Set<string>();
      for (const n of nomes) {
        for (const x of textos[n].matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)\s*\(/gi,
        ))
          definidas.add(x[1]);
      }
      assertEquals([...definidas].sort(), [...final.keys()].sort());
    },
  );

  await t.step(
    "a base do liberar_cobranca_do_pedido em 8a é a que o pin do script usa",
    async () => {
      // a 92..202 não a redefine (guarda em ci_verificar_pagamentos_config_cartao_test.ts)
      for (const n of nomes) {
        assert(
          !/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.liberar_cobranca_do_pedido\s*\(/i.test(
            textos[n],
          ),
          `${n} redefine liberar_cobranca_do_pedido: a BASE de 8a deixa de valer`,
        );
      }
      assertStringIncludes(sql8a, "bae7882a60430547ee32b4b2092580a8");
      const {
        hashesEsperados,
      } = require("../scripts/publicacao/verificar-pagamentos-ikcous.cjs");
      assertEquals(
        hashesEsperados().liberar,
        "bae7882a60430547ee32b4b2092580a8",
        "a BASE de 8a tem de ser o mesmo md5 que a prova do publicar-functions pina",
      );
    },
  );
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
      for (const faixa of ["72-74", "75-78", "79-82", "83"]) {
        const conteudo = await Deno.readTextFile(
          `${CONSULTAS_DIR}/ledger-${faixa}.sql`,
        );
        // Não lança = passou.
        conferirHashDoLedger(faixa, conteudo);
        // eslint-disable-next-line security/detect-object-injection -- `faixa` vem só do array literal ["72-74", "75-78", "79-82", "83"] três linhas acima, nunca de entrada externa.
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
    "ledger 79-82: pré-checagem (6a, uma consulta só) toda ok=true -> grava (endpoint de escrita) e confere 72-82",
    async () => {
      const linhasOk6a = [
        {
          checagem: "79 admin_devolucao_liberar_vinculo_reverso existe",
          valor: "true",
          esperado: "true",
          ok: true,
        },
        {
          checagem: "82 zero pedidos com cpf no endereco",
          valor: "0",
          esperado: "0",
          ok: true,
        },
      ];
      const { chamadas, resultado } = await comFetchStubado(
        [
          { ok: true, corpo: JSON.stringify(linhasOk6a) }, // 6a (única consulta da faixa)
          { ok: true, status: 201, corpo: "[]" }, // INSERT do ledger
          {
            ok: true,
            corpo: JSON.stringify([
              { version: "20261179000000", name: "cancelar_devolucao_..." },
            ]),
          }, // verificação 72-82
        ],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "79-82",
              },
              () => main(),
            ),
          ),
      );
      const { saida } = resultado;
      // Só 3 chamadas — a faixa 79-82 tem UMA consulta de pré-checagem (6a),
      // não duas como 72-74 (2a+2b) e 75-78 (1a+1b).
      assertEquals(chamadas.length, 3);

      assertStringIncludes(chamadas[0].url, "/database/query/read-only");
      const corpoPreCheck = JSON.parse(String(chamadas[0].opts.body));
      assertStringIncludes(
        corpoPreCheck.query,
        "82 zero pedidos com cpf no endereco",
        "a pré-checagem de 79-82 tem de rodar a 6a-conferir-79-a-82, não outra consulta",
      );

      assertStringIncludes(
        chamadas[1].url,
        `/v1/projects/${REF_LOJA}/database/query`,
      );
      assert(!chamadas[1].url.includes("read-only"));
      const corpoGravacao = JSON.parse(String(chamadas[1].opts.body));
      assertStringIncludes(
        corpoGravacao.query,
        "INSERT INTO supabase_migrations",
      );
      assertStringIncludes(corpoGravacao.query, "20261182000000");

      assertStringIncludes(chamadas[2].url, "/database/query/read-only");
      const corpoVerificacao = JSON.parse(String(chamadas[2].opts.body));
      assertStringIncludes(corpoVerificacao.query, "20261182999999");

      assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída do ledger");
      assertStringIncludes(saida, "20261179000000");
    },
  );

  await t.step(
    "ledger 83: pré-checagem (7a, uma consulta só) toda ok=true -> grava (endpoint de escrita) e confere 72-83",
    async () => {
      const linhasOk7a = [
        {
          checagem: "83 crm__pedidos_nao_pagos existe",
          valor: "true",
          esperado: "true",
          ok: true,
        },
        {
          checagem: "83 crm_visao SAI de anon",
          valor: "false",
          esperado: "false",
          ok: true,
        },
      ];
      const { chamadas, resultado } = await comFetchStubado(
        [
          { ok: true, corpo: JSON.stringify(linhasOk7a) }, // 7a (única consulta da faixa)
          { ok: true, status: 201, corpo: "[]" }, // INSERT do ledger
          {
            ok: true,
            corpo: JSON.stringify([
              { version: "20261183000000", name: "o_crm_ve_todo_mundo" },
            ]),
          }, // verificação 72-83
        ],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "83",
              },
              () => main(),
            ),
          ),
      );
      const { saida } = resultado;
      // Só 3 chamadas — a faixa 83 tem UMA consulta de pré-checagem (7a).
      assertEquals(chamadas.length, 3);

      assertStringIncludes(chamadas[0].url, "/database/query/read-only");
      const corpoPreCheck = JSON.parse(String(chamadas[0].opts.body));
      assertStringIncludes(
        corpoPreCheck.query,
        "83 crm_visao SAI de anon",
        "a pré-checagem de 83 tem de rodar a 7a-conferir-83, não outra consulta",
      );

      assertStringIncludes(
        chamadas[1].url,
        `/v1/projects/${REF_LOJA}/database/query`,
      );
      assert(!chamadas[1].url.includes("read-only"));
      const corpoGravacao = JSON.parse(String(chamadas[1].opts.body));
      assertStringIncludes(
        corpoGravacao.query,
        "INSERT INTO supabase_migrations",
      );
      assertStringIncludes(corpoGravacao.query, "20261183000000");

      assertStringIncludes(chamadas[2].url, "/database/query/read-only");
      const corpoVerificacao = JSON.parse(String(chamadas[2].opts.body));
      assertStringIncludes(corpoVerificacao.query, "20261183999999");

      assert(!saida.includes(TOKEN_FALSO), "o token vazou na saída do ledger");
      assertStringIncludes(saida, "20261183000000");
    },
  );

  await t.step(
    "ledger 83: alguma linha de 7a com ok=false -> ABORTA sem gravar (o INSERT nunca é chamado)",
    async () => {
      const linhasComFalha7a = [
        {
          checagem: "83 crm__pedidos_nao_pagos existe",
          valor: "true",
          esperado: "true",
          ok: true,
        },
        {
          checagem: "83 crm_visao SAI de anon",
          valor: "true",
          esperado: "false",
          ok: false,
        },
      ];
      const { chamadas, resultado } = await comFetchStubado(
        [{ ok: true, corpo: JSON.stringify(linhasComFalha7a) }],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "83",
              },
              () => comSaidaCapturada(() => main()),
            ),
          ),
      );
      assertEquals(resultado.valor?.retornou, false);
      assertEquals(resultado.valor?.codigoSaida, 1);
      // Só a pré-checagem (7a) rodou — o INSERT nunca é chamado.
      assertEquals(chamadas.length, 1);
      assertStringIncludes(chamadas[0].url, "/database/query/read-only");
    },
  );

  await t.step(
    "ledger 79-82: alguma linha de 6a com ok=false -> ABORTA sem gravar (o INSERT nunca é chamado)",
    async () => {
      const linhasComFalha6a = [
        {
          checagem: "79 admin_devolucao_liberar_vinculo_reverso existe",
          valor: "true",
          esperado: "true",
          ok: true,
        },
        {
          checagem: "82 zero pedidos com cpf no endereco",
          valor: "3",
          esperado: "0",
          ok: false,
        },
      ];
      const { chamadas, resultado } = await comFetchStubado(
        [{ ok: true, corpo: JSON.stringify(linhasComFalha6a) }],
        () =>
          comConsoleCapturado(() =>
            comEnv(
              {
                SUPABASE_ACCESS_TOKEN: TOKEN_FALSO,
                PROJETO: "loja",
                LEDGER: "79-82",
              },
              () => comSaidaCapturada(() => main()),
            ),
          ),
      );
      assertEquals(resultado.valor?.retornou, false);
      assertEquals(resultado.valor?.codigoSaida, 1);
      // Só a pré-checagem (6a) rodou — o INSERT nunca é chamado.
      assertEquals(chamadas.length, 1);
      assertStringIncludes(chamadas[0].url, "/database/query/read-only");
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

// ===========================================================================
// 9a / ledger 60-66 (06/10/2026) — a prova por OBJETO das migrations 20261160..
// 20261166 da CAF e o backfill do REGISTRO delas. A prova contra um Postgres
// real é tests/banco/lote-60-66-viva.cjs; aqui ficam o que se prova SEM banco:
// os md5 contra os arquivos, o rol fechado, a forma do ledger, a escrita única e
// as recusas.
// ===========================================================================
const CONSULTA_9A = "9a-conferir-60-a-66-aplicado";
const FUNCOES_DA_9A = [
  "buscar_por_codigo_barras",
  "get_admin_orders_cancelados_recentes",
  "get_admin_orders_paged",
  "get_product_recommendations",
  "limpar_cotacoes_fora_da_janela",
  "registrar_venda_presencial",
  "upsert_store_config",
];

async function migrationsDaArvore(): Promise<Record<string, string>> {
  const textos: Record<string, string> = {};
  for await (const e of Deno.readDir(MIGRATIONS_DIR)) {
    if (e.isFile && e.name.endsWith(".sql") && !e.name.startsWith("rollback"))
      textos[e.name] = await Deno.readTextFile(`${MIGRATIONS_DIR}/${e.name}`);
  }
  return textos;
}

/** O corpo da ÚLTIMA definição da função em TODAS as migrations da árvore (a
 * migration mais nova que a define), com o nome do arquivo. */
function corpoMaisNovo(
  textos: Record<string, string>,
  fn: string,
): { arquivo: string; corpo: string } {
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const arquivo of Object.keys(textos).sort()) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- padrão montado de constantes do próprio teste
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`,
      "gi",
    );
    let r: RegExpExecArray | null;
    // eslint-disable-next-line security/detect-object-injection -- índice vindo de lista fixa do próprio teste
    while ((r = re.exec(textos[arquivo]))) {
      // eslint-disable-next-line security/detect-object-injection -- índice vindo de lista fixa do próprio teste
      const resto = textos[arquivo].slice(r.index);
      const abre = /\bAS\s+(\$[a-z_0-9]*\$)/i.exec(resto);
      assert(abre, `${fn}: não achei o corpo em ${arquivo}`);
      const ini = abre.index + abre[0].length;
      const fim = resto.indexOf(abre[1], ini);
      assert(fim > ini, `${fn}: sem fechamento do corpo em ${arquivo}`);
      achado = { arquivo, corpo: resto.slice(ini, fim) };
    }
  }
  assert(achado, `${fn}: nenhuma migration a define`);
  return achado;
}

Deno.test("9a — no menu, UM SELECT só leitura no formato item/esperado/vivo/ok, SEM ler o ledger (a forma do ledger é do rodarLedger)", async () => {
  const { contarStatements } = require(SCRIPT);
  const yaml = await Deno.readTextFile(WORKFLOW);
  // eslint-disable-next-line security/detect-unsafe-regex -- regex sobre texto de arquivo do próprio repositório
  const m = yaml.match(/consulta:[\s\S]*?options:\n((?:\s{6,}- .+\n?)+)/);
  assert(m, "não achei as options de `consulta`");
  const opcoes = m[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim());
  assert(opcoes.includes(CONSULTA_9A), "falta a opção 9a no workflow");
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  assertEquals(contarStatements(sql), 1);
  const limpo = sqlSemComentarios(sql);
  assert(/^\s*(WITH|SELECT)\b/i.test(limpo));
  assert(
    !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
      limpo.replace(/'(?:[^']|'')*'/g, "''"),
    ),
    "palavra de escrita fora de comentário/string",
  );
  assert(
    /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok/.test(
      limpo,
    ),
  );
  assert(/ORDER BY ok, item/.test(limpo));
  assert(
    !/schema_migrations|supabase_migrations/.test(limpo),
    "a 9a dá a MESMA resposta antes e depois do backfill: não olha o ledger",
  );
  assert(
    sqlSemComentarios(sql).includes("'controle:"),
    "sem controle de visibilidade",
  );
  assertStringIncludes(sql, "8e da CAF");
  assertStringIncludes(sql, "NÃO é evidência das migrations 62..64");
});

Deno.test("9a — todo md5 de corpo é o da migration MAIS NOVA da árvore que define a função (recalculado dos arquivos)", async (t) => {
  const { createHash } = require("node:crypto");
  const textos = await migrationsDaArvore();
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  const bloco = sql.slice(
    sql.indexOf("final(fn, h) AS (VALUES"),
    sql.indexOf("), acls(fn, esperado)"),
  );
  const finais = new Map<string, string>(
    [...bloco.matchAll(/\('([a-z_0-9]+)', '([0-9a-f]{32})'\)/g)].map(
      (x) => [x[1], x[2]] as [string, string],
    ),
  );
  assertEquals([...finais.keys()].sort(), [...FUNCOES_DA_9A].sort());
  const dono: Record<string, string> = {};
  for (const [fn, h] of finais) {
    await t.step(fn, () => {
      const { arquivo, corpo } = corpoMaisNovo(textos, fn);
      // eslint-disable-next-line security/detect-object-injection -- índice vindo de lista fixa do próprio teste
      dono[fn] = arquivo.slice(0, 14);
      assertEquals(
        createHash("md5").update(corpo.replace(/\r/g, "")).digest("hex"),
        h,
        `${fn}: o corpo mais novo (${arquivo}) mudou — atualize a 9a NO MESMO PR`,
      );
    });
  }
  await t.step(
    "quem é o dono do corpo: 60..66 só para as três que nenhuma migration posterior redefine; as outras quatro são da 20261199",
    () => {
      assertEquals(dono, {
        buscar_por_codigo_barras: "20261161000000",
        get_admin_orders_cancelados_recentes: "20261199000000",
        get_admin_orders_paged: "20261199000000",
        get_product_recommendations: "20261160000000",
        limpar_cotacoes_fora_da_janela: "20261166000000",
        registrar_venda_presencial: "20261199000000",
        upsert_store_config: "20261199000000",
      });
    },
  );
  await t.step(
    "nenhuma migration > 20261166 redefine as funções que a 9a trata como só de 60..66",
    () => {
      for (const fn of [
        "buscar_por_codigo_barras",
        "get_product_recommendations",
        "limpar_cotacoes_fora_da_janela",
      ]) {
        for (const [arquivo, texto] of Object.entries(textos)) {
          if (arquivo.slice(0, 14) <= "20261166000000") continue;
          assert(
            // eslint-disable-next-line security/detect-non-literal-regexp -- padrão montado de constantes do próprio teste
            !new RegExp(
              `(CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION|DROP\\s+FUNCTION(\\s+IF\\s+EXISTS)?)\\s+(public\\.)?${fn}\\b`,
              "i",
            ).test(texto),
            `${arquivo} redefine ${fn}: a 9a passa a provar a migration mais nova, não a 60..66`,
          );
        }
      }
    },
  );
});

/** O CABEÇALHO (do CREATE até o `AS $tag$`) da definição MAIS NOVA da função na
 * árvore, e o que dele se deriva no formato do item `atributos <fn>` da 9a. */
function atributosDoCabecalhoMaisNovo(
  textos: Record<string, string>,
  fn: string,
): { arquivo: string; derivado: string } {
  let achado: { arquivo: string; cab: string } | null = null;
  for (const arquivo of Object.keys(textos).sort()) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- padrão montado de constantes do próprio teste
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`,
      "gi",
    );
    let r: RegExpExecArray | null;
    // eslint-disable-next-line security/detect-object-injection -- índice vindo de lista fixa do próprio teste
    while ((r = re.exec(textos[arquivo]))) {
      // eslint-disable-next-line security/detect-object-injection -- índice vindo de lista fixa do próprio teste
      const resto = textos[arquivo].slice(r.index);
      const abre = /\bAS\s+\$[a-z_0-9]*\$/i.exec(resto);
      assert(abre, `${fn}: não achei o corpo em ${arquivo}`);
      achado = { arquivo, cab: resto.slice(0, abre.index) };
    }
  }
  assert(achado, `${fn}: nenhuma migration a define`);
  const cab = achado.cab;
  // argumentos: o parêntese de abertura da função até o parêntese que o fecha
  const ini = cab.indexOf("(");
  let prof = 0;
  let fim = -1;
  for (let i = ini; i < cab.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- índice numérico de laço
    if (cab[i] === "(") prof++;
    // eslint-disable-next-line security/detect-object-injection -- índice numérico de laço
    else if (cab[i] === ")" && --prof === 0) {
      fim = i;
      break;
    }
  }
  assert(fim > ini, `${fn}: parêntese dos argumentos não fecha`);
  const dentro = cab.slice(ini + 1, fim);
  const args: string[] = [];
  let p = 0;
  let atual = "";
  for (const ch of dentro) {
    if (ch === "(") p++;
    if (ch === ")") p--;
    if (ch === "," && p === 0) {
      args.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual.trim()) args.push(atual);
  const argumentos = args
    .map((a) =>
      a
        .replace(/\s+DEFAULT\s+[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join(", ");
  const depois = cab.slice(fim + 1);
  const ret = /RETURNS\s+([\s\S]+?)\s+LANGUAGE/i.exec(depois);
  assert(ret, `${fn}: sem RETURNS ... LANGUAGE`);
  const retorno = ret[1]
    .replace(/public\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lang = /LANGUAGE\s+([a-z_0-9]+)/i.exec(depois)?.[1].toLowerCase();
  assert(lang, `${fn}: sem LANGUAGE`);
  const secdef = /SECURITY\s+DEFINER/i.test(depois);
  const volatil = /\bSTABLE\b/i.test(depois)
    ? "s"
    : /\bIMMUTABLE\b/i.test(depois)
      ? "i"
      : "v";
  const estrito =
    /\bSTRICT\b/i.test(depois) ||
    /RETURNS\s+NULL\s+ON\s+NULL\s+INPUT/i.test(depois);
  const cfg = /SET\s+search_path\s*(?:=|TO)\s*([^\n]+)/i.exec(depois);
  const config = cfg
    ? `search_path=${cfg[1]
        .split(",")
        .map((x) => x.replace(/['"]/g, "").trim())
        .join(", ")}`
    : "(nenhum)";
  return {
    arquivo: achado.arquivo,
    derivado: `secdef=${secdef} config=${config} volatil=${volatil} strict=${estrito} dono=postgres args=${argumentos} retorno=${retorno} lang=${lang}`,
  };
}

Deno.test("9a — todo `atributos <fn>` pinado é o que o cabeçalho da migration MAIS NOVA da função diz (SECURITY, search_path, volatilidade, STRICT, argumentos, retorno); o dono é postgres medido só localmente", async (t) => {
  const textos = await migrationsDaArvore();
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  const limpo = sqlSemComentarios(sql);
  const bloco = limpo.slice(
    limpo.indexOf("atributos_esperados(fn, esperado) AS (VALUES"),
    limpo.indexOf("), defaults_aceitos"),
  );
  const pinados = new Map<string, string>(
    [...bloco.matchAll(/\('([a-z_0-9]+)', '([^']+)'\)/g)].map(
      (x) => [x[1], x[2]] as [string, string],
    ),
  );
  assertEquals([...pinados.keys()].sort(), [...FUNCOES_DA_9A].sort());
  for (const [fn, esperado] of pinados) {
    await t.step(fn, () => {
      assert(
        esperado.includes(" dono=postgres "),
        `${fn}: o dono pinado é exatamente postgres (sem normalização)`,
      );
      const { arquivo, derivado } = atributosDoCabecalhoMaisNovo(textos, fn);
      assertEquals(
        esperado,
        derivado,
        `${fn}: o cabeçalho mais novo (${arquivo}) diz outra coisa — atualize a 9a NO MESMO PR`,
      );
    });
  }
  // o item compara pelo vivo com a MESMA expressão, por igualdade exata
  for (const trecho of [
    "'secdef=' || p.prosecdef::text",
    "array_to_string(p.proconfig, ';')",
    "p.provolatile::text",
    "p.proisstrict::text",
    "pg_get_userbyid(p.proowner)",
    "pg_get_function_identity_arguments(p.oid)",
    "pg_get_function_result(p.oid)",
    "SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang",
  ]) {
    assertStringIncludes(limpo, trecho);
  }
});

Deno.test("9a — A2/A5: restrição e FK leem adiável/adiada (e update/match na FK), índice lê nulls_not_distinct e collation/opclass, e o privilégio de coluna lê aclexplode(attacl) com o relacl sem SELECT para authenticated e PUBLIC", async () => {
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  const limpo = sqlSemComentarios(sql);
  for (const trecho of [
    "k.condeferrable::text",
    "k.condeferred::text",
    "k.confupdtype::text",
    "k.confmatchtype::text",
    "i.indnullsnotdistinct::text",
    "unnest(i.indcollation::oid[], i.indclass::oid[])",
    "cn.nspname || '.' || co.collname",
    "ocn.nspname || '.' || oc.opcname",
    "aclexplode(a.attacl)",
    "aclexplode(c.relacl)",
    "tabela_authenticated=false tabela_public=false tabela_efetivo=false",
    "has_table_privilege('authenticated', 'public.produtos', 'SELECT')",
  ]) {
    assertStringIncludes(limpo, trecho);
  }
  assert(
    !limpo.includes("has_column_privilege"),
    "has_column_privilege aceita GRANT de tabela: não pode voltar",
  );
  for (const esp of [
    "adiavel=false adiada=false",
    "update=a match=s adiavel=false adiada=false",
    "nulls_not_distinct=false",
    "classes=pg_catalog.default/pg_catalog.text_ops",
    "classes=-/pg_catalog.timestamptz_ops",
  ]) {
    assertStringIncludes(limpo, esp);
  }
});

Deno.test("9a — cada item do rol fechado do código existe no .sql, e o rol é o que a consulta monta", async () => {
  const { ROL_DA_9A } = require(SCRIPT);
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  const limpo = sqlSemComentarios(sql);
  const final = [...limpo.matchAll(/\('([a-z_0-9]+)', '[0-9a-f]{32}'\)/g)].map(
    (m) => m[1],
  );
  assertEquals(final.length, 7);
  const prefixosDeLaco = [
    ...final.map((f) => `corpo final ${f}`),
    ...final.map((f) => `sobrecargas ${f}`),
    ...final.map((f) => `atributos ${f}`),
  ];
  const esperadoPorLaco = new Set([
    ...prefixosDeLaco,
    ...[
      "buscar_por_codigo_barras",
      "get_admin_orders_cancelados_recentes",
      "get_admin_orders_paged",
      "registrar_venda_presencial",
    ].map((f) => `acl ${f}`),
    ...[
      "produtos.codigo_barras",
      "product_variants.codigo_barras",
      "marketplace_orders.canal",
      "marketplace_orders.vendedor_id",
    ].map((c) => `coluna ${c}`),
    ...["vw_produtos_public", "vw_produtos_admin"].flatMap((v) => [
      `vista ${v} colunas`,
      `vista ${v} definicao`,
      `vista ${v} opcoes`,
    ]),
    ...[
      "produtos_codigo_barras_unico",
      "product_variants_codigo_barras_unico",
      "idx_marketplace_orders_presencial",
      "shipping_quotes_cache_created_at_idx",
    ].map((i) => `indice ${i}`),
    ...[
      "marketplace_orders_canal_check",
      "shipping_quotes_cache_chave_unica",
    ].map((r) => `restricao ${r}`),
  ]);
  for (const item of ROL_DA_9A) {
    if (esperadoPorLaco.has(item)) continue;
    assertStringIncludes(
      limpo,
      `'${item}'`,
      `o item do rol "${item}" não existe no .sql`,
    );
  }
  for (const item of esperadoPorLaco)
    assert(
      ROL_DA_9A.includes(item),
      `o .sql monta "${item}" e o rol do código não o tem`,
    );
  assertEquals(
    new Set(ROL_DA_9A).size,
    ROL_DA_9A.length,
    "rol com item repetido",
  );
  assertEquals(ROL_DA_9A.length, 47);
});

Deno.test("9a — CHECK, defaults e vistas por IGUALDADE EXATA contra lista fechada / md5 (sem parser de prefixo, sem coleta de literais)", async () => {
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  const limpo = sqlSemComentarios(sql);
  // o que foi trocado: nenhuma extração por regex do texto do CHECK nem do default
  for (const proibido of [
    "regexp_matches(pg_get_constraintdef",
    "regexp_match(pg_get_expr",
    "nega=",
    "trim_scale",
  ]) {
    assert(
      !limpo.includes(proibido),
      `não pode voltar o parser de prefixo/coleta de literais: ${proibido}`,
    );
  }
  // CHECK: lista fechada de formas, só a medida
  const formas = [
    ...limpo.matchAll(
      /formas_check\(forma, canonico\) AS \(VALUES\s*([\s\S]*?)\), restricoes_vivas/g,
    ),
  ];
  assertEquals(formas.length, 1);
  assertEquals(
    formas[0][1].trim().split("\n").length,
    1,
    "uma única forma fechada",
  );
  assertStringIncludes(
    formas[0][1],
    "CHECK ((canal = ANY (ARRAY[''online''::text, ''presencial''::text])))",
  );
  // defaults: lista fechada, comparação por igualdade do pg_get_expr
  assertStringIncludes(limpo, "k.expr = pg_get_expr(d.adbin, d.adrelid)");
  // vistas: md5 da definição (pg_get_viewdef normalizado) pinado por vista
  assertStringIncludes(
    limpo,
    "md5(regexp_replace(regexp_replace(pg_get_viewdef(c.oid, true)",
  );
  assertStringIncludes(limpo, "'3cdde92a1bc457879a210c59e023be20'");
  assertStringIncludes(limpo, "'2912f1cb227cd8fac3c2d2c09c06e945'");
});

Deno.test("9a — a lista de colunas das vistas é a do SELECT da migration 20261160 (e nenhuma outra migration as recria)", async () => {
  const textos = await migrationsDaArvore();
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${CONSULTA_9A}.sql`);
  const m60 =
    textos["20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql"];
  for (const vista of ["vw_produtos_public", "vw_produtos_admin"]) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- padrão montado de constantes do próprio teste
    const re = new RegExp(
      `CREATE OR REPLACE VIEW public\\.${vista} AS\\s+SELECT([\\s\\S]*?)FROM public\\.produtos`,
    );
    const colunas = m60
      .match(re)![1]
      .split(",")
      .map((c) => c.trim())
      .join(",");
    assertStringIncludes(
      sql,
      `'${colunas}'`,
      `${vista}: colunas diferentes da 60`,
    );
    for (const [arq, texto] of Object.entries(textos)) {
      if (arq.slice(0, 14) > "20261160000000")
        assert(
          // eslint-disable-next-line security/detect-non-literal-regexp -- padrão montado de constantes do próprio teste
          !new RegExp(
            `(CREATE|REPLACE)[A-Z ]*VIEW\\s+(public\\.)?${vista}\\b`,
            "i",
          ).test(texto),
          `${arq} recria ${vista}: a 9a confere a lista de colunas da 60`,
        );
    }
  }
});

Deno.test("ledger-60-66.sql — as 7 versões 20261160..20261166 com os nomes dos arquivos; UM INSERT guardado (150 e 167 presentes, nenhuma da faixa); hash pinado", async () => {
  const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/ledger-60-66.sql`);
  const {
    contarStatements,
    conferirHashDoLedger,
    SHA256_DO_LEDGER,
    versoesDoInsert,
  } = require(SCRIPT);
  const noDisco: Array<{ version: string; name: string }> = [];
  for await (const e of Deno.readDir(MIGRATIONS_DIR)) {
    const m = e.name.match(/^(2026116[0-6]000000)_([a-z0-9_-]+)\.sql$/);
    if (e.isFile && m) noDisco.push({ version: m[1], name: m[2] });
  }
  noDisco.sort((a, b) => a.version.localeCompare(b.version));
  assertEquals(noDisco.length, 7);
  assertEquals(versoesDoInsert(sql), noDisco);
  assertEquals(contarStatements(sql), 1);
  const limpo = sqlSemComentarios(sql);
  assertStringIncludes(limpo, "ON CONFLICT (version) DO NOTHING;");
  assert(
    /^\s*INSERT INTO supabase_migrations\.schema_migrations \(version, name\)\s+SELECT/.test(
      limpo,
    ),
  );
  assertStringIncludes(limpo, "WHERE version = '20261150000000')");
  assertStringIncludes(limpo, "WHERE version = '20261167000000')");
  assertStringIncludes(
    limpo,
    "AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations",
  );
  assertStringIncludes(
    limpo,
    "version >= '20261160000000' AND version < '20261167000000'",
  );
  conferirHashDoLedger("60-66", sql);
  assert(SHA256_DO_LEDGER["60-66"]);
  for (const editado of [
    sql.replace("AND NOT EXISTS", "AND EXISTS"),
    sql.replace("20261166000000", "20261201000000"),
  ]) {
    let lancou = false;
    try {
      conferirHashDoLedger("60-66", editado);
    } catch {
      lancou = true;
    }
    assert(lancou, "o hash pinado recusa o arquivo editado");
  }
});

// --------------------------- o rol fechado --------------------------------
function linhasDe(rol: string[], mudar: (l: any, i: number) => any = (l) => l) {
  return rol.map((item, i) =>
    mudar({ item, esperado: "x", vivo: "x", ok: true }, i),
  );
}

Deno.test("rol fechado — só a resposta EXATA autoriza gravar (parcial, duplicado, extra, ok string, sem ok, formato estranho NÃO autorizam)", async (t) => {
  const { conferirRolFechado, ROL_DA_9A, ROL_DA_8E } = require(SCRIPT);
  const chamar = (linhas: unknown, rol = ROL_DA_9A) =>
    conferirRolFechado({
      faixa: "60-66",
      nomeConsulta: CONSULTA_9A,
      linhas,
      rol,
    });
  await t.step("a resposta exata, toda ok=true, passa (as duas faixas)", () => {
    chamar(linhasDe(ROL_DA_9A));
    conferirRolFechado({
      faixa: "92-202",
      nomeConsulta: "8e",
      linhas: linhasDe(ROL_DA_8E),
      rol: ROL_DA_8E,
    });
  });
  const casos: Array<[string, unknown, string]> = [
    [
      "parcial: faltam itens, os presentes são ok=true",
      linhasDe(ROL_DA_9A).slice(0, -3),
      "faltam 3",
    ],
    [
      "item duplicado",
      [...linhasDe(ROL_DA_9A), linhasDe(ROL_DA_9A)[0]],
      "repetidos",
    ],
    [
      "item desconhecido a mais",
      [
        ...linhasDe(ROL_DA_9A),
        { item: "intruso", esperado: "x", vivo: "x", ok: true },
      ],
      "desconhecidos: intruso",
    ],
    [
      "item trocado por outro (mesmo tamanho)",
      linhasDe(ROL_DA_9A, (l, i) => (i === 0 ? { ...l, item: "intruso" } : l)),
      "desconhecidos",
    ],
    [
      "ok em string",
      linhasDe(ROL_DA_9A, (l, i) => (i === 5 ? { ...l, ok: "true" } : l)),
      'ok="true"',
    ],
    [
      "ok null",
      linhasDe(ROL_DA_9A, (l, i) => (i === 5 ? { ...l, ok: null } : l)),
      "ok=null",
    ],
    [
      "ok false",
      linhasDe(ROL_DA_9A, (l, i) => (i === 5 ? { ...l, ok: false } : l)),
      "ok=false",
    ],
    [
      "linha sem a coluna ok",
      linhasDe(ROL_DA_9A, (l, i) => {
        return i === 5
          ? Object.fromEntries(Object.entries(l).filter(([k]) => k !== "ok"))
          : l;
      }),
      "colunas item/esperado/vivo/ok",
    ],
    [
      "linha com coluna a mais",
      linhasDe(ROL_DA_9A, (l, i) => (i === 5 ? { ...l, extra: 1 } : l)),
      "colunas item/esperado/vivo/ok",
    ],
    [
      "linha que não é objeto",
      [...linhasDe(ROL_DA_9A).slice(1), "texto"],
      "colunas item/esperado/vivo/ok",
    ],
    ["zero linhas", [], "0 linhas"],
    ["não é array", { item: "x" }, "0 linhas"],
  ];
  for (const [nome, linhas, trecho] of casos) {
    await t.step(nome, () => {
      let msg = "";
      try {
        chamar(linhas);
      } catch (e) {
        msg = String(e.message);
      }
      assertStringIncludes(msg, "pré-checagem do ledger 60-66 falhou");
      assertStringIncludes(msg, trecho);
    });
  }
  await t.step(
    "nenhum rótulo da 9a nem da 8e está na lista de ignorados (que de resto nem é consultada nas faixas de rol fechado)",
    () => {
      const { IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER } = require(SCRIPT);
      for (const item of [...ROL_DA_9A, ...ROL_DA_8E])
        assert(!IGNORAR_NA_PRE_CHECAGEM_DO_LEDGER.has(item), item);
    },
  );
});

Deno.test("rol fechado — via conferirAntesDeGravar: resposta que o extrairLinhas não reconhece (não-JSON, não-array) PARA; as faixas 72-74 e 79-82 seguem com o critério antigo", async () => {
  const { conferirAntesDeGravar, ROL_DA_9A } = require(SCRIPT);
  for (const corpo of ["isto não é json", '{"item":"x"}', "null"]) {
    const { chamadas, resultado } = await comFetchStubado(
      [{ ok: true, corpo }],
      async () => {
        try {
          await conferirAntesDeGravar({
            ref: REF_LOJA,
            token: TOKEN_FALSO,
            faixa: "60-66",
          });
          return "autorizou";
        } catch (e) {
          return String(e.message);
        }
      },
    );
    assertEquals(chamadas.length, 1);
    assert(resultado !== "autorizou", `autorizou gravar com o corpo ${corpo}`);
  }
  // controle: a faixa 79-82 NÃO ganhou rol fechado — uma resposta parcial ok=true ainda passa nela.
  const parcial = JSON.stringify([
    { checagem: "x", valor: "1", esperado: "1", ok: true },
  ]);
  const { resultado } = await comFetchStubado(
    [{ ok: true, corpo: parcial }],
    async () => {
      await conferirAntesDeGravar({
        ref: REF_LOJA,
        token: TOKEN_FALSO,
        faixa: "79-82",
      });
      return "passou";
    },
  );
  assertEquals(resultado, "passou");
  assert(ROL_DA_9A.length > 1);
});

// ---------------------- a forma do ledger (classificação) -------------------
const ESPERADAS_60_66 = [
  ["20261160000000", "o_codigo_de_barras_e_o_canal_nascem_no_banco"],
  ["20261161000000", "o_balcao_acha_o_produto_pelo_codigo"],
  ["20261162000000", "a_venda_no_balcao_nasce_inteira"],
  ["20261163000000", "a_lista_de_pedidos_filtra_por_canal"],
  ["20261164000000", "a_varredura_de_cancelados_enxerga_o_cancelamento"],
  ["20261165000000", "a_loja_nasce_com_frete_gratis_desligado"],
  ["20261166000000", "o_cache_de_cotacao_nao_guarda_repeticao"],
].map(([version, name]) => ({ version, name }));
const GUARDAS = [
  {
    version: "20261150000000",
    name: "a_loja_declara_a_sua_configuracao_publica",
  },
  {
    version: "20261167000000",
    name: "sobre_a_loja_ganha_endereco_e_descricao",
  },
];
const LEDGER_LACUNA = [GUARDAS[0], GUARDAS[1]];
const LEDGER_COMPLETO = [GUARDAS[0], ...ESPERADAS_60_66, GUARDAS[1]];

Deno.test("classificarLedgerDa60a66 — lacuna, já registrado, parcial, nome trocado, versão a mais e forma inesperada", () => {
  const { classificarLedgerDa60a66 } = require(SCRIPT);
  const c = (l: unknown) => classificarLedgerDa60a66(l, ESPERADAS_60_66);
  assertEquals(c(LEDGER_LACUNA).estado, "LACUNA");
  const completo = c(LEDGER_COMPLETO);
  assertEquals(completo.estado, "JA_REGISTRADO");
  assertEquals(completo.guardasPresentes, true);
  assertEquals(c(LEDGER_COMPLETO.slice(0, -1)).guardasPresentes, false);
  assertEquals(
    c([GUARDAS[0], ...ESPERADAS_60_66.slice(0, 6), GUARDAS[1]]).estado,
    "PARCIAL",
  );
  assertEquals(
    c(LEDGER_COMPLETO.map((l, i) => (i === 3 ? { ...l, name: "outro" } : l)))
      .estado,
    "PARCIAL",
  );
  assertEquals(
    c([...LEDGER_COMPLETO, { version: "20261164500000", name: "x" }]).estado,
    "PARCIAL",
  );
  assertEquals(c([GUARDAS[1]]).estado, "FORMA_INESPERADA"); // 150 ausente
  assertEquals(c([GUARDAS[0]]).estado, "FORMA_INESPERADA"); // 167 ausente
  assertEquals(c([]).estado, "FORMA_INESPERADA");
  assertEquals(c("lixo").estado, "FORMA_INESPERADA");
});

// ----------------- o main() contra uma API falsa que lê, escreve e relê -----
type LinhaLedger = { version: string; name: string };
type Cenario60a66 = {
  projeto?: string;
  faixa?: string;
  segredos?: Record<string, string>;
  ledger?: LinhaLedger[];
  ledgerDepois?: LinhaLedger[];
  corpo9a?: () => string;
  /** status HTTP da leitura da 9a (default 201) */
  status9a?: number;
  /** a escrita: resposta HTTP, ou erro de rede/timeout */
  escrita?: { status: number; corpo: string } | { lancar: Error };
  /** a leitura de reconciliação (depois de a escrita falhar) */
  leituraDeReconciliacao?:
    | { status: number; corpo: string }
    | { lancar: Error };
};

const corpo9aOk = () =>
  JSON.stringify(
    require(SCRIPT).ROL_DA_9A.map((item: string) => ({
      item,
      esperado: "x",
      vivo: "x",
      ok: true,
    })),
  );

async function rodarCaf(c: Cenario60a66) {
  const { main } = require(SCRIPT);
  const chamadas: Array<{
    url: string;
    query: string;
    escrita: boolean;
    auth: string;
  }> = [];
  let escreveu = false;
  let leiturasDoLedgerDepoisDaEscrita = 0;
  const original = globalThis.fetch;
  // @ts-ignore -- stub
  globalThis.fetch = async (url: string, opts: RequestInit = {}) => {
    const query = JSON.parse(String(opts.body)).query as string;
    const escrita = !url.endsWith("/read-only");
    chamadas.push({
      url,
      query,
      escrita,
      auth: String((opts.headers as any)?.Authorization),
    });
    const resp = (status: number, corpo: string) => ({
      ok: status < 300,
      status,
      text: async () => corpo,
    });
    if (escrita) {
      escreveu = true;
      const e = c.escrita ?? { status: 201, corpo: "[]" };
      if ("lancar" in e) throw e.lancar;
      return resp(e.status, e.corpo);
    }
    if (query.includes("corpo final"))
      return resp(c.status9a ?? 201, (c.corpo9a ?? corpo9aOk)());
    if (query.includes("schema_migrations")) {
      if (escreveu) {
        leiturasDoLedgerDepoisDaEscrita++;
        const rec = c.leituraDeReconciliacao;
        const falhou =
          c.escrita &&
          ("lancar" in c.escrita ||
            c.escrita.status >= 400 ||
            c.escrita.corpo !== "[]");
        if (falhou && rec) {
          if ("lancar" in rec) throw rec.lancar;
          return resp(rec.status, rec.corpo);
        }
      }
      const linhas = escreveu
        ? (c.ledgerDepois ?? c.ledger ?? LEDGER_COMPLETO)
        : (c.ledger ?? LEDGER_LACUNA);
      return resp(201, JSON.stringify(linhas));
    }
    throw new Error(`consulta inesperada no stub: ${query.slice(0, 60)}`);
  };
  const env: Record<string, string> = {
    PROJETO: c.projeto ?? "ikcous-publicada",
    LEDGER: c.faixa ?? "60-66",
    ...(c.segredos ?? { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" }),
  };
  const todas = [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_ACCESS_TOKEN_IKCOUS",
    "SUPABASE_ACCESS_TOKEN_SAVY",
    "PROJETO",
    "CONSULTA",
    "LEDGER",
  ];
  const anteriores = todas.map((k) => [k, Deno.env.get(k)] as const);
  for (const k of todas) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    const r = await comConsoleCapturado(() => comSaidaCapturada(() => main()));
    const codigo = r.valor?.retornou ? 0 : (r.valor?.codigoSaida ?? -1);
    return {
      codigo,
      saida: r.saida,
      chamadas,
      escritas: chamadas.filter((x) => x.escrita),
      leiturasDoLedgerDepois: leiturasDoLedgerDepoisDaEscrita,
    };
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of anteriores) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("ledger 60-66 na CAF — lacuna + 9a exata ok: UMA escrita (o INSERT pinado), na ordem leitura prévia → 9a → escrita → releitura; o segredo é o da CAF", async () => {
  const ins = await Deno.readTextFile(`${CONSULTAS_DIR}/ledger-60-66.sql`);
  const r = await rodarCaf({});
  assertEquals(r.codigo, 0, r.saida);
  assertEquals(r.escritas.length, 1);
  assertEquals(r.escritas[0].query, ins);
  assertStringIncludes(
    r.escritas[0].url,
    `/v1/projects/${REF_LOJA}/database/query`,
  );
  assert(!r.escritas[0].url.includes("read-only"));
  for (const c of r.chamadas) assertEquals(c.auth, "Bearer tk-caf");
  const ordem = r.chamadas.map((c) =>
    c.escrita ? "escrita" : c.query.includes("corpo final") ? "9a" : "ledger",
  );
  assertEquals(ordem, ["ledger", "9a", "escrita", "ledger"]);
  const posLeitura = r.chamadas[3].query;
  assertStringIncludes(
    posLeitura,
    "BETWEEN '20261150000000' AND '20261167999999'",
  );
  assert(
    !posLeitura.includes("20261172000000"),
    "a leitura da 60-66 não pode começar em 20261172",
  );
  assertStringIncludes(r.saida, "Leitura pós-gravação OK");
  assert(!r.saida.includes("tk-caf"));
});

Deno.test("ledger 60-66 — a leitura PÓS-gravação CONFERE: 6 de 7, nome trocado, versão extra, ou 150/167 sumidos → falha com mensagem explícita", async () => {
  const casos: Array<[string, LinhaLedger[], string]> = [
    [
      "6 de 7",
      [GUARDAS[0], ...ESPERADAS_60_66.slice(0, 6), GUARDAS[1]],
      "PARCIAL",
    ],
    [
      "nome trocado",
      LEDGER_COMPLETO.map((l, i) => (i === 4 ? { ...l, name: "trocado" } : l)),
      "nome divergente",
    ],
    [
      "versão extra",
      [...LEDGER_COMPLETO, { version: "20261163500000", name: "extra" }],
      "versão a mais na faixa",
    ],
    [
      "a 20261167 sumiu",
      LEDGER_COMPLETO.filter((l) => l.version !== "20261167000000"),
      "ausentes",
    ],
    ["nenhuma gravada (a guarda barrou)", LEDGER_LACUNA, "LACUNA"],
  ];
  for (const [nome, depois, trecho] of casos) {
    const r = await rodarCaf({ ledgerDepois: depois });
    assertEquals(r.codigo, 1, `${nome}: ${r.saida}`);
    assertStringIncludes(
      r.saida,
      "leitura pós-gravação do ledger 60-66 NÃO bate",
      nome,
    );
    assertStringIncludes(r.saida, trecho, nome);
    assertEquals(r.escritas.length, 1, nome);
  }
});

Deno.test("ledger 60-66 — JÁ REGISTRADO (as 7, nomes certos) é estado EXPLÍCITO: saída 0, mensagem própria, ZERO escritas e nem a 9a roda", async () => {
  const r = await rodarCaf({ ledger: LEDGER_COMPLETO });
  assertEquals(r.codigo, 0, r.saida);
  assertStringIncludes(r.saida, "ledger 60-66 já registrado: nada a gravar");
  assertEquals(r.escritas.length, 0);
  assertEquals(r.chamadas.length, 1, "só a leitura prévia do ledger");
  assert(!r.saida.includes("pré-checagem"), "não é prova negativa");
});

Deno.test("ledger 60-66 — qualquer OUTRA forma PARA (saída 1) sem escrever: parcial, nome trocado, versão extra, 150 ausente, 167 ausente", async () => {
  const casos: Array<[string, LinhaLedger[]]> = [
    [
      "parcial 3 de 7",
      [GUARDAS[0], ...ESPERADAS_60_66.slice(0, 3), GUARDAS[1]],
    ],
    [
      "7 com nome trocado",
      LEDGER_COMPLETO.map((l, i) => (i === 2 ? { ...l, name: "trocado" } : l)),
    ],
    [
      "7 mais uma extra",
      [...LEDGER_COMPLETO, { version: "20261165500000", name: "x" }],
    ],
    ["lacuna sem a 150", [GUARDAS[1]]],
    ["lacuna sem a 167", [GUARDAS[0]]],
    // as 7 sem as âncoras 150/167: NÃO é "já registrado" (A4)
    ["7 sem as âncoras 150 e 167", [...ESPERADAS_60_66]],
    ["7 sem a 150", [...ESPERADAS_60_66, GUARDAS[1]]],
    ["7 sem a 167", [GUARDAS[0], ...ESPERADAS_60_66]],
  ];
  for (const [nome, ledger] of casos) {
    const r = await rodarCaf({ ledger });
    assertEquals(r.codigo, 1, `${nome}: ${r.saida}`);
    assertEquals(r.escritas.length, 0, nome);
    assertStringIncludes(r.saida, "forma inesperada", nome);
    assert(
      !r.chamadas.some((c) => c.query.includes("corpo final")),
      `${nome}: nem chegou à 9a`,
    );
  }
});

// O FORMATO de TODAS as linhas da leitura do ledger é exigido ANTES de classificar:
// as âncoras 150/167 mais uma linha inválida NÃO podem virar LACUNA e autorizar a escrita.
const LINHAS_FORA_DO_FORMATO: Array<[string, unknown]> = [
  ["version null", { version: null, name: "x" }],
  ["version número", { version: 20261160000000, name: "x" }],
  ["version malformada (7 dígitos)", { version: "2026116", name: "x" }],
  ["version com 15 dígitos", { version: "202611600000000", name: "x" }],
  ["linha sem name", { version: "20261160000000" }],
  ["name vazio", { version: "20261160000000", name: "" }],
  ["name número", { version: "20261160000000", name: 7 }],
  ["coluna a mais", { version: "20261160000000", name: "x", extra: 1 }],
  ["linha null", null],
  ["linha string", "20261160000000"],
];

Deno.test("classificarLedgerDa60a66 — QUALQUER linha fora do formato é FORMA_INESPERADA, mesmo com as âncoras 150/167 presentes (nunca LACUNA)", () => {
  const { classificarLedgerDa60a66 } = require(SCRIPT);
  for (const [nome, ruim] of LINHAS_FORA_DO_FORMATO) {
    const c = classificarLedgerDa60a66(
      [...LEDGER_LACUNA, ruim],
      ESPERADAS_60_66,
    );
    assertEquals(c.estado, "FORMA_INESPERADA", nome);
    assertStringIncludes(c.detalhe, "fora do formato", nome);
    // e no meio das 7 (uma linha inválida junto das válidas não é "ignorada")
    const noMeio = classificarLedgerDa60a66(
      [GUARDAS[0], ruim, ...ESPERADAS_60_66, GUARDAS[1]],
      ESPERADAS_60_66,
    );
    assertEquals(noMeio.estado, "FORMA_INESPERADA", `${nome} (no meio)`);
  }
});

Deno.test("ledger 60-66 — linha inválida na leitura PRÉVIA (junto das âncoras 150/167): saída 1, ZERO escritas, nem chega à 9a", async () => {
  for (const [nome, ruim] of LINHAS_FORA_DO_FORMATO) {
    const r = await rodarCaf({
      ledger: [...LEDGER_LACUNA, ruim] as unknown as LinhaLedger[],
    });
    assertEquals(r.codigo, 1, `${nome}: ${r.saida}`);
    assertEquals(r.escritas.length, 0, `${nome}: ZERO escritas`);
    assertStringIncludes(r.saida, "fora do formato", nome);
    assert(
      !r.chamadas.some((c) => c.query.includes("corpo final")),
      `${nome}: nem chegou à 9a`,
    );
  }
});

Deno.test("ledger 60-66 — linha inválida na leitura PÓS-gravação (mesmo com as 7 + âncoras corretas): falha, a escrita foi UMA e não se repete", async () => {
  for (const [nome, ruim] of LINHAS_FORA_DO_FORMATO) {
    const r = await rodarCaf({
      ledgerDepois: [...LEDGER_COMPLETO, ruim] as unknown as LinhaLedger[],
    });
    assertEquals(r.codigo, 1, `${nome}: ${r.saida}`);
    assertEquals(r.escritas.length, 1, `${nome}: exatamente UMA escrita`);
    assertStringIncludes(
      r.saida,
      "leitura pós-gravação do ledger 60-66 NÃO bate",
      nome,
    );
    assertStringIncludes(r.saida, "fora do formato", nome);
  }
});

Deno.test("ledger 60-66 — a RECONCILIAÇÃO depois de escrita falha também exige o formato: linha inválida não vira 'NÃO REGISTRADO'", async () => {
  const r = await rodarCaf({
    escrita: { lancar: new TypeError("fetch failed") },
    leituraDeReconciliacao: {
      status: 201,
      corpo: JSON.stringify([...LEDGER_LACUNA, { version: null, name: "x" }]),
    },
  });
  assertEquals(r.codigo, 1, r.saida);
  assertEquals(r.escritas.length, 1);
  assertStringIncludes(r.saida, "ESTADO DESCONHECIDO");
  assert(!r.saida.includes("NÃO REGISTRADO"), r.saida);
  assertStringIncludes(r.saida, "fora do formato");
});

Deno.test("ledger 60-66 — a 9a com qualquer problema PARA antes de gravar: parcial, duplicada, desconhecida, ok string, sem ok, 0 linhas, formato desconhecido, 401, 403, 5xx e timeout", async () => {
  const { ROL_DA_9A } = require(SCRIPT);
  const ok = (rol: string[]) =>
    rol.map((item) => ({ item, esperado: "x", vivo: "x", ok: true }));
  const corpos: Array<[string, () => string]> = [
    ["parcial", () => JSON.stringify(ok(ROL_DA_9A.slice(0, 20)))],
    ["duplicada", () => JSON.stringify([...ok(ROL_DA_9A), ok(ROL_DA_9A)[0]])],
    [
      "desconhecida",
      () =>
        JSON.stringify([
          ...ok(ROL_DA_9A),
          { item: "x", esperado: "x", vivo: "x", ok: true },
        ]),
    ],
    [
      "ok string",
      () =>
        JSON.stringify(
          ok(ROL_DA_9A).map((l, i) => (i === 3 ? { ...l, ok: "true" } : l)),
        ),
    ],
    [
      "sem a coluna ok",
      () =>
        JSON.stringify(
          ok(ROL_DA_9A).map((l, i) => {
            return i === 3
              ? Object.fromEntries(
                  Object.entries(l).filter(([k]) => k !== "ok"),
                )
              : l;
          }),
        ),
    ],
    ["0 linhas", () => "[]"],
    ["formato desconhecido", () => "<html>"],
    [
      "timeout da leitura",
      () => {
        throw Object.assign(
          new Error("The operation was aborted due to timeout"),
          { name: "TimeoutError" },
        );
      },
    ],
  ];
  for (const [nome, corpo9a] of corpos) {
    const r = await rodarCaf({ corpo9a });
    assertEquals(r.codigo, 1, `${nome}: ${r.saida}`);
    assertEquals(r.escritas.length, 0, `${nome}: ZERO escritas`);
  }
  for (const status9a of [401, 403, 500]) {
    const r = await rodarCaf({ status9a, corpo9a: () => '{"message":"x"}' });
    assertEquals(r.codigo, 1, `HTTP ${status9a}: ${r.saida}`);
    assertEquals(r.escritas.length, 0, `HTTP ${status9a}: ZERO escritas`);
    if (status9a !== 500) assertStringIncludes(r.saida, "bloqueio concreto");
  }
});

Deno.test("ledger 60-66 — 401/403 na pré-checagem ou na escrita PARA com o bloqueio concreto; na escrita NÃO é estado desconhecido e não há releitura", async () => {
  // 401/403 na LEITURA (a prévia)
  for (const status of [401, 403]) {
    const original = globalThis.fetch;
    const { main } = require(SCRIPT);
    let n = 0;
    // @ts-ignore -- stub
    globalThis.fetch = async () => {
      n++;
      return { ok: false, status, text: async () => '{"message":"forbidden"}' };
    };
    try {
      const antes = ["SUPABASE_ACCESS_TOKEN_IKCOUS", "PROJETO", "LEDGER"].map(
        (k) => [k, Deno.env.get(k)] as const,
      );
      Deno.env.set("SUPABASE_ACCESS_TOKEN_IKCOUS", "tk-caf");
      Deno.env.set("PROJETO", "ikcous-publicada");
      Deno.env.set("LEDGER", "60-66");
      const r = await comConsoleCapturado(() =>
        comSaidaCapturada(() => main()),
      );
      for (const [k, v] of antes) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
      assertEquals(r.valor?.codigoSaida, 1);
      assertStringIncludes(r.saida, "bloqueio concreto");
      assertStringIncludes(r.saida, `HTTP ${status}`);
      assertEquals(n, 1, "uma requisição só");
    } finally {
      globalThis.fetch = original;
    }
  }
  // 401/403 na ESCRITA
  for (const status of [401, 403]) {
    const r = await rodarCaf({
      escrita: { status, corpo: '{"message":"forbidden"}' },
    });
    assertEquals(r.codigo, 1, r.saida);
    assertStringIncludes(r.saida, "bloqueio concreto");
    assertStringIncludes(r.saida, `HTTP ${status}`);
    assert(!r.saida.includes("ESTADO DESCONHECIDO"));
    assertEquals(r.escritas.length, 1);
    assertEquals(r.leiturasDoLedgerDepois, 0, "sem releitura de reconciliação");
  }
});

Deno.test("ledger 60-66 — a escrita que falha (timeout, rede, HTTP 5xx, corpo estranho) NÃO é repetida: EXATAMENTE 1 escrita, uma releitura de reconciliação e ESTADO DESCONHECIDO", async () => {
  const timeout = Object.assign(
    new Error("The operation was aborted due to timeout"),
    { name: "TimeoutError" },
  );
  const casos: Array<[string, Cenario60a66["escrita"], LinhaLedger[], string]> =
    [
      [
        "timeout, nada gravado",
        { lancar: timeout },
        LEDGER_LACUNA,
        "NÃO REGISTRADO",
      ],
      [
        "timeout, gravou mesmo assim",
        { lancar: timeout },
        LEDGER_COMPLETO,
        "REGISTRADO (7 de 7)",
      ],
      [
        "rede caiu",
        { lancar: new TypeError("fetch failed") },
        LEDGER_LACUNA,
        "NÃO REGISTRADO",
      ],
      [
        "HTTP 502",
        { status: 502, corpo: "bad gateway" },
        LEDGER_LACUNA,
        "NÃO REGISTRADO",
      ],
      [
        "HTTP 500, parte gravada",
        { status: 500, corpo: "boom" },
        [GUARDAS[0], ...ESPERADAS_60_66.slice(0, 3), GUARDAS[1]],
        "PARCIAL",
      ],
      [
        "corpo estranho em 201",
        { status: 201, corpo: '{"error":"x"}' },
        LEDGER_COMPLETO,
        "REGISTRADO (7 de 7)",
      ],
    ];
  for (const [nome, escrita, ledgerDepois, rotulo] of casos) {
    const r = await rodarCaf({ escrita, ledgerDepois });
    assertEquals(r.codigo, 1, `${nome}: ${r.saida}`);
    assertEquals(
      r.escritas.length,
      1,
      `${nome}: EXATAMENTE 1 escrita (sem retry)`,
    );
    assertStringIncludes(r.saida, "ESTADO DESCONHECIDO", nome);
    assertStringIncludes(r.saida, rotulo, nome);
    assertEquals(
      r.leiturasDoLedgerDepois,
      1,
      `${nome}: UMA releitura de reconciliação`,
    );
    assertStringIncludes(r.saida, "reconcilie POR LEITURA");
  }
  // a releitura de reconciliação também pode falhar: ainda 1 escrita, ainda desconhecido
  const r = await rodarCaf({
    escrita: { lancar: timeout },
    leituraDeReconciliacao: { status: 503, corpo: "indisponível" },
  });
  assertEquals(r.codigo, 1);
  assertEquals(r.escritas.length, 1);
  assertStringIncludes(r.saida, "ESTADO DESCONHECIDO");
  assertStringIncludes(r.saida, "TAMBÉM falhou");
});

Deno.test("ledger 60-66 — recusas por MAPA explícito, ANTES de qualquer requisição: loja, sandbox e savy + 60-66; CAF + 72-74; loja + 92-202", async () => {
  const casos: Array<[string, string, Record<string, string>, string]> = [
    [
      "loja",
      "60-66",
      { SUPABASE_ACCESS_TOKEN: "tk" },
      "só roda para ikcous-publicada, não para loja",
    ],
    [
      "sandbox",
      "60-66",
      { SUPABASE_ACCESS_TOKEN: "tk" },
      "só roda para ikcous-publicada, não para sandbox",
    ],
    [
      "savy",
      "60-66",
      { SUPABASE_ACCESS_TOKEN_SAVY: "tk" },
      "o ledger não roda para savy",
    ],
    [
      "ikcous-publicada",
      "72-74",
      { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk" },
      "o ledger não roda para ikcous-publicada",
    ],
    [
      "loja",
      "92-202",
      { SUPABASE_ACCESS_TOKEN: "tk" },
      "só roda para ikcous-publicada ou savy",
    ],
  ];
  for (const [projeto, faixa, segredos, msg] of casos) {
    const r = await rodarCaf({ projeto, faixa, segredos });
    assertEquals(r.codigo, 1, `${projeto}/${faixa}: ${r.saida}`);
    assertEquals(
      r.chamadas.length,
      0,
      `${projeto}/${faixa}: nenhuma requisição`,
    );
    assertStringIncludes(r.saida, msg, `${projeto}/${faixa}`);
  }
  // as mensagens de recusa que citam a exceção continuam VERDADEIRAS
  const { FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA } = require(SCRIPT);
  assertEquals(FAIXAS_DO_LEDGER_POR_LOJA_EXPLICITA, {
    "ikcous-publicada": ["92-202", "60-66"],
    savy: ["92-202"],
  });
  const savy = await rodarCaf({
    projeto: "savy",
    faixa: "72-74",
    segredos: { SUPABASE_ACCESS_TOKEN_SAVY: "tk" },
  });
  assertStringIncludes(savy.saida, "exceto a faixa 92-202");
  const caf = await rodarCaf({ faixa: "72-74" });
  assertStringIncludes(caf.saida, "exceto as faixas 92-202");
  assertStringIncludes(caf.saida, "60-66");
});

Deno.test("ledger 92-202 também é rol fechado: resposta parcial da 8e (os presentes ok=true) NÃO autoriza gravar", async () => {
  const { ROL_DA_8E } = require(SCRIPT);
  const ok = (rol: string[]) =>
    rol.map((item) => ({ item, esperado: "x", vivo: "x", ok: true }));
  const original = globalThis.fetch;
  const { main } = require(SCRIPT);
  for (const [nome, linhas, escritasEsperadas] of [
    ["8e parcial", ok(ROL_DA_8E).slice(0, 10), 0],
    ["8e exata", ok(ROL_DA_8E), 1],
  ] as const) {
    const escritas: string[] = [];
    // @ts-ignore -- stub
    globalThis.fetch = async (url: string, opts: RequestInit) => {
      if (!url.endsWith("/read-only")) escritas.push(url);
      const query = JSON.parse(String(opts.body)).query as string;
      const corpo = query.includes("corpo final")
        ? JSON.stringify(linhas)
        : '[{"version":"20261192000000","name":"x"}]';
      return { ok: true, status: 201, text: async () => corpo };
    };
    const anteriores = [
      "SUPABASE_ACCESS_TOKEN_IKCOUS",
      "PROJETO",
      "LEDGER",
    ].map((k) => [k, Deno.env.get(k)] as const);
    Deno.env.set("SUPABASE_ACCESS_TOKEN_IKCOUS", "tk-caf");
    Deno.env.set("PROJETO", "ikcous-publicada");
    Deno.env.set("LEDGER", "92-202");
    try {
      const r = await comConsoleCapturado(() =>
        comSaidaCapturada(() => main()),
      );
      assertEquals(escritas.length, escritasEsperadas, `${nome}: ${r.saida}`);
    } finally {
      globalThis.fetch = original;
      for (const [k, v] of anteriores) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    }
  }
});

// A prova viva do lote 60-66 (tests/banco/lote-60-66-viva.cjs) só protege o
// que vier depois se o CI a rodar: no job BLOQUEANTE do rpc-ci.yml (sem
// continue-on-error), num clone próprio (rodar-isolado.cjs), depois do passo
// `aplica`, e disparada quando a 9a, o INSERT do backfill ou o script mudam.
Deno.test("rpc-ci.yml roda a prova viva do lote 60-66 no job bloqueante e é disparado pelos arquivos dela", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0, "não achei o job contrato-dinheiro");
  assert(
    inicioInformacional > inicioBloqueante,
    "não achei o job provas-informacionais depois do bloqueante",
  );
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(
    !/^\s*continue-on-error:/m.test(bloqueante),
    "o job bloqueante não pode ter continue-on-error",
  );
  const passo = bloqueante.match(
    /- name: Prova viva do lote 60-66[^\n]*\n\s+if: \$\{\{ !cancelled\(\) && steps\.aplica\.outcome == 'success' \}\}\n\s+run: node tests\/banco\/rodar-isolado\.cjs tests\/banco\/lote-60-66-viva\.cjs\n/,
  );
  assert(
    passo,
    "o passo da prova viva do lote 60-66 (if !cancelled + aplica success, rodar-isolado) não está no job bloqueante",
  );
  const posAplica = bloqueante.indexOf("id: aplica");
  assert(
    posAplica > 0 && bloqueante.indexOf(passo[0]) > posAplica,
    "a prova tem de vir depois do passo `aplica`",
  );
  for (const gatilho of ["pull_request:", "push:"]) {
    const ini = yaml.indexOf(`\n  ${gatilho}`);
    assert(ini > 0, `não achei o gatilho ${gatilho}`);
    const bloco = yaml.slice(ini, yaml.indexOf("\n  workflow_dispatch:"));
    const caminhos =
      gatilho === "pull_request:"
        ? bloco.slice(0, bloco.indexOf("\n  push:"))
        : bloco;
    for (const arquivo of [
      "scripts/publicacao/conferir-banco.cjs",
      "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
      "scripts/publicacao/consultas/ledger-60-66.sql",
      "tests/banco/**",
    ]) {
      assertStringIncludes(
        caminhos,
        `- "${arquivo}"`,
        `${gatilho} sem o caminho ${arquivo}`,
      );
    }
  }
});

Deno.test("rpc-ci.yml roda a prova viva da 8k no job bloqueante (sem continue-on-error, depois de aplica) e é disparado pela consulta e pela prova", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0 && inicioInformacional > inicioBloqueante);
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(
    !/^\s*continue-on-error:/m.test(bloqueante),
    "o job bloqueante não pode ter continue-on-error",
  );
  const passo = bloqueante.match(
    /- name: Prova viva da 8k[^\n]*\n\s+if: \$\{\{ !cancelled\(\) && steps\.aplica\.outcome == 'success' \}\}\n\s+run: node tests\/banco\/rodar-isolado\.cjs tests\/banco\/subtotal-vazia-provada-viva\.cjs\n/,
  );
  assert(
    passo,
    "o passo da prova viva da 8k não está no job bloqueante com o if certo",
  );
  const posAplica = bloqueante.indexOf("id: aplica");
  assert(posAplica > 0 && bloqueante.indexOf(passo[0]) > posAplica);
  assert(
    !/subtotal-vazia-provada-viva/.test(yaml.slice(inicioInformacional)),
    "a prova da 8k não pode ficar no job informacional",
  );
  for (const gatilho of ["pull_request:", "push:"]) {
    const ini = yaml.indexOf(`\n  ${gatilho}`);
    assert(ini > 0, `não achei o gatilho ${gatilho}`);
    const bloco = yaml.slice(ini, yaml.indexOf("\n  workflow_dispatch:"));
    const caminhos =
      gatilho === "pull_request:"
        ? bloco.slice(0, bloco.indexOf("\n  push:"))
        : bloco;
    for (const arquivo of [
      "scripts/publicacao/conferir-banco.cjs",
      "scripts/publicacao/consultas/8k-subtotal-divergente-ou-vazia-provada.sql",
      "tests/banco/**",
    ]) {
      assertStringIncludes(
        caminhos,
        `- "${arquivo}"`,
        `${gatilho} sem o caminho ${arquivo}`,
      );
    }
  }
});

// 10a/10b (08/10/2026) — a PROVA DE OBJETOS do lote da migration 20261203000000
// (cupons desligados não dão desconto, issue #645) em
// scripts/frota/canais-de-backend.json. A 10a é a consulta do lote (DEPOIS do
// apply, 21 linhas); a 10b é a de ausência (ANTES, 6 linhas). As duas são de ROL
// FECHADO. Estes testes medem o texto dos .sql contra a migration DESTA árvore; a
// decisão de cada consulta num Postgres real está em
// tests/banco/cupons-desligados-portao-viva.cjs (rodado no rpc-ci.yml).
const NOME_10A = "10a-conferir-cupons-desligados-aplicado";
const NOME_10B = "10b-antes-cupons-desligados-gatilho-e-corpo";
const MIGRACAO_203 = `${MIGRATIONS_DIR}/20261203000000_cupons_desligados_nao_dao_desconto.sql`;
const ROLLBACK_203 = `${MIGRATIONS_DIR}/rollback-manual-20261203000000_cupons_desligados_nao_dao_desconto.sql`;

/** Os hashes (sha256 do prosrc, LF e CRLF) que a migration 203 e o rollback-manual definem, recalculados dos ARQUIVOS. */
async function hashesDaMigration203() {
  const { createHash } = require("node:crypto");
  const sha = (s: string) =>
    createHash("sha256").update(s, "utf8").digest("hex");
  const lf = (await Deno.readTextFile(MIGRACAO_203)).replace(/\r\n/g, "\n");
  const gat = lf.match(
    /CREATE OR REPLACE FUNCTION public\.pedido_com_cupom_exige_a_chave_ligada\(\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/,
  );
  const val = lf.match(
    /CREATE OR REPLACE FUNCTION public\.validate_coupon_secure_v2\(p_code text, p_subtotal numeric\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(gat && val, "não achei os corpos na migration 20261203000000");
  const rb = (await Deno.readTextFile(ROLLBACK_203)).replace(/\r\n/g, "\n");
  const base = rb.match(
    /CREATE OR REPLACE FUNCTION public\.validate_coupon_secure_v2\(p_code text, p_subtotal numeric\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  assert(base, "não achei o corpo do baseline no rollback-manual");
  const crlf = (s: string) => s.replace(/\n/g, "\r\n");
  return {
    gatLF: sha(gat[1]),
    gatCRLF: sha(crlf(gat[1])),
    novoLF: sha(val[1]),
    novoCRLF: sha(crlf(val[1])),
    baseLF: sha(base[1]),
    baseCRLF: sha(crlf(base[1])),
  };
}

const { ROL_DA_10A, ROL_DA_10B } = require(SCRIPT);
for (const [nome, nItens, rol] of [
  [NOME_10A, 21, ROL_DA_10A],
  [NOME_10B, 6, ROL_DA_10B],
] as Array<[string, number, string[]]>) {
  Deno.test(`${nome} — no menu, UM SELECT só leitura sobre o catálogo, saída item/esperado/vivo/ok e rol fechado de ${nItens} itens`, async (t) => {
    const { contarStatements, ROL_FECHADO_POR_CONSULTA } = require(SCRIPT);
    const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
    const limpo = sqlSemComentarios(sql);
    const semTexto = limpo.replace(/'(?:[^']|'')*'/g, "''");
    await t.step("está no menu do workflow", async () => {
      const yaml = await Deno.readTextFile(WORKFLOW);
      const i = yaml.indexOf("consulta:");
      assert(i >= 0, "não achei a entrada `consulta`");
      assert(
        yaml.indexOf(`\n          - ${nome}\n`, i) > i,
        `falta a opção ${nome} no workflow`,
      );
    });
    await t.step(
      "um statement, começa por WITH, sem palavra de escrita nem SQL dinâmico, saída item/esperado/vivo/ok com as reprovadas primeiro",
      () => {
        assertEquals(contarStatements(sql), 1);
        assert(/^\s*WITH\b/i.test(limpo));
        assert(
          !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
            semTexto,
          ),
          "palavra de escrita fora de comentário/string",
        );
        assert(
          !/\b(EXECUTE|query_to_xml\w*|dblink\w*|format|pg_read_file|lo_import)\b/i.test(
            semTexto,
          ),
          "SQL dinâmico (ou leitura de arquivo)",
        );
        assert(
          /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok\s+FROM itens\s+ORDER BY ok, item;/.test(
            limpo,
          ),
          "a saída final tem de ser item, esperado, vivo, ok, reprovadas primeiro",
        );
      },
    );
    await t.step(
      "SÓ catálogo: nenhuma tabela de dados (pedido, cupom, loja, cliente) e nenhuma coluna de cliente ou dinheiro",
      () => {
        const permitidos = new Set([
          "pg_trigger",
          "pg_proc",
          "pg_namespace",
          "pg_language",
          "pg_attribute",
          "pg_index",
          "pg_class",
          "aclexplode",
          "unnest",
          // CTEs desta consulta
          "tab",
          "gat",
          "gat_x",
          "fg",
          "va",
          "idx",
          "itens",
        ]);
        const alvos = [
          ...semTexto.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi),
        ].map((m) => m[1].toLowerCase());
        assert(alvos.length > 0);
        for (const alvo of alvos)
          assert(
            permitidos.has(alvo),
            `lê de "${alvo}", que não é catálogo nem CTE`,
          );
        assert(
          !/\b(customer_name|customer_data|user_id|email|telefone|phone|endereco|address|cpf|full_name|amount|total|subtotal|discount|gateway_payment_id|payment_status|paid_at|code)\b/i.test(
            semTexto,
          ),
          "a consulta citaria dado pessoal ou financeiro",
        );
      },
    );
    await t.step(
      `o rol fechado do código tem ${nItens} itens, sem repetição, é o contrato desta consulta, e CADA item aparece como literal no .sql (e só eles)`,
      () => {
        assertEquals(rol.length, nItens);
        assertEquals(new Set(rol).size, rol.length);
        assertEquals(
          Object.entries(ROL_FECHADO_POR_CONSULTA).find(
            ([n]) => n === nome,
          )?.[1],
          rol,
        );
        for (const item of rol)
          assertStringIncludes(
            limpo,
            `'${item}'`,
            `o item do rol "${item}" não existe no .sql`,
          );
        const doSql = [...limpo.matchAll(/SELECT\s+'([^']+)',/g)].map(
          (m) => m[1],
        );
        assertEquals(
          doSql.length,
          nItens,
          `o .sql monta ${nItens} linhas de resultado`,
        );
        for (const item of doSql)
          assert(
            rol.includes(item),
            `o .sql monta "${item}" e o rol do código não o tem`,
          );
      },
    );
  });
}

Deno.test("10a/10b — os hashes (sha256 do prosrc, LF e CRLF) são EXATAMENTE os que o arquivo da migration 20261203000000 e o rollback-manual desta árvore definem", async (t) => {
  const h = await hashesDaMigration203();
  const sql10a = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_10A}.sql`);
  const sql10b = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_10B}.sql`);
  const hexDe = (sql: string) =>
    [
      ...new Set(
        [...sqlSemComentarios(sql).matchAll(/'([0-9a-f]{64})'/g)].map(
          (m) => m[1],
        ),
      ),
    ].sort();
  await t.step(
    "10a: só os 4 hashes do estado FINAL (validate e gatilho, LF e CRLF)",
    () => {
      assertEquals(
        hexDe(sql10a),
        [h.gatLF, h.gatCRLF, h.novoLF, h.novoCRLF].sort(),
      );
      // o `esperado` é o LF; o CRLF só entra na lista de aceitos (o pré-voo da migration aceita os dois)
      for (const lf of [h.gatLF, h.novoLF])
        assert(
          sqlSemComentarios(sql10a).includes(`'${lf}',`),
          "o LF tem de ser o esperado",
        );
    },
  );
  await t.step(
    "10b: só os 2 hashes do BASELINE (LF e CRLF), os mesmos do rollback-manual byte a byte",
    () => {
      assertEquals(hexDe(sql10b), [h.baseLF, h.baseCRLF].sort());
    },
  );
  await t.step(
    "os 4 literais do pré-voo da migration são os mesmos, na ordem baseline LF/CRLF e novo LF/CRLF",
    async () => {
      const mig = (await Deno.readTextFile(MIGRACAO_203)).replace(
        /\r\n/g,
        "\n",
      );
      const pre = mig.match(/v_hash NOT IN \(([\s\S]*?)\)\s*THEN/);
      assert(pre, "não achei a lista do pré-voo");
      const lit = [...pre[1].matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
      assertEquals(lit, [h.baseLF, h.baseCRLF, h.novoLF, h.novoCRLF]);
    },
  );
  await t.step(
    "os seis hashes são distintos (a 10b recusa o corpo novo e a 10a recusa o baseline)",
    () => {
      assertEquals(
        new Set([
          h.baseLF,
          h.baseCRLF,
          h.novoLF,
          h.novoCRLF,
          h.gatLF,
          h.gatCRLF,
        ]).size,
        6,
      );
    },
  );
});

Deno.test("10a/10b — o rpc-ci.yml roda a prova viva do portão dos cupons desligados no job bloqueante (sem continue-on-error, depois de aplica) e é disparado pelas duas consultas, pelo conferir-banco e pelo lote", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0 && inicioInformacional > inicioBloqueante);
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(!/^\s*continue-on-error:/m.test(bloqueante));
  const passo = bloqueante.match(
    /- name: Prova viva do portao dos cupons desligados[^\n]*\n\s+if: \$\{\{ !cancelled\(\) && steps\.aplica\.outcome == 'success' \}\}\n\s+run: node tests\/banco\/rodar-isolado\.cjs tests\/banco\/cupons-desligados-portao-viva\.cjs\n/,
  );
  assert(
    passo,
    "o passo da prova viva do portão não está no job bloqueante com o if certo",
  );
  assert(bloqueante.indexOf(passo[0]) > bloqueante.indexOf("id: aplica"));
  assert(
    !/cupons-desligados-portao-viva/.test(yaml.slice(inicioInformacional)),
  );
  for (const gatilho of ["pull_request:", "push:"]) {
    const ini = yaml.indexOf(`\n  ${gatilho}`);
    assert(ini > 0, `não achei o gatilho ${gatilho}`);
    const bloco = yaml.slice(ini, yaml.indexOf("\n  workflow_dispatch:"));
    const caminhos =
      gatilho === "pull_request:"
        ? bloco.slice(0, bloco.indexOf("\n  push:"))
        : bloco;
    for (const arquivo of [
      "scripts/publicacao/conferir-banco.cjs",
      `scripts/publicacao/consultas/${NOME_10A}.sql`,
      `scripts/publicacao/consultas/${NOME_10B}.sql`,
      "scripts/frota/canais-de-backend.json",
      "scripts/frota/publicar-release.mjs",
      "tests/banco/**",
    ])
      assertStringIncludes(
        caminhos,
        `- "${arquivo}"`,
        `${gatilho} sem o caminho ${arquivo}`,
      );
  }
});

// 11a/11b (08/10/2026) — a PROVA DE OBJETOS do lote da migration 20261204000000
// (a venda do balcão se anula no mesmo dia) em scripts/frota/canais-de-backend.json.
// A 11a é a consulta do lote (DEPOIS do apply, 14 linhas); a 11b é a de ausência
// (ANTES, 8 linhas). As duas são de ROL FECHADO. Estes testes medem o texto dos
// .sql contra a migration DESTA árvore; a decisão de cada consulta num Postgres real
// está em tests/banco/anular-venda-portao-viva.cjs (rodado no rpc-ci.yml).
const NOME_11A = "11a-conferir-anular-venda-presencial-aplicado";
const NOME_11B = "11b-antes-anular-venda-presencial-funcao-ausente";
const MIGRACAO_204 = `${MIGRATIONS_DIR}/20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`;
const ROLLBACK_204 = `${MIGRATIONS_DIR}/rollback-manual-20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql`;

/** O corpo da função (prosrc) e seus hashes, recalculados do ARQUIVO da migration. */
async function hashesDaMigration204() {
  const { createHash } = require("node:crypto");
  const h = (alg: string, s: string) =>
    createHash(alg).update(s, "utf8").digest("hex");
  const lf = (await Deno.readTextFile(MIGRACAO_204)).replace(/\r\n/g, "\n");
  const m = lf.match(
    /CREATE OR REPLACE FUNCTION public\.anular_venda_presencial\(p_order_id uuid, p_motivo text\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/,
  );
  assert(m, "não achei o corpo na migration 20261204000000");
  const crlf = (s: string) => s.replace(/\n/g, "\r\n");
  return {
    corpo: m[1],
    md5: h("md5", m[1]),
    shaLF: h("sha256", m[1]),
    shaCRLF: h("sha256", crlf(m[1])),
    pre: lf,
  };
}

const { ROL_DA_11A, ROL_DA_11B } = require(SCRIPT);
for (const [nome, nItens, rol] of [
  [NOME_11A, 14, ROL_DA_11A],
  [NOME_11B, 8, ROL_DA_11B],
] as Array<[string, number, string[]]>) {
  Deno.test(`${nome} — no menu, UM SELECT só leitura sobre o catálogo, saída item/esperado/vivo/ok e rol fechado de ${nItens} itens`, async (t) => {
    const { contarStatements, ROL_FECHADO_POR_CONSULTA } = require(SCRIPT);
    const sql = await Deno.readTextFile(`${CONSULTAS_DIR}/${nome}.sql`);
    const limpo = sqlSemComentarios(sql);
    const semTexto = limpo.replace(/'(?:[^']|'')*'/g, "''");
    await t.step("está no menu do workflow", async () => {
      const yaml = await Deno.readTextFile(WORKFLOW);
      const i = yaml.indexOf("consulta:");
      assert(i >= 0, "não achei a entrada `consulta`");
      assert(
        yaml.indexOf(`\n          - ${nome}\n`, i) > i,
        `falta a opção ${nome} no workflow`,
      );
    });
    await t.step(
      "um statement, começa por WITH, sem palavra de escrita nem SQL dinâmico, saída item/esperado/vivo/ok com as reprovadas primeiro",
      () => {
        assertEquals(contarStatements(sql), 1);
        assert(/^\s*WITH\b/i.test(limpo));
        assert(
          !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i.test(
            semTexto,
          ),
          "palavra de escrita fora de comentário/string",
        );
        assert(
          !/\b(EXECUTE|query_to_xml\w*|dblink\w*|format|pg_read_file|lo_import)\b/i.test(
            semTexto,
          ),
          "SQL dinâmico (ou leitura de arquivo)",
        );
        assert(
          /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok\s+FROM itens\s+ORDER BY ok, item;/.test(
            limpo,
          ),
          "a saída final tem de ser item, esperado, vivo, ok, reprovadas primeiro",
        );
      },
    );
    await t.step(
      "SÓ catálogo: nenhuma tabela de dados (pedido, venda, caixa, cliente) e nenhuma coluna de cliente ou dinheiro",
      () => {
        const permitidos = new Set([
          "pg_proc",
          "pg_namespace",
          "pg_language",
          "pg_attribute",
          "aclexplode",
          // CTEs desta consulta
          "fn",
          "tabelas",
          "colunas",
          "itens",
        ]);
        const alvos = [
          ...semTexto.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi),
        ].map((m) => m[1].toLowerCase());
        assert(alvos.length > 0);
        for (const alvo of alvos)
          assert(
            permitidos.has(alvo),
            `lê de "${alvo}", que não é catálogo nem CTE`,
          );
        assert(
          !/\b(customer_name|customer_data|user_id|email|telefone|phone|endereco|address|cpf|full_name|amount|total|subtotal|discount|gateway_payment_id|payment_status|paid_at|code)\b/i.test(
            semTexto,
          ),
          "a consulta citaria dado pessoal ou financeiro",
        );
      },
    );
    await t.step(
      `o rol fechado do código tem ${nItens} itens, sem repetição, é o contrato desta consulta, e CADA item aparece como literal no .sql (e só eles)`,
      () => {
        assertEquals(rol.length, nItens);
        assertEquals(new Set(rol).size, rol.length);
        assertEquals(
          Object.entries(ROL_FECHADO_POR_CONSULTA).find(
            ([n]) => n === nome,
          )?.[1],
          rol,
        );
        for (const item of rol)
          assertStringIncludes(
            limpo,
            `'${item}'`,
            `o item do rol "${item}" não existe no .sql`,
          );
        const doSql = [...limpo.matchAll(/SELECT\s+'([^']+)',/g)].map(
          (m) => m[1],
        );
        assertEquals(
          doSql.length,
          nItens,
          `o .sql monta ${nItens} linhas de resultado`,
        );
        for (const item of doSql)
          assert(
            rol.includes(item),
            `o .sql monta "${item}" e o rol do código não o tem`,
          );
      },
    );
  });
}

Deno.test("11a/11b — os hashes são EXATAMENTE os que o arquivo da migration 20261204000000 e o rollback-manual desta árvore definem", async (t) => {
  const h = await hashesDaMigration204();
  const sql11a = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_11A}.sql`);
  const sql11b = await Deno.readTextFile(`${CONSULTAS_DIR}/${NOME_11B}.sql`);
  const hexDe = (sql: string, tam: number) =>
    [
      ...new Set(
        [
          ...sqlSemComentarios(sql).matchAll(
            tam === 64 ? /'([0-9a-f]{64})'/g : /'([0-9a-f]{32})'/g,
          ),
        ].map((m) => m[1]),
      ),
    ].sort();
  await t.step(
    "11a: só os 2 sha256 do corpo final (LF e CRLF), o LF como esperado",
    () => {
      assertEquals(hexDe(sql11a, 64), [h.shaLF, h.shaCRLF].sort());
      assert(
        sqlSemComentarios(sql11a).includes(`'${h.shaLF}',`),
        "o LF tem de ser o esperado",
      );
    },
  );
  await t.step(
    "o rollback-manual aceita exatamente os mesmos dois sha256",
    async () => {
      const rb = await Deno.readTextFile(ROLLBACK_204);
      const lit = [...rb.matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
      assertEquals(lit, [h.shaLF, h.shaCRLF]);
    },
  );
  await t.step(
    "o pré-voo da migration reconhece o md5 do próprio corpo",
    () => {
      assertStringIncludes(h.pre, `v_hash <> '${h.md5}'`);
    },
  );
  await t.step(
    "11b: os 2 md5 das dependências (is_admin_atual e pedido__mudar_status) são os MESMOS do pré-voo da migration",
    () => {
      const md5s = hexDe(sql11b, 32);
      assertEquals(md5s.length, 2);
      for (const m of md5s) assertStringIncludes(h.pre, `'${m}'`);
    },
  );
});

Deno.test("11a/11b — o rpc-ci.yml roda a prova viva do portão de anular a venda no job bloqueante (sem continue-on-error, depois de aplica) e é disparado pelas duas consultas", async () => {
  const yaml = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  const inicioBloqueante = yaml.indexOf("\n  contrato-dinheiro:");
  const inicioInformacional = yaml.indexOf("\n  provas-informacionais:");
  assert(inicioBloqueante > 0 && inicioInformacional > inicioBloqueante);
  const bloqueante = yaml.slice(inicioBloqueante, inicioInformacional);
  assert(!/^\s*continue-on-error:/m.test(bloqueante));
  for (const prova of ["anular-venda-viva", "anular-venda-portao-viva"]) {
    // Sem RegExp montada com variavel: acha a linha do comando e confere as duas
    // anteriores (o if e o nome do passo).
    const linhas = bloqueante.split("\n");
    const k = linhas.indexOf(
      `        run: node tests/banco/rodar-isolado.cjs tests/banco/${prova}.cjs`,
    );
    assert(k >= 2, `o passo de ${prova} não está no job bloqueante`);
    assertEquals(
      linhas[k - 1],
      "        if: ${{ !cancelled() && steps.aplica.outcome == 'success' }}",
    );
    assert(linhas[k - 2].startsWith("      - name: "));
    assert(
      bloqueante.indexOf(linhas.at(k) ?? "") > bloqueante.indexOf("id: aplica"),
    );
    assert(!yaml.slice(inicioInformacional).includes(prova));
  }
  for (const gatilho of ["pull_request:", "push:"]) {
    const ini = yaml.indexOf(`\n  ${gatilho}`);
    assert(ini > 0, `não achei o gatilho ${gatilho}`);
    const bloco = yaml.slice(ini, yaml.indexOf("\n  workflow_dispatch:"));
    const caminhos =
      gatilho === "pull_request:"
        ? bloco.slice(0, bloco.indexOf("\n  push:"))
        : bloco;
    for (const arquivo of [
      "scripts/publicacao/conferir-banco.cjs",
      `scripts/publicacao/consultas/${NOME_11A}.sql`,
      `scripts/publicacao/consultas/${NOME_11B}.sql`,
      "scripts/frota/canais-de-backend.json",
      "scripts/frota/publicar-release.mjs",
      "supabase/migrations/**",
      "tests/banco/**",
    ])
      assertStringIncludes(
        caminhos,
        `- "${arquivo}"`,
        `${gatilho} sem o caminho ${arquivo}`,
      );
  }
});
