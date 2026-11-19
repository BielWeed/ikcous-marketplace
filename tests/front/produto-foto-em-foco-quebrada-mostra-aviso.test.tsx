// @vitest-environment jsdom
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();
const configDaLoja = { shippingCoverage: "national" as "national" | "local" };

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
  useStore: () => ({ config: configDaLoja }),
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

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null,
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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const q = (seletor: string) => document.querySelector(seletor);

describe("AdminProductFormView — foto indisponível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let prateleira: HTMLDivElement;

  beforeEach(() => {
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
    prateleira = document.createElement("div");
    document.body.appendChild(prateleira);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    prateleira.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <ContextoDaBarra.Provider
          value={{
            destino: prateleira,
            receberPrateleira: vi.fn(),
            larga: false,
            altura: 90,
          }}
        >
          <AdminProductFormView
            userId="u-teste"
            productId={productId}
            onNavigate={vi.fn()}
            onSetDirty={vi.fn()}
          />
        </ContextoDaBarra.Provider>,
      );
    });
    if (productId) {
      await act(async () => {
        await esperar(0);
        await esperar(0);
        await esperar(0);
      });
    }
  }

  it("tenta carregar só a foto em foco de novo, sem trocar a galeria", async () => {
    const capa = "https://cdn.example/capa.jpg";
    const detalhe = "https://cdn.example/detalhe.jpg";
    const consultas: string[] = [];
    let redeDaFotoVoltou = false;
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1000;
        naturalHeight = 1000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(url: string) {
          consultas.push(url);
          queueMicrotask(() => {
            if (url === detalhe && !redeDaFotoVoltou) this.onerror?.();
            else this.onload?.();
          });
        }
      },
    );
    fetchProduct.mockResolvedValue({
      ...produtoDoBanco,
      images: [capa, detalhe],
    });
    await montar("prod-1");
    const galeria = q('[aria-label="Galeria de fotos do produto"]')!;
    const miniaturas = [...galeria.querySelectorAll("button")];
    await act(async () => miniaturas[1].click());
    const foco = q('[data-testid="foto-em-foco"]')!;
    expect(foco.querySelector("img")).toBeNull();
    expect(foco.textContent).toContain("Não foi possível carregar esta foto");

    redeDaFotoVoltou = true;
    const tentarDeNovo = [...foco.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Tentar de novo",
    );
    expect(tentarDeNovo).toBeDefined();
    await act(async () => tentarDeNovo?.click());

    expect(foco.querySelector("img")?.getAttribute("src")).toBe(detalhe);
    expect(foco.textContent).not.toContain(
      "Não foi possível carregar esta foto",
    );
    expect(foco.textContent).toContain("1000 × 1000 px");
    expect(consultas).toEqual([capa, detalhe, detalhe]);
    expect(q('[aria-label="Galeria de fotos do produto"]')).toBe(galeria);
    expect([...galeria.querySelectorAll("button")]).toEqual(miniaturas);
    expect(miniaturas[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("AdminProductFormView mostra aviso de erro e permite remover a foto em foco", async () => {
    fetchProduct.mockResolvedValue({
      ...produtoDoBanco,
      images: ["https://cdn.example/apagada.jpg"],
    });
    await montar("prod-1");
    const foco = q('[data-testid="foto-em-foco"]')!;
    const foto = foco.querySelector("img")!;
    expect(foto).not.toBeNull();
    await act(async () => foto.dispatchEvent(new Event("error")));
    expect(foco.querySelector("img")).toBeNull();
    expect(foco.textContent).toContain("Não foi possível carregar esta foto");
    const excluir = foco.querySelector<HTMLButtonElement>(
      'button[title="Excluir"]',
    )!;
    expect(excluir.disabled).toBe(false);
    await act(async () => excluir.click());
    expect(q('[data-testid="foto-em-foco"]')).toBeNull();
  });
});
