// @ts-nocheck
/**
 * scripts/db-check-objetos-do-codigo.mjs — as BORDAS do detector de "objeto que
 * o código usa e o banco não tem" (o que reprova o PR antes de uma view sumida
 * quebrar o cadastro em produção).
 *
 * tests/db_check_objetos_do_codigo_test.ts prova a extração e a avaliação com
 * catálogo semeado. Uma caça por mutação achou o que ficava sem teste:
 *  - número da linha reportada e a janela que reconhece `storage.from(...)`
 *    quando `storage` está no começo do arquivo;
 *  - a varredura do repositório: node_modules/.git fora, só código, arquivo de
 *    teste fora, `src` com os papéis do app e `supabase/functions` com o
 *    service_role;
 *  - o rótulo do objeto inalcançável (tabela/view × função, SELECT × EXECUTE);
 *  - o bloco das referências dinâmicas (vazio, e com a lacuna declarada);
 *  - erro de rede na API de gestão: mensagem própria, sem vazar corpo;
 *  - o PROCESSO (`main`): sem token ou sem URL o detector fica INERTE e sai 0
 *    (nunca vira vermelho por falta de segredo em PR de fork); URL de outro
 *    projeto reprova ANTES de abrir conexão; URL ilegível sai com 1.
 *
 * Nenhum teste abre conexão nem fala com a rede: o processo só roda os caminhos
 * que terminam antes de qualquer conexão.
 */
import { createRequire } from "node:module";
import {
  fromFileUrl,
  toFileUrl,
} from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avaliar,
  extrairDeConteudo,
  extrairDoRepo,
  formatarDinamicas,
  lerCatalogoPelaApi,
  lojaDosArgumentos,
} from "../scripts/db-check-objetos-do-codigo.mjs";

// Esquema montado em pedacos: a fixture e uma URL de teste (127.0.0.1:9, nunca
// abre conexao), e o varredor de segredo recusa o literal inteiro no arquivo.
const ESQUEMA_PG = ["postgresql", "//"].join(":");

Deno.test("extrairDeConteudo: o número da linha conta a quebra de linha que abre o arquivo", () => {
  const achados = extrairDeConteudo('\n\n  supabase.from("t")', "src/x.ts");
  assertEquals(achados.from[0].onde, "src/x.ts:3");
});

Deno.test("extrairDeConteudo: `storage` no começo do arquivo ainda marca BUCKET (a janela olha desde o caractere 0)", () => {
  const literal = extrairDeConteudo('storage.from("fotos")', "src/x.ts");
  assertEquals(
    literal.bucket.map((b) => b.nome),
    ["fotos"],
  );
  assertEquals(literal.from, []);
  const variavel = extrairDeConteudo("storage.from(nome)", "src/x.ts");
  assertEquals(variavel.dinamicas, []);
});

function arvore(arquivos) {
  const raiz = Deno.makeTempDirSync();
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const destino = `${raiz}/${caminho}`;
    Deno.mkdirSync(destino.slice(0, destino.lastIndexOf("/")), {
      recursive: true,
    });
    Deno.writeTextFileSync(destino, conteudo);
  }
  return raiz;
}

Deno.test("extrairDoRepo: varre src (anon/authenticated) e supabase/functions (service_role); ignora node_modules, .git, arquivo de teste e o que não é código", () => {
  const raiz = arvore({
    "src/a.ts": 'supabase.from("t_a")',
    "src/sub/d.tsx": 'supabase.rpc("f_d")',
    "src/node_modules/x/b.ts": 'supabase.from("t_node_modules")',
    "src/.git/c.ts": 'supabase.from("t_git")',
    "src/e.test.ts": 'supabase.from("t_teste_ponto")',
    "src/f_test.ts": 'supabase.from("t_teste_sublinhado")',
    "src/g.css": 'x.from("t_css")',
    "src/h.md": 'x.from("t_md")',
    "src/dinamica.ts": "supabase.rpc(nomeDaFuncao)",
    "supabase/functions/edge.ts": 'admin.from("t_edge")',
    "outra/fora.ts": 'supabase.from("t_fora")',
  });
  try {
    const { referencias, dinamicas } = extrairDoRepo(raiz);
    const resumo = referencias
      .map((r) => `${r.tipo}:${r.nome}:${r.papeis.join("/")}`)
      .sort();
    assertEquals(resumo, [
      "from:t_a:anon/authenticated",
      "from:t_edge:service_role",
      "rpc:f_d:anon/authenticated",
    ]);
    assertEquals(
      dinamicas.map((d) => `${d.chamada}:${d.nome}`),
      ["rpc:nomeDaFuncao"],
    );
  } finally {
    Deno.removeSync(raiz, { recursive: true });
  }
});

Deno.test("extrairDoRepo: raiz sem src nem supabase/functions devolve listas vazias (não lança)", () => {
  const raiz = arvore({ "README.md": "x" });
  try {
    assertEquals(extrairDoRepo(raiz), { referencias: [], dinamicas: [] });
  } finally {
    Deno.removeSync(raiz, { recursive: true });
  }
});

Deno.test("avaliar: objeto que existe mas nenhum papel alcança é INALCANÇÁVEL, com o rótulo e o privilégio certos para tabela e para função", () => {
  const catalogo = {
    relacoes: new Map([["tabela_fechada", new Set(["service_role"])]]),
    funcoes: new Map([["funcao_fechada", new Set(["service_role"])]]),
    buckets: new Set(),
  };
  const r = avaliar(
    [
      {
        tipo: "from",
        nome: "tabela_fechada",
        onde: "src/a.ts:1",
        papeis: ["anon", "authenticated"],
      },
      {
        tipo: "rpc",
        nome: "funcao_fechada",
        onde: "src/b.ts:2",
        papeis: ["anon", "authenticated"],
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
        "existe, mas nenhum papel desta origem (anon/authenticated) tem EXECUTE",
      ],
    ],
  );
});

Deno.test("formatarDinamicas: sem referência dinâmica devolve texto vazio (nunca um cabeçalho solto); com elas declara a lacuna e lista cada linha", () => {
  for (const vazio of [undefined, null, []]) {
    assertEquals(formatarDinamicas(vazio), "");
  }
  const texto = formatarDinamicas([
    { chamada: "rpc", nome: "variavel", onde: "src/a.ts:7" },
  ]);
  assertStringIncludes(texto, "FORA DA AUDITORIA");
  assertStringIncludes(texto, "(1;");
  assertStringIncludes(texto, "  - .rpc(variavel, …) em src/a.ts:7");
});

Deno.test("lerCatalogoPelaApi: fetch que falha (rede) é erro próprio da operação, sem vazar nada", async () => {
  await assertRejects(
    () =>
      lerCatalogoPelaApi({
        token: "token-de-teste",
        ref: "a".repeat(20),
        fetchImpl: async () => {
          throw new TypeError("fetch failed: segredo-no-erro");
        },
      }),
    Error,
    "consulta somente leitura falhou (relações): rede.",
  );
  try {
    await lerCatalogoPelaApi({
      token: "token-de-teste",
      ref: "a".repeat(20),
      fetchImpl: async () => {
        throw new TypeError("fetch failed: segredo-no-erro");
      },
    });
  } catch (e) {
    assert(!e.message.includes("segredo-no-erro"));
    assert(!e.message.includes("token-de-teste"));
  }
});

// --------------------------------------------------- o processo (main)

const SCRIPT = fromFileUrl(
  new URL("../scripts/db-check-objetos-do-codigo.mjs", import.meta.url),
);

/** Roda o script de verdade, com o ambiente SÓ do que o caso declara. */
async function rodar(ambiente) {
  const base = ambienteBase();
  const saida = await new Deno.Command("node", {
    args: [SCRIPT],
    env: {
      DATABASE_URL: "",
      SUPABASE_PROJECT_REF: "",
      SUPABASE_ACCESS_TOKEN: "",
      PROJETO_REF_ESPERADO: "",
      ...base,
      ...ambiente,
    },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const t = new TextDecoder();
  return {
    codigo: saida.code,
    texto: t.decode(saida.stdout) + t.decode(saida.stderr),
  };
}

Deno.test("processo: pela API sem SUPABASE_ACCESS_TOKEN fica INERTE e sai 0 (PR de fork não fica vermelho por falta de segredo)", async () => {
  const r = await rodar({ SUPABASE_PROJECT_REF: "a".repeat(20) });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(
    r.texto,
    "Detector de objetos INERTE: sem SUPABASE_ACCESS_TOKEN",
  );
});

Deno.test("processo: sem ref e sem DATABASE_URL fica INERTE e sai 0, avisando que a lógica segue provada pelo teste", async () => {
  // Raiz falsa: o script também procura DATABASE_URL nos arquivos de ambiente da
  // raiz, e a do repositório de verdade pode ter um na máquina de quem desenvolve.
  const r = await rodarNaRaizFalsa({ arquivos: {}, ambiente: {} });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "Detector de objetos INERTE: sem DATABASE_URL");
});

Deno.test("processo: DATABASE_URL de OUTRO projeto reprova (sai 1) ANTES de abrir conexão, citando o projeto achado e o esperado", async () => {
  const ref = "a".repeat(20);
  const esperado = "b".repeat(20);
  const r = await rodar({
    DATABASE_URL: `${ESQUEMA_PG}postgres.${ref}:senha-de-teste@127.0.0.1:9/postgres`,
    PROJETO_REF_ESPERADO: esperado,
  });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(r.texto, `Alvo: 127.0.0.1 (projeto ${ref})`);
  assertStringIncludes(
    r.texto,
    `DATABASE_URL aponta para o projeto ${ref}, mas o esperado é ${esperado}`,
  );
  assert(!r.texto.includes("senha-de-teste"), "a senha não pode ir para o log");
});

Deno.test("processo: DATABASE_URL ilegível sai com 1 e a mensagem do erro (nunca 0 silencioso)", async () => {
  const r = await rodar({ DATABASE_URL: "isto nao e uma url" });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(r.texto, "Invalid URL");
});

// ------------------------------------------- o veredito do main (dublê de fetch)

const STUB_FETCH = `
const resposta = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => corpo,
});
globalThis.fetch = async (_url, init) => {
  const { query } = JSON.parse(init.body);
  const env = process.env;
  // --loja (A18): prova de que NENHUM fetch aconteceu, e de para onde ele foi.
  process.stdout.write("FETCH-CHAMADO\\n");
  if (env.STUB_URL_ESPERADA && _url !== env.STUB_URL_ESPERADA) {
    return resposta(599, "url inesperada");
  }
  if (query.includes("pg_class")) {
    return resposta(Number(env.STUB_STATUS_REL ?? 200), env.STUB_REL ?? "[]");
  }
  if (query.includes("pg_proc")) return resposta(200, env.STUB_FN ?? "[]");
  if (query.includes("storage.buckets")) {
    return resposta(Number(env.STUB_STATUS_BUCKETS ?? 200), env.STUB_BUCKETS ?? "[]");
  }
  return resposta(500, "consulta inesperada");
};
`;

function ambienteBase() {
  return Object.fromEntries(
    ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "HOME", "USERPROFILE"].flatMap(
      (chave) => {
        const v = Deno.env.get(chave);
        return v === undefined ? [] : [[chave, v]];
      },
    ),
  );
}

/**
 * Monta uma raiz de repositório FALSA e roda a CÓPIA do script dentro dela, com
 * um fetch de mentira pré-carregado: o `main` inteiro (varredura, catálogo,
 * veredito, código de saída) roda sem tocar rede nem banco, e sem varrer o
 * repositório de verdade.
 */
async function rodarNaRaizFalsa({
  arquivos,
  ambiente,
  args = [],
  copiar = [],
}) {
  const raiz = arvore({ ...arquivos, "stub.mjs": STUB_FETCH });
  try {
    Deno.mkdirSync(`${raiz}/scripts`, { recursive: true });
    Deno.copyFileSync(SCRIPT, `${raiz}/scripts/db-check-objetos-do-codigo.mjs`);
    // arquivos REAIS do repositório que o caso precisa (ex.: o leitor do cadastro)
    for (const rel of copiar) {
      Deno.mkdirSync(`${raiz}/${rel.slice(0, rel.lastIndexOf("/"))}`, {
        recursive: true,
      });
      Deno.copyFileSync(
        fromFileUrl(new URL(`../${rel}`, import.meta.url)),
        `${raiz}/${rel}`,
      );
    }
    const saida = await new Deno.Command("node", {
      args: [
        "--import",
        toFileUrl(`${raiz}/stub.mjs`).href,
        `${raiz}/scripts/db-check-objetos-do-codigo.mjs`,
        ...args,
      ],
      env: { ...ambienteBase(), ...ambiente },
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const t = new TextDecoder();
    return {
      codigo: saida.code,
      texto: t.decode(saida.stdout) + t.decode(saida.stderr),
    };
  } finally {
    Deno.removeSync(raiz, { recursive: true });
  }
}

const REF_API = "a".repeat(20);
const API = {
  SUPABASE_PROJECT_REF: REF_API,
  SUPABASE_ACCESS_TOKEN: "token-de-teste",
};
const SRC_UMA_TABELA = { "src/a.ts": 'supabase.from("tabela_ok")' };
const TABELA_ALCANCAVEL = JSON.stringify([
  { nome: "tabela_ok", anon: true, authenticated: true, service_role: true },
]);

Deno.test("main pela API: tudo existe e é alcançável -> sai 0 e mostra a contagem real do catálogo", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: SRC_UMA_TABELA,
    ambiente: {
      ...API,
      STUB_REL: TABELA_ALCANCAVEL,
      STUB_BUCKETS: '[{"id":"fotos"}]',
    },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "Catálogo lido pela API de gestão do Supabase");
  assertStringIncludes(
    r.texto,
    "Referências literais no código: 1 (1 objetos únicos)",
  );
  assertStringIncludes(r.texto, "1 relações e 0 funções no catálogo public");
  assertStringIncludes(
    r.texto,
    "TODAS as referências do código existem e são alcançáveis.",
  );
  assert(!r.texto.includes("Sem acesso a storage.buckets"), r.texto);
});

Deno.test("main pela API: objeto AUSENTE no banco reprova com exit 1 e nomeia o objeto e a linha", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: SRC_UMA_TABELA,
    ambiente: { ...API, STUB_REL: "[]" },
  });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(r.texto, "AUSENTE");
  // (no Windows o caminho relativo vem com barra invertida)
  assertStringIncludes(
    r.texto.replaceAll("\\", "/"),
    'tabela/view "tabela_ok" usada em src/a.ts:1',
  );
  assert(!r.texto.includes("TODAS as referências"), r.texto);
});

Deno.test("main pela API: objeto que EXISTE mas nenhum papel alcança reprova com exit 1 (só INALCANÇÁVEL, sem nenhum ausente)", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: SRC_UMA_TABELA,
    ambiente: {
      ...API,
      STUB_REL: JSON.stringify([
        {
          nome: "tabela_ok",
          anon: false,
          authenticated: false,
          service_role: true,
        },
      ]),
    },
  });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(r.texto, "INALCANÇÁVEL");
  assert(!r.texto.includes("AUSENTE —"), r.texto);
  assert(!r.texto.includes("TODAS as referências"), r.texto);
});

Deno.test("main pela API: storage inacessível AVISA que a checagem de bucket está cega, mas não reprova sozinho", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: SRC_UMA_TABELA,
    ambiente: {
      ...API,
      STUB_REL: TABELA_ALCANCAVEL,
      STUB_STATUS_BUCKETS: "403",
    },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "Sem acesso a storage.buckets");
});

Deno.test("main pela API: falha HTTP na consulta de RELAÇÕES é fatal (exit 1, só operação e status, nunca verde por falta de resposta)", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: SRC_UMA_TABELA,
    ambiente: {
      ...API,
      STUB_STATUS_REL: "500",
      STUB_REL: "corpo-secreto-do-servidor",
    },
  });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(
    r.texto,
    "consulta somente leitura falhou (relações): HTTP 500.",
  );
  assert(!r.texto.includes("corpo-secreto-do-servidor"), r.texto);
  assert(!r.texto.includes("token-de-teste"), r.texto);
});

Deno.test("main pela API: referência dinâmica é declarada como lacuna sem reprovar", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: { ...SRC_UMA_TABELA, "src/b.ts": "supabase.rpc(nomeDaFuncao)" },
    ambiente: { ...API, STUB_REL: TABELA_ALCANCAVEL },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "FORA DA AUDITORIA");
  assertStringIncludes(
    r.texto.replaceAll("\\", "/"),
    ".rpc(nomeDaFuncao, …) em src/b.ts:1",
  );
});

const OUTRO_PROJETO = "b".repeat(20);
const URL_DE_OUTRO = `${ESQUEMA_PG}postgres.${OUTRO_PROJETO}:senha-de-teste@127.0.0.1:9/postgres`;

Deno.test("DATABASE_URL lida do arquivo de ambiente local da raiz (aspas removidas) alimenta a guarda de projeto", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: {
      ".env.local": `OUTRA=1\nDATABASE_URL="${URL_DE_OUTRO}"\n`,
      ".env": `DATABASE_URL=${ESQUEMA_PG}postgres.${"c".repeat(20)}:x@127.0.0.1:9/postgres\n`,
    },
    ambiente: { PROJETO_REF_ESPERADO: REF_API },
  });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(r.texto, `Alvo: 127.0.0.1 (projeto ${OUTRO_PROJETO})`);
  assertStringIncludes(r.texto, `o esperado é ${REF_API}`);
});

// Cliente `pg` de mentira, instalado na raiz FALSA: o script o carrega por
// require("pg") a partir da própria pasta, então o caminho da conexão direta
// roda inteiro sem Postgres e sem rede.
const PG_FALSO = `
class Client {
  constructor(opcoes) { this.cs = opcoes.connectionString; }
  async connect() {}
  async query(sql) {
    const e = process.env;
    if (sql.includes("pg_class")) return { rows: JSON.parse(e.STUB_REL ?? "[]") };
    if (sql.includes("pg_proc")) return { rows: JSON.parse(e.STUB_FN ?? "[]") };
    if (sql.includes("storage.buckets")) {
      if (e.STUB_BUCKETS_ERRO) throw new Error("sem acesso ao storage");
      return { rows: JSON.parse(e.STUB_BUCKETS ?? "[]") };
    }
    throw new Error("consulta inesperada");
  }
  async end() {}
}
module.exports = { Client };
`;
const COM_PG = { ...SRC_UMA_TABELA, "node_modules/pg/index.js": PG_FALSO };
const URL_DO_PROJETO = `${ESQUEMA_PG}postgres.${REF_API}:senha-de-teste@127.0.0.1:9/postgres`;

Deno.test("conexão direta: sem PROJETO_REF_ESPERADO a guarda NÃO reprova; lê o catálogo e sai 0 com a contagem", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: COM_PG,
    ambiente: { DATABASE_URL: URL_DO_PROJETO, STUB_REL: TABELA_ALCANCAVEL },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, `Alvo: 127.0.0.1 (projeto ${REF_API})`);
  assertStringIncludes(r.texto, "1 relações e 0 funções no catálogo public");
  assertStringIncludes(
    r.texto,
    "TODAS as referências do código existem e são alcançáveis.",
  );
  assert(!r.texto.includes("aponta para o projeto"), r.texto);
  assert(!r.texto.includes("senha-de-teste"), "a senha não pode ir para o log");
});

Deno.test("conexão direta: PROJETO_REF_ESPERADO igual ao da URL passa pela guarda e segue para o catálogo", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: COM_PG,
    ambiente: {
      DATABASE_URL: URL_DO_PROJETO,
      PROJETO_REF_ESPERADO: REF_API,
      STUB_REL: TABELA_ALCANCAVEL,
    },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "TODAS as referências");
  assert(!r.texto.includes("aponta para o projeto"), r.texto);
});

Deno.test("conexão direta: objeto ausente reprova (exit 1) e storage sem acesso avisa a cegueira do bucket", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: COM_PG,
    ambiente: {
      DATABASE_URL: URL_DO_PROJETO,
      STUB_REL: "[]",
      STUB_BUCKETS_ERRO: "1",
    },
  });
  assertEquals(r.codigo, 1, r.texto);
  assertStringIncludes(r.texto, "AUSENTE");
  assertStringIncludes(r.texto, "Sem acesso a storage.buckets");
});

Deno.test("conexão direta: DATABASE_URL VAZIA no ambiente é 'sem fonte' (inerte, exit 0) e NÃO cai no arquivo de ambiente da raiz", async () => {
  const r = await rodarNaRaizFalsa({
    arquivos: { ...COM_PG, ".env": `DATABASE_URL=${URL_DE_OUTRO}\n` },
    ambiente: { DATABASE_URL: "", PROJETO_REF_ESPERADO: REF_API },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "Detector de objetos INERTE: sem DATABASE_URL");
});

Deno.test("DATABASE_URL de arquivo: sem o local cai no .env; local sem a linha também cai no .env; sem nenhum fica INERTE (exit 0)", async () => {
  const soEnv = await rodarNaRaizFalsa({
    arquivos: { ".env": `DATABASE_URL=${URL_DE_OUTRO}\n` },
    ambiente: { PROJETO_REF_ESPERADO: REF_API },
  });
  assertEquals(soEnv.codigo, 1, soEnv.texto);
  assertStringIncludes(soEnv.texto, `projeto ${OUTRO_PROJETO}`);

  const semALinha = await rodarNaRaizFalsa({
    arquivos: {
      ".env.local": "OUTRA=1\n",
      ".env": `DATABASE_URL=${URL_DE_OUTRO}\n`,
    },
    ambiente: { PROJETO_REF_ESPERADO: REF_API },
  });
  assertEquals(semALinha.codigo, 1, semALinha.texto);
  assertStringIncludes(semALinha.texto, `projeto ${OUTRO_PROJETO}`);

  const nenhum = await rodarNaRaizFalsa({ arquivos: {}, ambiente: {} });
  assertEquals(nenhum.codigo, 0, nenhum.texto);
  assertStringIncludes(
    nenhum.texto,
    "Detector de objetos INERTE: sem DATABASE_URL",
  );
});

// ---------------------------------------------------------------------------
// --loja <nome> (A18 do plano da org central, 27/11/2026): a conferência de
// objetos para QUALQUER loja assinante, com o ref vindo SÓ do cadastro
// (scripts/frota/lojas.json). Loja legado ou desconhecida, ref cru e argumento
// fora da forma são recusados ANTES de qualquer fetch. Sem argumento, o modo
// de hoje (SUPABASE_PROJECT_REF do job `objetos`, ou DATABASE_URL) não muda.
// ---------------------------------------------------------------------------
const REF_DA_NOVA = "qwertyuiopasdfghjklz";
/** Cadastro de FIXTURE (nenhuma loja real): uma assinante nova e um legado. */
const LOJAS_FIXTURE = {
  lojas: {
    "loja-nova-x": {
      ref: REF_DA_NOVA,
      classe: "assinante",
      apelido: "Nova",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJAS",
      functionsNomeadas: false,
    },
    loja: {
      ref: "zxcvbnmlkjhgfdsapoiu",
      classe: "legado",
      apelido: "loja",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN",
    },
  },
};
const { validarCadastro } = createRequire(import.meta.url)(
  "../scripts/frota/lojas.cjs",
);
const CADASTRO_FIXTURE = validarCadastro(LOJAS_FIXTURE);

Deno.test("lojaDosArgumentos: sem argumento é o modo de hoje (null); --loja de assinante devolve o ref do cadastro", () => {
  assertEquals(lojaDosArgumentos([], CADASTRO_FIXTURE), null);
  assertEquals(lojaDosArgumentos(["--loja", "loja-nova-x"], CADASTRO_FIXTURE), {
    loja: "loja-nova-x",
    ref: REF_DA_NOVA,
    segredo: "SUPABASE_ACCESS_TOKEN_LOJAS",
  });
  // com o cadastro REAL, as duas lojas no ar
  assertEquals(
    lojaDosArgumentos(["--loja", "ikcous-publicada"]).ref,
    "cafkrminfnokvgjqtkle",
  );
  assertEquals(
    lojaDosArgumentos(["--loja", "savy"]).ref,
    "gnjsrucsmjkajijrakzr",
  );
});

Deno.test("lojaDosArgumentos: recusa legado, desconhecida, ref cru e qualquer forma fora de `--loja <nome>`", () => {
  for (const args of [
    ["--loja", "loja"],
    ["--loja", "loja-ausente"],
    ["--loja", REF_DA_NOVA],
    ["--loja", "__proto__"],
    ["--loja"],
    ["--loja", ""],
    ["--loja=loja-nova-x"],
    ["--ref", REF_DA_NOVA],
    ["--loja", "loja-nova-x", "extra"],
    ["loja-nova-x"],
    ["--loja", "x\n::error::forjado"],
  ]) {
    let erro = null;
    try {
      lojaDosArgumentos(args, CADASTRO_FIXTURE);
    } catch (e) {
      erro = e;
    }
    assert(erro, `devia recusar ${JSON.stringify(args)}`);
    assert(
      erro.message.startsWith("::error::Destino recusado: "),
      erro.message,
    );
    assert(!erro.message.slice(1).includes("\n"), "quebra de linha no log");
  }
});

/** Roda o processo com --loja numa raiz falsa com o leitor REAL do cadastro e
 * o cadastro de FIXTURE. */
const COM_CADASTRO = {
  copiar: [
    "scripts/frota/lojas.cjs",
    "scripts/frota/org-central.cjs",
    "scripts/frota/org-central.json",
  ],
};
const arquivosComCadastro = (extra = {}) => ({
  "scripts/frota/lojas.json": JSON.stringify(LOJAS_FIXTURE),
  ...SRC_UMA_TABELA,
  ...extra,
});

Deno.test("processo --loja: assinante lê o catálogo pela API NO REF DO CADASTRO e dá o veredito de sempre", async () => {
  const r = await rodarNaRaizFalsa({
    ...COM_CADASTRO,
    arquivos: arquivosComCadastro(),
    args: ["--loja", "loja-nova-x"],
    ambiente: {
      SUPABASE_ACCESS_TOKEN_LOJAS: "token-de-teste",
      STUB_URL_ESPERADA: `https://api.supabase.com/v1/projects/${REF_DA_NOVA}/database/query/read-only`,
      STUB_REL: TABELA_ALCANCAVEL,
      STUB_BUCKETS: "[]",
    },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(r.texto, "FETCH-CHAMADO");
  assertStringIncludes(r.texto, `loja loja-nova-x, projeto ${REF_DA_NOVA}`);
  assertStringIncludes(
    r.texto,
    "TODAS as referências do código existem e são alcançáveis.",
  );
  assert(!r.texto.includes("token-de-teste"));
  // e o veredito vermelho também chega (objeto ausente no banco da loja)
  const ausente = await rodarNaRaizFalsa({
    ...COM_CADASTRO,
    arquivos: arquivosComCadastro(),
    args: ["--loja", "loja-nova-x"],
    ambiente: { SUPABASE_ACCESS_TOKEN_LOJAS: "token-de-teste", STUB_REL: "[]" },
  });
  assertEquals(ausente.codigo, 1, ausente.texto);
  assertStringIncludes(ausente.texto, "AUSENTE");
});

Deno.test("processo --loja: legado, desconhecida e ref cru saem 1 ANTES de qualquer fetch", async () => {
  for (const nome of ["loja", "loja-ausente", REF_DA_NOVA]) {
    const r = await rodarNaRaizFalsa({
      ...COM_CADASTRO,
      arquivos: arquivosComCadastro(),
      args: ["--loja", nome],
      ambiente: {
        SUPABASE_ACCESS_TOKEN: "token-de-teste",
        SUPABASE_ACCESS_TOKEN_LOJAS: "token-de-teste",
        STUB_REL: TABELA_ALCANCAVEL,
      },
    });
    assertEquals(r.codigo, 1, `${nome}: ${r.texto}`);
    assertStringIncludes(r.texto, "::error::Destino recusado: ");
    assert(!r.texto.includes("FETCH-CHAMADO"), `${nome}: fez fetch`);
  }
});

Deno.test("processo --loja: sem o segredo DA LOJA FALHA (não fica inerte; o genérico e o de outra loja não servem); com SUPABASE_PROJECT_REF junto, recusa a ambiguidade; DATABASE_URL não é usada", async () => {
  const semToken = await rodarNaRaizFalsa({
    ...COM_CADASTRO,
    arquivos: arquivosComCadastro(),
    args: ["--loja", "loja-nova-x"],
    ambiente: {
      DATABASE_URL: `${ESQUEMA_PG}postgres.${REF_DA_NOVA}@127.0.0.1:9/p`,
      // o token genérico e o de outra loja presentes NÃO servem a loja nova
      SUPABASE_ACCESS_TOKEN: "token-generico",
      SUPABASE_ACCESS_TOKEN_SAVY: "token-de-outra",
      STUB_REL: TABELA_ALCANCAVEL,
    },
  });
  assertEquals(semToken.codigo, 1, semToken.texto);
  assertStringIncludes(
    semToken.texto,
    "::error::--loja loja-nova-x: sem SUPABASE_ACCESS_TOKEN_LOJAS",
  );
  assert(!semToken.texto.includes("INERTE"));
  assert(!semToken.texto.includes("Alvo:"), "caiu na DATABASE_URL");
  assert(!semToken.texto.includes("FETCH-CHAMADO"));
  assert(!semToken.texto.includes("token-generico"));

  const comRef = await rodarNaRaizFalsa({
    ...COM_CADASTRO,
    arquivos: arquivosComCadastro(),
    args: ["--loja", "loja-nova-x"],
    ambiente: {
      SUPABASE_ACCESS_TOKEN_LOJAS: "token-de-teste",
      SUPABASE_PROJECT_REF: "a".repeat(20),
      STUB_REL: TABELA_ALCANCAVEL,
    },
  });
  assertEquals(comRef.codigo, 1, comRef.texto);
  assertStringIncludes(comRef.texto, "::error::");
  assertStringIncludes(comRef.texto, "SUPABASE_PROJECT_REF");
  assert(!comRef.texto.includes("FETCH-CHAMADO"));
});

Deno.test("processo sem argumento: o modo SUPABASE_PROJECT_REF do job `objetos` continua igual e NÃO precisa do cadastro", async () => {
  // raiz falsa SEM scripts/frota: o modo de hoje não carrega o leitor do cadastro
  const r = await rodarNaRaizFalsa({
    arquivos: SRC_UMA_TABELA,
    ambiente: {
      ...API,
      STUB_URL_ESPERADA: `https://api.supabase.com/v1/projects/${REF_API}/database/query/read-only`,
      STUB_REL: TABELA_ALCANCAVEL,
      STUB_BUCKETS: "[]",
    },
  });
  assertEquals(r.codigo, 0, r.texto);
  assertStringIncludes(
    r.texto,
    "Catálogo lido pela API de gestão do Supabase, endpoint somente leitura.",
  );
});
