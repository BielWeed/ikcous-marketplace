// @vitest-environment jsdom
//
// Período com o Fim antes do Início em Pedidos: o banco devolvia lista vazia e a
// tela culpava "o filtro de status, a busca ou o período" — sem dizer que o
// problema era a ordem das datas. Agora o painel de filtros avisa ao lado das
// datas ("O fim precisa ser depois do início.") e a lista vazia diz que o
// período está invertido. A digitação NÃO é bloqueada e as datas NÃO são
// trocadas sozinhas: quem corrige é a lojista.
//
// Casco: admin-orders-filtro-que-filtra.test.tsx (mesmos mocks).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;
let mockLoadOrders: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: mockLoadOrders,
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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

const AVISO = "O fim precisa ser depois do início.";

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

function botaoComTexto(texto: string) {
  return Array.from(
    (
      document.querySelector('[role="dialog"]') ?? document.body
    ).querySelectorAll("button"),
  ).find((b) => b.textContent?.trim() === texto);
}

async function abrirFiltros(hospedeiro: HTMLElement) {
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Filtros e ferramentas"]',
      )!
      .click();
  });
  await act(async () => botaoComTexto("Abrir filtros")!.click());
}

function digitarData(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  expect(el, `campo ${id} deve estar visível`).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const avisos = () =>
  Array.from(document.querySelectorAll('[role="alert"]')).filter(
    (el) => el.textContent?.trim() === AVISO,
  );

describe("AdminOrdersView — período com Fim antes do Início", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    armazem.set("admin_orders_filter_v2", JSON.stringify("all"));

    mockLoadOrders = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.resetModules();
    mockOrders = [];
    mockTotalOrders = 0;
  });

  async function montar() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);
  }

  it("lista vazia com período invertido diz que o período está invertido, sem culpar status ou busca", async () => {
    armazem.set(
      "admin_orders_date_range",
      JSON.stringify({ start: "2026-10-20", end: "2026-10-10" }),
    );
    await montar();

    const tela = hospedeiro.textContent ?? "";
    expect(tela).toContain("O período está invertido");
    expect(tela).not.toContain("Nenhum pedido neste recorte");
    expect(tela).not.toContain("Pode ser o filtro de status");
    // A saída continua à mão: limpar as datas.
    expect(botaoComTexto("Limpar Datas")).toBeTruthy();
  });

  it("período na ordem certa e lista vazia segue com o texto genérico de recorte", async () => {
    armazem.set(
      "admin_orders_date_range",
      JSON.stringify({ start: "2026-10-10", end: "2026-10-20" }),
    );
    await montar();

    const tela = hospedeiro.textContent ?? "";
    expect(tela).toContain("Nenhum pedido neste recorte");
    expect(tela).not.toContain("O período está invertido");
  });

  it("o painel de filtros avisa quando o fim é antes do início, e o aviso some ao corrigir (sem trocar as datas sozinho)", async () => {
    armazem.set(
      "admin_orders_date_range",
      JSON.stringify({ start: "2026-10-20", end: "" }),
    );
    await montar();
    await abrirFiltros(hospedeiro);

    // Só o início: nada a avisar.
    expect(avisos()).toHaveLength(0);

    await act(async () => digitarData("filter-date-end", "2026-10-10"));
    expect(avisos()).toHaveLength(1);
    // Não bloqueou a digitação nem trocou as datas: cada campo guarda o que a
    // lojista digitou.
    expect(
      (document.getElementById("filter-date-start") as HTMLInputElement).value,
    ).toBe("2026-10-20");
    expect(
      (document.getElementById("filter-date-end") as HTMLInputElement).value,
    ).toBe("2026-10-10");

    await act(async () => digitarData("filter-date-end", "2026-10-25"));
    expect(avisos()).toHaveLength(0);
  });
});
