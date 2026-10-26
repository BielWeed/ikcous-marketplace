// @vitest-environment jsdom
//
// Redesenho Tinta (23/10/2026) da "Sobre a Loja": estrutura nova. Nome da loja
// no h1, rótulo mono, "Nossa história" só com descrição, chamada "Falar com a
// loja" em tinta, SEM logotipo do WhatsApp, sem cor fixa e sem rolagem lateral.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configAtual: Record<string, unknown> = {};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const LOJA = {
  storeName: "Ateliê da Serra",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  businessHours: "Seg-Sex: 8h às 19h",
  whatsappNumber: "(34) 99999-9999",
  storeDescription: "<p>Peças escolhidas a dedo.</p>",
  storeAddress: "Rua das Flores, 10",
};

describe("AboutStoreView Tinta: estrutura", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });
  }

  it("cabeçalho: rótulo mono, h1 com o nome e cidade; mapa com altura fixa e rodapé do link", async () => {
    configAtual = LOJA;
    await montar();
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Ateliê da Serra");
    expect(hospedeiro.textContent).toContain("Sobre a loja");
    expect(hospedeiro.textContent).toContain("Monte Carmelo, MG");
    const iframe = hospedeiro.querySelector("iframe")!;
    expect(iframe.parentElement?.className).toContain("h-52");
    const link = hospedeiro.querySelector(
      "a[aria-label='Abrir no Google Maps']",
    )!;
    expect(link.textContent).toContain("Toque para abrir no Google Maps");
    expect(link.className).toContain("focus-visible:ring-2");
  });

  it("história só existe com descrição; horário continua no cartão", async () => {
    configAtual = LOJA;
    await montar();
    expect(hospedeiro.querySelector("h2")?.textContent).toBe("Nossa história");
    expect(hospedeiro.textContent).toContain("Horário de atendimento");
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    configAtual = { ...LOJA, storeDescription: null };
    await montar();
    expect(hospedeiro.textContent).not.toContain("Nossa história");
  });

  // 26/10/2026 (pedido do dono): o botão de contato por WhatsApp é o ORIGINAL do
  // WhatsApp em toda a loja — verde oficial e glifo oficial. Antes (14/09) era
  // uma barra Tinta preta, texto simples e sem o logotipo; a barra fixa, os 52px,
  // o rótulo e o portal no body continuam, só a cara mudou.
  it("Falar com a loja: verde oficial do WhatsApp, 52px, glifo oficial, rótulo simples", async () => {
    configAtual = LOJA;
    await montar();
    const botao = document.body.querySelector<HTMLButtonElement>(
      "button[aria-label='Falar com a loja no WhatsApp']",
    )!;
    expect(botao.textContent).toBe("Falar com a loja");
    for (const c of ["bg-[#25D366]", "h-[52px]", "rounded-2xl", "fixed"])
      expect(botao.className).toContain(c);
    expect(botao.className).not.toContain("emerald");
    // Só o glifo oficial do WhatsApp (o mesmo traço de IconeWhatsapp), nenhuma seta.
    const svgs = botao.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svgs[0].querySelector("path")?.getAttribute("d")).toMatch(
      /^M17\.472 14\.382/,
    );
    expect(svgs[0].getAttribute("class") ?? "").not.toContain("lucide");
  });

  it("sem cor fixa (zinc, branco, emerald): só tokens do tema, fora o verde oficial do WhatsApp", async () => {
    configAtual = LOJA;
    await montar();
    const html =
      hospedeiro.innerHTML + (document.body.lastElementChild?.outerHTML ?? "");
    expect(html).not.toMatch(/zinc-|bg-white|bg-primary|admin-gold|emerald/);
  });
});
