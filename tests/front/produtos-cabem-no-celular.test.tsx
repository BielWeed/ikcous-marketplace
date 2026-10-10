// @vitest-environment jsdom
//
// PAINEL SIMPLES, onda J, frente J3 ("produtos-no-celular"), tela de LISTA.
// Render num celular simulado (360px) mostrou: o cartão "ROI do Portfólio"
// com "130.15%" (jargão e ponto decimal em inglês), o estoque "02" com zero à
// esquerda, a grade sem palavra nenhuma para estoque baixo (só a cor — e só o
// modo detalhado tinha o selo "Crítico"), o nome cortado em 1 linha nos dois
// modos e o botão grade/lista sem nome para o leitor de tela.
//
//   a. KPI "Lucro sobre o custo" com 1 casa em pt-BR ("130,2%"); nenhum
//      "ROI"/"Portfólio" na tela nem no código (fora de comentário);
//   b. grade: estoque 2 com mínimo nulo mostra o selo "Crítico" (a MESMA regra
//      `precisaDeReposicao` do modo detalhado, P-J2), estoque 30 não;
//   c. nome da grade em até 2 linhas (`line-clamp-2`, sem `truncate`);
//   d. detalhado: margem "33,3%", lucro sobre o custo "50,0%", nome em 2
//      linhas sem ficar embaixo do ⋮ (`pr-12`);
//   e. botão de modo com nome acessível que diz o que o toque faz;
//   f. estoque "2", não "02";
//   g. fonte: nenhum `toFixed(…)%` nos dois arquivos da frente.
//
// Montagem real (createRoot + act), mesmo molde de
// admin-products-margem-sem-custo.test.tsx.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

// Lucro sobre o custo = (690,5 − 300) ÷ 300 × 100 = 130,1666…% → "130,2%".
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 300, totalValue: 690.5 } },
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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

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

const RAIZ = join(__dirname, "..", "..");
const JARGAO = /\bROI\b|Portf[óo]lio/;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarProduto(overrides: Record<string, unknown>) {
  produtosMock = [
    {
      id: "prod-1",
      name: "Vestido longo de linho com alças finas e botões de madeira",
      category: "Vestidos",
      images: [
        "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
      ],
      isActive: true,
      stock: 20,
      price: 15,
      costPrice: 10,
      estoqueMinimo: null,
      ...overrides,
    },
  ];
}

/** Linhas de código do arquivo, sem as de comentário (mesma regra das guardas). */
function codigoSemComentario(relativo: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo
  return readFileSync(join(RAIZ, relativo), "utf8")
    .split("\n")
    .filter((linha) => {
      const limpa = linha.trim();
      return !(
        limpa.startsWith("//") ||
        limpa.startsWith("/*") ||
        limpa.startsWith("*") ||
        limpa.startsWith("{/*")
      );
    })
    .join("\n");
}

describe("Produtos cabem no celular (onda J, J3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockImplementation(async () => ({
      products: produtosMock,
      total: 1,
    }));
    fetchExecutiveSummary.mockResolvedValue(null);

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

  async function montar(modo: "compact" | "detailed" = "compact") {
    if (modo === "detailed")
      armazem.set("admin_products_view_mode", "detailed");
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function cartao(modo: "compact" | "detailed"): HTMLElement {
    const el = hospedeiro.querySelector(
      modo === "detailed"
        ? ".content-visibility-detailed-card"
        : ".content-visibility-compact-card",
    );
    if (!el) throw new Error(`Cartão ${modo} do produto não está na tela.`);
    return el as HTMLElement;
  }

  function seloCritico(modo: "compact" | "detailed"): HTMLElement | undefined {
    return [...cartao(modo).querySelectorAll('[data-slot="badge"]')].find(
      (el) => el.textContent === "Crítico",
    ) as HTMLElement | undefined;
  }

  function nomeDoProduto(modo: "compact" | "detailed"): HTMLElement {
    const nome = [...cartao(modo).querySelectorAll("h4")].find(
      (el) => el.textContent === produtosMock[0].name,
    );
    if (!nome) throw new Error("Nome do produto não está no cartão.");
    return nome as HTMLElement;
  }

  describe("a. métrica do topo sem ROI e em pt-BR", () => {
    it("mostra 'Lucro sobre o custo' com '130,2%' e nenhum ROI/Portfólio na tela", async () => {
      montarProduto({});
      await montar();

      const tela = hospedeiro.textContent ?? "";
      expect(tela).toContain("Lucro sobre o custo");
      expect(tela).toContain("130,2%");
      expect(tela).not.toContain("130.17%");
      expect(tela).not.toMatch(JARGAO);
    });

    it("o código da tela (fora de comentário) não escreve ROI nem Portfólio", () => {
      expect(
        codigoSemComentario("src/views/admin/AdminProductsView.tsx"),
      ).not.toMatch(JARGAO);
    });
  });

  describe("b. grade: estoque baixo em palavra, mesma regra do detalhado", () => {
    it("estoque 2 e mínimo nulo: selo 'Crítico' em 11px", async () => {
      montarProduto({ stock: 2, estoqueMinimo: null });
      await montar();

      const selo = seloCritico("compact");
      expect(selo, "a grade não diz 'Crítico'").toBeDefined();
      expect(selo?.className).toContain("text-[11px]");
    });

    it("estoque 30 e mínimo nulo: sem selo", async () => {
      montarProduto({ stock: 30, estoqueMinimo: null });
      await montar();

      expect(seloCritico("compact")).toBeUndefined();
    });

    it("estoque 8 e mínimo 10: o mínimo do produto manda também na grade", async () => {
      montarProduto({ stock: 8, estoqueMinimo: 10 });
      await montar();

      expect(seloCritico("compact")).toBeDefined();
    });
  });

  describe("c. nome da grade em até 2 linhas", () => {
    it("o nome usa line-clamp-2 e quebra palavra, sem truncate", async () => {
      montarProduto({});
      await montar();

      const nome = nomeDoProduto("compact");
      expect(nome.className).toContain("line-clamp-2");
      expect(nome.className).toContain("break-words");
      expect(nome.className).not.toContain("truncate");
    });
  });

  describe("d. modo detalhado", () => {
    it("margem '33,3%' e lucro sobre o custo '50,0%', em pt-BR", async () => {
      montarProduto({ price: 15, costPrice: 10 });
      await montar("detailed");

      const textos = [
        ...cartao("detailed").querySelectorAll(
          "span.text-lg.font-black.tracking-tighter",
        ),
      ].map((el) => el.textContent);
      expect(textos).toEqual(["33,3%", "50,0%"]);
      expect(cartao("detailed").textContent).toContain("Lucro sobre o custo");
      expect(cartao("detailed").textContent).not.toMatch(JARGAO);
    });

    it("o nome inteiro em 2 linhas, sem ficar embaixo do menu ⋮", async () => {
      montarProduto({});
      await montar("detailed");

      const nome = nomeDoProduto("detailed");
      expect(nome.className).toContain("line-clamp-2");
      expect(nome.className).toContain("break-words");
      expect(nome.className).toContain("pr-12");
      expect(nome.className).not.toContain("truncate");
    });
  });

  describe("e. botão grade/lista com nome acessível", () => {
    it("diz o que o toque faz e troca o nome depois do toque", async () => {
      montarProduto({});
      await montar();

      const paraLista = hospedeiro.querySelector(
        'button[aria-label="Mostrar em lista com detalhes"]',
      ) as HTMLButtonElement | null;
      expect(paraLista, "botão de modo sem nome acessível").not.toBeNull();
      expect(paraLista?.hasAttribute("aria-pressed")).toBe(false);

      await act(async () => {
        paraLista?.click();
        await esperarMicrotarefas();
      });

      expect(
        hospedeiro.querySelector('button[aria-label="Mostrar em grade"]'),
      ).not.toBeNull();
    });
  });

  describe("f. estoque sem zero à esquerda", () => {
    it.each(["compact", "detailed"] as const)(
      "%s: estoque 2 aparece '2', não '02'",
      async (modo) => {
        montarProduto({ stock: 2 });
        await montar(modo);

        const textos = [...cartao(modo).querySelectorAll("span")].map(
          (el) => el.textContent,
        );
        expect(textos).toContain("2");
        expect(textos).not.toContain("02");
      },
    );
  });

  describe("g. fonte: percentual nunca com toFixed (ponto em inglês)", () => {
    it.each([
      "src/views/admin/AdminProductsView.tsx",
      "src/views/admin/AdminProductFormView.tsx",
    ])("%s não tem toFixed(…)% nem '33.3%' escrito à mão", (arquivo) => {
      const codigo = codigoSemComentario(arquivo);
      expect(codigo).not.toMatch(/toFixed\(\d*\)\}?%/);
      // Percentual fixo de exemplo também em pt-BR ("33,3%", não "33.3%").
      expect(codigo).not.toMatch(/\d\.\d+\s?%/);
    });
  });

  describe("h. guia de métricas: exemplo e simulador em pt-BR e sem corte", () => {
    async function abrirGuia() {
      const ajuda = hospedeiro.querySelector(
        'button[title="Guia Completo de Métricas e Ajuda"]',
      ) as HTMLButtonElement | null;
      expect(ajuda, "botão do guia ausente").not.toBeNull();
      await act(async () => {
        ajuda?.click();
        await esperarMicrotarefas();
      });
    }

    function botaoDoGuia(texto: string): HTMLButtonElement {
      const botao = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === texto,
      );
      if (!botao) throw new Error(`aba '${texto}' do guia ausente`);
      return botao as HTMLButtonElement;
    }

    it("o exemplo da margem no dicionário diz '33,3%'", async () => {
      montarProduto({});
      await montar();
      await abrirGuia();

      const exemplo = [...document.querySelectorAll("span")].find((el) =>
        el.textContent?.includes("Custo R$10 / Venda R$15"),
      );
      expect(exemplo, "exemplo da margem ausente").toBeDefined();
      expect(exemplo?.textContent).toContain("33,3%");
      expect(exemplo?.textContent).not.toContain("33.3%");
    });

    it("as 4 caixas do simulador crescem com o rótulo (min-h-20, nunca h-20)", async () => {
      montarProduto({});
      await montar();
      await abrirGuia();
      await act(async () => {
        botaoDoGuia("Simulador").click();
        await esperarMicrotarefas();
      });

      const rotulo = [...document.querySelectorAll("p")].find(
        (el) => el.textContent === "Lucro sobre o custo (por unidade)",
      );
      expect(rotulo, "caixa 'por unidade' ausente").toBeDefined();
      const grade = rotulo?.parentElement?.parentElement as HTMLElement;
      const caixas = [...grade.children] as HTMLElement[];
      expect(caixas).toHaveLength(4);
      for (const caixa of caixas) {
        const classes = caixa.className.split(/\s+/);
        expect(classes).toContain("min-h-20");
        expect(classes).not.toContain("h-20");
      }
    });
  });
});
