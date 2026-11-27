// @vitest-environment jsdom
//
// Faixa de Ofertas, nos quatro desenhos (padrão, compacto, lateral e lateral em
// duas fileiras): o que a cliente LÊ nas bordas das regras. Os testes que já
// existiam provam o caso comum (De 100 por 50 = 50% OFF); estes provam onde a
// conta vira de lado:
//  - preço igual ou maior que o "De": nenhum riscado, selo ou economia;
//  - o meio por cento (22,5%) arredonda para cima, igual em todo desenho;
//  - desconto menor que meio por cento não vira selo "0% OFF";
//  - preço zero é 100% OFF;
//  - o aviso de estoque baixo muda exatamente no limite (1, 5/6, 10/11, 0).
// E `ordenarOfertas`: disponível antes de esgotado, maior desconto primeiro,
// empate e vitrine da lojista mantêm a ordem recebida.
import {
  PremiumOffers,
  ordenarOfertas,
} from "@/components/ui/custom/PremiumOffers";
import { formatCurrency, reaisComEspacoComum } from "@/lib/utils";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false, freeShippingMin: 0 } }),
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

// Os desenhos laterais e o compacto são carregados sob demanda: importar antes
// deixa o Suspense resolver dentro do mesmo `act`.
await import("@/components/ui/custom/OfertasCompactas");
await import("@/components/ui/custom/OfertasLateral");
await import("@/components/ui/custom/OfertasLateralDuplo");

const embla = vi.hoisted(() => ({
  selectedScrollSnap: vi.fn(() => 0),
  on: vi.fn(),
  off: vi.fn(),
  scrollNext: vi.fn(),
}));
vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [() => {}, embla]),
}));

type Desenho = "padrao" | "compacto" | "lateral" | "lateral-duplo";
const DESENHOS: Desenho[] = ["padrao", "compacto", "lateral", "lateral-duplo"];

const produto = (id: string, ajustes: Partial<Product> = {}): Product =>
  ({
    id,
    name: `Produto ${id}`,
    price: 50,
    originalPrice: 100,
    images: ["https://exemplo.test/a.png"],
    description: "",
    category: "Teste",
    stock: 20,
    isActive: true,
    freeShipping: false,
    ...ajustes,
  }) as Product;

let host: HTMLDivElement;
let root: Root;

async function montar(products: Product[], layout: Desenho) {
  await act(async () => {
    root.render(
      <PremiumOffers
        products={products}
        favorites={[]}
        layout={layout}
        onAddToCart={() => 1}
        onProductClick={() => {}}
        onToggleFavorite={() => {}}
        title="Ofertas"
      />,
    );
  });
}
const texto = () => host.textContent ?? "";
// O preço grande do desenho compacto usa espaço comum depois do "R$" desde
// 27/11/2026 (só quebra ali); os outros desenhos seguem com o inseparável.
const textoComEspacoComum = () => texto().replace(/\u00a0/g, " ");

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe.each(DESENHOS)(
  "faixa de ofertas (%s) - selo, riscado e economia",
  (desenho) => {
    it.each([
      ["preço igual ao 'De'", 50, 50],
      ["preço MAIOR que o 'De' (promoção vencida)", 80, 50],
      ["sem preço antigo (zero)", 50, 0],
    ])(
      "%s: sem riscado, sem '% OFF' e sem economia",
      async (_nome, preco, antigo) => {
        await montar(
          [produto("a", { price: preco, originalPrice: antigo })],
          desenho,
        );
        expect(textoComEspacoComum()).toContain(reaisComEspacoComum(preco));
        expect(texto()).not.toMatch(/% OFF/);
        expect(texto()).not.toMatch(/De:?\s*R\$/);
        expect(texto()).not.toMatch(/Economiz/);
      },
    );

    it("'De' ausente (null) também não gera selo nem riscado", async () => {
      await montar(
        [produto("a", { originalPrice: null as unknown as undefined })],
        desenho,
      );
      expect(texto()).not.toMatch(/% OFF/);
      expect(texto()).not.toMatch(/De:?\s*R\$/);
    });

    it("o meio por cento arredonda PARA CIMA: De 40 por 31 é 23% OFF (nunca 22%)", async () => {
      await montar([produto("a", { price: 31, originalPrice: 40 })], desenho);
      expect(texto()).toMatch(/23% OFF/);
      expect(texto()).not.toMatch(/22% OFF/);
    });

    it("desconto menor que meio por cento não vira selo '0% OFF'", async () => {
      // De 1000,00 por 996,00 = 0,4%.
      await montar(
        [produto("a", { price: 996, originalPrice: 1000 })],
        desenho,
      );
      expect(texto()).not.toMatch(/\d+% OFF/);
    });

    it("preço zero é 100% OFF e aparece como R$ 0,00", async () => {
      await montar([produto("a", { price: 0, originalPrice: 50 })], desenho);
      expect(texto()).toMatch(/100% OFF/);
      expect(textoComEspacoComum()).toContain(reaisComEspacoComum(0));
    });

    it("desconto real mostra o riscado com o 'De' certo", async () => {
      await montar([produto("a", { price: 50, originalPrice: 100 })], desenho);
      expect(texto()).toMatch(/50% OFF/);
      expect(texto()).toContain(formatCurrency(100));
      expect(texto()).toMatch(/De:?\s*R\$/);
    });
  },
);

// Só estes três escrevem "Economiz..." (o compacto só com UMA oferta, o "largo").
describe.each([
  ["padrao", /Economize R\$\s*50,00/],
  ["compacto", /Economize R\$\s*50,00/],
  ["lateral", /Economiza R\$\s*50,00/],
] as const)(
  "faixa de ofertas (%s) - economia em reais",
  (desenho, esperado) => {
    it("De 100 por 50 diz quanto se economiza, com o valor da diferença", async () => {
      await montar([produto("a")], desenho);
      expect(texto()).toMatch(esperado);
    });

    it("economia é a diferença dos centavos, sem ruído (De 1,13 por 0,22 = R$ 0,91, não 0,90)", async () => {
      // 1,13 - 0,22 dá 0,9099999999999999 em ponto flutuante.
      await montar(
        [produto("a", { price: 0.22, originalPrice: 1.13 })],
        desenho,
      );
      expect(texto()).toContain(formatCurrency(0.91));
    });
  },
);

describe.each(["compacto", "lateral", "lateral-duplo"] as const)(
  "faixa de ofertas (%s) - aviso de estoque no limite",
  (desenho) => {
    it.each([
      [1, "Resta 1!"],
      [2, "Restam 2"],
      [10, "Restam 10"],
    ])("estoque %i mostra '%s'", async (estoque, frase) => {
      await montar([produto("a", { stock: estoque })], desenho);
      expect(texto()).toContain(frase);
    });

    it("estoque 11 já não mostra aviso nenhum", async () => {
      await montar([produto("a", { stock: 11 })], desenho);
      expect(texto()).not.toMatch(/Resta|Esgotado/);
    });

    it("estoque 0 diz 'Esgotado' e não 'Restam 0'", async () => {
      await montar([produto("a", { stock: 0 })], desenho);
      expect(texto()).toContain("Esgotado");
      expect(texto()).not.toMatch(/Resta/);
    });
  },
);

describe("faixa de ofertas (padrao) - aviso de estoque no limite", () => {
  it.each([
    [1, "Só resta 1!"],
    [2, "Apenas 2 restantes"],
    [5, "Apenas 5 restantes"],
  ])("estoque %i mostra '%s'", async (estoque, frase) => {
    await montar([produto("a", { stock: estoque })], "padrao");
    expect(texto()).toContain(frase);
  });

  it("estoque 6 não mostra aviso (60 unidades dizer 'apenas 60' seria falsa escassez)", async () => {
    await montar([produto("a", { stock: 6 })], "padrao");
    expect(texto()).not.toMatch(/restantes|Só resta|Sem estoque/);
  });

  it("estoque 0 diz 'Sem estoque' e o botão 'Esgotado' fica travado", async () => {
    await montar([produto("a", { stock: 0 })], "padrao");
    expect(texto()).toContain("Sem estoque");
    const botao = Array.from(host.querySelectorAll("button")).find((b) =>
      /Esgotado/.test(b.textContent ?? ""),
    );
    expect(botao?.disabled).toBe(true);
  });
});

describe("ordenarOfertas - ordem da faixa", () => {
  const ids = (itens: ReturnType<typeof ordenarOfertas>) =>
    itens.map((i) => i.product.id);

  const pequeno = produto("pequeno", { price: 90, originalPrice: 100 }); // 10%
  const grande = produto("grande", { price: 50, originalPrice: 100 }); // 50%
  const medio = produto("medio", { price: 70, originalPrice: 100 }); // 30%
  const gigante = produto("gigante-esgotado", {
    price: 10,
    originalPrice: 100,
    stock: 0,
  }); // 90%, sem estoque

  it("maior desconto primeiro", () => {
    expect(ids(ordenarOfertas([pequeno, grande, medio]))).toEqual([
      "grande",
      "medio",
      "pequeno",
    ]);
  });

  it("o esgotado vai para o fim mesmo com o maior desconto", () => {
    expect(ids(ordenarOfertas([gigante, pequeno, grande]))).toEqual([
      "grande",
      "pequeno",
      "gigante-esgotado",
    ]);
  });

  it("descontos iguais mantêm a ordem recebida (a que a lojista escolheu)", () => {
    const a = produto("a", { price: 50, originalPrice: 100 });
    const b = produto("b", { price: 25, originalPrice: 50 });
    const c = produto("c", { price: 10, originalPrice: 20 });
    expect(ids(ordenarOfertas([c, a, b]))).toEqual(["c", "a", "b"]);
  });

  it("vitrine escolhida à mão mantém a ordem da lojista, mas o esgotado continua no fim", () => {
    expect(
      ids(ordenarOfertas([pequeno, gigante, grande, medio], true)),
    ).toEqual(["pequeno", "grande", "medio", "gigante-esgotado"]);
  });

  it("faixa que NÃO é de ofertas (lançamentos/destaques) não é reordenada nem pelo estoque", () => {
    expect(
      ids(ordenarOfertas([gigante, pequeno, grande], false, false)),
    ).toEqual(["gigante-esgotado", "pequeno", "grande"]);
  });

  it("o desconto de cada item sai com a mesma conta do selo (sem desconto = 0)", () => {
    const semDesconto = produto("sem", { price: 50, originalPrice: 50 });
    const itens = ordenarOfertas([semDesconto, grande]);
    expect(itens.map((i) => i.discount)).toEqual([50, 0]);
  });
});
