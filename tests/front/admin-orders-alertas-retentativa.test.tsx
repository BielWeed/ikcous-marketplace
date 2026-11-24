// @vitest-environment jsdom

import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));

const pedidosVazios: never[] = [];
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidosVazios,
    pedidosCancelados: pedidosVazios,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: 0,
    isLoaded: true,
    loading: false,
  }),
}));

let responder: (sucesso: boolean) => void;
const consultar = vi.fn(
  () => new Promise<boolean>((resolve) => (responder = resolve)),
);
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => {
    const [error, setError] = useState<string | null>("Falha na consulta");
    const [stats, setStats] = useState<{ paidOnCancelled: number } | null>(
      null,
    );
    return {
      stats,
      error,
      fetchExecutiveSummary: async (forcar: boolean) => {
        if (!forcar) return;
        setError(null);
        if (await consultar()) {
          setStats({ paidOnCancelled: 0 });
        } else {
          setError("Falha na consulta");
        }
      },
    };
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  consultar.mockClear();
});

async function abrirAviso() {
  const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
  await act(async () => {
    raiz.render(<AdminOrdersView onNavigate={vi.fn()} active />);
  });
  const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
    '[data-testid="alertas-cancelados-alavanca"]',
  );
  await act(async () => alavanca?.click());
  const painel = hospedeiro.querySelector("#alertas-cancelados-conteudo");
  expect(painel?.textContent).toContain("Não foi possível conferir os alertas");
  const botao = [...(painel?.querySelectorAll("button") ?? [])].find(
    (elemento) => elemento.textContent?.trim() === "Tentar de novo",
  );
  if (!botao) throw new Error("Botão de retentativa ausente");
  botao.focus();
  await act(async () => botao.click());
  return { botao, painel };
}

it("mantém a retentativa focada durante a consulta e após nova falha", async () => {
  const { botao, painel } = await abrirAviso();

  expect(botao.isConnected).toBe(true);
  expect(document.activeElement === botao).toBe(true);
  expect(painel?.querySelector('[role="status"]')?.textContent).toBe(
    "Conferindo…",
  );
  expect(botao.getAttribute("aria-disabled")).toBe("true");
  await act(async () => botao.click());
  expect(consultar).toHaveBeenCalledTimes(1);

  await act(async () => responder(false));
  expect(document.activeElement === botao).toBe(true);
  expect(botao.getAttribute("aria-disabled")).not.toBe("true");
  expect(painel?.querySelector('[role="alert"]')?.textContent).toContain(
    "Não foi possível conferir os alertas",
  );
  await act(async () => botao.click());
  expect(consultar).toHaveBeenCalledTimes(2);
  await act(async () => responder(false));
});

it.each([true, false])(
  "ao resolver sem alertas, transfere o foco só se ainda estiver no botão (%s)",
  async (manterFoco) => {
    const { botao } = await abrirAviso();
    const devolucoes = hospedeiro.querySelector('button[title="Devoluções"]');
    const busca = hospedeiro.querySelector<HTMLInputElement>("#orders-search");
    expect(busca).not.toBeNull();
    if (!manterFoco) busca?.focus();

    await act(async () => responder(true));

    expect(botao.isConnected).toBe(false);
    expect(document.activeElement === (manterFoco ? devolucoes : busca)).toBe(
      true,
    );
  },
);
