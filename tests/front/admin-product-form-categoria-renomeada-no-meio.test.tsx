// @vitest-environment jsdom
//
// A lojista está editando um produto e, de dentro do formulário, abre "Renomear,
// esconder ou apagar" e renomeia a categoria que o produto tem. O banco já
// trocou o nome no produto salvo. Se o campo "Categoria" do formulário ficasse
// com o nome ANTIGO, o "Salvar" devolveria o produto a uma categoria que não
// existe mais: o produto some do filtro da vitrine, sem erro nenhum. Este teste
// prende que o campo acompanha o nome novo (e que apagar a categoria escolhida
// esvazia o campo, para a lojista escolher outra), e que a tela abre pelo
// formulário.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const rpcMock = vi.fn();
const { categoriasDoBanco } = vi.hoisted(() => ({
  categoriasDoBanco: {
    lista: [] as Array<{ id: string; name: string; slug: string }>,
    carregando: false,
  },
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: categoriasDoBanco.lista,
    isLoading: categoriasDoBanco.carregando,
    addCategory: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryActive: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const selectDaCategoria = () =>
  document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;

function escolher(valor: string) {
  const el = selectDaCategoria();
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const espera = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Espera até a afirmação passar (no máximo 8 s), dando ao React a chance de pintar entre as
 * tentativas. Substitui a espera de tempo fixo: o que importa é o efeito, não quanto demorou.
 */
async function esperarAte(afirmacao: () => void, limiteMs = 8000) {
  const fim = Date.now() + limiteMs;
  for (;;) {
    try {
      afirmacao();
      return;
    } catch (erro) {
      if (Date.now() > fim) throw erro;
    }
    await act(async () => {
      await espera(20);
    });
  }
}

describe("AdminProductFormView — a categoria renomeada no meio da edição não volta ao nome antigo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    categoriasDoBanco.lista = [
      { id: "cat-1", name: "Geral", slug: "geral" },
      { id: "cat-2", name: "Cama", slug: "cama" },
    ];
    categoriasDoBanco.carregando = false;
    rpcMock.mockResolvedValue({ data: [], error: null });
    updateProduct.mockResolvedValue(undefined);
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 5,
      sold: 0,
      category: "Geral",
      images: ["https://cdn.exemplo.com/products/foto.jpg"],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          userId="lojista-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await espera(50);
    });
  }

  it("o formulário abre com a categoria do produto", async () => {
    await montar();
    expect(selectDaCategoria().value).toBe("Geral");
  });

  it("categoria RENOMEADA em outro lugar: o campo vira o nome novo, e o Salvar grava o nome novo", async () => {
    await montar();
    const { publicarMudancaDeCategoria } = await import(
      "@/lib/avisos-de-categoria"
    );
    await act(async () => {
      // o banco já trocou; a lista de categorias da tela chega com o nome novo
      categoriasDoBanco.lista = [
        { id: "cat-1", name: "Geral e Mais", slug: "geral-e-mais" },
        { id: "cat-2", name: "Cama", slug: "cama" },
      ];
      publicarMudancaDeCategoria({
        tipo: "renomeada",
        de: "Geral",
        para: "Geral e Mais",
      });
    });
    expect(selectDaCategoria().value).toBe("Geral e Mais");

    digitar("product-sale-price", "60,00");
    await act(async () => {
      await espera(300);
    });
    const salvar = botaoPorTexto("Salvar");
    expect(salvar).toBeDefined();
    await act(async () => {
      salvar?.click();
      await espera(50);
    });
    expect(
      (updateProduct.mock.calls[0]?.[1] as { category: string }).category,
    ).toBe("Geral e Mais");
  });

  it("OUTRA categoria renomeada: o campo não muda", async () => {
    await montar();
    const { publicarMudancaDeCategoria } = await import(
      "@/lib/avisos-de-categoria"
    );
    await act(async () => {
      publicarMudancaDeCategoria({
        tipo: "renomeada",
        de: "Cama",
        para: "Cama e Banho",
      });
    });
    expect(selectDaCategoria().value).toBe("Geral");
  });

  it("categoria escolhida APAGADA: o campo esvazia (a lojista escolhe outra), e a outra é intocada", async () => {
    await montar();
    const { publicarMudancaDeCategoria } = await import(
      "@/lib/avisos-de-categoria"
    );
    await act(async () => {
      categoriasDoBanco.lista = [{ id: "cat-2", name: "Cama", slug: "cama" }];
      publicarMudancaDeCategoria({ tipo: "apagada", nome: "geral" });
    });
    expect(selectDaCategoria().value).toBe("");
    await act(async () => {
      escolher("Cama");
    });
    expect(selectDaCategoria().value).toBe("Cama");
  });

  it("a opção 'Renomear, esconder ou apagar' abre a tela de gerenciar, e NÃO troca a categoria do produto", async () => {
    await montar();
    expect(rpcMock).not.toHaveBeenCalled();
    await act(async () => {
      escolher("MANAGE_CATEGORIES");
    });
    // A tela é baixada sob demanda (lazy): espera pelo que ela mostra, não por um tempo fixo.
    await esperarAte(() => {
      expect(rpcMock).toHaveBeenCalledWith("categorias_com_uso");
      expect(document.body.textContent).toMatch(/Renomeie, esconda da vitrine/);
    });
    expect(selectDaCategoria().value).toBe("Geral");
  });

  describe("rascunho de produto NOVO guardado no aparelho", () => {
    const AVISO = '[data-testid="categoria-do-rascunho-sumiu"]';

    async function guardarRascunho(categoria: string) {
      const { chaveDoRascunhoDoProduto, serializarRascunhoDoProduto } =
        await import("@/lib/rascunho-do-produto");
      const chave = chaveDoRascunhoDoProduto("lojista-1");
      if (!chave) throw new Error("sem chave de rascunho");
      localStorage.setItem(
        chave,
        serializarRascunhoDoProduto({
          name: "Vestido",
          description: "Longo",
          price: "50",
          stock: "3",
          category: categoria,
        }),
      );
    }

    async function montarProdutoNovo() {
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );
      await act(async () => {
        raiz.render(
          <AdminProductFormView
            userId="lojista-1"
            onNavigate={vi.fn()}
            // função nova a cada chamada: o formulário é React.memo e precisa reler a lista de categorias
            onSetDirty={vi.fn()}
          />,
        );
      });
      await act(async () => {
        await espera(50);
      });
    }

    it("categoria do rascunho que foi RENOMEADA/APAGADA: o campo esvazia e a lojista e' avisada de que precisa escolher de novo", async () => {
      await guardarRascunho("Brinquedo");
      await montarProdutoNovo();

      expect(document.getElementById("product-name")).toBeTruthy();
      expect(
        (document.getElementById("product-name") as HTMLInputElement).value,
      ).toBe("Vestido");
      expect(selectDaCategoria().value).toBe("");
      expect(document.querySelector(AVISO)?.textContent).toContain("Brinquedo");
      const { toast } = await import("sonner");
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("Escolha a categoria de novo"),
      );

      // escolher outra tira o aviso e o campo fica com a escolha
      await act(async () => {
        escolher("Cama");
      });
      expect(selectDaCategoria().value).toBe("Cama");
      expect(document.querySelector(AVISO)).toBeNull();
    });

    it("categoria do rascunho que AINDA existe fica como estava, sem aviso", async () => {
      await guardarRascunho("Cama");
      await montarProdutoNovo();

      expect(selectDaCategoria().value).toBe("Cama");
      expect(document.querySelector(AVISO)).toBeNull();
      const { toast } = await import("sonner");
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it("com a lista de categorias ainda chegando nao conclui nada; quando chega, confere", async () => {
      categoriasDoBanco.lista = [];
      categoriasDoBanco.carregando = true;
      await guardarRascunho("Brinquedo");
      await montarProdutoNovo();
      // lista ainda chegando: nada afirmado, nada avisado
      const { toast } = await import("sonner");
      expect(document.querySelector(AVISO)).toBeNull();
      expect(toast.warning).not.toHaveBeenCalled();

      categoriasDoBanco.lista = [{ id: "cat-2", name: "Cama", slug: "cama" }];
      categoriasDoBanco.carregando = false;
      await montarProdutoNovo();
      expect(selectDaCategoria().value).toBe("");
      expect(document.querySelector(AVISO)?.textContent).toContain("Brinquedo");
    });
  });
});
