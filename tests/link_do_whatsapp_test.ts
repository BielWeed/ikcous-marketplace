// @ts-nocheck
// Teste da frente "link do WhatsApp aparece direito" (fix/link-link-whatsapp
// -aparece-direito-0809). Causa medida em CAUSA-MEDIDA.md (08/09/2026):
//
//   Causa 1: o endereço público da loja caía no host do DEPLOY (VERCEL_URL),
//   que muda a cada publicação e, na loja Savy, devolve 302 para o login da
//   Vercel — o robô do WhatsApp não baixa a foto de lá.
//
//   Causa 2: o middleware consultava a tabela `produtos`, que o papel anônimo
//   não pode ler (42501 permission denied). `response.ok` fica false e o
//   middleware cai no pass-through — sintoma idêntico a "o middleware nem
//   roda". O caminho público de verdade é a VIEW `vw_produtos_public`
//   (mesma que src/lib/realtimeSyncEngine.ts usa para quem não é admin).
//
// Este arquivo cobre as duas causas e adiciona: escape de HTML (nome/desc com
// aspas e `<` não podem quebrar a meta tag) e o header `x-ikcous-og`, que
// distingue "achou produto" de "é robô mas a consulta falhou" de "passou
// direto" — as duas últimas produzem respostas byte a byte iguais sem ele.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { escaparHtml, resolverEnderecoPublico } from "../middleware.ts";
// A importação de `resolverEnderecoPublico` de dentro de vite.config.ts
// quebra `npm run typecheck` (TS2559 — "weak type detection" não conta o
// índice de `ProcessEnv` como propriedade em comum com um tipo só de campos
// opcionais). A função foi DUPLICADA lá, com o mesmo corpo, e esta cópia
// também precisa do próprio teste — se alguém consertar só uma das duas, o
// teste da outra denuncia.
import { resolverEnderecoPublico as resolverEnderecoPublicoDoVite } from "../vite.config.ts";

const middlewareModule = await import("../middleware.ts");
const middleware = middlewareModule.default;

const UA_ROBO = "WhatsApp/2.23.20.0 A";
const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const PRODUCT_ID = "c7b692e4-1e18-4d51-97ba-889a6266d58e";

// ── Ambiente: mesmo padrão do resto do repo (estornar-pagamento/index_test.ts)
// — guarda o valor anterior de cada chave e restaura no finally, nunca deixa
// vazamento de env entre casos. `Deno.env.get/set/delete` (chamada de função
// com a chave como argumento) em vez de `process.env[chave]` (indexação
// dinâmica): é essa forma que evita o aviso `security/detect-object-injection`
// do eslint — o próprio middleware.ts lê `process.env` com propriedade
// literal, então o teste também pode.
async function comEnvAsync<T>(
  pares: Record<string, string | undefined>,
  executar: () => Promise<T>,
): Promise<T> {
  const anteriores: Array<[string, string | undefined]> = Object.entries(
    pares,
  ).map(([chave]) => [chave, Deno.env.get(chave)]);
  for (const [chave, valor] of Object.entries(pares)) {
    if (valor === undefined) Deno.env.delete(chave);
    else Deno.env.set(chave, valor);
  }
  try {
    return await executar();
  } finally {
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
  }
}

async function comFetch<T>(
  fetchFalso: any,
  executar: () => Promise<T>,
): Promise<T> {
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchFalso;
  try {
    return await executar();
  } finally {
    globalThis.fetch = anterior;
  }
}

const ENV_SUPABASE_BASE = {
  VITE_SUPABASE_URL: "https://supa-fake.local",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_de_teste",
  VITE_SUPABASE_ANON_KEY: undefined,
};

function produtoFake(overrides: Record<string, unknown> = {}) {
  return {
    nome: "Loucas Escova De Limpeza",
    descricao: "Recipiente para detergente",
    preco_venda: 14.9,
    imagem_url: "https://cdn.exemplo.com/foto.jpg",
    imagem_urls: null,
    ...overrides,
  };
}

function fetchProdutoOk(produto: unknown, urlsCapturadas: string[]) {
  return (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    urlsCapturadas.push(url);
    return Promise.resolve(
      new Response(JSON.stringify([produto]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

function fetchPermissionDenied(urlsCapturadas: string[]) {
  return (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    urlsCapturadas.push(url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          code: "42501",
          details: null,
          hint: null,
          message: "permission denied for table produtos",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
  };
}

function request(pathComQuery: string, userAgent: string): Request {
  return new Request(`https://loja-teste.vercel.app${pathComQuery}`, {
    headers: { "user-agent": userAgent },
  });
}

// ── 1. Resolução do endereço público — os 4 casos, na ordem de precedência.

Deno.test("resolverEnderecoPublico: usa VITE_APP_URL quando presente", () => {
  const resultado = resolverEnderecoPublico({
    VITE_APP_URL: "https://loja-savy.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "loja-savy-outro.vercel.app",
    VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
  });
  assertEquals(resultado, "https://loja-savy.vercel.app");
});

Deno.test("resolverEnderecoPublico: sem VITE_APP_URL, usa VERCEL_PROJECT_PRODUCTION_URL", () => {
  const resultado = resolverEnderecoPublico({
    VITE_APP_URL: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: "loja-savy.vercel.app",
    VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
  });
  assertEquals(resultado, "https://loja-savy.vercel.app");
});

Deno.test("resolverEnderecoPublico: só com VERCEL_URL, usa VERCEL_URL", () => {
  const resultado = resolverEnderecoPublico({
    VITE_APP_URL: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: undefined,
    VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
  });
  assertEquals(resultado, "https://loja-savy-deploy-xyz.vercel.app");
});

Deno.test("resolverEnderecoPublico: nenhuma das três, cai no literal", () => {
  const resultado = resolverEnderecoPublico({
    VITE_APP_URL: undefined,
    VERCEL_PROJECT_PRODUCTION_URL: undefined,
    VERCEL_URL: undefined,
  });
  assertEquals(resultado, "https://ickous-marketplace.vercel.app");
});

// ── 2. Regras de normalização do valor escolhido.

Deno.test("resolverEnderecoPublico: valor sem protocolo ganha https://", () => {
  const resultado = resolverEnderecoPublico({
    VERCEL_URL: "meu-deploy.vercel.app",
  });
  assertEquals(resultado, "https://meu-deploy.vercel.app");
});

Deno.test("resolverEnderecoPublico: valor com barra no fim volta sem barra", () => {
  const resultado = resolverEnderecoPublico({
    VITE_APP_URL: "https://loja-savy.vercel.app/",
  });
  assertEquals(resultado, "https://loja-savy.vercel.app");
});

Deno.test("resolverEnderecoPublico: valor só com espaços conta como vazio", () => {
  const resultado = resolverEnderecoPublico({
    VITE_APP_URL: "   ",
    VERCEL_PROJECT_PRODUCTION_URL: undefined,
    VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
  });
  assertEquals(resultado, "https://loja-savy-deploy-xyz.vercel.app");
});

// ── 2-bis. A cópia duplicada em vite.config.ts (mesmos 4 casos + normalização,
// resumidos numa rodada só — o corpo é idêntico, o que se guarda aqui é que
// as DUAS cópias continuam de acordo).

Deno.test("resolverEnderecoPublico (cópia do vite.config.ts): mesma precedência e normalização", () => {
  assertEquals(
    resolverEnderecoPublicoDoVite({
      VITE_APP_URL: "https://loja-savy.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "loja-savy-outro.vercel.app",
      VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
    }),
    "https://loja-savy.vercel.app",
  );
  assertEquals(
    resolverEnderecoPublicoDoVite({
      VERCEL_PROJECT_PRODUCTION_URL: "loja-savy.vercel.app",
      VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
    }),
    "https://loja-savy.vercel.app",
  );
  assertEquals(
    resolverEnderecoPublicoDoVite({
      VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
    }),
    "https://loja-savy-deploy-xyz.vercel.app",
  );
  assertEquals(
    resolverEnderecoPublicoDoVite({}),
    "https://ickous-marketplace.vercel.app",
  );
  assertEquals(
    resolverEnderecoPublicoDoVite({
      VITE_APP_URL: "https://loja-savy.vercel.app/",
    }),
    "https://loja-savy.vercel.app",
  );
  assertEquals(
    resolverEnderecoPublicoDoVite({
      VITE_APP_URL: "   ",
      VERCEL_URL: "loja-savy-deploy-xyz.vercel.app",
    }),
    "https://loja-savy-deploy-xyz.vercel.app",
  );
});

Deno.test("as duas cópias de resolverEnderecoPublico concordam em toda a bateria de casos", () => {
  const casos: AmbienteEnderecoPublico[] = [
    { VITE_APP_URL: "https://loja-savy.vercel.app" },
    { VERCEL_PROJECT_PRODUCTION_URL: "loja-savy.vercel.app" },
    { VERCEL_URL: "loja-savy-deploy-xyz.vercel.app" },
    {},
    { VITE_APP_URL: "loja-sem-protocolo.vercel.app" },
    { VITE_APP_URL: "https://loja-savy.vercel.app/" },
    { VITE_APP_URL: "   ", VERCEL_URL: "loja-savy-deploy-xyz.vercel.app" },
  ];
  for (const caso of casos) {
    assertEquals(
      resolverEnderecoPublico(caso),
      resolverEnderecoPublicoDoVite(caso),
      `as duas copias divergiram para ${JSON.stringify(caso)}`,
    );
  }
});

// ── 3. escaparHtml — usado nos testes de HTML abaixo, e testado isolado.

Deno.test('escaparHtml: escapa & < > " sem mexer no resto', () => {
  assertEquals(
    escaparHtml(`Copo 300ml "Premium" <a&b>`),
    "Copo 300ml &quot;Premium&quot; &lt;a&amp;b&gt;",
  );
});

// ── 4. Middleware — robô + produto existente: prévia completa.

Deno.test("middleware: robô + produto existente devolve prévia com foto, nome e preço", async () => {
  const urls: string[] = [];
  const produto = produtoFake();

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchProdutoOk(produto, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  assertEquals(resp.headers.get("x-ikcous-og"), "produto");
  assertStringIncludes(
    html,
    `<meta property="og:image" content="${produto.imagem_url}"`,
  );
  assertStringIncludes(html, "Loucas Escova De Limpeza");
  assertStringIncludes(html, "R$ 14,90");

  // Causa 2, guardada: a URL consultada usa a VIEW pública, nunca a tabela.
  assertEquals(urls.length, 1);
  assertStringIncludes(urls[0], "vw_produtos_public");
  assert(
    !urls[0].includes("/produtos?"),
    `a URL consultada nao deveria conter "/produtos?": ${urls[0]}`,
  );
});

// ── 5. Regressão do defeito original: permission denied -> pass-through, com
// o header que prova QUE chegou a rodar e caiu no sem-produto.

Deno.test("middleware: robô + permission denied (42501) devolve pass-through com sem-produto", async () => {
  const urls: string[] = [];

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchPermissionDenied(urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  assertEquals(resp.headers.get("x-middleware-next"), "1");
  assertEquals(resp.headers.get("x-ikcous-og"), "sem-produto");
  assertEquals(await resp.text(), "");
});

// ── 6. Navegador comum: pass-through, sem prévia de produto nenhuma.

Deno.test("middleware: navegador (Mozilla) em /product-detail é pass-through", async () => {
  const urls: string[] = [];
  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchProdutoOk(produtoFake(), urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_NAVEGADOR)),
    ),
  );

  assertEquals(resp.headers.get("x-middleware-next"), "1");
  assertEquals(resp.headers.get("x-ikcous-og"), "passa");
  assertEquals(
    urls.length,
    0,
    "navegador comum nao deveria disparar consulta ao Supabase",
  );
});

// ── 7. Robô fora do matcher: pass-through.

Deno.test("middleware: robô em caminho fora do matcher (/cart) é pass-through", async () => {
  const resp = await middleware(request("/cart", UA_ROBO));
  assertEquals(resp.headers.get("x-middleware-next"), "1");
  assertEquals(resp.headers.get("x-ikcous-og"), "passa");
});

// ── 8. Escape: nome com aspas e `<` não quebra a meta tag.

Deno.test("middleware: nome com aspas e < continua com a meta tag bem formada", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ nome: `Copo 300ml "Premium" <especial>` });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchProdutoOk(produto, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  // Nao pode sobrar aspas nem `<` cru dentro do valor do atributo og:title —
  // senao o atributo fecha no meio do nome e o resto vaza como HTML solto.
  // O atributo vive numa única linha do HTML gerado, então `.` (sem precisar
  // de `[^]`/dotAll) já cobre o conteúdo inteiro do valor.
  const tituloMatch = html.match(
    /<meta property="og:title" content="(.*?)" \/>/,
  );
  assert(
    tituloMatch,
    `og:title nao encontrado ou mal formado no HTML:\n${html}`,
  );
  assert(
    !tituloMatch[1].includes('"'),
    `og:title ainda contem aspas cruas: ${tituloMatch[1]}`,
  );
  assert(
    !tituloMatch[1].includes("<especial>"),
    `og:title ainda contem "<" cru: ${tituloMatch[1]}`,
  );
  assertStringIncludes(html, "&quot;Premium&quot;");
  assertStringIncludes(html, "&lt;especial&gt;");
});

// ── 9. Produto sem imagem: cai no fallback resolvido, não no literal fixo.

Deno.test("middleware: produto sem imagem usa o og-image do endereço público resolvido", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ imagem_url: null, imagem_urls: null });

  const resp = await comEnvAsync(
    { ...ENV_SUPABASE_BASE, VITE_APP_URL: "https://loja-savy.vercel.app" },
    () =>
      comFetch(fetchProdutoOk(produto, urls), () =>
        middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
      ),
  );

  const html = await resp.text();
  assertStringIncludes(
    html,
    `<meta property="og:image" content="https://loja-savy.vercel.app/og-image.png" />`,
  );
  assert(
    !html.includes("ickous-marketplace.vercel.app/og-image.png"),
    "o fallback caiu no literal fixo da IKCOUS em vez do endereço público resolvido da loja",
  );
});

// ── 10. Laudo Opus O2: o `id` vai codificado para o PostgREST — caractere
// com significado ali (`&`, `,`) não pode chegar cru na URL da consulta. O
// defeito era pré-existente e MORTO (a consulta batia na tabela `produtos`
// e morria no 42501 antes de qualquer coisa); este diff trocou para a view
// pública e ativou o caminho.

Deno.test("middleware: id com '&' do PostgREST vai codificado na URL da consulta", async () => {
  const urls: string[] = [];
  const idMalicioso = "1&limit=0";

  await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchProdutoOk(produtoFake(), urls), () =>
      middleware(
        request(
          `/product-detail?id=${encodeURIComponent(idMalicioso)}`,
          UA_ROBO,
        ),
      ),
    ),
  );

  assertEquals(urls.length, 1);
  assert(
    !urls[0].includes("&limit="),
    `a URL da consulta nao deveria conter "&limit=" cru: ${urls[0]}`,
  );
  assertStringIncludes(urls[0], encodeURIComponent(idMalicioso));
  assertStringIncludes(urls[0], "vw_produtos_public");
});

Deno.test("middleware: id com ',' do PostgREST vai codificado na URL da consulta", async () => {
  const urls: string[] = [];
  const idComVirgula = "1,2";

  await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchProdutoOk(produtoFake(), urls), () =>
      middleware(
        request(
          `/product-detail?id=${encodeURIComponent(idComVirgula)}`,
          UA_ROBO,
        ),
      ),
    ),
  );

  assertEquals(urls.length, 1);
  assert(
    !urls[0].includes(","),
    `a URL da consulta nao deveria conter "," cru: ${urls[0]}`,
  );
  assertStringIncludes(urls[0], "vw_produtos_public");
});
