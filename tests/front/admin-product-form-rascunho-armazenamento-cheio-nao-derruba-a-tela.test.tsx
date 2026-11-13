// @vitest-environment jsdom
//
// O salvamento automático do rascunho do produto não pode estourar em silêncio.
//
// O defeito: 1 s depois de cada edição, o formulário guarda o rascunho no
// armazenamento do navegador. Com o armazenamento cheio (descrição enorme,
// muitas fotos em rascunho) ou bloqueado, o `setItem` lança
// `QuotaExceededError` dentro do temporizador — erro sem dono, que escapa da
// tela. O certo: a gravação falha em silêncio para ela (o que ela digitou
// segue na tela), nada de erro solto, e quando o armazenamento volta a aceitar
// a próxima edição é guardada.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

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
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1:lojista-1";

const campo = (id: string) =>
  document.getElementById(id) as HTMLInputElement | null;

describe("AdminProductFormView — armazenamento cheio não derruba o rascunho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let cheio: boolean;
  let errosSoltos: unknown[];
  const aoErroSolto = (erro: unknown) => {
    errosSoltos.push(erro);
  };
  const aoErroDaJanela = (evento: ErrorEvent) => {
    evento.preventDefault();
    errosSoltos.push(evento.error);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    cheio = false;
    errosSoltos = [];
    process.on("uncaughtException", aoErroSolto);
    window.addEventListener("error", aoErroDaJanela);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (cheio) {
          throw new DOMException(
            "The quota has been exceeded.",
            "QuotaExceededError",
          );
        }
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 3,
      sold: 0,
      category: "Geral",
      images: [],
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
    process.off("uncaughtException", aoErroSolto);
    window.removeEventListener("error", aoErroDaJanela);
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
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
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function digitarPreco(valor: string) {
    const preco = campo("product-sale-price");
    expect(preco).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(preco, valor);
      preco?.dispatchEvent(new Event("input", { bubbles: true }));
      // O campo entrega o valor depois de uma pausa e o salvamento automático
      // espera 1 s a mais.
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
  }

  it("com o armazenamento cheio, nenhum erro escapa do temporizador e a tela segue", async () => {
    await montar();
    cheio = true;

    await digitarPreco("60,00");

    expect(errosSoltos).toEqual([]);
    expect(armazem.has(CHAVE_EDICAO)).toBe(false);
    // A tela segue funcional: o que ela digitou continua lá.
    expect(campo("product-sale-price")).not.toBeNull();
  }, 20000);

  it("quando o armazenamento volta a aceitar, a próxima edição é guardada", async () => {
    await montar();
    cheio = true;
    await digitarPreco("60,00");
    expect(armazem.has(CHAVE_EDICAO)).toBe(false);

    cheio = false;
    await digitarPreco("65,00");

    expect(errosSoltos).toEqual([]);
    expect(armazem.has(CHAVE_EDICAO)).toBe(true);
  }, 20000);
});
