// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const navegar = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    fetchProduct,
    updateProduct,
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
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("Salvar fica desligado durante a gravação pendente e conclui quando ela responde", async () => {
  let resolver!: (valor: typeof produto) => void;
  updateProduct.mockReturnValue(
    new Promise<typeof produto>((resolve) => {
      resolver = resolve;
    }),
  );
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <AdminProductFormView
        userId="lojista-1"
        productId="prod-1"
        onNavigate={navegar}
        onSetDirty={vi.fn()}
      />,
    );
  });
  await act(async () => {
    const nome = document.getElementById("product-name") as HTMLInputElement;
    expect(nome).not.toBeNull();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(nome, "Camiseta nova");
    nome.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  const botao = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Ações do produto"] button',
    ),
  ].find((b) => b.textContent?.includes("Salvar alterações"));
  expect(botao).toBeDefined();
  // Controle positivo: o formulário válido permite iniciar a gravação.
  expect(botao!.disabled).toBe(false);
  await act(async () => {
    botao!.click();
  });
  expect(updateProduct).toHaveBeenCalledTimes(1);
  expect(botao!.textContent).toContain("Salvando...");
  expect(navegar).not.toHaveBeenCalled();

  try {
    // Não é a janela de sucesso: a promessa ainda não foi resolvida.
    expect(botao!.disabled).toBe(true);
  } finally {
    await act(async () => {
      resolver({ ...produto, name: "Camiseta nova" });
    });
  }
  expect(botao!.textContent).toContain("Salvo");
  expect(updateProduct).toHaveBeenCalledTimes(1);
});
