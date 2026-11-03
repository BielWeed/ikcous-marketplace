// @vitest-environment jsdom
//
// Peso e medidas do produto: valor negativo não passa em silêncio.
//
// Antes, digitar -3 na largura NÃO mostrava erro, deixava o Salvar ligado e o
// painel gravava 0 (o `Math.max(0, ...)` da montagem do payload). A edge de
// frete lê 0 como "não informado" e cota com a medida padrão, e a lojista
// achava que a medida tinha sido guardada. Agora o campo diz "Não pode ser
// negativo", o Salvar desliga e nada é gravado. Zero e vazio continuam valendo
// (zero = usar o padrão, como sempre foi). Com entrega local a seção nem
// aparece, então um valor negativo antigo ali não pode travar o salvar.
//
// Montagem real (react-dom/client + jsdom), mesmo molde de
// produto-estoque-inteiro.test.tsx (LocalBufferedInput tem debounce de 200 ms).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();
let cobertura = "national";

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
  useStore: () => ({ config: { shippingCoverage: cobertura } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM = "Não pode ser negativo";

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null,
  originalPrice: null,
  stock: 20,
  updatedAt: "2026-10-21T13:00:00.123456+00:00",
  estoqueMinimo: null as number | null,
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
  weightKg: null as number | null,
  widthCm: null as number | null,
  heightCm: null as number | null,
  lengthCm: null as number | null,
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await esperar(300);
  });
}

function botao(texto: string): HTMLButtonElement {
  return [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement;
}

describe("Produto — peso e medidas negativos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    cobertura = "national";
    updateProduct.mockResolvedValue({ id: "prod-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue({ data: null, error: null });
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          productId="prod-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
  }

  it.each([
    ["product-weight", "-0.5"],
    ["product-width", "-3"],
    ["product-height", "-1"],
    ["product-length", "-2"],
  ])(
    "recusa %s = %s: erro no campo, Salvar desligado, nada gravado",
    async (id, valor) => {
      await montar();
      await digitarCampo(id, valor);

      const erro = document.getElementById(`${id}-erro`);
      expect(erro?.textContent).toContain(MENSAGEM);
      expect(document.getElementById(id)?.getAttribute("aria-invalid")).toBe(
        "true",
      );
      expect(botao("Salvar").disabled).toBe(true);

      await act(async () => {
        botao("Salvar").click();
        hospedeiro
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(updateProduct).not.toHaveBeenCalled();
      expect(addProduct).not.toHaveBeenCalled();
    },
  );

  it("o erro some e o produto salva quando a medida volta a ser válida", async () => {
    await montar();
    await digitarCampo("product-width", "-3");
    expect(botao("Salvar").disabled).toBe(true);

    await digitarCampo("product-width", "12");
    expect(document.getElementById("product-width-erro")).toBeNull();
    expect(botao("Salvar").disabled).toBe(false);
    await act(async () => {
      botao("Salvar").click();
    });
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][0]).toBe("prod-1");
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ widthCm: 12 });
  });

  it.each(["0", "0.35", "15"])(
    "medida %s continua valendo, sem erro",
    async (valor) => {
      await montar();
      await digitarCampo("product-weight", valor);
      expect(document.getElementById("product-weight-erro")).toBeNull();
      expect(botao("Salvar").disabled).toBe(false);
      await act(async () => {
        botao("Salvar").click();
      });
      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0][1]).toMatchObject({
        weightKg: Number(valor),
      });
    },
  );

  it("com entrega local, medida negativa antiga (campo escondido) não trava o salvar", async () => {
    cobertura = "local";
    fetchProduct.mockResolvedValue({ ...produtoDoBanco, widthCm: -3 });
    await montar();
    expect(document.getElementById("product-width")).toBeNull();

    await digitarCampo("product-stock", "15");
    expect(botao("Salvar").disabled).toBe(false);
    await act(async () => {
      botao("Salvar").click();
    });
    expect(updateProduct).toHaveBeenCalledWith(
      "prod-1",
      expect.objectContaining({ stock: 15 }),
      { baseUpdatedAt: produtoDoBanco.updatedAt },
    );
  });
});
