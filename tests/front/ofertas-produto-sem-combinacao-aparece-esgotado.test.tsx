// @vitest-environment jsdom
//
// Faixa de Ofertas da vitrine: produto com Cor e Tamanho em que UM dos grupos
// está todo zerado (Cor: Azul 3 + Preto 2; Tamanho: P 0 + M 0) não tem
// combinação possível, mas `product.stock` é a soma das opções (5). A grade do
// catálogo já diz "Esgotado" (`produtoDisponivel`); as quatro variantes de
// cartão da faixa e a ordenação olhavam só `stock` e mostravam o produto como
// comprável ("Restam 5", botão ligado), podendo até abrir a faixa.
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import { ordenarOfertas } from "@/components/ui/custom/PremiumOffers";
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

/** Cor tem estoque, Tamanho inteiro zerado: soma 5, nenhuma combinação. */
const semCombinacao = (id = "Camiseta") =>
  produto(id, {
    stock: 5,
    variants: [
      opcao("Cor", "Azul", 3),
      opcao("Cor", "Preto", 2),
      opcao("Tamanho", "P", 0),
      opcao("Tamanho", "M", 0),
    ],
  });

/** Mesmo produto, mas com uma escolha de CADA grupo: dá para comprar. */
const comCombinacao = (id = "Camiseta") =>
  produto(id, {
    stock: 5,
    variants: [
      opcao("Cor", "Azul", 3),
      opcao("Cor", "Preto", 2),
      opcao("Tamanho", "P", 4),
      opcao("Tamanho", "M", 0),
    ],
  });

let host: HTMLDivElement;
let root: Root;

async function montar(products: Product[], layout: string) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
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

const botoes = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
/** O botão de compra principal, em qualquer das quatro variantes. */
const botaoDeCompra = () =>
  botoes().find((b) => {
    const rotulo = `${b.textContent?.trim()}|${b.getAttribute("aria-label")}`;
    return (
      !/favorito/i.test(rotulo) && /Esgotado|Escolher op|Adicionar/.test(rotulo)
    );
  });

const LAYOUTS = ["compacto", "lateral", "lateral-duplo", "padrao"];

describe("Faixa de Ofertas — produto sem combinação possível", () => {
  it.each(LAYOUTS)(
    "%s: aparece como esgotado, sem 'restantes' e com o botão desligado",
    async (layout) => {
      await montar([semCombinacao()], layout);
      const texto = host.textContent ?? "";
      expect(texto).toMatch(/Esgotado|Sem estoque/);
      expect(texto).not.toMatch(/Restam|Resta 1|Apenas|restantes/);
      const botao = botaoDeCompra();
      expect(botao).toBeDefined();
      expect(botao?.disabled).toBe(true);
      expect(
        `${botao?.textContent}|${botao?.getAttribute("aria-label")}`,
      ).toMatch(/Esgotado/);
      expect(texto).not.toMatch(/Escolher op/);
    },
  );

  it.each(LAYOUTS)(
    "%s: com uma escolha em cada grupo continua comprável, com o aviso de pouco estoque",
    async (layout) => {
      await montar([comCombinacao()], layout);
      const texto = host.textContent ?? "";
      expect(texto).not.toMatch(/Esgotado|Sem estoque/);
      expect(texto).toMatch(/Restam 5|Apenas 5 restantes/);
      const botao = botaoDeCompra();
      expect(botao?.disabled).toBe(false);
      expect(
        `${botao?.textContent}|${botao?.getAttribute("aria-label")}`,
      ).toMatch(/Escolher op/);
    },
  );

  it("a ordem da faixa não devolve o sem-combinação ao grupo dos compráveis", () => {
    // O sem-combinação tem o MAIOR desconto: antes virava o cartão de destaque.
    const esgotado = semCombinacao("sem-combinacao");
    esgotado.originalPrice = 200;
    const comprável = produto("comprável", { originalPrice: 60 });
    const [primeiro, segundo] = ordenarOfertas([esgotado, comprável]);
    expect(primeiro?.product.id).toBe("comprável");
    expect(segundo?.product.id).toBe("sem-combinacao");
  });

  it("sem opções, estoque zero continua esgotado e estoque positivo continua comprável", () => {
    const ordem = ordenarOfertas([
      produto("zero", { stock: 0, originalPrice: 500 }),
      produto("tem", { stock: 3 }),
    ]).map((o) => o.product.id);
    expect(ordem).toEqual(["tem", "zero"]);
  });
});
