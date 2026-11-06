// @vitest-environment jsdom
//
// O "+" do carrinho trava quando a quantidade já é o estoque inteiro, e até hoje
// travava SEM dizer por quê: o aviso "Só N restantes" só aparece com estoque de
// 3 ou menos, e a dica do botão só existia para o teto de 500. Com estoque 5 e
// 5 no carrinho a cliente via um botão esmaecido e nenhuma explicação.
//
// O que este arquivo prende:
//   - o seletor explica o limite do estoque na dica do "+" (que, com o nome do
//     botão vindo do `aria-label`, é também a descrição para o leitor de tela) —
//     e o NOME do botão continua "Aumentar quantidade", porque telas e testes de
//     ponta a ponta o procuram por esse nome;
//   - a linha do carrinho escreve "Máximo disponível: N" quando o estoque (4 ou
//     mais) já está todo no carrinho;
//   - os limites: um abaixo do estoque não avisa; estoque até 3 segue só com o
//     "Só N restantes"; o teto de 500 mantém a dica própria dele; estoque zero
//     não inventa frase.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuantitySelector } from "@/components/ui/custom/QuantitySelector";
import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(sobre: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Ventilador de teto",
    description: "",
    price: 70,
    images: [],
    category: "Utilidade",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  };
}

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

const texto = () =>
  (hospedeiro.textContent ?? "").replaceAll(String.fromCharCode(160), " ");

const mais = () =>
  hospedeiro.querySelector(
    'button[aria-label="Aumentar quantidade"]',
  ) as HTMLButtonElement;

function montarSeletor(quantity: number, maxQuantity: number) {
  const onChange = vi.fn();
  act(() => {
    raiz.render(
      <QuantitySelector
        quantity={quantity}
        maxQuantity={maxQuantity}
        onChange={onChange}
        size="pill"
      />,
    );
  });
  return onChange;
}

async function montarLista(cart: CartItem[]) {
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
}

describe("QuantitySelector — o '+' travado pelo estoque diz o motivo", () => {
  it("estoque 5, quantidade 5: trava, não chama onChange e a dica diz 'Limite do estoque (5 unidades)'", () => {
    const onChange = montarSeletor(5, 5);
    expect(mais().disabled).toBe(true);
    act(() => mais().click());
    expect(onChange).not.toHaveBeenCalled();
    expect(mais().title).toBe("Limite do estoque (5 unidades)");
  });

  it("estoque 1, quantidade 1: singular, '1 unidade'", () => {
    montarSeletor(1, 1);
    expect(mais().title).toBe("Limite do estoque (1 unidade)");
  });

  it("um abaixo do estoque (4 de 5): o '+' sobe e a dica é a de sempre", () => {
    const onChange = montarSeletor(4, 5);
    expect(mais().disabled).toBe(false);
    expect(mais().title).toBe("Aumentar");
    act(() => mais().click());
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("teto de 500 com estoque maior: a dica continua a do teto, não a do estoque", () => {
    montarSeletor(500, 800);
    expect(mais().title).toBe("Máximo de 500 por pedido");
  });

  it("estoque zero: não inventa 'Limite do estoque (0 unidades)'", () => {
    montarSeletor(1, 0);
    expect(mais().disabled).toBe(true);
    expect(mais().title).toBe("Aumentar");
  });
});

describe("CartItemsList — a linha diz quando o estoque inteiro já está no carrinho", () => {
  it("estoque 5, quantidade 5: 'Máximo disponível: 5' e o '+' travado", async () => {
    await montarLista([{ product: produto({ stock: 5 }), quantity: 5 }]);
    expect(texto()).toContain("Máximo disponível: 5");
    expect(mais().disabled).toBe(true);
  });

  it("estoque 5, quantidade 4: ainda cabe um, nenhum aviso", async () => {
    await montarLista([{ product: produto({ stock: 5 }), quantity: 4 }]);
    expect(texto()).not.toContain("Máximo disponível");
    expect(mais().disabled).toBe(false);
  });

  it("estoque 3, quantidade 3: segue só o 'Só 3 restantes' de sempre, sem frase repetida", async () => {
    await montarLista([{ product: produto({ stock: 3 }), quantity: 3 }]);
    expect(texto()).toContain("Só 3 restantes");
    expect(texto()).not.toContain("Máximo disponível");
  });

  it("estoque 4, quantidade 4: é o primeiro estoque sem o aviso antigo e já ganha a frase nova", async () => {
    await montarLista([{ product: produto({ stock: 4 }), quantity: 4 }]);
    expect(texto()).not.toContain("Só ");
    expect(texto()).toContain("Máximo disponível: 4");
  });

  it("estoque 800, quantidade 500 (teto por item): não é o estoque, não diz 'Máximo disponível'", async () => {
    await montarLista([{ product: produto({ stock: 800 }), quantity: 500 }]);
    expect(texto()).not.toContain("Máximo disponível");
  });

  it("estoque 0: não inventa 'Máximo disponível: 0'", async () => {
    await montarLista([{ product: produto({ stock: 0 }), quantity: 1 }]);
    expect(texto()).not.toContain("Máximo disponível");
  });
});
