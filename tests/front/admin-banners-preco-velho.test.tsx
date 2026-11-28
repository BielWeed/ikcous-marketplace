// @vitest-environment jsdom
//
// Painel de banners — banner com preço velho (lote-581).
//
// O subtítulo "Por apenas R$ 70,00" e o título "30% OFF em Vestido" nascem com
// o preço do momento em que a lojista escolheu o produto. A promoção acaba, o
// preço volta e o banner segue anunciando o valor antigo (oferta anunciada,
// CDC art. 30). O cartão do banner passa a avisar, no mesmo lugar do aviso de
// produto pausado; o texto continua sendo da lojista.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    deleteStorageFile: vi.fn().mockResolvedValue(undefined),
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

const FIM_DO_AVISO = "Atualize o texto ou desligue o banner.";

const vestido = {
  id: "p-vestido",
  name: "Vestido",
  price: 100,
  originalPrice: null as number | null,
  stock: 5,
  category: "Moda",
  images: ["https://loja.test/vestido.webp"],
  freeShipping: false,
  isActive: true,
};

const variacao = (id: string, valor: string, priceOverride: number) => ({
  id,
  productId: "p-faixa",
  name: "Tamanho",
  value: valor,
  stockIncrement: 3,
  priceOverride,
  active: true,
});

// Opções à venda a 90 e 120: a vitrine diz "a partir de R$ 90,00".
const vestidoEmFaixa = {
  ...vestido,
  id: "p-faixa",
  name: "Vestido em faixa",
  price: 50,
  variants: [variacao("f1", "M", 90), variacao("f2", "G", 120)],
};

describe("AdminBannersView — banner que anuncia preço diferente do produto", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    lista.banners = [];
    lista.products = [vestido, vestidoEmFaixa];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarBanner(campos: {
    title?: string | null;
    subtitle?: string;
    link?: string;
    active?: boolean;
  }) {
    lista.banners = [
      {
        id: "banner-1",
        imageUrl: "https://loja.test/banner.webp",
        title: "Campanha",
        link: "/product-detail?id=p-vestido",
        position: "home_top",
        active: true,
        order: 1,
        ...campos,
      },
    ];
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      raiz.render(<AdminBannersView active onNavigate={vi.fn()} />),
    );
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }

  const textoDaTela = () =>
    (document.body.textContent ?? "").replace(/\s+/g, " ");

  it("a promoção acabou: o subtítulo diz R$ 70,00 e o produto custa R$ 100,00", async () => {
    await montarBanner({ subtitle: "Por apenas R$ 70,00" });
    expect(textoDaTela()).toContain(
      "Este banner anuncia R$ 70,00, mas o produto custa R$ 100,00 agora. Atualize o texto ou desligue o banner.",
    );
  });

  it("o '30% OFF' do título sobrou num produto sem desconto", async () => {
    await montarBanner({ title: "30% OFF em Vestido" });
    expect(textoDaTela()).toContain(
      "Este banner anuncia 30% OFF, mas o produto está sem desconto agora. Atualize o texto ou desligue o banner.",
    );
  });

  it("o percentual mudou: anuncia 30%, a vitrine dá 20%", async () => {
    lista.products = [{ ...vestido, price: 80, originalPrice: 100 }];
    await montarBanner({ title: "30% OFF em Vestido" });
    expect(textoDaTela()).toContain(
      "Este banner anuncia 30% OFF, mas o desconto do produto é 20% agora.",
    );
  });

  it("opções com preços diferentes: o aviso diz 'a partir de'", async () => {
    await montarBanner({
      subtitle: "Por apenas R$ 50,00",
      link: "/product-detail?id=p-faixa",
    });
    expect(textoDaTela()).toContain(
      "Este banner anuncia R$ 50,00, mas o produto custa a partir de R$ 90,00 agora.",
    );
  });

  it("banner desligado avisa também, como o aviso de produto pausado", async () => {
    await montarBanner({ subtitle: "Por apenas R$ 70,00", active: false });
    expect(textoDaTela()).toContain("Este banner anuncia R$ 70,00");
  });

  it.each([
    ["texto que bate com o preço", { subtitle: "Por apenas R$ 100,00" }],
    [
      "preço de outra opção ligada",
      { subtitle: "Por R$ 120,00", link: "/product-detail?id=p-faixa" },
    ],
    ["texto sem valor", { subtitle: "Confira essa oferta especial!" }],
    [
      "produto fora da lista carregada (paginada)",
      { subtitle: "Por R$ 70,00", link: "/product-detail?id=p-fora" },
    ],
    ["banner sem produto", { subtitle: "Por R$ 70,00", link: "/ofertas" }],
  ])("não avisa: %s", async (_, campos) => {
    await montarBanner(campos);
    expect(textoDaTela()).toContain("Campanha");
    expect(textoDaTela()).not.toContain(FIM_DO_AVISO);
  });
});
