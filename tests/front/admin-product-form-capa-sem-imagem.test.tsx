// @vitest-environment jsdom
//
// Produto SEM foto não pode ficar com a capa "Sem Imagem" para sempre.
//
// O defeito: `mapProductFromDB` inventa `["https://placehold.co/600x400?text=
// Sem+Imagem"]` quando o produto não tem foto (isso é só EXIBIÇÃO). O
// formulário de edição abria com esse marcador dentro da lista de fotos, a foto
// de verdade entrava DEPOIS dele, e o salvar gravava as duas. A vitrine mostra
// `images[0]`: o cartão cinza "Sem Imagem" ficava na frente da foto real, para
// sempre. O marcador também contava no limite de 10 fotos e vem de site de
// terceiros.
//
// Provado aqui, no fluxo real da tela:
//  - o formulário abre SEM o marcador (produto sem foto → lista vazia; produto
//    já gravado com o marcador na posição 0 → ele sai);
//  - a primeira foto enviada vira `images[0]` no que chega em `updateProduct`;
//  - o salvar nunca grava URL `placehold.co` (produto novo e edição);
//  - o limite de 10 fotos conta só as reais;
//  - rascunho antigo com o marcador também volta sem ele.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARCADOR = "https://placehold.co/600x400?text=Sem+Imagem";
const FOTO_REAL = "https://cdn.exemplo.com/products/foto-real.jpg";
const FOTO_NOVA = "https://cdn.exemplo.com/products/foto-nova.jpg";

const fetchProduct = vi.fn();
const addProduct = vi.fn();
const updateProduct = vi.fn();
const upsertVariants = vi.fn();
const uploadProductImages = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages,
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
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_EDICAO = "ikcous_product_form_draft_edit_p-1:lojista-1";
const CHAVE_NOVO = "ikcous_product_form_draft:lojista-1";

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

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function escolherFotos(arquivos: File[]) {
  const input = document.getElementById(
    "product-image-upload",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: arquivos,
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const arquivo = (nome: string) =>
  new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });

/** O produto como `fetchProduct` o devolve (o mapper já pôs o marcador). */
const produtoDoBanco = (images: string[]) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: 5,
  sold: 0,
  category: "Geral",
  images,
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
});

describe("AdminProductFormView — produto sem foto não ganha a capa 'Sem Imagem'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
    addProduct.mockResolvedValue({ id: "novo-1" });
    uploadProductImages.mockResolvedValue([FOTO_NOVA]);
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

  async function montar(productId: string | null = "p-1") {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={productId ?? undefined}
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

  async function enviarFoto() {
    await act(async () => {
      escolherFotos([arquivo("nova.jpg")]);
      await new Promise((r) => setTimeout(r, 100));
    });
  }

  async function salvar(texto = "Salvar") {
    const botao = botaoPorTexto(texto);
    if (!botao) throw new Error(`O botão ${texto} não está na tela.`);
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const fotosNaTela = () =>
    [...hospedeiro.querySelectorAll("img")].map((i) => i.getAttribute("src"));

  const imagensEnviadas = () =>
    (updateProduct.mock.calls[0]?.[1] as { images: string[] }).images;

  it("produto sem foto abre com a lista vazia: o marcador não aparece na tela", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([MARCADOR]));
    await montar();

    expect(fotosNaTela().some((s) => s?.includes("placehold.co"))).toBe(false);
  });

  it("produto sem foto + foto nova: a foto nova é a images[0] que chega ao banco", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([MARCADOR]));
    await montar();
    await enviarFoto();
    await salvar();

    expect(imagensEnviadas()).toEqual([FOTO_NOVA]);
  });

  it("produto antigo gravado com o marcador na posição 0: ele sai ao abrir e ao salvar", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([MARCADOR, FOTO_REAL]));
    await montar();

    const src = fotosNaTela();
    expect(src.some((s) => s?.includes("placehold.co"))).toBe(false);
    expect(src).toContain(FOTO_REAL);

    await enviarFoto();
    await salvar();

    expect(imagensEnviadas()).toEqual([FOTO_REAL, FOTO_NOVA]);
  });

  it("salvar um produto sem foto nunca grava o marcador (vai lista vazia)", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([MARCADOR]));
    await montar();
    digitar("product-sale-price", "60,00");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await salvar();

    expect(imagensEnviadas()).toEqual([]);
  });

  it("trava do salvar: mesmo que um marcador chegue à lista por outro caminho, ele não é gravado", async () => {
    // Um envio que devolve a URL do marcador (caminho que não existe hoje):
    // a garantia "nunca grava placehold.co" não depende de a lista ter
    // nascido limpa.
    fetchProduct.mockResolvedValue(produtoDoBanco([FOTO_REAL]));
    uploadProductImages.mockResolvedValue([MARCADOR]);
    await montar();
    await enviarFoto();
    await salvar();

    expect(imagensEnviadas()).toEqual([FOTO_REAL]);
  });

  it("o limite de 10 fotos conta só as reais: 9 reais + marcador aceita a décima", async () => {
    const nove = Array.from(
      { length: 9 },
      (_, i) => `https://cdn.exemplo.com/products/f${i}.jpg`,
    );
    fetchProduct.mockResolvedValue(produtoDoBanco([MARCADOR, ...nove]));
    await montar();
    await enviarFoto();

    expect(uploadProductImages).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(toast.error)
        .mock.calls.some(([t]) => String(t).includes("Limite de imagens")),
    ).toBe(false);
    await salvar();
    expect(imagensEnviadas()).toEqual([...nove, FOTO_NOVA]);
  });

  it("controle: com 10 fotos reais a décima primeira continua barrada", async () => {
    const dez = Array.from(
      { length: 10 },
      (_, i) => `https://cdn.exemplo.com/products/f${i}.jpg`,
    );
    fetchProduct.mockResolvedValue(produtoDoBanco(dez));
    await montar();
    await enviarFoto();

    expect(uploadProductImages).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(toast.error)
        .mock.calls.some(([t]) => String(t).includes("Limite de imagens")),
    ).toBe(true);
  });

  it("rascunho de edição de antes da correção, com o marcador, volta sem ele", async () => {
    fetchProduct.mockResolvedValue(produtoDoBanco([MARCADOR]));
    armazem.set(
      CHAVE_EDICAO,
      JSON.stringify({
        name: "Camiseta de algodão",
        description: "Algodão",
        price: "50",
        stock: "5",
        category: "Geral",
        images: [MARCADOR, FOTO_REAL],
        variants: [],
      }),
    );
    await montar();

    const chamada = vi
      .mocked(toast.info)
      .mock.calls.find(([t]) => String(t).includes("Rascunho não salvo"));
    expect(chamada).toBeDefined();
    await act(async () => {
      (
        chamada?.[1] as unknown as { action: { onClick: () => void } }
      ).action.onClick();
    });
    expect(fotosNaTela().some((s) => s?.includes("placehold.co"))).toBe(false);
    await salvar();

    expect(imagensEnviadas()).toEqual([FOTO_REAL]);
  });

  it("rascunho de produto NOVO com o marcador volta sem ele", async () => {
    armazem.set(
      CHAVE_NOVO,
      JSON.stringify({
        name: "Produto novo",
        description: "Descrição",
        price: "50",
        stock: "5",
        category: "Geral",
        images: [MARCADOR, FOTO_REAL],
        variants: [],
      }),
    );
    await montar(null);

    expect(fotosNaTela().some((s) => s?.includes("placehold.co"))).toBe(false);
    expect(fotosNaTela()).toContain(FOTO_REAL);
  });

  it("produto novo: a foto enviada é images[0] e o marcador nunca vai no addProduct", async () => {
    await montar(null);
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      digitar("product-sale-price", "5000");
      digitar("product-stock", "3");
      selecionarCategoria("Geral");
      await new Promise((r) => setTimeout(r, 300));
    });
    await enviarFoto();
    await salvar("Publicar");

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0].images).toEqual([FOTO_NOVA]);
  });
});
