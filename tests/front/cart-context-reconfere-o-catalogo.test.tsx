// @vitest-environment jsdom
//
// O carrinho tem de reler o catálogo ao abrir o app (14/10/2026).
//
// DEFEITO MEDIDO: o carrinho guardava a cópia do produto do DIA em que o item
// entrou. A lojista mudava o preço (promoção ou reajuste), a cliente voltava, o
// carrinho ainda mostrava R$ 59,90, e ao finalizar o servidor recusava com "Os
// valores do pedido mudaram" — e a única saída era remover e adicionar de
// novo. Com conta, o app até LIA o preço novo no banco, mas na junção com o
// carrinho salvo (carimbo igual, o caso normal) ficava a cópia local. Pela
// mesma causa, estoque zerado e produto pausado nunca eram relidos.
//
// Este arquivo trava o conserto E o que já funcionava: preço igual, rede boa,
// nada muda (mesma referência do carrinho, nenhum aviso); releitura que falha
// deixa o carrinho como estava; a regra de "quem escreveu por último vence"
// entre carrinho do banco e carrinho local segue a mesma.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { formatCurrency } from "@/lib/utils";
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const T = 1_760_000_000_000; // carimbo do item (local == remoto, como após um sync)

const mundo = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  itensNoBanco: [] as Array<Record<string, unknown>>,
  catalogo: [] as Array<Record<string, unknown>>,
  variacoes: [] as Array<Record<string, unknown>>,
  falhaNoCatalogo: false,
  falhaNasVariacoes: false,
  leiturasDoCatalogo: 0,
  portao: null as null | Promise<void>,
  avisos: [] as string[],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

function idsDe(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map(String) : [];
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: tabela === "cart_items" ? mundo.itensNoBanco : [],
            error: null,
          }),
        in: async (coluna: string, ids: unknown) => {
          if (tabela === "vw_produtos_public") {
            mundo.leiturasDoCatalogo += 1;
            if (mundo.portao) await mundo.portao;
            if (mundo.falhaNoCatalogo) {
              return { data: null, error: { message: "rede caiu" } };
            }
            const pedidos = idsDe(ids);
            return {
              data: mundo.catalogo.filter((l) =>
                pedidos.includes(String(l.id)),
              ),
              error: null,
            };
          }
          if (tabela === "product_variants") {
            if (mundo.falhaNasVariacoes) {
              return { data: null, error: { message: "rede caiu" } };
            }
            const pedidos = idsDe(ids);
            return {
              data: mundo.variacoes.filter(
                (l) =>
                  coluna === "product_id" &&
                  pedidos.includes(String(l.product_id)),
              ),
              error: null,
            };
          }
          return { data: [], error: null };
        },
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: mundo.usuario ? { user: mundo.usuario } : null },
        }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));

vi.mock("sonner", () => {
  const registrar = (m: unknown) => {
    mundo.avisos.push(String(m));
  };
  return {
    toast: Object.assign(vi.fn(registrar), {
      error: registrar,
      info: registrar,
      success: registrar,
      warning: registrar,
    }),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(extra: Linha = {}): Linha {
  return {
    id: "prod-1",
    nome: "Camiseta",
    preco_venda: 69.9,
    estoque: 10,
    ativo: true,
    imagens: [],
    categoria: "geral",
    ...extra,
  };
}

function variacao(extra: Linha = {}): Linha {
  return {
    id: "var-P",
    product_id: "prod-1",
    name: "Tamanho",
    value: "P",
    stock_increment: 10,
    price_override: null,
    active: true,
    ...extra,
  };
}

/** O produto como o app o guardou no dia em que o item entrou. */
function produtoSalvo(extra: Linha = {}, variacoes: Linha[] = []): Product {
  return mapProductFromDB({
    ...linha({ preco_venda: 59.9 }),
    ...extra,
    product_variants: variacoes,
  });
}

function itemSalvo(
  produto: Product,
  quantity: number,
  extra: Partial<CartItem> = {},
): CartItem {
  return { product: produto, quantity, lastModifiedAt: T, ...extra };
}

function linhaDoCarrinhoNoBanco(
  quantity: number,
  carimbo = T,
  productId = "prod-1",
): Linha {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(carimbo).toISOString(),
  };
}

type Mundo = {
  cart: CartItem[];
  cartTotal: number;
  addToCart: ReturnType<typeof useCartContext>["addToCart"];
};
let atual: Mundo;
const versoesDoCarrinho: CartItem[][] = [];

function Sonda() {
  const { cart, cartTotal, addToCart } = useCartContext();
  useEffect(() => {
    atual = { cart, cartTotal, addToCart };
    if (versoesDoCarrinho.at(-1) !== cart) versoesDoCarrinho.push(cart);
  }, [cart, cartTotal, addToCart]);
  return null;
}

describe("CartContext — relê o catálogo ao abrir o app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    mundo.usuario = null;
    mundo.itensNoBanco = [];
    mundo.catalogo = [linha()];
    mundo.variacoes = [];
    mundo.falhaNoCatalogo = false;
    mundo.falhaNasVariacoes = false;
    mundo.leiturasDoCatalogo = 0;
    mundo.portao = null;
    mundo.avisos = [];
    versoesDoCarrinho.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function esperar(ms = 60) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function montar(salvos: CartItem[]) {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(salvos));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await esperar();
  }

  const de = (centavos: number) => formatCurrency(centavos / 100);

  describe("sem conta", () => {
    it("preço SUBIU: o carrinho passa a valer o preço novo, com a quantidade da cliente, e avisa", async () => {
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cartTotal).toBeCloseTo(139.8, 2);
      expect(atual.cart[0].quantity).toBe(2);
      expect(atual.cart[0].product.price).toBe(69.9);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain("Camiseta");
      expect(mundo.avisos[0]).toContain(de(5990));
      expect(mundo.avisos[0]).toContain(de(6990));
    });

    it("preço DESCEU: o total cai para o preço novo e a cliente é avisada", async () => {
      mundo.catalogo = [linha({ preco_venda: 49.9 })];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cartTotal).toBeCloseTo(99.8, 2);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain(de(5990));
      expect(mundo.avisos[0]).toContain(de(4990));
    });

    it("preço IGUAL: nada muda — mesma referência do carrinho, nenhum aviso", async () => {
      mundo.catalogo = [linha({ preco_venda: 59.9 })];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(mundo.leiturasDoCatalogo).toBe(1);
      expect(atual.cartTotal).toBeCloseTo(119.8, 2);
      // Uma única "versão" do carrinho em todo o ciclo: nenhuma re-renderização
      // por causa da releitura.
      expect(versoesDoCarrinho).toHaveLength(1);
      expect(mundo.avisos).toEqual([]);
    });

    it("produto PAUSADO (a vitrine não o devolve): sai do carrinho com aviso, o resto fica", async () => {
      mundo.catalogo = [linha({ id: "prod-2", nome: "Calça" })];
      await montar([
        itemSalvo(produtoSalvo(), 1),
        itemSalvo(
          produtoSalvo({ id: "prod-2", nome: "Calça", preco_venda: 69.9 }),
          3,
        ),
      ]);

      expect(atual.cart.map((i) => i.product.id)).toEqual(["prod-2"]);
      expect(atual.cart[0].quantity).toBe(3);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain("Camiseta");
      expect(mundo.avisos[0]).toContain("saiu do seu carrinho");
    });

    it("SEM ESTOQUE: sai do carrinho com aviso claro", async () => {
      mundo.catalogo = [linha({ estoque: 0 })];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cart).toHaveLength(0);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain("Camiseta");
      expect(mundo.avisos[0]).toContain("esgotou");
    });

    it("estoque MENOR que o pedido: a quantidade desce ao que há, com aviso", async () => {
      mundo.catalogo = [linha({ estoque: 1, preco_venda: 59.9 })];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cart).toHaveLength(1);
      expect(atual.cart[0].quantity).toBe(1);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain("Camiseta");
      expect(mundo.avisos[0]).toContain("1");
    });

    it("releitura FALHA: o carrinho fica como estava, sem aviso", async () => {
      mundo.falhaNoCatalogo = true;
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(mundo.leiturasDoCatalogo).toBe(1);
      expect(atual.cartTotal).toBeCloseTo(119.8, 2);
      expect(atual.cart[0].quantity).toBe(2);
      expect(versoesDoCarrinho).toHaveLength(1);
      expect(mundo.avisos).toEqual([]);
    });

    it("leitura das VARIAÇÕES falha: o carrinho não é mexido (nunca tira item por leitura incompleta)", async () => {
      mundo.falhaNasVariacoes = true;
      await montar([
        itemSalvo(produtoSalvo({}, [variacao()]), 1, {
          variantId: "var-P",
          variantNames: "Tamanho: P",
        }),
      ]);

      expect(atual.cart).toHaveLength(1);
      expect(atual.cart[0].variantId).toBe("var-P");
      expect(atual.cartTotal).toBeCloseTo(59.9, 2);
      expect(mundo.avisos).toEqual([]);
    });

    it("carrinho vazio: não faz leitura nenhuma", async () => {
      await montar([]);

      expect(mundo.leiturasDoCatalogo).toBe(0);
      expect(mundo.avisos).toEqual([]);
    });

    it("VARIAÇÃO: o preço próprio da variação mudou — total e aviso seguem a variação", async () => {
      mundo.variacoes = [variacao({ price_override: 80 })];
      await montar([
        itemSalvo(produtoSalvo({}, [variacao({ price_override: 50 })]), 2, {
          variantId: "var-P",
          variantNames: "Tamanho: P",
        }),
      ]);

      expect(atual.cartTotal).toBeCloseTo(160, 2);
      expect(atual.cart[0].quantity).toBe(2);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain(de(5000));
      expect(mundo.avisos[0]).toContain(de(8000));
    });

    it("VARIAÇÃO que a lojista desativou: a linha sai, o outro item fica", async () => {
      mundo.catalogo = [linha(), linha({ id: "prod-2", nome: "Calça" })];
      mundo.variacoes = [variacao({ active: false })];
      await montar([
        itemSalvo(produtoSalvo({}, [variacao()]), 1, {
          variantId: "var-P",
          variantNames: "Tamanho: P",
        }),
        itemSalvo(
          produtoSalvo({ id: "prod-2", nome: "Calça", preco_venda: 69.9 }),
          1,
        ),
      ]);

      expect(atual.cart.map((i) => i.product.id)).toEqual(["prod-2"]);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain("saiu do seu carrinho");
    });

    it("item adicionado ENQUANTO a leitura estava em voo não é tratado como sumido", async () => {
      let abrir: () => void = () => {};
      mundo.portao = new Promise<void>((r) => {
        abrir = r;
      });
      mundo.catalogo = [linha(), linha({ id: "prod-3", nome: "Boné" })];
      await montar([itemSalvo(produtoSalvo(), 1)]);
      // A leitura está pendurada; a cliente adiciona outro produto.
      const bone: Product = produtoSalvo({ id: "prod-3", nome: "Boné" });
      await act(async () => {
        atual.addToCart(bone, 1);
      });
      await act(async () => {
        abrir();
      });
      await esperar();

      expect(atual.cart.map((i) => i.product.id).sort()).toEqual([
        "prod-1",
        "prod-3",
      ]);
    });
  });

  describe("adicionar de novo", () => {
    it("adicionar o produto que já está no carrinho passa a usar o produto ATUAL (preço novo), somando a quantidade", async () => {
      // O banco ainda diz 59,90: a releitura da abertura não muda nada.
      mundo.catalogo = [linha({ preco_venda: 59.9 })];
      await montar([itemSalvo(produtoSalvo(), 2)]);
      expect(atual.cartTotal).toBeCloseTo(119.8, 2);

      // A cliente abre a página do produto, que já mostra o preço novo.
      const atualDoCatalogo = produtoSalvo({ preco_venda: 69.9 });
      await act(async () => {
        atual.addToCart(atualDoCatalogo, 1);
      });

      expect(atual.cart).toHaveLength(1);
      expect(atual.cart[0].quantity).toBe(3);
      expect(atual.cart[0].product.price).toBe(69.9);
      expect(atual.cartTotal).toBeCloseTo(3 * 69.9, 2);
    });
  });

  describe("com conta", () => {
    beforeEach(() => {
      mundo.usuario = { id: "u1" };
    });

    it("carimbo IGUAL (o caso normal) e preço novo no banco: fica o produto NOVO, com a quantidade da cliente", async () => {
      mundo.itensNoBanco = [linhaDoCarrinhoNoBanco(2)];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cart[0].product.price).toBe(69.9);
      expect(atual.cart[0].quantity).toBe(2);
      expect(atual.cartTotal).toBeCloseTo(139.8, 2);
      // O que o servidor conferiria: 2 x 69,90 contra o total da tela.
      expect(Math.abs(2 * 69.9 - atual.cartTotal)).toBeLessThanOrEqual(0.05);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain(de(5990));
      expect(mundo.avisos[0]).toContain(de(6990));
    });

    it("carimbo LOCAL mais novo: vale a quantidade local, com o produto novo", async () => {
      mundo.itensNoBanco = [linhaDoCarrinhoNoBanco(2, T)];
      await montar([
        itemSalvo(produtoSalvo(), 3, { lastModifiedAt: T + 1000 }),
      ]);

      expect(atual.cart[0].quantity).toBe(3);
      expect(atual.cart[0].product.price).toBe(69.9);
    });

    it("carimbo do BANCO mais novo: vale a quantidade do banco, com o produto novo", async () => {
      mundo.itensNoBanco = [linhaDoCarrinhoNoBanco(2, T + 1000)];
      await montar([itemSalvo(produtoSalvo(), 3, { lastModifiedAt: T })]);

      expect(atual.cart[0].quantity).toBe(2);
      expect(atual.cart[0].product.price).toBe(69.9);
    });

    it("preço IGUAL e carimbos diferentes: continua resolvendo como hoje (quem escreveu por último vence), sem aviso", async () => {
      mundo.catalogo = [linha({ preco_venda: 59.9 })];
      mundo.itensNoBanco = [linhaDoCarrinhoNoBanco(2, T + 1000)];
      await montar([itemSalvo(produtoSalvo(), 3, { lastModifiedAt: T })]);
      expect(atual.cart[0].quantity).toBe(2);
      expect(mundo.avisos).toEqual([]);
    });

    it("item só local (ainda sem linha no banco) também é relido", async () => {
      mundo.itensNoBanco = [];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cart).toHaveLength(1);
      expect(atual.cart[0].product.price).toBe(69.9);
      expect(atual.cartTotal).toBeCloseTo(139.8, 2);
    });

    it("preço IGUAL e carrinho já igual ao do banco: nada muda, nenhum aviso", async () => {
      mundo.catalogo = [linha({ preco_venda: 59.9 })];
      mundo.itensNoBanco = [linhaDoCarrinhoNoBanco(2)];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cartTotal).toBeCloseTo(119.8, 2);
      expect(mundo.avisos).toEqual([]);
    });

    it("produto pausado: sai do carrinho com aviso e o resto fica", async () => {
      mundo.catalogo = [linha({ id: "prod-2", nome: "Calça" })];
      mundo.itensNoBanco = [
        linhaDoCarrinhoNoBanco(1, T, "prod-1"),
        linhaDoCarrinhoNoBanco(3, T, "prod-2"),
      ];
      await montar([
        itemSalvo(produtoSalvo(), 1),
        itemSalvo(
          produtoSalvo({ id: "prod-2", nome: "Calça", preco_venda: 69.9 }),
          3,
        ),
      ]);

      expect(atual.cart.map((i) => i.product.id)).toEqual(["prod-2"]);
      expect(mundo.avisos).toHaveLength(1);
      expect(mundo.avisos[0]).toContain("Camiseta");
    });

    it("leitura do catálogo FALHA: o carrinho fica como estava (preço local), sem aviso", async () => {
      mundo.falhaNoCatalogo = true;
      mundo.itensNoBanco = [linhaDoCarrinhoNoBanco(2)];
      await montar([itemSalvo(produtoSalvo(), 2)]);

      expect(atual.cart).toHaveLength(1);
      expect(atual.cartTotal).toBeCloseTo(119.8, 2);
      expect(mundo.avisos).toEqual([]);
    });

    it("leitura das variações falha: o carrinho local não é mexido", async () => {
      mundo.falhaNasVariacoes = true;
      mundo.itensNoBanco = [];
      await montar([
        itemSalvo(produtoSalvo({}, [variacao()]), 1, {
          variantId: "var-P",
          variantNames: "Tamanho: P",
        }),
      ]);

      expect(atual.cart).toHaveLength(1);
      expect(atual.cart[0].variantId).toBe("var-P");
      expect(mundo.avisos).toEqual([]);
    });
  });
});
