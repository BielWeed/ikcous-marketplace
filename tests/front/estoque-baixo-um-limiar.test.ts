// @vitest-environment jsdom
//
// Onda F, frente F5 do painel simples ("um número, um conceito"): no front
// "estoque baixo" é UMA regra só — `precisaDeReposicao(estoque, mínimo)` e
// `LIMIAR_PADRAO_DE_ESTOQUE` de `src/utils/avisos-do-lojista.ts` (valor 5,
// pergunta P3 assumida). Antes, o selo "Crítico" e as cores de estoque de
// AdminProductsView e o filtro não-admin "low" de useProducts repetiam o
// literal `5` e ignoravam o `estoque_minimo` do produto: o mesmo produto era
// "baixo" no sino e "normal" no cartão.
//
// (a) varredura de fonte: nenhum literal de estoque baixo fora de
//     avisos-do-lojista.ts;
// (b) comportamento: monta AdminProductsView de verdade (mesmo padrão de
//     admin-products-esgotado.test.tsx, sem @testing-library). Arquivo `.ts`
//     de propósito (nome do plano): sem JSX, os mocks usam createElement.
//
// Fora da varredura, de propósito: PhoneSimulator.tsx. Ele imita a LOJA da
// cliente (`<= 3` = "Últimas unidades"), não é um aviso ao lojista; mudar
// aquele número mudaria o que a cliente vê.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RAIZ = process.cwd();

/** Resíduo motivado: imita a vitrine da cliente, não o painel (ver topo). */
const FORA_DA_VARREDURA = new Set(["PhoneSimulator.tsx"]);

/** Lê um arquivo do repositório (caminho relativo à raiz). */
function lerDoRepo(relativo: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo
  return readFileSync(join(RAIZ, relativo), "utf8");
}

function arquivosDe(pasta: string): string[] {
  const saida: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo
  for (const entrada of readdirSync(join(RAIZ, pasta), {
    withFileTypes: true,
  })) {
    const nome = entrada.name;
    if (entrada.isDirectory()) {
      saida.push(...arquivosDe(join(pasta, nome)));
    } else if (/\.tsx?$/.test(nome) && !FORA_DA_VARREDURA.has(nome)) {
      saida.push(join(pasta, nome));
    }
  }
  return saida;
}

// `product.stock <= 5`, `estoque < 3`, `p.stock<=5` ... e `.lte("estoque", 5`.
const LITERAL_DE_ESTOQUE_BAIXO =
  /(stock|estoque)[\w.]*\s*<=?\s*[1-9]|lte\(\s*["']estoque["']\s*,\s*\d/;

describe("estoque baixo: uma regra só (varredura de fonte)", () => {
  const arquivos = [
    ...arquivosDe("src/views/admin"),
    ...arquivosDe("src/components/admin"),
    "src/hooks/useProducts.ts",
  ];

  it("a varredura enxerga os arquivos que importam", () => {
    expect(arquivos).toContain("src/views/admin/AdminProductsView.tsx");
    expect(arquivos).toContain("src/hooks/useProducts.ts");
    expect(arquivos.some((a) => a.endsWith("PhoneSimulator.tsx"))).toBe(false);
  });

  it("nenhum literal de estoque baixo no painel nem no filtro 'low'", () => {
    const achados: string[] = [];
    for (const arquivo of arquivos) {
      const linhas = lerDoRepo(arquivo).split("\n");
      linhas.forEach((linha, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return; // comentário
        if (LITERAL_DE_ESTOQUE_BAIXO.test(linha)) {
          achados.push(`${arquivo}:${i + 1}: ${linha.trim()}`);
        }
      });
    }
    expect(achados).toEqual([]);
  });

  it("os dois pontos usam a regra de avisos-do-lojista.ts", () => {
    const view = lerDoRepo("src/views/admin/AdminProductsView.tsx");
    const hook = lerDoRepo("src/hooks/useProducts.ts");
    expect(view).toContain("precisaDeReposicao");
    expect(hook).toContain("LIMIAR_PADRAO_DE_ESTOQUE");
  });
});

const deleteProduct = vi.fn();
const addProduct = vi.fn();
const loadProducts = vi.fn();
const toggleProductStatus = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();

let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

vi.mock("@/components/ui/dropdown-menu", () => {
  const passa = ({ children }: { children: ReactNode }) =>
    createElement("div", null, children);
  return {
    DropdownMenu: passa,
    DropdownMenuTrigger: passa,
    DropdownMenuContent: passa,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => createElement("button", { type: "button", onClick }, children),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarProduto(overrides: Record<string, unknown>) {
  produtosMock = [
    {
      id: "prod-1",
      name: "Produto de Teste",
      category: "Geral",
      images: [
        "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
      ],
      isActive: true,
      stock: 20,
      price: 100,
      costPrice: 40,
      ...overrides,
    },
  ];
}

describe.each(["compact", "detailed"] as const)(
  "AdminProductsView (%s): estoque baixo segue precisaDeReposicao",
  (viewMode) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;

    beforeEach(() => {
      vi.clearAllMocks();
      loadProducts.mockResolvedValue({ products: produtosMock, total: 1 });
      fetchExecutiveSummary.mockResolvedValue(null);
      addProduct.mockResolvedValue(undefined);
      toggleProductStatus.mockResolvedValue(true);

      vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
      vi.stubGlobal("ResizeObserver", ResizeObserverStub);
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const armazem = new Map<string, string>(
        viewMode === "detailed"
          ? [["admin_products_view_mode", "detailed"]]
          : [],
      );
      vi.stubGlobal("localStorage", {
        getItem: (chave: string) => armazem.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
          armazem.set(chave, valor);
        },
        removeItem: (chave: string) => {
          armazem.delete(chave);
        },
      });

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
      vi.restoreAllMocks();
    });

    async function montar() {
      const { AdminProductsView } = await import(
        "@/views/admin/AdminProductsView"
      );
      await act(async () => {
        raiz.render(
          createElement(AdminProductsView, { onNavigate, active: true }),
        );
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
    }

    function cartao(): HTMLElement {
      const classe =
        viewMode === "detailed"
          ? ".content-visibility-detailed-card"
          : ".content-visibility-compact-card";
      const el = hospedeiro.querySelector(classe);
      if (!el) throw new Error("Cartão do produto não está na tela.");
      return el as HTMLElement;
    }

    /** O selo "Crítico" só existe no cartão detalhado; o sinal comum aos
     * dois modos é a cor do número do estoque (`text-rose-500`). */
    function numeroDoEstoque(): HTMLElement {
      const alvo = [...cartao().querySelectorAll("span")].find((el) =>
        /^\d{2,}$/.test(el.textContent ?? ""),
      );
      if (!alvo) throw new Error("Número do estoque não está no cartão.");
      return alvo as HTMLElement;
    }

    function temSeloCritico(): boolean {
      return [...cartao().querySelectorAll('[data-slot="badge"]')].some(
        (el) => el.textContent === "Crítico",
      );
    }

    function esperado(baixo: boolean) {
      expect(numeroDoEstoque().className.includes("text-rose-500")).toBe(baixo);
      if (viewMode === "detailed") expect(temSeloCritico()).toBe(baixo);
    }

    it("estoque 5 e mínimo NULL: usa o limiar padrão (5) e é baixo", async () => {
      montarProduto({ stock: 5, estoqueMinimo: null });
      await montar();
      esperado(true);
    });

    it("estoque 8 e mínimo 10: o mínimo do produto manda, é baixo", async () => {
      montarProduto({ stock: 8, estoqueMinimo: 10 });
      await montar();
      esperado(true);
    });

    it("estoque 4 e mínimo 0: o lojista disse 'não me avise', sem selo", async () => {
      montarProduto({ stock: 4, estoqueMinimo: 0 });
      await montar();
      esperado(false);
    });

    it("estoque 6 e mínimo NULL: acima do limiar padrão, sem selo", async () => {
      montarProduto({ stock: 6, estoqueMinimo: null });
      await montar();
      esperado(false);
    });

    it("Esgotado (<= 0) segue igual: etiqueta de status", async () => {
      montarProduto({ stock: 0, estoqueMinimo: null });
      await montar();
      const rotulos = [...cartao().querySelectorAll('[data-slot="badge"]')].map(
        (el) => el.textContent,
      );
      expect(rotulos).toContain("Esgotado");
    });
  },
);
