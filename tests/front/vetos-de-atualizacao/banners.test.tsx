// @vitest-environment jsdom
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
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

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

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

describe("banners vetam a atualização durante upload e gravação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function abrir() {
    await montar();
    await act(async () =>
      localizarBotaoPorTexto(hospedeiro, "Novo Banner")!.click(),
    );
    await act(async () =>
      localizarBotaoPorTexto(hospedeiro, "Usar minha imagem")!.click(),
    );
  }

  async function enviar() {
    await act(async () => {
      selecionarArquivo(
        "banner-upload",
        new File(["foto"], "banner.jpg", { type: "image/jpeg" }),
      );
      await esperarMicrotarefas();
    });
  }

  it.each([false, true])(
    "upload pendente veta e libera ao terminar (erro=%s)",
    async (erro) => {
      await abrir();
      const envio = adiar<string>();
      uploadBannerImage.mockReturnValue(envio.promessa);
      try {
        await enviar();
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual(["upload-de-banner"]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver(urlNova);
          await esperarMicrotarefas();
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "gravação da URL veta até a resposta final (erro=%s)",
    async (erro) => {
      await abrir();
      uploadBannerImage.mockResolvedValue(urlNova);
      await enviar();
      expect(haOperacaoSensivel()).toBe(false);
      const gravacao = adiar<void>();
      addBanner.mockReturnValue(gravacao.promessa);
      try {
        await act(async () => {
          localizarBotaoPorTexto(hospedeiro, "Salvar Banner")!.click();
          await esperarMicrotarefas();
        });
        expect(addBanner).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual(["upload-de-banner"]);
      } finally {
        await act(async () => {
          if (erro) gravacao.rejeitar(new Error("falha simulada"));
          else gravacao.resolver();
          await esperarMicrotarefas();
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "recorte pendente veta e libera ao terminar (erro=%s)",
    async (erro) => {
      await abrir();
      uploadBannerImage.mockResolvedValue(urlNova);
      await enviar();
      await act(async () =>
        localizarBotaoPorTexto(hospedeiro, "Ajustar")!.click(),
      );
      const envio = adiar<string>();
      uploadBannerImage.mockReturnValue(envio.promessa);
      try {
        await act(async () => {
          localizarBotaoPorTexto(
            document.body,
            "Confirmar recorte de teste",
          )!.click();
          await esperarMicrotarefas();
        });
        expect(uploadBannerImage).toHaveBeenCalledTimes(2);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual(["upload-de-banner"]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver(urlNova);
          await esperarMicrotarefas();
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );
});
