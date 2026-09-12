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

// T3c (ADENDO — RODADA C, 11/09/2026): o ramo de robô deixou de resolver a
// conexão "por fora" (`resolverConexao` isolado) e passou a chamar
// `obterFichaValidada` — a MESMA trava que o documento usa (resolver +
// concordar + cachear). Isso significa que, a partir de agora, o robô
// TAMBÉM precisa de uma `v_store_config` válida (identidade + o
// `dominio_publico` batendo com o host) antes de sequer tentar o produto —
// os dublês abaixo passaram a simular as DUAS chamadas de rede
// (`v_store_config` para identidade/domínio, `vw_produtos_public` para o
// produto), não só a última. `VITE_SUPABASE_URL` precisa ter o formato que
// `normalizeSupabaseOrigin` exige (`https://` + 20 chars `[a-z0-9]` +
// `.supabase.co`) — um host qualquer como o antigo `supa-fake.local` falha
// a validação de ORIGEM antes de qualquer fetch.
const HOST_LOJA_TESTE = "loja-teste.vercel.app";
const ORIGEM_SUPABASE_VALIDA = "https://abcdefghij0123456789.supabase.co";

const ENV_SUPABASE_BASE = {
  VITE_SUPABASE_URL: ORIGEM_SUPABASE_VALIDA,
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

// Ficha válida mínima (mesmo molde de `linhaFixture` em
// `tests/front/porteiro-fluxo.test.ts`) — só o que `parseStoreIdentity`
// (`src/lib/storeIdentity.ts`) exige: cada asset com `path` no formato
// `v1/<sha256>/<arquivo>`, `sha256` igual ao trecho do path, dimensões
// batendo com o papel (ícones quadrados, `og` 1200x630).
const HASH_FIXTURE = "a".repeat(64);
function assetFixture(nome: string, largura: number, altura: number) {
  return {
    path: `v1/${HASH_FIXTURE}/${nome}.png`,
    sha256: HASH_FIXTURE,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  };
}
function identidadeFixture(nome: string, origin: string) {
  const header = assetFixture("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#111111",
    secondary_color: "#654321",
    accent_color: "#abcdef",
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: assetFixture("loader", 64, 64),
      favicon: assetFixture("favicon", 32, 32),
      apple_touch: assetFixture("apple", 180, 180),
      icon_192: assetFixture("icon192", 192, 192),
      icon_512: assetFixture("icon512", 512, 512),
      maskable_512: assetFixture("maskable", 512, 512),
      og: assetFixture("og", 1200, 630),
    },
  };
}

// Dublê combinado para o ramo de robô: responde `v_store_config` (os dois
// `select` — identidade e `dominio_publico`) COM uma ficha válida cujo
// `dominio_publico` bate com `HOST_LOJA_TESTE` (para `decidirConcordancia`
// devolver "ok"), e `vw_produtos_public` com o `produto`/`produtoStatus`
// pedido. `urlsCapturadas` recebe TODAS as URLs (agora 3 por requisição
// fresca: 2x `v_store_config` + 1x `vw_produtos_public`) — os testes que
// inspecionam a URL do produto filtram por `vw_produtos_public`
// explicitamente, nunca por posição, porque o cache de ficha do porteiro
// (módulo-level, compartilhado por todos os testes deste arquivo) pode
// reduzir esse número em requisições SUBSEQUENTES para o mesmo host.
function fetchRoboComFicha(
  opcoes: {
    produto?: unknown;
    produtoStatus?: number;
  },
  urlsCapturadas: string[],
) {
  const identidade = identidadeFixture("Loja Teste", ORIGEM_SUPABASE_VALIDA);
  return (input: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urlsCapturadas.push(url.toString());
    if (url.pathname === "/rest/v1/v_store_config") {
      // ETAPA 3: o `select` da consulta de concordância/configuração passou
      // a pedir 5 colunas numa chamada só (`dominio_publico` + os 4 valores
      // de `configuracao`, `SELECT_CONFIGURACAO_PUBLICA` em porteiro.ts) —
      // `startsWith` em vez do literal exato para não duplicar a lista de
      // colunas neste arquivo e não quebrar se a ordem mudar lá.
      if (url.searchParams.get("select")?.startsWith("dominio_publico")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                dominio_publico: HOST_LOJA_TESTE,
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: false,
              },
            ]),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([identidade]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.pathname === "/rest/v1/vw_produtos_public") {
      if (opcoes.produtoStatus !== undefined && opcoes.produtoStatus !== 200) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              code: "42501",
              details: null,
              hint: null,
              message: "permission denied for table produtos",
            }),
            {
              status: opcoes.produtoStatus,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      const linhas = opcoes.produto === undefined ? [] : [opcoes.produto];
      return Promise.resolve(
        new Response(JSON.stringify(linhas), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.reject(
      new Error(
        `URL não mapeada no dublê fetchRoboComFicha: ${url.toString()}`,
      ),
    );
  };
}

// Dublê ANTIGO, mantido só para o teste #6 (navegador): devolve o produto
// para QUALQUER URL, inclusive `v_store_config` — é exatamente essa
// incompatibilidade de forma (o produto não tem `store_name`,
// `dominio_publico`, etc.) que prova a falha fechada quando o esquema não
// bate.
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

function request(
  pathComQuery: string,
  userAgent: string,
  host: string = HOST_LOJA_TESTE,
): Request {
  return new Request(`https://${host}${pathComQuery}`, {
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
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  assertEquals(resp.headers.get("x-ikcous-og"), "produto");
  // Item 2 do brief T3c: x-ikcous-caderneta em toda resposta do ramo de
  // robô — "ausente" porque este teste não configura as três variáveis da
  // caderneta central.
  assertEquals(resp.headers.get("x-ikcous-caderneta"), "ausente");
  assertStringIncludes(
    html,
    `<meta property="og:image" content="${produto.imagem_url}"`,
  );
  assertStringIncludes(html, "Loucas Escova De Limpeza");
  assertStringIncludes(html, "R$ 14,90");

  // Causa 2, guardada: a URL consultada usa a VIEW pública, nunca a tabela.
  // Filtrado por `vw_produtos_public` (T3c: agora há também chamadas a
  // `v_store_config` para resolver a ficha — 2 numa requisição fresca, 0
  // se o cache de ficha do porteiro já estiver aquecido para este host de
  // um teste anterior).
  const urlsProduto = urls.filter((u) => u.includes("vw_produtos_public"));
  assertEquals(urlsProduto.length, 1);
  assertStringIncludes(urlsProduto[0], "vw_produtos_public");
  assert(
    !urlsProduto[0].includes("/produtos?"),
    `a URL consultada nao deveria conter "/produtos?": ${urlsProduto[0]}`,
  );
});

// ── 5. Regressão do defeito original: permission denied -> pass-through, com
// o header que prova QUE chegou a rodar e caiu no sem-produto.

Deno.test("middleware: robô + permission denied (42501) devolve pass-through com sem-produto", async () => {
  const urls: string[] = [];

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produtoStatus: 403 }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  assertEquals(resp.headers.get("x-middleware-next"), "1");
  assertEquals(resp.headers.get("x-ikcous-og"), "sem-produto");
  // Item 2 do brief T3c: presente também no sem-produto.
  assertEquals(resp.headers.get("x-ikcous-caderneta"), "ausente");
  assertEquals(await resp.text(), "");
});

// ── 6. Navegador comum em /product-detail: DEIXOU de ser pass-through. Com o
// matcher novo do porteiro (etapa 2 da escala, rodada 3 de correção,
// 11/09/2026), `/product-detail` é um DOCUMENTO como outro qualquer — todo
// documento passa pelo porteiro, não só a rota de robô. Este teste usa o
// dublê de fetch antigo (`fetchProdutoOk`, que só simula a consulta de
// `produtos`); o porteiro agora tenta ler `v_store_config` com ele e recebe
// forma inesperada (sem `dominio_publico`) -> 503 `banco-indisponivel`. Não é
// regressão do porteiro: é a expectativa deste teste que ficou velha. Medido
// com `deno run --allow-all --no-check` sobre o `middleware()` real.

Deno.test("middleware: navegador (Mozilla) em /product-detail cai no porteiro (503 banco-indisponivel, dublê não simula v_store_config)", async () => {
  const urls: string[] = [];
  // Host DEDICADO (nunca usado por um teste de sucesso): o cache de ficha
  // do porteiro é módulo-level e compartilhado por todos os testes deste
  // arquivo — se este host coincidisse com o de um teste que já resolveu
  // uma ficha BOA, este teste pegaria cache HIT (200) em vez do 503 que
  // prova a falha fechada.
  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchProdutoOk(produtoFake(), urls), () =>
      middleware(
        request(
          `/product-detail?id=${PRODUCT_ID}`,
          UA_NAVEGADOR,
          "loja-teste-navegador.vercel.app",
        ),
      ),
    ),
  );

  assertEquals(resp.status, 503);
  assertEquals(resp.headers.get("x-ikcous-porteiro"), "banco-indisponivel");
  assertEquals(resp.headers.get("x-middleware-next"), null);
  assert(
    urls.length > 0,
    "o porteiro consulta o banco mesmo para navegador comum, porque todo documento passa por ele agora",
  );
});

// ── 7. Robô em /cart: renomeado (rodada 3, 11/09/2026) — o título antigo
// dizia "fora do matcher", e isso virou mentira: `/cart` não tem extensão e
// por isso CASA o matcher novo (só documentos). Sem `IKCOUS_FROTA_URL`/
// `VITE_SUPABASE_URL` no ambiente deste teste, `resolverConexao` devolve
// `null` e o porteiro fecha com 503 `sem-loja` — falha fechada por desenho,
// não pass-through.

Deno.test("middleware: robô em /cart (dentro do matcher novo, sem env) recebe 503 sem-loja", async () => {
  // Host DEDICADO, pelo mesmo motivo do teste do navegador acima: sem env
  // nenhum, este teste só prova "sem-loja" se o cache do porteiro nunca
  // tiver visto este host com sucesso.
  // Revisor Opus (rodada C, menor): sem este envelope o teste dependia da
  // AUSENCIA de VITE_SUPABASE_*/IKCOUS_FROTA_* no processo — com elas
  // exportadas, o porteiro acha conexao e sai para a rede real.
  const resp = await comEnvAsync(
    {
      VITE_SUPABASE_URL: undefined,
      VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
      VITE_SUPABASE_ANON_KEY: undefined,
      IKCOUS_FROTA_URL: undefined,
      IKCOUS_FROTA_APIKEY: undefined,
      IKCOUS_FROTA_CHAVE: undefined,
    },
    () => middleware(request("/cart", UA_ROBO, "loja-teste-cart.vercel.app")),
  );
  assertEquals(resp.status, 503);
  assertEquals(resp.headers.get("x-ikcous-porteiro"), "sem-loja");
  assertEquals(resp.headers.get("x-middleware-next"), null);
  // Item 2 do brief T3c: presente também no 503 do ramo de robô.
  assertEquals(resp.headers.get("x-ikcous-caderneta"), "ausente");
});

// ── 8. Escape: nome com aspas e `<` não quebra a meta tag.

Deno.test("middleware: nome com aspas e < continua com a meta tag bem formada", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ nome: `Copo 300ml "Premium" <especial>` });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
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

// ── 9. Produto sem imagem: cai no fallback da FICHA (Storage da própria
// loja, `ficha.identidade.localUrls.og`), não mais em `resolverEnderecoPublico`
// (mudança de código do 11/09/2026 — o robô montava `og:image` colando
// `resolverEnderecoPublico()` com `/og-image.png`; agora usa a URL absoluta
// do Storage que a ficha já carrega, a mesma que `injetarFichaNoHtml` usa
// para o navegador — "uma trava, um lugar" também para este dado).
// `VITE_APP_URL` continua no ambiente do teste só para provar que deixou de
// influenciar o resultado.

Deno.test("middleware: produto sem imagem usa o og-image do Storage da ficha (localUrls.og), não mais o endereço público resolvido", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ imagem_url: null, imagem_urls: null });

  const resp = await comEnvAsync(
    { ...ENV_SUPABASE_BASE, VITE_APP_URL: "https://loja-savy.vercel.app" },
    () =>
      comFetch(fetchRoboComFicha({ produto }, urls), () =>
        middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
      ),
  );

  const html = await resp.text();
  const ogEsperado = `${ORIGEM_SUPABASE_VALIDA}/storage/v1/object/public/branding/v1/${HASH_FIXTURE}/og.png`;
  assertStringIncludes(
    html,
    `<meta property="og:image" content="${ogEsperado}" />`,
  );
  assert(
    !html.includes("ickous-marketplace.vercel.app/og-image.png"),
    "o fallback caiu no literal fixo da IKCOUS em vez da URL do Storage da ficha",
  );
  assert(
    !html.includes("loja-savy.vercel.app/og-image.png"),
    "o fallback ainda depende de resolverEnderecoPublico em vez da ficha",
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
    comFetch(fetchRoboComFicha({ produto: produtoFake() }, urls), () =>
      middleware(
        request(
          `/product-detail?id=${encodeURIComponent(idMalicioso)}`,
          UA_ROBO,
        ),
      ),
    ),
  );

  const urlsProduto = urls.filter((u) => u.includes("vw_produtos_public"));
  assertEquals(urlsProduto.length, 1);
  assert(
    !urlsProduto[0].includes("&limit="),
    `a URL da consulta nao deveria conter "&limit=" cru: ${urlsProduto[0]}`,
  );
  assertStringIncludes(urlsProduto[0], encodeURIComponent(idMalicioso));
  assertStringIncludes(urlsProduto[0], "vw_produtos_public");
});

Deno.test("middleware: id com ',' do PostgREST vai codificado na URL da consulta", async () => {
  const urls: string[] = [];
  const idComVirgula = "1,2";

  await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto: produtoFake() }, urls), () =>
      middleware(
        request(
          `/product-detail?id=${encodeURIComponent(idComVirgula)}`,
          UA_ROBO,
        ),
      ),
    ),
  );

  const urlsProduto = urls.filter((u) => u.includes("vw_produtos_public"));
  assertEquals(urlsProduto.length, 1);
  assert(
    !urlsProduto[0].includes(","),
    `a URL da consulta nao deveria conter "," cru: ${urlsProduto[0]}`,
  );
  assertStringIncludes(urlsProduto[0], "vw_produtos_public");
});

// ── 11. Decisão do dono (11/09/2026): imagem_urls=[] (default da coluna) não
// pode apagar imagem_url, e preço <= 0 não aparece na prévia.

Deno.test("middleware: imagem_urls vazio (default) com imagem_url preenchido usa a foto", async () => {
  const urls: string[] = [];
  const produto = produtoFake({
    imagem_urls: [],
    imagem_url: "https://cdn.exemplo.com/foto-unica.jpg",
  });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  assertStringIncludes(
    html,
    `<meta property="og:image" content="https://cdn.exemplo.com/foto-unica.jpg"`,
  );
});

Deno.test("middleware: preco_venda 0 não aparece no og:title", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ preco_venda: 0 });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  const tituloMatch = html.match(
    /<meta property="og:title" content="(.*?)" \/>/,
  );
  assert(
    tituloMatch,
    `og:title nao encontrado ou mal formado no HTML:\n${html}`,
  );
  assert(
    !tituloMatch[1].includes("R$"),
    `og:title com preco_venda 0 nao deveria mostrar preco: ${tituloMatch[1]}`,
  );
});

Deno.test("middleware: preco_venda 14.9 continua mostrando R$ 14,90 (regressão)", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ preco_venda: 14.9 });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  assertStringIncludes(html, "R$ 14,90");
});

// ── 12. Contrato da identidade (issue #533): o fallback da loja é a arte
// PNG 1200x630; a foto do produto não tem dimensão fixa, o robô mede.

Deno.test("middleware: produto sem foto usa og:image:width=1200 e og:image:height=630 (identidade)", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ imagem_url: null, imagem_urls: null });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  assertStringIncludes(
    html,
    '<meta property="og:image:width" content="1200" />',
  );
  assertStringIncludes(
    html,
    '<meta property="og:image:height" content="630" />',
  );
});

Deno.test("middleware: produto com foto não declara og:image:width nem og:image:height (o robô mede)", async () => {
  const urls: string[] = [];
  const produto = produtoFake();

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  assert(
    !html.includes("og:image:width"),
    `html nao deveria conter og:image:width com foto de produto: ${html}`,
  );
  assert(
    !html.includes("og:image:height"),
    `html nao deveria conter og:image:height com foto de produto: ${html}`,
  );
});

Deno.test("middleware: preco_venda negativo não aparece no og:title", async () => {
  const urls: string[] = [];
  const produto = produtoFake({ preco_venda: -5 });

  const resp = await comEnvAsync(ENV_SUPABASE_BASE, () =>
    comFetch(fetchRoboComFicha({ produto }, urls), () =>
      middleware(request(`/product-detail?id=${PRODUCT_ID}`, UA_ROBO)),
    ),
  );

  const html = await resp.text();
  const tituloMatch = html.match(
    /<meta property="og:title" content="(.*?)" \/>/,
  );
  assert(
    tituloMatch,
    `og:title nao encontrado ou mal formado no HTML:\n${html}`,
  );
  assert(
    !tituloMatch[1].includes("R$"),
    `og:title com preco_venda negativo nao deveria mostrar preco: ${tituloMatch[1]}`,
  );
});
