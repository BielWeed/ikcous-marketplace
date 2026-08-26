// @vitest-environment jsdom
//
// O carrinho não pode guardar item zumbi com quantidade 0.
//
// Em CartContext.tsx, `updateQuantity` clampava a quantidade pedida ao estoque
// disponível. Quando o estoque de um item do carrinho tinha virado 0 no banco
// (a cliente colocou ontem; o lojista zerou hoje), o clamp deixava o item vivo
// com `quantity: 0`: os dois botões do seletor travam (o "-" com qtd <= 1, o
// "+" com max 0), o subtotal daquele item mostra R$ 0 e o "Finalizar Pedido"
// segue habilitado — a recusa só aparecia no fim do checkout, no servidor
// ("Quantidade inválida para um dos itens."). A remoção por quantidade 0 já
// existia para o PARÂMETRO (linha do `if (quantity <= 0)`); este teste prende
// que ela também vale para o RESULTADO do clamp: estoque 0 tira o item do
// carrinho, com tombstone — a mesma mecânica de `removeFromCart`, para outra
// aba não ressuscitar o item no sync.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";

const toastError = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/cart-context-variant-names.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(estoque: number): Product {
  return {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: estoque,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

function itemSalvo(estoque: number): CartItem {
  return {
    product: produto(estoque),
    quantity: 1,
    lastModifiedAt: Date.now(),
  };
}

/** Não renderiza nada — empurra o carrinho e o updateQuantity atuais para
 * fora do contexto a cada render, para o teste agir sem consumidor de UI. */
function Sonda({
  onEstado,
}: Readonly<{
  onEstado: (estado: {
    cart: CartItem[];
    updateQuantity: ReturnType<typeof useCartContext>["updateQuantity"];
  }) => void;
}>) {
  const { cart, updateQuantity } = useCartContext();
  useEffect(() => {
    onEstado({ cart, updateQuantity });
  }, [cart, updateQuantity, onEstado]);
  return null;
}

describe("CartContext — estoque 0 tira o item do carrinho, não deixa zumbi", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let cartAtual: CartItem[];
  let updateQuantityAtual: ReturnType<typeof useCartContext>["updateQuantity"];

  function capturar(estado: {
    cart: CartItem[];
    updateQuantity: ReturnType<typeof useCartContext>["updateQuantity"];
  }) {
    cartAtual = estado.cart;
    updateQuantityAtual = estado.updateQuantity;
  }

  beforeEach(() => {
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
    toastError.mockClear();
    cartAtual = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizarComCarrinho(item: CartItem) {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify([item]));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={capturar} />
        </CartProvider>,
      );
    });
  }

  it("estoque que virou 0: o item sai do carrinho em vez de ficar com quantidade 0", async () => {
    await renderizarComCarrinho(itemSalvo(0));

    // Âncora: a hidratação mantém o item (com estoque 0) — o gatilho do
    // defeito é o updateQuantity, não a hidratação.
    expect(cartAtual).toHaveLength(1);

    await act(async () => {
      updateQuantityAtual("prod-1", 2);
    });

    expect(cartAtual).toHaveLength(0);
    expect(toastError).toHaveBeenCalled();
  });

  it("estoque 3 com pedido de 10: item continua, com a quantidade clampada em 3", async () => {
    await renderizarComCarrinho(itemSalvo(3));

    await act(async () => {
      updateQuantityAtual("prod-1", 10);
    });

    // A remoção é só para estoque 0 — clamp normal não pode apagar item.
    expect(cartAtual).toHaveLength(1);
    expect(cartAtual[0].quantity).toBe(3);
  });

  it("estoque 5 com pedido de 2: quantidade atualizada, sem reclamação", async () => {
    await renderizarComCarrinho(itemSalvo(5));

    await act(async () => {
      updateQuantityAtual("prod-1", 2);
    });

    expect(cartAtual).toHaveLength(1);
    expect(cartAtual[0].quantity).toBe(2);
    expect(toastError).not.toHaveBeenCalled();
  });
});
