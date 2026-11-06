// @vitest-environment jsdom
//
// Painel de banners: os botões de "Sugestões do produto" mostravam o nome
// inteiro, mas gravavam `slice(0, 60)` — o campo ficava com um texto diferente
// do botão, cortado no meio de uma palavra (ou de um emoji) sem aviso. Agora o
// botão mostra EXATAMENTE o que vai ser gravado (cortado em letra inteira, com
// "…"), e o título automático ao escolher o produto segue a mesma regra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirMaisOpcoes,
  abrirNovoBannerPelaBarra,
} from "./helpers/editor-de-banner";

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

const NOME_LONGO =
  "Vestido Longo Floral Manga Bufante Tamanho Único Premium Coleção";

const produto = {
  id: "prod-1234567890",
  name: NOME_LONGO,
  price: 89.9,
  stock: 5,
  category: "Moda",
  images: [],
  freeShipping: false,
  isActive: true,
};

describe("AdminBannersView — sugestão do título mostra o que grava", () => {
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

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, ms));
    });
  }

  async function abrirEditorDoBanner() {
    lista.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: `/product-detail?id=${produto.id}`,
        productId: produto.id,
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
    await act(async () => {
      document.body
        .querySelector<HTMLElement>('button[title="Editar"]')
        ?.click();
    });
  }

  const botoes = () =>
    [...document.body.querySelectorAll("button")].map((b) => ({
      el: b,
      texto: b.textContent?.replace(/\s+/g, " ").trim() ?? "",
    }));

  it("o botão 'Confira: <nome>' mostra o texto cortado e grava exatamente esse texto", async () => {
    await abrirEditorDoBanner();
    await abrirMaisOpcoes();

    const sugestao = botoes().find((b) => b.texto.startsWith("Confira: Vest"));
    expect(sugestao, "botão de sugestão").toBeTruthy();
    // O botão não promete o nome inteiro: mostra o que cabe, com "…".
    expect(sugestao!.texto.endsWith("…")).toBe(true);
    expect(sugestao!.texto.length).toBeLessThanOrEqual(60);
    // Não parte a palavra: o último trecho antes do "…" é palavra inteira.
    expect(
      `Confira: ${NOME_LONGO}`.startsWith(sugestao!.texto.slice(0, -1)),
    ).toBe(true);
    expect(`Confira: ${NOME_LONGO}`.charAt(sugestao!.texto.length - 1)).toBe(
      " ",
    );

    await act(async () => sugestao!.el.click());
    const campo =
      document.body.querySelector<HTMLInputElement>("#banner-title");
    expect(campo?.value).toBe(sugestao!.texto);
  });

  it("controle: nome curto aparece inteiro no botão e no campo", async () => {
    lista.products = [{ ...produto, name: "Camiseta Azul" }];
    await abrirEditorDoBanner();
    await abrirMaisOpcoes();
    const sugestao = botoes().find(
      (b) => b.texto === "Destaque: Camiseta Azul",
    );
    expect(sugestao).toBeTruthy();
    await act(async () => sugestao!.el.click());
    const campo =
      document.body.querySelector<HTMLInputElement>("#banner-title");
    expect(campo?.value).toBe("Destaque: Camiseta Azul");
  });

  it("escolher o produto num modelo pronto põe o título cortado em letra inteira, com '…'", async () => {
    lista.banners = [];
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await abrirNovoBannerPelaBarra();
    const clicar = async (texto: string) => {
      const b = botoes().find((x) => x.texto.startsWith(texto));
      expect(b, texto).toBeTruthy();
      await act(async () => b!.el.click());
    };
    await clicar("Modelo pronto");
    await clicar("Destaque");
    await clicar("Usar o modelo Destaque");
    await clicar("Vestido Longo");
    const campo =
      document.body.querySelector<HTMLInputElement>("#banner-title");
    expect(campo, "campo do título").toBeTruthy();
    expect(campo!.value.endsWith("…")).toBe(true);
    expect(campo!.value.length).toBeLessThanOrEqual(60);
    expect(NOME_LONGO.startsWith(campo!.value.slice(0, -1))).toBe(true);
  });
});
