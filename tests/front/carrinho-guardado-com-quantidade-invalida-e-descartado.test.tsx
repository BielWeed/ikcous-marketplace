// @vitest-environment jsdom
//
// CARRINHO GUARDADO NO APARELHO COM QUANTIDADE INVÁLIDA NÃO ENTRA (onda 121,
// achado 2).
//
// O esquema (Zod) que valida o carrinho guardado exige `quantity` inteira,
// maior que zero e no máximo MAX_ITEM_QUANTITY (500). Ele é o ÚNICO portão da
// carga: `cartTotal` soma preço x quantidade sem conferir nada, então uma
// quantidade negativa ABAIXARIA o total e a contagem, e uma fracionada ou acima
// de 500 seguiria para a gravação na conta e para o pedido. Nenhum teste punha
// quantidade inválida no `marketplace_cart_v1`; se o esquema afrouxasse numa
// refatoração, nada ficaria vermelho.
//
// A DECISÃO AFIRMADA AQUI: quantidade acima do teto (501) faz a linha CAIR
// inteira -- não é apertada para 500. É o que o código faz hoje; mudar isso é
// decisão de produto e este teste vai ficar vermelho para ela ser vista.
//
// Cobre os dois caminhos que passam pelo esquema: a carga do aparelho e o
// evento "storage" (a outra aba gravou). Visitante, catálogo sem resposta.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "marketplace_cart_v1";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
// Catálogo sem resposta: a releitura do catálogo falha e o carrinho fica como a
// carga o deixou (é a carga, não o catálogo, que está sob teste).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 1000,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const linha = (id: string, quantity: unknown) => ({
  product: produto(id),
  quantity,
  lastModifiedAt: 1_760_000_000_000,
});

// Misturadas de propósito: as boas ficam, as ruins caem, a ordem se mantém.
const MISTURA = [
  linha("zero", 0),
  linha("negativa", -2),
  linha("fracionada", 1.5),
  linha("acima-do-teto", 501),
  linha("no-teto", 500),
  linha("normal", 3),
];

type Leitura = {
  ids: string[];
  quantidades: number[];
  total: number;
  contagem: number;
};

function Leitor({ aoLer }: Readonly<{ aoLer: (leitura: Leitura) => void }>) {
  const { cart, cartTotal, cartCount } = useCartContext();
  aoLer({
    ids: cart.map((i) => i.product.id),
    quantidades: cart.map((i) => i.quantity),
    total: cartTotal,
    contagem: cartCount,
  });
  return null;
}

describe("CartContext — carrinho guardado com quantidade inválida é descartado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let leitura: Leitura;

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    leitura = { ids: [], quantidades: [], total: -1, contagem: -1 };
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

  async function abrirComCarrinhoGuardado(linhas: unknown[]) {
    armazem.set(CHAVE, JSON.stringify(linhas));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Leitor aoLer={(l) => (leitura = l)} />
        </CartProvider>,
      );
    });
    return leitura;
  }

  /** A OUTRA aba gravou o carrinho: o navegador avisa só esta aba. */
  async function outraAbaGravou(linhas: unknown[]) {
    const valor = JSON.stringify(linhas);
    armazem.set(CHAVE, valor);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: CHAVE, newValue: valor }),
      );
    });
    return leitura;
  }

  describe("na carga do aparelho", () => {
    it("só ficam a de 500 e a de 3: total e contagem batem, nada negativo", async () => {
      const lido = await abrirComCarrinhoGuardado(MISTURA);

      expect(lido.ids).toEqual(["no-teto", "normal"]);
      expect(lido.quantidades).toEqual([500, 3]);
      expect(lido.total).toBe(10 * 500 + 10 * 3);
      expect(lido.contagem).toBe(503);
    });

    it.each([
      ["zero", 0],
      ["negativa", -2],
      ["fracionada", 1.5],
      ["acima do teto (501: a linha CAI, não é apertada para 500)", 501],
      ["muito acima do teto", 100000],
      ["texto em vez de número", "3"],
      ["nula", null],
    ])(
      "quantidade %s sozinha: carrinho vazio, total e contagem zerados",
      async (_nome, quantidade) => {
        const lido = await abrirComCarrinhoGuardado([
          linha("unica", quantidade),
        ]);

        expect(lido).toEqual({
          ids: [],
          quantidades: [],
          total: 0,
          contagem: 0,
        });
      },
    );

    it("controle: 1, 3 e 500 (limites válidos) entram intactos", async () => {
      const lido = await abrirComCarrinhoGuardado([
        linha("a", 1),
        linha("b", 3),
        linha("c", 500),
      ]);

      expect(lido.quantidades).toEqual([1, 3, 500]);
      expect(lido.total).toBe(10 * 504);
      expect(lido.contagem).toBe(504);
    });
  });

  describe("no evento 'storage' (a outra aba gravou)", () => {
    it("só ficam a de 500 e a de 3: total e contagem batem, nada negativo", async () => {
      await abrirComCarrinhoGuardado([]);
      expect(leitura.ids).toEqual([]);

      const lido = await outraAbaGravou(MISTURA);

      expect(lido.ids).toEqual(["no-teto", "normal"]);
      expect(lido.quantidades).toEqual([500, 3]);
      expect(lido.total).toBe(10 * 500 + 10 * 3);
      expect(lido.contagem).toBe(503);
    });

    it.each([
      ["zero", 0],
      ["negativa", -2],
      ["fracionada", 1.5],
      ["acima do teto (501: a linha CAI, não é apertada para 500)", 501],
    ])(
      "quantidade %s sozinha: a linha não entra (sobra só o que é válido: nada)",
      async (_nome, quantidade) => {
        await abrirComCarrinhoGuardado([linha("daqui", 2)]);
        expect(leitura.ids).toEqual(["daqui"]);

        // A outra aba gravou só linha inválida: o que sobra de válido é a lista
        // vazia, e a linha estragada nunca aparece nem soma no total.
        const lido = await outraAbaGravou([linha("estragada", quantidade)]);

        expect(lido.ids).not.toContain("estragada");
        expect(lido.total).toBeGreaterThanOrEqual(0);
        expect(lido.contagem).toBeGreaterThanOrEqual(0);
        expect(lido).toEqual({
          ids: [],
          quantidades: [],
          total: 0,
          contagem: 0,
        });
      },
    );
  });
});
