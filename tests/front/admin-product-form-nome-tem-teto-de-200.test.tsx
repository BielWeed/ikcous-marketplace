// @vitest-environment jsdom
//
// O nome do produto limita a DIGITAÇÃO a 200 caracteres (a descrição tem o
// próprio teste, de 5000). O teste da cópia do produto importa a constante,
// então trocar 200 por outro número passava em toda a suíte. Aqui o número fica
// pregado no campo da tela: o que a lojista vê é o campo parar em 200.
// Produto antigo com nome maior continua abrindo inteiro (nada é cortado ao abrir).
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { LIMITE_DO_NOME_DO_PRODUTO } from "@/lib/limites-do-produto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    fetchProduct,
    updateProduct: vi.fn(),
    addProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
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

const produto = {
  id: "prod-1",
  name: "Camiseta",
  description: "Algodão",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let prateleira: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  fetchProduct.mockResolvedValue(produto);
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  hospedeiro = document.createElement("div");
  prateleira = document.createElement("div");
  document.body.append(hospedeiro, prateleira);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  prateleira.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function montar() {
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <ContextoDaBarra.Provider
        value={{
          destino: prateleira,
          receberPrateleira: vi.fn(),
          larga: true,
          altura: 100,
        }}
      >
        <AdminProductFormView
          userId="lojista-1"
          productId="prod-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />
      </ContextoDaBarra.Provider>,
    );
  });
}

it("o teto do nome é 200 e o campo de verdade para nele", async () => {
  expect(LIMITE_DO_NOME_DO_PRODUTO).toBe(200);
  await montar();
  const campo = hospedeiro.querySelector<HTMLInputElement>("#product-name");
  expect(campo).not.toBeNull();
  expect(campo?.getAttribute("maxlength")).toBe("200");
});

it("não corta um nome antigo maior que o teto ao abrir o produto", async () => {
  const nomeSalvo = "N".repeat(250);
  fetchProduct.mockResolvedValue({ ...produto, name: nomeSalvo });
  await montar();
  const campo = hospedeiro.querySelector<HTMLInputElement>("#product-name");
  expect(campo?.getAttribute("maxlength")).toBe("200");
  expect(campo?.value).toBe(nomeSalvo);
});
