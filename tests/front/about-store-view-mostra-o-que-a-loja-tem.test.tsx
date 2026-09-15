// @vitest-environment jsdom
//
// Peça 24: a página "Sobre a Loja" lê a FONTE ÚNICA (useStore → StoreConfig)
// e mostra o que a loja já tem de verdade: nome, logo, cidade/UF, horário de
// atendimento e WhatsApp. Regra de degradação da casa (migration
// 20261033000000): dado que a loja não preencheu → o bloco NÃO existe na
// tela — nunca "undefined", nunca erro.
//
// O setup global (tests/front/setup-build-identity.ts) instala a fixture
// "Aurora": com storeName nulo, o nome exibido cai no branding.appName, igual
// ao cabeçalho (nome-da-loja.ts).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigDeTeste = Record<string, unknown>;

let configAtual: ConfigDeTeste = {};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

const LOJA_COMPLETA: ConfigDeTeste = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://cdn.example/atelie/logo.png",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  businessHours: "Seg-Sex: 8h às 19h",
  whatsappNumber: "(34) 99999-9999",
  storeDescription:
    "Peças de decoração escolhidas a dedo, direto do ateliê para a sua casa.",
  originCep: "38500-000",
};

const LOJA_VAZIA: ConfigDeTeste = {
  storeName: null,
  logoUrl: null,
  storeCity: null,
  storeState: null,
  businessHours: null,
  whatsappNumber: null,
  storeDescription: null,
};

describe("AboutStoreView — a página mostra o que a loja tem e omite o resto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarPagina() {
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("loja completa: nome, logo, local, horário e contato — nada inventado", async () => {
    configAtual = LOJA_COMPLETA;

    const texto = await renderizarPagina();

    expect(texto).toContain("Ateliê da Serra");
    expect(texto).toContain("Monte Carmelo, MG");
    expect(texto).toContain("Seg-Sex: 8h às 19h");
    expect(texto).toContain("Horário de atendimento");

    // Descrição da loja (campo do dono — quando existir no banco, aparece).
    expect(texto).toContain("Peças de decoração escolhidas a dedo");

    // Mapa real embutido: o CEP de origem é a query do embed e do link de GPS.
    const mapa = hospedeiro.querySelector<HTMLIFrameElement>(
      "iframe[title^='Mapa da loja']",
    );
    expect(mapa).not.toBeNull();
    expect(mapa!.getAttribute("src")).toBe(
      "https://maps.google.com/maps?q=38500-000&z=15&output=embed",
    );
    const abrirMaps = [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Abrir no Google Maps"),
    );
    expect(abrirMaps).toBeDefined();
    expect(abrirMaps!.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=38500-000",
    );

    const logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("src")).toBe(
      "https://cdn.example/atelie/logo.png",
    );

    // Título da aba vem do useDocumentMeta com o nome da fonte única.
    expect(document.title).toContain("Sobre a loja");
    expect(document.title).toContain("Ateliê da Serra");
  });

  it("loja sem nada: blocos somem, nome cai na marca do build, zero 'undefined'", async () => {
    configAtual = LOJA_VAZIA;

    const texto = await renderizarPagina();

    // A página continua de pé, com o cabeçalho e o nome da marca do build.
    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      "Sobre a Loja",
    );
    expect(texto).toContain("Aurora");

    // O que a loja não preencheu NÃO vira bloco vazio.
    expect(texto).not.toContain("Horário de atendimento");
    expect(texto).not.toContain("Falar com a loja");
    expect(texto).not.toContain("Monte Carmelo");
    expect(texto).not.toContain("Peças de decoração escolhidas a dedo");
    expect(texto).not.toContain("Abrir no Google Maps");
    expect(
      hospedeiro.querySelector("iframe[title^='Mapa da loja']"),
    ).toBeNull();

    // Nem liço de renderização: nenhum "undefined"/"null" vaza para a tela.
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("null");
  });

  it("logo quebrado (onError) degrada para a inicial, sem erro de render", async () => {
    configAtual = {
      ...LOJA_COMPLETA,
      logoUrl: "https://cdn.example/quebrado.png",
    };

    await renderizarPagina();

    const logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo).not.toBeNull();
    await act(async () => {
      logo!.dispatchEvent(new globalThis.Event("error"));
    });
    // A imagem sai e a inicial da loja entra no lugar — sem "undefined".
    expect(hospedeiro.querySelector("img[alt^='Logo da loja']")).toBeNull();
    expect(hospedeiro.textContent).toContain("Ateliê da Serra");
  });

  it("WhatsApp: clique abre wa.me com prefixo 55 e sem quebrar em número formatado", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Falar com a loja"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });

    const open = vi.mocked(globalThis.open);
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]?.[0]);
    // "(34) 99999-9999" → 34999999999 (11 dígitos) → prefixo 55.
    expect(url).toContain("https://wa.me/5534999999999");
  });
});
