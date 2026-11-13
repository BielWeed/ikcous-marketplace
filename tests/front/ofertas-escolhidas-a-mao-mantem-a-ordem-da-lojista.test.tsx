// @vitest-environment jsdom
//
// O editor de vitrines promete "Aparecem na ordem em que você marcar" quando a
// lojista escolhe os produtos das Ofertas à mão. A faixa, porém, reordenava por
// desconto: marcou A (10%) e depois B (50%), a cliente via B primeiro. Com
// `ordemDaLojista` a ordem escolhida fica (disponível ainda antes de esgotado);
// sem ele (faixa automática) segue maior desconto primeiro, como sempre.
import {
  PremiumOffers,
  ordenarOfertas,
} from "@/components/ui/custom/PremiumOffers";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    { selectedScrollSnap: () => 0, on() {}, off() {}, scrollNext() {} },
  ]),
}));

await import("@/components/ui/custom/OfertasCompactas");
await import("@/components/ui/custom/OfertasLateral");
await import("@/components/ui/custom/OfertasLateralDuplo");

// Preço atual 50: originalPrice 55 = ~9% OFF, 100 = 50% OFF.
const oferta = (id: string, originalPrice: number, stock = 10): Product => ({
  id,
  name: `Produto ${id}`,
  price: 50,
  originalPrice,
  images: [],
  description: "",
  category: "Teste",
  stock,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
});

const ids = (lista: Product[], ordemDaLojista?: boolean) =>
  ordenarOfertas(lista, ordemDaLojista).map((o) => o.product.id);

describe("ordenarOfertas — ordem escolhida pela lojista", () => {
  it("à mão: A (10%) marcado antes de B (50%) continua antes", () => {
    expect(ids([oferta("A", 55), oferta("B", 100)], true)).toEqual(["A", "B"]);
  });

  it("à mão: esgotada continua depois das disponíveis, sem reordenar por desconto", () => {
    expect(
      ids(
        [oferta("esgotada", 200, 0), oferta("A", 55), oferta("B", 100)],
        true,
      ),
    ).toEqual(["A", "B", "esgotada"]);
  });

  it("automática (controle): maior desconto primeiro, como sempre", () => {
    expect(ids([oferta("A", 55), oferta("B", 100)])).toEqual(["B", "A"]);
    expect(ids([oferta("A", 55), oferta("B", 100)], false)).toEqual(["B", "A"]);
  });
});

describe("Faixa de Ofertas na tela — ordem escolhida à mão", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function montar(layout: string, ordemDaLojista?: boolean) {
    await act(async () => {
      root.render(
        <PremiumOffers
          products={[oferta("A", 55), oferta("B", 100)]}
          favorites={[]}
          layout={layout as "compacto"}
          ordemDaLojista={ordemDaLojista}
          onAddToCart={vi.fn()}
          onProductClick={vi.fn()}
          onToggleFavorite={vi.fn()}
          title="Ofertas"
        />,
      );
    });
  }
  const posicao = (nome: string) => (host.textContent ?? "").indexOf(nome);

  it.each(["padrao", "compacto", "lateral", "lateral-duplo"])(
    "%s: a oferta A aparece antes da B quando a lojista escolheu à mão",
    async (layout) => {
      await montar(layout, true);
      expect(posicao("Produto A")).toBeGreaterThanOrEqual(0);
      expect(posicao("Produto B")).toBeGreaterThanOrEqual(0);
      expect(posicao("Produto A")).toBeLessThan(posicao("Produto B"));
    },
  );

  it.each(["padrao", "compacto", "lateral", "lateral-duplo"])(
    "%s: faixa automática segue maior desconto primeiro (B antes de A)",
    async (layout) => {
      await montar(layout);
      expect(posicao("Produto B")).toBeLessThan(posicao("Produto A"));
    },
  );
});
