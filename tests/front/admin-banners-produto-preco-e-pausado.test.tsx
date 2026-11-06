// @vitest-environment jsdom
//
// Painel de banners — o produto que o banner anuncia.
//
//  1. PREÇO: o subtítulo "A partir de R$ X" era montado com `product.price`, o
//     preço-base. A vitrine anuncia `precoDeVitrine` (o menor preço entre as
//     opções à venda): produto a 50 com a única variação ativa a 90 gerava
//     banner dizendo R$ 50 e cartão dizendo R$ 90. O banner passa a usar o
//     mesmo preço da vitrine; "A partir de" só quando as opções custam coisas
//     diferentes.
//  2. PAUSADO: o seletor listava produto pausado sem marcar, e o banner ligado
//     a produto pausado leva a cliente à Home ("não está mais disponível").
//     Agora o seletor etiqueta "Pausado" e o cartão/formulário avisam. Só avisa
//     quando ACHA o produto pausado: a lista é paginada, "não achei" não prova
//     que foi excluído.
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

const AVISO_PAUSADO =
  "Este produto está pausado: o toque no banner leva à Home";

const variacao = (
  id: string,
  valor: string,
  priceOverride: number | undefined,
  stockIncrement: number,
) => ({
  id,
  productId: "p-var",
  name: "Tamanho",
  value: valor,
  stockIncrement,
  priceOverride,
  active: true,
});

const produtoSimples = {
  id: "p-simples",
  name: "Camiseta simples",
  price: 89.9,
  originalPrice: null,
  stock: 5,
  category: "Moda",
  images: ["https://loja.test/simples.webp"],
  freeShipping: false,
  isActive: true,
};

// Preço-base 50, única variação ativa com estoque a 90: a vitrine diz R$ 90.
const produtoComVariacao = {
  id: "p-var",
  name: "Camiseta com variação",
  price: 50,
  originalPrice: 120,
  stock: 5,
  category: "Moda",
  images: ["https://loja.test/var.webp"],
  freeShipping: false,
  isActive: true,
  variants: [variacao("v1", "G", 90, 4)],
};

// Duas opções à venda com preços diferentes: a vitrine diz "a partir de".
const produtoComFaixaDePreco = {
  id: "p-faixa",
  name: "Camiseta em faixa",
  price: 50,
  originalPrice: null,
  stock: 5,
  category: "Moda",
  images: ["https://loja.test/faixa.webp"],
  freeShipping: false,
  isActive: true,
  variants: [variacao("f1", "M", 90, 3), variacao("f2", "G", 120, 3)],
};

const produtoPausado = {
  ...produtoSimples,
  id: "p-pausado",
  name: "Camiseta pausada",
  isActive: false,
};

describe("AdminBannersView — produto do banner: preço da vitrine e produto pausado", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    lista.banners = [];
    lista.products = [
      produtoSimples,
      produtoComVariacao,
      produtoComFaixaDePreco,
      produtoPausado,
    ];
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
    vi.spyOn(history, "back").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () =>
      raiz.render(<AdminBannersView active onNavigate={vi.fn()} />),
    );
  }

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, ms));
    });
  }

  async function clicar(texto: string) {
    const botao = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(botao, texto).toBeTruthy();
    await act(async () => botao!.click());
  }

  const textoDaTela = () =>
    (document.body.textContent ?? "").replace(/\s+/g, " ");

  async function escolherProdutoNoModelo(nome: string) {
    await montar();
    await abrirNovoBannerPelaBarra();
    await clicar("Modelo pronto");
    await clicar("Destaque");
    await clicar("Usar o modelo Destaque");
    await clicar(nome);
  }

  const subtitulo = () =>
    document.body.querySelector<HTMLInputElement>("#banner-subtitle")!.value;

  async function editarBannerDo(productId: string, ativo = true) {
    lista.banners = [
      {
        id: "banner-1",
        imageUrl: "https://loja.test/banner.webp",
        title: "Campanha",
        link: `/product-detail?id=${productId}`,
        productId,
        position: "home_top",
        active: ativo,
        order: 1,
      },
    ];
    await montar();
    await esperar(0);
  }

  describe("subtítulo gravado ao escolher o produto", () => {
    it("com variação a 90 e preço-base 50, o subtítulo diz R$ 90,00 (o preço do cartão)", async () => {
      await escolherProdutoNoModelo("Camiseta com variação");
      expect(subtitulo()).toContain("R$ 90,00");
      expect(subtitulo()).not.toContain("R$ 50,00");
      // Uma só opção à venda: não é "a partir de".
      expect(subtitulo()).toBe("Por apenas R$ 90,00");
    });

    it("opções à venda com preços diferentes dizem 'A partir de' o menor", async () => {
      await escolherProdutoNoModelo("Camiseta em faixa");
      expect(subtitulo()).toBe("A partir de R$ 90,00");
    });

    it("produto simples mantém o preço de antes, sem prometer 'a partir de'", async () => {
      await escolherProdutoNoModelo("Camiseta simples");
      expect(subtitulo()).toBe("Por apenas R$ 89,90");
    });
  });

  describe("sugestões de subtítulo e título", () => {
    it("usam o preço e o 'De' da vitrine, não o preço-base", async () => {
      await editarBannerDo("p-var");
      await esperar(0);
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      const botoes = [...document.body.querySelectorAll("button")].map(
        (b) => b.textContent?.replace(/\s+/g, " ").trim() ?? "",
      );
      expect(botoes).toContain("Por apenas R$ 90,00");
      expect(botoes).toContain("De R$ 120,00 por R$ 90,00");
      expect(botoes).toContain("25% OFF em Camiseta com variação");
      expect(botoes).not.toContain("Por apenas R$ 50,00");
    });

    it("desconto que arredonda para 0% (100 -> 99,70) não sugere título '0% OFF', mas o 'De ... por ...' segue verdadeiro", async () => {
      lista.products = [
        ...lista.products,
        {
          ...produtoSimples,
          id: "p-quase",
          name: "Camiseta quase sem desconto",
          price: 99.7,
          originalPrice: 100,
        },
      ];
      await editarBannerDo("p-quase");
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      const botoes = [...document.body.querySelectorAll("button")].map(
        (b) => b.textContent?.replace(/\s+/g, " ").trim() ?? "",
      );
      expect(botoes.some((t) => t.includes("0% OFF"))).toBe(false);
      expect(botoes).toContain("De R$ 100,00 por R$ 99,70");
    });

    it("com opções a 90 e 120, a sugestão diz 'A partir de', igual ao subtítulo automático", async () => {
      await editarBannerDo("p-faixa");
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      const botoes = [...document.body.querySelectorAll("button")].map(
        (b) => b.textContent?.replace(/\s+/g, " ").trim() ?? "",
      );
      expect(botoes).toContain("A partir de R$ 90,00");
      expect(botoes).not.toContain("Por apenas R$ 90,00");
      expect(botoes).not.toContain("Por apenas R$ 50,00");
    });
  });

  describe("preço mostrado no seletor e no produto escolhido", () => {
    async function abrirSeletorDoBannerDo(productId: string) {
      await editarBannerDo(productId);
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      await abrirMaisOpcoes();
      await esperar(600);
    }

    // O Intl põe espaço inquebrável depois do "R$": normaliza para comparar.
    const linha = (nome: string) =>
      [...document.body.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === nome)!
        .closest("div")!
        .textContent!.replace(/\s/g, " ");

    it("a linha da lista mostra o preço da vitrine (R$ 90,00), não o base (R$ 50,00)", async () => {
      await abrirSeletorDoBannerDo("p-simples");
      expect(linha("Camiseta com variação")).toContain("R$ 90,00");
      expect(linha("Camiseta com variação")).not.toContain("R$ 50,00");
      expect(linha("Camiseta em faixa")).toContain("R$ 90,00");
    });

    it("o produto já escolhido mostra o preço da vitrine", async () => {
      await abrirSeletorDoBannerDo("p-var");
      const escolhido = [
        ...document.body.querySelectorAll<HTMLElement>("p"),
      ].find((p) => p.textContent?.includes("foto e link do produto"))!;
      const texto = escolhido.textContent!.replace(/\s/g, " ");
      expect(texto).toContain("R$ 90,00");
      expect(texto).not.toContain("R$ 50,00");
    });
  });

  describe("produto pausado", () => {
    it("o seletor etiqueta 'Pausado' só na linha do produto pausado", async () => {
      lista.banners = [
        {
          id: "banner-1",
          imageUrl: "https://loja.test/banner.webp",
          title: "Campanha",
          link: "",
          position: "home_top",
          active: true,
          order: 1,
        },
      ];
      await montar();
      await esperar(0);
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      await abrirMaisOpcoes();
      await esperar(600);
      await clicar("Abrir Produto");

      const linha = (nome: string) =>
        [...document.body.querySelectorAll("button")]
          .find((b) => b.textContent?.trim() === nome)!
          .closest("div")!;
      expect(linha("Camiseta pausada").textContent).toContain("Pausado");
      expect(linha("Camiseta simples").textContent).not.toContain("Pausado");
    });

    it("o cartão do banner avisa que o toque leva à Home", async () => {
      await editarBannerDo("p-pausado");
      expect(textoDaTela()).toContain(AVISO_PAUSADO);
    });

    it("o formulário de edição avisa também", async () => {
      await editarBannerDo("p-pausado");
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      await abrirMaisOpcoes();
      await esperar(600);
      expect(textoDaTela()).toContain(AVISO_PAUSADO);
    });

    it("produto ativo não mostra aviso nem no cartão nem no formulário", async () => {
      await editarBannerDo("p-simples");
      expect(textoDaTela()).not.toContain(AVISO_PAUSADO);
      await act(async () =>
        document.body
          .querySelector<HTMLButtonElement>('button[title="Editar"]')!
          .click(),
      );
      await abrirMaisOpcoes();
      await esperar(600);
      expect(textoDaTela()).not.toContain(AVISO_PAUSADO);
    });

    it("produto que não está na lista carregada não avisa (a lista é paginada)", async () => {
      await editarBannerDo("p-fora-da-pagina");
      expect(textoDaTela()).not.toContain(AVISO_PAUSADO);
    });
  });
});
