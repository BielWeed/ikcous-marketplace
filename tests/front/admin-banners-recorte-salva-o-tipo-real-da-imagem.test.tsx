// @vitest-environment jsdom
//
// Achado do follow-up 17/09 (AdminBannersView.handleAdjustConfirm): o
// recorte confirmado no ImageAdjuster subia embrulhado com nome/tipo FIXOS
// `banner-image-<ts>.jpg` / `image/jpeg` — mas o ImageAdjuster SEMPRE
// exporta `image/webp`. A mentira quebra a transformação de imagem do
// Storage (que decodifica pelo Content-Type DECLARADO) e o nome fixo
// ".jpg" virava a extensão do bucket — o mesmo defeito já corrigido nos
// produtos (achado AdminProductFormView-499).
//
// Correção: as duas telas usam o helper compartilhado
// src/lib/arquivo-da-imagem-recortada.ts, que deriva nome E Content-Type
// do tipo REAL do blob.
//
// Este teste prova o FLUXO REAL da tela de banners (mesmo padrão de
// montagem de admin-banners-esc-fecha-so-o-cropper.test.tsx: view real,
// React puro via createRoot + act, sem @testing-library), com o
// ImageAdjuster mockado só para capturar o `onConfirm` — a tela em volta
// (diálogo, upload, limpeza do Storage, toasts, estado do formulário) é
// real:
//
// 1. "Novo Banner" → upload do arquivo original → botão "Ajustar".
// 2. Confirmar o recorte com blobs webp, png, jpeg e sem tipo: o File que
//    chega em `uploadBannerImage` tem SEMPRE extensão e MIME honestos e o
//    prefixo "banner-image-".
// 3. O sucesso do recorte preserva o comportamento existente: a imagem
//    original enviada é apagada do Storage, o formulário passa a apontar
//    para a URL do recorte (thumbnail atualizada) e o toast de sucesso
//    dispara.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O onConfirm do ImageAdjuster mockado é capturado aqui — `vi.hoisted`
// roda antes dos factories de vi.mock.
const captura = vi.hoisted(() => ({
  onConfirm: undefined as ((croppedBlob: Blob) => Promise<void>) | undefined,
}));

vi.mock("@/components/ui/custom/ImageAdjuster", () => ({
  ImageAdjuster: (props: {
    onConfirm: (croppedBlob: Blob) => Promise<void>;
  }) => {
    captura.onConfirm = props.onConfirm;
    return null;
  },
}));

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();
const toastSuccess = vi.fn();
// O loading devolve um id de toast de verdade: o sucesso do recorte passa
// `{ id: loadingToast }` para substituir o toast de progresso.
const toastLoading = vi.fn(() => "toast-id");

// O botão "Novo Banner" só renderiza com a lista populada
// (AdminBannersView: `isLoaded && banners.length > 0`).
const bannerPublicado = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/banner-publicado-na-home.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [bannerPublicado],
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile,
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({}),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: vi.fn(),
    loading: toastLoading,
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function selecionarArquivo(id: string, arquivo: File) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.defineProperty(el, "files", {
    value: [arquivo],
    configurable: true,
  });
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AdminBannersView — recorte confirmado chega ao upload com o tipo REAL do blob", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteStorageFile.mockResolvedValue(undefined);
    // A URL devolvida carrega o nome do arquivo: o thumbnail do formulário
    // tem que acabar apontando para o nome HONESTO do recorte.
    uploadBannerImage.mockImplementation(async (file: File) => {
      return `https://proj.supabase.co/storage/v1/object/public/banners/${file.name}`;
    });
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
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

  /** Abre "Novo Banner", sobe a imagem original e abre o ImageAdjuster —
   * deixa `captura.onConfirm` pronto para confirmar o recorte. */
  async function abrirDialogoSubirImagemEAbrirAjuste() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");

    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botaoNovoBanner = localizarBotaoPorTexto(hospedeiro, "Novo Banner")!;
    expect(botaoNovoBanner).toBeDefined();
    await act(async () => {
      botaoNovoBanner.click();
    });
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();

    const arquivoOriginal = new File(["conteudo"], "original.jpg", {
      type: "image/jpeg",
    });
    await act(async () => {
      selecionarArquivo("banner-upload", arquivoOriginal);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(uploadBannerImage).toHaveBeenCalledWith(arquivoOriginal);

    const botaoAjustar = localizarBotaoPorTexto(hospedeiro, "Ajustar")!;
    expect(
      botaoAjustar,
      "botão Ajustar só existe com imageUrl setado",
    ).toBeDefined();
    await act(async () => {
      botaoAjustar.click();
    });
    expect(
      captura.onConfirm,
      "ImageAdjuster mockado deve ter recebido o onConfirm da tela",
    ).toBeDefined();
  }

  async function confirmarRecorte(blob: Blob) {
    await act(async () => {
      await captura.onConfirm!(blob);
      await esperarMicrotarefas();
    });
  }

  it("cada formato sai com extensão e MIME honestos — webp, png, jpeg e o fallback webp para blob sem tipo", async () => {
    await abrirDialogoSubirImagemEAbrirAjuste();

    const casos = [
      {
        // O formato que o ImageAdjuster de fato exporta hoje — e o caso
        // que o defeito original quebrava (.jpg/image/jpeg mentirosos).
        rotulo: "webp",
        blob: new Blob(["recorte-fake-webp"], { type: "image/webp" }),
        extensao: "webp",
        mime: "image/webp",
      },
      {
        rotulo: "png",
        blob: new Blob(["recorte-fake-png"], { type: "image/png" }),
        extensao: "png",
        mime: "image/png",
      },
      {
        rotulo: "jpeg",
        blob: new Blob(["recorte-fake-jpeg"], { type: "image/jpeg" }),
        extensao: "jpg",
        mime: "image/jpeg",
      },
      {
        rotulo: "sem-tipo (fallback)",
        blob: new Blob(["recorte-fake-sem-tipo"]),
        extensao: "webp",
        mime: "image/webp",
      },
    ];

    let confirmsFeitos = 0;
    for (const caso of casos) {
      await confirmarRecorte(caso.blob);
      confirmsFeitos += 1;

      // O primeiro upload é o arquivo original; cada confirm adiciona
      // exatamente UM upload — o File da última chamada é o do recorte.
      expect(
        uploadBannerImage,
        `confirm do ${caso.rotulo} deve ter chegado ao upload`,
      ).toHaveBeenCalledTimes(1 + confirmsFeitos);

      const enviado = uploadBannerImage.mock.lastCall?.[0];
      expect(enviado instanceof File, `${caso.rotulo}: vira File`).toBe(true);
      expect(enviado.type, `${caso.rotulo}: Content-Type diz a verdade`).toBe(
        caso.mime,
      );
      expect(
        enviado.name.startsWith("banner-image-"),
        `${caso.rotulo}: mantém o prefixo do banner`,
      ).toBe(true);
      expect(
        enviado.name.endsWith(`.${caso.extensao}`),
        `${caso.rotulo}: extensão casa com o conteúdo`,
      ).toBe(true);
      if (caso.rotulo === "webp") {
        // A mentira original, explicitamente: um webp NÃO pode subir como
        // .jpg/image/jpeg.
        expect(enviado.name.endsWith(".jpg")).toBe(false);
        expect(enviado.type).not.toBe("image/jpeg");
      }
    }
  });

  it("o sucesso do recorte preserva o fluxo existente: apaga a imagem original do Storage, aponta o formulário para o recorte e avisa com toast", async () => {
    await abrirDialogoSubirImagemEAbrirAjuste();

    const urlDoUploadOriginal = uploadBannerImage.mock.calls[0][0] as File;
    await confirmarRecorte(
      new Blob(["recorte-fake-webp"], { type: "image/webp" }),
    );

    // A imagem original (do upload que abriu o ajuste) é limpa do Storage —
    // o recorte a substitui.
    expect(deleteStorageFile).toHaveBeenCalledWith(
      expect.stringContaining(urlDoUploadOriginal.name),
    );

    // O formulário agora aponta para o recorte — com o nome HONESTO no
    // caminho (a URL devolvida pelo mock carrega o nome do File).
    const miniatura = hospedeiro.querySelector<HTMLImageElement>(
      'img[alt="Preview Thumbnail"]',
    );
    expect(miniatura?.src).toMatch(/banner-image-\d+\.webp$/);

    expect(toastLoading).toHaveBeenCalledWith("Enviando imagem recortada...");
    expect(toastSuccess).toHaveBeenCalledWith(
      "Imagem ajustada com sucesso!",
      expect.objectContaining({ id: expect.anything() }),
    );
  });
});
