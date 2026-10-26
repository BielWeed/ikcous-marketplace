// @vitest-environment jsdom
//
// Quatro defeitos da lista de fotos do produto (painel):
//  1. Tocar duas vezes rápido em "Excluir" apagava DUAS fotos: o cartão que
//     está saindo (animação) ainda aceitava o 2º toque e apagava a foto que
//     tinha ocupado a posição. Agora a exclusão é pela FOTO, não pela posição.
//  2. Foto HEIC/HEIF (iPhone/Samsung) subia sem conversão e aparecia quebrada.
//     Agora é recusada com uma frase clara, nomeando o arquivo.
//  3. O limite de 30 MB era medido nos arquivos ORIGINAIS (antes de reduzir
//     cada foto) e o de 10 fotos recusava tudo. Agora entram as que cabem e o
//     aviso diz quantas ficaram de fora.
//  4. "Deslize para o lado" aparecia com 2 fotos (que já cabem) e piscava
//     para sempre.
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

const fotosNaTela = () =>
  [
    ...document.body.querySelectorAll(
      '[aria-label="Galeria de fotos do produto"] img',
    ),
  ]
    .map((i) => i.getAttribute("src"))
    .filter((src): src is string => !!src && src.startsWith("https://cdn/"));

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("AdminProductFormView — lista de fotos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let contador: number;
  let decodeFalha: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    contador = 0;
    decodeFalha = false;
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
          queueMicrotask(() => (decodeFalha ? this.onerror : this.onload)?.());
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

  it("duplo toque em Excluir da foto 2 apaga só ela (sobram 4, a foto 3 segue)", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5].map((n) => foto(`f${n}.jpg`)));
    expect(fotosNaTela()).toEqual([1, 2, 3, 4, 5].map(url));

    const excluir = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        'button[title="Excluir"]',
      ),
    ][1];
    await act(async () => {
      excluir.click();
      excluir.click();
    });
    await esperar(800);

    expect(fotosNaTela()).toEqual([url(1), url(3), url(4), url(5)]);
  });

  it("foto HEIC é recusada, nomeada, e não entra na lista", async () => {
    await montar();
    await enviar([foto("IMG_0001.HEIC", "image/heic")]);

    expect(fotosNaTela()).toEqual([]);
    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosAvisos()).toMatch(/IMG_0001\.HEIC/);
    expect(textoDosAvisos()).toMatch(/JPG ou PNG/);
  });

  it("foto que não abre (leitura falha) não é enviada nem vira 'Boa qualidade'", async () => {
    await montar();
    decodeFalha = true;
    await enviar([foto("quebrada.jpg", "image/jpeg", 500 * 1024)]);

    expect(fotosNaTela()).toEqual([]);
    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosAvisos()).toMatch(/quebrada\.jpg/);
    expect(document.body.textContent).not.toContain("Boa qualidade");
  });

  it("8 fotos de 4,5 MB (36 MB) entram todas: o total original não conta", async () => {
    await montar();
    const mb = 1024 * 1024;
    await enviar(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
        foto(`g${n}.jpg`, "image/jpeg", 4.5 * mb),
      ),
    );

    expect(fotosNaTela()).toHaveLength(8);
    expect(textoDosAvisos()).not.toMatch(/30 MB/);
  });

  it("com 8 já no produto e 3 escolhidas, entram 2 e o aviso diz que 1 ficou de fora", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5, 6, 7, 8].map((n) => foto(`h${n}.jpg`)));
    expect(fotosNaTela()).toHaveLength(8);

    await enviar([foto("i1.jpg"), foto("i2.jpg"), foto("i3.jpg")]);

    expect(fotosNaTela()).toHaveLength(10);
    expect(textoDosAvisos()).toMatch(/1 foto ficou de fora/);
  });

  it("o aviso 'Deslize' só aparece com 3 fotos ou mais, e não pisca", async () => {
    await montar();
    await enviar([foto("a.jpg"), foto("b.jpg")]);
    expect(document.body.textContent).not.toContain("Deslize para o lado");

    await enviar([foto("c.jpg")]);
    const aviso = [...document.body.querySelectorAll("span")].find((s) =>
      s.textContent?.includes("Deslize para o lado"),
    );
    expect(aviso).toBeDefined();
    expect(aviso?.className).not.toContain("animate-pulse");
  });
});
