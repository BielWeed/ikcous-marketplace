// @vitest-environment jsdom
//
// A descrição do produto não tinha teto: dava para colar um texto de qualquer
// tamanho, e ele seguia até o banco. O nome já limita a entrada a 200; a
// descrição passa a limitar a 5000. O teto vale só para o que se DIGITA ou
// COLA: um produto antigo com descrição maior continua abrindo e salvando como
// está (nada é cortado ao abrir).
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
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

it("limita a entrada da descrição a 5000 caracteres", async () => {
  await montar();
  const campo = hospedeiro.querySelector<HTMLTextAreaElement>(
    "#product-description",
  );
  expect(campo).not.toBeNull();
  expect(campo?.getAttribute("maxlength")).toBe("5000");
});

it("não corta uma descrição antiga maior que o teto ao abrir o produto", async () => {
  const descricaoSalva = "D".repeat(6000);
  fetchProduct.mockResolvedValue({ ...produto, description: descricaoSalva });
  await montar();
  const campo = hospedeiro.querySelector<HTMLTextAreaElement>(
    "#product-description",
  );
  expect(campo?.getAttribute("maxlength")).toBe("5000");
  expect(campo?.value).toBe(descricaoSalva);
});
