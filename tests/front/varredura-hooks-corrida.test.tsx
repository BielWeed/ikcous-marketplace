// @vitest-environment jsdom
//
// Varredura de bugs (12/10/2026), frente hooks-corrida: guardas de corrida/
// erro dos hooks de LEITURA. Cada bloco prende um item da varredura.
import type { CartItem, Product } from "@/types";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockFrom } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke }, from: mockFrom },
}));

/** Dublê de `supabase.from(tabela)...eq(coluna, id)`: a resposta sai de
 * `responder(tabela, id)`, que cada teste controla (inclusive atrasando). */
function simularBanco(
  responder: (tabela: string, id: string) => Promise<unknown>,
) {
  mockFrom.mockImplementation((tabela: string) => {
    let id = "";
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.eq = (_coluna: string, valor: string) => {
      if (_coluna === "order_id" || _coluna === "id") id = valor;
      return b;
    };
    b.single = () => responder(tabela, id);
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
    b.then = (ok: never, ko: never) => responder(tabela, id).then(ok, ko);
    return b;
  });
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(): Product {
  return {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

describe("item 1: useEconomiaDoFreteExibida descarta resposta de rodada encerrada", () => {
  let raiz: Root;
  let alvo: HTMLElement;

  beforeEach(() => {
    mockInvoke.mockReset();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
  });

  it("carrinho esvaziado com a cotação em voo: a resposta velha não pinta economia", async () => {
    const { useEconomiaDoFreteExibida, _limparCacheDeEconomiaDoFreteParaTeste } =
      await import("@/hooks/useEconomiaDoFreteExibida");
    _limparCacheDeEconomiaDoFreteParaTeste();
    function Sonda(props: Parameters<typeof useEconomiaDoFreteExibida>[0]) {
      const valor = useEconomiaDoFreteExibida(props);
      return createElement("span", null, String(valor));
    }
    let resolver: (v: unknown) => void = () => {};
    mockInvoke.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    const base = {
      freteGratis: true,
      cepDeEntrega: "01310-100",
      temUsuario: true,
      originCep: "38500-000",
      localCepRange: undefined,
      localDeliveryFee: 12.9,
      freeShippingMin: 0.01,
      isOffline: false,
    };
    const cheio: CartItem[] = [{ product: produto(), quantity: 1 }];

    act(() => raiz.render(createElement(Sonda, { ...base, cart: cheio })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    act(() => raiz.render(createElement(Sonda, { ...base, cart: [] })));
    await act(async () => {
      resolver({
        data: { options: [{ id: "x", price: 25, name: "x" }] },
        error: null,
      });
      await Promise.resolve();
    });
    expect(alvo.textContent).toBe("0");
  });
});

describe("itens 2 e 3: useEstornosDoPedido", () => {
  let raiz: Root;
  let alvo: HTMLElement;

  beforeEach(() => {
    mockFrom.mockReset();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
  });

  async function sonda() {
    const { useEstornosDoPedido } = await import(
      "@/hooks/useEstornosDoPedido"
    );
    return function Sonda({ orderId }: { orderId: string }) {
      const e = useEstornosDoPedido(orderId);
      return createElement(
        "span",
        null,
        `pago=${e.pago};disp=${e.disponivel};erro=${e.erro}`,
      );
    };
  }

  const pedido = (total: number) => ({
    data: { total, valor_estornado: 0, payment_status: "pago" },
    error: null,
  });

  it("item 2: erro na leitura das devoluções manuais vira erro (não saldo superestimado)", async () => {
    simularBanco((tabela) =>
      Promise.resolve(
        tabela === "marketplace_orders"
          ? pedido(100)
          : tabela === "devolucoes"
            ? { data: null, error: { message: "falhou" } }
            : { data: [], error: null },
      ),
    );
    const Sonda = await sonda();
    await act(async () => {
      raiz.render(createElement(Sonda, { orderId: "A" }));
    });
    expect(alvo.textContent).toContain("erro=true");
  });

  it("item 3: resposta atrasada do pedido antigo não sobrescreve o novo", async () => {
    let liberarA: () => void = () => {};
    const portaA = new Promise<void>((r) => {
      liberarA = r;
    });
    simularBanco(async (tabela, id) => {
      if (id === "A") await portaA;
      if (tabela === "marketplace_orders") return pedido(id === "A" ? 100 : 50);
      return { data: [], error: null };
    });
    const Sonda = await sonda();
    await act(async () => {
      raiz.render(createElement(Sonda, { orderId: "A" }));
    });
    await act(async () => {
      raiz.render(createElement(Sonda, { orderId: "B" }));
    });
    expect(alvo.textContent).toContain("pago=50");
    await act(async () => {
      liberarA();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(alvo.textContent).toContain("pago=50");
  });
});

describe("item 3: useDevolucaoDoPedidoCliente", () => {
  let raiz: Root;
  let alvo: HTMLElement;

  beforeEach(() => {
    mockFrom.mockReset();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
  });

  it("resposta atrasada do pedido antigo não sobrescreve o novo", async () => {
    let liberarA: () => void = () => {};
    const portaA = new Promise<void>((r) => {
      liberarA = r;
    });
    simularBanco(async (_tabela, id) => {
      if (id === "A") await portaA;
      return {
        data: [
          {
            amount: id === "A" ? 100 : 50,
            status: "concluido",
            solicitado_por: "x",
            concluido_em: null,
          },
        ],
        error: null,
      };
    });
    const { useDevolucaoDoPedidoCliente } = await import(
      "@/hooks/useDevolucaoDoPedidoCliente"
    );
    function Sonda({ orderId }: { orderId: string }) {
      const d = useDevolucaoDoPedidoCliente(orderId, true);
      return createElement("span", null, d.linhas.map((l) => l.amount).join());
    }
    await act(async () => {
      raiz.render(createElement(Sonda, { orderId: "A" }));
    });
    await act(async () => {
      raiz.render(createElement(Sonda, { orderId: "B" }));
    });
    expect(alvo.textContent).toBe("50");
    await act(async () => {
      liberarA();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(alvo.textContent).toBe("50");
  });
});
