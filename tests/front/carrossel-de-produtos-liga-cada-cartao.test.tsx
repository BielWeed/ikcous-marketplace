// @vitest-environment jsdom
//
// O carrossel de produtos da Home (Lançamentos, Destaques e vitrines próprias)
// liga cada cartão à tela: favorito marcado, toque, "Comprar", opções e a
// medição das setas de rolagem. Os testes de setas só cobriam o meio do
// caminho (rolou 400 de 1400); aqui vão as bordas e a fiação dos cartões:
//   - lista vazia não desenha nada (nem o título);
//   - seta de voltar só passa de 10px rolados; seta de avançar some a menos de
//     10px do fim (e some EXATAMENTE nos 10px);
//   - a lista que cresce com a faixa montada ganha a seta de avançar;
//   - a mudança de largura da faixa (girar o aparelho) reavalia as setas;
//   - favorito, toque, comprar, comprar por opções (com a quantidade) e
//     compra rápida chegam à tela, e quem não passa `onAddToCartWithVariants`
//     deixa o cartão no modo "ir para o produto".
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductCarousel } from "@/components/ui/custom/ProductCarousel";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cenario = vi.hoisted(() => ({
  config: { enableReviews: true } as Record<string, unknown>,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: cenario.config }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

interface PropsDoCartao {
  product: Product;
  isFavorite: boolean;
  showRating?: boolean;
  onToggleFavorite: (product: Product) => void;
  onClick: (id: string) => void;
  onAddToCart?: (product: Product) => unknown;
  onQuickBuy?: (product: Product) => void;
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
    quantity?: number,
  ) => unknown;
}

// O cartão vira uma marca com os botões que chamam o que a faixa lhe deu.
const devolvido = vi.hoisted(() => ({ valores: [] as unknown[] }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: (p: PropsDoCartao) => (
    <article
      data-cartao={p.product.id}
      data-favorito={String(p.isFavorite)}
      data-avaliacao={String(p.showRating)}
      data-modo-opcoes={String(Boolean(p.onAddToCartWithVariants))}
    >
      <button type="button" onClick={() => p.onClick(p.product.id)}>
        abrir {p.product.id}
      </button>
      <button type="button" onClick={() => p.onToggleFavorite(p.product)}>
        favoritar {p.product.id}
      </button>
      <button
        type="button"
        onClick={() => devolvido.valores.push(p.onAddToCart?.(p.product))}
      >
        comprar {p.product.id}
      </button>
      <button type="button" onClick={() => p.onQuickBuy?.(p.product)}>
        rapida {p.product.id}
      </button>
      <button
        type="button"
        onClick={() =>
          devolvido.valores.push(
            p.onAddToCartWithVariants?.(p.product, "v1", "Azul / M", 3),
          )
        }
      >
        opcoes {p.product.id}
      </button>
    </article>
  ),
}));

const produto = (id: string) => ({ id, name: `Produto ${id}` }) as Product;
const A = produto("a");
const B = produto("b");

let ultimaFaixaObservada: {
  callback: () => void;
  desligou: number;
  alvos: Element[];
} | null = null;

describe("ProductCarousel — fiação dos cartões e medição das setas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let medidas: { clientWidth: number; scrollWidth: number; scrollLeft: number };

  beforeEach(() => {
    cenario.config = { enableReviews: true };
    devolvido.valores = [];
    ultimaFaixaObservada = null;
    medidas = { clientWidth: 600, scrollWidth: 1400, scrollLeft: 0 };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly estado = {
          callback: () => {},
          desligou: 0,
          alvos: [] as Element[],
        };
        constructor(callback: () => void) {
          this.estado.callback = callback;
          ultimaFaixaObservada = this.estado;
        }
        observe(alvo: Element) {
          this.estado.alvos.push(alvo);
        }
        disconnect() {
          this.estado.desligou += 1;
        }
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function monta(
    produtos: Product[],
    extras: Partial<Parameters<typeof ProductCarousel>[0]> = {},
  ) {
    act(() =>
      raiz.render(
        <ProductCarousel
          title="Novidades"
          products={produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          {...extras}
        />,
      ),
    );
    // A faixa só existe com produtos; as medidas vêm de `medidas` a cada leitura.
    const faixa = hospedeiro.querySelector<HTMLDivElement>(".overflow-x-auto");
    if (faixa && !Object.getOwnPropertyDescriptor(faixa, "scrollWidth")) {
      Object.defineProperties(faixa, {
        clientWidth: { configurable: true, get: () => medidas.clientWidth },
        scrollWidth: { configurable: true, get: () => medidas.scrollWidth },
        scrollLeft: { configurable: true, get: () => medidas.scrollLeft },
      });
      // Reavalia com as medidas já definidas (o efeito rodou antes delas).
      act(() => {
        faixa.dispatchEvent(new Event("scroll"));
      });
    }
    return faixa;
  }

  const seta = (nome: string) =>
    hospedeiro.querySelector(`button[aria-label="${nome}"]`);
  const botao = (texto: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === texto,
    ) as HTMLButtonElement;
  const clicar = (texto: string) => {
    act(() => botao(texto).click());
  };
  function rolarPara(faixa: HTMLDivElement | null, left: number) {
    medidas.scrollLeft = left;
    act(() => {
      faixa?.dispatchEvent(new Event("scroll"));
    });
  }

  describe("lista e título", () => {
    it("lista vazia não desenha nada, nem o título", () => {
      monta([], { subtitle: "Só hoje" });
      expect(hospedeiro.innerHTML).toBe("");
    });

    it("com produtos desenha o título e um cartão por produto, na ordem recebida", () => {
      monta([B, A]);
      expect(hospedeiro.querySelector("h2")?.textContent).toBe("Novidades");
      expect(
        Array.from(hospedeiro.querySelectorAll("[data-cartao]")).map((c) =>
          c.getAttribute("data-cartao"),
        ),
      ).toEqual(["b", "a"]);
    });

    it("o subtítulo só aparece quando existe", () => {
      monta([A]);
      expect(hospedeiro.querySelector("span.uppercase")).toBeNull();
      monta([A], { subtitle: "Só hoje" });
      expect(hospedeiro.querySelector("span.uppercase")).not.toBeNull();
      expect(hospedeiro.textContent).toContain("Só hoje");
    });
  });

  describe("setas de rolagem — as bordas da medição", () => {
    it("a seta de voltar só aparece depois de 10px rolados (10 exatos ainda não)", () => {
      const faixa = monta([A, B]);
      rolarPara(faixa, 5);
      expect(seta("Ver produtos anteriores")).toBeNull();
      rolarPara(faixa, 10);
      expect(seta("Ver produtos anteriores")).toBeNull();
      rolarPara(faixa, 11);
      expect(seta("Ver produtos anteriores")).not.toBeNull();
    });

    it("a seta de avançar some a menos de 10px do fim (10 exatos já é fim)", () => {
      const faixa = monta([A, B]);
      // clientWidth 600 + scrollLeft = scrollWidth - 11 -> ainda falta rolar.
      rolarPara(faixa, 1400 - 600 - 11);
      expect(seta("Ver próximos produtos")).not.toBeNull();
      rolarPara(faixa, 1400 - 600 - 10);
      expect(seta("Ver próximos produtos")).toBeNull();
      rolarPara(faixa, 1400 - 600 - 5);
      expect(seta("Ver próximos produtos")).toBeNull();
    });

    it("a lista que cresce com a faixa montada ganha a seta de avançar", () => {
      medidas.scrollWidth = 600;
      const faixa = monta([A]);
      expect(seta("Ver próximos produtos")).toBeNull();
      // Entram mais produtos (Realtime): a faixa não muda de tamanho, o
      // conteúdo dentro dela é que passa a sobrar.
      medidas.scrollWidth = 1800;
      monta([A, B, produto("c"), produto("d")]);
      expect(faixa).not.toBeNull();
      expect(seta("Ver próximos produtos")).not.toBeNull();
    });

    it("girar o aparelho (a faixa muda de largura) reavalia as setas", () => {
      medidas.scrollWidth = 600;
      const faixa = monta([A, B]);
      expect(seta("Ver próximos produtos")).toBeNull();
      // É a FAIXA que fica sob observação, não outro pedaço da tela.
      expect(ultimaFaixaObservada?.alvos).toEqual([faixa]);
      medidas.scrollWidth = 1400;
      act(() => ultimaFaixaObservada?.callback());
      expect(seta("Ver próximos produtos")).not.toBeNull();
    });

    it("ao sair da tela, o observador de largura é desligado", () => {
      monta([A, B]);
      const observado = ultimaFaixaObservada;
      expect(observado?.desligou).toBe(0);
      act(() => raiz.unmount());
      expect(observado?.desligou).toBe(1);
      // O afterEach desmonta de novo: refaz a raiz para ele não falhar.
      raiz = createRoot(hospedeiro);
    });
  });

  describe("cartões ligados à tela", () => {
    it("só o produto favoritado chega com o coração marcado", () => {
      monta([A, B], { favorites: ["b"] });
      expect(
        hospedeiro
          .querySelector('[data-cartao="a"]')
          ?.getAttribute("data-favorito"),
      ).toBe("false");
      expect(
        hospedeiro
          .querySelector('[data-cartao="b"]')
          ?.getAttribute("data-favorito"),
      ).toBe("true");
    });

    it("as estrelas dos cartões seguem a configuração da loja", () => {
      monta([A]);
      expect(
        hospedeiro
          .querySelector("[data-cartao]")
          ?.getAttribute("data-avaliacao"),
      ).toBe("true");
      cenario.config = { enableReviews: false };
      monta([A]);
      expect(
        hospedeiro
          .querySelector("[data-cartao]")
          ?.getAttribute("data-avaliacao"),
      ).toBe("false");
    });

    it("abrir, favoritar, comprar e compra rápida chegam à tela com o produto certo", () => {
      const abrir = vi.fn();
      const favoritar = vi.fn();
      const comprar = vi.fn(() => 2);
      const rapida = vi.fn();
      monta([A, B], {
        onProductClick: abrir,
        onToggleFavorite: favoritar,
        onAddToCart: comprar,
        onQuickBuy: rapida,
      });
      clicar("abrir b");
      expect(abrir).toHaveBeenCalledWith("b");
      clicar("favoritar a");
      expect(favoritar).toHaveBeenCalledWith(A);
      clicar("comprar b");
      expect(comprar).toHaveBeenCalledWith(B);
      // O número que entrou volta ao cartão (ele só celebra se entrou).
      expect(devolvido.valores).toEqual([2]);
      clicar("rapida a");
      expect(rapida).toHaveBeenCalledWith(A);
    });

    it("com a escolha de opções ligada, produto, opção, nomes e QUANTIDADE chegam à tela", () => {
      const comOpcoes = vi.fn(() => 1);
      monta([A], { onAddToCartWithVariants: comOpcoes });
      expect(
        hospedeiro
          .querySelector("[data-cartao]")
          ?.getAttribute("data-modo-opcoes"),
      ).toBe("true");
      clicar("opcoes a");
      expect(comOpcoes).toHaveBeenCalledWith(A, "v1", "Azul / M", 3);
      expect(devolvido.valores).toEqual([1]);
    });

    it("sem a escolha de opções na faixa, o cartão continua no modo 'ir para o produto'", () => {
      monta([A]);
      expect(
        hospedeiro
          .querySelector("[data-cartao]")
          ?.getAttribute("data-modo-opcoes"),
      ).toBe("false");
    });
  });
});
