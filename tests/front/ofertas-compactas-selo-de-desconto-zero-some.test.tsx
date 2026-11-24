// @vitest-environment jsdom
//
// Fronteira do selo "% OFF" nas Ofertas Compactas: "De R$ 100,00 por R$ 99,70"
// é um desconto de 0,3%, que arredonda para 0. O "De:" riscado e a economia
// verdadeira ("Economize R$ 0,30") continuam -- são fatos --, mas o selo
// "0% OFF" não pode aparecer. O selo exige `precoAntigo && discount > 0`: sem o
// `discount > 0`, todo "De" com desconto abaixo de meio por cento mostraria
// "0% OFF". Vale para o cartão único (largo) e para o da fileira.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import type { Product } from "@/types";

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
await import("@/components/ui/custom/OfertasCompactas");

const produto = (id: string, ajustes: Partial<Product> = {}): Product =>
  ({
    id,
    name: id,
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

async function montar(products: Product[]) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
        favorites={[]}
        layout="compacto"
        onAddToCart={vi.fn()}
        onProductClick={vi.fn()}
        onToggleFavorite={vi.fn()}
        title="Ofertas Imperdíveis"
      />,
    );
  });
}

// O formatador de moeda usa espaço não separável entre "R$" e o número.
const semEspacoDuro = (texto: string | null) =>
  (texto ?? "").replace(/\u00a0/g, " ");

const cartoes = () =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-oferta-compacta]"));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Ofertas Compactas — selo '% OFF' com desconto que arredonda para 0", () => {
  it("uma oferta (cartão largo): De 100,00 por 99,70 mantém o 'De:' e a economia, sem selo", async () => {
    await montar([produto("única", { price: 99.7, originalPrice: 100 })]);
    const texto = semEspacoDuro(cartoes()[0].textContent);
    expect(texto).toContain("De: R$ 100,00");
    expect(texto).toContain("R$ 99,70");
    expect(texto).toContain("Economize R$ 0,30");
    expect(texto).not.toContain("OFF");
  });

  it("várias ofertas (cartão da fileira): só quem tem desconto de verdade ganha o selo", async () => {
    await montar([
      produto("sem-selo", { price: 99.7, originalPrice: 100 }),
      produto("com-selo", { price: 50, originalPrice: 100 }),
    ]);
    const porNome = (nome: string) =>
      cartoes().find((c) => c.textContent?.includes(nome));
    expect(porNome("sem-selo")?.textContent).not.toContain("OFF");
    expect(porNome("com-selo")?.textContent).toContain("50% OFF");
  });
});
