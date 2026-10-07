// @ts-nocheck
/**
 * Testes para `.github/workflows/aplicar-migrations.yml`, reunindo os
 * achados de duas frentes que mexeram nesse mesmo arquivo e se juntaram no
 * merge de `claude/pensive-mendel-b1fnuu` (26/09/2026):
 *
 * 1. Achado #1 da revisão de risco da rodada 2 do conferir-banco-da-loja:
 *    `projeto_ref` como texto livre ia direto para o path da URL, com um
 *    token válido para todos os projetos da conta. O input `projeto_ref`
 *    sumiu; entrou `projeto`, `choice` fechado em loja/sandbox. O trecho de
 *    resolução do ref — extraído do PRÓPRIO arquivo entre os marcadores
 *    `RESOLVE_REF_INICIO`/`RESOLVE_REF_FIM`, não copiado — recusa qualquer
 *    `PROJETO` que não seja exatamente "loja" ou "sandbox", inclusive os
 *    dois payloads que a revisão provou contra um stub: "<ref>/restart#" e
 *    "x/../outroref.../database/query#".
 * 2. Achado de `fix/ci-banco-confere-projeto` (branch `734d4a51`, hoje
 *    reunido neste mesmo arquivo pelo merge): o `node -e "…"` do step
 *    "Prova, apply e verificação" já tinha rodado com crase solta dentro de
 *    um comentário (`` `is_admin()` ``/`` `postgres` ``), e o bash tentou
 *    rodar isso como substituição de comando — "command substitution:
 *    syntax error" / "postgres: command not found" no log, nenhuma
 *    migration aplicada. O teste de baixo conta crase ou `$` NÃO escapado
 *    (`` \` ``/`\$`) dentro do argumento do `node -e` inteiro.
 *
 * Extraído e não copiado: copiado, o teste continuaria passando enquanto o
 * arquivo real apodrecesse (mesmo raciocínio de
 * tests/ci_publicar_functions_test.ts).
 */
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const WORKFLOW = fromFileUrl(
  new URL("../.github/workflows/aplicar-migrations.yml", import.meta.url),
);

/** Tira o trecho JS de resolução do ref, exatamente como está no arquivo,
 * entre os marcadores — sem os próprios marcadores. */
function extrairTrechoDeResolucaoDoRef(yaml: string): string {
  const ini = yaml.indexOf("RESOLVE_REF_INICIO");
  const fim = yaml.indexOf("RESOLVE_REF_FIM");
  assert(
    ini > 0 && fim > ini,
    "não achei os marcadores RESOLVE_REF_* no workflow",
  );
  const linhas = yaml.slice(ini, fim).split("\n").slice(1, -1);
  // O trecho vive dentro de `node -e "…"` (bash, aspas duplas): `\$` no
  // ARQUIVO é o jeito de sobreviver ao bash e chegar a node como `$` de
  // verdade (mesma convenção já usada em `\\.sql\$` neste mesmo arquivo).
  // Aqui rodamos o trecho DIRETO em JS, sem passar pelo bash — então
  // desfazemos manualmente o ÚNICO escape que o bash faria, para o teste
  // enxergar exatamente o que node veria em produção.
  return linhas.join("\n").replace(/\\\$/g, "$");
}

/** Roda o trecho extraído com `PROJETO` setado, capturando se `process.exit`
 * foi chamado (stub que lança, mesmo padrão de
 * tests/ci_banco_trava_dupla_test.ts) e o valor final de `ref` quando não
 * sai. Nunca toca rede: o trecho extraído termina antes de qualquer
 * `fetch`. */
function avaliarResolucaoDoRef(
  trecho: string,
  projeto: string | undefined,
): { ref?: string; codigoSaida?: number; saida: string } {
  const original = process.exit;
  let codigoSaida: number | undefined;
  const linhas: string[] = [];
  const errOriginal = console.error;
  // @ts-ignore -- stub de teste
  process.exit = (codigo?: number) => {
    codigoSaida = codigo;
    throw new Error(`process.exit(${codigo})`);
  };
  console.error = (...args: unknown[]) => linhas.push(args.join(" "));
  const envAnterior = process.env.PROJETO;
  // biome-ignore lint/performance/noDelete: `process.env.X = undefined` vira a STRING "undefined" (coerção do Node) — o delete de verdade é o que faz `typeof process.env.PROJETO === "undefined"`, que é o que `Object.hasOwn` do trecho testado precisa enxergar.
  if (projeto === undefined) delete process.env.PROJETO;
  else process.env.PROJETO = projeto;
  try {
    const fn = new Function(
      "process",
      "console",
      `${trecho}\nreturn typeof ref !== "undefined" ? ref : undefined;`,
    );
    const ref = fn(process, console);
    return { ref, saida: linhas.join("\n") };
  } catch {
    return { codigoSaida, saida: linhas.join("\n") };
  } finally {
    process.exit = original;
    console.error = errOriginal;
    // biome-ignore lint/performance/noDelete: mesmo motivo do delete acima — restaura a AUSÊNCIA da variável, não a string "undefined".
    if (envAnterior === undefined) delete process.env.PROJETO;
    else process.env.PROJETO = envAnterior;
  }
}

Deno.test("aplicar-migrations.yml — input projeto (achado #1, rodada 2)", async (t) => {
  const yaml = await Deno.readTextFile(WORKFLOW);

  await t.step(
    "`projeto_ref` (texto livre) sumiu como INPUT do workflow",
    () => {
      // A string pode aparecer em prosa/comentário explicando o achado; o que
      // não pode mais existir é a CHAVE do input (`projeto_ref:`).
      assert(
        !yaml.includes("projeto_ref:"),
        "o workflow ainda declara o input projeto_ref (texto livre) — achado #1 não corrigido",
      );
    },
  );

  await t.step("`projeto` é choice fechado em loja/sandbox", () => {
    assertStringIncludes(yaml, "projeto:");
    assertStringIncludes(yaml, "type: choice");
    assertStringIncludes(
      yaml,
      "options:\n          - loja\n          - sandbox",
    );
    assertStringIncludes(yaml, "default: loja");
  });

  await t.step(
    "loja e sandbox resolvem para os mesmos refs de publicar-functions.yml",
    () => {
      const trecho = extrairTrechoDeResolucaoDoRef(yaml);
      const loja = avaliarResolucaoDoRef(trecho, "loja");
      assertEquals(loja.ref, "cafkrminfnokvgjqtkle", loja.saida);
      const sandbox = avaliarResolucaoDoRef(trecho, "sandbox");
      assertEquals(sandbox.ref, "lofznuxcvezrhxsgjqyg", sandbox.saida);
    },
  );

  await t.step(
    "qualquer coisa fora de loja/sandbox é recusada ANTES de qualquer URL — inclusive os payloads provados contra o stub",
    () => {
      const trecho = extrairTrechoDeResolucaoDoRef(yaml);
      for (const malicioso of [
        "cafkrminfnokvgjqtkle/restart#",
        "x/../outroprojetoabcdefgh/database/query#",
        "cafkrminfnokvgjqtkle/pause?",
        "producao",
        "__proto__",
        "constructor",
        "",
        undefined,
      ]) {
        const r = avaliarResolucaoDoRef(trecho, malicioso);
        assertEquals(
          r.codigoSaida,
          1,
          `"${malicioso}" deveria ser recusado (exit 1); ref=${r.ref}, saída=${r.saida}`,
        );
        assertEquals(
          r.ref,
          undefined,
          `"${malicioso}" não pode resolver para um ref`,
        );
      }
    },
  );

  await t.step(
    "o trecho de resolução do ref não abre nenhuma chamada de rede (não tem `fetch`)",
    () => {
      const trecho = extrairTrechoDeResolucaoDoRef(yaml);
      assert(
        !trecho.includes("fetch"),
        "o trecho extraído deveria terminar ANTES de qualquer fetch — os marcadores estão no lugar errado",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Crases e $ soltos no node -e (vindo de fix/ci-banco-confere-projeto, 734d4a51)
// ---------------------------------------------------------------------------
/*
 * .github/workflows/aplicar-migrations.yml — o passo "Prova, apply e
 * verificação" roda um `node -e "…"` DENTRO de um `run: |` do bash. O
 * argumento do `-e` é uma string bash entre ASPAS DUPLAS: dois caracteres
 * soltos (sem `\` antes) mudam de sentido para o bash em vez do node —
 *   - backtick (`` ` ``) vira início de substituição de comando;
 *   - `$` vira início de expansão de variável (`${x}` sai VAZIO em silêncio
 *     se `x` não for uma env var do shell — defeito que não aparece como
 *     erro, só como SQL/JS truncado).
 * Foi o backtick que aconteceu de verdade: um comentário com
 * `` `is_admin()` `` e `` `postgres` `` (crases de destaque, não de template
 * literal) produziu "command substitution: syntax error" e "postgres:
 * command not found" no log do workflow, sem nenhuma migration ter rodado.
 *
 * As crases e os `$` DE TEMPLATE LITERAL do próprio JS (as `` \` `` que abrem
 * os `sql('...', \`select ...\`)`, e o `\$` do regex de nome de arquivo) estão
 * corretamente ESCAPADOS para o bash — é isso que este teste distingue: conta
 * só o caractere que NÃO tem `\` logo antes.
 */

/** Tira do workflow o corpo do `run: |` do step cujo `name:` casa (mesmo
 * padrão de tests/ci_publicar_functions_test.ts, extraído e não copiado). */
function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex((l) => l.includes(`name: "${nomeDoStep}"`));
  assert(iNome >= 0, `step "${nomeDoStep}" não achado no workflow`);
  const iRun = linhas.findIndex(
    (l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(iRun > iNome, `o step "${nomeDoStep}" não tem um \`run: |\``);
  const recuoDe = (l: string) => l.match(/^\s*/)[0].length;
  const recuoRun = recuoDe(linhas.at(iRun));
  const corpo: string[] = [];
  for (const l of linhas.slice(iRun + 1)) {
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    if (recuoDe(l) <= recuoRun) break;
    corpo.push(l);
  }
  return corpo.join("\n");
}

/** Isola o argumento do `node -e "…"` dentro do bloco `run:` — só entre a
 * linha `node -e "` e a linha de fechamento `"` sozinha (mesmo formato usado
 * no arquivo hoje). */
function argumentoDoNodeE(blocoRun: string): string {
  const linhas = blocoRun.split("\n");
  const iAbre = linhas.findIndex((l) => /^\s*node -e "\s*$/.test(l));
  assert(iAbre >= 0, 'abertura `node -e "` não achada no step');
  const iFecha = linhas.findIndex((l, i) => i > iAbre && /^\s*"\s*$/.test(l));
  assert(iFecha > iAbre, 'fechamento `"` do node -e não achado');
  return linhas.slice(iAbre + 1, iFecha).join("\n");
}

/** Conta backtick ou `$` que NÃO está escapado (`` \` ``/`\$`) — dentro de uma
 * string bash com aspas duplas, são exatamente esses dois caracteres que o
 * shell interpreta no lugar do node (substituição de comando e expansão de
 * variável). Função local, não exportada — usada só pelos casos deste
 * arquivo de teste. */
function crasesOuCifraoNaoEscapados(texto: string): number {
  const m = texto.match(/(?<!\\)[`$]/g);
  return m ? m.length : 0;
}

Deno.test("crasesOuCifraoNaoEscapados distingue escapado de solto (crase e $)", () => {
  assertEquals(crasesOuCifraoNaoEscapados(String.raw`sql(\`select 1\`)`), 0);
  assertEquals(crasesOuCifraoNaoEscapados(String.raw`\.sql\$`), 0);
  // 4 crases soltas: as duas de `is_admin()` e as duas de `postgres` — o
  // defeito real medido (linha 115 da versão quebrada do workflow).
  assertEquals(
    crasesOuCifraoNaoEscapados("gate `is_admin()` nega o role `postgres`"),
    4,
  );
  // `$` solto: ${x} viraria expansão de variável do bash, não do JS.
  assertEquals(crasesOuCifraoNaoEscapados("template ${x} solto"), 1);
});

Deno.test("o node -e do step 'Prova, apply e verificação' não tem crase nem $ sem escapar para o bash", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const bloco = blocoRunDoStep(yaml, "Prova, apply e verificação");
  const argumento = argumentoDoNodeE(bloco);
  const total = crasesOuCifraoNaoEscapados(argumento);
  assertEquals(
    total,
    0,
    'crase ou $ sem escapar dentro do node -e "...": o bash vai tentar rodar ' +
      'como comando ("command substitution: syntax error" / ' +
      '"postgres: command not found") ou expandir uma variável inexistente ' +
      "em silêncio (SQL/JS truncado) no log do workflow",
  );
});

Deno.test("o node -e não tem aspas duplas soltas (fechariam a string do bash antes da hora)", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const argumento = argumentoDoNodeE(
    blocoRunDoStep(yaml, "Prova, apply e verificação"),
  );
  const soltas = argumento.match(/(?<!\\)"/g);
  assertEquals(
    soltas ? soltas.length : 0,
    0,
    "aspas duplas sem escapar dentro do node -e",
  );
});

// ---------------------------------------------------------------------------
// Lote do método de publicação na CAF (04/10/2026): impressão digital no
// limite de cada DDL, rollback-manual, gate de transporte e falha de
// transporte. O node -e INTEIRO do workflow é extraído (desfazendo os escapes
// do bash) e executado aqui com um `fetch` falso — nada de rede. A prova
// contra um Postgres de verdade é tests/banco/impressao-digital-viva.cjs.
// ---------------------------------------------------------------------------
import { createRequire } from "node:module";
import { join } from "https://deno.land/std@0.177.0/path/mod.ts";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const requireLocal = createRequire(import.meta.url);
const SQL_DO_ENVELOPE = join(RAIZ, "scripts/publicacao/impressao-digital.sql");

/** Desfaz o ÚNICO escape que o bash faz dentro de aspas duplas. */
function desescaparBash(js: string): string {
  return js.replace(/\\([\\$"`])/g, "$1");
}

type Resposta = { status?: number; corpo?: string; lancar?: Error };

const SONDA = (relogio2: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify([
    {
      sonda1: JSON.stringify({
        isolamento: "repeatable read",
        somente_leitura: "on",
        pid: 123,
        agora: "2026-10-04 18:00:00+00",
        relogio: 1000.0,
      }),
      sonda2: JSON.stringify({
        isolamento: "repeatable read",
        somente_leitura: "on",
        pid: 123,
        agora: "2026-10-04 18:00:00+00",
        relogio: relogio2,
        ...extra,
      }),
    },
  ]);
const FP_OK = JSON.stringify([
  {
    tabela: "marketplace_orders",
    linhas_antes: 3,
    md5_antes: "aa",
    linhas_depois: 3,
    md5_depois: "aa",
    colunas_novas: "-",
    defaults_alterados: "-",
    resultado: "igual",
  },
]);

/** Responde como uma API saudável; cada cenário sobrescreve o que quer quebrar. */
function respostaSaudavel(q: string): Resposta {
  if (q.includes("ikcous.sonda1")) return { corpo: SONDA(1000.2) };
  if (q.includes("txid_current_if_assigned"))
    return { corpo: '[{"pid":123,"txid":null}]' };
  if (q.includes("marketplace_orders where status"))
    return { corpo: '[{"pedidos":3,"cancelados":0}]' };
  if (q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n"))
    return { corpo: FP_OK };
  if (q.startsWith("BEGIN;\n")) return { corpo: "[]" };
  if (q.includes("query_to_xml"))
    return { corpo: '[{"tabela":"marketplace_orders","linhas_agora":3}]' };
  if (q.includes("has_function_privilege"))
    return { corpo: '[{"paged8":true}]' };
  throw new Error(`consulta inesperada no stub: ${q.slice(0, 80)}`);
}

async function rodarWorkflow(
  migracoes: string,
  responder: (q: string, i: number) => Resposta = respostaSaudavel,
  projeto = "loja",
  segredos: Record<string, string> = { SUPABASE_ACCESS_TOKEN: "token-falso" },
) {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const codigo = desescaparBash(
    argumentoDoNodeE(blocoRunDoStep(yaml, "Prova, apply e verificação")),
  );
  const chamadas: string[] = [];
  const autorizacoes: string[] = [];
  const saida: string[] = [];
  let resolver!: (v: { exit?: number; fim?: boolean }) => void;
  const terminou = new Promise<{ exit?: number; fim?: boolean }>(
    (r) => (resolver = r),
  );
  // `process.exit` de verdade interrompe o processo; o falso só avisa. Depois do
  // exit, qualquer requisição fica pendurada para sempre (como se o processo
  // tivesse morrido) e NÃO conta como chamada.
  let saiu = false;
  const fetchFalso = async (
    url: string,
    init: { body: string; headers?: Record<string, string> },
  ) => {
    if (saiu) return await new Promise<never>(() => {});
    assertStringIncludes(
      url,
      "/v1/projects/cafkrminfnokvgjqtkle/database/query",
    );
    const query = JSON.parse(init.body).query;
    chamadas.push(query);
    autorizacoes.push(init.headers?.Authorization ?? "");
    const r = responder(query, chamadas.length - 1);
    if (r.lancar) throw r.lancar;
    const status = r.status ?? 201;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => r.corpo ?? "[]",
    };
  };
  const consoleFalso = {
    log: (...a: unknown[]) => {
      const l = a.join(" ");
      saida.push(l);
      if (l.startsWith("FIM:")) resolver({ fim: true });
    },
    error: (...a: unknown[]) => saida.push(`ERR ${a.join(" ")}`),
  };
  const processFalso = {
    env: { ...segredos, MIGRACOES: migracoes, PROJETO: projeto },
    exit: (c: number) => {
      saiu = true;
      resolver({ exit: c });
    },
  };
  const antes = Deno.cwd();
  Deno.chdir(RAIZ);
  try {
    const reqLocal = (p: string) =>
      requireLocal(p.startsWith(".") ? join(RAIZ, p) : p);
    new Function("require", "process", "fetch", "console", codigo)(
      reqLocal,
      processFalso,
      fetchFalso,
      consoleFalso,
    );
    const fim = await terminou;
    return { ...fim, chamadas, autorizacoes, saida, texto: saida.join("\n") };
  } finally {
    Deno.chdir(antes);
  }
}

const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };
const M201 = "20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const RB201 =
  "rollback-manual-20261201000000_linha_nova_nasce_sob_autorizacao.sql";

Deno.test({
  name: "workflow: migracoes vazio roda o gate de transporte (só leitura) e o fingerprint, e NENHUM apply",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarWorkflow("");
    assertEquals(r.fim, true, r.texto);
    assertEquals(
      r.chamadas.length,
      3,
      "gate, registro (não decide) e fingerprint",
    );
    assertStringIncludes(
      r.chamadas[0],
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    );
    assertStringIncludes(r.chamadas[1], "txid_current_if_assigned");
    assertStringIncludes(r.chamadas[2], "marketplace_orders");
    assertStringIncludes(r.texto, "GATE DE TRANSPORTE OK");
    assertStringIncludes(r.texto, "REGISTRO (não decide nada)");
    assert(
      !r.chamadas.some(
        (q) =>
          q.startsWith("BEGIN;\n") ||
          q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n"),
      ),
      "nenhuma prova nem apply",
    );
  },
});

Deno.test({
  name: "workflow: gate reprovado (ou resposta que não é sucesso) PARA tudo — o envelope não roda, e só uma requisição saiu",
  ...SEM_SANITIZAR,
  fn: async () => {
    const casos: [string, Resposta, string][] = [
      [
        "isolamento errado",
        { corpo: SONDA(1000.2, { isolamento: "read committed" }) },
        "isolamento não é repeatable read",
      ],
      [
        "read_only off",
        { corpo: SONDA(1000.2, { somente_leitura: "off" }) },
        "transaction_read_only não é on",
      ],
      [
        "pid diferente",
        { corpo: SONDA(1000.2, { pid: 999 }) },
        "backends diferentes",
      ],
      [
        "now() diferente",
        { corpo: SONDA(1000.2, { agora: "2026-10-04 18:00:01+00" }) },
        "now() diferente",
      ],
      [
        "relógio não avançou",
        { corpo: SONDA(1000.01) },
        "o relógio não avançou",
      ],
      [
        "formato desconhecido",
        { corpo: '[{"outra":"coisa"}]' },
        "formato do gate não reconhecido",
      ],
      ["corpo com erro", { corpo: '{"message":"boom"}' }, "boom"],
      [
        "HTTP 202 (2xx que não é o sucesso documentado)",
        { status: 202, corpo: "[]" },
        "HTTP 202",
      ],
      ["HTTP 500", { status: 500, corpo: "oops" }, "HTTP 500"],
    ];
    for (const [nome, resposta, trecho] of casos) {
      const r = await rodarWorkflow(M201, () => resposta);
      assertEquals(r.exit, 1, `${nome}: ${r.texto}`);
      assertEquals(
        r.chamadas.length,
        1,
        `${nome}: depois do gate reprovado nada mais sai`,
      );
      assertStringIncludes(r.texto, trecho, nome);
    }
  },
});

Deno.test({
  name: "workflow: lista mista (migration + rollback-manual) e nome fora do padrão são recusados SEM nenhuma chamada de rede",
  ...SEM_SANITIZAR,
  fn: async () => {
    const recusas: [string, string][] = [
      [`${RB201},${M201}`, "lista mista"],
      [`${M201},${RB201}`, "lista mista"],
      ["rollback-manual-1_x.sql", "nome fora do padrão"],
      ["rollback-manual-../20261201000000_x.sql", "nome fora do padrão"],
      [
        "rollback-manual-20261201000000_x.sql/../../x.sql",
        "nome fora do padrão",
      ],
      ["x/../20261201000000_linha.sql", "nome fora do padrão"],
      ["20261201000000_MAIUSCULA.sql", "nome fora do padrão"],
      ["20261201000000_nao_existe_no_repo.sql", "NÃO EXISTE"],
      ["rollback-manual-20261201000000_nao_existe_no_repo.sql", "NÃO EXISTE"],
    ];
    for (const [lista, trecho] of recusas) {
      const r = await rodarWorkflow(lista);
      assertEquals(r.exit, 1, `${lista}: ${r.texto}`);
      assertEquals(r.chamadas.length, 0, `${lista}: nenhuma chamada de rede`);
      assertStringIncludes(r.texto, trecho, lista);
    }
  },
});

Deno.test({
  name: "workflow: uma migration roda gate -> fingerprint -> PROVA(BEGIN…ROLLBACK) -> UM apply no envelope -> leitura fresca; o rollback-manual idem",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const arquivo of [M201, RB201]) {
      const corpo = await Deno.readTextFile(
        join(RAIZ, "supabase/migrations", arquivo),
      );
      const r = await rodarWorkflow(arquivo);
      assertEquals(r.fim, true, `${arquivo}: ${r.texto}`);
      const q = r.chamadas;
      assertStringIncludes(q[0], "READ ONLY");
      assertStringIncludes(q[2], "marketplace_orders");
      // O ledger (06/10/2026): a migration se REGISTRA (INSERT) e o rollback-manual
      // APAGA a linha daquela versão (DELETE), ambos na mesma transação do corpo.
      const registro =
        arquivo === M201
          ? "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261201000000', 'linha_nova_nasce_sob_autorizacao') ON CONFLICT (version) DO NOTHING;\n"
          : "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261201000000';\n";
      // PROVA: o arquivo todo (e o registro do ledger, se migration) entre BEGIN e ROLLBACK
      assertEquals(q[3], `BEGIN;\n${corpo}\n${registro}ROLLBACK;`);
      // APPLY: UMA requisição, BEGIN ... COMMIT no mesmo corpo
      const applies = q.filter((x) =>
        x.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n"),
      );
      assertEquals(applies.length, 1, "um único apply");
      const apply = applies[0];
      assertEquals(q[4], apply);
      assertStringIncludes(apply, corpo);
      assert(
        apply.indexOf("FP_ANTES") < 0 &&
          apply.indexOf("fp_antes") > 0 &&
          apply.indexOf("fp_antes") < apply.indexOf(corpo),
        "a impressão digital ANTES vem antes do corpo",
      );
      assert(
        apply.lastIndexOf("$fp_depois$") > apply.indexOf(corpo),
        "a impressão digital DEPOIS vem depois do corpo",
      );
      // o INSERT/DELETE do ledger vai NA MESMA requisição, entre o corpo e a
      // impressão digital DEPOIS (um RAISE da divergência o desfaz também)
      assertEquals(apply.split(registro.trimEnd()).length - 1, 1);
      assert(
        apply.indexOf(registro) > apply.indexOf(corpo) &&
          apply.indexOf(registro) < apply.indexOf("$fp_depois$"),
        "o ledger fica entre o corpo e a impressão digital DEPOIS",
      );
      assert(
        apply.trimEnd().endsWith("COMMIT;"),
        "o COMMIT é a última instrução, na mesma requisição",
      );
      assertEquals(apply.split("\nCOMMIT;").length - 1, 1, "um único COMMIT");
      // só um BEGIN de transação por requisição e nenhuma instrução de transação em outra requisição
      for (const x of q) {
        assert(
          !/^\s*(COMMIT|ROLLBACK|BEGIN)\s*;\s*$/i.test(x),
          `nenhuma requisição só de controle de transação: ${x.slice(0, 40)}`,
        );
      }
      assertStringIncludes(q[5], "query_to_xml"); // leitura fresca, DEPOIS do apply
      assertStringIncludes(r.texto, "FP_ANTES ");
      assertStringIncludes(r.texto, "FP_DEPOIS ");
      assertStringIncludes(
        r.texto,
        "ATIVIDADE CONCORRENTE (informativo, não é falha)",
      );
    }
  },
});

Deno.test({
  name: "workflow: HTTP 200 e 201 são sucesso; qualquer outro status do apply (inclusive 202/204) PARA",
  ...SEM_SANITIZAR,
  fn: async () => {
    const comStatus = (status: number) => (q: string) => {
      const r = respostaSaudavel(q);
      return q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n")
        ? { ...r, status }
        : r;
    };
    for (const ok of [200, 201]) {
      const r = await rodarWorkflow(M201, comStatus(ok));
      assertEquals(r.fim, true, `status ${ok}: ${r.texto}`);
    }
    for (const ruim of [202, 204, 301, 400, 429, 500, 502, 504]) {
      const r = await rodarWorkflow(M201, comStatus(ruim));
      assertEquals(r.exit, 1, `status ${ruim}: ${r.texto}`);
      assertStringIncludes(r.texto, "ESTADO DESCONHECIDO");
    }
  },
});

Deno.test({
  name: "workflow: falha do apply (HTTP, corpo com erro, TIMEOUT, rede caindo) PARA o workflow — estado desconhecido, UMA requisição, sem retry, sem ROLLBACK paralelo, mandando reconciliar por leitura",
  ...SEM_SANITIZAR,
  fn: async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const falhas: [string, Resposta][] = [
      ["HTTP 502", { status: 502, corpo: "bad gateway" }],
      [
        "HTTP 500 com erro do Postgres",
        { status: 500, corpo: '{"message":"FP_DIVERGIU: ..."}' },
      ],
      ["2xx com corpo de erro", { status: 201, corpo: '{"error":"boom"}' }],
      ["TIMEOUT", { lancar: timeout }],
      ["rede caindo (fetch failed)", { lancar: new TypeError("fetch failed") }],
    ];
    for (const [nome, falha] of falhas) {
      const r = await rodarWorkflow(M201, (q) =>
        q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n")
          ? falha
          : respostaSaudavel(q),
      );
      assertEquals(r.exit, 1, `${nome}: ${r.texto}`);
      for (const trecho of [
        "FALHOU no apply de",
        "ESTADO DESCONHECIDO",
        "8e-conferir-92-a-202-aplicado",
        "8a-antes-92-a-202-objetos-e-corpos",
        "por LEITURA",
        "ANTES de qualquer nova tentativa",
        "não repete sozinho",
      ]) {
        assertStringIncludes(r.texto, trecho, nome);
      }
      const q = r.chamadas;
      assertEquals(
        q.filter((x) =>
          x.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n"),
        ).length,
        1,
        `${nome}: o apply saiu UMA vez (sem retry)`,
      );
      assert(
        q[q.length - 1].startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n"),
        `${nome}: nada depois do apply (nem ROLLBACK em outra requisição, nem leitura fresca, nem verificação)`,
      );
      assert(!q.includes("ROLLBACK;"), `${nome}: nenhum ROLLBACK solto`);
    }
  },
});

Deno.test("workflow: o único ROLLBACK; do script é o da PROVA (BEGIN … ROLLBACK numa requisição só)", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  const codigo = argumentoDoNodeE(
    blocoRunDoStep(yaml, "Prova, apply e verificação"),
  );
  const semComentarios = codigo
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  const rollbacks = semComentarios.match(/ROLLBACK;/g) ?? [];
  assertEquals(rollbacks.length, 1);
  assertStringIncludes(
    semComentarios,
    "'BEGIN;\\\\n' + corpo + '\\\\n' + (registro ? registro + '\\\\n' : '') + 'ROLLBACK;'",
  );
  assert(
    !/retry|tentativa\s*<|for \(let t/i.test(semComentarios),
    "sem laço de retry",
  );
});

Deno.test("workflows de banco: só workflow_dispatch — nenhum gatilho automático (push, schedule, pull_request…)", async () => {
  for (const nome of [
    "aplicar-migrations.yml",
    "conferir-banco-da-loja.yml",
    "publicar-functions.yml",
  ]) {
    const yaml = await Deno.readTextFile(join(RAIZ, ".github/workflows", nome));
    const ini = yaml.search(/^on:\s*$/m);
    const fim = yaml.search(/^(permissions|jobs|concurrency|env):/m);
    assert(ini >= 0 && fim > ini, `${nome}: bloco on: não achado`);
    const bloco = yaml
      .slice(ini, fim)
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    assertStringIncludes(bloco, "workflow_dispatch:");
    assert(
      !/^\s{2}(push|schedule|pull_request|pull_request_target|workflow_run|release|repository_dispatch|workflow_call)\s*:/m.test(
        bloco,
      ),
      `${nome}: gatilho automático no bloco on:`,
    );
  }
});

Deno.test("impressao-digital.sql: seções, as mesmas tabelas em abrir e fresca, REPEATABLE READ, e o gate é READ ONLY com sleep", async () => {
  const sql = await Deno.readTextFile(SQL_DO_ENVELOPE);
  const secoes = sql.split(/^-- @@SECAO /m).slice(1);
  const nomes = secoes.map((s) => s.split("\n")[0].trim());
  assertEquals(nomes, ["abrir", "fechar", "fresca", "gate"]);
  const porNome = Object.fromEntries(
    secoes.map((s) => [s.split("\n")[0].trim(), s.slice(s.indexOf("\n") + 1)]),
  );
  const lista = (t: string) => [...t.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const abrir = porNome.abrir.slice(
    porNome.abrir.indexOf("v_tabelas text[] := ARRAY["),
    porNome.abrir.indexOf("];"),
  );
  const fresca = porNome.fresca.slice(
    porNome.fresca.indexOf("ARRAY["),
    porNome.fresca.indexOf("]) AS t"),
  );
  assertEquals(
    lista(abrir),
    lista(fresca),
    "a lista de tabelas de abrir e fresca é a mesma",
  );
  assertEquals(lista(abrir).length, 11);
  assert(porNome.abrir.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;"));
  assertStringIncludes(porNome.fechar, "RAISE EXCEPTION 'FP_DIVERGIU");
  assert(
    porNome.fechar.indexOf("RAISE EXCEPTION 'FP_DIVERGIU") <
      porNome.fechar.lastIndexOf("COMMIT;"),
    "o RAISE vem ANTES do COMMIT",
  );
  assert(porNome.fechar.trimEnd().endsWith("COMMIT;"));
  assert(
    !/^\s*(COMMIT|ROLLBACK)\s*;/m.test(porNome.abrir),
    "abrir não fecha a transação",
  );
  assert(
    porNome.gate.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"),
  );
  assertStringIncludes(porNome.gate, "pg_sleep(0.2)");
  assert(porNome.gate.trimEnd().endsWith("COMMIT;"));
  assert(
    !/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/i.test(
      porNome.gate.replace(/--.*$/gm, ""),
    ),
    "o gate não escreve",
  );
  // o workflow lê ESTE arquivo
  const yaml = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(yaml, "scripts/publicacao/impressao-digital.sql");
});

// ---------------------------------------------------------------------------
// CAF EXPLÍCITA (04/10/2026): projeto = ikcous-publicada.
// ---------------------------------------------------------------------------
const MSG_SEM_ACESSO =
  "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto";
const SEGREDOS_DOS_DOIS = {
  SUPABASE_ACCESS_TOKEN: "tk-legado",
  SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
};

Deno.test({
  name: "CAF explícita: com o segredo IKCOUS usa SÓ ele (nunca o legado) e roda gate e fingerprint; loja continua com o legado",
  ...SEM_SANITIZAR,
  fn: async () => {
    const caf = await rodarWorkflow(
      "",
      respostaSaudavel,
      "ikcous-publicada",
      SEGREDOS_DOS_DOIS,
    );
    assertEquals(caf.fim, true, caf.texto);
    assertEquals(caf.chamadas.length, 3, "gate, registro e fingerprint");
    assert(
      caf.autorizacoes.every((a) => a === "Bearer tk-caf"),
      `CAF: todo pedido leva o segredo IKCOUS: ${caf.autorizacoes}`,
    );
    assert(
      !caf.texto.includes("tk-caf") && !caf.texto.includes("tk-legado"),
      "nenhum segredo no log",
    );
    const loja = await rodarWorkflow(
      "",
      respostaSaudavel,
      "loja",
      SEGREDOS_DOS_DOIS,
    );
    assertEquals(loja.fim, true, loja.texto);
    assert(
      loja.autorizacoes.every((a) => a === "Bearer tk-legado"),
      `loja: continua com o segredo de sempre: ${loja.autorizacoes}`,
    );
    const sandbox = await rodarWorkflow(
      "",
      respostaSaudavel,
      "sandbox",
      SEGREDOS_DOS_DOIS,
    );
    assert(
      sandbox.autorizacoes.every((a) => a === "Bearer tk-legado"),
      "sandbox: idem",
    );
  },
});

Deno.test({
  name: "CAF explícita: SEM o segredo IKCOUS PARA com o bloqueio concreto, zero requisições — nunca cai no segredo de loja/sandbox (e o inverso também não)",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const segredos of [
      { SUPABASE_ACCESS_TOKEN: "tk-legado" },
      { SUPABASE_ACCESS_TOKEN: "tk-legado", SUPABASE_ACCESS_TOKEN_IKCOUS: "" },
    ]) {
      const r = await rodarWorkflow(
        "",
        respostaSaudavel,
        "ikcous-publicada",
        segredos,
      );
      assertEquals(r.exit, 1, r.texto);
      assertEquals(
        r.chamadas.length,
        0,
        "sem segredo próprio nenhuma requisição sai (nem com o legado presente)",
      );
      assertStringIncludes(r.texto, MSG_SEM_ACESSO);
    }
    const inverso = await rodarWorkflow("", respostaSaudavel, "loja", {
      SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
    });
    assertEquals(inverso.exit, 1);
    assertEquals(
      inverso.chamadas.length,
      0,
      "loja sem o segredo dela também não usa o IKCOUS",
    );
    assertStringIncludes(inverso.texto, "SEM SUPABASE_ACCESS_TOKEN");
  },
});

Deno.test({
  name: "CAF explícita: 401/403 PARA — no gate (1 requisição) e no apply (ESTADO DESCONHECIDO + bloqueio, 1 única requisição de apply, sem ROLLBACK paralelo)",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const status of [401, 403]) {
      const gate = await rodarWorkflow(
        M201,
        () => ({ status, corpo: "denied" }),
        "ikcous-publicada",
        SEGREDOS_DOS_DOIS,
      );
      assertEquals(gate.exit, 1, gate.texto);
      assertEquals(
        gate.chamadas.length,
        1,
        `${status} no gate: nada mais sai (sem retry, sem outro segredo)`,
      );
      assertStringIncludes(gate.texto, MSG_SEM_ACESSO);
      assertStringIncludes(gate.texto, `HTTP ${status}`);
      assert(
        gate.autorizacoes.every((a) => a === "Bearer tk-caf"),
        "não tentou outro segredo",
      );

      const apply = await rodarWorkflow(
        M201,
        (q) =>
          q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n") &&
          q.includes("ALTER COLUMN criada_sob_autorizacao")
            ? { status, corpo: "denied" }
            : respostaSaudavel(q),
        "ikcous-publicada",
        SEGREDOS_DOS_DOIS,
      );
      assertEquals(apply.exit, 1, apply.texto);
      assertStringIncludes(apply.texto, MSG_SEM_ACESSO);
      assertStringIncludes(apply.texto, "ESTADO DESCONHECIDO");
      assertEquals(
        apply.chamadas.filter(
          (q) =>
            q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n") &&
            q.includes("ALTER COLUMN criada_sob_autorizacao"),
        ).length,
        1,
        "uma única requisição de apply, sem retry",
      );
      assert(
        !apply.chamadas.some((q) => q.trim() === "ROLLBACK;"),
        "sem ROLLBACK em outra requisição",
      );
      assert(
        apply.autorizacoes.every((a) => a === "Bearer tk-caf"),
        "o apply também só usou o segredo IKCOUS",
      );
    }
  },
});

Deno.test("CAF explícita: o mapeamento de loja e sandbox é byte a byte o de antes, e ikcous-publicada aponta para o ref fixo da CAF", async () => {
  const yaml = await Deno.readTextFile(WORKFLOW);
  assertStringIncludes(
    yaml,
    "const REFS = { loja: 'cafkrminfnokvgjqtkle', sandbox: 'lofznuxcvezrhxsgjqyg', 'ikcous-publicada': 'cafkrminfnokvgjqtkle', savy: 'gnjsrucsmjkajijrakzr' };",
  );
  const trecho = extrairTrechoDeResolucaoDoRef(yaml);
  assertEquals(
    avaliarResolucaoDoRef(trecho, "ikcous-publicada").ref,
    "cafkrminfnokvgjqtkle",
  );
  assertEquals(
    avaliarResolucaoDoRef(trecho, "loja").ref,
    "cafkrminfnokvgjqtkle",
  );
  assertEquals(
    avaliarResolucaoDoRef(trecho, "sandbox").ref,
    "lofznuxcvezrhxsgjqyg",
  );
  // ainda recusa o que não é uma das três
  for (const ruim of [
    "ikcous-publicada/restart#",
    "IKCOUS-PUBLICADA",
    "ikcous",
    "cafkrminfnokvgjqtkle",
  ]) {
    assertEquals(avaliarResolucaoDoRef(trecho, ruim).codigoSaida, 1, ruim);
  }
});

// ---------------------------------------------------------------------------
// FAIXA HISTÓRICA 20261160..20261166 (06/10/2026): já está VIVA no banco da CAF
// (só o registro no ledger falta) e reaplicá-la é regressivo e destrutivo. Nenhum
// apply nem rollback-manual dessas 7 versões roda nas TRÊS rotas (a CAF por
// `ikcous-publicada` e `loja`, o mesmo banco, e a Savy), ANTES de qualquer requisição.
// ---------------------------------------------------------------------------
const FAIXA_HISTORICA = [
  "20261160000000_o_codigo_de_barras_e_o_canal_nascem_no_banco.sql",
  "20261161000000_o_balcao_acha_o_produto_pelo_codigo.sql",
  "20261162000000_a_venda_no_balcao_nasce_inteira.sql",
  "20261163000000_a_lista_de_pedidos_filtra_por_canal.sql",
  "20261164000000_a_varredura_de_cancelados_enxerga_o_cancelamento.sql",
  "20261165000000_a_loja_nasce_com_frete_gratis_desligado.sql",
  "20261166000000_o_cache_de_cotacao_nao_guarda_repeticao.sql",
];
const ROTAS_DA_CAF: Array<[string, Record<string, string>]> = [
  ["ikcous-publicada", { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" }],
  ["loja", { SUPABASE_ACCESS_TOKEN: "tk-legado" }],
  // a Savy (loja cliente real): já tem as 7 no banco e no ledger; reaplicar a
  // 62, 63 ou 64 regride o corpo (provado pelo revisor) — a recusa vale nas 3 rotas
  ["savy", { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" }],
];

Deno.test({
  name: "aplicar-migrations: as 7 migrations 20261160..66 e os rollback-manual delas são RECUSADAS nas TRÊS rotas (ikcous-publicada, loja e savy), antes de qualquer requisição",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const [projeto, segredos] of ROTAS_DA_CAF) {
      for (const arquivo of FAIXA_HISTORICA) {
        for (const alvo of [arquivo, `rollback-manual-${arquivo}`]) {
          const r = await rodarWorkflow(
            alvo,
            respostaSaudavel,
            projeto,
            segredos,
          );
          assertEquals(r.exit, 1, `${projeto} ${alvo}: ${r.texto}`);
          assertEquals(
            r.chamadas.length,
            0,
            `${projeto} ${alvo}: nenhuma requisição`,
          );
          assertStringIncludes(
            r.texto,
            "faixa histórica: só prova 9a + backfill 60-66",
          );
          assertStringIncludes(r.texto, alvo);
        }
      }
    }
  },
});

Deno.test({
  name: "aplicar-migrations: a recusa da faixa histórica pega o arquivo no MEIO de uma lista (a lista inteira passa ou nada sai) e não pega os vizinhos 20261159 e 20261167",
  ...SEM_SANITIZAR,
  fn: async () => {
    const meio = await rodarWorkflow(
      `${M201},${FAIXA_HISTORICA[3]}`,
      respostaSaudavel,
      "ikcous-publicada",
      { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" },
    );
    assertEquals(meio.exit, 1, meio.texto);
    assertEquals(meio.chamadas.length, 0);
    assertStringIncludes(meio.texto, "faixa histórica");
    // controle: o vizinho 20261167 NÃO cai na regra (segue o fluxo normal da CAF)
    const vizinho = await rodarWorkflow(
      "20261167000000_sobre_a_loja_ganha_endereco_e_descricao.sql",
      respostaSaudavel,
      "ikcous-publicada",
      { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" },
    );
    assert(!vizinho.texto.includes("faixa histórica"), vizinho.texto);
    assert(vizinho.chamadas.length > 0, "o vizinho chega a consultar o banco");
  },
});
