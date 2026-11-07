// @vitest-environment jsdom
//
// Cadastro de produto: as quatro ações de foto (Capa, Tirar foto, Galeria e
// Mais fotos) eram só `<label>` de texto ligados a um campo de arquivo
// escondido (`display:none`), que não recebe foco: quem não usa mouse ou toque
// nunca conseguia enviar uma foto. Agora cada uma é um botão de verdade, que
// entra na ordem do Tab e abre a escolha de arquivo do campo de sempre.
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

describe("AdminProductFormView — fotos do produto por teclado", () => {
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

  const cartao = () => q('[aria-label="Fotos do produto"]') as HTMLElement;

  /** O botão que a pessoa alcança com Tab, achado pelo nome que o leitor de tela lê. */
  function botaoDeFoto(nome: string) {
    return [...cartao().querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.includes(nome),
    );
  }

  /** Conta os cliques que chegam ao campo de arquivo escondido (o que abre a escolha). */
  function contarCliquesDoCampo(id: string) {
    const campo = document.getElementById(id) as HTMLInputElement;
    const aoClicar = vi.fn((e: Event) => e.preventDefault());
    campo.addEventListener("click", aoClicar);
    return aoClicar;
  }

  function ehAlcancavelPorTeclado(b: HTMLButtonElement | undefined) {
    expect(b).toBeDefined();
    expect(b?.tagName).toBe("BUTTON");
    expect(b?.getAttribute("type")).toBe("button");
    expect(b?.tabIndex).toBeGreaterThanOrEqual(0);
    expect(b?.disabled).toBe(false);
  }

  describe("cartão vazio", () => {
    it("Capa, Tirar foto e Galeria são botões que o Tab alcança e abrem o campo certo", async () => {
      await montar();
      const capa = botaoDeFoto("Capa");
      const camera = botaoDeFoto("Tirar foto");
      const galeria = botaoDeFoto("Galeria");
      ehAlcancavelPorTeclado(capa);
      ehAlcancavelPorTeclado(camera);
      ehAlcancavelPorTeclado(galeria);

      const cliquesGaleria = contarCliquesDoCampo("product-image-upload");
      const cliquesCamera = contarCliquesDoCampo("product-image-capture");

      await act(async () => {
        capa?.click();
      });
      expect(cliquesGaleria).toHaveBeenCalledTimes(1);
      await act(async () => {
        galeria?.click();
      });
      expect(cliquesGaleria).toHaveBeenCalledTimes(2);
      expect(cliquesCamera).not.toHaveBeenCalled();
      await act(async () => {
        camera?.click();
      });
      expect(cliquesCamera).toHaveBeenCalledTimes(1);
    });

    it("a Capa segue aceitando arquivo arrastado e mostra 'Solte aqui'", async () => {
      await montar();
      const capa = botaoDeFoto("Capa") as HTMLButtonElement;
      expect(capa).toBeDefined();
      await act(async () => {
        capa.dispatchEvent(
          new Event("dragover", { bubbles: true, cancelable: true }),
        );
      });
      expect(botaoDeFoto("Solte aqui")).toBeDefined();
    });
  });

  describe("com fotos", () => {
    const comFotos = {
      ...produtoDoBanco,
      images: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
    };

    it("Tirar foto e Mais fotos são botões que o Tab alcança e abrem o campo certo", async () => {
      fetchProduct.mockResolvedValue(comFotos);
      await montar("prod-1");
      const camera = botaoDeFoto("Tirar foto");
      const mais = botaoDeFoto("Mais fotos");
      ehAlcancavelPorTeclado(camera);
      ehAlcancavelPorTeclado(mais);

      const cliquesGaleria = contarCliquesDoCampo("product-image-upload");
      const cliquesCamera = contarCliquesDoCampo("product-image-capture");

      await act(async () => {
        mais?.click();
      });
      expect(cliquesGaleria).toHaveBeenCalledTimes(1);
      expect(cliquesCamera).not.toHaveBeenCalled();
      await act(async () => {
        camera?.click();
      });
      expect(cliquesCamera).toHaveBeenCalledTimes(1);
    });
  });
});
