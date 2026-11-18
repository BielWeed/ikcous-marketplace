// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const mocks = vi.hoisted(() => ({
  fetchProduct: vi.fn(),
  toastErro: vi.fn(),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: mocks.fetchProduct,
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
    error: mocks.toastErro,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
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

async function montar(existente: boolean) {
  mocks.fetchProduct.mockResolvedValue({
    id: "p-1",
    name: "Camiseta",
    description: "Algodão",
    price: 50,
    stock: 20,
    category: "Geral",
    images: [],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    variants: existente
      ? [{
          id: "v-1",
          productId: "p-1",
          name: "Tamanho",
          value: "GG",
          stockIncrement: 20,
          active: true,
        }]
      : [],
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
}

async function clicar(texto: string) {
  const botao = [...document.querySelectorAll("button")]
    .filter((b) => b.textContent?.trim() === texto)
    .at(-1);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  await act(async () => botao.click());
}

async function digitarCampo(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}

async function editar() {
  const botao = document.querySelector<HTMLButtonElement>(
    '[aria-label="Editar variação GG"]',
  );
  if (!botao) throw new Error("Editar variação GG não está na tela.");
  await act(async () => botao.click());
}

describe("AdminProductFormView — apagar quantidade não esgota uma variação", () => {
  it("existente com 20: apagar avisa e mantém o modal e o estoque anterior", async () => {
    await montar(true);
    await editar();
    await digitarCampo("variant-stock", "");
    await clicar("Salvar variação");
    expect(mocks.toastErro).toHaveBeenCalledWith(
      "Informe o estoque da variação: digite 0 ou mais.",
    );
    expect(document.getElementById("variant-stock")).not.toBeNull();
    await clicar("Cancelar");
    await editar();
    expect(
      (document.getElementById("variant-stock") as HTMLInputElement).value,
    ).toBe("20");
  });

  it("nova com quantidade apagada continua nascendo com zero", async () => {
    await montar(false);
    await clicar("+ Novo");
    await escolherAtributo(0, "Tamanho", "variant-name", digitarCampo);
    await digitarCampo("variant-value", "GG");
    await digitarCampo("variant-stock", "");
    await clicar("Salvar variação");
    expect(mocks.toastErro).not.toHaveBeenCalled();
    await editar();
    expect(
      (document.getElementById("variant-stock") as HTMLInputElement).value,
    ).toBe("0");
  });

  it.each(["0", "5"])("existente aceita quantidade explícita %s", async (quantidade) => {
    await montar(true);
    await editar();
    await digitarCampo("variant-stock", quantidade);
    await clicar("Salvar variação");
    expect(mocks.toastErro).not.toHaveBeenCalled();
    await editar();
    expect(
      (document.getElementById("variant-stock") as HTMLInputElement).value,
    ).toBe(quantidade);
  });
});
