// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const salvarProdutoComGrade = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade,
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
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
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

const variacao = (id: string, value: string, stockIncrement: number) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value,
  stockIncrement,
  active: true,
});
const A = variacao("va", "A", 2);
const B = variacao("vb", "B", 3);
const C = variacao("vc", "C", 7);
const produto = (variants: ReturnType<typeof variacao>[]) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: variants.reduce((soma, v) => soma + v.stockIncrement, 0),
  sold: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
const botaoPorTexto = (texto: string) => {
  const botao = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  expect(botao).toBeDefined();
  return botao as HTMLButtonElement;
};
async function salvar() {
  await act(async () => {
    const botao = botaoPorTexto("Salvar alterações");
    expect(botao.disabled).toBe(false);
    botao.click();
    await new Promise((r) => setTimeout(r, 50));
  });
}
const gradeNaTela = () =>
  [...hospedeiro.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (linha) => linha.textContent?.trim(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => armazem.set(k, v),
    removeItem: (k: string) => armazem.delete(k),
  });
  fetchProduct.mockResolvedValue(produto([A, B]));
  salvarProdutoComGrade.mockResolvedValue({
    produto: undefined,
    recusadas: [],
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

it("conflito mantém B excluída, incorpora C do outro aparelho e envia a exclusão no próximo salvar", async () => {
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
  expect(gradeNaTela()).toEqual(["Cor: A", "Cor: B"]);
  await act(async () => {
    const excluir = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Excluir variação B"]',
    );
    expect(excluir).not.toBeNull();
    excluir!.click();
  });
  await act(async () => botaoPorTexto("Excluir Variante").click());
  expect(gradeNaTela()).toEqual(["Cor: A"]);

  await act(async () => {
    const preco = document.getElementById("product-sale-price");
    expect(preco).not.toBeNull();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(preco, "60,00");
    preco!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
  // O banco ainda tem B; só C é realmente nova. B não pode ser confundida com C.
  salvarProdutoComGrade.mockRejectedValueOnce({
    produtoAtual: produto([A, B, C]),
  });
  await salvar();
  expect(salvarProdutoComGrade).toHaveBeenCalledTimes(1);
  expect(salvarProdutoComGrade.mock.calls[0]?.[2].apagar).toEqual(["vb"]);
  expect(gradeNaTela()).not.toContain("Cor: B");
  expect(gradeNaTela()).toEqual(["Cor: A", "Cor: C"]);
  expect(
    (document.getElementById("product-stock") as HTMLInputElement).value,
  ).toBe("9");
  expect(
    (document.getElementById("product-sale-price") as HTMLInputElement).value,
  ).toContain("60");

  await salvar();
  expect(salvarProdutoComGrade).toHaveBeenCalledTimes(2);
  expect(salvarProdutoComGrade.mock.calls[1]?.[2].apagar).toEqual(["vb"]);
  expect(salvarProdutoComGrade.mock.calls[1]?.[1]).toMatchObject({
    stock: 9,
    price: 60,
  });
});
