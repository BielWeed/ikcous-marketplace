// @vitest-environment jsdom
//
// Ofertas "Lateral em duas fileiras": quando as opções à venda custam coisas
// diferentes, o cartão anuncia o MENOR preço e a linha de baixo diz "A partir
// de" NO LUGAR do "De R$ ..." riscado (o "De" valia para o preço-base, não para
// a opção mais barata). Sem esse desvio o cartão mostraria "De R$ 120,00" ao
// lado de um "R$ 50,00" que é só o piso de uma faixa de preços.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import type { Product, ProductVariant } from "@/types";

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
vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [
    () => {},
    {
      selectedScrollSnap: () => 0,
      on: () => {},
      off: () => {},
      scrollNext: () => {},
    },
  ]),
}));

// A faixa carrega o desenho sob demanda: importar antes evita o esqueleto.
await import("@/components/ui/custom/OfertasLateralDuplo");

const opcao = (valor: string, priceOverride?: number): ProductVariant => ({
  id: valor,
  productId: "p-duplo",
  name: "Tamanho",
  value: valor,
  stockIncrement: 5,
  priceOverride,
  active: true,
});

const produto = (id: string, ajustes: Partial<Product> = {}): Product =>
  ({
    id,
    name: id,
    price: 50,
    originalPrice: 120,
    images: ["https://exemplo.test/a.png"],
    description: "",
    category: "Teste",
    stock: 20,
    isActive: true,
    ...ajustes,
  }) as Product;

let host: HTMLDivElement;
let root: Root;

async function montar(products: Product[]) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
        favorites={[]}
        layout="lateral-duplo"
        onAddToCart={vi.fn()}
        onProductClick={vi.fn()}
        onToggleFavorite={vi.fn()}
        title="Ofertas Imperdíveis"
      />,
    );
  });
}

const cartao = (id: string) =>
  Array.from(
    host.querySelectorAll<HTMLElement>("[data-oferta-lateral-duplo]"),
  ).find((c) => c.dataset.ofertaLateralDuplo === id) as HTMLElement;

// O formatador de moeda usa espaço não separável entre "R$" e o número.
const semEspacoDuro = (texto: string | null) =>
  (texto ?? "").replace(/\u00a0/g, " ");

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Ofertas Lateral em duas fileiras — 'A partir de' no lugar do 'De'", () => {
  it("opções a R$ 50 e R$ 100: o preço é o menor, a linha de baixo diz 'A partir de' e não há 'De R$'", async () => {
    await montar([
      produto("faixa", { variants: [opcao("P"), opcao("G", 100)] }),
      produto("simples"),
    ]);

    const texto = semEspacoDuro(cartao("faixa").textContent);
    expect(texto).toContain("R$ 50,00");
    expect(texto).toContain("A partir de");
    expect(texto).not.toContain("De R$");
  });

  it("uma só faixa de preço (as duas opções a R$ 50): sem 'A partir de', e o 'De R$ 120,00' volta", async () => {
    await montar([
      produto("igual", { variants: [opcao("P"), opcao("G", 50)] }),
      produto("simples"),
    ]);

    const texto = semEspacoDuro(cartao("igual").textContent);
    expect(texto).not.toContain("A partir de");
    expect(texto).toContain("De R$ 120,00");
  });
});
