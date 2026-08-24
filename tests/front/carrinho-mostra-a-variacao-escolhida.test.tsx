// @vitest-environment jsdom
//
// Defeito medido na tela em 23/08/2026, numa compra real: a linha do
// carrinho aparecia como "BRINQUEDO · COR" — o carrinho lia
// `item.product.variants.find(v => v.id === item.variantId)?.name`, que é
// o nome do GRUPO da variação ("Cor"), nunca a opção que a pessoa escolheu
// ("Rosa"). O checkout (CheckoutView.tsx:891) já lia `item.variantNames` e
// mostrava "Cor: Rosa" corretamente — as duas telas liam fontes diferentes
// e podiam divergir.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom): CartItemsList.tsx
// monta o texto da variação dentro de um JSX condicional real
// (`item.variantId && item.product.variants && (...)`) — varrer o arquivo
// fonte por string não provaria que aquele trecho CHEGA a renderizar com o
// dado certo. useStore é trocado por um dublê porque CartItemCard chama
// `useStore()` no corpo (linha 28) só para ler o config da loja — sem o
// dublê o teste quebraria por falta de StoreProvider, o que não é o que
// este teste mede.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));

const produtoBase: Product = {
  id: "prod-brinquedo",
  name: "Brinquedo Teste",
  description: "",
  price: 50,
  images: [],
  category: "Brinquedo",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
  variants: [
    {
      id: "var-rosa",
      productId: "prod-brinquedo",
      name: "Cor",
      value: "Rosa",
      stockIncrement: 0,
      active: true,
    },
  ],
};

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// limpar-tudo-limpa-de-verdade.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartItemsList — a linha do carrinho mostra a OPÇÃO escolhida, não o grupo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarCarrinho(cart: CartItem[]) {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    await act(async () => {
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
    return hospedeiro;
  }

  it("com variantNames gravado (checkout novo), a linha mostra a opção", async () => {
    const item: CartItem = {
      product: produtoBase,
      quantity: 1,
      variantId: "var-rosa",
      variantNames: "Cor: Rosa",
    };

    const host = await renderizarCarrinho([item]);

    expect(host.textContent).toContain("Rosa");
  });

  // Controle negativo: prende a correção. Item do carrinho VELHO, gravado no
  // localStorage (marketplace_cart_v1) antes de `variantNames` existir —
  // `variantId` aponta para a variante mas `variantNames` está ausente. Sem
  // este caso, a correção poderia ler só `item.variantNames` e quebrar quem
  // já tinha item salvo no carrinho.
  it("sem variantNames (carrinho velho do localStorage), a linha ainda mostra a opção", async () => {
    const item: CartItem = {
      product: produtoBase,
      quantity: 1,
      variantId: "var-rosa",
      // variantNames ausente de propósito
    };

    const host = await renderizarCarrinho([item]);

    expect(host.textContent).toContain("Rosa");
  });

  it("item sem variação nenhuma não mostra separador órfão nem texto de variação", async () => {
    const item: CartItem = {
      product: { ...produtoBase, variants: undefined },
      quantity: 1,
    };

    const host = await renderizarCarrinho([item]);

    expect(host.textContent).not.toContain("•");
    expect(host.textContent).not.toContain("Cor");
    expect(host.textContent).not.toContain("Rosa");
  });

  // Controle de discriminação: confirma que o texto renderizado não é mais
  // "Cor" sozinho — a mutação que desfaz a correção (voltar para
  // `?.name`) tem que fazer ESTA asserção cair. Ver relatório da tarefa
  // para a saída da mutação.
  it("controle: o texto da variação não é mais só o nome do grupo", async () => {
    const item: CartItem = {
      product: produtoBase,
      quantity: 1,
      variantId: "var-rosa",
      variantNames: "Cor: Rosa",
    };

    const host = await renderizarCarrinho([item]);

    // O span que mostra a variação tem a classe "text-zinc-500"
    // (CartItemsList.tsx:69) — é ele, isolado, que a mutação (voltar para
    // `?.name`) faz virar "Cor" em vez de conter "Rosa".
    const spanVariacao = host.querySelector("span.text-zinc-500");
    expect(spanVariacao?.textContent).not.toBe("Cor");
    expect(spanVariacao?.textContent).toContain("Rosa");
  });
});
