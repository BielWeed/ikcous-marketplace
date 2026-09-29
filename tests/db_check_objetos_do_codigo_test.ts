import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
// @ts-nocheck
/**
 * scripts/db-check-objetos-do-codigo.mjs — o detector de "objeto que o código
 * usa e o banco não tem" (BANCO-080, issue #139, frente blindagem-banco-0409).
 *
 * Este arquivo cobre as partes PURAS (extração e avaliação) com catálogo
 * SEMEADO — nada aqui abre conexão: `test:unit` roda em Deno sem `pg` (mesma
 * razão dos irmãos db_apply_*_test.ts; o módulo só requer `pg` dentro de
 * lerCatalogo, que não é chamado aqui).
 *
 * O caso semeado principal é O CASO REAL da issue: em 05/08/2026
 * `vw_produtos_admin` não existia em nenhum schema do banco enquanto o front a
 * chamava — cadastrar produto quebrado em produção, escondido pelo fallback
 * de StoreContext. O detector existe para reprovar o PR ANTES disso.
 *
 * A segunda família de casos prova a DISTINÇÃO que a issue exige entre os
 * dois defeitos de correções diferentes:
 *   AUSENTE      — o objeto não está no banco;
 *   INALCANÇÁVEL — está, mas nenhum papel da origem tem SELECT/EXECUTE.
 */
import {
  SQL_BUCKETS,
  SQL_FUNCOES,
  SQL_RELACOES,
  avaliar,
  conferirProjeto,
  extrairDeConteudo,
  formatar,
  lerCatalogoPelaApi,
  montarCatalogo,
  refDoProjeto,
} from "../scripts/db-check-objetos-do-codigo.mjs";

const CATÁLOGO = () => ({
  relacoes: new Map([
    ["vw_produtos_public", new Set(["anon", "authenticated", "service_role"])],
    ["produtos", new Set(["service_role"])],
  ]),
  funcoes: new Map([
    ["confirmar_pagamento", new Set(["service_role"])],
    ["get_admin_analytics_v2", new Set(["authenticated", "service_role"])],
  ]),
  buckets: new Set(["products"]),
});

Deno.test("extrai .from com o nome na LINHA SEGUINTE (varredura por arquivo, não por linha)", () => {
  const codigo = `const { data } = await supabase
    .from(
      "marketplace_orders"
    ).select("*");`;
  const achados = extrairDeConteudo(codigo, "src/x.ts");
  assertEquals(achados.from.length, 1);
  assertEquals(achados.from[0].nome, "marketplace_orders");
  // A linha reportada é a do `.from(` (linha 2 do trecho), não a da string.
  assertEquals(achados.from[0].onde, "src/x.ts:2");
});

Deno.test(".storage.from é BUCKET, não tabela (o falso positivo real de 04/09: o bucket products de imagens)", () => {
  const codigo = `const u = supabase.storage
  .from("products")
  .getPublicUrl(p);
const t = await supabase.from("produtos").select("*");`;
  const achados = extrairDeConteudo(codigo, "src/y.ts");
  assertEquals(achados.bucket.length, 1);
  assertEquals(achados.bucket[0].nome, "products");
  assertEquals(achados.from.length, 1);
  assertEquals(achados.from[0].nome, "produtos");
});

Deno.test("CASO DA ISSUE semeado: view usada pelo código e ausente do banco vira AUSENTE", () => {
  const refs = [
    {
      tipo: "from",
      nome: "vw_produtos_admin",
      onde: "src/hooks/useProducts.ts:228",
      papeis: ["anon", "authenticated"],
    },
    {
      tipo: "from",
      nome: "vw_produtos_public",
      onde: "src/contexts/StoreContext.tsx:398",
      papeis: ["anon", "authenticated"],
    },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 1);
  assertEquals(r.ausentes[0].nome, "vw_produtos_admin");
  assertEquals(r.ausentes[0].objeto, "tabela/view");
  assertEquals(r.ok.length, 1); // a pública segue ok
  assertStringIncludes(formatar(r), "AUSENTE");
  assertStringIncludes(formatar(r), "vw_produtos_admin");
});

Deno.test("DISTINÇÃO: existe no banco mas papel da origem não alcança vira INALCANÇÁVEL (não AUSENTE)", () => {
  const refs = [
    {
      tipo: "from",
      nome: "produtos",
      onde: "src/hooks/useProducts.ts:166",
      papeis: ["anon", "authenticated"],
    },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 0);
  assertEquals(r.inalcançaveis.length, 1);
  assertEquals(r.inalcançaveis[0].nome, "produtos");
  assertStringIncludes(r.inalcançaveis[0].detalhe, "SELECT");
  assertStringIncludes(formatar(r), "INALCANÇÁVEL");
});

Deno.test("RPC ausente, RPC inalcançável pela origem e RPC ok são separados", () => {
  const refs = [
    {
      tipo: "rpc",
      nome: "create_marketplace_order_v25",
      onde: "src/hooks/useOrders.ts:10",
      papeis: ["anon", "authenticated"],
    },
    {
      tipo: "rpc",
      nome: "confirmar_pagamento",
      onde: "supabase/functions/webhook-mercadopago/index.ts:20",
      papeis: ["service_role"],
    },
    {
      tipo: "rpc",
      nome: "get_admin_analytics_v2",
      onde: "src/hooks/useAnalytics.ts:336",
      papeis: ["anon", "authenticated"],
    },
    // A MESMA RPC do webhook, chamada de src: service_role não vale para src.
    {
      tipo: "rpc",
      nome: "confirmar_pagamento",
      onde: "src/hooks/useX.ts:1",
      papeis: ["anon", "authenticated"],
    },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 1);
  assertEquals(r.ausentes[0].nome, "create_marketplace_order_v25");
  assertEquals(r.ausentes[0].objeto, "função");
  assertEquals(r.inalcançaveis.length, 1);
  assertEquals(r.inalcançaveis[0].nome, "confirmar_pagamento");
  assert(r.inalcançaveis[0].onde.startsWith("src/"));
  assertEquals(r.ok.length, 2);
});

Deno.test("bucket ausente do storage é AUSENTE; bucket presente é ok (sem análise de permissão)", () => {
  const refs = [
    {
      tipo: "bucket",
      nome: "products",
      onde: "src/hooks/useProducts.ts:35",
      papeis: ["anon", "authenticated"],
    },
    {
      tipo: "bucket",
      nome: "banners-velhos",
      onde: "src/x.ts:1",
      papeis: ["anon", "authenticated"],
    },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 1);
  assertEquals(r.ausentes[0].nome, "banners-velhos");
  assertEquals(r.ausentes[0].objeto, "bucket de storage");
  assertEquals(r.ok.length, 1);
});

Deno.test("catálogo limpo com tudo presente: zero ausentes, zero inalcançáveis (o verde de hoje)", () => {
  const refs = [
    {
      tipo: "from",
      nome: "vw_produtos_public",
      onde: "a:1",
      papeis: ["anon", "authenticated"],
    },
    {
      tipo: "rpc",
      nome: "get_admin_analytics_v2",
      onde: "b:1",
      papeis: ["anon", "authenticated"],
    },
    {
      tipo: "bucket",
      nome: "products",
      onde: "c:1",
      papeis: ["anon", "authenticated"],
    },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.ausentes.length, 0);
  assertEquals(r.inalcançaveis.length, 0);
  assertEquals(r.ok.length, 3);
  assertEquals(formatar(r), "");
});

Deno.test("CASO REAL do dinheiro: .rpc com nome em VARIÁVEL é reportado como fora da auditoria (não some em silêncio)", () => {
  // O ternário de useOrders.ts elege create_marketplace_order_v23/v24 para a
  // variável `rpc` — o caminho do dinheiro. O detector não faz análise de
  // fluxo; o que ele PROMETE é declarar a lacuna (lição da revisão de 04/09).
  const codigo = `const rpc = opts?.comPagamentoOnline
    ? "create_marketplace_order_v24"
    : "create_marketplace_order_v23";
const { data } = await (supabase as any).rpc(rpc, { p_items: [] });`;
  const achados = extrairDeConteudo(codigo, "src/hooks/useOrders.ts");
  assertEquals(achados.rpc.length, 0); // não vira conferência literal
  assertEquals(achados.dinamicas.length, 1);
  assertEquals(achados.dinamicas[0].nome, "rpc");
  assertEquals(achados.dinamicas[0].chamada, "rpc");
  assertStringIncludes(achados.dinamicas[0].onde, "useOrders.ts:4");
});

Deno.test("edge function consulta com service_role alcança o que src não alcançaria", () => {
  // A MESMA tabela, duas origens: src (anon/auth → inalcançável) e edge
  // (service_role → ok). O detector decide por ORIGEM, não por objeto.
  const refs = [
    {
      tipo: "from",
      nome: "produtos",
      onde: "src/a.ts:1",
      papeis: ["anon", "authenticated"],
    },
    {
      tipo: "from",
      nome: "produtos",
      onde: "supabase/functions/calculate-shipping/index.ts:706",
      papeis: ["service_role"],
    },
  ];
  const r = avaliar(refs, CATÁLOGO());
  assertEquals(r.inalcançaveis.length, 1);
  assertEquals(r.ok.length, 1);
  assert(r.inalcançaveis[0].onde.startsWith("src/"));
  assert(r.ok[0].onde.includes("functions"));
});

/**
 * refDoProjeto / conferirProjeto — trava contra o defeito medido: o secret
 * DATABASE_URL do CI apontava para o projeto SANDBOX, não a loja
 * (cafkrminfnokvgjqtkle), e o script nunca conferia. O log só mostra o host
 * do pooler compartilhado (aws-0-us-west-2.pooler.supabase.com — IGUAL para
 * qualquer projeto); o ref mora no host direto `db.<ref>.supabase.co` ou no
 * usuário do pooler `<role>.<ref>` — QUALQUER role, não só `postgres`
 * (Supavisor aceita um role de leitura como `leitor_catalogo.<ref>`; uma
 * regra que exigisse o literal `postgres.` devolveria `null` para esse role
 * e ficaria vermelha para sempre).
 *
 * Refs FICTÍCIOS em TODOS os casos deste arquivo — só testa as funções puras
 * `refDoProjeto`/`conferirProjeto`, importadas isoladas, nunca através de
 * `main()`. A fiação de verdade (o `ci.yml` passar PROJETO_REF_ESPERADO com o
 * ref REAL da loja, e o processo `node scripts/...` recusar antes de
 * conectar) é coberta à parte, em tests/ci_objetos_do_codigo_test.ts.
 */
const REF_FICTICIO = "abcdefghijklmnopqrst";

Deno.test("refDoProjeto — pooler compartilhado: ref vem do usuário postgres.<ref>", () => {
  const url = `postgres://postgres.${REF_FICTICIO}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`;
  assertEquals(refDoProjeto(url), REF_FICTICIO);
});

Deno.test("refDoProjeto — host direto db.<ref>.supabase.co", () => {
  const url = `postgres://postgres@db.${REF_FICTICIO}.supabase.co:5432/postgres`;
  assertEquals(refDoProjeto(url), REF_FICTICIO);
});

Deno.test("refDoProjeto — pooler com ROLE DE LEITURA (não é 'postgres'): o achado real da revisão", () => {
  // O ci.yml deste commit recomenda um role só-de-leitura para o secret
  // DATABASE_URL. No Supavisor o usuário do pooler é <role>.<ref> para
  // QUALQUER role — uma regex presa ao literal "postgres." devolveria null
  // aqui e o guard ficaria vermelho para sempre com esse role.
  const url = `postgres://leitor_catalogo.${REF_FICTICIO}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`;
  assertEquals(refDoProjeto(url), REF_FICTICIO);
});

Deno.test("refDoProjeto — host com SUFIXO depois do domínio real (db.<ref>.supabase.co.evil.net): null", () => {
  // `$` no fim do padrão do host direto já cobre isto, mas o caso fica
  // explícito: um host forjado com o domínio verdadeiro NO MEIO não pode
  // colar o ref de ninguém.
  const url = `postgres://postgres@db.${REF_FICTICIO}.supabase.co.evil.net:5432/postgres`;
  assertEquals(refDoProjeto(url), null);
});

Deno.test("refDoProjeto — URL válida mas sem host/usuário reconhecível: null (não é erro, é 'não sei dizer')", () => {
  const url = "postgres://postgres@localhost:5432/postgres";
  assertEquals(refDoProjeto(url), null);
});

Deno.test("refDoProjeto — URL malformada não lança: null", () => {
  assertEquals(refDoProjeto("isto-nao-e-uma-url"), null);
  assertEquals(refDoProjeto(""), null);
});

Deno.test("conferirProjeto — ref igual ao esperado: ok", () => {
  const r = conferirProjeto(REF_FICTICIO, REF_FICTICIO);
  assertEquals(r.ok, true);
});

Deno.test("conferirProjeto — ref de outro projeto: reprova ANTES de qualquer query, com ::error::", () => {
  const r = conferirProjeto("outroprojetoxxxxxxxx", REF_FICTICIO);
  assertEquals(r.ok, false);
  assertStringIncludes(r.mensagem, "::error::");
  assertStringIncludes(r.mensagem, REF_FICTICIO);
  assertStringIncludes(r.mensagem, "outroprojetoxxxxxxxx");
});

Deno.test("conferirProjeto — ref não identificado (null): reprova com ::error::, não confunde com 'igual'", () => {
  const r = conferirProjeto(null, REF_FICTICIO);
  assertEquals(r.ok, false);
  assertStringIncludes(r.mensagem, "::error::");
  assertStringIncludes(r.mensagem, "não identificado");
});

// ─── Leitura do catálogo pela API somente leitura (29/09/2026) ──────────────
// O CI deixou de depender de DATABASE_URL (projeto pausado). O que estes casos
// travam: só o TRANSPORTE mudou — SQL e montagem do catálogo são os mesmos, e a
// falha de consulta NUNCA vira verde.

const REF_FALSO = "abcdefghijklmnopqrst";
const TOKEN_FALSO = "token-de-teste-que-nao-pode-vazar";

const LINHAS_REL = [
  { nome: "produtos", anon: false, authenticated: false, service_role: true },
  { nome: "vw_pub", anon: true, authenticated: true, service_role: true },
];
const LINHAS_FN = [
  { nome: "f", anon: false, authenticated: false, service_role: true },
  { nome: "f", anon: false, authenticated: true, service_role: false },
  { nome: "g", anon: false, authenticated: false, service_role: false },
];

/** fetch falso que responde por SQL e registra o que recebeu. */
function fetchFalso(
  respostas: Record<string, { status: number; corpo: string }>,
) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const impl = (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const query = JSON.parse(String(init.body)).query as string;
    const r = respostas[query] ?? {
      status: 500,
      corpo: "sem resposta semeada",
    };
    return Promise.resolve(new Response(r.corpo, { status: r.status }));
  };
  return { impl: impl as unknown as typeof fetch, chamadas };
}

const RESPOSTAS_OK = () => ({
  [SQL_RELACOES]: { status: 200, corpo: JSON.stringify(LINHAS_REL) },
  [SQL_FUNCOES]: { status: 200, corpo: JSON.stringify(LINHAS_FN) },
  [SQL_BUCKETS]: { status: 200, corpo: JSON.stringify([{ id: "products" }]) },
});

Deno.test("API: usa SÓ o endpoint somente leitura, com bearer, e as 3 consultas idênticas às constantes", async () => {
  const { impl, chamadas } = fetchFalso(RESPOSTAS_OK());
  await lerCatalogoPelaApi({
    token: TOKEN_FALSO,
    ref: REF_FALSO,
    fetchImpl: impl,
  });
  assertEquals(chamadas.length, 3);
  for (const c of chamadas) {
    assertEquals(
      c.url,
      `https://api.supabase.com/v1/projects/${REF_FALSO}/database/query/read-only`,
    );
    assertEquals(c.init.method, "POST");
    assertEquals(
      (c.init.headers as Record<string, string>).Authorization,
      `Bearer ${TOKEN_FALSO}`,
    );
  }
  assertEquals(
    chamadas.map((c) => JSON.parse(String(c.init.body)).query),
    [SQL_RELACOES, SQL_FUNCOES, SQL_BUCKETS],
  );
});

Deno.test("API e pg produzem o MESMO catálogo para as mesmas linhas (montagem única)", async () => {
  const { impl } = fetchFalso(RESPOSTAS_OK());
  const viaApi = await lerCatalogoPelaApi({
    token: TOKEN_FALSO,
    ref: REF_FALSO,
    fetchImpl: impl,
  });
  const viaPg = montarCatalogo(LINHAS_REL, LINHAS_FN, [{ id: "products" }]);
  assertEquals(viaApi, viaPg);
  // grants por sobrecarga agregados: f alcançável por authenticated E service_role
  assertEquals([...viaApi.funcoes.get("f")!].sort(), [
    "authenticated",
    "service_role",
  ]);
  assertEquals(viaApi.funcoes.get("g")!.size, 0);
  assertEquals(viaApi.bucketsAcessivel, true);
});

Deno.test("API: o veredito estrito não afrouxa — objeto ausente e inalcançável continuam reprovando", async () => {
  const { impl } = fetchFalso(RESPOSTAS_OK());
  const catalogo = await lerCatalogoPelaApi({
    token: TOKEN_FALSO,
    ref: REF_FALSO,
    fetchImpl: impl,
  });
  const r = avaliar(
    [
      {
        tipo: "from",
        nome: "vw_sumida",
        onde: "src/a.ts:1",
        papeis: ["anon", "authenticated"],
      },
      {
        tipo: "from",
        nome: "produtos",
        onde: "src/b.ts:2",
        papeis: ["anon", "authenticated"],
      },
      {
        tipo: "rpc",
        nome: "g",
        onde: "src/c.ts:3",
        papeis: ["anon", "authenticated"],
      },
    ],
    catalogo,
  );
  assertEquals(
    r.ausentes.map((a) => a.nome),
    ["vw_sumida"],
  );
  assertEquals(r.inalcançaveis.map((a) => a.nome).sort(), ["g", "produtos"]);
});

Deno.test("API: falha em relações ou funções é FATAL e o erro não carrega corpo nem token", async () => {
  for (const [qual, sql] of [
    ["relações", SQL_RELACOES],
    ["funções", SQL_FUNCOES],
  ] as const) {
    const respostas = RESPOSTAS_OK();
    respostas[sql] = {
      status: 401,
      corpo: `{"message":"Bearer ${TOKEN_FALSO} inválido","dado":"segredo"}`,
    };
    const { impl } = fetchFalso(respostas);
    let erro = "";
    try {
      await lerCatalogoPelaApi({
        token: TOKEN_FALSO,
        ref: REF_FALSO,
        fetchImpl: impl,
      });
    } catch (e) {
      erro = (e as Error).message;
    }
    assertStringIncludes(erro, qual);
    assertStringIncludes(erro, "HTTP 401");
    assertEquals(erro.includes(TOKEN_FALSO), false);
    assertEquals(erro.includes("segredo"), false);
  }
});

Deno.test("API: resposta 200 que não é lista de linhas também é FATAL (nunca vira verde)", async () => {
  const respostas = RESPOSTAS_OK();
  respostas[SQL_RELACOES] = { status: 200, corpo: '{"message":"ok"}' };
  const { impl } = fetchFalso(respostas);
  let erro = "";
  try {
    await lerCatalogoPelaApi({
      token: TOKEN_FALSO,
      ref: REF_FALSO,
      fetchImpl: impl,
    });
  } catch (e) {
    erro = (e as Error).message;
  }
  assertStringIncludes(erro, "sem lista de linhas");
});

Deno.test("API: storage inacessível deixa o bucket CEGO (mesma tolerância da conexão pg), sem derrubar tabelas e funções", async () => {
  const respostas = RESPOSTAS_OK();
  respostas[SQL_BUCKETS] = {
    status: 400,
    corpo: "permission denied for schema storage",
  };
  const { impl } = fetchFalso(respostas);
  const catalogo = await lerCatalogoPelaApi({
    token: TOKEN_FALSO,
    ref: REF_FALSO,
    fetchImpl: impl,
  });
  assertEquals(catalogo.bucketsAcessivel, false);
  assertEquals(catalogo.relacoes.size, 2);
});

Deno.test("API: ref fora do formato e token vazio são recusados antes de qualquer chamada", async () => {
  const { impl, chamadas } = fetchFalso(RESPOSTAS_OK());
  for (const ref of ["x/../outro", "ABCDEFGHIJKLMNOPQRST", "curto", ""]) {
    let recusou = false;
    try {
      await lerCatalogoPelaApi({ token: TOKEN_FALSO, ref, fetchImpl: impl });
    } catch {
      recusou = true;
    }
    assert(recusou, `ref ${JSON.stringify(ref)} deveria ser recusado`);
  }
  let semToken = false;
  try {
    await lerCatalogoPelaApi({ token: "", ref: REF_FALSO, fetchImpl: impl });
  } catch {
    semToken = true;
  }
  assert(semToken);
  assertEquals(chamadas.length, 0);
});

Deno.test("o SQL de catálogo do detector e o do wrapper do banco efêmero são IDÊNTICOS", () => {
  const efemero = Deno.readTextFileSync(
    new URL(
      "../scripts/ci/banco/objetos-do-codigo-efemero.cjs",
      import.meta.url,
    ),
  ).replace(/\r\n/g, "\n");
  for (const sql of [SQL_RELACOES, SQL_FUNCOES]) {
    assert(
      efemero.includes(sql.replace(/\r\n/g, "\n")),
      "o SQL do detector divergiu do wrapper do banco efêmero",
    );
  }
});
