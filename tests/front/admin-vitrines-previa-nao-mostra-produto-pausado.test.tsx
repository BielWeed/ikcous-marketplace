// @vitest-environment jsdom
//
// A lojista pausa um produto e a loja o esconde de todas as vitrines. A prévia
// do painel de Vitrines tem de esconder também: se ela mostrar o pausado, a
// lojista monta a vitrine olhando uma ordem e uma quantidade que a cliente
// nunca vê (e, numa faixa automática, o pausado ainda tomaria o lugar de um
// produto à venda no corte do "máximo"). O filtro mora em `produtosAVenda`,
// que só a prévia usa fora da Home: sem este teste, tirá-lo não derrubava nada.
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
  images: ["https://cdn.exemplo/foto.jpg"],
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

describe("Vitrines do painel: produto pausado fica fora da prévia", () => {
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

  it("faixa automática: o pausado mais novo não aparece, não ocupa vaga e não vira 'ficou de fora'", async () => {
    PRODUTOS = [
      produto("a", "Alfa", 100),
      produto("p", "Pausado novo", 900, { isActive: false }),
      produto("b", "Beta", 200),
    ];
    configDaLoja = {
      homeSections: [
        { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
      ],
    };
    await montar();
    expect(miniaturas("new_arrivals")).toEqual(["Beta", "Alfa"]);
    expect(linhaDeFora("new_arrivals")).toBeNull();
  });

  it("destaque pausado some da faixa de Destaques, sem aviso de esgotado", async () => {
    PRODUTOS = [
      produto("d", "Destaque pausado", 500, {
        isBestseller: true,
        isActive: false,
      }),
      produto("ok", "Destaque normal", 100, { isBestseller: true }),
    ];
    configDaLoja = {
      homeSections: [
        { id: "bestsellers", title: "Destaques em Alta", active: true },
      ],
    };
    await montar();
    expect(miniaturas("bestsellers")).toEqual(["Destaque normal"]);
    expect(linhaDeFora("bestsellers")).toBeNull();
  });

  it("vitrine montada à mão: o pausado que a lojista tinha escolhido não aparece na prévia", async () => {
    PRODUTOS = [
      produto("p", "Pausado escolhido", 100, { isActive: false }),
      produto("ok", "Normal escolhido", 200),
    ];
    configDaLoja = {
      homeSections: [
        {
          id: "custom_1",
          title: "Kits",
          active: true,
          isCustom: true,
          productIds: ["p", "ok"],
        },
      ],
    };
    await montar();
    expect(miniaturas("custom_1")).toEqual(["Normal escolhido"]);
  });
});
