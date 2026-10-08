import { type Page, type Route, expect } from "@playwright/test";
import {
  type IdentityAsset,
  type PublicStoreIdentity,
  cloneStoreIdentity,
  identityRevision,
} from "../../src/lib/storeIdentity";

/**
 * KIT DAS JORNADAS E2E (frente e2e-jornadas, 14/09/2026).
 *
 * Prepara a loja fixture "de ninguém" para uma jornada de cliente real em
 * navegador de verdade: NENHUMA rede externa, NENHUM dado real, NENHUMA
 * cobrança. Tudo que o app pede é interceptado com `page.route` e devolvido
 * sintético:
 *
 *  1. A FICHA DA LOJA (data block `#ikcous-loja`, contrato
 *     `src/config/fichaDaLojaContract.ts`, schemaVersion 2) é INJETADA no
 *     HTML servido pelo preview — é o "caminho de ativação" planejado pela
 *     frente expansão-ci no cabeçalho do smoke deles, que este kit realiza
 *     sem tocar em produção nem no porteiro.
 *  2. `/identidade.json` devolve a MESMA ficha em JSON puro, como o
 *     porteiro faz para o service worker.
 *  3. As três consultas públicas do catálogo recebem linhas sintéticas no
 *     molde do kit `tests/browser-identity-app` (contratos medidos lá):
 *     `v_store_config`, `categorias` e `vw_produtos_public`.
 *  4. Logos/imagens da marca (Storage público) recebem um PNG 1x1.
 *  5. Qualquer outra leitura do banco (e qualquer outra requisição que não
 *     tenha resposta definida) é NEGADA, registrada e faz o teste FALHAR no
 *     `afterEach` (`exigirRedeSemImprevistos`) — nunca recebe lista vazia por
 *     padrão. A jornada precisa de catálogo, e o resto tem de ser pedido
 *     por quem escreve o teste.
 *
 * A identidade da ficha é VALIDADA AQUI contra o módulo de verdade
 * (`cloneStoreIdentity`/`identityRevision` de `src/lib/storeIdentity.ts`):
 * se a fixture estiver fora do contrato, o teste falha na hora, com a
 * mensagem do validor real — não contra uma cópia acostumada.
 */

// Chave FICTÍCIA de formato válido (`sb_publishable_…`; ver
// src/lib/publicSupabaseKey.ts). NÃO é credencial: nunca tocou um projeto.
const CHAVE_PUBLICA_FIXTURA = "sb_publishable_jornadas_e2e_sem_segredo";

// O validador (`normalizeSupabaseOrigin`) exige EXATAMENTE 20 caracteres
// `[a-z0-9]` antes de `.supabase.co`.
const REF_FIXTURA = "jornadase2efixture01";
const ORIGEM_BANCO_FIXTURA = `https://${REF_FIXTURA}.supabase.co`;

// O leitor da ficha recusa qualquer host diferente do que o navegador
// carregou (`ficha.host !== location.hostname`); o preview do Playwright
// roda em 127.0.0.1 (config `playwright.jornadas.config.ts`).
const HOST_DO_PREVIEW = "127.0.0.1";
const URL_DO_PREVIEW = `http://${HOST_DO_PREVIEW}:4173`;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SHA_FIXTURA = "a".repeat(64);

// Dimensões OBRIGATÓRIAS por papel (`parseBrandingAssets`): as quadradas
// exigem PNG com tamanho exato e `og` é 1200x630 por decisão da hub.
function asset(nome: string, extra?: Partial<IdentityAsset>): IdentityAsset {
  return {
    path: `v1/${SHA_FIXTURA}/${nome}`,
    sha256: SHA_FIXTURA,
    media_type: "image/png",
    bytes: 100,
    ...extra,
  };
}

function construirIdentidade(): PublicStoreIdentity {
  const origem = ORIGEM_BANCO_FIXTURA;
  const urlFor = (assetIndividual: IdentityAsset) =>
    `${origem}/storage/v1/object/public/branding/${assetIndividual.path}`;

  const header = asset("header.png");
  const loader = asset("loader.png");
  const favicon = asset("favicon.png");
  const appleTouch = asset("apple_touch.png", { width: 180, height: 180 });
  const icon192 = asset("icon_192.png", { width: 192, height: 192 });
  const icon512 = asset("icon_512.png", { width: 512, height: 512 });
  const maskable512 = asset("maskable_512.png", { width: 512, height: 512 });
  const og = asset("og.png", { width: 1200, height: 630 });
  const original = asset("original.png");
  const assets = {
    version: 1 as const,
    originals: [original],
    header,
    loader,
    favicon,
    apple_touch: appleTouch,
    icon_192: icon192,
    icon_512: icon512,
    maskable_512: maskable512,
    og,
  };
  const urls = {
    originals: assets.originals.map(urlFor),
    header: urlFor(header),
    loader: urlFor(loader),
    favicon: urlFor(favicon),
    apple_touch: urlFor(appleTouch),
    icon_192: urlFor(icon192),
    icon_512: urlFor(icon512),
    maskable_512: urlFor(maskable512),
    og: urlFor(og),
  };
  return {
    schemaVersion: 1,
    projectRef: REF_FIXTURA,
    storeName: "Loja das Jornadas",
    city: "São Paulo",
    state: "SP",
    theme: { primary: "#123456", secondary: "#008000", accent: "#FF8000" },
    assets,
    urls,
  };
}

/**
 * A ficha inteira, no formato que o porteiro escreve no HTML. `identityRevision`
 * é o sha256 canônico REAL (mesma função do porteiro), calculado contra o
 * validador verdadeiro — que também PROVA que a identidade inteira passa no
 * contrato (`cloneStoreIdentity` lança fora do contrato).
 */
export async function fichaDaLojaFixtura(): Promise<string> {
  const identity = construirIdentidade();
  let revisao: string;
  try {
    cloneStoreIdentity(identity);
    revisao = await identityRevision(identity);
  } catch (erro) {
    throw new Error(
      `Fixture da ficha das jornadas está fora do contrato da identidade: ${String(erro)}`,
    );
  }
  const ficha = {
    schemaVersion: 2,
    host: HOST_DO_PREVIEW,
    identidade: {
      identity,
      localUrls: identity.urls,
      publicUrl: URL_DO_PREVIEW,
      identityRevision: revisao,
    },
    conexao: {
      supabaseUrl: ORIGEM_BANCO_FIXTURA,
      publishableKey: CHAVE_PUBLICA_FIXTURA,
    },
    configuracao: {
      // Pagamento online DESLIGADO na fixture: a jornada do carrinho chega
      // ao passo de endereço e NUNCA chega a cobrar nada.
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: false,
      manutencao: false,
    },
  };
  // Mesmo escape do serializador canônico (src/hospedagem/ficha.ts): `</`
  // viraria fim de script dentro do data block.
  return JSON.stringify(ficha).replaceAll("</", "<\\/");
}

/** Linha de `v_store_config` no molde de tests/browser-identity-app (publicRow). */
function linhaConfig() {
  const identity = construirIdentidade();
  return {
    id: 1,
    store_name: identity.storeName,
    store_city: identity.city,
    store_state: identity.state,
    logo_url: identity.urls.header,
    primary_color: identity.theme.primary,
    secondary_color: identity.theme.secondary,
    accent_color: identity.theme.accent,
    branding_assets: identity.assets,
    business_hours: null,
    created_at: null,
    enable_coupons: false,
    enable_reviews: false,
    enabled_shipping_methods: ["local"],
    free_shipping_min: 100,
    home_sections: [],
    local_cep_range: null,
    local_delivery_fee: 0,
    min_app_version: null,
    origin_cep: null,
    push_marketing_enabled: false,
    real_time_sales_alerts: false,
    share_text: "Loja artificial das jornadas",
    shipping_coverage: "local",
    shipping_fee: 0,
    shipping_provider: "manual",
    theme_mode: "light",
    updated_at: null,
    whatsapp_number: null,
  };
}

function linhasCategorias() {
  return [
    {
      id: 1,
      nome: "Roupas",
      slug: "roupas",
      descricao: "",
      ativo: true,
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      id: 2,
      nome: "Acessórios",
      slug: "acessorios",
      descricao: "",
      ativo: true,
      created_at: "2026-09-01T00:00:00.000Z",
    },
  ];
}

function linhasProdutos() {
  const imagem = `${ORIGEM_BANCO_FIXTURA}/storage/v1/object/public/branding/v1/${SHA_FIXTURA}/header.png`;
  return [
    {
      id: "jornada-produto-roupas",
      nome: "Camiseta das Jornadas",
      descricao: "Produto sintético da categoria Roupas para o E2E.",
      preco_venda: 50,
      categoria: "Roupas",
      estoque: 10,
      ativo: true,
      frete_gratis: false,
      is_bestseller: false,
      data_cadastro: "2026-09-10T00:00:00.000Z",
      ultima_atualizacao: "2026-09-10T00:00:00.000Z",
      imagem_urls: [imagem],
      sold: 3,
      rating: 5,
      review_count: 0,
      tags: [],
      product_variants: [
        {
          id: "jornada-variante-p",
          product_id: "jornada-produto-roupas",
          sku: null,
          name: "Tamanho",
          value: "P",
          stock_increment: 5,
          price_override: null,
          active: true,
        },
        {
          id: "jornada-variante-m",
          product_id: "jornada-produto-roupas",
          sku: null,
          name: "Tamanho",
          value: "M",
          stock_increment: 5,
          price_override: null,
          active: true,
        },
      ],
    },
    {
      id: "jornada-produto-acessorios",
      nome: "Boné das Jornadas",
      descricao: "Produto sintético da categoria Acessórios para o E2E.",
      preco_venda: 30,
      categoria: "Acessórios",
      estoque: 7,
      ativo: true,
      frete_gratis: false,
      is_bestseller: false,
      data_cadastro: "2026-09-11T00:00:00.000Z",
      ultima_atualizacao: "2026-09-11T00:00:00.000Z",
      imagem_urls: [imagem],
      sold: 1,
      rating: 5,
      review_count: 0,
      tags: [],
      product_variants: [],
    },
  ];
}

// Cópia HONESTA do smoke da expansão-ci (e2e/app-boota-sem-tela-branca.spec.ts,
// 14/09): o service worker NÃO tem `document`, não lê a ficha e o portão de
// ambiente lança DENTRO dele (src/lib/env.ts:115) — o Playwright surfaca isso
// como `pageerror` da página num build fixture. É o guarda falando alto de
// propósito num ambiente SEM env POR DESENHO; qualquer OUTRA exceção derruba.
const ENV_GUARD_DO_SERVICE_WORKER = "[EnvGuard] Variáveis de ambiente ausentes";

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// GUARDA DE REDE — NEGA O DESCONHECIDO (04/10/2026, revisão de risco das
// jornadas de pagamento).
//
// Antes, o que não tinha stub ia para a REDE REAL (qualquer origem fora do
// banco fixture caía em `fallback()`) e toda leitura desconhecida do banco
// fixture recebia `[]` — uma RPC que devolve objeto ou `text` recebendo `[]`
// virava defeito FALSO na tela (o `get_my_cpf` quebrava a máscara de CPF),
// e uma chamada nova do app passava calada. Agora:
//
//  - só passa o que está numa LISTA BRANCA explícita: estáticos GET/HEAD do
//    próprio preview, a fonte simulada, e cada caminho do banco fixture com
//    resposta DEFINIDA (`STUBS_DO_BANCO` abaixo, mais os kits que se
//    registram por cima: sessão e pagamento);
//  - todo o resto é ABORTADO e REGISTRADO (método + origem + caminho + só os
//    NOMES dos parâmetros — nunca os valores, onde moraria uma chave);
//  - cada spec chama `exigirRedeSemImprevistos` no `afterEach`: lista não
//    vazia derruba o teste com a lista na mensagem.
//
// O service worker fica bloqueado no config das jornadas: requisição feita
// por ele não passa pelas rotas da PÁGINA (o SW busca imagens do Storage
// direto). A guarda de CONTEXTO abaixo é a segunda trava: o que escapar das
// rotas da página e não for do preview também é negado e registrado.
// ---------------------------------------------------------------------------

const registrosDaRede = new WeakMap<Page, string[]>();

/** As requisições NÃO previstas que a guarda abortou nesta página. */
export function requisicoesNaoPrevistas(page: Page): string[] {
  let lista = registrosDaRede.get(page);
  if (!lista) {
    lista = [];
    registrosDaRede.set(page, lista);
  }
  return lista;
}

/** Método + origem + caminho + NOMES dos parâmetros (valores nunca). */
export function descreverSemSegredo(metodo: string, urlCrua: string): string {
  try {
    const url = new URL(urlCrua);
    const nomes = [...new Set(url.searchParams.keys())];
    const busca = nomes.length > 0 ? `?{${nomes.join(",")}}` : "";
    return `${metodo} ${url.origin}${url.pathname}${busca}`;
  } catch {
    return `${metodo} <url ilegível>`;
  }
}

/** Aborta a requisição e a registra como NÃO prevista. */
export async function negarNaoPrevista(page: Page, rota: Route): Promise<void> {
  const pedido = rota.request();
  requisicoesNaoPrevistas(page).push(
    descreverSemSegredo(pedido.method(), pedido.url()),
  );
  await rota.abort("blockedbyclient");
}

/**
 * Para o `test.afterEach` de TODO spec das jornadas: falha com a lista das
 * requisições não previstas.
 */
export async function exigirRedeSemImprevistos({
  page,
}: {
  page: Page;
}): Promise<void> {
  expect(
    requisicoesNaoPrevistas(page),
    "requisições NÃO previstas (abortadas pela guarda de rede)",
  ).toEqual([]);
}

/**
 * Arquivos da RAIZ do build que o index.html carrega (medidos: são os que as
 * jornadas pedem). Qualquer outro caminho do preview é desconhecido.
 */
const ESTATICOS_DA_RAIZ: ReadonlySet<string> = new Set<string>([
  "/loading.css",
  "/silent-guardian.js",
]);

/**
 * Pastas do build com nome por conteúdo: o bundle (`/assets/`, com hash) e a
 * identidade FIXTURE da loja que o build assa (`/store-identity/v1/<sha>/`).
 */
const PASTAS_DO_BUILD = ["/assets/", "/store-identity/v1/"] as const;

/** Estático do build: uma das pastas acima ou um arquivo da raiz listado. */
function estaticoDoBuild(caminho: string): boolean {
  return (
    PASTAS_DO_BUILD.some((pasta) => caminho.startsWith(pasta)) ||
    ESTATICOS_DA_RAIZ.has(caminho)
  );
}

/**
 * Busca o documento no servidor de preview. Se ele não responde, o erro diz
 * ONDE está a causa: o log da rodada grava a hora e o código de saída do
 * preview (medido em 04/10/2026: o varredor de órfãos da máquina matava o
 * `vite preview` no meio da rodada — ECONNREFUSED em toda jornada seguinte).
 */
export async function buscarDocumentoDoPreview(rota: Route) {
  try {
    return await rota.fetch();
  } catch (erro) {
    const rodada = process.env.IKCOUS_E2E_RODADA ?? "?";
    throw new Error(
      `O servidor de preview (127.0.0.1:4173) não respondeu: ${String(erro)}. Se ele morreu no meio da rodada, a hora e o código de saída estão em test-results/preview-logs/preview-${rodada}.log`,
    );
  }
}

/** A fonte Inter do index.html: CSS vazio (a tela cai na fonte do sistema). */
const URL_DA_FONTE_DO_GOOGLE = "https://fonts.googleapis.com/css2?";

/**
 * Leituras do banco fixture com resposta DEFINIDA além do catálogo. Cada uma
 * tem a FORMA que a fonte real devolve (lista para tabela/view; o tipo da
 * RPC para RPC). Só GET (leitura) — escrita sem stub é negada.
 */
const STUBS_DO_BANCO: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  // Tabelas que o app lê no boot e na navegação; a loja fixture não tem
  // nenhuma linha delas (lista vazia é o que a tabela real devolve vazia).
  ["/rest/v1/banners", []],
  ["/rest/v1/favorites", []],
  ["/rest/v1/notificacoes", []],
  ["/rest/v1/cart_items", []],
  // Tela do produto: perguntas e avaliações públicas (nenhuma na fixture).
  ["/rest/v1/vw_questions_public", []],
  ["/rest/v1/vw_reviews_public", []],
]);

/**
 * Instala TODAS as rotas sintéticas da jornada. Chamar UMA vez por teste,
 * antes do primeiro `goto`. Depois, usar `abrirLoja`.
 */
export async function instalarLojaFixtura(page: Page): Promise<void> {
  const ficha = await fichaDaLojaFixtura();
  requisicoesNaoPrevistas(page);

  // Segunda trava (contexto): o que não é do preview e escapou das rotas da
  // página é negado e registrado. Do preview, segue para o servidor local.
  await page.context().route("**/*", async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    if (
      url.origin === URL_DO_PREVIEW &&
      pedido.method() === "GET" &&
      estaticoDoBuild(url.pathname)
    ) {
      await rota.fallback();
      return;
    }
    await negarNaoPrevista(page, rota);
  });

  // Realtime: aceito e MUDO — nenhum socket chega a servidor nenhum (sem
  // `connectToServer`). Socket de qualquer outro lugar é negado.
  await page.routeWebSocket(/.*/, (ws) => {
    const url = new URL(ws.url());
    const doBanco =
      url.origin.replace(/^wss:/, "https:") === ORIGEM_BANCO_FIXTURA &&
      url.pathname.startsWith("/realtime/");
    if (!doBanco) {
      requisicoesNaoPrevistas(page).push(
        descreverSemSegredo("WEBSOCKET", ws.url()),
      );
      ws.close();
    }
  });

  await page.route("**/*", async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());

    // 1) Documentos da própria origem: o HTML do preview ganha a ficha.
    if (
      pedido.resourceType() === "document" &&
      pedido.method() === "GET" &&
      url.origin === URL_DO_PREVIEW
    ) {
      const resposta = await buscarDocumentoDoPreview(rota);
      const corpo = (await resposta.text()).replace(
        "<head>",
        `<head><script type="application/json" id="ikcous-loja">${ficha}</script>`,
      );
      await rota.fulfill({
        status: resposta.status(),
        headers: { "content-type": "text/html; charset=utf-8" },
        body: corpo,
      });
      return;
    }

    // 2) A mesma ficha em JSON puro para o service worker (caminho do porteiro).
    if (
      url.origin === URL_DO_PREVIEW &&
      pedido.method() === "GET" &&
      url.pathname === "/identidade.json"
    ) {
      await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: ficha });
      return;
    }

    // 3) Estáticos do BUILD servidos pelo preview: só GET e só os caminhos
    // da lista — o resto do preview cai na mesma regra do desconhecido.
    if (url.origin === URL_DO_PREVIEW) {
      if (pedido.method() === "GET" && estaticoDoBuild(url.pathname)) {
        await rota.fallback();
        return;
      }
      await negarNaoPrevista(page, rota);
      return;
    }

    // 3b) A fonte do index.html: simulada, nunca vai à rede.
    if (
      pedido.method() === "GET" &&
      pedido.url().startsWith(URL_DA_FONTE_DO_GOOGLE)
    ) {
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "text/css" },
        body: "/* fonte simulada (jornadas e2e) */",
      });
      return;
    }

    // Qualquer outra origem fora do banco fixture: NEGADA. Do banco, só
    // LEITURA tem stub aqui (o que escreve vem dos kits por cima, por
    // método + caminho).
    if (url.origin !== ORIGEM_BANCO_FIXTURA || pedido.method() !== "GET") {
      await negarNaoPrevista(page, rota);
      return;
    }

    // 4) Marca da loja no Storage público: PNG 1x1. O app pode pedir o
    // original (`/object/public/…`) ou a variante redimensionada
    // (`/render/image/public/…`, src/lib/imageUrl.ts) — as duas servem.
    if (
      url.pathname.startsWith("/storage/v1/object/public/branding/") ||
      url.pathname.startsWith("/storage/v1/render/image/public/branding/")
    ) {
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "image/png" },
        body: PNG_1X1,
      });
      return;
    }

    // 5) As consultas públicas do catálogo com linhas sintéticas.
    if (url.pathname === "/rest/v1/v_store_config") {
      await rota.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify([linhaConfig()]),
      });
      return;
    }
    if (url.pathname === "/rest/v1/categorias") {
      await rota.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(linhasCategorias()),
      });
      return;
    }
    if (url.pathname === "/rest/v1/vw_produtos_public") {
      await rota.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(linhasProdutos()),
      });
      return;
    }

    // 6) Leituras com resposta DEFINIDA (tabela acima).
    if (STUBS_DO_BANCO.has(url.pathname)) {
      await rota.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(STUBS_DO_BANCO.get(url.pathname)),
      });
      return;
    }

    // 7) Todo o resto do banco fixture (RPC, tabela, edge, escrita) sem
    // resposta definida: NEGADO e registrado. Nunca mais `[]` por padrão.
    await negarNaoPrevista(page, rota);
  });
}

/**
 * Abre a home e ESPERA O BOOT de verdade, com as TRÊS defesas do smoke da
 * expansão-ci (copiadas de lá, não reinventadas): React montou no #root; o
 * guardian saiu do DOM; a tela "ERRO DE AMBIENTE" NÃO existe; e nenhuma
 * exceção sem captura na página — exceto a do EnvGuard vinda do service
 * worker, filtrada pela constante acima.
 */
export async function abrirLoja(
  page: Page,
): Promise<() => { erros: string[] }> {
  const errosSemCaptura: string[] = [];
  page.on("pageerror", (erro) => {
    if (!erro.message.startsWith(ENV_GUARD_DO_SERVICE_WORKER)) {
      errosSemCaptura.push(erro.message);
    }
  });

  const resposta = await page.goto("/");
  if (resposta?.status() !== 200) {
    throw new Error(
      `A home do preview não respondeu 200 (veio ${resposta?.status()}).`,
    );
  }

  await page.waitForFunction(
    () => (document.querySelector("#root")?.children.length ?? 0) > 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("silent-guardian-loader"),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => !document.body.innerText.includes("ERRO DE AMBIENTE"),
    undefined,
    { timeout: 30_000 },
  );

  // Boot bom de verdade: o catálogo sintético chegou à tela.
  await page
    .getByText("Camiseta das Jornadas", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  if (errosSemCaptura.length > 0) {
    throw new Error(
      `Exceção(ões) sem captura durante o boot: ${errosSemCaptura.join(" | ")}`,
    );
  }
  // O spec chama isto NO FIM da jornada: exceptions PÓS-boot também contam
  // (a jornada inteira fica limpa, não só o primeiro render).
  return () => ({ erros: [...errosSemCaptura] });
}

// ---------------------------------------------------------------------------
// CLIENTE LOGADO FALSO (frente trocar-endereço-carrinho, 22/09/2026).
//
// As jornadas acima são de CONVIDADO. Algumas telas só existem para quem tem
// conta (ex.: o seletor de endereço do carrinho). Esta parte do kit monta uma
// sessão FICTÍCIA — nenhum projeto real, nenhum token real, nenhum dado de
// cliente: a conta, os endereços e as cotações são inventados aqui e todas as
// chamadas ao "banco" continuam interceptadas por `page.route`.
// ---------------------------------------------------------------------------

// Chave onde o supabase-js guarda a sessão: `sb-<primeiro rótulo do host>-
// auth-token` (defaultStorageKey do @supabase/supabase-js 2.x) — o app não
// passa `storageKey` próprio (src/lib/supabase.ts).
const CHAVE_DA_SESSAO_FIXTURA = `sb-${REF_FIXTURA}-auth-token`;

const ID_CLIENTE_FIXTURA = "00000000-0000-4000-8000-00000000c11e";

function base64Url(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

/** Usuário do Auth, no formato de `GET /auth/v1/user`. Nada real. */
function usuarioFixtura() {
  return {
    id: ID_CLIENTE_FIXTURA,
    aud: "authenticated",
    role: "authenticated",
    email: "cliente.jornada@exemplo.invalid",
    email_confirmed_at: "2026-09-01T00:00:00.000Z",
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { name: "Cliente das Jornadas" },
    identities: [],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

/**
 * Sessão no formato que o supabase-js persiste. O access token tem a FORMA de
 * um JWT (cabeçalho.corpo.assinatura) só para quem decodifica o corpo; a
 * assinatura é texto fixo — nunca foi emitido por servidor nenhum. Expira
 * daqui a 1 dia para o SDK não tentar renovar no meio da jornada.
 */
function sessaoFixtura() {
  const expiraEm = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const accessToken = [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(
      JSON.stringify({
        sub: ID_CLIENTE_FIXTURA,
        aud: "authenticated",
        role: "authenticated",
        email: "cliente.jornada@exemplo.invalid",
        exp: expiraEm,
        iat: expiraEm - 24 * 60 * 60,
        session_id: "00000000-0000-4000-8000-0000000005e5",
      }),
    ),
    "assinatura-ficticia-das-jornadas",
  ].join(".");
  return {
    access_token: accessToken,
    refresh_token: "refresh-ficticio-das-jornadas",
    token_type: "bearer",
    expires_in: 24 * 60 * 60,
    expires_at: expiraEm,
    user: usuarioFixtura(),
  };
}

/** Linha de `user_addresses` inventada (a tabela que o useAddresses lê). */
export interface EnderecoFixtura {
  id: string;
  name: string;
  cep: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  is_default: boolean;
}

const APELIDOS_FIXTURA = [
  "Casa",
  "Trabalho",
  "Casa da Vó",
  "Academia",
  "Escritório Centro",
  "Sítio",
  "Casa da Praia",
  "Loja da Tia",
  "Faculdade",
  "Consultório",
  "Apartamento Novo",
  "Depósito",
];

/**
 * `quantidade` endereços fictícios; o primeiro é o principal. CEPs
 * distintos por endereço (a cotação fake varia por CEP), todos em ruas
 * inventadas.
 */
export function enderecosFixtura(quantidade: number): EnderecoFixtura[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000000ad${String(i).padStart(3, "0")}`,
    name: APELIDOS_FIXTURA.at(i) ?? `Endereço ${i + 1}`,
    cep: i === 0 ? "38500-000" : `01${String(100 + i).padStart(3, "0")}-000`,
    street: `Rua Fictícia ${i + 1}`,
    number: String(10 + i),
    neighborhood: "Bairro Inventado",
    city: i === 0 ? "Monte Carmelo" : "São Paulo",
    state: i === 0 ? "MG" : "SP",
    is_default: i === 0,
  }));
}

/**
 * Cotação fake de `calculate-shipping`, determinística por CEP: o CEP do
 * endereço principal (38500-000) tem entrega local de R$ 10; qualquer outro
 * recebe um PAC cujo preço depende do CEP — trocar de endereço MUDA o frete
 * que aparece no card, e o teste consegue provar que recotou.
 */
export function cotacaoFixtura(cepSoDigitos: string) {
  if (cepSoDigitos === "38500000") {
    return [
      {
        id: "local-delivery",
        name: "Entrega local",
        price: 10,
        deliveryDays: 1,
        provider: "local",
      },
    ];
  }
  const variacao = Number(cepSoDigitos.slice(2, 5)) % 50;
  return [
    {
      id: "melhorenvio-pac",
      name: "PAC",
      price: 20 + variacao,
      deliveryDays: 6,
      provider: "melhor_envio",
    },
  ];
}

/**
 * Instala o cliente logado FALSO. Chamar DEPOIS de `instalarLojaFixtura` e
 * ANTES de `abrirLoja`: as rotas daqui têm precedência (Playwright roda a
 * rota registrada por último primeiro) e devolvem o controle ao kit da loja
 * com `fallback()` para tudo que não é delas.
 */
export async function instalarSessaoClienteFixtura(
  page: Page,
  opcoes: { enderecos: EnderecoFixtura[] },
): Promise<void> {
  const sessao = sessaoFixtura();
  await page.addInitScript(
    ([chave, valor]) => {
      window.localStorage.setItem(chave, valor);
    },
    [CHAVE_DA_SESSAO_FIXTURA, JSON.stringify(sessao)] as const,
  );

  await page.route(`${ORIGEM_BANCO_FIXTURA}/**`, async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());
    const responderJson = (corpo: unknown, status = 200) =>
      rota.fulfill({
        status,
        headers: JSON_HEADERS,
        body: JSON.stringify(corpo),
      });

    const chave = `${pedido.method()} ${url.pathname}`;
    if (chave === "GET /auth/v1/user") {
      await responderJson(usuarioFixtura());
      return;
    }
    if (chave === "POST /auth/v1/token") {
      await responderJson(sessaoFixtura());
      return;
    }
    if (chave === "POST /auth/v1/logout") {
      await rota.fulfill({ status: 204, body: "" });
      return;
    }
    // O carrinho do cliente logado sincroniza com o banco (CartContext). A
    // RPC real devolve `void` — o PostgREST responde 204 sem corpo.
    if (chave === "POST /rest/v1/rpc/sync_cart_atomic") {
      await rota.fulfill({ status: 204, body: "" });
      return;
    }
    if (chave === "POST /rest/v1/rpc/get_my_complete_profile") {
      await responderJson([
        {
          id: ID_CLIENTE_FIXTURA,
          full_name: "Cliente das Jornadas",
          avatar_url: "",
          cover_url: "",
          role: "customer",
          whatsapp: "",
          created_at: "2026-09-01T00:00:00.000Z",
        },
      ]);
      return;
    }
    if (chave === "POST /rest/v1/rpc/is_admin") {
      await responderJson(false);
      return;
    }
    // Só a LEITURA dos endereços: escrita não tem stub (cai na guarda).
    if (chave === "GET /rest/v1/user_addresses") {
      await responderJson(
        opcoes.enderecos.map((e) => ({
          ...e,
          user_id: ID_CLIENTE_FIXTURA,
          recipient_name: "Cliente das Jornadas",
          complement: null,
          reference: null,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
        })),
      );
      return;
    }
    if (chave === "POST /functions/v1/calculate-shipping") {
      let cep = "";
      try {
        cep = String(
          (pedido.postDataJSON() as { cep?: string } | null)?.cep ?? "",
        ).replace(/\D/g, "");
      } catch {
        cep = "";
      }
      await responderJson({ options: cotacaoFixtura(cep) });
      return;
    }
    await rota.fallback();
  });
}

export const PRODUTO_ROUPAS = "Camiseta das Jornadas";
export const PRODUTO_ACESSORIOS = "Boné das Jornadas";
export const CATEGORIA_ROUPAS = "Roupas";
export const CATEGORIA_ACESSORIOS = "Acessórios";
