// @vitest-environment jsdom
//
// Painel de banners: o atalho de destino "Categoria: X" só existe para
// categoria ATIVA.
//
// A lojista pode esconder uma categoria da vitrine. Se o editor ainda a
// oferecesse como destino, o banner prometeria "Fora de linha" e a loja, que
// descarta categoria escondida, abriria o catálogo inteiro ("Todas"). O filtro
// `.filter((c) => c.isActive)` em dynamicRouteSuggestions é a única coisa que
// impede isso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirMaisOpcoes } from "./helpers/editor-de-banner";

const lista = vi.hoisted(() => ({ banners: [] as unknown[] }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: lista.banners,
    isLoaded: true,
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
// Referência estável: o hook real também devolve a mesma lista entre renders,
// e `categories` é dependência do useMemo dos atalhos.
const categoriasDoTeste = vi.hoisted(() => [
  { id: "c1", name: "Cama & Banho", isActive: true },
  { id: "c4", name: "Fora de linha", isActive: false },
]);
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: categoriasDoTeste }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "t"),
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminBannersView — atalho de destino só para categoria ativa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    lista.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
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

  const botoes = () => [...document.body.querySelectorAll("button")];
  const botao = (texto: string) =>
    botoes().find((b) => b.textContent?.includes(texto));

  async function clicar(el: HTMLElement | undefined | null) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
    });
  }

  async function abrirPaginasDaLoja() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    await clicar(
      document.body.querySelector<HTMLElement>('button[title="Editar"]'),
    );
    await abrirMaisOpcoes();
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 600));
    });
    await clicar(botao("Home, Ofertas"));
  }

  it("oferece o atalho da categoria ativa, com o link codificado", async () => {
    await abrirPaginasDaLoja();
    const atalho = botao("Categoria: Cama & Banho");
    expect(atalho?.textContent).toContain("(/?category=Cama%20%26%20Banho)");
  });

  it("NÃO oferece atalho para categoria escondida da vitrine", async () => {
    await abrirPaginasDaLoja();
    // Controle: o atalho da ativa está na tela, então a ausência abaixo não é
    // porque a lista de atalhos nem abriu.
    expect(botao("Categoria: Cama & Banho")).toBeTruthy();
    expect(botao("Categoria: Fora de linha")).toBeUndefined();
    expect(document.body.textContent).not.toContain("Fora de linha");
    expect(document.body.textContent).not.toContain("Fora%20de%20linha");
  });
});
