import type { Page } from "@playwright/test";
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
 *  5. Qualquer outra leitura do banco recebe lista vazia — a jornada
 *     precisa de catálogo, não de resto.
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

/**
 * Instala TODAS as rotas sintéticas da jornada. Chamar UMA vez por teste,
 * antes do primeiro `goto`. Depois, usar `abrirLoja`.
 */
export async function instalarLojaFixtura(page: Page): Promise<void> {
  const ficha = await fichaDaLojaFixtura();

  await page.route("**/*", async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());

    // 1) Documentos da própria origem: o HTML do preview ganha a ficha.
    if (pedido.resourceType() === "document" && url.origin === URL_DO_PREVIEW) {
      const resposta = await rota.fetch();
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
    if (url.origin === URL_DO_PREVIEW && url.pathname === "/identidade.json") {
      await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: ficha });
      return;
    }

    // 3) Fora do banco fixture, deixa o preview responder (estáticos do dist).
    if (url.origin !== ORIGEM_BANCO_FIXTURA) {
      await rota.fallback();
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

    // 6) Qualquer outra leitura do banco fixture: lista vazia.
    await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
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
    () => document.querySelector("#root")?.children.length > 0,
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

export const PRODUTO_ROUPAS = "Camiseta das Jornadas";
export const PRODUTO_ACESSORIOS = "Boné das Jornadas";
export const CATEGORIA_ROUPAS = "Roupas";
export const CATEGORIA_ACESSORIOS = "Acessórios";
