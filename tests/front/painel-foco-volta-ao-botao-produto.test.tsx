// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const produto = {
  id: "prod-1",
  name: "Produto Um",
  category: "Geral",
  images: [],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
};
const produtos = [produto];
const loadProducts = vi.fn(async () => ({ products: produtos, total: 1 }));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos, loading: false, loadProducts }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  const { AdminProductsView } = await import("@/views/admin/AdminProductsView");
  await act(async () =>
    raiz.render(<AdminProductsView onNavigate={vi.fn()} active />),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(["Escape", "Cancelar"])(
  "devolve o foco ao menu do produto ao fechar por %s",
  async (saida) => {
    const gatilho = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Ações de Produto Um"]',
    )!;
    expect(gatilho).not.toBeNull();
    const tecla = (alvo: EventTarget, key: string) =>
      alvo.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    await act(async () => {
      gatilho.focus();
      tecla(gatilho, "Enter");
    });
    const duplicar = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent?.includes("Duplicar Produto"))!;
    expect(duplicar).toBeDefined();
    await act(async () => {
      duplicar.focus();
      tecla(duplicar, "Enter");
    });
    const dialogo = document.querySelector('[role="alertdialog"]')!;
    expect(dialogo.textContent).toContain("Confirmar Duplicação");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => {
      if (saida === "Escape") tecla(document.activeElement!, saida);
      else
        [...dialogo.querySelectorAll("button")]
          .find((b) => b.textContent === saida)
          ?.click();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(gatilho));
  },
);
