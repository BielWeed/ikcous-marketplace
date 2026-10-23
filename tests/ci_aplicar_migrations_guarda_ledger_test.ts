// @ts-nocheck
/**
 * GUARDA DO LEDGER no aplicar-migrations.yml (achado migrations-1 da onda 2,
 * 23/10/2026).
 *
 * O defeito: o workflow aplicava a lista pedida sem olhar se alguma versão JÁ
 * estava registrada em `supabase_migrations.schema_migrations`. Reaplicar por
 * engano uma migration antiga (ex.: a 20261270) trocava em silêncio a função que
 * uma migration mais nova (a 20261349) recriou, o registro no ledger fazia
 * `ON CONFLICT DO NOTHING` e o run terminava VERDE.
 *
 * O conserto: depois do gate de transporte e ANTES da prova e do apply, UMA
 * consulta só de leitura ao ledger da loja alvo. Versão da lista já registrada =
 * o run PARA com RECUSADO, sem aplicar nada (nem as outras da lista). Reaplicar
 * de propósito exige `permitir_reaplicar=true`. Rollback-manual não passa por
 * esta guarda (ele PRECISA da linha no ledger, para apagá-la). A consulta que
 * falha, ou cuja resposta não se entende, também PARA: check ausente tem cara de
 * check verde.
 *
 * O `node -e` INTEIRO é extraído do workflow (desfazendo os escapes do bash) e
 * rodado aqui com um `fetch` falso — nada de rede, mesmo método de
 * tests/ci_ledger_do_apply_test.ts.
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const APLICAR = join(RAIZ, ".github/workflows/aplicar-migrations.yml");
const requireLocal = createRequire(import.meta.url);
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };
const REF_CAF = "cafkrminfnokvgjqtkle";
const REF_SAVY = "gnjsrucsmjkajijrakzr";

function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex(
    (l) => l.includes("name:") && l.includes(nomeDoStep),
  );
  assert(iNome >= 0, `step "${nomeDoStep}" não achado`);
  const iRun = linhas.findIndex(
    (l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(iRun > iNome);
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

function argumentoDoNodeE(blocoRun: string): string {
  const linhas = blocoRun.split("\n");
  const iAbre = linhas.findIndex((l) => /^\s*node -e "\s*$/.test(l));
  assert(iAbre >= 0);
  const iFecha = linhas.findIndex((l, i) => i > iAbre && /^\s*"\s*$/.test(l));
  assert(iFecha > iAbre);
  return linhas.slice(iAbre + 1, iFecha).join("\n");
}

const desescaparBash = (js: string) => js.replace(/\\([\\$"`])/g, "$1");

type Resposta = { status?: number; corpo?: string; lancar?: Error };

const SONDA = JSON.stringify([
  {
    sonda1: JSON.stringify({
      isolamento: "repeatable read",
      somente_leitura: "on",
      pid: 123,
      agora: "2026-10-23 06:00:00+00",
      relogio: 1000.0,
    }),
    sonda2: JSON.stringify({
      isolamento: "repeatable read",
      somente_leitura: "on",
      pid: 123,
      agora: "2026-10-23 06:00:00+00",
      relogio: 1000.2,
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
const ENVELOPE = "BEGIN ISOLATION LEVEL REPEATABLE READ;\n";
const PREFIXO_DA_CONSULTA =
  "SELECT version FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[";

const ehConsultaDoLedger = (q: string) => q.startsWith(PREFIXO_DA_CONSULTA);

/** API saudável; `noLedger` são as versões que a consulta de leitura devolve
 * como já registradas (a resposta é filtrada pelas que a consulta pediu). */
function responderComo(noLedger: string[], ledger?: Resposta) {
  return (q: string): Resposta => {
    if (ehConsultaDoLedger(q)) {
      if (ledger) return ledger;
      const pedidas = [...q.matchAll(/'([0-9]{14})'/g)].map((m) => m[1]);
      return {
        corpo: JSON.stringify(
          pedidas
            .filter((v) => noLedger.includes(v))
            .map((version) => ({ version })),
        ),
      };
    }
    if (q.includes("ikcous.sonda1")) return { corpo: SONDA };
    if (q.includes("txid_current_if_assigned"))
      return { corpo: '[{"pid":123,"txid":null}]' };
    if (q.includes("marketplace_orders where status"))
      return { corpo: '[{"pedidos":3,"cancelados":0}]' };
    if (q.startsWith(ENVELOPE)) return { corpo: FP_OK };
    if (q.startsWith("BEGIN;\n")) return { corpo: "[]" };
    if (q.includes("query_to_xml"))
      return { corpo: '[{"tabela":"marketplace_orders","linhas_agora":3}]' };
    if (q.includes("has_function_privilege"))
      return { corpo: '[{"paged8":true,"venda":true}]' };
    throw new Error(`consulta inesperada no stub: ${q.slice(0, 80)}`);
  };
}

async function rodarAplicar(
  migracoes: string,
  responder: (q: string) => Resposta,
  opcoes: {
    projeto?: string;
    segredos?: Record<string, string>;
    ref?: string;
    fsFalso?: Record<string, string>;
    permitirReaplicar?: string;
  } = {},
) {
  const {
    projeto = "loja",
    segredos = { SUPABASE_ACCESS_TOKEN: "tk-legado" },
    ref = REF_CAF,
    fsFalso,
    permitirReaplicar,
  } = opcoes;
  const yaml = await Deno.readTextFile(APLICAR);
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
  let saiu = false;
  const fetchFalso = async (
    url: string,
    init: { body: string; headers?: Record<string, string> },
  ) => {
    if (saiu) return await new Promise<never>(() => {});
    assertStringIncludes(url, `/v1/projects/${ref}/database/query`);
    const query = JSON.parse(init.body).query;
    chamadas.push(query);
    autorizacoes.push(init.headers?.Authorization ?? "");
    const r = responder(query);
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
  const env: Record<string, string> = {
    ...segredos,
    MIGRACOES: migracoes,
    PROJETO: projeto,
  };
  if (permitirReaplicar !== undefined)
    env.PERMITIR_REAPLICAR = permitirReaplicar;
  const processFalso = {
    env,
    exit: (c: number) => {
      saiu = true;
      resolver({ exit: c });
    },
  };
  const antes = Deno.cwd();
  Deno.chdir(RAIZ);
  try {
    const reqLocal = (p: string) => {
      if (p === "node:fs" && fsFalso) {
        const real = requireLocal("node:fs");
        const chave = (c: string) =>
          Object.keys(fsFalso).find((k) => String(c).endsWith(k));
        return {
          ...real,
          existsSync: (c: string) => !!chave(c) || real.existsSync(c),
          readFileSync: (c: string, enc?: string) =>
            chave(c) ? fsFalso[chave(c)] : real.readFileSync(c, enc),
        };
      }
      return requireLocal(p.startsWith(".") ? join(RAIZ, p) : p);
    };
    new Function("require", "process", "fetch", "console", codigo)(
      reqLocal,
      processFalso,
      fetchFalso,
      consoleFalso,
    );
    const fim = await terminou;
    return {
      ...fim,
      chamadas,
      autorizacoes,
      texto: saida.join("\n"),
    };
  } finally {
    Deno.chdir(antes);
  }
}

const V1270 = "20261270000000";
const M1270 = `${V1270}_pagamento_adiantado_e_estorno_antes_da_confirmacao.sql`;
const V1349 = "20261349000000";
const V201 = "20261201000000";
const M201 = "20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const RB201 =
  "rollback-manual-20261201000000_linha_nova_nasce_sob_autorizacao.sql";

const ESCRITAS = (q: string) =>
  q.startsWith("BEGIN;\n") || q.startsWith(ENVELOPE);

Deno.test({
  name: "guarda do ledger: migration JÁ registrada na loja (o caso da 20261270 por cima da 20261349) é RECUSADA depois do gate e antes de qualquer prova/apply, e o run não termina verde",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(M1270, responderComo([V1270, V1349]));
    assertEquals(r.exit, 1, r.texto);
    assert(!r.texto.includes("FIM:"), "nunca termina verde");
    assertStringIncludes(r.texto, "RECUSADO");
    assertStringIncludes(
      r.texto,
      "versão já aplicada nesta loja; reaplicar pode desfazer correção mais nova",
    );
    assertStringIncludes(r.texto, M1270);
    assertStringIncludes(r.texto, "permitir_reaplicar=true");
    assertStringIncludes(r.texto, "Nada foi aplicado");
    assertEquals(r.chamadas.filter(ESCRITAS), [], "nem prova nem apply");
    // ordem: gate (0), registro do gate (1), consulta do ledger (2) — e para
    assertStringIncludes(r.chamadas[0], "READ ONLY");
    assert(ehConsultaDoLedger(r.chamadas[2]), r.chamadas[2]);
    assertEquals(r.chamadas.length, 3);
  },
});

Deno.test({
  name: "guarda do ledger: a consulta é UMA leitura pura (SELECT … ANY(ARRAY[versões de 14 dígitos]) na ordem da lista), sem transação nem escrita, com o segredo do alvo",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(`${M201}, ${M1270}`, responderComo([]), {
      projeto: "ikcous-publicada",
      segredos: { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" },
    });
    assertEquals(r.fim, true, r.texto);
    const consultas = r.chamadas.filter(ehConsultaDoLedger);
    assertEquals(consultas.length, 1, "uma consulta só, para a lista inteira");
    assertEquals(
      consultas[0],
      `${PREFIXO_DA_CONSULTA}'${V201}', '${V1270}']);`,
    );
    assert(
      !/\b(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/i.test(
        consultas[0],
      ),
      "a consulta não escreve nem abre transação",
    );
    assertEquals(consultas[0].split(";").length - 1, 1, "um statement só");
    // depois do gate e do registro do gate, antes do fingerprint e da prova
    const i = r.chamadas.indexOf(consultas[0]);
    assert(i > r.chamadas.findIndex((q) => q.includes("txid_current")));
    assert(
      i < r.chamadas.findIndex((q) => q.includes("marketplace_orders where")),
    );
    assert(i < r.chamadas.findIndex(ESCRITAS));
    assert(r.autorizacoes.every((a) => a === "Bearer tk-caf"));
    assert(!r.texto.includes("tk-caf"), "nenhum segredo no log");
  },
});

Deno.test({
  name: "guarda do ledger: fluxo normal (nenhuma versão da lista no ledger) NÃO é bloqueado — prova, apply e verificação rodam, na ordem; vizinhas já registradas (a 1349) não contam",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(M201, responderComo([V1349, V1270]));
    assertEquals(r.fim, true, r.texto);
    assert(!r.texto.includes("RECUSADO"), r.texto);
    assertEquals(r.chamadas.filter((q) => q.startsWith("BEGIN;\n")).length, 1);
    assertEquals(r.chamadas.filter((q) => q.startsWith(ENVELOPE)).length, 1);
  },
});

Deno.test({
  name: "guarda do ledger: lista com várias migrations e só UMA já registrada recusa a lista INTEIRA — nada da lista é aplicado, nem as novas que vinham antes",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const lista of [
      `${M201}, ${M1270}`, // a registrada é a última
      `${M1270}, ${M201}`, // a registrada é a primeira
    ]) {
      const r = await rodarAplicar(lista, responderComo([V1270]));
      assertEquals(r.exit, 1, r.texto);
      assertStringIncludes(r.texto, M1270);
      assert(!r.texto.includes(M201), "só aponta a que já estava registrada");
      assertEquals(r.chamadas.filter(ESCRITAS), [], "nenhuma escrita");
    }
  },
});

Deno.test({
  name: "guarda do ledger: a recusa vale em toda loja (CAF explícita e Savy) e a consulta vai ao ref e com o segredo do alvo",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const [projeto, ref, segredos, auth] of [
      [
        "savy",
        REF_SAVY,
        { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" },
        "Bearer tk-savy",
      ],
      [
        "ikcous-publicada",
        REF_CAF,
        { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" },
        "Bearer tk-caf",
      ],
      ["sandbox", "lofznuxcvezrhxsgjqyg", {}, "Bearer tk-legado"],
    ] as const) {
      const r = await rodarAplicar(M1270, responderComo([V1270]), {
        projeto,
        ref,
        segredos: {
          SUPABASE_ACCESS_TOKEN: "tk-legado",
          ...segredos,
        },
      });
      assertEquals(r.exit, 1, `${projeto}: ${r.texto}`);
      assertStringIncludes(r.texto, "RECUSADO");
      assertEquals(r.chamadas.filter(ESCRITAS), [], projeto);
      assert(
        r.autorizacoes.every((a) => a === auth),
        projeto,
      );
    }
  },
});

Deno.test({
  name: "guarda do ledger: permitir_reaplicar=true libera a reaplicação de propósito — o run avisa em voz alta quais versões e segue para prova e apply; qualquer outro valor (false, vazio, 'TRUE', 'sim') continua recusando",
  ...SEM_SANITIZAR,
  fn: async () => {
    const liberado = await rodarAplicar(M1270, responderComo([V1270]), {
      permitirReaplicar: "true",
    });
    assertEquals(liberado.fim, true, liberado.texto);
    assertStringIncludes(liberado.texto, "REAPLICAÇÃO DELIBERADA");
    assertStringIncludes(liberado.texto, M1270);
    assertEquals(
      liberado.chamadas.filter((q) => q.startsWith(ENVELOPE)).length,
      1,
    );
    for (const valor of ["false", "", "TRUE", "sim", "1", "true "]) {
      const r = await rodarAplicar(M1270, responderComo([V1270]), {
        permitirReaplicar: valor,
      });
      assertEquals(r.exit, 1, `"${valor}": ${r.texto}`);
      assertEquals(r.chamadas.filter(ESCRITAS), [], `"${valor}"`);
    }
  },
});

Deno.test({
  name: "guarda do ledger: permitir_reaplicar NÃO levanta a recusa da faixa histórica 20261160..66 (essa continua valendo, antes de qualquer requisição)",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(
      "20261162000000_a_venda_no_balcao_nasce_inteira.sql",
      responderComo([]),
      { permitirReaplicar: "true" },
    );
    assertEquals(r.exit, 1, r.texto);
    assertStringIncludes(r.texto, "faixa histórica");
    assertEquals(r.chamadas.length, 0);
  },
});

Deno.test({
  name: "guarda do ledger: a consulta que FALHA ou cuja resposta não se entende PARA o run antes de qualquer escrita — nunca segue em silêncio",
  ...SEM_SANITIZAR,
  fn: async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const casos: [string, Resposta][] = [
      ["HTTP 500", { status: 500, corpo: "oops" }],
      ["HTTP 202", { status: 202, corpo: "[]" }],
      [
        "ledger ausente",
        {
          status: 400,
          corpo:
            'relation "supabase_migrations.schema_migrations" does not exist',
        },
      ],
      ["corpo com erro", { corpo: '{"message":"boom"}' }],
      ["timeout", { lancar: timeout }],
      ["rede caindo", { lancar: new TypeError("fetch failed") }],
      ["corpo vazio", { corpo: "" }],
      ["não é JSON", { corpo: "<html>bad gateway</html>" }],
      ["JSON que não é array", { corpo: '{"version":"20261270000000"}' }],
      ["linha sem version", { corpo: '[{"outra":"coisa"}]' }],
      ["version que não é texto", { corpo: '[{"version":20261270000000}]' }],
      ["linha que não é objeto", { corpo: '["20261270000000"]' }],
      ["null", { corpo: "null" }],
    ];
    for (const [nome, resposta] of casos) {
      const r = await rodarAplicar(M1270, responderComo([], resposta));
      assertEquals(r.exit, 1, `${nome}: ${r.texto}`);
      assert(!r.texto.includes("FIM:"), nome);
      assertEquals(r.chamadas.filter(ESCRITAS), [], `${nome}: nenhuma escrita`);
      assertStringIncludes(r.texto, "ledger", nome);
    }
    // mesmo com permitir_reaplicar=true a consulta que falha PARA
    const r = await rodarAplicar(
      M1270,
      responderComo([], { status: 500, corpo: "oops" }),
      { permitirReaplicar: "true" },
    );
    assertEquals(r.exit, 1, r.texto);
    assertEquals(r.chamadas.filter(ESCRITAS), []);
  },
});

Deno.test({
  name: "guarda do ledger: resposta aninhada (array de arrays) e lista vazia são entendidas; linha de outra versão que a API devolvesse por engano não conta",
  ...SEM_SANITIZAR,
  fn: async () => {
    const aninhada = await rodarAplicar(
      M1270,
      responderComo([], { corpo: `[[{"version":"${V1270}"}]]` }),
    );
    assertEquals(aninhada.exit, 1, aninhada.texto);
    assertStringIncludes(aninhada.texto, "RECUSADO");
    const vaziaAninhada = await rodarAplicar(
      M201,
      responderComo([], { corpo: "[[]]" }),
    );
    assertEquals(vaziaAninhada.fim, true, vaziaAninhada.texto);
    const outra = await rodarAplicar(
      M201,
      responderComo([], { corpo: `[{"version":"${V1349}"}]` }),
    );
    assertEquals(outra.fim, true, outra.texto);
  },
});

Deno.test({
  name: "guarda do ledger: rollback-manual NÃO passa pela guarda (ele precisa da linha no ledger para apagá-la) e segue como sempre, sem a consulta",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(RB201, responderComo([V201]));
    assertEquals(r.fim, true, r.texto);
    assertEquals(r.chamadas.filter(ehConsultaDoLedger), []);
    assertEquals(r.chamadas.filter((q) => q.startsWith(ENVELOPE)).length, 1);
  },
});

Deno.test({
  name: "guarda do ledger: lista vazia (só fingerprint) não consulta o ledger; o fluxo continua sendo gate, registro e fingerprint",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar("", responderComo([V1270]));
    assertEquals(r.fim, true, r.texto);
    assertEquals(r.chamadas.length, 3);
    assertEquals(r.chamadas.filter(ehConsultaDoLedger), []);
  },
});

Deno.test({
  name: "guarda do ledger: a MESMA versão duas vezes na lista (ou dois arquivos com a mesma versão) é recusada sem nenhuma requisição — o segundo apply seria uma reaplicação; com permitir_reaplicar=true passa",
  ...SEM_SANITIZAR,
  fn: async () => {
    const a = "20261298000000_a.sql";
    const b = "20261298000000_b.sql";
    const fsFalso = { [a]: "SELECT 1;\n", [b]: "SELECT 2;\n" };
    for (const lista of [`${M201}, ${M201}`, `${a}, ${b}`]) {
      const r = await rodarAplicar(lista, responderComo([]), { fsFalso });
      assertEquals(r.exit, 1, `${lista}: ${r.texto}`);
      assertStringIncludes(r.texto, "RECUSADO");
      assertStringIncludes(r.texto, "repetida na lista");
      assertEquals(r.chamadas.length, 0, "recusa antes da rede");
    }
    const liberado = await rodarAplicar(`${a}, ${b}`, responderComo([]), {
      fsFalso,
      permitirReaplicar: "true",
    });
    assertEquals(liberado.fim, true, liberado.texto);
  },
});

Deno.test({
  name: "guarda do ledger: lista com espaços e itens vazios é normalizada ANTES de consultar (a consulta leva só as versões, sem lixo)",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(` ${M201} ,, ${M1270} ,`, responderComo([]));
    assertEquals(r.fim, true, r.texto);
    assertEquals(r.chamadas.filter(ehConsultaDoLedger), [
      `${PREFIXO_DA_CONSULTA}'${V201}', '${V1270}']);`,
    ]);
  },
});

Deno.test("aplicar-migrations.yml: declara o input permitir_reaplicar (boolean, padrão false, documentado) e o repassa ao script por PERMITIR_REAPLICAR", async () => {
  const yaml = await Deno.readTextFile(APLICAR);
  const i = yaml.indexOf("      permitir_reaplicar:");
  assert(i > 0, "input permitir_reaplicar não declarado");
  const bloco = yaml.slice(i, yaml.indexOf("\njobs:", i));
  const proximo = bloco.slice(1).search(/\n {6}[a-z_]+:/);
  const input = proximo < 0 ? bloco : bloco.slice(0, proximo + 1);
  assertStringIncludes(input, "type: boolean");
  assertStringIncludes(input, "default: false");
  assertStringIncludes(input, "required: false");
  assertStringIncludes(input, "description:");
  assertStringIncludes(input, "ledger");
  assertStringIncludes(
    yaml,
    "PERMITIR_REAPLICAR: ${{ inputs.permitir_reaplicar }}",
  );
  // o cabeçalho do workflow documenta a guarda
  const cabecalho = yaml.slice(0, yaml.indexOf("\non:"));
  assertStringIncludes(cabecalho, "permitir_reaplicar");
});
