// @vitest-environment jsdom
//
// Painel de banners — o preço do produto aparecia com PONTO ("R$ 89.90") em
// três lugares, e dois deles não ficam só no painel:
//
//  - as SUGESTÕES de subtítulo ("Por apenas R$ 89.90" e "De R$ 120.00 por
//    R$ 89.90"): o lojista clica, o texto é gravado no banner e a CLIENTE o lê
//    na vitrine da loja;
//  - o preço do produto já vinculado ao banner e o da lista de produtos para
//    vincular (só no painel, mas no mesmo formato errado).
//
// O QUE MUDOU: tudo passou a usar `formatCurrency` (src/lib/utils.ts), o
// mesmo utilitário de moeda do resto do painel — o texto sugerido é o mesmo,
// só o número ganhou a vírgula. O texto gravado no banner usa espaço comum
// (não o espaço "inquebrável" que o Intl coloca depois do "R$").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirMaisOpcoes } from "./helpers/editor-de-banner";

const lista = vi.hoisted(() => ({
  banners: [] as unknown[],
  products: [] as unknown[],
}));
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
  useProducts: () => ({ products: lista.products }),
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

const produto = {
  id: "prod-1234567890",
  name: "Camiseta Azul",
  price: 89.9,
  originalPrice: 120,
  stock: 5,
  category: "Moda",
  images: [],
  freeShipping: false,
  isActive: true,
};

describe("AdminBannersView — preço do produto com vírgula", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    lista.products = [produto];
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

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, ms));
    });
  }

  async function abrirEditorDoBanner(productId: string | undefined) {
    lista.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: productId ? `/product-detail?id=${productId}` : "",
        productId,
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await esperar(0);
    await clicar(
      document.body.querySelector<HTMLElement>('button[title="Editar"]'),
    );
  }

  const textosDosBotoes = () =>
    [...document.body.querySelectorAll("button")].map(
      (b) => b.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );

  it("as sugestões de subtítulo saem com vírgula, com espaço comum depois do R$", async () => {
    await abrirEditorDoBanner("prod-1234567890");

    const botoes = textosDosBotoes();
    expect(botoes).toContain("Por apenas R$ 89,90");
    expect(botoes).toContain("De R$ 120,00 por R$ 89,90");
    expect(botoes.some((t) => /\d\.\d\d/.test(t))).toBe(false);
    // O texto que vai para a vitrine usa espaço comum, não o inquebrável.
    const sugestao = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Por apenas"),
    );
    expect(sugestao?.textContent).toBe("Por apenas R$ 89,90");
  });

  it("o preço do produto já vinculado aparece como R$ 89,90", async () => {
    await abrirEditorDoBanner("prod-1234567890");
    await abrirMaisOpcoes();
    await esperar(600);

    const texto = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("Camiseta Azul");
    expect(texto).toContain("R$ 89,90");
    expect(texto).not.toMatch(/R\$ 89\.90/);
  });

  it("a lista de produtos para vincular mostra R$ 89,90", async () => {
    await abrirEditorDoBanner(undefined);
    await abrirMaisOpcoes();
    await esperar(600);
    await clicar(botao("Abrir Produto"));

    const texto = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("Camiseta Azul");
    expect(texto).toContain("R$ 89,90");
    expect(texto).not.toMatch(/R\$ 89\.90/);
  });
});
