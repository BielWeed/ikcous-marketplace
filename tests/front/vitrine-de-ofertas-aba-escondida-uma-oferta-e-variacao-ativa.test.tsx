// @vitest-environment jsdom
//
// Vitrine "Ofertas Imperdíveis" — três bordas que nenhum teste vigiava:
//  1. Aba do navegador escondida: a vitrine NÃO gira sozinha (já escondida na
//     hora de abrir, ou escondida depois); ao voltar, volta a girar.
//  2. Com UMA só oferta não há bolinhas de navegação nem giro automático ("Ver oferta 1" não
//     existe); com duas, existem.
//  3. Produto com variação ativa: o botão principal vira "Escolher opções" e só
//     ABRE o produto — não pode pôr nada no carrinho sem a escolha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Product } from "@/types";

// O MESMO objeto em toda renderização, como o embla de verdade: um objeto novo
// a cada render reiniciaria o relógio da vitrine a cada mudança de estado e
// esconderia o que este teste mede (a contagem recomeça ao voltar a aba).
const { scrollNext, emblaApi } = vi.hoisted(() => {
  const scrollNext = vi.fn();
  return {
    scrollNext,
    emblaApi: {
      scrollNext,
      scrollTo: vi.fn(),
      selectedScrollSnap: () => 0,
      on: () => {},
      off: () => {},
    },
  };
});
vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, emblaApi],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false, freeShippingMin: 0 } }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function produto(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "d",
    price: 80,
    originalPrice: 100,
    images: ["https://example.com/img.png"],
    category: "geral",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    rating: 4.5,
    reviewCount: 12,
    ...extra,
  };
}

function abaEscondida(escondida: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => escondida,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeAll(async () => {
  await import("@/components/ui/custom/PremiumOffers");
}, 60_000);

beforeEach(() => {
  vi.useFakeTimers();
  scrollNext.mockClear();
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: false,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  abaEscondida(false);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  abaEscondida(false);
});

async function montar(
  produtos: Product[],
  acoes: {
    onProductClick?: (id: string) => void;
    onAddToCart?: (p: Product) => unknown;
  } = {},
) {
  const { PremiumOffers } = await import(
    "@/components/ui/custom/PremiumOffers"
  );
  await act(async () => {
    raiz.render(
      <PremiumOffers
        products={produtos}
        favorites={[]}
        onToggleFavorite={() => {}}
        onProductClick={acoes.onProductClick ?? (() => {})}
        onAddToCart={acoes.onAddToCart}
      />,
    );
  });
}

const avancar = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

describe("vitrine de ofertas — aba escondida", () => {
  it("escondida DEPOIS de abrir: para de girar; ao voltar, gira de novo", async () => {
    await montar([produto("a"), produto("b")]);
    await avancar(6100);
    expect(scrollNext).toHaveBeenCalledTimes(1);

    await act(async () => {
      abaEscondida(true);
    });
    // 35,4 s escondida: termina a 0,5 s do próximo "tique" do relógio antigo.
    await avancar(35400);
    expect(scrollNext).toHaveBeenCalledTimes(1);

    await act(async () => {
      abaEscondida(false);
    });
    // Ao voltar, a contagem de 6 s recomeça do zero (não aproveita o relógio
    // que ficou rodando por baixo): 1 s depois ainda não girou.
    await avancar(1000);
    expect(scrollNext).toHaveBeenCalledTimes(1);
    await avancar(5100);
    expect(scrollNext).toHaveBeenCalledTimes(2);
  });

  it("já escondida na hora de abrir: nem começa a girar", async () => {
    abaEscondida(true);
    await montar([produto("a"), produto("b")]);
    await avancar(30000);
    expect(scrollNext).not.toHaveBeenCalled();
  });
});

describe("vitrine de ofertas — bolinhas de navegação", () => {
  it("uma só oferta não gira sozinha (nada a trocar); duas giram", async () => {
    await montar([produto("a")]);
    await avancar(30_000);
    expect(scrollNext).not.toHaveBeenCalled();

    await montar([produto("a"), produto("b")]);
    await avancar(6_100);
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("uma só oferta: nenhuma bolinha; duas: uma por oferta", async () => {
    await montar([produto("a")]);
    expect(hospedeiro.querySelector('[aria-label^="Ver oferta"]')).toBeNull();

    await montar([produto("a"), produto("b")]);
    const rotulos = [
      ...hospedeiro.querySelectorAll('[aria-label^="Ver oferta"]'),
    ].map((b) => b.getAttribute("aria-label"));
    expect(rotulos).toEqual(["Ver oferta 1", "Ver oferta 2"]);
  });
});

describe("vitrine de ofertas — produto com variação ativa", () => {
  const variantes = [
    {
      id: "var-p",
      productId: "camiseta",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
  ];
  const botaoPrincipal = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      /Escolher opções|Adicionar/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;

  it("com variação ativa: o clique só abre o produto, nada entra no carrinho", async () => {
    const abrir = vi.fn();
    const adicionar = vi.fn();
    await montar([produto("camiseta", { variants: variantes })], {
      onProductClick: abrir,
      onAddToCart: adicionar,
    });
    expect(botaoPrincipal().textContent).toContain("Escolher opções");

    await act(async () => {
      botaoPrincipal().click();
    });
    expect(abrir).toHaveBeenCalledExactlyOnceWith("camiseta");
    expect(adicionar).not.toHaveBeenCalled();
    // E o botão não entrou em "Adicionando...".
    await avancar(700);
    expect(botaoPrincipal().textContent).toContain("Escolher opções");
  });

  it("sem variação: o clique adiciona ao carrinho e não abre o produto", async () => {
    const abrir = vi.fn();
    const adicionar = vi.fn(() => 1);
    await montar([produto("caneca")], {
      onProductClick: abrir,
      onAddToCart: adicionar,
    });
    expect(botaoPrincipal().textContent).toContain("Adicionar");

    await act(async () => {
      botaoPrincipal().click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe("vitrine de ofertas — botões do card", () => {
  const botaoPorTexto = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(texto),
    ) as HTMLButtonElement;

  it("tocar em 'Adicionar' ou no nome abre/adiciona UMA vez (o toque não vaza para o card)", async () => {
    const abrir = vi.fn();
    const adicionar = vi.fn(() => 1);
    await montar([produto("caneca")], {
      onProductClick: abrir,
      onAddToCart: adicionar,
    });

    await act(async () => {
      botaoPorTexto("Adicionar").click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(abrir).not.toHaveBeenCalled();

    await act(async () => {
      botaoPorTexto("Produto caneca").click();
    });
    expect(abrir).toHaveBeenCalledExactlyOnceWith("caneca");
  });

  it("segundo toque em 'Adicionar' com o primeiro ainda em andamento não adiciona de novo", async () => {
    const adicionar = vi.fn(() => 1);
    await montar([produto("caneca")], { onAddToCart: adicionar });

    await act(async () => {
      botaoPorTexto("Adicionar").click();
    });
    expect(botaoPorTexto("Adicionando").textContent).toContain("Adicionando");
    await act(async () => {
      botaoPorTexto("Adicionando").click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
  });

  it("o 'Adicionado!' volta para 'Adicionar' 1,5 s depois de aparecer", async () => {
    await montar([produto("caneca")], { onAddToCart: () => 1 });
    await act(async () => {
      botaoPorTexto("Adicionar").click();
    });
    await avancar(599);
    expect(botaoPorTexto("Adicionando")).toBeTruthy();
    await avancar(1);
    expect(botaoPorTexto("Adicionado!")).toBeTruthy();
    await avancar(1_499);
    expect(botaoPorTexto("Adicionado!")).toBeTruthy();
    await avancar(1);
    expect(botaoPorTexto("Adicionar")).toBeTruthy();
    expect(hospedeiro.textContent).not.toContain("Adicionado!");
  });

  it("produto esgotado: 'Esgotado' e 'Comprar' ficam desativados e 'Comprar' não compra", async () => {
    const comprar = vi.fn();
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto("sumiu", { stock: 0 })]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onQuickBuy={comprar}
        />,
      );
    });
    expect(botaoPorTexto("Esgotado").disabled).toBe(true);
    expect(botaoPorTexto("Comprar").disabled).toBe(true);
    await act(async () => {
      botaoPorTexto("Comprar").click();
    });
    expect(comprar).not.toHaveBeenCalled();
  });
});
