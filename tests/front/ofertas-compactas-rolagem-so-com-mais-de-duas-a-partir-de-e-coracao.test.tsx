// @vitest-environment jsdom
//
// Faixa "Ofertas Compactas" — três bordas sem guarda:
//  1. O carrossel só fica ATIVO (aceita arrastar) com mais de duas ofertas; com
//     uma ou duas, as ofertas cabem na tela e o embla é criado desligado.
//  2. A linha "A partir de" só aparece quando as opções à venda têm preços
//     diferentes; produto sem variação (preço único) não a mostra.
//  3. O coração de cada oferta reflete a lista de favoritos: o produto favoritado
//     oferece "Remover ... dos favoritos", os outros oferecem "Adicionar ...".
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import type { Product } from "@/types";
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: () => {} }),
}));
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: () => {},
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light() {}, medium() {}, heavy() {} },
}));
vi.mock("@/components/LazyImage", () => ({
  LazyImage: ({
    src,
    alt,
    className,
  }: { src: string; alt: string; className: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

const embla = vi.hoisted(() => ({
  selectedScrollSnap: vi.fn(() => 0),
  on: vi.fn(),
  off: vi.fn(),
  scrollNext: vi.fn(),
}));
vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [() => {}, embla]),
}));
import useEmblaCarousel from "embla-carousel-react";

beforeAll(async () => {
  await import("@/components/ui/custom/OfertasCompactas");
}, 60_000);

const produto = (id: string, ajustes: Partial<Product> = {}): Product =>
  ({
    id,
    name: `Produto ${id}`,
    price: 50,
    originalPrice: 100,
    images: [],
    description: "",
    category: "Teste",
    stock: 20,
    isActive: true,
    ...ajustes,
  }) as Product;

let host: HTMLDivElement;
let root: Root;

async function montar(products: Product[], favorites: string[] = []) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
        favorites={favorites}
        layout="compacto"
        onAddToCart={vi.fn()}
        onProductClick={vi.fn()}
        onToggleFavorite={vi.fn()}
        title="Ofertas Imperdíveis"
      />,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Ofertas Compactas — carrossel só com mais de duas ofertas", () => {
  it.each([
    [1, false],
    [2, false],
    [3, true],
    [4, true],
  ])("%i oferta(s): embla ativo = %s", async (quantidade, ativo) => {
    await montar(
      Array.from({ length: quantidade }, (_, i) => produto(`p${i + 1}`)),
    );
    expect(useEmblaCarousel).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: ativo }),
    );
  });
});

describe("Ofertas Compactas — linha 'A partir de'", () => {
  const variante = (value: string, priceOverride: number) => ({
    id: `v-${value}`,
    productId: "com-variacao",
    name: "Tamanho",
    value,
    stockIncrement: 5,
    active: true,
    priceOverride,
  });

  it("some sem variação; aparece quando as opções têm preços diferentes", async () => {
    await montar([produto("simples")]);
    expect(host.textContent).not.toContain("A partir de");

    await montar([
      produto("com-variacao", {
        variants: [variante("P", 40), variante("G", 60)],
      }),
    ]);
    expect(host.textContent).toContain("A partir de");
  });

  it("opções com o MESMO preço também não dizem 'A partir de'", async () => {
    await montar([
      produto("com-variacao", {
        variants: [variante("P", 40), variante("G", 40)],
      }),
    ]);
    expect(host.textContent).not.toContain("A partir de");
  });
});

describe("Ofertas Compactas — coração e favoritos", () => {
  it("o favoritado oferece 'Remover', o outro oferece 'Adicionar'", async () => {
    await montar([produto("a"), produto("b")], ["a"]);
    const rotulos = [...host.querySelectorAll("button[data-botao-favorito]")]
      .map((b) => b.getAttribute("aria-label"))
      .sort();
    expect(rotulos).toEqual([
      "Adicionar Produto b aos favoritos",
      "Remover Produto a dos favoritos",
    ]);
  });
});
