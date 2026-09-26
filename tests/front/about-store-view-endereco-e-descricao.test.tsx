// @vitest-environment jsdom
//
// Frente "Sobre a Loja" (pedido do dono, 20/09/2026): a página passa a usar o
// ENDEREÇO declarado pela loja (store_address, migration 20261167000000) como
// query do mapa — o CEP de frete e a cidade/UF viram fallback, na ordem
// endereço → CEP → cidade/UF. E a descrição gravada pela tela do painel
// renderiza com parágrafos; script injetado na descrição sai INERTE (o
// DOMPurify do render é a defesa — o helper do admin escapou o texto na
// origem, mas a prova aqui é do pior caso: HTML perigoso direto no banco).
// Degraudação (régua da 20261033000000): sem endereço E sem CEP E sem
// cidade/UF, o cartão de mapa não existe; sem descrição, idem — nunca erro.
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

const BASE_DA_LOJA: ConfigDeTeste = {
  storeName: "Ateliê da Serra",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  originCep: "38500-000",
};

describe("AboutStoreView — o endereço da loja alimenta o mapa (20261167000000)", () => {
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
    return hospedeiro.ownerDocument;
  }

  function mapaSrc(doc: Document): string {
    const iframe = doc.querySelector('iframe[title^="Mapa da loja"]');
    return iframe?.getAttribute("src") ?? "";
  }

  it("com endereço declarado, o mapa usa ELE mesmo havendo CEP de frete e cidade/UF", async () => {
    configAtual = {
      ...BASE_DA_LOJA,
      storeAddress: "Avenida Paulista, 1578 — Bela Vista",
    };
    const doc = await renderizarPagina();
    expect(mapaSrc(doc)).toContain(
      encodeURIComponent("Avenida Paulista, 1578 — Bela Vista"),
    );
    expect(mapaSrc(doc)).not.toContain("38500-000");
  });

  it("sem endereço, o mapa cai para o CEP de frete (comportamento de antes da coluna)", async () => {
    configAtual = { ...BASE_DA_LOJA };
    const doc = await renderizarPagina();
    expect(mapaSrc(doc)).toContain("38500-000");
  });

  it("sem endereço, sem CEP e sem cidade/UF: o cartão de mapa nem existe (régua da casa)", async () => {
    configAtual = { storeName: "Ateliê da Serra" };
    const doc = await renderizarPagina();
    expect(doc.querySelector('iframe[title^="Mapa da loja"]')).toBeNull();
    expect(
      doc.querySelector('a[aria-label="Abrir no Google Maps"]'),
    ).toBeNull();
  });
});

describe("AboutStoreView — a descrição da loja renderiza e o HTML perigoso sai inerte", () => {
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

  it("descrição com parágrafos (do helper do admin) renderiza com o conteúdo e chip de aproximação segue honesto", async () => {
    configAtual = {
      ...BASE_DA_LOJA,
      storeAddress: "Avenida Paulista, 1578",
      storeDescription:
        "<p>Peças escolhidas a dedo.</p><p>Lançamento da semana.</p>",
    };
    const texto = await renderizarPagina();
    expect(texto).toContain("Peças escolhidas a dedo.");
    expect(texto).toContain("Lançamento da semana.");
    expect(texto).toContain("Localização aproximada");
  });

  it("script e handler de evento embutidos na descrição NÃO executam (DOMPurify no render)", async () => {
    const alerta = vi.fn();
    vi.stubGlobal("alert", alerta);
    configAtual = {
      ...BASE_DA_LOJA,
      storeDescription:
        '<p>ok</p><script>globalThis.alert("explodiu")</script><img src="x" onerror="globalThis.alert(1)" />',
    };
    await renderizarPagina();
    expect(hospedeiro.querySelector("script")).toBeNull();
    expect(alerta).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("ok");
  });

  it("sem descrição, o bloco não existe (nunca bloco vazio)", async () => {
    configAtual = { ...BASE_DA_LOJA, storeDescription: null };
    const texto = await renderizarPagina();
    expect(texto).not.toContain("Peças");
  });
});
