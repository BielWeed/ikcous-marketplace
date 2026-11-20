// @vitest-environment jsdom
//
// Nome ou descrição só com espaços não contam como preenchidos. Antes, o
// formulário dizia "Tudo pronto para publicar" com a descrição em branco (um
// espaço), e na gravação o texto era aparado e o produto ficava SEM descrição,
// mesmo sendo campo obrigatório. Agora o botão, a frase do que falta e o
// contador de essenciais tratam "   " como vazio.
//
// Montagem real (react-dom/client + jsdom), molde de produto-textos-avisos-e-botoes.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";
import {
  nomesInvisiveisRepresentativos,
  nomesVisiveisRepresentativos,
} from "./helpers/nomes-invisiveis";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();

// Nenhum cenário abre esses painéis. A validação, o formulário e os
// controles de texto continuam reais.
vi.mock("@/components/admin/AdminHelpModal", () => ({
  AdminHelpModal: () => null,
}));
vi.mock("@/components/admin/PhoneSimulator", () => ({
  PhoneSimulator: () => null,
}));
vi.mock("@/components/admin/products/ModalVarianteGrade", () => ({
  ModalVarianteGrade: () => null,
}));
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: () => null,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
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
      id="product-category"
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
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
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

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null as number | null,
  originalPrice: null,
  stock: 3,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  codigoBarras: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

// O campo usa debounce; avançar o relógio mantém esse caminho real sem dormir.

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  if (!el) throw new Error(`campo #${id} ausente`);
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await vi.advanceTimersByTimeAsync(300);
  });
}

async function preencherOBasico() {
  await digitarCampo("product-name", "Produto Teste");
  await digitarCampo("product-description", "Descrição de teste");
  await digitarCampo("product-sale-price", "1000");
  await digitarCampo("product-stock", "5");
  await act(async () => {
    escolherCategoriaDoProduto("Geral");
    await vi.advanceTimersByTimeAsync(50);
  });
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const textoDaTela = () => document.body.textContent ?? "";

describe("AdminProductFormView — nome e descrição só com espaços", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-1" });
    updateProduct.mockResolvedValue({ id: "prod-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
    const armazem = new Map<string, string>();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          productId={productId}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    if (productId) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  }

  it("trava texto vazio, aceita a correção e publica a descrição aparada", async () => {
    await montar();
    await preencherOBasico();
    expect(botaoPorTexto("Publicar")?.disabled).toBe(false);
    expect(textoDaTela()).toContain("5 de 5 essenciais prontos");

    for (const [rotulo, descricao] of [
      ["espaço comum", "   "],
      ["espaço não quebrável", "  "],
    ]) {
      await digitarCampo("product-description", descricao);
      expect(botaoPorTexto("Publicar")?.disabled, rotulo).toBe(true);
      expect(textoDaTela(), rotulo).toContain("falta preencher: descrição");
      expect(textoDaTela(), rotulo).toContain("4 de 5 essenciais prontos");
      expect(addProduct, rotulo).not.toHaveBeenCalled();
    }
    await digitarCampo("product-description", "  com espaços  ");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(false);

    await digitarCampo("product-name", "   ");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(true);
    expect(textoDaTela()).toContain("falta preencher: nome");
    expect(textoDaTela()).toContain("4 de 5 essenciais prontos");

    await digitarCampo("product-name", "​");
    const formulario = document.getElementById("product-name")?.closest("form");
    expect(formulario).not.toBeNull();
    await act(async () => {
      formulario?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(addProduct).not.toHaveBeenCalled();

    await digitarCampo("product-name", "Produto Teste");
    expect(botaoPorTexto("Publicar")?.disabled).toBe(false);
    await act(async () => {
      botaoPorTexto("Publicar")?.click();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0]).toMatchObject({
      description: "com espaços",
    });
  });

  async function montarComNome(nome: string) {
    await montar("prod-1");
    await digitarCampo("product-name", nome);
  }

  it("recusa nomes só com caracteres invisíveis antes de gravar", async () => {
    await montar("prod-1");
    for (const [rotulo, nome] of nomesInvisiveisRepresentativos) {
      await digitarCampo("product-name", nome);
      expect(botaoPorTexto("Salvar alterações")?.disabled, rotulo).toBe(true);
      expect(textoDaTela(), rotulo).toContain("falta preencher: nome");
      expect(textoDaTela(), rotulo).toContain("4 de 5 essenciais prontos");
      const formulario = document
        .getElementById("product-name")
        ?.closest("form");
      expect(formulario).not.toBeNull();
      await act(async () => {
        formulario?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      expect(updateProduct, rotulo).not.toHaveBeenCalled();
    }
  });

  it.each(nomesVisiveisRepresentativos)(
    "salva nome visível sem alterar: %s",
    async (_rotulo, nome) => {
      await montarComNome(nome);
      expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
      await act(async () => {
        botaoPorTexto("Salvar alterações")?.click();
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0]?.[1].name).toBe(nome);
    },
  );

  it("editando: trocar a descrição existente por um espaço desliga o Salvar", async () => {
    await montar("prod-1");
    expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(false);
    await digitarCampo("product-description", " ");
    expect(botaoPorTexto("Salvar alterações")?.disabled).toBe(true);
    expect(textoDaTela()).toContain("falta preencher: descrição");
    expect(updateProduct).not.toHaveBeenCalled();
  });
});
