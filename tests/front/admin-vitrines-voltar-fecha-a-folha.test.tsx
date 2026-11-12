// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from "react";
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
let override: (() => void) | null;
function Tela() {
  // Mesmo setter do App: uma função deve ser registrada dentro de outra.
  const [voltar, setVoltar] = useState<(() => void) | null>(null);
  useEffect(() => {
    override = voltar;
  }, [voltar]);
  return createElement(AdminCarouselsView, {
    onNavigate,
    onSetBackOverride: setVoltar,
  });
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let voltarNoHistorico: ReturnType<typeof vi.spyOn>;
const folha = () => document.querySelector('[role="dialog"]');
async function clicar(rotulo: string) {
  const botao = document.querySelector<HTMLElement>(`[aria-label="${rotulo}"]`);
  expect(botao).not.toBeNull();
  await act(async () => botao?.click());
}
async function abrir() {
  await clicar("Editar vitrine Presentes");
  expect(folha()).not.toBeNull();
  expect(override).toBeTypeOf("function");
}

beforeEach(async () => {
  vi.clearAllMocks();
  override = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.history.replaceState(
    { view: "admin-carousels" },
    "",
    "/admin/carousels",
  );
  voltarNoHistorico = vi
    .spyOn(window.history, "back")
    .mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(createElement(Tela)));
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("fechada não desvia o Voltar; aberta cria uma entrada sem mudar de endereço", async () => {
  expect(override).toBeNull();
  const tamanho = window.history.length;
  await abrir();
  expect(window.history.length).toBe(tamanho + 1);
  expect(window.location.pathname).toBe("/admin/carousels");
  expect(window.history.state.view).toBe("admin-carousels");
});

it("Voltar físico fecha só a folha e libera o desvio sem consumir outra entrada", async () => {
  await abrir();
  // O navegador já consumiu a entrada antes de o App chamar o desvio.
  window.history.replaceState(
    { view: "admin-carousels" },
    "",
    "/admin/carousels",
  );
  await act(async () => override?.());
  expect(folha()).toBeNull();
  expect(
    hospedeiro.querySelector('[data-testid="cartao-vitrine"]'),
  ).not.toBeNull();
  expect(onNavigate).not.toHaveBeenCalled();
  expect(updateConfig).not.toHaveBeenCalled();
  expect(voltarNoHistorico).not.toHaveBeenCalled();
  expect(override).toBeNull();
});

it("duas chamadas do mesmo Voltar fecham uma vez; reabrir aceita outro Voltar", async () => {
  await abrir();
  const primeiroVoltar = override!;
  await act(async () => {
    primeiroVoltar();
    primeiroVoltar();
  });
  expect(folha()).toBeNull();
  expect(voltarNoHistorico).toHaveBeenCalledTimes(1);
  expect(override).toBeNull();
  await abrir();
  window.history.replaceState(
    { view: "admin-carousels" },
    "",
    "/admin/carousels",
  );
  await act(async () => override?.());
  expect(folha()).toBeNull();
  expect(onNavigate).not.toHaveBeenCalled();
});

it("Fechar usa o mesmo caminho e devolve a entrada da folha", async () => {
  await abrir();
  await clicar("Fechar");
  expect(folha()).toBeNull();
  expect(voltarNoHistorico).toHaveBeenCalledTimes(1);
  expect(override).toBeNull();
});
