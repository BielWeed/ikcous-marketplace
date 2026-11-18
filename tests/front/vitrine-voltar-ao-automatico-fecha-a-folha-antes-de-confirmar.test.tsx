// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  ids: ["p1"],
  updateConfig: vi.fn(async () => true),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      homeSections: [
        {
          id: "custom_1",
          title: "Presentes",
          active: true,
          isCustom: true,
          maxItems: 6,
          productIds: h.ids,
        },
      ],
    },
    updateConfig: h.updateConfig,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      {
        id: "p1",
        name: "Presente",
        price: 10,
        images: [],
        active: true,
        stock: 5,
      },
    ],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");
let raiz: Root;
let hospedeiro: HTMLDivElement;
async function clicar(texto: string) {
  const botao = Array.from(document.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
  expect(botao).toBeTruthy();
  await act(async () => botao!.click());
}
beforeEach(() => {
  h.ids = ["p1"];
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});
async function abrir() {
  await act(async () =>
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() })),
  );
  await clicar("Editar vitrine Presentes");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
}
it("fecha a folha antes de confirmar e Cancelar reabre sem gravar", async () => {
  await abrir();
  await clicar("Automático");
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await clicar("Cancelar");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(h.updateConfig).not.toHaveBeenCalled();
});
it("tirar o último produto também fecha a folha antes da confirmação", async () => {
  await abrir();
  const produto = document.querySelector<HTMLButtonElement>(
    '[data-produto-id="p1"]',
  );
  expect(produto).not.toBeNull();
  await act(async () => produto!.click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await clicar("Cancelar");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(h.updateConfig).not.toHaveBeenCalled();
});
it("não pede confirmação quando a vitrine já é automática", async () => {
  h.ids = [];
  await abrir();
  await clicar("Automático");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(h.updateConfig).not.toHaveBeenCalled();
});
