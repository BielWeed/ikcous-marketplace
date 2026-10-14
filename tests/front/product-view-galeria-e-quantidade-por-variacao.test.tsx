// @vitest-environment jsdom
//
// Dois defeitos da folha do produto, vistos pela pessoa que compra:
//
// 1) GALERIA -- ao tocar numa variação (cor) que tem foto própria, a galeria
//    passava a mostrar SÓ a foto dela: sem setas, sem bolinhas, sem
//    miniaturas, e tocar de novo não desmarcava. As outras fotos só voltavam
//    recarregando a página. Agora a foto da variação é destacada, mas as
//    outras continuam a um toque.
// 2) QUANTIDADE -- quantidade 5 num tamanho com estoque 10; trocar para um
//    tamanho com estoque 2 deixava o seletor em 5 e o carrinho recusava
//    ("Apenas 2 unidades"). O card já descia a quantidade; a folha não.
//
// Modelo estrutural copiado de product-view-variante-composta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO_A = "https://exemplo.test/fotos/foto-a.jpg";
const FOTO_B = "https://exemplo.test/fotos/foto-b.jpg";
const FOTO_C = "https://exemplo.test/fotos/foto-c.jpg";
const FOTO_AZUL = "https://exemplo.test/fotos/so-da-cor-azul.jpg";

function umProduto(sobrescreve: Partial<Product>): Product {
  return {
    id: "p-teste",
    name: "Camiseta de Teste",
    description: "Descrição de teste",
    price: 30,
    images: [FOTO_A, FOTO_B, FOTO_C],
    category: "geral",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...sobrescreve,
  };
}

const variacaoDeCor = (id: string, value: string, imageUrl?: string) => ({
  id,
  productId: "p-teste",
  name: "Cor",
  value,
  stockIncrement: 10,
  imageUrl,
  active: true,
});

const variacaoDeTamanho = (id: string, value: string, stock: number) => ({
  id,
  productId: "p-teste",
  name: "Tamanho",
  value,
  stockIncrement: stock,
  active: true,
});

function botaoPorRotulo(raiz: ParentNode, rotulo: string) {
  return raiz.querySelector(`button[aria-label="${rotulo}"]`) as
    | HTMLButtonElement
    | undefined
    | null;
}

/** O botão da opção pelo valor EXATO (o valor mora num span do botão). */
function botaoDaOpcao(raiz: ParentNode, valor: string) {
  const span = [...raiz.querySelectorAll("button span")].find(
    (el) => el.textContent === valor,
  );
  return span?.closest("button") as HTMLButtonElement | undefined;
}

function fotoPrincipalMostra(raiz: ParentNode, trecho: string) {
  return [...raiz.querySelectorAll("img.main-product-image")].some((img) =>
    (img.getAttribute("src") ?? "").includes(trecho),
  );
}

describe("ProductView — galeria e quantidade acompanham a variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    adicionarAoCarrinho = vi.fn<(q: number, v?: string, n?: string) => void>();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar(product: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={product}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  async function tocar(el: HTMLElement | null | undefined) {
    await act(async () => {
      el?.click();
    });
  }

  describe("galeria", () => {
    const produtoComCorComFoto = () =>
      umProduto({
        variants: [
          variacaoDeCor("v-azul", "Azul", FOTO_AZUL),
          variacaoDeCor("v-vermelha", "Vermelha"),
        ],
      });

    it("sem variação escolhida: setas e bolinhas das 3 fotos aparecem (não muda)", async () => {
      await montar(produtoComCorComFoto());

      expect(botaoPorRotulo(hospedeiro, "Próxima foto")).not.toBeNull();
      expect(botaoPorRotulo(hospedeiro, "Foto anterior")).not.toBeNull();
      expect(botaoPorRotulo(hospedeiro, "Foto 3 de 3")).not.toBeNull();
      expect(fotoPrincipalMostra(hospedeiro, "foto-a.jpg")).toBe(true);
    });

    it("tocar na cor com foto própria destaca a foto dela e as outras continuam acessíveis", async () => {
      await montar(produtoComCorComFoto());

      await tocar(botaoDaOpcao(hospedeiro, "Azul"));

      // A foto da cor aparece...
      expect(fotoPrincipalMostra(hospedeiro, "so-da-cor-azul.jpg")).toBe(true);
      // ...e os controles para ver as outras fotos NÃO somem.
      expect(botaoPorRotulo(hospedeiro, "Próxima foto")).not.toBeNull();
      expect(botaoPorRotulo(hospedeiro, "Foto anterior")).not.toBeNull();
      expect(botaoPorRotulo(hospedeiro, "Foto 2 de 3")).not.toBeNull();
    });

    it("com a cor escolhida, a pessoa chega às outras fotos pelas bolinhas e pelas setas, sem desfazer a cor", async () => {
      await montar(produtoComCorComFoto());
      await tocar(botaoDaOpcao(hospedeiro, "Azul"));

      await tocar(botaoPorRotulo(hospedeiro, "Foto 2 de 3"));
      expect(fotoPrincipalMostra(hospedeiro, "foto-b.jpg")).toBe(true);

      await tocar(botaoPorRotulo(hospedeiro, "Próxima foto"));
      expect(fotoPrincipalMostra(hospedeiro, "foto-c.jpg")).toBe(true);

      // A cor continua escolhida (nada foi desfeito).
      expect(
        botaoDaOpcao(hospedeiro, "Azul")?.getAttribute("aria-pressed"),
      ).toBe("true");
    });

    it("trocar de cor volta a destacar a foto da cor escolhida", async () => {
      await montar(
        umProduto({
          variants: [
            variacaoDeCor("v-azul", "Azul", FOTO_AZUL),
            variacaoDeCor(
              "v-verde",
              "Verde",
              "https://exemplo.test/fotos/so-da-cor-verde.jpg",
            ),
          ],
        }),
      );
      await tocar(botaoDaOpcao(hospedeiro, "Azul"));
      await tocar(botaoPorRotulo(hospedeiro, "Foto 2 de 3"));
      expect(fotoPrincipalMostra(hospedeiro, "foto-b.jpg")).toBe(true);

      await tocar(botaoDaOpcao(hospedeiro, "Verde"));
      expect(fotoPrincipalMostra(hospedeiro, "so-da-cor-verde.jpg")).toBe(true);

      // E voltar para a azul mostra a foto da azul de novo, não a que ficou.
      await tocar(botaoDaOpcao(hospedeiro, "Azul"));
      expect(fotoPrincipalMostra(hospedeiro, "so-da-cor-azul.jpg")).toBe(true);
    });

    it("produto com uma foto só continua sem setas nem bolinhas", async () => {
      await montar(
        umProduto({
          images: [FOTO_A],
          variants: [variacaoDeCor("v-azul", "Azul", FOTO_AZUL)],
        }),
      );
      await tocar(botaoDaOpcao(hospedeiro, "Azul"));

      expect(botaoPorRotulo(hospedeiro, "Próxima foto")).toBeNull();
      expect(botaoPorRotulo(hospedeiro, "Foto 1 de 1")).toBeNull();
    });
  });

  describe("quantidade", () => {
    const produtoComTamanhos = () =>
      umProduto({
        variants: [
          variacaoDeTamanho("v-m", "M", 10),
          variacaoDeTamanho("v-p", "P", 2),
        ],
      });

    async function adicionarEVerQuantidade() {
      const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Adicionar ao Carrinho"),
      );
      await tocar(botao);
      return adicionarAoCarrinho.mock.calls[0]?.[0];
    }

    it("quantidade 5 num tamanho com estoque 10 desce para 2 ao trocar para o de estoque 2", async () => {
      await montar(produtoComTamanhos());

      await tocar(botaoDaOpcao(hospedeiro, "M"));
      for (let i = 0; i < 4; i++) {
        await tocar(botaoPorRotulo(hospedeiro, "Aumentar quantidade"));
      }
      await tocar(botaoDaOpcao(hospedeiro, "P"));

      expect(await adicionarEVerQuantidade()).toBe(2);
    });

    it("quantidade abaixo do estoque novo não muda", async () => {
      await montar(produtoComTamanhos());

      await tocar(botaoDaOpcao(hospedeiro, "M"));
      await tocar(botaoPorRotulo(hospedeiro, "Aumentar quantidade"));
      await tocar(botaoDaOpcao(hospedeiro, "P"));

      expect(await adicionarEVerQuantidade()).toBe(2);
    });

    it("voltar para o tamanho de estoque maior não sobe a quantidade sozinha", async () => {
      await montar(produtoComTamanhos());

      await tocar(botaoDaOpcao(hospedeiro, "M"));
      for (let i = 0; i < 4; i++) {
        await tocar(botaoPorRotulo(hospedeiro, "Aumentar quantidade"));
      }
      await tocar(botaoDaOpcao(hospedeiro, "P"));
      await tocar(botaoDaOpcao(hospedeiro, "M"));

      expect(await adicionarEVerQuantidade()).toBe(2);
    });
  });
});
