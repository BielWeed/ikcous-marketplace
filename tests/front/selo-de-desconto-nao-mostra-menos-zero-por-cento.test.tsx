// @vitest-environment jsdom
//
// De R$ 100,00 por R$ 99,70 o desconto é 0,3%: arredondado dá 0, e o carrinho
// e a folha de opções mostravam o selo "-0%". Agora o selo some quando o
// arredondamento dá 0, mas o preço riscado continua (o preço de fato caiu).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartItemsList } from "@/components/ui/custom/CartItemsList";
import {
  CorpoDaFolhaDeOpcoes,
  FolhaDeOpcoes,
} from "@/components/ui/custom/FolhaDeOpcoes";
import type { CartItem, Product } from "@/types";

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

const produto = (price: number, originalPrice: number): Product => ({
  id: "prod-1",
  name: "Camiseta Teste",
  description: "",
  price,
  originalPrice,
  images: [],
  category: "Roupas",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

function carrinho(product: Product) {
  const cart: CartItem[] = [{ product, quantity: 1 }];
  act(() => {
    raiz.render(
      <CartItemsList
        cart={cart}
        removingId={null}
        onUpdateQuantity={() => {}}
        onRemove={() => {}}
        handleClearCart={() => {}}
      />,
    );
  });
}

function folha(product: Product, preco: number) {
  act(() => {
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
          preco={preco}
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
}

describe("selo de desconto — carrinho", () => {
  it("De 100,00 por 99,70 não mostra -0%, mas mantém o preço riscado", () => {
    carrinho(produto(99.7, 100));
    expect(document.body.textContent).not.toContain("-0%");
    expect(hospedeiro.querySelector(".line-through")?.textContent).toContain(
      "100,00",
    );
  });

  it("desconto de verdade continua com o selo", () => {
    carrinho(produto(80, 100));
    expect(document.body.textContent).toContain("-20%");
  });
});

describe("selo de desconto — folha de opções", () => {
  it("De 100,00 por 99,70 não mostra -0%, mas mantém o preço riscado", () => {
    folha(produto(99.7, 100), 99.7);
    expect(document.body.textContent).not.toContain("-0%");
    expect(document.body.querySelector(".line-through")?.textContent).toContain(
      "100,00",
    );
  });

  it("desconto de verdade continua com o selo", () => {
    folha(produto(80, 100), 80);
    expect(document.body.textContent).toContain("-20%");
  });
});
