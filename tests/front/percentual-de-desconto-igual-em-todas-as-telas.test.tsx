// @vitest-environment jsdom
//
// De R$ 40,00 por R$ 31,00 o desconto é 22,5%. O cartão da vitrine fazia
// (40 - 31) / 40 * 100 = 22.5 e mostrava "23% OFF"; a folha de opções fazia
// (1 - 31 / 40) * 100 = 22.499999999999996 e mostrava "-22%". A cliente abria as
// opções e o desconto "diminuía". Agora há UMA conta, em centavos inteiros.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CorpoDaFolhaDeOpcoes,
  FolhaDeOpcoes,
} from "@/components/ui/custom/FolhaDeOpcoes";
import { percentualDeDesconto } from "@/lib/percentual-de-desconto";
import type { Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingFee: 10,
      freeShippingMin: 0,
      enableReviews: false,
      shippingCoverage: "local",
    },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("percentualDeDesconto — a conta em centavos", () => {
  it.each([
    [40, 31, 23], // 900 * 100 / 4000 = 22,5 -> sobe para 23
    [100, 75, 25],
    [39.9, 29.9, 25], // 1000 / 3990 = 25,06% -> 25
    [10, 9.99, 0], // 0,1% -> 0 (o selo some)
    [19.9, 9.95, 50],
  ])("De %s por %s é %s%%", (original, atual, esperado) => {
    expect(percentualDeDesconto(original, atual)).toBe(esperado);
  });

  it("sem desconto de verdade devolve 0, nunca negativo nem NaN", () => {
    expect(percentualDeDesconto(0, 0)).toBe(0);
    expect(percentualDeDesconto(-10, -20)).toBe(0);
    expect(percentualDeDesconto(50, 50)).toBe(0);
    expect(percentualDeDesconto(50, 80)).toBe(0);
    expect(percentualDeDesconto(Number.NaN, 10)).toBe(0);
    expect(percentualDeDesconto(10, Number.NaN)).toBe(0);
    expect(percentualDeDesconto(Number.POSITIVE_INFINITY, 10)).toBe(0);
    expect(percentualDeDesconto(undefined, 10)).toBe(0);
    expect(percentualDeDesconto(null, 10)).toBe(0);
    expect(percentualDeDesconto(10, undefined)).toBe(0);
  });
});

const produto = (price: number, originalPrice: number): Product => ({
  id: "prod-igual",
  name: "Camisa Igual",
  description: "Descrição de teste",
  price,
  originalPrice,
  images: ["https://example.com/img.png"],
  category: "roupas",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
  rating: 4.5,
  reviewCount: 3,
});

// O número do selo, lido do elemento que contém SÓ o selo (o texto corrido do
// cartão cola "31,00" em "23% OFF" e confundiria a leitura).
function seloDe(raizDoTexto: HTMLElement, formato: RegExp): string {
  for (const el of Array.from(raizDoTexto.querySelectorAll("*"))) {
    const achado = formato.exec(el.textContent?.trim() ?? "");
    if (achado) return achado[1];
  }
  return "";
}

describe("o mesmo produto mostra o MESMO desconto no cartão e na folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function textoDoSeloNoCartao(product: Product): Promise<string> {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={product}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          showRating={false}
          layout="card"
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });
    return seloDe(hospedeiro, /^(\d+)% OFF$/);
  }

  async function textoDoSeloNaFolha(product: Product): Promise<string> {
    await act(async () => {
      raiz.render(
        <FolhaDeOpcoes aberta onMudar={() => {}}>
          <CorpoDaFolhaDeOpcoes
            id="f"
            product={product}
            modelo={{ eixos: [] } as never}
            escolhas={new Map()}
            eixoAberto={null}
            aviso={null}
            imagem=""
            preco={product.price}
            estoque={10}
            quantidade={1}
            indisponivel={false}
            cartStatus="idle"
            avisoDeAdicionado=""
            onAbrirEixo={() => {}}
            onEscolher={() => {}}
            onQuantidade={() => {}}
            onAdicionar={() => {}}
            onDetalhes={() => {}}
          />
        </FolhaDeOpcoes>,
      );
    });
    return seloDe(document.body, /^-(\d+)%$/);
  }

  it("De 40,00 por 31,00: 23% nos dois (22,5 arredonda para cima)", async () => {
    const doCartao = await textoDoSeloNoCartao(produto(31, 40));
    act(() => raiz.render(<div />));
    const daFolha = await textoDoSeloNaFolha(produto(31, 40));
    expect(doCartao).toBe("23");
    expect(daFolha).toBe(doCartao);
  });
});
