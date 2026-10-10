// @vitest-environment jsdom
//
// PAINEL SIMPLES, onda J2, frente J2-A ("produtos-detalhado-sem-corte").
// Render num celular simulado mediu que o cartão do modo DETALHADO de Produtos
// (altura fixa `h-[440px]`, posta por causa do `content-visibility`) cortava o
// que passava: o "Preço de Venda" e o "Potencial" ficavam escondidos — 45 a
// 114px a 360/412, 90 a 143px a 768 e 173 a 280px a 1280. O jsdom não aplica
// CSS, então a prova é sobre as classes; a medida real fica para o render.
//
//   a. nem a raiz do cartão nem o contêiner dele têm altura fixa (`h-[…px]`):
//      o cartão cresce com o conteúdo;
//   b. o `content-visibility: auto` continua (a classe do cartão segue lá, com
//      o `contain-intrinsic-size` dela) — a rolagem da lista não pesa;
//   c. preço de venda, custo parado, estoque e "Potencial" estão no cartão e o
//      preço e o "Potencial" dividem o mesmo contêiner (a mesma linha);
//   d. nenhum ancestral do preço corta o excesso por altura fixa;
//   e. nome longo continua em até 2 linhas (`line-clamp-2`, sem `truncate`).
//
// Montagem real (createRoot + act), mesmo molde de produtos-cabem-no-celular.
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
let carregandoMock = false;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: carregandoMock,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

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

/** Altura fixa, com ou sem variante (`sm:`, `xl:`) e com ou sem `!`: `h-[440px]`,
 * `h-[27rem]`, `h-96`, `h-2.5`, `max-h-[300px]`, `max-h-96`. Não casa `h-full`,
 * `min-h-*`, `flex-1` nem `size-*`. */
const ALTURA_FIXA = /(^|:)!?(max-)?h-(\d+(\.\d+)?|\[\d+(\.\d+)?(px|rem|em)\])$/;

/** Reserva do `content-visibility` e altura do esqueleto: pixels por breakpoint. */
const RESERVA_NO_CELULAR = /^!\[contain-intrinsic-size:auto_(\d+)px\]$/;
const RESERVA_NO_XL = /^xl:!\[contain-intrinsic-size:auto_(\d+)px\]$/;
const ESQUELETO_NO_CELULAR = /^h-\[(\d+)px\]$/;
const ESQUELETO_NO_XL = /^xl:h-\[(\d+)px\]$/;

/** Primeiro número (px) da primeira classe que casa, ou undefined. */
function pxDaClasse(classes: string[], padrao: RegExp): number | undefined {
  for (const classe of classes) {
    const achou = padrao.exec(classe);
    if (achou) return Number(achou[1]);
  }
  return undefined;
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function classesDe(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("Produtos, modo detalhado: o cartão não esconde o preço (onda J2, J2-A)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    carregandoMock = false;
    produtosMock = [
      {
        id: "prod-1",
        name: "Vestido longo de linho com alças finas e botões de madeira",
        category: "Vestidos",
        images: [
          "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
        ],
        isActive: true,
        stock: 2,
        price: 15,
        costPrice: 10,
        estoqueMinimo: null,
      },
    ];
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
    armazem = new Map<string, string>([
      ["admin_products_view_mode", "detailed"],
    ]);
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
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function cartao(): HTMLElement {
    const el = hospedeiro.querySelector(".content-visibility-detailed-card");
    if (!el) throw new Error("Cartão detalhado do produto não está na tela.");
    return el as HTMLElement;
  }

  function rotulo(texto: string): HTMLElement {
    const el = [...cartao().querySelectorAll("p")].find(
      (p) => p.textContent?.trim() === texto,
    );
    if (!el) throw new Error(`Rótulo '${texto}' não está no cartão.`);
    return el as HTMLElement;
  }

  describe("a. sem altura fixa que corte o conteúdo", () => {
    it("a raiz do cartão (a que a grade enxerga) não tem h-[…px]", async () => {
      await montar();

      const raizDoCartao = cartao().parentElement as HTMLElement;
      const fixas = classesDe(raizDoCartao).filter((c) => ALTURA_FIXA.test(c));
      expect(fixas, "altura fixa na raiz do cartão detalhado").toEqual([]);
      expect(classesDe(raizDoCartao)).not.toContain("h-[440px]");
    });

    it("nada entre a raiz do cartão e o preço tem altura fixa em px", async () => {
      await montar();

      const raizDoCartao = cartao().parentElement as HTMLElement;
      let atual: HTMLElement | null = rotulo("Preço de Venda");
      while (atual && atual !== raizDoCartao.parentElement) {
        const fixas = classesDe(atual).filter((c) => ALTURA_FIXA.test(c));
        expect(fixas, `<${atual.tagName}> com altura fixa`).toEqual([]);
        atual = atual.parentElement;
      }
    });
  });

  describe("b. content-visibility segue valendo", () => {
    it("o cartão mantém a classe do content-visibility (rolagem leve)", async () => {
      await montar();

      expect(classesDe(cartao())).toContain("content-visibility-detailed-card");
    });
  });

  describe("c. preço, custo, estoque e Potencial no cartão", () => {
    it("mostra os quatro e põe preço e Potencial no mesmo contêiner", async () => {
      await montar();

      const texto = cartao().textContent ?? "";
      expect(texto).toContain("Preço de Venda");
      expect(texto).toContain("R$ 15,00");
      expect(texto).toContain("Dinheiro parado em estoque");
      expect(texto).toContain("R$ 20,00");
      expect(texto).toContain("Unidades em Estoque");
      expect(texto).toContain("Potencial");
      expect(texto).toContain("+ R$ 10,00");

      const linhaDoPreco = rotulo("Preço de Venda").parentElement
        ?.parentElement as HTMLElement;
      const linhaDoPotencial = rotulo("Potencial").parentElement
        ?.parentElement as HTMLElement;
      expect(linhaDoPreco).toBe(linhaDoPotencial);
    });
  });

  describe("d. o contêiner do conteúdo cresce, não corta", () => {
    it("o conteúdo principal ocupa o que sobra (flex-1), sem h-full fixo ao cartão", async () => {
      await montar();

      const conteudo = rotulo("Preço de Venda").closest(
        "div.flex.flex-col.p-5",
      ) as HTMLElement | null;
      expect(conteudo, "contêiner principal do cartão ausente").not.toBeNull();
      expect(classesDe(conteudo as HTMLElement)).toContain("flex-1");
      expect(classesDe(conteudo as HTMLElement)).not.toContain("h-full");
    });
  });

  describe("e. nome longo em até 2 linhas", () => {
    it("o nome mantém line-clamp-2, quebra palavra e não vira truncate", async () => {
      await montar();

      const nome = [...cartao().querySelectorAll("h4")].find(
        (el) => el.textContent === produtosMock[0].name,
      );
      expect(nome, "nome do produto ausente").toBeDefined();
      const classes = classesDe(nome as HTMLElement);
      expect(classes).toContain("line-clamp-2");
      expect(classes).toContain("break-words");
      expect(classes).toContain("pr-12");
      expect(classes).not.toContain("truncate");
    });
  });
  describe("f. o regex de altura fixa pega os disfarces e só eles", () => {
    it.each([
      "h-[440px]",
      "sm:h-[300px]",
      "xl:!h-[520px]",
      "h-[27rem]",
      "h-96",
      "lg:h-72",
      "h-2.5",
      "max-h-[300px]",
      "md:max-h-96",
    ])("%s é altura fixa", (classe) => {
      expect(ALTURA_FIXA.test(classe)).toBe(true);
    });

    it.each([
      "h-full",
      "h-auto",
      "min-h-[440px]",
      "min-h-96",
      "flex-1",
      "size-20",
      "max-h-full",
      "[contain-intrinsic-size:auto_520px]",
    ])("%s não é", (classe) => {
      expect(ALTURA_FIXA.test(classe)).toBe(false);
    });
  });

  describe("g. o preço fica embaixo e alinhado entre cartões de alturas diferentes", () => {
    it("o contêiner do preço é flex-col com gap (não space-y) e a linha do preço tem mt-auto", async () => {
      await montar();

      const linha = rotulo("Preço de Venda").parentElement
        ?.parentElement as HTMLElement;
      const conteiner = linha.parentElement as HTMLElement;
      const classesDoConteiner = classesDe(conteiner);
      expect(classesDoConteiner).toContain("flex");
      expect(classesDoConteiner).toContain("flex-col");
      expect(classesDoConteiner).toContain("flex-1");
      expect(classesDoConteiner).toContain("gap-4");
      // `space-y-*` põe margem no filho e vence o `mt-auto`.
      expect(classesDoConteiner.some((c) => c.startsWith("space-y"))).toBe(
        false,
      );
      expect(classesDe(linha)).toContain("mt-auto");
    });
  });

  describe("h. reserva do content-visibility e esqueleto usam os mesmos números", () => {
    it("o cartão sobrescreve o contain-intrinsic-size do index.css (com !) por breakpoint", async () => {
      await montar();

      const classes = classesDe(cartao());
      const celular = pxDaClasse(classes, RESERVA_NO_CELULAR);
      const xl = pxDaClasse(classes, RESERVA_NO_XL);
      expect(celular, "reserva do celular ausente").toBeDefined();
      expect(xl, "reserva do xl ausente").toBeDefined();
      // O cartão real mede 459 a 718px: a reserva não pode ficar nos 440 antigos.
      expect(celular).toBeGreaterThan(440);
      expect(xl as number).toBeGreaterThan(celular as number);
      expect(classes).toContain("content-visibility-detailed-card");
    });

    it("o esqueleto de carregamento tem a mesma altura da reserva, no celular e no xl", async () => {
      carregandoMock = true;
      produtosMock = [];
      await montar();
      const esqueleto = hospedeiro.querySelector(
        ".admin-glass.animate-pulse",
      ) as HTMLElement | null;
      expect(esqueleto, "esqueleto do modo detalhado ausente").not.toBeNull();
      const classesDoEsqueleto = classesDe(esqueleto as HTMLElement);
      expect(classesDoEsqueleto).not.toContain("h-[440px]");

      // Remonta com um produto para ler a reserva do cartão real.
      carregandoMock = false;
      produtosMock = [
        {
          id: "prod-2",
          name: "Blusa",
          category: "Blusas",
          images: [],
          isActive: true,
          stock: 5,
          price: 20,
          costPrice: 10,
          estoqueMinimo: null,
        },
      ];
      await act(async () => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await montar();
      const classesDoCartao = classesDe(cartao());

      expect(pxDaClasse(classesDoEsqueleto, ESQUELETO_NO_CELULAR)).toBe(
        pxDaClasse(classesDoCartao, RESERVA_NO_CELULAR),
      );
      expect(pxDaClasse(classesDoEsqueleto, ESQUELETO_NO_XL)).toBe(
        pxDaClasse(classesDoCartao, RESERVA_NO_XL),
      );
      expect(
        pxDaClasse(classesDoEsqueleto, ESQUELETO_NO_CELULAR),
      ).toBeDefined();
    });
  });
});
