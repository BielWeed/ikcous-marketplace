// @vitest-environment jsdom
//
// Link de pedido com letras MAIÚSCULAS dizia "Pedido não encontrado".
//
// A rota `/order-details?id=AAAAAAAA-BBBB-...` preserva as maiúsculas do id, mas
// o banco devolve o uuid em minúsculas e a ficha comparava com `===`: a cliente
// com o link certo (colado de um e-mail ou de um editor que põe tudo em caixa
// alta) via o susto de um pedido que existe. A comparação agora ignora a caixa.
//
// A ficha e o hook `useOrders` são os REAIS; só a rede (supabase) é controlada à
// mão, uma promessa em aberto por consulta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pendente = {
  usuario: string | null;
  resolve: (corpo: unknown) => void;
  reject: (erro: unknown) => void;
};

const rede = vi.hoisted(() => ({
  pedidos: [] as Array<Pendente>,
}));
const conta = vi.hoisted(() => ({
  atual: "cliente-1",
  usuarios: new Map<string, { id: string }>(),
}));

vi.mock("@/lib/supabase", () => {
  const builder = (tabela: string) => {
    let usuario: string | null = null;
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: (coluna: string, valor: string) => {
        if (coluna === "user_id") usuario = valor;
        return alvo;
      },
      order: () => alvo,
      range: () => alvo,
      limit: () => alvo,
      or: () => alvo,
      in: () => alvo,
      // O cancelamento real é do `consultarPedidosDoCliente` (ele rejeita com
      // AbortError sozinho); o transporte aqui só ignora o sinal.
      abortSignal: () => alvo,
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
        new Promise((resolve, reject) => {
          if (tabela === "marketplace_orders") {
            rede.pedidos.push({ usuario, resolve, reject });
          } else {
            resolve({ data: [], error: null, count: 0 });
          }
        }).then(res, rej),
    });
    return alvo;
  };
  const canal = () => {
    const alvo: Record<string, unknown> = {
      on: () => alvo,
      subscribe: (cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return alvo;
      },
    };
    return alvo;
  };
  return {
    supabase: {
      from: (tabela: string) => builder(tabela),
      rpc: () => builder("rpc"),
      channel: () => canal(),
      removeChannel: () => Promise.resolve("ok"),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    let user = conta.usuarios.get(conta.atual);
    if (!user) {
      user = { id: conta.atual };
      conta.usuarios.set(conta.atual, user);
    }
    return { user, isAdmin: false, loading: false };
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { whatsappNumber: "34999999999" } }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { OrderDetailsView } from "@/views/customer/OrderDetailsView";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const linha = (id: string, usuario = "cliente-1") => ({
  id,
  user_id: usuario,
  customer_name: "Cliente de teste",
  customer_data: {},
  items: [],
  total: 10,
  subtotal: 10,
  shipping: 0,
  discount: 0,
  payment_method: "pix",
  payment_status: "aguardando",
  status: "pending",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

const ID_NO_BANCO = "abcdef12-3456-4789-8abc-def012345678";
const ID_DA_URL = ID_NO_BANCO.toUpperCase();
const NAO_ENCONTRADO = "Pedido não encontrado";

describe("OrderDetailsView — id da URL em maiúsculas acha o pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrirDetalhe(orderId: string) {
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={orderId}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    rede.pedidos.length = 0;
    conta.atual = "cliente-1";
    localStorage.clear();
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("link com o id em MAIÚSCULAS e o banco devolvendo minúsculas: mostra o pedido", async () => {
    await abrirDetalhe(ID_DA_URL);
    expect(rede.pedidos).toHaveLength(1);

    await act(async () => {
      rede.pedidos[0].resolve({ data: [linha(ID_NO_BANCO)], error: null });
    });
    await passar(0);

    expect(texto()).not.toContain(NAO_ENCONTRADO);
    expect(texto()).toContain("Meu pedido");
  });

  it("controle: o mesmo link em minúsculas continua mostrando o pedido", async () => {
    await abrirDetalhe(ID_NO_BANCO);
    await act(async () => {
      rede.pedidos[0].resolve({ data: [linha(ID_NO_BANCO)], error: null });
    });
    await passar(0);

    expect(texto()).not.toContain(NAO_ENCONTRADO);
    expect(texto()).toContain("Meu pedido");
  });

  it("controle: id de OUTRO pedido segue sendo 'Pedido não encontrado' (a caixa não vira curinga)", async () => {
    await abrirDetalhe(ID_DA_URL);
    await act(async () => {
      rede.pedidos[0].resolve({
        data: [linha("11111111-2222-4333-8444-555555555555")],
        error: null,
      });
    });
    await passar(0);

    expect(texto()).toContain(NAO_ENCONTRADO);
  });
});
