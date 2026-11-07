// @vitest-environment jsdom
//
// "Ajustar e Cortar" na foto do produto, dois defeitos de borda:
//
// 1. Foto pequena e borrada ganhava o selo "Excelente". O editor estica o
//    recorte até 1000 x 1250 px sem avisar e a tela gravava o selo "excellent"
//    à força (e, mesmo sem isso, a avaliação por pixels do arquivo NOVO diria
//    "Excelente", porque os pixels existem, só que ampliados). O lojista perdia
//    o único aviso de que a foto é pequena demais. Agora o recorte herda o
//    aviso de resolução da foto original.
// 2. Dois toques rápidos em "Salvar Ajuste" mandavam o recorte duas vezes e
//    deixavam o primeiro arquivo órfão no armazenamento. O banner já tinha a
//    trava; o produto não.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const upsertVariants = vi.fn();
const uploadProductImages = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
    upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(true),
    uploadProductImages,
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
    <select
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
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// O recorte real precisa de canvas; o dublê só expõe o botão que o confirma.
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: ({ onConfirm }: { onConfirm: (blob: Blob) => void }) => (
    <button
      type="button"
      data-testid="confirmar-recorte"
      onClick={() => onConfirm(new Blob(["recorte"], { type: "image/webp" }))}
    >
      Confirmar recorte
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINAL = "https://cdn/original.jpg";
const RECORTADA = "https://cdn/recortada.webp";

// Tamanho que cada URL "tem" quando a tela carrega a foto para medi-la.
let tamanhos: Map<string, [number, number]>;

class ImagemFalsa {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  naturalWidth = 0;
  naturalHeight = 0;
  set src(url: string) {
    setTimeout(() => {
      const t = tamanhos.get(url);
      if (!t) {
        this.onerror?.();
        return;
      }
      [this.naturalWidth, this.naturalHeight] = t;
      this.onload?.();
    }, 0);
  }
}

describe("AdminProductFormView — recortar a foto do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
    uploadProductImages.mockResolvedValue([RECORTADA]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    tamanhos = new Map([[RECORTADA, [1000, 1250]]]);
    vi.stubGlobal("Image", ImagemFalsa);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function esperar(ms = 30) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function montar(tamanhoOriginal: [number, number]) {
    tamanhos.set(ORIGINAL, tamanhoOriginal);
    fetchProduct.mockResolvedValue({
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 10,
      sold: 0,
      category: "Geral",
      images: [ORIGINAL],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [],
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
    await esperar(50);
  }

  const cartaoDaFoto = () =>
    document.querySelector('[data-testid="foto-em-foco"]')?.textContent ?? "";

  async function abrirOAjuste() {
    await act(async () => {
      (
        document.querySelector(
          'button[title="Ajustar e Cortar"]',
        ) as HTMLButtonElement
      ).click();
    });
  }

  const botaoConfirmar = () =>
    document.querySelector(
      '[data-testid="confirmar-recorte"]',
    ) as HTMLButtonElement;

  describe("o aviso de foto pequena não some depois do recorte", () => {
    it("foto minúscula (300 x 300): antes diz 'Resolução baixa' e, depois do recorte esticado a 1000 x 1250, continua dizendo", async () => {
      await montar([300, 300]);
      expect(cartaoDaFoto()).toContain("Resolução baixa.");

      await abrirOAjuste();
      await act(async () => botaoConfirmar().click());
      await esperar();

      expect(uploadProductImages).toHaveBeenCalledTimes(1);
      // O arquivo novo tem mesmo 1000 x 1250 (esticado): o tamanho é o real...
      expect(cartaoDaFoto()).toContain("1000 × 1250 px");
      // ...mas o selo não vira "Excelente": o aviso da foto original fica.
      expect(cartaoDaFoto()).toContain("Resolução baixa.");
      expect(cartaoDaFoto()).not.toContain("Excelente!");
    });

    it("foto mediana (700 x 700, 'Boa qualidade'): o recorte esticado também não vira 'Excelente'", async () => {
      await montar([700, 700]);
      expect(cartaoDaFoto()).toContain("Boa qualidade.");

      await abrirOAjuste();
      await act(async () => botaoConfirmar().click());
      await esperar();

      expect(cartaoDaFoto()).toContain("1000 × 1250 px");
      expect(cartaoDaFoto()).toContain("Boa qualidade.");
      expect(cartaoDaFoto()).not.toContain("Excelente!");
    });

    it("foto grande (2000 x 2000): o recorte segue 'Excelente', avaliado pelos pixels do arquivo novo", async () => {
      await montar([2000, 2000]);
      expect(cartaoDaFoto()).toContain("Excelente!");

      await abrirOAjuste();
      await act(async () => botaoConfirmar().click());
      await esperar();

      expect(cartaoDaFoto()).toContain("1000 × 1250 px");
      expect(cartaoDaFoto()).toContain("Excelente!");
    });

    it("foto de proporção errada (1000 x 500, 'Ajuste para 4:5'): o recorte corrige a proporção, então o aviso de proporção sai", async () => {
      await montar([1000, 500]);
      expect(cartaoDaFoto()).toContain("Ajuste para 4:5.");

      await abrirOAjuste();
      await act(async () => botaoConfirmar().click());
      await esperar();

      expect(cartaoDaFoto()).toContain("1000 × 1250 px");
      expect(cartaoDaFoto()).not.toContain("Ajuste para 4:5.");
      expect(cartaoDaFoto()).toContain("Excelente!");
    });
  });

  describe("toque duplo em Salvar Ajuste", () => {
    it("dois toques seguidos mandam UM envio só (e não deixam arquivo órfão)", async () => {
      await montar([2000, 2000]);
      await abrirOAjuste();
      await act(async () => {
        botaoConfirmar().click();
        botaoConfirmar().click();
      });
      await esperar();

      expect(uploadProductImages).toHaveBeenCalledTimes(1);
    });

    it("enquanto o primeiro envio ainda não respondeu, o segundo toque também é ignorado", async () => {
      let responder: (urls: string[]) => void = () => {};
      uploadProductImages.mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            responder = resolve;
          }),
      );
      await montar([2000, 2000]);
      await abrirOAjuste();
      await act(async () => botaoConfirmar().click());
      await act(async () => botaoConfirmar().click());
      expect(uploadProductImages).toHaveBeenCalledTimes(1);

      await act(async () => {
        responder([RECORTADA]);
        await new Promise((r) => setTimeout(r, 0));
      });
      await esperar();
      expect(uploadProductImages).toHaveBeenCalledTimes(1);
    });

    it("envio que falha solta a trava: o lojista consegue tentar de novo", async () => {
      uploadProductImages
        .mockRejectedValueOnce(new Error("rede caiu"))
        .mockResolvedValue([RECORTADA]);
      await montar([2000, 2000]);
      await abrirOAjuste();
      await act(async () => botaoConfirmar().click());
      await esperar();
      expect(uploadProductImages).toHaveBeenCalledTimes(1);

      await act(async () => botaoConfirmar().click());
      await esperar();
      expect(uploadProductImages).toHaveBeenCalledTimes(2);
    });
  });
});
