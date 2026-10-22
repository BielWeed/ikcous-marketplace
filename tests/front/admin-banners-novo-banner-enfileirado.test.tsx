import {
  VALIDADE_PEDIDO_NOVO_BANNER_MS,
  consumirPedidoDeNovoBanner,
  pedirNovoBanner,
} from "@/lib/novo-banner-pendente";
// @vitest-environment jsdom
//
// "Novo banner" do cabeçalho NÃO pode cair no vazio: o clique que chega antes
// de a tela de Banners montar ou carregar a lista fica enfileirado
// (src/lib/novo-banner-pendente.ts) e abre o editor UMA vez quando der.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ isLoaded: true }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    isLoaded: estado.isLoaded,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner: vi.fn(),
    deleteBanner: vi.fn(),
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t") },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));
const MARCA_DO_EDITOR = "Usar minha imagem";

describe("AdminBannersView — pedido de novo banner enfileirado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.isLoaded = true;
    consumirPedidoDeNovoBanner();
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizar() {
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
  }

  const quantosEditores = () =>
    (hospedeiro.ownerDocument.body.textContent ?? "").split(MARCA_DO_EDITOR)
      .length - 1;

  it("clique antes de a tela montar: abre sozinho, uma vez", async () => {
    pedirNovoBanner();
    await renderizar();
    expect(quantosEditores()).toBe(1);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("tela montada com a lista carregando: abre quando carregar, uma vez", async () => {
    estado.isLoaded = false;
    await renderizar();
    await act(async () => {
      pedirNovoBanner();
      await esperar();
    });
    expect(quantosEditores()).toBe(0);

    estado.isLoaded = true;
    await renderizar();
    expect(quantosEditores()).toBe(1);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("tudo carregado: abre na hora, uma vez, sem deixar pedido pendente", async () => {
    await renderizar();
    await act(async () => {
      pedirNovoBanner();
      await esperar();
    });
    expect(quantosEditores()).toBe(1);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("pedido vencido (mais de 8 s) não abre editor fantasma", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    pedirNovoBanner();
    vi.setSystemTime(Date.now() + VALIDADE_PEDIDO_NOVO_BANNER_MS + 1);
    await renderizar();
    expect(quantosEditores()).toBe(0);
  });

  it("editor já aberto: outro pedido não abre um segundo", async () => {
    await renderizar();
    await act(async () => {
      pedirNovoBanner();
      await esperar();
    });
    await act(async () => {
      pedirNovoBanner();
      await esperar();
    });
    expect(quantosEditores()).toBe(1);
  });
});
