import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  type IdentityAsset,
  type PublicStoreIdentity,
  cloneStoreIdentity,
  identityRevision,
} from "../src/lib/storeIdentity";

/**
 * KIT DO CI-PWA (frente ci-pwa, 14/09/2026).
 *
 * Adaptação do `tests/e2e/kit-jornadas.ts` (frente e2e-jornadas — crédito e
 * molde declarados no PR): a mesma loja fixture "de ninguém" — NENHUMA rede
 * externa, NENHUM dado real, NENHUMA cobrança — com duas diferenças de
 * desenho impostas pelo objeto de prova desta frente (o SERVICE WORKER):
 *
 *  1. A FICHA DA LOJA NÃO entra por `page.route`: requisições feitas PELO
 *     service worker (install → /identidade.json; navegação respondida por
 *     `respondWith`) não passam pelo roteamento de página do Playwright.
 *     Quem injeta a ficha no HTML e serve `/identidade.json` é o servidor
 *     de teste da frente (`e2e/pwa-servidor.mjs`), que lê o MESMO arquivo
 *     gravado aqui — fonte única, zero duplicação.
 *  2. As consultas REST do catálogo (fetch do supabase-js, cross-origin que
 *     o sw.ts devolve ao navegador) seguem por `page.route` — caminho
 *     provado pelas jornadas com o SW ativo.
 *
 * A identidade continua VALIDADA contra o módulo real
 * (`cloneStoreIdentity`/`identityRevision`): fixture fora do contrato falha
 * na hora, com a mensagem do validador de verdade.
 */

// Chave FICTÍCIA de formato válido (`sb_publishable_…`; ver
// src/lib/publicSupabaseKey.ts). NÃO é credencial: nunca tocou um projeto.
const CHAVE_PUBLICA_FIXTURA = "sb_publishable_pwa_e2e_sem_segredo";

// O validador (`normalizeSupabaseOrigin`) exige EXATAMENTE 20 caracteres
// `[a-z0-9]` antes de `.supabase.co`.
const REF_FIXTURA = "pwae2efixture0000001";
const ORIGEM_BANCO_FIXTURA = `https://${REF_FIXTURA}.supabase.co`;

// O leitor da ficha recusa host diferente do que o navegador carregou
// (`ficha.host !== location.hostname`) e o sw.ts confere o mesmo campo para
// o ícone de notificação. O servidor de teste escuta só em 127.0.0.1.
const HOST_DO_SERVIDOR = "127.0.0.1";
const PORTA_DO_SERVIDOR = 4174;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SHA_FIXTURA = "a".repeat(64);

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
    storeName: "Loja do Teste PWA",
    city: "São Paulo",
    state: "SP",
    theme: { primary: "#123456", secondary: "#008000", accent: "#FF8000" },
    assets,
    urls,
  };
}

export const URL_DO_SERVIDOR = `http://${HOST_DO_SERVIDOR}:${PORTA_DO_SERVIDOR}`;

/**
 * A ficha inteira, no formato que o porteiro escreve no HTML (schemaVersion 2).
 * Valida contra o módulo real antes de devolver — fixture fora do contrato
 * derruba o teste na hora.
 */
export async function fichaDaLojaFixtura(): Promise<string> {
  const identity = construirIdentidade();
  let revisao: string;
  try {
    cloneStoreIdentity(identity);
    revisao = await identityRevision(identity);
  } catch (erro) {
    throw new Error(
      `Fixture da ficha do PWA está fora do contrato da identidade: ${String(erro)}`,
    );
  }
  const ficha = {
    schemaVersion: 2,
    host: HOST_DO_SERVIDOR,
    identidade: {
      identity,
      localUrls: identity.urls,
      publicUrl: URL_DO_SERVIDOR,
      identityRevision: revisao,
    },
    conexao: {
      supabaseUrl: ORIGEM_BANCO_FIXTURA,
      publishableKey: CHAVE_PUBLICA_FIXTURA,
    },
    configuracao: {
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

/**
 * Caminho ÚNICO da ficha em disco: o config do Playwright chama
 * `escreverFichaNoTemp()` antes de subir o webServer, e o servidor de teste
 * (`e2e/pwa-servidor.mjs`) lê este MESMO caminho (recebido por env).
 */
export function caminhoDaFichaNoTemp(): string {
  return path.join(tmpdir(), "ikcous-pwa-e2e-ficha.json");
}

export async function escreverFichaNoTemp(): Promise<string> {
  const caminho = caminhoDaFichaNoTemp();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho determinístico (os.tmpdir() + nome fixo), como no buildStore.mjs
  await mkdir(path.dirname(caminho), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem: caminho fixo, conteúdo gerado pela fixture validada
  await writeFile(caminho, await fichaDaLojaFixtura(), "utf8");
  return caminho;
}

/** Linha de `v_store_config` no molde de tests/browser-identity-app. */
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
    share_text: "Loja artificial do teste PWA",
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
      id: "pwa-produto-roupas",
      nome: PRODUTO_ROUPAS,
      descricao: "Produto sintético da categoria Roupas para o E2E do PWA.",
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
      product_variants: [],
    },
    {
      id: "pwa-produto-acessorios",
      nome: PRODUTO_ACESSORIOS,
      descricao: "Produto sintético da categoria Acessórios para o E2E do PWA.",
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

// Cópia HONESTA do smoke da expansão-ci (via kit-jornadas, 14/09): o service
// worker NÃO tem `document` e o portão de ambiente pode lançar DENTRO dele
// num build fixture (src/lib/env.ts:115) — o Playwright surfaca isso como
// `pageerror` da página. É o guarda falando alto num ambiente SEM env por
// desenho; qualquer OUTRA exceção derruba o teste.
const ENV_GUARD_DO_SERVICE_WORKER = "[EnvGuard] Variáveis de ambiente ausentes";

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Instala as rotas sintéticas do banco fixture (consultas REST e marca no
 * Storage público). Chamar UMA vez por teste, antes do primeiro `goto`.
 * A FICHA fica por conta do servidor de teste (ver cabeçalho do kit).
 */
export async function instalarBancoFixtura(page: Page): Promise<void> {
  await page.route("**/*", async (rota) => {
    const pedido = rota.request();
    const url = new URL(pedido.url());

    // Fora do banco fixture: deixa o servidor de teste responder (dist).
    if (url.origin !== ORIGEM_BANCO_FIXTURA) {
      await rota.fallback();
      return;
    }

    // Marca da loja no Storage público: PNG 1x1 (original ou variante
    // redimensionada — src/lib/imageUrl.ts).
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

    // As consultas públicas do catálogo com linhas sintéticas.
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

    // Qualquer outra leitura do banco fixture: lista vazia.
    await rota.fulfill({ status: 200, headers: JSON_HEADERS, body: "[]" });
  });
}

/** Espera o BOOT de verdade com as três defesas do smoke (copiadas): React
 * montou no #root; o guardian saiu do DOM; a tela "ERRO DE AMBIENTE" não
 * existe. Usável tanto no primeiro goto quanto DEPOIS de um reload feito
 * pelo próprio app (não navega por conta própria). */
export async function esperarBootLimpo(page: Page): Promise<string[]> {
  const errosSemCaptura: string[] = [];
  page.on("pageerror", (erro) => {
    if (!erro.message.startsWith(ENV_GUARD_DO_SERVICE_WORKER)) {
      errosSemCaptura.push(erro.message);
    }
  });

  await page.waitForFunction(
    () => document.querySelector("#root")?.children.length > 0,
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("silent-guardian-loader"),
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForFunction(
    () => !document.body.innerText.includes("ERRO DE AMBIENTE"),
    undefined,
    { timeout: 45_000 },
  );
  return errosSemCaptura;
}

/** Abre a loja pela porta da frente: banco fixture + goto + boot limpo +
 * catálogo na tela. Devolve o coletor de exceções pós-boot (chamar no FIM
 * do teste para cobrir a jornada inteira). */
export async function abrirLojaPwa(page: Page): Promise<() => string[]> {
  await instalarBancoFixtura(page);
  const resposta = await page.goto("/");
  if (resposta?.status() !== 200) {
    throw new Error(
      `A home do servidor de teste não respondeu 200 (veio ${resposta?.status()}).`,
    );
  }
  const erros = await esperarBootLimpo(page);
  await page
    .getByText(PRODUTO_ROUPAS, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
  if (erros.length > 0) {
    throw new Error(
      `Exceção(ões) sem captura durante o boot: ${erros.join(" | ")}`,
    );
  }
  return () => erros;
}

/** Contador de boots: sobrevive a reloads e navegações NA MESMA ABA via
 * sessionStorage (cada documento nasce com window novo — só o storage da
 * aba atravessa). Contexto novo de teste = aba nova = contador zerado. */
export async function contarBoots(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const atual = Number(sessionStorage.getItem("__pwa_boots") ?? "0") + 1;
    sessionStorage.setItem("__pwa_boots", String(atual));
    const janela = window as typeof window & { __boots?: number };
    janela.__boots = atual;
  });
}

export async function lerBoots(page: Page): Promise<number> {
  return page.evaluate(() => {
    const janela = window as typeof window & { __boots?: number };
    return janela.__boots ?? 0;
  });
}

export const PRODUTO_ROUPAS = "Camiseta do Teste PWA";
export const PRODUTO_ACESSORIOS = "Boné do Teste PWA";
