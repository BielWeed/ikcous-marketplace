// @vitest-environment jsdom
//
// Lote 249 (resíduo da caça 12-A #1), de ponta a ponta: o carrinho REAL
// (CartProvider) com o checkout REAL.
//
// Cliente com conta toca em "Finalizar"; o pedido é gravado (a última peça vai a
// zero no catálogo) mas a resposta se perde (`TypeError: Failed to fetch`). Ela
// FECHA e ABRE o app. A leitura de abertura do carrinho via o estoque que o
// próprio pedido consumiu e tirava a linha; a chave do reenvio, que nasce do
// carrinho, mudava e o novo "Finalizar" criava um SEGUNDO pedido. Agora o
// reenvio leva a MESMA chave do primeiro envio.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const mundo = vi.hoisted(() => ({
  usuario: { id: "user-1" } as null | { id: string },
  catalogo: [] as Array<Record<string, unknown>>,
  avisos: [] as string[],
}));

const createOrder = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
      shippingFee: 0,
      freeShippingMin: 0,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [
      {
        id: "addr-1",
        user_id: "user-1",
        name: "Casa",
        recipient_name: "Cliente Teste",
        cep: "01310-100",
        street: "Rua Teste",
        number: "100",
        neighborhood: "Centro",
        city: "Cidade Teste",
        state: "SP",
        is_default: true,
      },
    ],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, profile: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () => Promise.resolve(true),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data:
              tabela === "cart_items"
                ? [
                    {
                      product_id: "prod-1",
                      variant_id: "",
                      quantity: 1,
                      updated_at: new Date(1_760_000_000_000).toISOString(),
                    },
                  ]
                : [],
            error: null,
          }),
        in: async (_coluna: string, ids: unknown) => {
          if (tabela === "vw_produtos_public") {
            const pedidos = Array.isArray(ids) ? ids.map(String) : [];
            return {
              data: mundo.catalogo.filter((l) =>
                pedidos.includes(String(l.id)),
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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
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

const CHAVE_DA_CONTA = "ikcous-chave-do-pedido:user-1";

function linha(extra: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    nome: "Blusa A",
    preco_venda: 100,
    estoque: 1,
    ativo: true,
    imagens: [],
    categoria: "geral",
    ...extra,
  };
}

const esperarMicrotarefas = () => new Promise((r) => setTimeout(r, 0));

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** Deixa a frete local escolhido, como a tela de entrega faz antes do checkout. */
function PreparaEntrega() {
  const { setSelectedShippingOption, setShippingCep } = useCartContext();
  // Depois do efeito de abertura do provider, que zera a escolha de entrega.
  useEffect(() => {
    const t = setTimeout(() => {
      setSelectedShippingOption({
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      });
      setShippingCep("01310-100");
    }, 5);
    return () => clearTimeout(t);
  }, [setSelectedShippingOption, setShippingCep]);
  return null;
}

describe("CheckoutView + CartProvider — reabrir o app com pedido sem resposta reenvia a MESMA chave", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  async function abrirOApp() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CartProvider>
          <PreparaEntrega />
          <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />
        </CartProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
  }

  /** Fechar e abrir o PWA: a árvore some; o localStorage fica. */
  async function fecharEAbrirOApp() {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await abrirOApp();
  }

  async function preencherEFinalizar() {
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 420));
    });
    await act(async () => {
      botaoPorTexto("Dinheiro na Entrega")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      botaoPorTexto("Finalizar Pedido")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  beforeEach(() => {
    createOrder.mockReset();
    mundo.usuario = { id: "user-1" };
    mundo.avisos = [];
    mundo.catalogo = [linha()];
    sessionStorage.clear();
    pararABuscaDeCep();
    armazem = new Map<string, string>();
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
    const produto = mapProductFromDB({ ...linha(), product_variants: [] });
    armazem.set(
      "marketplace_cart_v1",
      JSON.stringify([
        { product: produto, quantity: 1, lastModifiedAt: 1_760_000_000_000 },
      ]),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a resposta se perdeu e o estoque foi a zero: ao reabrir, a linha fica e o reenvio leva a mesma chave", async () => {
    createOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
    await abrirOApp();
    await preencherEFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const chaveDoPrimeiroEnvio = createOrder.mock.calls[0][0].idempotencyKey;
    expect(JSON.parse(armazem.get(CHAVE_DA_CONTA)!).chave).toBe(
      chaveDoPrimeiroEnvio,
    );

    // O PRÓPRIO pedido consumiu a última peça, e o app é reaberto.
    mundo.catalogo = [linha({ estoque: 0 })];
    await fecharEAbrirOApp();
    await preencherEFinalizar();

    expect(mundo.avisos.join(" ")).not.toContain("esgotou");
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(
      chaveDoPrimeiroEnvio,
    );
  });
});
