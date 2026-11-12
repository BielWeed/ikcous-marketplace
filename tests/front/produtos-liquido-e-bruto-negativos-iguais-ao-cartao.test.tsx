// @vitest-environment jsdom
//
// Folha "Entender valores" da tela Produtos: o cartão do líquido mostra o
// prejuízo como "−R$ 10,00" (menos de verdade, antes do R$), mas o texto da
// folha dizia "Líquido estimado: R$ -10,00", e a conta do lucro bruto, montada
// à mão, também. O mesmo número aparecia escrito de dois jeitos na mesma
// tela. A folha agora usa o mesmo formato do cartão; positivo e zero seguem
// iguais ("R$ 49,75", "R$ 0,00").
//
// Mesma montagem de produtos-faturamento-revalida-cache-antigo.test.tsx: o
// hook de análises e a tela são reais; só rede, disco e catálogo são dublados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  getById: vi.fn(),
  put: vi.fn(),
  loadProducts: vi.fn(),
  produtos: [
    {
      id: "produto-fixture",
      name: "Produto fictício",
      category: "Geral",
      images: [],
      isActive: true,
      stock: 2,
      price: 15,
      costPrice: 10,
    },
  ],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin-fixture" } } },
      }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: async () => ({ getById: h.getById, put: h.put }) },
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.produtos,
    loading: false,
    loadProducts: h.loadProducts,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    copiarImagemParaDuplicacao: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

import { clearAnalyticsCache } from "@/hooks/useAnalytics";
import { AdminProductsView } from "@/views/admin/AdminProductsView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Produtos — folha 'Entender valores': líquido e bruto negativos no formato do cartão", () => {
  let raiz: Root;
  let caixa: HTMLDivElement;

  beforeEach(() => {
    clearAnalyticsCache();
    h.rpc.mockReset();
    h.getById.mockReset().mockResolvedValue(null);
    h.put.mockReset().mockResolvedValue(undefined);
    h.loadProducts
      .mockReset()
      .mockResolvedValue({ products: h.produtos, total: 1 });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) =>
        armazenamento.set(chave, valor),
      removeItem: (chave: string) => armazenamento.delete(chave),
    });
    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    raiz = createRoot(caixa);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    caixa.remove();
    clearAnalyticsCache();
    vi.unstubAllGlobals();
  });

  // O dinheiro formatado vem com espaço sem quebra entre "R$" e o número.
  const semNbsp = (texto: string | null | undefined) =>
    (texto ?? "").split(String.fromCharCode(160)).join(" ");

  /** Monta a tela, abre a folha, aplica as despesas e devolve o texto da folha. */
  async function folhaComDespesas(
    inventory: Record<string, number>,
    despesas: string,
  ): Promise<string> {
    h.rpc.mockResolvedValue({ data: { inventory }, error: null });
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={vi.fn()} active={true} />);
    });
    const entender = [...caixa.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Entender valores",
    );
    expect(entender).toBeDefined();
    await act(async () => entender!.click());
    const campo = document.querySelector<HTMLInputElement>(
      'input[name="despesas-previstas-estoque"]',
    );
    expect(campo).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, despesas);
      campo!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const aplicar = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.trim() === "Aplicar estimativa");
    expect(aplicar).toBeDefined();
    await act(async () => aplicar!.click());
    return semNbsp(document.querySelector('[role="dialog"]')?.textContent);
  }

  const comTudoConhecido = (totalValue: number) => ({
    totalCost: 100,
    totalValue,
    totalRevenue: totalValue,
    revenueWithoutCost: 0,
    productsWithoutCost: 0,
    productsWithCost: 1,
  });

  it("prejuízo: líquido e lucro bruto saem como −R$ x, nunca R$ -x", async () => {
    // receita 40 − custo 100 = bruto −60; despesas 10 → líquido −70
    const folha = await folhaComDespesas(comTudoConhecido(40), "10");
    expect(folha).toContain("Líquido estimado: −R$ 70,00");
    expect(folha).toContain("lucro bruto: −R$ 60,00");
    expect(folha).not.toContain("R$ -");
  });

  it("controle: lucro positivo segue como 'R$ x' (sem sinal de mais)", async () => {
    // receita 160 − custo 100 = bruto 60; despesas 10,25 → líquido 49,75
    const folha = await folhaComDespesas(comTudoConhecido(160), "10,25");
    expect(folha).toContain("Líquido estimado: R$ 49,75");
    expect(folha).toContain("lucro bruto: R$ 60,00");
    expect(folha).not.toContain("+R$");
    expect(folha).not.toContain("−R$");
  });

  it("controle: líquido exatamente zero segue como 'R$ 0,00'", async () => {
    // bruto 60, despesas 60 → líquido 0
    const folha = await folhaComDespesas(comTudoConhecido(160), "60");
    expect(folha).toContain("Líquido estimado: R$ 0,00");
    expect(folha).not.toContain("−R$");
  });
});
