// @vitest-environment jsdom
//
// A prévia das vitrines no painel mostra EXATAMENTE o que a loja mostra nas
// faixas automáticas (só produto à venda e com foto de verdade) e, quando algo
// ficou de fora, diz por quê numa linha curta ("Ficaram de fora desta faixa:
// 2 esgotados, 1 sem foto"). Sem a linha, a lojista marca um destaque, ele some
// e ela acha que o app quebrou. Vitrine montada à mão mostra o que ela escolheu
// e não leva a linha.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Secao = {
  id: string;
  title: string;
  active: boolean;
  maxItems?: number;
  productIds?: string[];
  isCustom?: boolean;
};

const FOTO = "https://cdn.exemplo/foto.jpg";
const GENERICA = "https://placehold.co/600x400?text=Sem+Imagem";

const produto = (
  id: string,
  nome: string,
  criado: number,
  extras: Record<string, unknown> = {},
) => ({
  id,
  name: nome,
  price: 100,
  category: "Roupas",
  images: [FOTO],
  stock: 5,
  isActive: true,
  isBestseller: false,
  variants: [],
  createdTime: criado,
  ...extras,
});

let PRODUTOS: ReturnType<typeof produto>[] = [];
let configDaLoja: { homeSections?: Secao[] } = {};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, updateConfig: async () => true }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: PRODUTOS }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

describe("Vitrines do painel: prévia igual à loja + 'ficaram de fora'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const montar = async () => {
    await act(async () => {
      raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
    });
  };
  const cartao = (id: string) => {
    const el = hospedeiro.querySelector<HTMLElement>(
      `[data-vitrine-id="${id}"]`,
    );
    if (!el) throw new Error(`sem cartão ${id}`);
    return el;
  };
  const miniaturas = (id: string) =>
    Array.from(
      cartao(id).querySelectorAll<HTMLElement>("[data-miniaturas] [title]"),
    ).map((el) => el.getAttribute("title"));
  const linhaDeFora = (id: string) =>
    cartao(id).querySelector('[data-testid="vitrine-fora-da-faixa"]')
      ?.textContent ?? null;

  const automaticas = (): Secao[] => [
    { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
    { id: "offers", title: "Ofertas Imperdíveis", active: true },
    { id: "bestsellers", title: "Destaques em Alta", active: true },
  ];

  it("Lançamentos: mostra só o que a loja mostra e conta quem ficou de fora, por motivo", async () => {
    PRODUTOS = [
      produto("a", "Alfa", 100),
      produto("b", "Beta esgotado", 900, { stock: 0 }),
      produto("c", "Gama sem foto", 800, { images: [GENERICA] }),
      produto("d", "Delta", 200),
      produto("e", "Epsilon esgotado e sem foto", 700, {
        stock: 0,
        images: [],
      }),
    ];
    configDaLoja = { homeSections: automaticas() };
    await montar();
    expect(miniaturas("new_arrivals")).toEqual(["Delta", "Alfa"]);
    expect(linhaDeFora("new_arrivals")).toBe(
      "Ficaram de fora desta faixa: 2 esgotados, 1 sem foto",
    );
  });

  it("Destaques: o destaque que esgotou some da prévia e a linha explica (singular)", async () => {
    PRODUTOS = [
      produto("x", "Destaque esgotado", 100, { isBestseller: true, stock: 0 }),
      produto("y", "Comum", 200),
    ];
    configDaLoja = { homeSections: automaticas() };
    await montar();
    expect(miniaturas("bestsellers")).toEqual([]);
    expect(cartao("bestsellers").textContent).toContain("Sem produtos");
    expect(linhaDeFora("bestsellers")).toBe(
      "Ficou de fora desta faixa: 1 esgotado",
    );
    // Ofertas não tem candidato: nada de linha
    expect(linhaDeFora("offers")).toBeNull();
  });

  it("sem exclusões, sem linha", async () => {
    PRODUTOS = [produto("a", "Alfa", 100), produto("b", "Beta", 200)];
    configDaLoja = { homeSections: automaticas() };
    await montar();
    expect(miniaturas("new_arrivals")).toEqual(["Beta", "Alfa"]);
    expect(linhaDeFora("new_arrivals")).toBeNull();
  });

  it("vitrine montada à mão mostra o que a lojista escolheu (esgotado e sem foto) e não leva a linha", async () => {
    PRODUTOS = [
      produto("esg", "Esgotado escolhido", 100, { stock: 0 }),
      produto("sf", "Sem foto escolhido", 200, { images: [] }),
      produto("ok", "Normal", 300),
    ];
    configDaLoja = {
      homeSections: [
        {
          id: "custom_1",
          title: "Kits",
          active: true,
          isCustom: true,
          productIds: ["esg", "sf"],
        },
      ],
    };
    await montar();
    expect(miniaturas("custom_1")).toEqual([
      "Esgotado escolhido",
      "Sem foto escolhido",
    ]);
    expect(linhaDeFora("custom_1")).toBeNull();
  });
});
