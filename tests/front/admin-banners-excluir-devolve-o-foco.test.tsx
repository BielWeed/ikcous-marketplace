// @vitest-environment jsdom
//
// Excluir um banner só com o teclado: o botão da lixeira some com o cartão e o
// foco caía no corpo da página. Depois de EXCLUIR o foco vai para o título da
// tela; em "Cancelar" volta para a lixeira de onde saiu.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BannerFalso = {
  id: string;
  imageUrl: string;
  title: string;
  link: string;
  position: "home_top";
  active: boolean;
  order: number;
};

const banner = (id: string, title: string, order: number): BannerFalso => ({
  id,
  imageUrl: `https://proj.supabase.co/storage/v1/object/public/banners/${id}.jpg`,
  title,
  link: "",
  position: "home_top",
  active: true,
  order,
});

let mockBanners: BannerFalso[] = [];
const deleteBanner = vi.fn(async (id: string) => {
  mockBanners = mockBanners.filter((b) => b.id !== id);
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: mockBanners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner: vi.fn(),
    deleteBanner,
    deleteStorageFile: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 30));

describe("AdminBannersView — o foco depois de excluir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
    mockBanners = [banner("b1", "Primeiro", 1), banner("b2", "Segundo", 2)];
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

  async function montarEPedirExclusao() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={vi.fn()}
          active={true}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
    const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Excluir"]',
    );
    expect(lixeira).not.toBeNull();
    lixeira?.focus();
    await act(async () => {
      lixeira?.click();
      await esperar();
    });
    return lixeira as HTMLButtonElement;
  }

  const botaoDaPergunta = (texto: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );

  it("excluiu: o foco vai para o título da tela, não para o corpo da página", async () => {
    await montarEPedirExclusao();
    await act(async () => {
      botaoDaPergunta("Excluir Banner")?.click();
      await esperar();
    });
    await act(async () => {
      await esperar();
    });

    expect(deleteBanner).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(hospedeiro.querySelector("h1")),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("cancelou: o foco volta para a lixeira de onde saiu", async () => {
    const lixeira = await montarEPedirExclusao();
    await act(async () => {
      botaoDaPergunta("Cancelar")?.click();
      await esperar();
    });

    expect(deleteBanner).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(lixeira));
  });
});
