// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território "estoque na vitrine". Nos três
// desenhos de cartão da faixa de Ofertas (compacto, lateral e lateral em duas
// fileiras) a linha do estoque só aparece com `esgotado || stock <= 10`. O
// teste vizinho (`ofertas-produto-sem-combinacao-aparece-esgotado`) usa um
// produto com soma 5, então tirar o `esgotado ||` da condição passava batido:
// a soma continua <= 10 e a linha aparece de qualquer jeito.
//
// Aqui o produto tem Cor com 15 peças no total e Tamanho todo zerado (nenhuma
// combinação se compra). A soma é 15, ACIMA do limite de 10: só a regra de
// "esgotado" pode acender a linha vermelha "Esgotado" do estoque. E o produto
// comprável com a mesma soma continua sem linha de estoque nenhuma.
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import type { Product, ProductVariant } from "@/types";
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

const opcao = (
  grupo: string,
  valor: string,
  estoque: number,
): ProductVariant => ({
  id: `${grupo}-${valor}`,
  productId: "p",
  name: grupo,
  value: valor,
  stockIncrement: estoque,
  active: true,
});

const produto = (variants: ProductVariant[]): Product => ({
  id: "Camiseta",
  name: "Camiseta",
  price: 50,
  originalPrice: 100,
  images: [],
  description: "",
  category: "Teste",
  stock: 15,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants,
});

/** Cor soma 15, Tamanho inteiro zerado: nenhuma combinação se compra. */
const semCombinacaoComMuitoEstoque = () =>
  produto([
    opcao("Cor", "Azul", 8),
    opcao("Cor", "Preto", 7),
    opcao("Tamanho", "P", 0),
    opcao("Tamanho", "M", 0),
  ]);

/** Mesma soma (15), mas Tamanho P tem peças: dá para comprar. */
const comCombinacaoEMuitoEstoque = () =>
  produto([
    opcao("Cor", "Azul", 8),
    opcao("Cor", "Preto", 7),
    opcao("Tamanho", "P", 4),
    opcao("Tamanho", "M", 0),
  ]);

let host: HTMLDivElement;
let root: Root;

async function montar(p: Product, layout: string) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={[p]}
        favorites={[]}
        layout={layout as "compacto"}
        onAddToCart={vi.fn()}
        onProductClick={vi.fn()}
        onToggleFavorite={vi.fn()}
        title="Ofertas"
      />,
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const LAYOUTS = ["compacto", "lateral", "lateral-duplo"];

/** A linha do estoque do cartão: o span vermelho que diz "Esgotado". */
const linhaDeEsgotado = () =>
  Array.from(host.querySelectorAll("span")).filter(
    (s) => s.textContent === "Esgotado" && s.classList.contains("text-red-800"),
  );

describe("Faixa de Ofertas — esgotado por falta de combinação com soma acima de 10", () => {
  it.each(LAYOUTS)(
    "%s: a linha do estoque diz 'Esgotado' mesmo com 15 peças somadas",
    async (layout) => {
      await montar(semCombinacaoComMuitoEstoque(), layout);
      expect(linhaDeEsgotado()).toHaveLength(1);
      expect(host.textContent).not.toMatch(/Restam/);
    },
  );

  it.each(LAYOUTS)(
    "%s: comprável com 15 peças somadas não tem linha de estoque",
    async (layout) => {
      await montar(comCombinacaoEMuitoEstoque(), layout);
      expect(linhaDeEsgotado()).toHaveLength(0);
      expect(host.textContent).not.toMatch(/Restam|Resta 1|Esgotado/);
    },
  );
});
