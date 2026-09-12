// @vitest-environment jsdom
//
// `configuracaoDaLoja.ts` (src/config/configuracaoDaLoja.ts) é o módulo que
// os 6 leitores do app (checkout, push, admin, manutenção) vão consultar —
// etapa 3 da escala (11/09/2026). Este arquivo prova a metade em que a
// FICHA VENCE: com ficha presente, `lerConfiguracaoDaLoja()` e os 4 atalhos
// (`pagamentoOnlineLigado`, `chavePublicaMercadoPago`, `chavePublicaVapid`,
// `modoManutencao`) devolvem o bloco `configuracao` da ficha — nunca o
// `import.meta.env` assado, mesmo que ele esteja preenchido no build.
//
// Asserção sempre pela DIFERENÇA (valor da ficha != valor assado), mesmo
// padrão de `ficha-da-loja-vence-o-assado.test.ts`.
import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);

function asset(
  name: string,
  mediaType: string,
  width?: number,
  height?: number,
) {
  return {
    path: `v1/${HASH}/${name}`,
    sha256: HASH,
    media_type: mediaType,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function identidadeValida() {
  const header = asset("header.png", "image/png");
  const row = {
    store_name: "Loja Da Configuracao",
    store_city: null,
    store_state: null,
    primary_color: "#123456",
    secondary_color: "#abcdef",
    accent_color: "#fedcba",
    logo_url: `${SUPABASE_URL}/storage/v1/object/public/branding/${header.path}`,
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: header,
      favicon: asset("favicon.png", "image/png"),
      apple_touch: asset("apple.png", "image/png", 180, 180),
      icon_192: asset("icon192.png", "image/png", 192, 192),
      icon_512: asset("icon512.png", "image/png", 512, 512),
      maskable_512: asset("maskable.png", "image/png", 512, 512),
      og: asset("og.png", "image/png", 1200, 630),
    },
  };
  return parseStoreIdentity(row, SUPABASE_URL);
}

function fichaValida(
  overrides: Partial<FichaDaLoja["configuracao"]> = {},
): FichaDaLoja {
  return {
    schemaVersion: 2,
    host: "loja-config.exemplo.com",
    identidade: {
      identity: identidadeValida(),
      localUrls: {
        originals: ["https://cdn.exemplo/originals/o.png"],
        header: "https://cdn.exemplo/header.png",
        loader: "https://cdn.exemplo/loader.png",
        favicon: "https://cdn.exemplo/favicon.png",
        apple_touch: "https://cdn.exemplo/apple.png",
        icon_192: "https://cdn.exemplo/icon192.png",
        icon_512: "https://cdn.exemplo/icon512.png",
        maskable_512: "https://cdn.exemplo/maskable.png",
        og: "https://cdn.exemplo/og.png",
      },
      publicUrl: "https://loja-config.exemplo.com",
      identityRevision: "d".repeat(64),
    },
    conexao: {
      supabaseUrl: SUPABASE_URL,
      publishableKey: "sb_publishable_config_teste",
    },
    configuracao: {
      mpPublicKey: "APP_USR-da-loja-config",
      vapidPublicKey: "Bda-loja-config",
      pagamentoOnline: true,
      manutencao: false,
      ...overrides,
    },
  };
}

function injetarFicha(conteudo: string) {
  const elemento = document.createElement("script");
  elemento.type = "application/json";
  elemento.id = FICHA_DA_LOJA_ID;
  elemento.textContent = conteudo;
  document.head.appendChild(elemento);
}

async function importarLimpo() {
  vi.resetModules();
  return import("@/config/configuracaoDaLoja");
}

describe("configuracaoDaLoja.ts — a ficha vence o assado", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.stubGlobal("location", { hostname: "loja-config.exemplo.com" });
    // Ambiente assado preenchido de propósito — os testes provam que, com
    // ficha presente, ele NUNCA é lido.
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "APP_USR-assado-nunca-usado");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "Bassado-nunca-usado");
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "true");
    vi.stubEnv("VITE_MAINTENANCE_MODE", "true");
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ficha válida: lerConfiguracaoDaLoja() devolve o bloco da FICHA, diferente do assado", async () => {
    injetarFicha(JSON.stringify(fichaValida()));
    const { lerConfiguracaoDaLoja } = await importarLimpo();

    const configuracao = lerConfiguracaoDaLoja();
    expect(configuracao).toEqual({
      mpPublicKey: "APP_USR-da-loja-config",
      vapidPublicKey: "Bda-loja-config",
      pagamentoOnline: true,
      manutencao: false,
    });
    expect(configuracao.mpPublicKey).not.toBe("APP_USR-assado-nunca-usado");
  });

  it("ficha com pagamentoOnline: false e manutencao: true (loja fechada, mesmo com o assado ligado): os atalhos refletem a FICHA", async () => {
    injetarFicha(
      JSON.stringify(fichaValida({ pagamentoOnline: false, manutencao: true })),
    );
    const {
      pagamentoOnlineLigado,
      modoManutencao,
      chavePublicaMercadoPago,
      chavePublicaVapid,
    } = await importarLimpo();

    expect(pagamentoOnlineLigado()).toBe(false);
    expect(modoManutencao()).toBe(true);
    expect(chavePublicaMercadoPago()).toBe("APP_USR-da-loja-config");
    expect(chavePublicaVapid()).toBe("Bda-loja-config");
  });

  it("ficha com mpPublicKey e vapidPublicKey null (recurso desligado NESTA loja): os atalhos devolvem null, não o assado", async () => {
    injetarFicha(
      JSON.stringify(fichaValida({ mpPublicKey: null, vapidPublicKey: null })),
    );
    const { chavePublicaMercadoPago, chavePublicaVapid } =
      await importarLimpo();

    expect(chavePublicaMercadoPago()).toBeNull();
    expect(chavePublicaVapid()).toBeNull();
  });

  it("ficha PRESENTE e inválida: lerConfiguracaoDaLoja() LANÇA IDENTITY_FICHA_INVALID — não engole, não cai no assado", async () => {
    const ficha = fichaValida();
    injetarFicha(JSON.stringify({ ...ficha, configuracao: null }));
    const { lerConfiguracaoDaLoja } = await importarLimpo();

    expect(() => lerConfiguracaoDaLoja()).toThrow("IDENTITY_FICHA_INVALID");
  });

  it("ficha PRESENTE e inválida: os 4 atalhos também lançam (nenhum tem tratamento próprio de erro)", async () => {
    const ficha = fichaValida();
    injetarFicha(JSON.stringify({ ...ficha, schemaVersion: 1 }));
    const {
      pagamentoOnlineLigado,
      modoManutencao,
      chavePublicaMercadoPago,
      chavePublicaVapid,
    } = await importarLimpo();

    expect(() => pagamentoOnlineLigado()).toThrow("IDENTITY_FICHA_INVALID");
    expect(() => modoManutencao()).toThrow("IDENTITY_FICHA_INVALID");
    expect(() => chavePublicaMercadoPago()).toThrow("IDENTITY_FICHA_INVALID");
    expect(() => chavePublicaVapid()).toThrow("IDENTITY_FICHA_INVALID");
  });
});
