// @vitest-environment jsdom
//
// Vitrines do painel com o catálogo ainda sem carregar ou com erro: a tela
// dizia "Sem produtos" e "Cadastre produtos" como se a loja estivesse vazia.
// Agora diz que está carregando, ou que não deu para carregar (com "Tentar de
// novo"), e só chama de vazio quando a leitura respondeu mesmo com lista vazia.
// Molde de montagem: admin-vitrines-redesenho.test.tsx.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const secao = {
  id: "new_arrivals",
  title: "Últimos Lançamentos",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: false,
};

const estado = {
  products: [] as unknown[],
  loadingProducts: false,
  catalogoErro: false,
};
const fetchProducts = vi.fn(async () => {});
const toastInfo = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { homeSections: [secao] },
    updateConfig: vi.fn(async () => true),
    fetchProducts,
    ...estado,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.products }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, info: toastInfo },
}));
vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    Reorder: {
      Group: (p: { children: React.ReactNode }) =>
        createElement("div", null, p.children),
      Item: (p: { children: React.ReactNode }) =>
        createElement("div", null, p.children),
    },
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
  });
}
const texto = () => hospedeiro.textContent ?? "";
const botao = (t: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.includes(t),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  estado.products = [];
  estado.loadingProducts = false;
  estado.catalogoErro = false;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("Vitrines: catálogo que não carregou não vira 'vazio'", () => {
  it("erro de leitura: avisa, oferece 'Tentar de novo' e não diz 'Sem produtos'", async () => {
    estado.catalogoErro = true;
    await montar();

    expect(
      hospedeiro.querySelector('[role="alert"]')?.textContent ?? "",
    ).toContain("Não deu para carregar os produtos");
    expect(texto()).not.toContain("Sem produtos");

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    expect(fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("ainda carregando: diz que está carregando, sem 'Sem produtos'", async () => {
    estado.loadingProducts = true;
    await montar();

    expect(texto()).toContain("Carregando produtos");
    expect(texto()).not.toContain("Sem produtos");
    expect(botao("Tentar de novo")).toBeUndefined();
  });

  it("'Escolher' com o catálogo fora não manda 'Cadastre produtos'", async () => {
    estado.catalogoErro = true;
    await montar();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLElement>(
          '[aria-label="Editar vitrine Últimos Lançamentos"]',
        )
        ?.click();
    });
    const painel = document.querySelector<HTMLElement>('[role="dialog"]');
    await act(async () => {
      Array.from(painel?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((b) => b.textContent?.trim() === "Escolher")
        ?.click();
    });

    const avisos = [...toastInfo.mock.calls, ...toastError.mock.calls];
    expect(avisos.length).toBeGreaterThan(0);
    expect(JSON.stringify(avisos)).not.toContain("Cadastre produtos");
  });

  it("catálogo respondeu e está mesmo vazio: continua 'Sem produtos'", async () => {
    await montar();

    expect(texto()).toContain("Sem produtos");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
