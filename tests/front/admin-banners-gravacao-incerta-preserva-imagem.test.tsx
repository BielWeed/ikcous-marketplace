// @vitest-environment jsdom
// Regressão: erro de rede não prova que a imagem enviada é órfã.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirNovoBannerPelaBarra,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

const urlNova =
  "https://proj.supabase.co/storage/v1/object/public/banners/upload-orfao.jpg";

// O botão "Novo Banner" só renderiza com a lista populada
// (AdminBannersView: `isLoaded && banners.length > 0`), então a montagem
// precisa de um banner existente mesmo com os cenários sendo de CRIAR.
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

// L10: o rascunho do formulário de banner é do usuário (`:<uid>`) — a tela
// agora lê o hook de auth, dublado aqui.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

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
  // o hook devolve "isOffline": false = online. Offline o handleSubmit
  // recusa salvar e o botão Novo Banner nasce disabled.
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError,
    loading: vi.fn(() => "toast-id"),
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

describe("AdminBannersView — imagem após falha ao salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteStorageFile.mockResolvedValue(undefined);
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

  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");

    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={onNavigate}
          active={true}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  /** Abre o diálogo de novo banner e sobe uma imagem (formData.imageUrl
   * passa a apontar para um upload que nenhum banner gravado referencia). */
  async function abrirDialogoESubirImagem() {
    uploadBannerImage.mockResolvedValue(urlNova);

    await abrirNovoBannerPelaBarra();
    await escolherImagemPropria();

    // Diálogo aberto (botão "Salvar Banner" só existe dentro dele) e em
    // modo de criação.
    expect(localizarBotaoPorTexto(hospedeiro, "Salvar Banner")).toBeDefined();

    const arquivo = new File(["conteudo"], "upload-orfao.jpg", {
      type: "image/jpeg",
    });
    await act(async () => {
      selecionarArquivo("banner-upload", arquivo);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(uploadBannerImage).toHaveBeenCalledWith(arquivo);
  }

  it.each([
    ["rede sem code", { message: "TypeError: Failed to fetch" }, false],
    ["rede com code vazio", { code: "", message: "Failed to fetch" }, false],
    ["TypeError de rede", new TypeError("Failed to fetch"), false],
    ["rejeição definitiva", { code: "23505" }, true],
  ])(
    "%s: cancelar só apaga a imagem se a rejeição foi definitiva",
    async (_, erro, deveApagar) => {
      await montar();
      await abrirDialogoESubirImagem();
      addBanner.mockRejectedValueOnce(erro);
      const salvar = localizarBotaoPorTexto(hospedeiro, "Salvar Banner");
      expect(salvar).toBeDefined();
      await act(async () => {
        salvar!.click();
        await esperarMicrotarefas();
      });
      expect(addBanner).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith(
        "Erro ao salvar as configurações do banner.",
      );
      const cancelar = localizarBotaoPorTexto(hospedeiro, "Cancelar");
      expect(cancelar).toBeDefined();
      await act(async () => {
        cancelar!.click();
        await esperarMicrotarefas();
      });
      expect(document.getElementById("banner-upload")).toBeNull();
      if (deveApagar) {
        expect(deleteStorageFile).toHaveBeenCalledExactlyOnceWith(urlNova);
      } else {
        expect(deleteStorageFile).not.toHaveBeenCalled();
      }
    },
  );
});
