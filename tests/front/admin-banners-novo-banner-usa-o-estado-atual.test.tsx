// @vitest-environment jsdom
//
// "Novo banner" pelo evento da barra (admin:open-new-banner-dialog) tem de usar
// a lista e a aba de AGORA, nao as da primeira renderizacao: o botao do corpo
// saiu e este ouvinte e o unico caminho. Posicao/ordem erradas publicariam o
// banner na secao errada. Antes de a lista carregar, o evento nao abre nada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirMaisOpcoes,
  abrirNovoBannerPelaBarra,
  escolherImagemPropria,
} from "./helpers/editor-de-banner";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

// Estado do hook dublado: o teste muda a lista e o "carregou" entre renders,
// como acontece quando os banners chegam do servidor depois da montagem.
const bannerDoMeio = (n: number) => ({
  id: `banner-meio-${n}`,
  imageUrl: `https://proj.supabase.co/storage/v1/object/public/banners/meio-${n}.jpg`,
  title: `Meio ${n}`,
  link: "",
  position: "home_middle" as const,
  active: true,
  order: n,
});
const estado = {
  banners: [] as ReturnType<typeof bannerDoMeio>[],
  isLoaded: true,
};

// L10: o rascunho do formulário de banner é do usuário (`:<uid>`) — a tela
// agora lê o hook de auth, dublado aqui.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: estado.banners,
    isLoaded: estado.isLoaded,
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
    success: vi.fn(),
    error: vi.fn(),
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

describe("AdminBannersView - Novo banner pelo evento usa o estado ATUAL", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.banners = [];
    estado.isLoaded = true;
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

  async function renderizar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={onNavigate}
          active={true}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const editorAberto = () =>
    hospedeiro.textContent?.includes("Usar minha imagem");

  it("lista chega depois da montagem e a aba Meio vale: abre em home_middle, ordem 4", async () => {
    await renderizar();

    estado.banners = [bannerDoMeio(1), bannerDoMeio(2), bannerDoMeio(3)];
    await renderizar();

    const abaMeio = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Meio",
    );
    expect(abaMeio).toBeTruthy();
    await act(async () => abaMeio!.click());

    await abrirNovoBannerPelaBarra();
    expect(editorAberto()).toBe(true);
    await escolherImagemPropria();
    await abrirMaisOpcoes();

    const posicao =
      document.querySelector<HTMLSelectElement>("#banner-position");
    expect(posicao?.value).toBe("home_middle");
    const ordem = document.querySelector<HTMLInputElement>(
      "#banner-order, #banner-simple-order",
    );
    expect(ordem?.value).toBe("4");
  });

  it("evento antes de a lista carregar nao abre o editor; depois de carregar abre", async () => {
    estado.isLoaded = false;
    await renderizar();
    await abrirNovoBannerPelaBarra();
    expect(editorAberto()).toBeFalsy();

    estado.isLoaded = true;
    await renderizar();
    await abrirNovoBannerPelaBarra();
    expect(editorAberto()).toBe(true);
  });
});
