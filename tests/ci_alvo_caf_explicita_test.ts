// @ts-nocheck
/**
 * O alvo CAF EXPLÍCITO (`projeto = ikcous-publicada`) nos workflows
 * aplicar-migrations.yml e conferir-banco-da-loja.yml (04/10/2026).
 *
 * O QUE ESTES TESTES MEDEM:
 *  - a opção existe, o ref é o fixo da CAF (cafkrminfnokvgjqtkle) e `loja` /
 *    `sandbox` ficaram com o mapeamento de antes;
 *  - o PRIMEIRO passo do job (antes do checkout e de qualquer requisição) exige
 *    `expected_sha` de 40 hex igual ao GITHUB_SHA — o bloco `run:` é EXTRAÍDO do
 *    arquivo e rodado com bash em 11 casos, com a mesma mensagem do
 *    publicar-functions.yml;
 *  - o segredo: SÓ o de NOME `SUPABASE_ACCESS_TOKEN_IKCOUS` para a CAF e SÓ o
 *    legado para o resto, sem `||` que caia no vizinho (texto do YAML e
 *    comportamento real do script contra um servidor stub);
 *  - sem o segredo, ou com 401/403: PARA com "sem acesso legítimo à CAF por
 *    SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto", sem 2ª requisição;
 *  - o job do ledger (que grava em schema_migrations) não roda para
 *    ikcous-publicada, nem no workflow nem no script.
 *
 * O comportamento do aplicar-migrations.yml (node -e) com o fetch falso está em
 * tests/ci_aplicar_migrations_test.ts.
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const APLICAR = join(RAIZ, ".github/workflows/aplicar-migrations.yml");
const CONFERIR = join(RAIZ, ".github/workflows/conferir-banco-da-loja.yml");
const SCRIPT = join(RAIZ, "scripts/publicacao/conferir-banco.cjs");
const REF_CAF = "cafkrminfnokvgjqtkle";
const MSG_SEM_ACESSO =
  "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto";
const MSG_SHA =
  "Loja cliente (ikcous-publicada) exige expected_sha completo e igual ao GITHUB_SHA do run";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

/** O arquivo sem as linhas de comentário (os cabeçalhos explicam o que não fazem). */
function semComentarios(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** O corpo do `run: |` do step cujo `name:` contém o trecho. */
function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex((l) => l.includes(`name: ${nomeDoStep}`));
  assert(iNome >= 0, `step "${nomeDoStep}" não achado`);
  const iRun = linhas.findIndex(
    (l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(iRun > iNome, `o step "${nomeDoStep}" não tem \`run: |\``);
  const recuoDe = (l: string) => l.match(/^\s*/)[0].length;
  const recuoRun = recuoDe(linhas[iRun]);
  const corpo: string[] = [];
  for (const l of linhas.slice(iRun + 1)) {
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    if (recuoDe(l) <= recuoRun) break;
    corpo.push(l);
  }
  const menor = Math.min(
    ...corpo.filter((l) => l.trim() !== "").map((l) => recuoDe(l)),
  );
  return corpo.map((l) => l.slice(menor)).join("\n");
}

/** O texto de um job (de `\n  <nome>:` até o próximo job de 2 espaços). */
function bloco(yaml: string, job: string): string {
  const i = yaml.indexOf(`\n  ${job}:`);
  assert(i >= 0, `job ${job} não achado`);
  const resto = yaml.slice(i + 1);
  const prox = resto.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return prox < 0 ? resto : resto.slice(0, prox + 1);
}

async function rodarBash(script: string, env: Record<string, string>) {
  const r = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd: RAIZ,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { codigo: r.code, saida: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

const WORKFLOWS: [string, string, string][] = [
  ["aplicar-migrations.yml", APLICAR, "aplicar"],
  ["conferir-banco-da-loja.yml", CONFERIR, "conferir"],
];

for (const [nome, caminho, job] of WORKFLOWS) {
  Deno.test(`${nome}: a opção ikcous-publicada existe depois de loja e sandbox (que não mudam) e expected_sha é um input opcional`, async () => {
    const yaml = await Deno.readTextFile(caminho);
    assertStringIncludes(
      yaml,
      "default: loja\n        options:\n          - loja\n          - sandbox\n          - ikcous-publicada\n",
    );
    assert(/\n {6}expected_sha:\n/.test(yaml), "falta o input expected_sha");
    const inp = yaml.slice(yaml.indexOf("\n      expected_sha:"));
    assertStringIncludes(inp.slice(0, 400), "required: false");
    assertStringIncludes(inp.slice(0, 400), 'default: ""');
  });

  Deno.test(`${nome}: a conferência do expected_sha é o PRIMEIRO passo do job, antes do checkout e de qualquer requisição`, async () => {
    const yaml = semComentarios(await Deno.readTextFile(caminho));
    const j = bloco(yaml, job);
    const iSteps = j.indexOf("    steps:\n");
    assert(iSteps >= 0);
    const passos = j.slice(iSteps + "    steps:\n".length);
    assert(
      passos.trimStart().startsWith("- name: Confere o alvo"),
      `o primeiro passo deveria ser "Confere o alvo", é: ${passos.trimStart().slice(0, 60)}`,
    );
    assert(
      passos.indexOf("Confere o alvo") < passos.indexOf("actions/checkout"),
      "a conferência vem antes do checkout",
    );
    // e nenhum passo ANTES dela faz rede
    assert(
      !/fetch\(|curl |api\.supabase\.com/.test(
        passos.slice(0, passos.indexOf("actions/checkout")),
      ),
    );
  });

  Deno.test({
    name: `${nome}: o passo "Confere o alvo", EXTRAÍDO e rodado em bash — expected_sha de 40 hex igual ao GITHUB_SHA, só para a CAF`,
    ...SEM_SANITIZAR,
    fn: async () => {
      const yaml = await Deno.readTextFile(caminho);
      const script = blocoRunDoStep(yaml, "Confere o alvo");
      const rodar = (projeto: string, esperado: string, sha = SHA) =>
        rodarBash(script, {
          PATH: Deno.env.get("PATH") ?? "",
          PROJETO: projeto,
          EXPECTED_SHA: esperado,
          GITHUB_SHA: sha,
        });
      // aceita
      assertEquals((await rodar("ikcous-publicada", SHA)).codigo, 0, "igual");
      assertEquals(
        (await rodar("ikcous-publicada", SHA.toUpperCase())).codigo,
        0,
        "igual com maiúsculas",
      );
      // recusa — e com a mesma mensagem do publicar-functions.yml
      const recusas: [string, string][] = [
        ["vazio", ""],
        ["curto (7)", SHA.slice(0, 7)],
        ["39 caracteres", SHA.slice(0, 39)],
        ["41 caracteres", `${SHA}a`],
        ["40 hex de OUTRO commit", "b".repeat(40)],
        ["40 caracteres não hex", "g".repeat(40)],
        ["com espaço no fim", `${SHA.slice(0, 39)} `],
      ];
      for (const [caso, esperado] of recusas) {
        const r = await rodar("ikcous-publicada", esperado);
        assertEquals(r.codigo, 1, `${caso}: ${r.saida}`);
        assertStringIncludes(r.saida, MSG_SHA, caso);
      }
      // loja e sandbox não exigem nada (mesmo comportamento de antes)
      for (const projeto of ["loja", "sandbox"]) {
        assertEquals(
          (await rodar(projeto, "")).codigo,
          0,
          `${projeto} sem expected_sha`,
        );
        assertEquals(
          (await rodar(projeto, "lixo")).codigo,
          0,
          `${projeto} ignora o expected_sha`,
        );
      }
    },
  });

  Deno.test(`${nome}: cada alvo enxerga SÓ o seu segredo — a expressão && … || '' nunca cai no segredo do vizinho`, async () => {
    const yaml = semComentarios(await Deno.readTextFile(caminho));
    const j = bloco(yaml, job);
    const legado = [
      ...j.matchAll(/secrets\.SUPABASE_ACCESS_TOKEN(?!_)[^\n]*/g),
    ].map((m) => m[0]);
    const caf = [
      ...j.matchAll(/secrets\.SUPABASE_ACCESS_TOKEN_IKCOUS[^\n]*/g),
    ].map((m) => m[0]);
    assert(legado.length >= 1 && caf.length >= 1);
    for (const l of legado)
      assertEquals(
        l,
        "secrets.SUPABASE_ACCESS_TOKEN || '' }}",
        "legado só vale fora da CAF",
      );
    for (const l of caf)
      assertEquals(
        l,
        "secrets.SUPABASE_ACCESS_TOKEN_IKCOUS || '' }}",
        "o da CAF só vale na CAF",
      );
    assertEquals(
      [
        ...j.matchAll(
          /inputs\.projeto != 'ikcous-publicada' && inputs\.projeto != 'savy' && secrets\.SUPABASE_ACCESS_TOKEN \|\| ''/g,
        ),
      ].length,
      legado.length,
    );
    assertEquals(
      [
        ...j.matchAll(
          /inputs\.projeto == 'ikcous-publicada' && secrets\.SUPABASE_ACCESS_TOKEN_IKCOUS \|\| ''/g,
        ),
      ].length,
      caf.length,
    );
    assert(
      !/SUPABASE_ACCESS_TOKEN_IKCOUS\s*\|\|\s*secrets/.test(j),
      "nada de fallback entre os segredos",
    );
  });
}

Deno.test("conferir-banco-da-loja.yml: o job do ledger (que GRAVA em schema_migrations) não roda para ikcous-publicada; aplicar-migrations.yml não tem job de ledger", async () => {
  const yaml = semComentarios(await Deno.readTextFile(CONFERIR));
  const ledger = bloco(yaml, "ledger");
  assertStringIncludes(ledger, "inputs.projeto != 'ikcous-publicada'");
  // o ledger só roda com a conjunção toda: a condição de projeto está no MESMO `if`
  const linhaIf = ledger
    .split("\n")
    .find((l) => l.trimStart().startsWith("if:"));
  assertStringIncludes(linhaIf, "inputs.projeto != 'ikcous-publicada'");
  assertStringIncludes(linhaIf, "inputs.confirmar == 'GRAVAR'");
  // nenhum outro job do conferir escreve no ledger
  for (const job of [
    "conferir",
    "verificar-ikcous-original",
    "verificar-ikcous-publicado",
  ]) {
    assert(!/LEDGER/.test(bloco(yaml, job)), `${job} não pode passar LEDGER`);
  }
  const aplicar = semComentarios(await Deno.readTextFile(APLICAR));
  assert(!/\n {2}ledger:/.test(aplicar));
  // 06/10/2026: o apply de MIGRATION registra a versão no ledger DENTRO da mesma
  // transação (função `registroNoLedger`, um único INSERT, nunca job à parte nem
  // para rollback-manual — o comportamento está em tests/ci_ledger_do_apply_test.ts).
  assertEquals(
    (aplicar.match(/INSERT INTO supabase_migrations/gi) ?? []).length,
    1,
    "um único INSERT no ledger no aplicar-migrations",
  );
});

// ---------------------------------------------------------------------------
// scripts/publicacao/conferir-banco.cjs, de verdade, contra um servidor stub.
// ---------------------------------------------------------------------------
type Chamada = { url: string; auth: string | null };

function subirStub(status: number, corpo: string) {
  const chamadas: Chamada[] = [];
  const srv = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    (req) => {
      chamadas.push({
        url: new URL(req.url).pathname,
        auth: req.headers.get("authorization"),
      });
      return new Response(corpo, {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return {
    chamadas,
    base: `http://127.0.0.1:${srv.addr.port}`,
    parar: () => srv.shutdown(),
  };
}

async function rodarScript(
  env: Record<string, string>,
  stub: { base: string },
) {
  const r = await new Deno.Command("node", {
    args: [SCRIPT],
    cwd: RAIZ,
    env: {
      // nada do ambiente real vaza para o teste
      SUPABASE_ACCESS_TOKEN: "",
      SUPABASE_ACCESS_TOKEN_IKCOUS: "",
      PROJETO: "",
      CONSULTA: "",
      LEDGER: "",
      GITHUB_STEP_SUMMARY: "",
      CONFERIR_BANCO_API_BASE: stub.base,
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { codigo: r.code, saida: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

const LINHA_OK = JSON.stringify([
  { item: "x", esperado: "1", vivo: "1", ok: true },
]);
const CONSULTA = "8f-conferir-201";

Deno.test({
  name: "conferir-banco.cjs: REFS_POR_PROJETO tem exatamente loja, sandbox, ikcous-publicada e savy, com os refs certos",
  ...SEM_SANITIZAR,
  fn: () => {
    const { REFS_POR_PROJETO, resolverRef } = require(SCRIPT);
    assertEquals(REFS_POR_PROJETO, {
      loja: REF_CAF,
      sandbox: "lofznuxcvezrhxsgjqyg",
      "ikcous-publicada": REF_CAF,
      // a Savy explícita entrou em 06/10/2026 (tests/ci_alvo_savy_explicita_test.ts)
      savy: "gnjsrucsmjkajijrakzr",
    });
    assertEquals(resolverRef("ikcous-publicada"), REF_CAF);
    for (const ruim of [
      "IKCOUS-PUBLICADA",
      "ikcous",
      `${REF_CAF}/restart#`,
      "__proto__",
    ]) {
      let lancou = false;
      try {
        resolverRef(ruim);
      } catch {
        lancou = true;
      }
      assert(lancou, ruim);
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs na CAF explícita: usa SÓ o segredo IKCOUS (mesmo com o legado no ambiente) e loja continua com o legado",
  ...SEM_SANITIZAR,
  fn: async () => {
    const stub = subirStub(201, LINHA_OK);
    try {
      const caf = await rodarScript(
        {
          PROJETO: "ikcous-publicada",
          CONSULTA,
          SUPABASE_ACCESS_TOKEN: "tk-legado",
          SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
        },
        stub,
      );
      assertEquals(caf.codigo, 0, caf.saida);
      assertEquals(stub.chamadas.length, 1);
      assertEquals(stub.chamadas[0].auth, "Bearer tk-caf");
      assertEquals(
        stub.chamadas[0].url,
        `/v1/projects/${REF_CAF}/database/query/read-only`,
      );
      assert(
        !caf.saida.includes("tk-caf") && !caf.saida.includes("tk-legado"),
        "o segredo não vaza no log",
      );
      const loja = await rodarScript(
        {
          PROJETO: "loja",
          CONSULTA,
          SUPABASE_ACCESS_TOKEN: "tk-legado",
          SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
        },
        stub,
      );
      assertEquals(loja.codigo, 0, loja.saida);
      assertEquals(stub.chamadas.length, 2);
      assertEquals(
        stub.chamadas[1].auth,
        "Bearer tk-legado",
        "loja: o segredo de antes",
      );
    } finally {
      await stub.parar();
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs na CAF explícita: SEM o segredo IKCOUS PARA com o bloqueio concreto e ZERO requisições (nunca o legado); loja sem o segredo dela também não usa o IKCOUS",
  ...SEM_SANITIZAR,
  fn: async () => {
    const stub = subirStub(201, LINHA_OK);
    try {
      const r = await rodarScript(
        {
          PROJETO: "ikcous-publicada",
          CONSULTA,
          SUPABASE_ACCESS_TOKEN: "tk-legado",
        },
        stub,
      );
      assertEquals(r.codigo, 1, r.saida);
      assertStringIncludes(r.saida, MSG_SEM_ACESSO);
      const inverso = await rodarScript(
        { PROJETO: "loja", CONSULTA, SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" },
        stub,
      );
      assertEquals(inverso.codigo, 1, inverso.saida);
      assertStringIncludes(inverso.saida, "SEM SUPABASE_ACCESS_TOKEN");
      assertEquals(
        stub.chamadas.length,
        0,
        "nenhuma requisição saiu em nenhum dos dois",
      );
    } finally {
      await stub.parar();
    }
  },
});

for (const status of [401, 403]) {
  Deno.test({
    name: `conferir-banco.cjs na CAF explícita: HTTP ${status} PARA com o bloqueio concreto, UMA requisição, sem tentar outro segredo`,
    ...SEM_SANITIZAR,
    fn: async () => {
      const stub = subirStub(status, '{"message":"forbidden"}');
      try {
        const r = await rodarScript(
          {
            PROJETO: "ikcous-publicada",
            CONSULTA,
            SUPABASE_ACCESS_TOKEN: "tk-legado",
            SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
          },
          stub,
        );
        assertEquals(r.codigo, 1, r.saida);
        assertStringIncludes(r.saida, MSG_SEM_ACESSO);
        assertStringIncludes(r.saida, `HTTP ${status}`);
        assertEquals(stub.chamadas.length, 1, "sem retry");
        assertEquals(stub.chamadas[0].auth, "Bearer tk-caf");
        // controle: o mesmo status em `loja` NÃO diz que é a CAF (a mensagem de antes)
        const loja = await rodarScript(
          { PROJETO: "loja", CONSULTA, SUPABASE_ACCESS_TOKEN: "tk-legado" },
          stub,
        );
        assertEquals(loja.codigo, 1);
        assert(
          !loja.saida.includes(MSG_SEM_ACESSO),
          "loja não herda a mensagem da CAF",
        );
        assertStringIncludes(loja.saida, `HTTP ${status}`);
      } finally {
        await stub.parar();
      }
    },
  });
}

Deno.test({
  name: "conferir-banco.cjs na CAF explícita: LEDGER é recusado ANTES de qualquer requisição (o ledger não roda para ikcous-publicada)",
  ...SEM_SANITIZAR,
  fn: async () => {
    const stub = subirStub(201, LINHA_OK);
    try {
      for (const faixa of ["72-74", "75-78", "79-82", "83"]) {
        const r = await rodarScript(
          {
            PROJETO: "ikcous-publicada",
            LEDGER: faixa,
            SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
          },
          stub,
        );
        assertEquals(r.codigo, 1, r.saida);
        assertStringIncludes(
          r.saida,
          "o ledger não roda para ikcous-publicada",
        );
      }
      assertEquals(stub.chamadas.length, 0);
      // controle: em `loja` o ledger continua alcançável (a recusa é só da CAF explícita)
      const loja = await rodarScript(
        { PROJETO: "loja", LEDGER: "83", SUPABASE_ACCESS_TOKEN: "tk-legado" },
        stub,
      );
      assert(!loja.saida.includes("o ledger não roda para ikcous-publicada"));
      assert(
        stub.chamadas.length >= 1,
        "em loja o ledger chega a consultar a API",
      );
    } finally {
      await stub.parar();
    }
  },
});
