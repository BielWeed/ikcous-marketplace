// @vitest-environment jsdom
//
// Achado AdminBannersView-1739: handleToggleActive (o handler por trás do
// Switch "Exibir" de cada CartaoDoBanner) só fazia console.error no catch —
// era o único handler de escrita do arquivo sem toast.error, diferente dos
// irmãos confirmDeleteBanner e moveBanner, que sempre avisam o lojista. Sem
// o toast, uma falha de rede/RLS ao alternar o banner passa em silêncio: o
// Switch volta a ficar habilitado e o lojista, sem nenhum sinal de erro,
// acredita que a troca foi aplicada quando o banner continua exatamente
// como estava para os clientes da loja.
//
// Este teste prova, no nível do componente (mesmo padrão de montagem de
// admin-banners-voltar-fecha-so-o-dialogo.test.tsx): clicar no Switch com
// updateBanner rejeitando avisa o lojista com toast.error.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// Só precisa de um banner publicado para o card do Switch "Exibir" renderizar.
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

describe("AdminBannersView — alternar ativo do banner avisa o lojista quando falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    window.history.replaceState(
      { view: "admin-banners" },
      "",
      "/admin-banners",
    );

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
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function localizarSwitchDoBanner(): HTMLElement {
    const el = hospedeiro.querySelector(
      `#banner-card-active-${bannerPublicado.id}`,
    );
    expect(el).toBeDefined();
    return el as HTMLElement;
  }

  it("avisa com toast.error quando updateBanner falha ao alternar", async () => {
    updateBanner.mockRejectedValueOnce(new Error("falha de rede"));
    await montar();

    const interruptor = localizarSwitchDoBanner();
    await act(async () => {
      interruptor.click();
      await esperarMicrotarefas();
    });

    expect(updateBanner).toHaveBeenCalledWith(bannerPublicado.id, {
      active: false,
    });
    // O bug: sem toast.error, a falha era engolida (só console.error) e o
    // lojista não recebia nenhum sinal de que a troca não foi aplicada.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toMatch(/banner/i);
  });

  it("não avisa nada quando updateBanner tem sucesso (comportamento inalterado)", async () => {
    updateBanner.mockResolvedValueOnce(undefined);
    await montar();

    const interruptor = localizarSwitchDoBanner();
    await act(async () => {
      interruptor.click();
      await esperarMicrotarefas();
    });

    expect(updateBanner).toHaveBeenCalledWith(bannerPublicado.id, {
      active: false,
    });
    expect(toastError).not.toHaveBeenCalled();
  });
});
