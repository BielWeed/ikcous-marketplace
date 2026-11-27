// @vitest-environment jsdom
//
// Foto .jpg/.png/.webp que chega SEM tipo (`file.type` vazio ou
// `application/octet-stream`, comum em celular e em arquivo vindo de app de
// conversa) passava no filtro pela extensão, mas a compressão, o
// redimensionamento e as miniaturas só olham o tipo: os 12 MB subiam crus,
// estouravam o prazo em rede lenta e ficavam gravados com tipo genérico.
// Agora o tipo é deduzido da extensão logo na entrada (`comTipoDaExtensao`).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(true),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: mocks.uploadProductImages,
    fetchProduct: vi.fn(),
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

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: mocks.toastError,
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const foto = (nome: string, tipo = "image/jpeg", tamanho?: number) => {
  const f = new File(["x"], nome, { type: tipo, lastModified: 1 });
  if (tamanho !== undefined)
    Object.defineProperty(f, "size", { value: tamanho });
  return f;
};

const url = (n: number) => `https://cdn/${n}.jpg`;

describe("AdminProductFormView — foto sem tipo sobe com o tipo da extensão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let contador: number;

  beforeEach(() => {
    vi.clearAllMocks();
    contador = 0;
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    mocks.uploadProductImages.mockImplementation(async () => {
      contador += 1;
      return [url(contador)];
    });
    // Dublê de leitura de imagem: o jsdom não decodifica foto de verdade.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        width = 800;
        height = 800;
        naturalWidth = 800;
        naturalHeight = 800;
        crossOrigin = "";
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    URL.createObjectURL = () => "blob:teste";
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
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
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
  }

  async function enviar(arquivos: File[]) {
    await act(async () => {
      escolherFotos(arquivos);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const textoDosAvisos = () =>
    mocks.toastError.mock.calls.map((c) => String(c[0])).join(" | ");

  it("JPG sem tipo declarado sobe como image/jpeg e passa pela compressão", async () => {
    await montar();
    const contexto = vi.mocked(HTMLCanvasElement.prototype.getContext);
    contexto.mockClear();
    // Bytes de verdade (não um `size` forjado): o arquivo com o tipo
    // deduzido é uma cópia, e a cópia mede o conteúdo real. Acima de 100 KB
    // a compressão vai ao canvas.
    const grande = new File([new Uint8Array(300 * 1024)], "grande.jpg", {
      type: "",
      lastModified: 1,
    });
    await enviar([grande]);

    expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
    const enviado = mocks.uploadProductImages.mock.calls[0][0][0] as File;
    expect(enviado.type).toBe("image/jpeg");
    expect(enviado.name).toBe("grande.jpg");
    // A compressão chegou ao canvas (antes devolvia o arquivo intacto).
    expect(contexto).toHaveBeenCalled();
  });

  it("PNG e WebP com tipo genérico sobem com o tipo da extensão", async () => {
    await montar();
    await enviar([
      foto("produto.PNG", "application/octet-stream"),
      foto("lado.webp", "application/octet-stream"),
      foto("verso.jpeg", ""),
    ]);

    const tipos = mocks.uploadProductImages.mock.calls.map(
      (c) => (c[0][0] as File).type,
    );
    expect(tipos).toEqual(["image/png", "image/webp", "image/jpeg"]);
  });

  it("foto que já declara o tipo não é trocada", async () => {
    await montar();
    const original = foto("a.png", "image/png");
    await enviar([original]);

    expect(mocks.uploadProductImages.mock.calls[0][0][0]).toBe(original);
  });

  it("HEIC sem tipo continua recusado (a dedução não abre a porta)", async () => {
    await montar();
    await enviar([foto("IMG_0002.heic", "application/octet-stream")]);

    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosAvisos()).toMatch(/IMG_0002\.heic/);
  });
});
