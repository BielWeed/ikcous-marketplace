// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { primaryColor: "#FFBF00", shippingCoverage: "national" },
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
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
const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function clicar(seletor: string) {
  const botao = document.querySelector<HTMLButtonElement>(seletor);
  expect(botao).not.toBeNull();
  await act(async () => botao!.click());
}

const salvar = vi.hoisted(() => vi.fn());
const buscar = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    fetchProduct: buscar.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "",
      price: 50,
      stock: 7,
      sold: 0,
      category: "",
      images: [],
      isActive: true,
      variants: [
        {
          id: "v-1",
          productId: "p-1",
          name: "Cor / Tam",
          value: "Azul / M",
          stockIncrement: 7,
          active: true,
        },
      ],
    }),
    updateProduct: salvar,
    salvarProdutoComGrade: salvar,
    uploadProductImages: vi.fn(),
  }),
}));
it("mostra os atributos e o estoque da variação e avisa que só exclui ao salvar", async () => {
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () =>
    root.render(
      <AdminProductFormView
        productId="p-1"
        userId="lojista-1"
        onNavigate={vi.fn()}
      />,
    ),
  );
  await clicar('button[aria-label="Excluir variação Azul / M"]');
  const dialogo = document.querySelector('[role="alertdialog"]')!;
  expect(dialogo.textContent).toContain("Cor: Azul · Tam: M");
  expect(dialogo.textContent).toContain("Estoque: 7 un.");
  expect(dialogo.textContent).toContain("salvar");
  await act(async () => {
    [...dialogo.querySelectorAll("button")]
      .find((b) => b.textContent === "Excluir Variante")!
      .click();
  });
  expect(salvar).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="variante-cadastrada"]')).toBeNull();
});
