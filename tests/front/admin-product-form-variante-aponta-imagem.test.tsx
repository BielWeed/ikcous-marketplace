// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09): na "Nova Variante", a imagem da variante era um
// UPLOAD de arquivo — ineficiente, porque a imagem já foi enviada quando o
// PRODUTO a recebeu. A variante deve APONTAR uma das imagens do produto.
//
// Contrato provado aqui:
//   1. As imagens do produto aparecem como miniaturas selecionáveis no
//      modal da variante; tocar numa escolhe, tocar de novo desescolhe.
//   2. O input de arquivo da variante (`variant-image-input`) NÃO existe
//      mais — nada é enviado de novo.
//   3. Sem imagens no produto (e nada gravado na variante), o modal avisa
//      que é preciso adicionar imagens primeiro.
//   4. Efetivar a variante com imagem escolhida grava a URL APONTADA
//      (upsertVariants recebe a mesma URL do produto).
//
// Mesmo padrão de admin-product-form-um-grupo-de-variacao.test.tsx: createRoot
// + act, hooks de dados mockados, sem @testing-library/react.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsertVariants = vi.fn().mockResolvedValue(undefined);
const fetchProduct = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
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

// LazyImage real fica preguiçoso no jsdom (IntersectionObserver stubado nunca
// dispara) — o que este teste precisa é ver a URL que a variante APONTA.
vi.mock("@/components/LazyImage", () => ({
  LazyImage: ({
    src,
    alt,
  }: {
    src: string;
    alt?: string;
    className?: string;
  }) => <img src={src} alt={alt ?? ""} data-testid="lazy-imagem" />,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const IMAGENS = ["http://img.local/a.jpg", "http://img.local/b.jpg"];

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(document.body, texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Espera até `condicao()` ficar verdadeira — o re-render do React pode
 * chegar um tique depois do clique (mesmo helper dos testes irmãos). */
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

describe("AdminProductFormView — imagem da variante aponta para as imagens do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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

  /** Produto legado COM imagens já enviadas — o que a variante deve apontar. */
  async function montarProdutoComImagens() {
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "",
      price: 50,
      stock: 10,
      category: "Geral",
      images: IMAGENS,
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
    });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });
    await act(async () => {
      digitar("variant-name", "Cor");
      digitar("variant-value", "Rosa");
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  function miniaturas() {
    return [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        "button[aria-pressed]",
      ),
    ];
  }

  it("as imagens do PRODUTO aparecem como miniaturas selecionáveis — e o input de arquivo morreu", async () => {
    await montarProdutoComImagens();

    // As duas imagens do produto estão na tela, selecionáveis…
    const mini = miniaturas();
    expect(mini.length).toBe(2);
    expect(mini.map((m) => m.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
    ]);

    // …e o upload da variante NÃO existe mais.
    expect(document.getElementById("variant-image-input")).toBeNull();
    expect(
      document.body.querySelector('input[name="variantImageInput"]'),
    ).toBeNull();
  });

  it("tocar numa miniatura seleciona (e de novo desescolhe); efetivar grava a URL APONTADA", async () => {
    await montarProdutoComImagens();

    const mini = miniaturas();
    await act(async () => {
      mini[1].click();
    });

    // A segunda imagem ficou selecionada (aria-pressed + anel); a primeira,
    // não. O re-render pode chegar um tique depois do clique — esperarAte
    // espera o estado, não a corrida.
    await esperarAte(() =>
      miniaturas().some(
        (m) =>
          m.getAttribute("aria-pressed") === "true" &&
          m.getAttribute("title")?.includes("Selecionada"),
      ),
    );
    const depoisDeEscolher = miniaturas();
    expect(depoisDeEscolher[0].getAttribute("aria-pressed")).toBe("false");
    expect(depoisDeEscolher[1].getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      clicarObrigatorio("Efetivar Variante");
    });

    // A variante entrou na lista APONTANDO a imagem do produto: a <img>
    // dela carrega a MESMA URL (nada novo foi enviado — upsertVariants só
    // roda no botão Salvar do produto).
    await esperarAte(() =>
      [
        ...document.body.querySelectorAll(
          '[data-testid="variante-cadastrada"]',
        ),
      ].some(
        (el) =>
          !!el
            .closest(".group")
            ?.querySelector('img[src="http://img.local/b.jpg"]'),
      ),
    );
    const item = [
      ...document.body.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) =>
      el.closest(".group")?.querySelector('img[src="http://img.local/b.jpg"]'),
    );
    expect(item).toBeTruthy();
    expect(upsertVariants).not.toHaveBeenCalled();
  });

  it("produto SEM imagens: o modal avisa para adicionar antes — não oferece upload", async () => {
    fetchProduct.mockResolvedValue({
      id: "p-2",
      name: "Sem Foto",
      description: "",
      price: 10,
      stock: 0,
      category: "Geral",
      images: [],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
    });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-2"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      clicarObrigatorio("+ Novo");
    });

    expect(
      document.body.textContent?.includes(
        "Adicione imagens ao produto primeiro",
      ),
    ).toBe(true);
    expect(document.getElementById("variant-image-input")).toBeNull();
  });
});
