// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * O alvo SAVY EXPLÍCITO (`projeto = savy`, a loja cliente real, projeto Supabase
 * gnjsrucsmjkajijrakzr) nos workflows aplicar-migrations.yml e
 * conferir-banco-da-loja.yml (06/10/2026) — o caminho CENTRAL de banco para a
 * Savy, com as MESMAS travas da CAF explícita (tests/ci_alvo_caf_explicita_test.ts).
 *
 * O QUE ESTES TESTES MEDEM:
 *  - a opção `savy` existe depois de `ikcous-publicada`, o ref é o fixo da Savy e
 *    `loja` / `sandbox` / `ikcous-publicada` ficaram com o mapeamento de antes;
 *  - o PRIMEIRO passo do job (antes do checkout e de qualquer requisição) exige
 *    `expected_sha` de 40 hex igual ao GITHUB_SHA TAMBÉM para `savy` — o bloco
 *    `run:` é EXTRAÍDO do arquivo e rodado com bash, com a mesma mensagem do
 *    publicar-functions.yml;
 *  - o segredo: SÓ o de NOME `SUPABASE_ACCESS_TOKEN_SAVY` para a Savy (sem `||` que
 *    caia no vizinho), e nenhum outro alvo recebe o da Savy — texto do YAML e
 *    comportamento real (script contra servidor stub; `node -e` do aplicar com
 *    `fetch` falso);
 *  - sem o segredo, ou com 401/403 da API: PARA com "sem acesso legítimo à Savy
 *    por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto", sem 2ª requisição e sem
 *    tentar outro segredo nem outro alvo;
 *  - o job do ledger (que grava em schema_migrations) só roda para `savy` com a faixa
 *    92-202 (tests/ci_ledger_do_apply_test.ts); o apply da Savy mexe no ledger só
 *    dentro da transação (INSERT na migration, DELETE no rollback), nunca à parte;
 *  - o envelope REPEATABLE READ com impressão digital, a guarda de BEGIN/COMMIT de
 *    topo e o gate de transporte valem para `savy` (o mesmo código, ref da Savy).
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
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_CAF = "cafkrminfnokvgjqtkle";
const MSG_SEM_ACESSO =
  "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto";
const MSG_SEM_ACESSO_CAF =
  "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto";
const MSG_SHA =
  "Loja cliente (savy) exige expected_sha completo e igual ao GITHUB_SHA do run";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const TRES_SEGREDOS = {
  SUPABASE_ACCESS_TOKEN: "tk-legado",
  SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
  SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
};

const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

/** O arquivo sem as linhas de comentário (os cabeçalhos explicam o que não fazem). */
function semComentarios(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** O corpo do `run: |` do step cujo `name:` contém o trecho (com ou sem aspas). */
function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex(
    (l) => l.includes("name:") && l.includes(nomeDoStep),
  );
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
  Deno.test(`${nome}: a opção savy existe depois de ikcous-publicada (loja e sandbox não mudam) e a descrição diz que é a loja cliente explícita`, async () => {
    const yaml = await Deno.readTextFile(caminho);
    assertStringIncludes(
      yaml,
      "default: loja\n        options:\n          - loja\n          - sandbox\n          - ikcous-publicada\n          - savy\n",
    );
    const iProjeto = yaml.indexOf("\n      projeto:");
    assert(iProjeto >= 0, "falta o input projeto");
    const descricao = yaml.slice(iProjeto, iProjeto + 600);
    assertStringIncludes(descricao, "savy");
    assertStringIncludes(descricao, "expected_sha");
    // o input de sha vale para as duas lojas explícitas
    const iSha = yaml.indexOf("\n      expected_sha:");
    assert(iSha >= 0);
    assertStringIncludes(yaml.slice(iSha, iSha + 400), "savy");
    assertStringIncludes(yaml.slice(iSha, iSha + 400), "required: false");
  });

  Deno.test(`${nome}: a conferência do expected_sha continua o PRIMEIRO passo e agora cobre a savy no mesmo \`if\``, async () => {
    const yaml = semComentarios(await Deno.readTextFile(caminho));
    const j = bloco(yaml, job);
    const passos = j.slice(j.indexOf("    steps:\n") + "    steps:\n".length);
    assert(passos.trimStart().startsWith("- name: Confere o alvo"));
    assert(
      passos.indexOf("Confere o alvo") < passos.indexOf("actions/checkout"),
      "a conferência vem antes do checkout",
    );
    assert(
      !/fetch\(|curl |api\.supabase\.com/.test(
        passos.slice(0, passos.indexOf("actions/checkout")),
      ),
      "nenhum passo antes da conferência faz rede",
    );
    assertStringIncludes(
      blocoRunDoStep(yaml, "Confere o alvo"),
      '"$PROJETO" = "savy"',
    );
  });

  Deno.test({
    name: `${nome}: o passo "Confere o alvo", EXTRAÍDO e rodado em bash — expected_sha de 40 hex igual ao GITHUB_SHA também para savy`,
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
      assertEquals((await rodar("savy", SHA)).codigo, 0, "igual");
      assertEquals(
        (await rodar("savy", SHA.toUpperCase())).codigo,
        0,
        "igual com maiúsculas",
      );
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
        const r = await rodar("savy", esperado);
        assertEquals(r.codigo, 1, `${caso}: ${r.saida}`);
        assertStringIncludes(r.saida, MSG_SHA, caso);
      }
      // a CAF continua com a mesma trava (a mensagem nomeia o projeto)
      const caf = await rodar("ikcous-publicada", "");
      assertEquals(caf.codigo, 1, caf.saida);
      assertStringIncludes(
        caf.saida,
        "Loja cliente (ikcous-publicada) exige expected_sha completo e igual ao GITHUB_SHA do run",
      );
      // loja e sandbox seguem sem exigir nada
      for (const projeto of ["loja", "sandbox"]) {
        assertEquals((await rodar(projeto, "")).codigo, 0, projeto);
        assertEquals((await rodar(projeto, "lixo")).codigo, 0, projeto);
      }
    },
  });

  Deno.test(`${nome}: cada alvo enxerga SÓ o seu segredo — o da Savy só na Savy, o legado nunca na Savy, e nenhum \`||\` cai no vizinho`, async () => {
    const yaml = semComentarios(await Deno.readTextFile(caminho));
    const j = bloco(yaml, job);
    const expressao = (re: RegExp) => [...j.matchAll(re)].map((m) => m[0]);
    const savy = expressao(
      /\$\{\{[^\n]*secrets\.SUPABASE_ACCESS_TOKEN_SAVY[^\n]*/g,
    );
    const legado = expressao(
      /\$\{\{[^\n]*secrets\.SUPABASE_ACCESS_TOKEN(?!_)[^\n]*/g,
    );
    const caf = expressao(
      /\$\{\{[^\n]*secrets\.SUPABASE_ACCESS_TOKEN_IKCOUS[^\n]*/g,
    );
    assert(savy.length >= 1, "falta o segredo da Savy no job");
    assert(legado.length >= 1 && caf.length >= 1);
    for (const l of savy)
      assertEquals(
        l,
        "${{ inputs.projeto == 'savy' && secrets.SUPABASE_ACCESS_TOKEN_SAVY || '' }}",
        "o da Savy só vale na Savy, sem fallback",
      );
    for (const l of legado)
      assertEquals(
        l,
        "${{ inputs.projeto != 'ikcous-publicada' && inputs.projeto != 'savy' && secrets.SUPABASE_ACCESS_TOKEN || '' }}",
        "o legado só vale fora da CAF e da Savy",
      );
    for (const l of caf)
      assertEquals(
        l,
        "${{ inputs.projeto == 'ikcous-publicada' && secrets.SUPABASE_ACCESS_TOKEN_IKCOUS || '' }}",
        "o da CAF só vale na CAF",
      );
    // nenhum segredo cai em outro por `||`, em nenhuma ordem
    assert(
      !/secrets\.SUPABASE_ACCESS_TOKEN\w*\s*\|\|\s*secrets/.test(j),
      "nada de fallback entre os segredos",
    );
    // o segredo da Savy nunca aparece como valor de outra variável de ambiente
    for (const m of j.matchAll(/\n\s+(SUPABASE_ACCESS_TOKEN\w*):[^\n]*/g)) {
      if (m[0].includes("secrets.SUPABASE_ACCESS_TOKEN_SAVY"))
        assertEquals(
          m[1],
          "SUPABASE_ACCESS_TOKEN_SAVY",
          "o segredo da Savy só entra na variável de nome próprio",
        );
    }
  });
}

Deno.test("conferir-banco-da-loja.yml: o passo `Confere o segredo` EXTRAÍDO e rodado em bash — a Savy PARA sem o segredo próprio (nunca o legado nem o da CAF) e os outros alvos nunca usam o da Savy", async () => {
  const yaml = await Deno.readTextFile(CONFERIR);
  const script = blocoRunDoStep(yaml, "Confere o segredo");
  const rodar = (projeto: string, segredos: Record<string, string>) =>
    rodarBash(script, {
      PATH: Deno.env.get("PATH") ?? "",
      PROJETO: projeto,
      SUPABASE_ACCESS_TOKEN: "",
      SUPABASE_ACCESS_TOKEN_IKCOUS: "",
      SUPABASE_ACCESS_TOKEN_SAVY: "",
      ...segredos,
    });
  const ok = await rodar("savy", { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" });
  assertEquals(ok.codigo, 0, ok.saida);
  // sem o da Savy, mesmo com o legado e o da CAF presentes: PARA com o bloqueio concreto
  const sem = await rodar("savy", {
    SUPABASE_ACCESS_TOKEN: "tk-legado",
    SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
  });
  assertEquals(sem.codigo, 1, sem.saida);
  assertStringIncludes(sem.saida, MSG_SEM_ACESSO);
  // o inverso: só o da Savy presente não serve a loja, a sandbox nem a CAF
  for (const projeto of ["loja", "sandbox", "ikcous-publicada"]) {
    const r = await rodar(projeto, { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" });
    assertEquals(r.codigo, 1, `${projeto}: ${r.saida}`);
    assert(
      !r.saida.includes(MSG_SEM_ACESSO),
      `${projeto} não herda a mensagem da Savy`,
    );
  }
  // a CAF mantém a mensagem de antes
  const caf = await rodar("ikcous-publicada", {});
  assertStringIncludes(caf.saida, MSG_SEM_ACESSO_CAF);
});

Deno.test("conferir-banco-da-loja.yml: o job do ledger (que GRAVA em schema_migrations) não roda para savy — salvo a faixa 92-202 (backfill, ver tests/ci_ledger_do_apply_test.ts); aplicar-migrations.yml não tem job de ledger", async () => {
  const yaml = semComentarios(await Deno.readTextFile(CONFERIR));
  const ledger = bloco(yaml, "ledger");
  const linhaIf = ledger
    .split("\n")
    .find((l) => l.trimStart().startsWith("if:"));
  assertStringIncludes(linhaIf, "inputs.projeto != 'savy'");
  assertStringIncludes(linhaIf, "inputs.projeto != 'ikcous-publicada'");
  assertStringIncludes(linhaIf, "inputs.confirmar == 'GRAVAR'");
  // a única exceção: as lojas explícitas só entram no job com a faixa 92-202
  assertStringIncludes(
    linhaIf,
    "((inputs.projeto != 'ikcous-publicada' && inputs.projeto != 'savy' && inputs.gravar_ledger != '92-202') || ((inputs.projeto == 'ikcous-publicada' || inputs.projeto == 'savy') && inputs.gravar_ledger == '92-202'))",
  );
  // nenhum outro job do conferir passa LEDGER
  for (const job of [
    "conferir",
    "verificar-ikcous-original",
    "verificar-ikcous-publicado",
  ]) {
    assert(!/LEDGER/.test(bloco(yaml, job)), `${job} não pode passar LEDGER`);
  }
  // os jobs de pagamentos IKCOUS (original e publicado) não enxergam o da Savy
  for (const job of [
    "verificar-ikcous-original",
    "verificar-ikcous-publicado",
  ]) {
    assert(!bloco(yaml, job).includes("SAVY"), `${job} não vê a Savy`);
  }
  const aplicar = semComentarios(await Deno.readTextFile(APLICAR));
  assert(!/\n {2}ledger:/.test(aplicar));
  // (o apply de MIGRATION registra o ledger na própria transação: um único INSERT)
  assertEquals(
    (aplicar.match(/INSERT INTO supabase_migrations/gi) ?? []).length,
    1,
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
      SUPABASE_ACCESS_TOKEN_SAVY: "",
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
  name: "conferir-banco.cjs: REFS_POR_PROJETO tem exatamente loja, sandbox, ikcous-publicada e savy, com os refs certos; a savy não aceita variações",
  ...SEM_SANITIZAR,
  fn: () => {
    // eslint-disable-next-line security/detect-non-literal-require -- SCRIPT é o caminho fixo de scripts/publicacao/conferir-banco.cjs.
    const { REFS_POR_PROJETO, resolverRef } = require(SCRIPT);
    assertEquals(REFS_POR_PROJETO, {
      loja: REF_CAF,
      sandbox: "lofznuxcvezrhxsgjqyg",
      "ikcous-publicada": REF_CAF,
      savy: REF_SAVY,
    });
    assertEquals(resolverRef("savy"), REF_SAVY);
    for (const ruim of [
      "SAVY",
      "Savy",
      "savy ",
      "savy/restart#",
      `${REF_SAVY}`,
      `${REF_SAVY}/restart#`,
      "x/../gnjsrucsmjkajijrakzr/database/query#",
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
  name: "conferir-banco.cjs na Savy: usa SÓ o segredo SAVY (com o legado e o da CAF no ambiente), no ref da Savy, pelo endpoint só-leitura; loja e CAF não usam o da Savy",
  ...SEM_SANITIZAR,
  fn: async () => {
    const stub = subirStub(201, LINHA_OK);
    try {
      const savy = await rodarScript(
        { PROJETO: "savy", CONSULTA, ...TRES_SEGREDOS },
        stub,
      );
      assertEquals(savy.codigo, 0, savy.saida);
      assertEquals(stub.chamadas.length, 1);
      assertEquals(stub.chamadas[0].auth, "Bearer tk-savy");
      assertEquals(
        stub.chamadas[0].url,
        `/v1/projects/${REF_SAVY}/database/query/read-only`,
      );
      for (const s of ["tk-savy", "tk-legado", "tk-caf"])
        assert(!savy.saida.includes(s), "o segredo não vaza no log");
      // backups também vai pelo segredo e pelo ref da Savy
      const backups = await rodarScript(
        { PROJETO: "savy", CONSULTA: "backups", ...TRES_SEGREDOS },
        stub,
      );
      assert(
        stub.chamadas[1].url === `/v1/projects/${REF_SAVY}/database/backups`,
        `backups: ${stub.chamadas[1]?.url} ${backups.saida}`,
      );
      assertEquals(stub.chamadas[1].auth, "Bearer tk-savy");
      // loja e CAF seguem com os segredos de antes, mesmo com o da Savy presente
      const loja = await rodarScript(
        { PROJETO: "loja", CONSULTA, ...TRES_SEGREDOS },
        stub,
      );
      assertEquals(loja.codigo, 0, loja.saida);
      assertEquals(stub.chamadas[2].auth, "Bearer tk-legado");
      const caf = await rodarScript(
        { PROJETO: "ikcous-publicada", CONSULTA, ...TRES_SEGREDOS },
        stub,
      );
      assertEquals(caf.codigo, 0, caf.saida);
      assertEquals(stub.chamadas[3].auth, "Bearer tk-caf");
    } finally {
      await stub.parar();
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs na Savy: SEM o segredo SAVY PARA com o bloqueio concreto e ZERO requisições (nunca o legado nem o da CAF); loja só com o da Savy também não sai",
  ...SEM_SANITIZAR,
  fn: async () => {
    const stub = subirStub(201, LINHA_OK);
    try {
      const r = await rodarScript(
        {
          PROJETO: "savy",
          CONSULTA,
          SUPABASE_ACCESS_TOKEN: "tk-legado",
          SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
        },
        stub,
      );
      assertEquals(r.codigo, 1, r.saida);
      assertStringIncludes(r.saida, MSG_SEM_ACESSO);
      assert(!r.saida.includes(MSG_SEM_ACESSO_CAF), "não é a mensagem da CAF");
      for (const projeto of ["loja", "sandbox", "ikcous-publicada"]) {
        const inverso = await rodarScript(
          { PROJETO: projeto, CONSULTA, SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" },
          stub,
        );
        assertEquals(inverso.codigo, 1, `${projeto}: ${inverso.saida}`);
      }
      assertEquals(
        stub.chamadas.length,
        0,
        "nenhuma requisição saiu em nenhum caso",
      );
    } finally {
      await stub.parar();
    }
  },
});

for (const status of [401, 403]) {
  Deno.test({
    name: `conferir-banco.cjs na Savy: HTTP ${status} PARA com o bloqueio concreto, UMA requisição, sem tentar outro segredo; a loja não herda a mensagem`,
    ...SEM_SANITIZAR,
    fn: async () => {
      const stub = subirStub(status, '{"message":"forbidden"}');
      try {
        const r = await rodarScript(
          { PROJETO: "savy", CONSULTA, ...TRES_SEGREDOS },
          stub,
        );
        assertEquals(r.codigo, 1, r.saida);
        assertStringIncludes(r.saida, MSG_SEM_ACESSO);
        assertStringIncludes(r.saida, `HTTP ${status}`);
        assertEquals(stub.chamadas.length, 1, "sem retry");
        assertEquals(stub.chamadas[0].auth, "Bearer tk-savy");
        const loja = await rodarScript(
          { PROJETO: "loja", CONSULTA, SUPABASE_ACCESS_TOKEN: "tk-legado" },
          stub,
        );
        assertEquals(loja.codigo, 1);
        assert(!loja.saida.includes(MSG_SEM_ACESSO));
        assertStringIncludes(loja.saida, `HTTP ${status}`);
      } finally {
        await stub.parar();
      }
    },
  });
}

Deno.test({
  name: "conferir-banco.cjs na Savy: LEDGER é recusado ANTES de qualquer requisição, em todas as faixas (o ledger não roda para savy)",
  ...SEM_SANITIZAR,
  fn: async () => {
    const stub = subirStub(201, LINHA_OK);
    try {
      for (const faixa of ["72-74", "75-78", "79-82", "83"]) {
        const r = await rodarScript(
          { PROJETO: "savy", LEDGER: faixa, ...TRES_SEGREDOS },
          stub,
        );
        assertEquals(r.codigo, 1, r.saida);
        assertStringIncludes(r.saida, "o ledger não roda para savy");
      }
      assertEquals(stub.chamadas.length, 0);
      // controle: em `loja` o ledger continua alcançável (a recusa é só das lojas explícitas)
      const loja = await rodarScript(
        { PROJETO: "loja", LEDGER: "83", SUPABASE_ACCESS_TOKEN: "tk-legado" },
        stub,
      );
      assert(!loja.saida.includes("o ledger não roda para savy"));
      assert(
        stub.chamadas.length >= 1,
        "em loja o ledger chega a consultar a API",
      );
    } finally {
      await stub.parar();
    }
  },
});

// ---------------------------------------------------------------------------
// aplicar-migrations.yml: o `node -e` INTEIRO é extraído (desfazendo os escapes do
// bash) e executado aqui com um `fetch` falso — nada de rede. O mesmo método de
// tests/ci_aplicar_migrations_test.ts, com o ref esperado parametrizado.
// ---------------------------------------------------------------------------
const requireLocal = createRequire(import.meta.url);

function argumentoDoNodeE(blocoRun: string): string {
  const linhas = blocoRun.split("\n");
  const iAbre = linhas.findIndex((l) => /^\s*node -e "\s*$/.test(l));
  assert(iAbre >= 0, 'abertura `node -e "` não achada no step');
  const iFecha = linhas.findIndex((l, i) => i > iAbre && /^\s*"\s*$/.test(l));
  assert(iFecha > iAbre, 'fechamento `"` do node -e não achado');
  return linhas.slice(iAbre + 1, iFecha).join("\n");
}

/** Desfaz o ÚNICO escape que o bash faz dentro de aspas duplas. */
function desescaparBash(js: string): string {
  return js.replace(/\\([\\$"`])/g, "$1");
}

type Resposta = { status?: number; corpo?: string; lancar?: Error };

const SONDA = JSON.stringify([
  {
    sonda1: JSON.stringify({
      isolamento: "repeatable read",
      somente_leitura: "on",
      pid: 123,
      agora: "2026-10-06 18:00:00+00",
      relogio: 1000.0,
    }),
    sonda2: JSON.stringify({
      isolamento: "repeatable read",
      somente_leitura: "on",
      pid: 123,
      agora: "2026-10-06 18:00:00+00",
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

function respostaSaudavel(q: string): Resposta {
  if (q.includes("ikcous.sonda1")) return { corpo: SONDA };
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

type Opcoes = {
  /** substitui o `node:fs` visto pelo script (corpo de migration sintético) */
  fsFalso?: Record<string, string>;
};

async function rodarAplicar(
  migracoes: string,
  responder: (q: string, i: number) => Resposta,
  projeto: string,
  segredos: Record<string, string>,
  refEsperado: string,
  opcoes: Opcoes = {},
) {
  const yaml = await Deno.readTextFile(APLICAR);
  const codigo = desescaparBash(
    argumentoDoNodeE(blocoRunDoStep(yaml, "Prova, apply e verificação")),
  );
  const chamadas: string[] = [];
  const autorizacoes: string[] = [];
  const urls: string[] = [];
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
    assertStringIncludes(url, `/v1/projects/${refEsperado}/database/query`);
    const query = JSON.parse(init.body).query;
    chamadas.push(query);
    urls.push(url);
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
    const reqLocal = (p: string) => {
      if (p === "node:fs" && opcoes.fsFalso) {
        const real = requireLocal("node:fs");
        return {
          ...real,
          existsSync: (c: string) =>
            Object.keys(opcoes.fsFalso).some((k) => String(c).endsWith(k)) ||
            real.existsSync(c),
          readFileSync: (c: string, enc?: string) => {
            const k = Object.keys(opcoes.fsFalso).find((x) =>
              String(c).endsWith(x),
            );
            return k ? opcoes.fsFalso[k] : real.readFileSync(c, enc);
          },
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
      urls,
      saida,
      texto: saida.join("\n"),
    };
  } finally {
    Deno.chdir(antes);
  }
}

const M201 = "20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const RB201 =
  "rollback-manual-20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const ENVELOPE = "BEGIN ISOLATION LEVEL REPEATABLE READ;\n";

Deno.test("aplicar-migrations.yml: o mapeamento de loja, sandbox e ikcous-publicada é byte a byte o de antes e a savy aponta para o ref fixo da Savy", async () => {
  const yaml = await Deno.readTextFile(APLICAR);
  assertStringIncludes(
    yaml,
    "const REFS = { loja: 'cafkrminfnokvgjqtkle', sandbox: 'lofznuxcvezrhxsgjqyg', 'ikcous-publicada': 'cafkrminfnokvgjqtkle', savy: 'gnjsrucsmjkajijrakzr' };",
  );
});

Deno.test({
  name: "aplicar savy: com os três segredos no ambiente usa SÓ o da Savy em TODA requisição, sempre no ref da Savy; loja, sandbox e CAF não usam o da Savy",
  ...SEM_SANITIZAR,
  fn: async () => {
    const savy = await rodarAplicar(
      "",
      respostaSaudavel,
      "savy",
      // o workflow zera o legado e o da CAF na Savy, mas o script não deve depender disso:
      TRES_SEGREDOS,
      REF_SAVY,
    );
    assertEquals(savy.fim, true, savy.texto);
    assertEquals(savy.chamadas.length, 3, "gate, registro e fingerprint");
    assert(
      savy.autorizacoes.every((a) => a === "Bearer tk-savy"),
      `Savy: todo pedido leva o segredo SAVY: ${savy.autorizacoes}`,
    );
    assert(
      savy.urls.every((u) =>
        u.startsWith(
          `https://api.supabase.com/v1/projects/${REF_SAVY}/database/query`,
        ),
      ),
    );
    for (const s of ["tk-savy", "tk-legado", "tk-caf"])
      assert(!savy.texto.includes(s), "nenhum segredo no log");
    // o gate de transporte rodou primeiro, antes de qualquer outra coisa
    assertStringIncludes(
      savy.chamadas[0],
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    );
    assertStringIncludes(savy.texto, "GATE DE TRANSPORTE OK");
    for (const [projeto, esperado, ref] of [
      ["loja", "tk-legado", REF_CAF],
      ["sandbox", "tk-legado", "lofznuxcvezrhxsgjqyg"],
      ["ikcous-publicada", "tk-caf", REF_CAF],
    ]) {
      const r = await rodarAplicar(
        "",
        respostaSaudavel,
        projeto,
        TRES_SEGREDOS,
        ref,
      );
      assertEquals(r.fim, true, `${projeto}: ${r.texto}`);
      assert(
        r.autorizacoes.every((a) => a === `Bearer ${esperado}`),
        `${projeto}: segredo de antes, nunca o da Savy: ${r.autorizacoes}`,
      );
    }
  },
});

Deno.test({
  name: "aplicar savy: SEM o segredo SAVY PARA com o bloqueio concreto e ZERO requisições (nunca o legado nem o da CAF); loja só com o da Savy também não sai",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const segredos of [
      {
        SUPABASE_ACCESS_TOKEN: "tk-legado",
        SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
      },
      { ...TRES_SEGREDOS, SUPABASE_ACCESS_TOKEN_SAVY: "" },
    ]) {
      const r = await rodarAplicar(
        M201,
        respostaSaudavel,
        "savy",
        segredos,
        REF_SAVY,
      );
      assertEquals(r.exit, 1, r.texto);
      assertEquals(r.chamadas.length, 0, "sem segredo próprio nada sai");
      assertStringIncludes(r.texto, MSG_SEM_ACESSO);
      assert(!r.texto.includes(MSG_SEM_ACESSO_CAF));
    }
    for (const [projeto, ref] of [
      ["loja", REF_CAF],
      ["sandbox", "lofznuxcvezrhxsgjqyg"],
      ["ikcous-publicada", REF_CAF],
    ]) {
      const inverso = await rodarAplicar(
        "",
        respostaSaudavel,
        projeto,
        { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" },
        ref,
      );
      assertEquals(inverso.exit, 1, `${projeto}: ${inverso.texto}`);
      assertEquals(
        inverso.chamadas.length,
        0,
        `${projeto}: o da Savy não serve`,
      );
    }
  },
});

Deno.test({
  name: "aplicar savy: 401/403 PARA — no gate (1 requisição) e no apply (ESTADO DESCONHECIDO + bloqueio, 1 única requisição de apply, sem ROLLBACK paralelo, sem outro segredo)",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const status of [401, 403]) {
      const gate = await rodarAplicar(
        M201,
        () => ({ status, corpo: "denied" }),
        "savy",
        TRES_SEGREDOS,
        REF_SAVY,
      );
      assertEquals(gate.exit, 1, gate.texto);
      assertEquals(gate.chamadas.length, 1, `${status} no gate: nada mais sai`);
      assertStringIncludes(gate.texto, MSG_SEM_ACESSO);
      assertStringIncludes(gate.texto, `HTTP ${status}`);
      assert(gate.autorizacoes.every((a) => a === "Bearer tk-savy"));

      const apply = await rodarAplicar(
        M201,
        (q) =>
          q.startsWith(ENVELOPE) &&
          q.includes("ALTER COLUMN criada_sob_autorizacao")
            ? { status, corpo: "denied" }
            : respostaSaudavel(q),
        "savy",
        TRES_SEGREDOS,
        REF_SAVY,
      );
      assertEquals(apply.exit, 1, apply.texto);
      assertStringIncludes(apply.texto, MSG_SEM_ACESSO);
      assertStringIncludes(apply.texto, "ESTADO DESCONHECIDO");
      assertEquals(
        apply.chamadas.filter(
          (q) =>
            q.startsWith(ENVELOPE) &&
            q.includes("ALTER COLUMN criada_sob_autorizacao"),
        ).length,
        1,
        "uma única requisição de apply, sem retry",
      );
      assert(!apply.chamadas.some((q) => q.trim() === "ROLLBACK;"));
      assert(apply.autorizacoes.every((a) => a === "Bearer tk-savy"));
    }
  },
});

Deno.test({
  name: "aplicar savy: o apply de uma migration passa pelo MESMO envelope (gate -> fingerprint -> PROVA BEGIN…ROLLBACK -> UM apply REPEATABLE READ com impressão digital -> leitura fresca) e mexe no ledger só dentro da transação (migration INSERT, rollback-manual DELETE)",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const arquivo of [M201, RB201]) {
      const corpo = await Deno.readTextFile(
        join(RAIZ, "supabase/migrations", arquivo),
      );
      const r = await rodarAplicar(
        arquivo,
        respostaSaudavel,
        "savy",
        TRES_SEGREDOS,
        REF_SAVY,
      );
      assertEquals(r.fim, true, r.texto);
      const prova = r.chamadas.filter((q) => q.startsWith("BEGIN;\n"));
      const apply = r.chamadas.filter((q) => q.startsWith(ENVELOPE));
      assertEquals(prova.length, 1, "uma prova");
      assertEquals(apply.length, 1, "um apply");
      assert(prova[0].endsWith("\nROLLBACK;"));
      assertStringIncludes(prova[0], corpo);
      assertStringIncludes(apply[0], corpo);
      assertStringIncludes(apply[0], "FP_DIVERGIU");
      assert(apply[0].trimEnd().endsWith("COMMIT;"));
      assertStringIncludes(r.texto, "FP_ANTES");
      assertStringIncludes(r.texto, "FP_DEPOIS");
      assert(
        r.chamadas.indexOf(prova[0]) < r.chamadas.indexOf(apply[0]),
        "a prova vem antes do apply",
      );
      // o ledger: a migration se registra e o rollback-manual apaga a linha, na
      // própria transação (prova e apply); nenhuma requisição à parte toca o ledger
      const tocaLedger = r.chamadas.filter((q) =>
        /schema_migrations/i.test(q.replace(corpo, "")),
      );
      assertEquals(
        tocaLedger,
        [prova[0], apply[0]],
        "só a prova e o apply levam o INSERT (migration) ou o DELETE (rollback) do ledger",
      );
    }
  },
});

Deno.test({
  name: "aplicar savy: a guarda de controle de transação de topo vale para a Savy — COMMIT/BEGIN/ROLLBACK no arquivo recusam ANTES de qualquer requisição; SAVEPOINT passa",
  ...SEM_SANITIZAR,
  fn: async () => {
    const nome = "20261299000000_teste_controle_de_transacao.sql";
    for (const corpo of [
      "SELECT 1;\nCOMMIT;\nSELECT 2;",
      "BEGIN;\nSELECT 1;\n",
      "SELECT 1;\nROLLBACK;\n",
      "/* nota */ -- x\nEND;\nSELECT 1;",
    ]) {
      const r = await rodarAplicar(
        nome,
        respostaSaudavel,
        "savy",
        TRES_SEGREDOS,
        REF_SAVY,
        { fsFalso: { [nome]: corpo } },
      );
      assertEquals(r.exit, 1, `${JSON.stringify(corpo)}: ${r.texto}`);
      assertEquals(r.chamadas.length, 0, "recusa antes da rede");
      assertStringIncludes(r.texto, "RECUSADO (controle de transacao no topo");
    }
    // sem ponto e vírgula final o envelope perderia o primeiro comando da conferência
    const semPontoEVirgula = await rodarAplicar(
      nome,
      respostaSaudavel,
      "savy",
      TRES_SEGREDOS,
      REF_SAVY,
      { fsFalso: { [nome]: "SELECT 1" } },
    );
    assertEquals(semPontoEVirgula.exit, 1);
    assertEquals(semPontoEVirgula.chamadas.length, 0);
    assertStringIncludes(semPontoEVirgula.texto, "termina sem ponto e virgula");
    // controle: SAVEPOINT/RELEASE não encerram a transação — passam
    const savepoint = await rodarAplicar(
      nome,
      respostaSaudavel,
      "savy",
      TRES_SEGREDOS,
      REF_SAVY,
      { fsFalso: { [nome]: "SAVEPOINT a;\nSELECT 1;\nRELEASE a;\n" } },
    );
    assertEquals(savepoint.fim, true, savepoint.texto);
  },
});

Deno.test({
  name: "aplicar savy: o gate de transporte reprovado PARA tudo na Savy — o envelope não roda, só uma requisição saiu",
  ...SEM_SANITIZAR,
  fn: async () => {
    const r = await rodarAplicar(
      M201,
      () => ({
        corpo: SONDA.replace("repeatable read", "read committed"),
      }),
      "savy",
      TRES_SEGREDOS,
      REF_SAVY,
    );
    assertEquals(r.exit, 1, r.texto);
    assertEquals(r.chamadas.length, 1);
    assertStringIncludes(r.texto, "GATE DE TRANSPORTE REPROVADO");
  },
});
