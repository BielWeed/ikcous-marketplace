// @vitest-environment jsdom
//
// T4 (app): a chave pública do Mercado Pago que monta o Brick passa a vir da
// FICHA da loja (`chavePublicaMercadoPago()`, escala etapa 3, 11/09/2026),
// nunca mais de `import.meta.env.VITE_MP_PUBLIC_KEY` direto — um build
// compartilhado por N lojas não tem mais UM valor assado que sirva para
// todas (MP e VAPID DIFEREM entre lojas, ver a spec da etapa 3).
//
// Mesmo andaime de pagamento-online.test.tsx (`montarBrick` isolado, sem
// renderizar <PagamentoOnline>): `@/lib/supabase` mockado porque
// `@/hooks/useOrders` (importado só por tipo aqui) importa esse módulo, que
// EXPLODE sem as env vars do Supabase — nenhum destes testes chama
// `criarPagamento` de verdade.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// pagamento-online.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);

// ── Fixture da ficha v2 (mesmo builder de
// tests/front/configuracao-da-loja-pela-ficha.test.ts, duplicado aqui de
// propósito: cada arquivo de teste deste projeto monta a própria fixture) ──
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
    store_name: "Loja Do Brick",
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
  overridesConfiguracao: Partial<FichaDaLoja["configuracao"]> = {},
  host = "loja-mp-teste.exemplo.com",
): FichaDaLoja {
  return {
    schemaVersion: 2,
    host,
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
      publicUrl: `https://${host}`,
      identityRevision: "d".repeat(64),
    },
    conexao: {
      supabaseUrl: SUPABASE_URL,
      publishableKey: "sb_publishable_brick_teste",
    },
    configuracao: {
      mpPublicKey: "APP_USR-da-loja-config",
      vapidPublicKey: "Bda-loja-config",
      pagamentoOnline: true,
      manutencao: false,
      ...overridesConfiguracao,
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
  return import("@/components/checkout/PagamentoOnline");
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type ModuloComponente = typeof import("@/components/checkout/PagamentoOnline");
type OpcoesMontarBrick = Parameters<ModuloComponente["montarBrick"]>[0];

function opcoesPadrao(sobrepor: Partial<OpcoesMontarBrick> = {}) {
  return {
    orderId: "ped-1",
    valor: 100,
    criarPagamento: vi.fn(),
    onErro: vi.fn(),
    onPix: vi.fn(),
    ...sobrepor,
  };
}

describe("montarBrick — a chave pública do Mercado Pago vem da ficha da loja (escala etapa 3)", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Dispara o `load` do SDK e espera a cadeia de `await`s do componente —
   * mesmo helper de pagamento-online.test.tsx. */
  async function carregarSdk() {
    const tag = document.querySelector("script[data-mp-sdk]");
    tag?.dispatchEvent(new Event("load"));
    await esperarMicrotarefas();
  }

  it("ficha v2 com mpPublicKey 'APP_USR-teste': o Brick nasce com essa chave, nunca com a do build", async () => {
    vi.stubGlobal("location", { hostname: "loja-mp-teste.exemplo.com" });
    // Ambiente assado preenchido de propósito, com um valor DIFERENTE — a
    // prova é que ele nunca é usado enquanto a ficha existe.
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "APP_USR-assado-nunca-usado");
    injetarFicha(JSON.stringify(fichaValida({ mpPublicKey: "APP_USR-teste" })));

    const { montarBrick } = await importarLimpo();

    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    const MercadoPagoSpy = vi.fn(function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = MercadoPagoSpy;

    montarBrick(opcoesPadrao());
    await carregarSdk();

    expect(MercadoPagoSpy).toHaveBeenCalledWith("APP_USR-teste", {
      locale: "pt-BR",
    });
    expect(MercadoPagoSpy).not.toHaveBeenCalledWith(
      "APP_USR-assado-nunca-usado",
      expect.anything(),
    );
  });

  // O TESTE DE DINHEIRO (ADENDO A.2): num build compartilhado por N lojas,
  // ficha AUSENTE em produção nunca pode cair no assado — mesmo com ele
  // preenchido no env. `chavePublicaMercadoPago()` devolve `null`, e é esse
  // `null` que faz `montarBrick` lançar `new Error("Pagamento
  // indisponível.")` ANTES de sequer tentar montar o SDK.
  it("ficha ausente em produção (DEV falso), com VITE_MP_PUBLIC_KEY preenchido no env: nunca constrói o SDK — 'Pagamento indisponível.' é a causa logada", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "APP_USR-assado-nunca-usado");

    const { montarBrick } = await importarLimpo();

    const MercadoPagoSpy = vi.fn();
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = MercadoPagoSpy;

    const consoleErroSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onErro = vi.fn();
    montarBrick(opcoesPadrao({ onErro }));
    await carregarSdk();
    await esperarMicrotarefas();

    // A prova com dente: o SDK do Mercado Pago nunca chega a ser construído
    // — se a trava sumisse, `chavePublicaMercadoPago()` voltaria a ler o
    // env assado e este `new MercadoPago(...)` aconteceria.
    expect(MercadoPagoSpy).not.toHaveBeenCalled();
    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível carregar o pagamento.",
      "recuperavel",
    );
    const chamadaDoErro = consoleErroSpy.mock.calls.find(
      (chamada) => chamada[0] === "montarBrick:",
    );
    expect(chamadaDoErro?.[1]).toBeInstanceOf(Error);
    expect((chamadaDoErro?.[1] as Error).message).toBe(
      "Pagamento indisponível.",
    );
  });
});
