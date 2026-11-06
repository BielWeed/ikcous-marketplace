// @vitest-environment jsdom
//
// Listas para escolher produto no painel (vitrine e banner): o nome saía cortado
// com reticências ("Camiseta algodão premium manga lo…") e a lojista não
// distinguia produtos parecidos. Agora o nome ocupa até 2 linhas
// (`line-clamp-2`) e quebra palavra comprida (`break-words`).
//
// jsdom não calcula layout: a prova é a classe que GERA o efeito (`truncate`
// some, `line-clamp-2 break-words` entra). A largura de 320 px fica para o
// navegador.
import type { Product } from "@/types";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOME_LONGO =
  "Camiseta de algodão premium manga longa gola careca tamanho família edição de colecionador";

const lista = vi.hoisted(() => ({
  banners: [] as unknown[],
  products: [] as unknown[],
}));

vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    Reorder: {
      Group: (props: { children: React.ReactNode }) =>
        createElement("div", null, props.children),
      Item: (props: { children: React.ReactNode }) =>
        createElement("div", null, props.children),
    },
  };
});
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

const produto = {
  id: "p-longo",
  name: NOME_LONGO,
  price: 89.9,
  originalPrice: null,
  stock: 5,
  category: "Moda",
  images: ["https://loja.test/longo.webp"],
  freeShipping: false,
  isActive: true,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  lista.banners = [];
  lista.products = [produto];
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
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const esperar = (ms: number) =>
  act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
  });

/** O elemento mais interno que carrega exatamente o nome. */
const elementoDoNome = (raizDaBusca: ParentNode = document.body) =>
  [...raizDaBusca.querySelectorAll<HTMLElement>("*")].find(
    (el) => el.children.length === 0 && el.textContent?.trim() === NOME_LONGO,
  );

function aceitaDuasLinhas(el: HTMLElement | undefined) {
  expect(el).toBeDefined();
  expect(el?.className).toContain("line-clamp-2");
  expect(el?.className).toContain("break-words");
  expect(el?.className.split(/\s+/)).not.toContain("truncate");
}

describe("lista de produtos da vitrine (FolhaEditarVitrine)", () => {
  it("o nome do produto ocupa até 2 linhas em vez de cortar com reticências", async () => {
    const { FolhaEditarVitrine } = await import(
      "@/components/admin/vitrines/FolhaEditarVitrine"
    );
    await act(async () => {
      raiz.render(
        <FolhaEditarVitrine
          secao={{
            id: "custom_1",
            title: "Kits de presente",
            active: true,
            maxItems: 6,
            productIds: ["p-longo"],
            isCustom: true,
          }}
          posicao={1}
          produtos={[produto as unknown as Product]}
          idsEmExibicao={["p-longo"]}
          aoFechar={() => {}}
          aoRenomear={async () => true}
          aoMudarQuantidade={() => {}}
          aoAlternarProduto={() => {}}
          aoVoltarAoAutomatico={() => {}}
          aoEscolherManualmente={() => {}}
        />,
      );
    });
    aceitaDuasLinhas(elementoDoNome());
  });
});

describe("lista de produtos do banner (AdminBannersView)", () => {
  async function abrirEditorComProdutoEscolhido() {
    lista.banners = [
      {
        id: "banner-1",
        imageUrl: "https://loja.test/banner.webp",
        title: "Campanha",
        link: "/product-detail?id=p-longo",
        productId: "p-longo",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    const { abrirMaisOpcoes } = await import("./helpers/editor-de-banner");
    await act(async () => {
      raiz.render(<AdminBannersView active onNavigate={vi.fn()} />);
    });
    await esperar(0);
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('button[title="Editar"]')!
        .click(),
    );
    await abrirMaisOpcoes();
    await esperar(600);
  }

  it("o produto já escolhido mostra o nome em até 2 linhas", async () => {
    await abrirEditorComProdutoEscolhido();
    const escolhido = [
      ...document.body.querySelectorAll<HTMLElement>("p"),
    ].find((p) => p.textContent?.trim() === NOME_LONGO);
    aceitaDuasLinhas(escolhido);
  });

  it("a lista de busca mostra o nome em até 2 linhas", async () => {
    await abrirEditorComProdutoEscolhido();
    const trocar = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Trocar",
    );
    expect(trocar).toBeTruthy();
    await act(async () => trocar!.click());

    const botaoDoNome = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === NOME_LONGO,
    );
    aceitaDuasLinhas(botaoDoNome);
    // continua com altura de toque de 44 px e deixa o texto encolher
    expect(botaoDoNome?.className).toContain("min-h-11");
    expect(botaoDoNome?.className).toContain("min-w-0");
  });
});
