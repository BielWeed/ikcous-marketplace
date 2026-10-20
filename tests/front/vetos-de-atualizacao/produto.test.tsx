// @vitest-environment jsdom
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: ({
    onConfirm,
  }: { onConfirm: (blob: Blob) => Promise<void> }) => (
    <button
      onClick={() => void onConfirm(new Blob(["foto"], { type: "image/webp" }))}
    >
      Confirmar recorte de teste
    </button>
  ),
}));

const FOTO_NOVA = "https://cdn.exemplo.com/products/foto-nova.jpg";

const fetchProduct = vi.fn();
const addProduct = vi.fn();
const updateProduct = vi.fn();
const upsertVariants = vi.fn();
const uploadProductImages = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
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
const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function escolherFotos(arquivos: File[]) {
  const input = document.getElementById(
    "product-image-upload",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: arquivos,
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const arquivo = (nome: string) =>
  new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });

/** O produto como `fetchProduct` o devolve (o mapper já pôs o marcador). */
const produtoDoBanco = (images: string[]) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: 5,
  sold: 0,
  category: "Geral",
  images,
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
});

describe("produto veta a atualização durante fotos e gravação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    fetchProduct.mockResolvedValue(produtoDoBanco([]));
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
    addProduct.mockResolvedValue({ id: "novo-1" });
    uploadProductImages.mockResolvedValue([FOTO_NOVA]);
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

  async function montar(productId: string | null = "p-1") {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={productId ?? undefined}
          userId="lojista-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function enviarFoto() {
    await act(async () => {
      escolherFotos([arquivo("nova.jpg")]);
      await new Promise((r) => setTimeout(r, 100));
    });
  }

  async function salvar(texto = "Salvar") {
    const botao = botaoPorTexto(texto);
    if (!botao) throw new Error(`O botão ${texto} não está na tela.`);
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it.each([false, true])(
    "fotos pendentes vetam e liberam ao terminar (erro=%s)",
    async (erro) => {
      await montar();
      const envio = adiar<string[]>();
      uploadProductImages.mockReturnValue(envio.promessa);
      try {
        await enviarFoto();
        expect(uploadProductImages).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "upload-de-foto-do-produto",
        ]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver([FOTO_NOVA]);
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "recorte pendente veta e libera ao terminar (erro=%s)",
    async (erro) => {
      fetchProduct.mockResolvedValue(produtoDoBanco([FOTO_NOVA]));
      await montar();
      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>('button[title="Ajustar e Cortar"]')!
          .click();
      });
      const envio = adiar<string[]>();
      uploadProductImages.mockReturnValue(envio.promessa);
      try {
        await act(async () => {
          botaoPorTexto("Confirmar recorte de teste")!.click();
          await new Promise((r) => setTimeout(r, 0));
        });
        expect(uploadProductImages).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "upload-de-foto-do-produto",
        ]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver([FOTO_NOVA]);
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  describe.each([false, true])("salvar produto novo=%s", (novo) => {
    it.each([false, true])(
      "gravação pendente veta e libera ao terminar (erro=%s)",
      async (erro) => {
        await montar(novo ? null : "p-1");
        await act(async () => {
          if (novo) {
            digitar("product-name", "Camiseta");
            digitarTextarea("product-description", "Algodão");
            digitar("product-stock", "3");
            selecionarCategoria("Geral");
          }
          digitar("product-sale-price", "6000");
          await new Promise((r) => setTimeout(r, 300));
        });
        const gravacao = adiar<{ id: string }>();
        const gravar = novo ? addProduct : updateProduct;
        gravar.mockReturnValue(gravacao.promessa);
        try {
          await salvar(novo ? "Publicar" : "Salvar");
          expect(gravar).toHaveBeenCalledTimes(1);
          expect(haOperacaoSensivel()).toBe(true);
          expect(motivosDeOperacaoSensivel()).toEqual(["salvar-produto"]);
        } finally {
          await act(async () => {
            if (erro) gravacao.rejeitar(new Error("falha simulada"));
            else gravacao.resolver({ id: "p-1" });
            await new Promise((r) => setTimeout(r, 0));
          });
        }
        expect(haOperacaoSensivel()).toBe(false);
      },
    );
  });
});
