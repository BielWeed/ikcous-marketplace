// @vitest-environment jsdom
//
// Bordas do carrinho que os testes do contexto deixavam passar (caça por
// mutação em `src/contexts/CartContext.tsx`):
//  - mudar a quantidade de uma linha esquece a lápide dela e carimba a hora;
//  - o "Desfazer" não anuncia "Devolvemos N" quando devolveu tudo, não apaga a
//    lápide de OUTRA tirada, e dois toques no MESMO instante não dobram a linha;
//  - esvaziar o carrinho zera a escolha de frete e o CEP mesmo com o carrinho
//    já vazio (aí a troca de composição não dispara o efeito que também zera).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import {
  lerRascunhoDoCheckout,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";
import type { CartItem, Product, ShippingOption } from "@/types";

const toastInfo = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      channel: () => canal,
      removeChannel: async () => {},
      rpc: async () => ({ error: new Error("sem rede") }),
      from: () => {
        throw new Error("sem rede");
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: (...args: unknown[]) => toastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_LAPIDES = "marketplace_cart_tombstones_v1";
const CHAVE_CARRINHO = "marketplace_cart_v1";

function produto(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extra,
  };
}

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

function acaoDesfazer(): { label: string; onClick: () => void } {
  const chamada = toastInfo.mock.calls.at(-1);
  const opcoes = chamada?.[1] as
    | { action?: { label: string; onClick: () => void } }
    | undefined;
  if (!opcoes?.action) throw new Error("o aviso não trouxe a ação Desfazer");
  return opcoes.action;
}

const lapides = () => localStorage.getItem(CHAVE_LAPIDES) ?? "[]";

describe("CartContext — bordas de quantidade, Desfazer e esvaziar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

  async function montar() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
  }

  function guardarCarrinho(itens: CartItem[]) {
    localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(itens));
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
    toastInfo.mockClear();
    window.sessionStorage.clear();
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

  describe("updateQuantity", () => {
    it("mudar a quantidade carimba a hora da linha (a junção offline decide por ela)", async () => {
      guardarCarrinho([
        { product: produto("p1"), quantity: 2, lastModifiedAt: 1000 },
      ]);
      await montar();

      await act(async () => {
        atual.updateQuantity("p1", 5);
      });

      expect(atual.cart.at(0)?.quantity).toBe(5);
      expect(atual.cart.at(0)?.lastModifiedAt ?? 0).toBeGreaterThan(
        1_000_000_000_000,
      );
    });

    it("mudar a quantidade esquece uma lápide velha da MESMA linha (ela não pode apagar o que a cliente acabou de mexer)", async () => {
      guardarCarrinho([
        { product: produto("p1"), quantity: 2, lastModifiedAt: 1000 },
      ]);
      await montar();

      // Lápide que outra aba/aparelho gravou para esta linha.
      await act(async () => {
        atual.removeFromCart("p1", undefined, { silencioso: true });
      });
      const guardada = lapides();
      expect(guardada).toContain("p1");
      await act(async () => {
        atual.addToCart(produto("p1"), 1);
      });
      localStorage.setItem(CHAVE_LAPIDES, guardada);
      expect(lapides()).toContain("p1");

      await act(async () => {
        atual.updateQuantity("p1", 3);
      });

      expect(atual.cart.at(0)?.quantity).toBe(3);
      expect(lapides()).not.toContain("p1");
    });
  });

  describe("Desfazer da lixeira", () => {
    const itens: CartItem[] = [
      { product: produto("p1"), quantity: 2, lastModifiedAt: 1000 },
      { product: produto("p2"), quantity: 8, lastModifiedAt: 2000 },
    ];

    it("devolveu a quantidade inteira: não avisa 'Devolvemos N (limite do estoque)'", async () => {
      guardarCarrinho(itens);
      await montar();
      await act(async () => {
        atual.removeFromCart("p2", undefined, { comDesfazer: true });
      });
      await act(async () => {
        acaoDesfazer().onClick();
      });

      expect(atual.cart.find((i) => i.product.id === "p2")?.quantity).toBe(8);
      const frases = toastInfo.mock.calls.map((c) => String(c[0]));
      expect(frases).toEqual(["Produto removido do carrinho"]);
    });

    it("dois toques no Desfazer no MESMO instante devolvem a linha uma vez só", async () => {
      guardarCarrinho(itens);
      await montar();
      await act(async () => {
        atual.removeFromCart("p2", undefined, { comDesfazer: true });
      });
      const { onClick } = acaoDesfazer();

      await act(async () => {
        onClick();
        onClick();
      });

      const linhas = atual.cart.filter((i) => i.product.id === "p2");
      expect(linhas).toHaveLength(1);
      expect(linhas.at(0)?.quantity).toBe(8);
    });

    it("o aviso com o Desfazer fica na tela por 6 segundos (o padrão, ~4 s, é curto para quem tocou sem querer)", async () => {
      guardarCarrinho(itens);
      await montar();
      await act(async () => {
        atual.removeFromCart("p2", undefined, { comDesfazer: true });
      });

      const opcoes = toastInfo.mock.calls.at(-1)?.[1] as
        | { duration?: number }
        | undefined;
      expect(opcoes?.duration).toBe(6000);
    });

    it("um Desfazer ANTIGO não apaga a lápide de uma tirada mais nova do mesmo produto", async () => {
      let relogio = 1_900_000_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => relogio);
      guardarCarrinho(itens);
      await montar();

      // 1ª tirada: guarda o Desfazer dela.
      await act(async () => {
        atual.removeFromCart("p2", undefined, { comDesfazer: true });
      });
      const antigo = acaoDesfazer();
      const lapideDaPrimeira = lapides();
      expect(lapideDaPrimeira).toContain("p2");

      // A cliente põe o produto de novo e tira outra vez, um segundo depois.
      relogio += 1000;
      await act(async () => {
        atual.addToCart(produto("p2"), 1);
      });
      relogio += 1000;
      await act(async () => {
        atual.removeFromCart("p2", undefined, { comDesfazer: true });
      });
      const lapideDaSegunda = lapides();
      expect(lapideDaSegunda).toContain("p2");
      expect(lapideDaSegunda).not.toBe(lapideDaPrimeira);

      // O Desfazer da 1ª tirada vale (a linha está fora), mas a lápide que
      // ficou é a da 2ª tirada e não é dele para apagar.
      await act(async () => {
        antigo.onClick();
      });
      expect(atual.cart.some((i) => i.product.id === "p2")).toBe(true);
      expect(lapides()).toBe(lapideDaSegunda);
    });
  });

  describe("validade das lápides (7 dias)", () => {
    const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;

    it("a lápide de exatamente 7 dias já venceu; a de 1 ms a menos ainda vale", async () => {
      const agora = 1_900_000_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => agora);
      localStorage.setItem(
        CHAVE_LAPIDES,
        JSON.stringify([
          { key: "venceu-", deletedAt: agora - SETE_DIAS },
          { key: "vale-", deletedAt: agora - SETE_DIAS + 1 },
          { key: "recente-", deletedAt: agora - 1000 },
        ]),
      );
      await montar();

      // Tirar OUTRO produto relê as lápides, descarta as vencidas e regrava.
      await act(async () => {
        atual.removeFromCart("p9", undefined, { silencioso: true });
      });

      const chaves = (
        JSON.parse(lapides()) as { key: string; deletedAt: number }[]
      )
        .map((l) => l.key)
        .sort();
      expect(chaves).toEqual(["p9-", "recente-", "vale-"]);
    });
  });

  describe("clearCart", () => {
    const opcao = {
      id: "pac",
      name: "PAC",
      price: 20,
    } as unknown as ShippingOption;

    it("com o carrinho JÁ vazio, esvaziar ainda zera a escolha de frete e o CEP", async () => {
      await montar();
      expect(atual.cart).toEqual([]);

      await act(async () => {
        atual.setSelectedShippingOption(opcao, "cliente");
        atual.setShippingCep("01001000");
      });
      expect(atual.selectedShippingOption?.id).toBe("pac");
      expect(atual.shippingCep).toBe("01001000");

      await act(async () => {
        atual.clearCart({ silencioso: true });
      });

      expect(atual.selectedShippingOption).toBeNull();
      expect(atual.shippingCep).toBeNull();
    });

    it("esvaziar solta o cupom, o dono do cupom e o troco do rascunho do checkout, e guarda o resto", async () => {
      salvarRascunhoDoCheckout(window.sessionStorage, {
        ...rascunhoVazio(),
        nome: "Maria",
        contaDosDados: "conta-x",
        cupom: "PROMO10",
        contaDoCupom: "conta-x",
        trocoPara: "50",
      });
      guardarCarrinho([{ product: produto("p1"), quantity: 1 }]);
      await montar();

      await act(async () => {
        atual.clearCart({ silencioso: true });
      });

      const depois = lerRascunhoDoCheckout(window.sessionStorage);
      expect(depois?.cupom).toBeNull();
      expect(depois?.contaDoCupom).toBeNull();
      expect(depois?.trocoPara).toBeUndefined();
      expect(depois?.nome).toBe("Maria");
      expect(depois?.contaDosDados).toBe("conta-x");
    });

    it("sem rascunho no checkout, esvaziar não cria um", async () => {
      window.sessionStorage.clear();
      guardarCarrinho([{ product: produto("p1"), quantity: 1 }]);
      await montar();
      await act(async () => {
        atual.clearCart({ silencioso: true });
      });
      expect(lerRascunhoDoCheckout(window.sessionStorage)).toBeNull();
    });
  });
});
