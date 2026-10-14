// @vitest-environment jsdom
//
// Painel de banners: o destino que o painel SUGERE e GRAVA tem que existir na
// loja.
//
//  - "Página da Loja" nascia com `/produtos`, endereço que a loja não tem: a
//    cliente tocava e nada acontecia. Agora nasce `/` (a Home) e a lista de
//    páginas não oferece mais `/produtos`.
//  - O atalho "Categoria: Cama & Banho" montava `/?category=Cama & Banho` cru;
//    o "&" cortava o nome. Agora o nome vai codificado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "c1", name: "Cama & Banho", isActive: true },
      { id: "c2", name: "Mais+Vendidos", isActive: true },
      { id: "c3", name: "Moda #1", isActive: true },
    ],
  }),
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

describe("AdminBannersView — destino sugerido e gravado existe na loja", () => {
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

  const botao = (texto: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

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
    // Banner com texto abre no editor Completo; o passo "3 Destino" só abre
    // livremente em edição (banner novo exige passar pelos passos 1 e 2, o que
    // não muda o que se prova aqui: o botão "Página da Loja" é o mesmo).
    await clicar(
      document.body.querySelector<HTMLElement>('button[title="Editar"]'),
    );
    await clicar(botao("3Destino"));
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 600));
    });
    await clicar(botao("Home, Ofertas"));
  }

  it("'Página da Loja' nasce apontando para a Home, que a loja tem", async () => {
    await abrirPaginasDaLoja();
    const inicio = botao("Início (/)");
    // "hover:border-purple-400/30" também existe em todo atalho: só vale a
    // classe solta, que marca o atalho escolhido.
    expect(inicio?.classList.contains("border-purple-400")).toBe(true);
  });

  it("a lista de páginas não oferece o endereço morto /produtos", async () => {
    await abrirPaginasDaLoja();
    expect(document.body.textContent).not.toContain("/produtos");
  });

  it.each([
    ["Categoria: Cama & Banho", "(/?category=Cama%20%26%20Banho)"],
    ["Categoria: Mais+Vendidos", "(/?category=Mais%2BVendidos)"],
    ["Categoria: Moda #1", "(/?category=Moda%20%231)"],
  ])("atalho '%s' leva o nome codificado", async (rotulo, link) => {
    await abrirPaginasDaLoja();
    const atalho = botao(rotulo);
    expect(atalho?.textContent).toContain(link);
  });
});
