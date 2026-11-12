// @vitest-environment jsdom
//
// Foto que o aparelho não consegue abrir: a tela mostrava o aviso vermelho
// ("Não conseguimos abrir a foto...") E, logo depois, o verde "Imagens
// processadas e enviadas com sucesso!" -- porque a foto ilegível não entrava
// na lista de falhas e, sem falhas, o fim do envio dava sucesso.
//
// Agora o verde só aparece quando NENHUMA foto ficou de fora. Se algumas não
// abriram mas outras subiram, o aviso diz quantas subiram; se nenhuma subiu,
// só o vermelho específico fica.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastDismiss: vi.fn(),
  toastLoading: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
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
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    dismiss: mocks.toastDismiss,
    loading: mocks.toastLoading,
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID_DO_AVISO = "toast-envio-de-fotos";

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

// 500 KB: acima do piso em que a foto passa direto, então ela é LIDA.
const foto = (nome: string) => {
  const f = new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });
  Object.defineProperty(f, "size", { value: 500 * 1024 });
  return f;
};

describe("AdminProductFormView — foto ilegível não diz 'sucesso'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let contador: number;

  beforeEach(() => {
    vi.clearAllMocks();
    contador = 0;
    mocks.toastLoading.mockReturnValue(ID_DO_AVISO);
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    mocks.uploadProductImages.mockImplementation(async () => {
      contador += 1;
      return [`https://cdn/${contador}.jpg`];
    });
    // O nome do arquivo vai na URL do objeto: o dublê de Image recusa as que
    // têm "ruim" no nome, como o aparelho que não decodifica aquela foto.
    URL.createObjectURL = (f: Blob) => `blob:${(f as File).name}`;
    URL.revokeObjectURL = () => {};
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
        set src(v: string) {
          queueMicrotask(() =>
            (v.includes("ruim") ? this.onerror : this.onload)?.(),
          );
        }
      },
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (file: File) => {
        if (file.name.includes("ruim")) throw new Error("Foto ilegível");
        return { width: 800, height: 800, close: vi.fn() };
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  const textoDosErros = () =>
    mocks.toastError.mock.calls.map((c) => String(c[0])).join(" | ");

  it("uma única foto que não abre: só o vermelho; nada de 'sucesso' e o aviso de andamento some", async () => {
    await montar();
    await enviar([foto("ruim.jpg")]);

    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosErros()).toMatch(/ruim\.jpg/);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).toHaveBeenCalledWith(ID_DO_AVISO);
  });

  it.each(["", "application/octet-stream"])(
    "foto ilegível aceita pela extensão, com MIME %j: não tenta upload nem oferece reenvio",
    async (type) => {
      await montar();
      const ruim = new File(["foto corrompida"], "ruim.jpg", {
        type,
        lastModified: 1,
      });
      await enviar([ruim]);

      expect(mocks.uploadProductImages).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Não conseguimos abrir a foto "ruim.jpg". Salve como JPG ou PNG e tente de novo.',
      );
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastWarning).not.toHaveBeenCalled();
      expect(mocks.toastDismiss).toHaveBeenCalledWith(ID_DO_AVISO);
      expect(
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent?.trim() === "Tentar de novo",
        ),
      ).toBe(false);
    },
  );

  it.each(["", "application/octet-stream"])(
    "controle: foto que abre com MIME %j sobe como o próprio arquivo, sem recompressão",
    async (type) => {
      await montar();
      const boa = new File(
        ["foto sintética aceita pelo decodificador"],
        "boa.jpg",
        {
          type,
          lastModified: 1,
        },
      );
      await enviar([boa]);

      expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
      const enviada = mocks.uploadProductImages.mock.calls[0][0][0] as File;
      expect(enviada).toBe(boa);
      expect(enviada.type).toBe(type);
      expect(enviada.name).toBe("boa.jpg");
      expect(enviada.lastModified).toBe(1);
      expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Imagens processadas e enviadas com sucesso!",
        { id: ID_DO_AVISO },
      );
    },
  );

  it("uma boa e uma que não abre: diz '1 de 2 fotos enviadas', sem 'sucesso'", async () => {
    await montar();
    await enviar([foto("boa.jpg"), foto("ruim.jpg")]);

    expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
    expect(textoDosErros()).toMatch(/ruim\.jpg/);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    const aviso = mocks.toastWarning.mock.calls.at(-1);
    expect(String(aviso?.[0])).toBe("1 de 2 fotos enviadas; 1 não abriu.");
    expect(aviso?.[1]).toEqual({ id: ID_DO_AVISO });
  });

  // 50 KB: ABAIXO do piso em que a foto passava direto sem nem ser aberta --
  // o arquivo pequeno que o aparelho não abre era publicado com "sucesso".
  const fotoPequena = (nome: string) => {
    const f = new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });
    Object.defineProperty(f, "size", { value: 50 * 1024 });
    return f;
  };

  it("foto PEQUENA (menos de 100 KB) que não abre: nada sobe, só o vermelho, sem 'sucesso'", async () => {
    await montar();
    await enviar([fotoPequena("ruim.jpg")]);

    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosErros()).toMatch(/ruim\.jpg/);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastDismiss).toHaveBeenCalledWith(ID_DO_AVISO);
  });

  it("uma pequena boa e uma pequena que não abre: diz '1 de 2 fotos enviadas', sem 'sucesso'", async () => {
    await montar();
    await enviar([fotoPequena("boa.jpg"), fotoPequena("ruim.jpg")]);

    expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(String(mocks.toastWarning.mock.calls.at(-1)?.[0])).toBe(
      "1 de 2 fotos enviadas; 1 não abriu.",
    );
  });

  it("controle: foto pequena que abre sobe intacta e dá o aviso de sucesso", async () => {
    await montar();
    const boa = fotoPequena("boa.jpg");
    await enviar([boa]);

    expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
    expect(mocks.uploadProductImages.mock.calls[0][0][0]).toBe(boa);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("controle: todas boas continuam dando o aviso de sucesso", async () => {
    await montar();
    await enviar([foto("a.jpg"), foto("b.jpg")]);

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Imagens processadas e enviadas com sucesso!",
      { id: ID_DO_AVISO },
    );
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});
