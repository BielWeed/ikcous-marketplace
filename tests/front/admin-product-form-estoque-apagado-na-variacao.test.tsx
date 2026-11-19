// @vitest-environment jsdom
import { type ReactNode, act } from "react";
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

async function montar(existente: boolean, ativa = true) {
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
      ? [
          {
            id: "v-1",
            productId: "p-1",
            name: "Tamanho",
            value: "GG",
            stockIncrement: 20,
            active: ativa,
          },
        ]
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

describe("AdminProductFormView — botões de estoque de uma variação existente", () => {
  async function ajustarEstoque(botao: string, texto: string) {
    const campo = document.querySelector<HTMLInputElement>("#variant-stock");
    const controle = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${botao}"]`,
    );
    if (!campo || !controle) throw new Error("Controle de estoque ausente.");
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Clique antes do debounce, sem depender de o navegador desfocar o campo.
    await act(async () => controle.click());
    return campo.value;
  }

  describe.each(["Diminuir estoque", "Aumentar estoque"])("%s", (botao) => {
    it.each([
      ["", /informe o estoque/i],
      ["2.5", /números inteiros/i],
      ["-5", /não pode ser negativo/i],
    ])('preserva "%s" e avisa', async (texto, aviso) => {
      await montar(true);
      await editar();
      expect(await ajustarEstoque(botao, texto)).toBe(texto);
      expect(mocks.toastErro).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(aviso),
      );
    });
  });

  it.each([
    ["Aumentar estoque", "999999999999"],
    ["Aumentar estoque", "10000"],
    ["Aumentar estoque", "10001"],
    ["Diminuir estoque", "10001"],
    ["Aumentar estoque", "9007199254740993"],
  ])("%s não altera %s ao ultrapassar o limite", async (botao, texto) => {
    await montar(true);
    await editar();
    expect(await ajustarEstoque(botao, texto)).toBe(texto);
    expect(mocks.toastErro).toHaveBeenCalledExactlyOnceWith(
      "O estoque máximo é 10.000",
    );
  });

  it.each([
    ["Aumentar estoque", "9999", "10000"],
    ["Diminuir estoque", "10000", "9999"],
    ["Diminuir estoque", "20", "19"],
    ["Aumentar estoque", "20", "21"],
    ["Diminuir estoque", "0", "0"],
    ["Aumentar estoque", "0", "1"],
  ])("%s: de %s para %s", async (botao, texto, resultado) => {
    await montar(true);
    await editar();
    expect(await ajustarEstoque(botao, texto)).toBe(resultado);
    expect(mocks.toastErro).not.toHaveBeenCalled();
    await clicar("Salvar variação");
    await editar();
    expect(
      document.querySelector<HTMLInputElement>("#variant-stock")?.value,
    ).toBe(resultado);
  });
});

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

  it.each([
    ["ligada", true],
    ["desligada", false],
  ])(
    "Salvar variação %s recusa 10.001 e aceita 10.000",
    async (_estado, ativa) => {
      await montar(true, ativa);
      await editar();
      await digitarCampo("variant-stock", "10001");
      await clicar("Salvar variação");

      expect(mocks.toastErro).toHaveBeenCalledExactlyOnceWith(
        "O estoque máximo é 10.000",
      );
      expect(
        document.querySelector<HTMLInputElement>("#variant-stock")?.value,
      ).toBe("10001");

      await digitarCampo("variant-stock", "10000");
      await clicar("Salvar variação");
      expect(mocks.toastErro).toHaveBeenCalledTimes(1);
      await editar();
      expect(
        document.querySelector<HTMLInputElement>("#variant-stock")?.value,
      ).toBe("10000");
    },
  );

  it.each(["0", "5"])(
    "existente aceita quantidade explícita %s",
    async (quantidade) => {
      await montar(true);
      await editar();
      await digitarCampo("variant-stock", quantidade);
      await clicar("Salvar variação");
      expect(mocks.toastErro).not.toHaveBeenCalled();
      await editar();
      expect(
        (document.getElementById("variant-stock") as HTMLInputElement).value,
      ).toBe(quantidade);
    },
  );
});
