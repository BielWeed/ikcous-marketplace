// @vitest-environment jsdom
//
// Variação que usa uma foto do produto precisa acompanhar essa foto.
//
// O defeito: a variação guarda a URL da foto (`imageUrl`). Recortar a foto do
// produto trocava só a lista de fotos -- a variação seguia apontando para a
// imagem VELHA (que continua no armazenamento) e a vitrine mostrava a foto
// antiga. Excluir a foto também deixava a variação apontando para uma imagem
// que o produto já não tem.
//
// Agora, no mesmo passo: recortar troca a URL nas variações que a usavam, e
// excluir limpa o campo (a variação volta a usar a galeria normal). As
// variações que usam OUTRA foto não mudam.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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

let concluirRecorteAtrasado: (() => void) | undefined;
const blobRecortado = () => new Blob(["recorte"], { type: "image/webp" });

// O dublê permite entregar um resultado mesmo depois que o editor fecha.
vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: ({
    onConfirm,
    onClose,
  }: {
    onConfirm: (blob: Blob) => void;
    onClose: () => void;
  }) => (
    <>
      <button
        type="button"
        data-testid="confirmar-recorte"
        onClick={() => onConfirm(blobRecortado())}
      >
        Confirmar recorte
      </button>
      <button
        type="button"
        data-testid="iniciar-recorte"
        onClick={() => {
          concluirRecorteAtrasado = () => onConfirm(blobRecortado());
        }}
      >
        Salvar Ajuste
      </button>
      <button type="button" data-testid="cancelar-recorte" onClick={onClose}>
        Cancelar
      </button>
    </>
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

const FOTO_A = "https://cdn/a.jpg";
const FOTO_B = "https://cdn/b.jpg";
const FOTO_C = "https://cdn/c.jpg";
const FOTO_A_RECORTADA = "https://cdn/a-recortada.webp";

const variacao = (id: string, valor: string, imageUrl?: string) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: 3,
  active: true,
  ...(imageUrl ? { imageUrl } : {}),
});

describe("AdminProductFormView — recortar ou excluir foto acerta a variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    concluirRecorteAtrasado = undefined;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    upsertVariants.mockResolvedValue(undefined);
    uploadProductImages.mockResolvedValue([FOTO_A_RECORTADA]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // As miniaturas das variações usam LazyImage, que observa a rolagem.
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

  // Produto com 2 fotos; Rosa usa a foto A, Azul usa a B, Verde não usa foto.
  async function montar(
    quantidadeDeVinculos = 1,
    comFotoC = false,
    fotos = comFotoC ? [FOTO_A, FOTO_B, FOTO_C] : [FOTO_A, FOTO_B],
  ) {
    const produto = {
      id: "p-1",
      name: "Camiseta",
      description: "Algodão",
      price: 50,
      stock: 10,
      sold: 0,
      category: "Geral",
      images: fotos,
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: [
        variacao("v1", "Rosa", quantidadeDeVinculos > 0 ? FOTO_A : undefined),
        variacao("v2", "Azul", FOTO_B),
        variacao(
          "v3",
          "Verde",
          comFotoC ? FOTO_C : quantidadeDeVinculos > 1 ? FOTO_A : undefined,
        ),
      ],
    };
    fetchProduct.mockResolvedValue(produto);
    updateProduct.mockImplementation(async (_id, updates) => ({
      ...produto,
      ...updates,
    }));
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
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function salvar() {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar alterações",
    );
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  /**
   * A foto de cada variação MANDADA ao banco no último salvar. O salvar só
   * manda as variações que mudaram: as que seguem como estavam não aparecem.
   */
  function fotosGravadasPorVariacao() {
    expect(upsertVariants).toHaveBeenCalled();
    const gravadas = upsertVariants.mock.calls.at(-1)?.[1] as {
      id: string;
      imageUrl?: string;
    }[];
    return Object.fromEntries(gravadas.map((v) => [v.id, v.imageUrl || null]));
  }

  it("recortar a foto A leva a variação Rosa para a foto recortada; Azul e Verde não são mexidas", async () => {
    await montar();
    await act(async () => {
      (
        document.querySelector(
          'button[title="Ajustar e Cortar"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        document.querySelector(
          '[data-testid="confirmar-recorte"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await salvar();

    expect(fotosGravadasPorVariacao()).toEqual({ v1: FOTO_A_RECORTADA });
  });

  const clicar = async (seletor: string) => {
    await act(async () => {
      document.querySelector<HTMLButtonElement>(seletor)!.click();
    });
  };

  it("ignora o recorte da foto B entregue depois de cancelar e excluir A", async () => {
    await montar(0, true);
    await clicar('button[aria-label^="Ver foto 2 de"]');
    await clicar('button[title="Ajustar e Cortar"]');
    await clicar('[data-testid="iniciar-recorte"]');
    await clicar('[data-testid="cancelar-recorte"]');
    await clicar('button[aria-label^="Ver foto 1 de"]');
    await clicar('button[title="Excluir"]');

    expect(concluirRecorteAtrasado).toBeDefined();
    await act(async () => {
      concluirRecorteAtrasado?.();
    });
    await salvar();

    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([
      FOTO_B,
      FOTO_C,
    ]);
    expect(upsertVariants).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith(
      "Imagem ajustada com sucesso!",
      expect.anything(),
    );
    expect(uploadProductImages).not.toHaveBeenCalled();
  });

  it("o recorte em andamento segue a foto B quando A sai da galeria", async () => {
    await montar(0, true);
    const fotoBRecortada = "https://cdn/b-recortada.webp";
    uploadProductImages.mockResolvedValue([fotoBRecortada]);

    await clicar('button[aria-label^="Ver foto 2 de"]');
    await clicar('button[title="Ajustar e Cortar"]');
    await clicar('[data-testid="iniciar-recorte"]');
    await clicar('button[aria-label^="Ver foto 1 de"]');
    await clicar('button[title="Excluir"]');

    expect(concluirRecorteAtrasado).toBeDefined();
    await act(async () => {
      concluirRecorteAtrasado?.();
    });
    await salvar();

    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([
      fotoBRecortada,
      FOTO_C,
    ]);
    expect(fotosGravadasPorVariacao()).toEqual({ v2: fotoBRecortada });
  });

  it("recorta só a segunda miniatura quando duas fotos têm a mesma URL", async () => {
    await montar(1, false, [FOTO_A, FOTO_A, FOTO_B]);
    await clicar('button[aria-label^="Ver foto 2 de"]');
    await clicar('button[title="Ajustar e Cortar"]');
    await clicar('[data-testid="confirmar-recorte"]');
    await salvar();

    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([
      FOTO_A,
      FOTO_A_RECORTADA,
      FOTO_B,
    ]);
    expect(upsertVariants).not.toHaveBeenCalled();
  });

  it("o recorte segue a segunda cópia mesmo que a primeira seja excluída", async () => {
    await montar(0, false, [FOTO_A, FOTO_A, FOTO_B]);
    await clicar('button[aria-label^="Ver foto 2 de"]');
    await clicar('button[title="Ajustar e Cortar"]');
    await clicar('[data-testid="iniciar-recorte"]');
    await clicar('button[aria-label^="Ver foto 1 de"]');
    await clicar('button[title="Excluir"]');

    expect(concluirRecorteAtrasado).toBeDefined();
    await act(async () => {
      concluirRecorteAtrasado?.();
    });
    await salvar();

    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([
      FOTO_A_RECORTADA,
      FOTO_B,
    ]);
    expect(upsertVariants).not.toHaveBeenCalled();
  });

  it("o recorte segue a segunda cópia quando ela vira a capa", async () => {
    await montar(1, false, [FOTO_A, FOTO_A, FOTO_B]);
    await clicar('button[aria-label^="Ver foto 2 de"]');
    await clicar('button[title="Ajustar e Cortar"]');
    await clicar('[data-testid="iniciar-recorte"]');
    await clicar('button[aria-label^="Tornar principal: foto 2 de"]');

    expect(concluirRecorteAtrasado).toBeDefined();
    await act(async () => {
      concluirRecorteAtrasado?.();
    });
    await salvar();

    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([
      FOTO_A_RECORTADA,
      FOTO_A,
      FOTO_B,
    ]);
    expect(upsertVariants).not.toHaveBeenCalled();
  });

  it("descarta o recorte se a miniatura escolhida sair, mesmo se a URL ficar", async () => {
    await montar(1, false, [FOTO_A, FOTO_A, FOTO_B]);
    await clicar('button[aria-label^="Ver foto 2 de"]');
    await clicar('button[title="Ajustar e Cortar"]');
    await clicar('[data-testid="iniciar-recorte"]');
    await clicar('button[title="Excluir"]');

    expect(concluirRecorteAtrasado).toBeDefined();
    await act(async () => {
      concluirRecorteAtrasado?.();
    });
    await salvar();

    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([
      FOTO_A,
      FOTO_B,
    ]);
    expect(upsertVariants).not.toHaveBeenCalled();
    expect(uploadProductImages).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalledWith(
      "Imagem ajustada com sucesso!",
      expect.anything(),
    );
  });

  it("conta todas as variações da foto e Voltar preserva a foto e os vínculos", async () => {
    await montar(2);
    await act(async () => {
      (
        document.querySelector('button[title="Excluir"]') as HTMLButtonElement
      ).click();
    });
    const janela = document.querySelector('[data-testid="confirmar-acao"]');
    expect(janela?.textContent).toContain("Esta foto é usada em 2 variações.");
    await act(async () => {
      (
        [...janela!.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Voltar",
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector('[data-testid="confirmar-acao"]')).toBeNull();
    expect(
      document.querySelector('img[src="https://cdn/a.jpg"]'),
    ).not.toBeNull();
    await salvar();
    expect(upsertVariants).not.toHaveBeenCalled();
    expect(updateProduct.mock.calls.at(-1)?.[1].images).toBeUndefined();
  });

  it("foto sem variação continua sendo excluída sem confirmação", async () => {
    await montar(0);
    await act(async () => {
      (
        document.querySelector('button[title="Excluir"]') as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector('[data-testid="confirmar-acao"]')).toBeNull();
    await salvar();
    expect(updateProduct.mock.calls.at(-1)?.[1].images).toEqual([FOTO_B]);
    expect(upsertVariants).not.toHaveBeenCalled();
  });

  it("excluir a foto A limpa a foto da Rosa (volta à galeria); Azul e Verde não são mexidas", async () => {
    await montar();
    await act(async () => {
      (
        document.body.querySelector('button[title="Excluir"]') as HTMLElement
      ).click();
    });

    const janela = document.querySelector('[data-testid="confirmar-acao"]');
    expect(janela).not.toBeNull();
    expect(janela?.textContent).toContain(
      "Esta foto é usada em 1 variação. Ao salvar, esta foto sairá do produto e deixará de ser a foto dessa variação. As outras fotos do produto, se houver, continuarão visíveis. Remover esta foto?",
    );
    expect(
      document.querySelector('img[src="https://cdn/a.jpg"]'),
    ).not.toBeNull();
    await act(async () => {
      (
        [...janela!.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Excluir foto",
        ) as HTMLButtonElement
      ).click();
    });

    await salvar();

    expect(fotosGravadasPorVariacao()).toEqual({ v1: null });
  });
});
