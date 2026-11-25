// @ts-nocheck
/* eslint-disable security/detect-non-literal-fs-filename -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste, nunca de entrada externa. */
/**
 * Bordas de scripts/db-check-objetos-do-codigo.mjs que o teste vizinho
 * (db_check_objetos_do_codigo_test.ts) deixava passar — achadas por mutação
 * (trocar uma linha do detector e ver se algum teste reclamava).
 *
 * O detector é um PORTÃO de CI ("o código chama um objeto que o banco não
 * tem"). O vizinho prova a avaliação com catálogo semeado, mas:
 *   - nunca executava o `main()` — então `process.exit(1)` virar `exit(0)`, o
 *     "INERTE sem token" virar vermelho ou o `.env.local` ser lido errado não
 *     reprovava teste nenhum;
 *   - nunca varria uma árvore de verdade (`extrairDoRepo`): ignorar
 *     `node_modules`, arquivos de teste e extensões estranhas era só comentário;
 *   - não pinava a janela de 30 caracteres que separa `.storage.from` (bucket)
 *     de `.from` (tabela), nem as âncoras dos regex de projeto.
 *
 * Parte 1 é em processo (funções exportadas). Parte 2 copia o script para uma
 * raiz descartável (ele deduz a raiz de import.meta.url) e o executa como
 * programa, com `fetch` trocado por um PRELOAD que devolve o catálogo
 * semeado — nenhuma rede, nenhum banco, nenhum token de verdade.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avaliar,
  conferirProjeto,
  extrairDeConteudo,
  extrairDoRepo,
  formatar,
  formatarDinamicas,
  lerCatalogoPelaApi,
  refDoProjeto,
} from "../scripts/db-check-objetos-do-codigo.mjs";

const SCRIPT = new URL(
  "../scripts/db-check-objetos-do-codigo.mjs",
  import.meta.url,
);
const REF = "abcdefghijklmnopqrst";
const OUTRO = "tsrqponmlkjihgfedcba";

// ---------------------------------------------------------------------------
// extrairDeConteudo — janela de 30 caracteres, âncora e número de linha
// ---------------------------------------------------------------------------

const PREFIXO_LONGO = "const cliente = await supabase.storage"; // > 30 chars antes de `.from(`

Deno.test("bucket: `storage` + 23 espaços/quebras antes do `.from(` ainda é BUCKET (cabe na janela de 30)", () => {
  const codigo = `${PREFIXO_LONGO}${" ".repeat(23)}.from("avatars")`;
  const a = extrairDeConteudo(codigo, "src/x.ts");
  assertEquals(
    a.bucket.map((r) => r.nome),
    ["avatars"],
  );
  assertEquals(a.from, []);
});

Deno.test("bucket: com 24 espaços o `storage` já saiu da janela — vira TABELA (a janela é exatamente 30)", () => {
  const codigo = `${PREFIXO_LONGO}${" ".repeat(24)}.from("avatars")`;
  const a = extrairDeConteudo(codigo, "src/x.ts");
  assertEquals(
    a.from.map((r) => r.nome),
    ["avatars"],
  );
  assertEquals(a.bucket, []);
});

Deno.test("bucket: `storage.from` logo no INÍCIO do arquivo (menos de 30 caracteres antes) é bucket", () => {
  const a = extrairDeConteudo('storage.from("avatars")', "src/x.ts");
  assertEquals(
    a.bucket.map((r) => r.nome),
    ["avatars"],
  );
  assertEquals(a.from, []);
});

Deno.test("bucket: `storage` no MEIO do que vem antes não basta — tem de ser a palavra imediatamente anterior", () => {
  const a = extrairDeConteudo(
    'const storageX = 1; supabase.from("produtos")',
    "src/x.ts",
  );
  assertEquals(
    a.from.map((r) => r.nome),
    ["produtos"],
  );
  assertEquals(a.bucket, []);
});

Deno.test("`.from(variavel)` depois de storage: mesma janela — 23 some do relatório, 24 vira dinâmica", () => {
  const dentro = extrairDeConteudo(
    `${PREFIXO_LONGO}${" ".repeat(23)}.from(nomeDoBucket)`,
    "src/x.ts",
  );
  assertEquals(dentro.dinamicas, []);
  const fora = extrairDeConteudo(
    `${PREFIXO_LONGO}${" ".repeat(24)}.from(nomeDoBucket)`,
    "src/x.ts",
  );
  assertEquals(fora.dinamicas.length, 1);
  assertEquals(fora.dinamicas[0].nome, "nomeDoBucket");
  assertEquals(fora.dinamicas[0].chamada, "from");
});

Deno.test("`.from(variavel)` colado no começo do arquivo, depois de storage, também some do relatório", () => {
  assertEquals(
    extrairDeConteudo("storage.from(bucket)", "src/x.ts").dinamicas,
    [],
  );
});

Deno.test("`.from(variavel)` com `storage` só como parte de outro nome NÃO some do relatório", () => {
  const a = extrairDeConteudo(
    "const storageX = 1; supabase.from(tabela)",
    "src/x.ts",
  );
  assertEquals(
    a.dinamicas.map((d) => d.nome),
    ["tabela"],
  );
});

Deno.test("`.rpc(variavel)` é dinâmica com chamada 'rpc' e aponta a linha", () => {
  const a = extrairDeConteudo(
    "\n\nawait supabase.rpc(nomeDaFuncao, {})",
    "src/y.ts",
  );
  assertEquals(a.dinamicas, [
    { nome: "nomeDaFuncao", onde: "src/y.ts:3", chamada: "rpc" },
  ]);
});

Deno.test("a linha reportada conta TODAS as quebras antes da chamada (começando em 1)", () => {
  const a = extrairDeConteudo(
    '\n\nsupabase.from("a")\nsupabase.rpc("b")',
    "src/z.ts",
  );
  assertEquals(a.from[0].onde, "src/z.ts:3");
  assertEquals(a.rpc[0].onde, "src/z.ts:4");
  const crlf = extrairDeConteudo('\r\n\r\nsupabase.from("a")', "src/z.ts");
  assertEquals(crlf.from[0].onde, "src/z.ts:3");
});

// ---------------------------------------------------------------------------
// extrairDoRepo — o que é varrido
// ---------------------------------------------------------------------------

function montaArvore(arquivos: Record<string, string>) {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "h36-dbcheck-")));
  for (const [relativo, texto] of Object.entries(arquivos)) {
    const alvo = join(raiz, relativo);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, texto);
  }
  return raiz;
}

const norm = (s: string) => s.replaceAll("\\", "/");

Deno.test("extrairDoRepo varre src/ (anon/authenticated) e supabase/functions/ (service_role), só das extensões de código", () => {
  const raiz = montaArvore({
    "src/a.ts": 'x.from("t_ts")',
    "src/pasta/fundo/b.tsx": 'x.from("t_tsx")',
    "src/c.js": 'x.from("t_js")',
    "src/d.jsx": 'x.from("t_jsx")',
    "src/e.deno": 'x.from("t_deno")',
    "supabase/functions/f/index.ts": 'x.rpc("fn_edge")',
    // NÃO entram:
    "src/notas.md": 'x.from("t_md")',
    "src/c.ts.bak": 'x.from("t_bak")',
    "src/semextensao": 'x.from("t_sem")',
    "src/a.test.ts": 'x.from("t_teste_ponto")',
    "src/b_test.ts": 'x.from("t_teste_underscore")',
    "src/node_modules/pacote/index.ts": 'x.from("t_node_modules")',
    "src/.git/hook.ts": 'x.from("t_git")',
    "supabase/migrations/mig.ts": 'x.from("t_migrations")',
    "supabase/functions/node_modules/z.ts": 'x.from("t_node_modules_edge")',
    "outra/fora.ts": 'x.from("t_fora")',
  });
  try {
    const { referencias, dinamicas } = extrairDoRepo(raiz);
    const lista = referencias
      .map((r) => ({
        tipo: r.tipo,
        nome: r.nome,
        onde: norm(r.onde),
        papeis: r.papeis,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    assertEquals(
      lista,
      [
        {
          tipo: "from",
          nome: "t_deno",
          onde: "src/e.deno:1",
          papeis: ["anon", "authenticated"],
        },
        {
          tipo: "from",
          nome: "t_js",
          onde: "src/c.js:1",
          papeis: ["anon", "authenticated"],
        },
        {
          tipo: "from",
          nome: "t_jsx",
          onde: "src/d.jsx:1",
          papeis: ["anon", "authenticated"],
        },
        {
          tipo: "from",
          nome: "t_ts",
          onde: "src/a.ts:1",
          papeis: ["anon", "authenticated"],
        },
        {
          tipo: "from",
          nome: "t_tsx",
          onde: "src/pasta/fundo/b.tsx:1",
          papeis: ["anon", "authenticated"],
        },
        {
          tipo: "rpc",
          nome: "fn_edge",
          onde: "supabase/functions/f/index.ts:1",
          papeis: ["service_role"],
        },
      ].sort((a, b) => a.nome.localeCompare(b.nome)),
    );
    assertEquals(dinamicas, []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

Deno.test("extrairDoRepo junta as referências DINÂMICAS de todos os arquivos", () => {
  const raiz = montaArvore({
    "src/a.ts": "x.rpc(variavelA)",
    "supabase/functions/f/index.ts": "x.from(variavelB)",
  });
  try {
    const { dinamicas } = extrairDoRepo(raiz);
    assertEquals(
      dinamicas.map((d) => `${d.nome}:${d.chamada}:${norm(d.onde)}`).sort(),
      [
        "variavelA:rpc:src/a.ts:1",
        "variavelB:from:supabase/functions/f/index.ts:1",
      ],
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

Deno.test("extrairDoRepo: raiz sem src/ nem supabase/functions/ devolve listas vazias (sem lançar)", () => {
  const raiz = montaArvore({ "LEIA.md": "nada" });
  try {
    assertEquals(extrairDoRepo(raiz), { referencias: [], dinamicas: [] });
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// avaliar / formatar — o texto que quem lê o relatório vê
// ---------------------------------------------------------------------------

Deno.test("avaliar: o objeto de uma INALCANÇÁVEL diz 'tabela/view' para from e 'função' para rpc, e o motivo SELECT/EXECUTE", () => {
  const catalogo = {
    relacoes: new Map([["trancada", new Set()]]),
    funcoes: new Map([["fechada", new Set()]]),
    buckets: new Set(),
  };
  const r = avaliar(
    [
      {
        tipo: "from",
        nome: "trancada",
        onde: "src/a.ts:1",
        papeis: ["anon", "authenticated"],
      },
      {
        tipo: "rpc",
        nome: "fechada",
        onde: "supabase/functions/f/index.ts:2",
        papeis: ["service_role"],
      },
    ],
    catalogo,
  );
  assertEquals(r.ausentes, []);
  assertEquals(
    r.inalcançaveis.map((i) => [i.objeto, i.detalhe]),
    [
      [
        "tabela/view",
        "existe, mas nenhum papel desta origem (anon/authenticated) tem SELECT",
      ],
      [
        "função",
        "existe, mas nenhum papel desta origem (service_role) tem EXECUTE",
      ],
    ],
  );
});

Deno.test("avaliar: o objeto de uma AUSENTE diz 'tabela/view' para from, 'função' para rpc e 'bucket de storage' para bucket", () => {
  const catalogo = {
    relacoes: new Map(),
    funcoes: new Map(),
    buckets: new Set(),
  };
  const r = avaliar(
    [
      { tipo: "from", nome: "a", onde: "x:1", papeis: ["anon"] },
      { tipo: "rpc", nome: "b", onde: "x:2", papeis: ["anon"] },
      { tipo: "bucket", nome: "c", onde: "x:3", papeis: ["anon"] },
    ],
    catalogo,
  );
  assertEquals(
    r.ausentes.map((a) => a.objeto),
    ["tabela/view", "função", "bucket de storage"],
  );
});

Deno.test("formatar: cabeçalhos exatos de AUSENTE e INALCANÇÁVEL, uma linha por objeto", () => {
  const texto = formatar({
    ausentes: [
      { objeto: "tabela/view", nome: "vw_sumida", onde: "src/a.ts:7" },
    ],
    inalcançaveis: [
      {
        objeto: "função",
        nome: "fechada",
        onde: "src/b.ts:9",
        detalhe:
          "existe, mas nenhum papel desta origem (anon/authenticated) tem EXECUTE",
      },
    ],
  });
  assertEquals(
    texto,
    [
      "AUSENTE — o código usa e o banco NÃO TEM (o caso da view sumida #139):",
      '  - tabela/view "vw_sumida" usada em src/a.ts:7',
      "INALCANÇÁVEL — existe, mas nenhum papel do app alcança (defeito de GRANT, correção diferente):",
      '  - função "fechada" usada em src/b.ts:9 — existe, mas nenhum papel desta origem (anon/authenticated) tem EXECUTE',
    ].join("\n"),
  );
  assertEquals(formatar({ ausentes: [], inalcançaveis: [] }), "");
});

Deno.test("formatarDinamicas: vazio e null não imprimem nada; com itens, conta e lista cada linha", () => {
  assertEquals(formatarDinamicas([]), "");
  assertEquals(formatarDinamicas(null), "");
  assertEquals(formatarDinamicas(undefined), "");
  assertEquals(
    formatarDinamicas([
      { nome: "variavelA", onde: "src/a.ts:3", chamada: "rpc" },
      { nome: "tabelaB", onde: "src/b.ts:5", chamada: "from" },
    ]),
    [
      "FORA DA AUDITORIA — .rpc/.from com nome em VARIÁVEL (2; o detector não faz análise de fluxo, então estas linhas ficam sem conferência):",
      "  - .rpc(variavelA, …) em src/a.ts:3",
      "  - .from(tabelaB, …) em src/b.ts:5",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// refDoProjeto / conferirProjeto / validação do ref da API
// ---------------------------------------------------------------------------

Deno.test("refDoProjeto: o host direto tem de COMEÇAR em db. (um prefixo antes do `db.` não vale)", () => {
  assertEquals(
    refDoProjeto(`postgres://postgres@x.db.${REF}.supabase.co:5432/postgres`),
    null,
  );
  assertEquals(
    refDoProjeto(`postgres://postgres@db.${REF}.supabase.co:5432/postgres`),
    REF,
  );
});

Deno.test("refDoProjeto: usuário do pooler tem de TERMINAR em .<ref de 20> (sobra depois do ref não vale)", () => {
  assertEquals(
    refDoProjeto(
      `postgres://postgres.${REF}zz@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
    ),
    null,
  );
  assertEquals(
    refDoProjeto(
      `postgres://postgres.${REF}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
    ),
    REF,
  );
  // 19 caracteres depois do ponto: curto demais.
  assertEquals(
    refDoProjeto(
      `postgres://postgres.${REF.slice(1)}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
    ),
    null,
  );
});

Deno.test("conferirProjeto: a mensagem de reprovação é exatamente a que o CI mostra", () => {
  assertEquals(conferirProjeto(REF, REF), { ok: true, mensagem: "" });
  assertEquals(conferirProjeto(OUTRO, REF), {
    ok: false,
    mensagem: `::error::DATABASE_URL aponta para o projeto ${OUTRO}, mas o esperado é ${REF} — este detector compararia o código com o BANCO ERRADO (a mesma classe de falha que deixou vw_produtos_admin sumida sem reprovar o PR, #139). Aponte o secret DATABASE_URL para o projeto certo antes de rodar de novo.`,
  });
  assertStringIncludes(
    conferirProjeto(null, REF).mensagem,
    "aponta para o projeto não identificado,",
  );
});

Deno.test("lerCatalogoPelaApi: ref tem de ser EXATAMENTE 20 letras minúsculas — e a mensagem diz isso", async () => {
  let chamou = 0;
  const fetchImpl = () => {
    chamou++;
    throw new Error("não podia chamar a rede");
  };
  const invalidos = [
    REF.slice(1), // 19
    `${REF}u`, // 21
    REF.toUpperCase(),
    `9${REF.slice(1)}`, // dígito na frente
    `${REF.slice(0, 19)}9`, // dígito no fim
    `9${REF}`,
    `${REF}9`,
    "",
    undefined,
    null,
  ];
  for (const ref of invalidos) {
    let msg = "";
    try {
      await lerCatalogoPelaApi({ token: "tok", ref, fetchImpl });
    } catch (e) {
      msg = e.message;
    }
    assertEquals(
      msg,
      "SUPABASE_PROJECT_REF inválido (esperado: 20 letras minúsculas).",
      String(ref),
    );
  }
  assertEquals(chamou, 0);
});

Deno.test("lerCatalogoPelaApi: token vazio é recusado com a mensagem própria, antes de qualquer chamada", async () => {
  let msg = "";
  try {
    await lerCatalogoPelaApi({
      token: "",
      ref: REF,
      fetchImpl: () => {
        throw new Error("não podia chamar a rede");
      },
    });
  } catch (e) {
    msg = e.message;
  }
  assertEquals(msg, "SUPABASE_ACCESS_TOKEN vazio.");
});

// ---------------------------------------------------------------------------
// PARTE 2 — o programa inteiro (main), com fetch semeado por preload
// ---------------------------------------------------------------------------

const PRELOAD = `
const c = JSON.parse(process.env.H36_CENARIO);
globalThis.fetch = async (url, opcoes) => {
  const { query } = JSON.parse(opcoes.body);
  const resposta = (linhas) => ({ ok: true, status: 200, text: async () => JSON.stringify(linhas) });
  if (query.includes("pg_class")) return resposta(c.relacoes);
  if (query.includes("pg_proc")) return resposta(c.funcoes);
  if (query.includes("storage.buckets")) {
    if (c.buckets === null) return { ok: false, status: 500, text: async () => "" };
    return resposta(c.buckets);
  }
  return { ok: false, status: 400, text: async () => "" };
};
`;

type Linha = {
  nome: string;
  anon?: boolean;
  authenticated?: boolean;
  service_role?: boolean;
};
type Cenario = {
  arquivos: Record<string, string>;
  relacoes?: Linha[];
  funcoes?: Linha[];
  buckets?: Array<{ id: string }> | null;
  env?: Record<string, string>;
  args?: string[];
  semPreload?: boolean;
};

async function roda(c: Cenario) {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "h36-dbcheck-main-")));
  try {
    mkdirSync(join(raiz, "scripts"), { recursive: true });
    writeFileSync(
      join(raiz, "scripts", "db-check-objetos-do-codigo.mjs"),
      readFileSync(SCRIPT),
    );
    for (const [relativo, texto] of Object.entries(c.arquivos)) {
      const alvo = join(raiz, relativo);
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, texto);
    }
    writeFileSync(join(raiz, "preload.mjs"), PRELOAD);
    const cenario = {
      relacoes: c.relacoes ?? [],
      funcoes: c.funcoes ?? [],
      buckets: c.buckets === undefined ? [] : c.buckets,
    };
    const saida = await new Deno.Command("node", {
      args: [
        "--import",
        pathToFileURL(join(raiz, "preload.mjs")).href,
        ...(c.args ?? [
          join(raiz, "scripts", "db-check-objetos-do-codigo.mjs"),
        ]),
      ],
      cwd: raiz,
      clearEnv: true,
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        SystemRoot: Deno.env.get("SystemRoot") ?? "",
        H36_CENARIO: JSON.stringify(cenario),
        ...(c.env ?? {}),
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    return {
      code: saida.code,
      stdout: dec.decode(saida.stdout),
      stderr: dec.decode(saida.stderr),
    };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

const VIA_API = {
  SUPABASE_PROJECT_REF: REF,
  SUPABASE_ACCESS_TOKEN: "token-de-teste-h36",
};

const ARQUIVOS_OK = {
  "src/a.ts": 'x.from("produtos")\nx.rpc("confirmar")',
  "supabase/functions/f/index.ts": 'x.from("pedidos")',
};
const CATALOGO_OK = {
  relacoes: [
    { nome: "produtos", anon: true },
    { nome: "pedidos", service_role: true },
    { nome: "extra", anon: true },
  ],
  funcoes: [{ nome: "confirmar", authenticated: true }],
};

Deno.test("main/API: tudo existe e é alcançável — exit 0, contagens exatas e a frase de aprovação", async () => {
  const r = await roda({ arquivos: ARQUIVOS_OK, ...CATALOGO_OK, env: VIA_API });
  assertEquals(r.code, 0, r.stderr + r.stdout);
  assertStringIncludes(
    r.stdout,
    "Catálogo lido pela API de gestão do Supabase, endpoint somente leitura.",
  );
  assertStringIncludes(
    r.stdout,
    "Referências literais no código: 3 (3 objetos únicos) — 3 relações e 1 funções no catálogo public.",
  );
  assertStringIncludes(
    r.stdout,
    "TODAS as referências do código existem e são alcançáveis.",
  );
  assert(!r.stdout.includes("FORA DA AUDITORIA"), r.stdout);
  assert(!r.stderr.includes("::warning::"), r.stderr);
});

Deno.test("main/API: objeto AUSENTE reprova (exit 1) e aparece no relatório com arquivo:linha", async () => {
  const r = await roda({
    arquivos: { "src/a.ts": '\nx.from("vw_sumida")' },
    relacoes: [{ nome: "produtos", anon: true }],
    env: VIA_API,
  });
  assertEquals(r.code, 1, r.stderr);
  assertStringIncludes(r.stdout, "AUSENTE — o código usa e o banco NÃO TEM");
  assert(
    r.stdout
      .replaceAll("\\", "/")
      .includes('tabela/view "vw_sumida" usada em src/a.ts:2'),
    r.stdout,
  );
  assert(!r.stdout.includes("TODAS as referências"), r.stdout);
});

Deno.test("main/API: SÓ inalcançável (nada ausente) também reprova", async () => {
  const r = await roda({
    arquivos: { "src/a.ts": 'x.from("trancada")' },
    relacoes: [{ nome: "trancada", service_role: true }], // anon/authenticated sem SELECT
    env: VIA_API,
  });
  assertEquals(r.code, 1, r.stderr);
  assertStringIncludes(r.stdout, "INALCANÇÁVEL");
  assertStringIncludes(
    r.stdout,
    "nenhum papel desta origem (anon/authenticated) tem SELECT",
  );
  assert(!r.stdout.includes("AUSENTE"), r.stdout);
});

Deno.test("main/API: SÓ ausente e SÓ inalcançável, cada um sozinho, reprovam (nenhum dos dois é 'e')", async () => {
  const soAusente = await roda({
    arquivos: { "src/a.ts": 'x.rpc("some")' },
    env: VIA_API,
  });
  assertEquals(soAusente.code, 1);
  assertStringIncludes(soAusente.stdout, 'função "some"');
  const soInalcancavel = await roda({
    arquivos: { "src/a.ts": 'x.rpc("fechada")' },
    funcoes: [{ nome: "fechada" }],
    env: VIA_API,
  });
  assertEquals(soInalcancavel.code, 1);
  assertStringIncludes(soInalcancavel.stdout, "tem EXECUTE");
});

Deno.test("main/API: storage sem acesso deixa o bucket CEGO — avisa no stderr mas aprova se o resto está certo", async () => {
  const cego = await roda({
    arquivos: ARQUIVOS_OK,
    ...CATALOGO_OK,
    buckets: null,
    env: VIA_API,
  });
  assertEquals(cego.code, 0, cego.stderr);
  assertStringIncludes(cego.stderr, "::warning::Sem acesso a storage.buckets");
  const enxerga = await roda({
    arquivos: ARQUIVOS_OK,
    ...CATALOGO_OK,
    buckets: [{ id: "avatars" }],
    env: VIA_API,
  });
  assertEquals(enxerga.code, 0, enxerga.stderr);
  assert(
    !enxerga.stderr.includes("Sem acesso a storage.buckets"),
    enxerga.stderr,
  );
});

Deno.test("main/API: bucket de storage ausente reprova; presente aprova", async () => {
  const arquivos = { "src/a.ts": 'x.storage.from("avatars")' };
  const ausente = await roda({
    arquivos,
    buckets: [{ id: "outro" }],
    env: VIA_API,
  });
  assertEquals(ausente.code, 1);
  assertStringIncludes(ausente.stdout, 'bucket de storage "avatars"');
  const presente = await roda({
    arquivos,
    buckets: [{ id: "avatars" }],
    env: VIA_API,
  });
  assertEquals(presente.code, 0, presente.stderr + presente.stdout);
});

Deno.test("main: referências DINÂMICAS saem no relatório sem reprovar", async () => {
  const r = await roda({
    arquivos: { ...ARQUIVOS_OK, "src/b.ts": "x.rpc(nomeDaFuncao)" },
    ...CATALOGO_OK,
    env: VIA_API,
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(
    r.stdout,
    "FORA DA AUDITORIA — .rpc/.from com nome em VARIÁVEL (1;",
  );
  assert(
    r.stdout
      .replaceAll("\\", "/")
      .includes("- .rpc(nomeDaFuncao, …) em src/b.ts:1"),
    r.stdout,
  );
});

Deno.test("main/INERTE: ref sem token (vazio, só espaço ou ausente) avisa e SAI 0 — sem catálogo", async () => {
  for (const env of [
    { SUPABASE_PROJECT_REF: REF },
    { SUPABASE_PROJECT_REF: REF, SUPABASE_ACCESS_TOKEN: "" },
    { SUPABASE_PROJECT_REF: REF, SUPABASE_ACCESS_TOKEN: "   " },
  ]) {
    const r = await roda({ arquivos: ARQUIVOS_OK, env });
    assertEquals(r.code, 0, JSON.stringify(env) + r.stderr);
    assertStringIncludes(
      r.stderr,
      "::warning::Detector de objetos INERTE: sem SUPABASE_ACCESS_TOKEN",
    );
    assert(!r.stdout.includes("Catálogo lido"), r.stdout);
  }
});

Deno.test("main/INERTE: sem ref e sem DATABASE_URL (nem .env.local/.env) avisa e SAI 0", async () => {
  for (const env of [{}, { SUPABASE_PROJECT_REF: "   " }]) {
    const r = await roda({ arquivos: ARQUIVOS_OK, env });
    assertEquals(r.code, 0, JSON.stringify(env) + r.stderr);
    assertStringIncludes(
      r.stderr,
      "::warning::Detector de objetos INERTE: sem DATABASE_URL",
    );
    assert(!r.stdout.includes("Catálogo lido"), r.stdout);
  }
});

Deno.test("main/INERTE: com token mas SEM ref NÃO usa a API (ref é quem liga o caminho da API)", async () => {
  const r = await roda({
    arquivos: ARQUIVOS_OK,
    env: { SUPABASE_ACCESS_TOKEN: "token-de-teste-h36" },
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stderr, "sem DATABASE_URL");
  assert(!r.stdout.includes("Catálogo lido"), r.stdout);
});

Deno.test("main/DATABASE_URL: projeto diferente do esperado reprova ANTES de qualquer conexão, e mostra o alvo", async () => {
  const url = `postgres://postgres@db.${OUTRO}.supabase.co:5432/postgres`;
  const r = await roda({
    arquivos: ARQUIVOS_OK,
    env: { DATABASE_URL: url, PROJETO_REF_ESPERADO: REF },
  });
  assertEquals(r.code, 1);
  assertStringIncludes(
    r.stdout,
    `Alvo: db.${OUTRO}.supabase.co (projeto ${OUTRO})`,
  );
  assertStringIncludes(
    r.stderr,
    `::error::DATABASE_URL aponta para o projeto ${OUTRO}, mas o esperado é ${REF}`,
  );
});

Deno.test("main/DATABASE_URL: host sem ref reconhecível imprime 'não identificado' e reprova se há esperado", async () => {
  const r = await roda({
    arquivos: ARQUIVOS_OK,
    env: {
      DATABASE_URL: "postgres://postgres@localhost:1/postgres",
      PROJETO_REF_ESPERADO: REF,
    },
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "Alvo: localhost (projeto não identificado)");
  assertStringIncludes(r.stderr, "aponta para o projeto não identificado");
});

Deno.test("main/DATABASE_URL: projeto IGUAL ao esperado não reprova pela guarda (segue para o catálogo)", async () => {
  const r = await roda({
    arquivos: ARQUIVOS_OK,
    env: {
      DATABASE_URL: `postgres://postgres.${REF}@localhost:1/postgres`,
      PROJETO_REF_ESPERADO: REF,
    },
  });
  assertStringIncludes(r.stdout, `Alvo: localhost (projeto ${REF})`);
  assert(!r.stderr.includes("aponta para o projeto"), r.stderr);
  assert(
    !r.stdout.includes("TODAS as referências"),
    "sem banco, não pode aprovar",
  );
  assert(r.code !== 0, "sem driver/banco o programa não aprova");
});

Deno.test("main/DATABASE_URL: sem PROJETO_REF_ESPERADO a guarda não age", async () => {
  const r = await roda({
    arquivos: ARQUIVOS_OK,
    env: { DATABASE_URL: `postgres://postgres.${OUTRO}@localhost:1/postgres` },
  });
  assert(!r.stderr.includes("::error::DATABASE_URL aponta"), r.stderr);
});

Deno.test("main/.env.local: lê DATABASE_URL do arquivo, tira as aspas e prefere o .env.local ao .env", async () => {
  const urlLocal = `postgres://postgres@db.${OUTRO}.supabase.co:5432/postgres`;
  const urlEnv = `postgres://postgres@db.${REF}.supabase.co:5432/postgres`;
  const esperado = "zzzzzzzzzzzzzzzzzzzz";
  // As duas: .env.local vence (CRLF + linha parecida antes + aspas).
  const as2 = await roda({
    arquivos: {
      ...ARQUIVOS_OK,
      ".env.local": `OUTRA=1\r\nX_DATABASE_URL=nao\r\nDATABASE_URL="${urlLocal}"\r\n`,
      ".env": `DATABASE_URL=${urlEnv}\n`,
    },
    env: { PROJETO_REF_ESPERADO: esperado },
  });
  assertEquals(as2.code, 1, as2.stdout + as2.stderr);
  assertStringIncludes(as2.stderr, `aponta para o projeto ${OUTRO}`);

  // Só o .env: cai para ele.
  const soEnv = await roda({
    arquivos: { ...ARQUIVOS_OK, ".env": `DATABASE_URL=${urlEnv}\n` },
    env: { PROJETO_REF_ESPERADO: esperado },
  });
  assertEquals(soEnv.code, 1, soEnv.stdout + soEnv.stderr);
  assertStringIncludes(soEnv.stderr, `aponta para o projeto ${REF}`);

  // .env.local sem a chave: cai para o .env.
  const semChave = await roda({
    arquivos: {
      ...ARQUIVOS_OK,
      ".env.local": "OUTRA=1\n",
      ".env": `DATABASE_URL=${urlEnv}\n`,
    },
    env: { PROJETO_REF_ESPERADO: esperado },
  });
  assertStringIncludes(semChave.stderr, `aponta para o projeto ${REF}`);
});

Deno.test("main: variável DATABASE_URL do ambiente vale mais que o arquivo", async () => {
  const r = await roda({
    arquivos: {
      ...ARQUIVOS_OK,
      ".env.local": `DATABASE_URL=postgres://postgres@db.${REF}.supabase.co:5432/postgres\n`,
    },
    env: {
      DATABASE_URL: `postgres://postgres@db.${OUTRO}.supabase.co:5432/postgres`,
      PROJETO_REF_ESPERADO: "zzzzzzzzzzzzzzzzzzzz",
    },
  });
  assertStringIncludes(r.stderr, `aponta para o projeto ${OUTRO}`);
});

Deno.test("IMPORTAR o módulo não executa o main (nem o aviso de INERTE nem o exit)", async () => {
  const r = await roda({
    arquivos: {},
    args: [
      "--input-type=module",
      "--eval",
      `const m = await import(${JSON.stringify(SCRIPT.href)}); console.log("IMPORTADO", typeof m.avaliar);`,
    ],
  });
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stdout, "IMPORTADO function");
  assert(!r.stderr.includes("INERTE"), r.stderr);
});
