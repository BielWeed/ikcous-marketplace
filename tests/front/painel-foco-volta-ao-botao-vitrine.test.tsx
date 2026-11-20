// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const onNavigate = vi.fn();
const updateConfig = vi.fn(async () => true);
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
          productIds: [],
        },
      ],
    },
    updateConfig,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(async () => {
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
  await act(async () =>
    raiz.render(<AdminCarouselsView onNavigate={onNavigate} />),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["Nova vitrine", "Escape"],
  ["Nova vitrine", "Cancelar"],
  ["Editar vitrine Presentes", "Escape"],
  ["Editar vitrine Presentes", "Fechar"],
])("devolve o foco a %s ao fechar por %s", async (rotulo, saida) => {
  const botao = [...hospedeiro.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === rotulo,
  )!;
  expect(botao).toBeDefined();
  await act(async () => {
    botao.focus();
    botao.click();
  });
  const folha = document.querySelector('[role="dialog"]');
  expect(folha).not.toBeNull();
  expect(document.activeElement === folha).toBe(true);
  await act(async () => {
    if (saida === "Escape") {
      folha?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    } else {
      [...folha!.querySelectorAll("button")]
        .find(
          (b) =>
            (b.getAttribute("aria-label") ?? b.textContent?.trim()) === saida,
        )
        ?.click();
    }
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await vi.waitFor(() => expect(document.activeElement === botao).toBe(true));
});

it("não tira o foco da confirmação que abre quando a folha fecha", async () => {
  const editar = hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-label="Editar vitrine Presentes"]',
  )!;
  await act(async () => editar.click());
  const folha = document.querySelector('[role="dialog"]')!;
  const excluir = [...folha.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Excluir",
  )!;
  expect(excluir).toBeDefined();

  const focouEditar = vi.spyOn(editar, "focus");
  await act(async () => excluir.click());
  await act(async () => {
    await new Promise((resolver) => setTimeout(resolver, 0));
  });
  const confirmacao = document.querySelector('[role="alertdialog"]');
  expect(confirmacao).not.toBeNull();
  expect(confirmacao?.contains(document.activeElement)).toBe(true);
  expect(focouEditar).not.toHaveBeenCalled();
});
