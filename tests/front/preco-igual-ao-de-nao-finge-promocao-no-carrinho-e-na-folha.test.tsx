// @vitest-environment jsdom
//
// Fronteira do preço riscado: quando o preço que a cliente paga é IGUAL ao "De"
// (ou maior), não existe promoção -- nada de "De" riscado ao lado do mesmo
// valor. O cadastro barra "De" <= "Por" no produto, mas a variação pode ter
// preço próprio que alcança ou passa o "De" (produto R$ 80 com "De" R$ 100 e a
// opção M a R$ 100). A guarda é `originalPrice > preço` (estritamente maior) no
// carrinho e na folha de opções (a página do produto tem arquivo próprio:
// product-view-escolha-com-preco-igual-ao-de-nao-finge-promocao.test.tsx); com
// `>=` cada tela riscaria "R$ 100,00" ao lado de "R$ 100,00".
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
  id: "prod-igual-ao-de-1",
  name: "Camiseta Fronteira",
  description: "Descrição de teste",
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

function carrinho(product: Product, variantId?: string) {
  const cart: CartItem[] = [{ product, quantity: 1, variantId }];
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

describe("carrinho — preço da opção igual ao 'De'", () => {
  it("produto a 80 com 'De' 100 e opção M a 100: R$ 100,00 simples, sem riscado nem selo", () => {
    const product = produto(80, 100);
    product.variants = [
      {
        id: "tamanho-m",
        productId: product.id,
        name: "Tamanho",
        value: "M",
        stockIncrement: 10,
        priceOverride: 100,
        active: true,
      },
    ];

    carrinho(product, "tamanho-m");

    expect(hospedeiro.textContent).toContain("100,00");
    expect(hospedeiro.querySelector(".line-through")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("%");
    expect(hospedeiro.textContent).not.toContain("Preço original");
  });

  it("opção ACIMA do 'De' (120 contra 100): também sem riscado", () => {
    const product = produto(80, 100);
    product.variants = [
      {
        id: "tamanho-g",
        productId: product.id,
        name: "Tamanho",
        value: "G",
        stockIncrement: 10,
        priceOverride: 120,
        active: true,
      },
    ];

    carrinho(product, "tamanho-g");

    expect(hospedeiro.textContent).toContain("120,00");
    expect(hospedeiro.querySelector(".line-through")).toBeNull();
  });
});

describe("folha de opções — preço da escolha igual ao 'De'", () => {
  it("preço 100 com 'De' 100: sem riscado e sem selo", () => {
    folha(produto(80, 100), 100);

    expect(document.body.textContent).toContain("100,00");
    expect(document.body.querySelector(".line-through")).toBeNull();
    expect(document.body.textContent).not.toContain("-0%");
  });

  it("preço 80 com 'De' 100: o riscado e o -20% existem (o oposto da fronteira)", () => {
    folha(produto(80, 100), 80);

    expect(document.body.querySelector(".line-through")?.textContent).toContain(
      "100,00",
    );
    expect(document.body.textContent).toContain("-20%");
  });
});
