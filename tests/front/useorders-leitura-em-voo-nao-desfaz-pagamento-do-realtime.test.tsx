// @vitest-environment jsdom
//
// A cliente paga o PIX: o realtime traz o pedido PAGO com `updated_at` T2. Uma
// leitura de pedidos que já estava no ar (a recarga por visibilidade dispara
// justamente isso) responde DEPOIS com a foto velha (aguardando, T1).
// `mesclarPedidosDaConsulta` compara `updatedAt` e mantém a versão nova — na
// lista e no cache do aparelho. Sem essa guarda, Meus pedidos e o cartão do
// Perfil voltam a dizer "Aguardando pagamento" e oferecem "Retomar pagamento"
// num pedido já pago.
//
// Os vizinhos (`useorders-pedido-novo-do-realtime-...`, etc.) montam toda linha
// com `updated_at: new Date(0)`, então a comparação nunca decidia nada: aqui o
// T1 < T2 < T3 é o que prova a guarda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pendente = { resolve: (corpo: unknown) => void };

const rede = vi.hoisted(() => ({
  pedidos: [] as Array<Pendente>,
  // Entrega do evento do canal, por filtro (um canal por usuário de teste).
  eventos: new Map<string, (payload: unknown) => Promise<void>>(),
}));
const conta = vi.hoisted(() => ({
  atual: "cliente-A",
  usuarios: new Map<string, { id: string }>(),
}));
type Pedido = { id: string; status: string; paymentStatus: string | null };
type Exposto = {
  fetchUserOrders: (silent?: boolean) => Promise<unknown>;
  orders: Pedido[];
};
// Um Map (e não campos soltos): escrever em campo de objeto de módulo dentro do
// componente é o que `react-hooks/immutability` barra.
const exposto = vi.hoisted(() => new Map<string, Exposto>());
const hook = () => exposto.get("atual") as Exposto;
const lista = () => hook().orders;

vi.mock("@/lib/supabase", () => {
  const builder = (tabela: string) => {
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: () => alvo,
      order: () => alvo,
      range: () => alvo,
      limit: () => alvo,
      or: () => alvo,
      in: () => alvo,
      abortSignal: () => alvo,
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
        new Promise((resolve) => {
          if (tabela === "marketplace_orders") {
            // A leitura da lista fica PENDURADA até o teste resolver.
            rede.pedidos.push({ resolve });
          } else {
            resolve({ data: [], error: null, count: 0 });
          }
        }).then(res, rej),
    });
    return alvo;
  };
  const canal = () => {
    const alvo: Record<string, unknown> = {
      on: (
        _tipo: string,
        filtro: { filter?: string },
        handler: (payload: unknown) => Promise<void>,
      ) => {
        rede.eventos.set(filtro.filter ?? "", handler);
        return alvo;
      },
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
      removeChannel: () => Promise.resolve(),
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
    return { user, isAdmin: false };
  },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Três instantes crescentes: a foto velha (T1), o pagamento (T2) e uma
// atualização ainda mais nova do servidor (T3).
const T1 = new Date("2026-11-10T10:00:00.000Z").toISOString();
const T2 = new Date("2026-11-10T10:05:00.000Z").toISOString();
const T3 = new Date("2026-11-10T10:10:00.000Z").toISOString();

const ID = "ped-pix-1";

const linha = (
  usuario: string,
  campos: { status: string; payment_status: string; updated_at: string },
) => ({
  id: ID,
  user_id: usuario,
  customer_name: "Cliente de teste",
  customer_data: {},
  items: [],
  total: 10,
  subtotal: 10,
  shipping: 0,
  discount: 0,
  payment_method: "pix",
  created_at: new Date(0).toISOString(),
  ...campos,
});

const aguardandoT1 = (u: string) =>
  linha(u, { status: "pending", payment_status: "aguardando", updated_at: T1 });
const pagoT2 = (u: string) =>
  linha(u, { status: "processing", payment_status: "pago", updated_at: T2 });
const enviadoT3 = (u: string) =>
  linha(u, { status: "shipping", payment_status: "pago", updated_at: T3 });

function Alvo() {
  exposto.set("atual", useOrders(true, false) as unknown as Exposto);
  return null;
}

describe("useOrders — leitura em voo com foto velha não desfaz o pagamento que o realtime trouxe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let usuario = "";
  let contador = 0;

  const chaveDoCache = () => `ikcous_orders_cache_${usuario}`;
  const cacheGravado = () =>
    JSON.parse(localStorage.getItem(chaveDoCache()) ?? "[]") as Array<{
      id: string;
      status: string;
      paymentStatus: string | null;
    }>;

  const eventoDeUpdate = (nova: unknown) => {
    const entregar = rede.eventos.get(`user_id=eq.${usuario}`);
    expect(entregar).toBeDefined();
    return entregar!({ eventType: "UPDATE", new: nova, old: { id: ID } });
  };

  // Monta e deixa a lista com o pedido aguardando (T1), como estava na tela
  // antes de a cliente pagar.
  async function montarComPedidoAguardando() {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Alvo />);
    });
    let primeira!: Promise<unknown>;
    await act(async () => {
      primeira = hook().fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(1);
    await act(async () => {
      rede.pedidos[0].resolve({ data: [aguardandoT1(usuario)], error: null });
      await primeira;
    });
    expect(lista()).toHaveLength(1);
    expect(lista()[0].paymentStatus).toBe("aguardando");
    expect(lista()[0].status).toBe("pending");
  }

  beforeEach(() => {
    contador += 1;
    usuario = `cliente-pagamento-${contador}`;
    conta.atual = usuario;
    rede.pedidos.length = 0;
    exposto.clear();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("o pagamento (T2) chega pelo realtime e a leitura em voo responde depois com a foto velha (T1): lista e cache continuam PAGOS", async () => {
    await montarComPedidoAguardando();

    // Segunda leitura (a da recarga por visibilidade): sai e fica pendurada.
    let emVoo!: Promise<unknown>;
    await act(async () => {
      emVoo = hook().fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(2);

    // Enquanto ela voa, a cliente paga: o realtime traz T2.
    await act(async () => {
      await eventoDeUpdate(pagoT2(usuario));
    });
    expect(lista()[0].paymentStatus).toBe("pago");

    // A leitura em voo responde com o retrato de ANTES do pagamento.
    await act(async () => {
      rede.pedidos[1].resolve({ data: [aguardandoT1(usuario)], error: null });
      await emVoo;
    });

    expect(lista()).toHaveLength(1);
    expect(lista()[0].paymentStatus).toBe("pago");
    expect(lista()[0].status).toBe("processing");
    // O que o aparelho guarda para a próxima abertura também é o pago.
    const cache = cacheGravado();
    expect(cache).toHaveLength(1);
    expect(cache[0].paymentStatus).toBe("pago");
    expect(cache[0].status).toBe("processing");
  });

  it("controle: a resposta da leitura com T3 maior que T2 SUBSTITUI a versão do realtime (a guarda não congela o pedido)", async () => {
    await montarComPedidoAguardando();

    let emVoo!: Promise<unknown>;
    await act(async () => {
      emVoo = hook().fetchUserOrders(true);
    });
    await act(async () => {
      await eventoDeUpdate(pagoT2(usuario));
    });
    expect(lista()[0].status).toBe("processing");

    await act(async () => {
      rede.pedidos[1].resolve({ data: [enviadoT3(usuario)], error: null });
      await emVoo;
    });

    expect(lista()[0].status).toBe("shipping");
    expect(lista()[0].paymentStatus).toBe("pago");
    expect(cacheGravado()[0].status).toBe("shipping");
  });

  it("evento e resposta no MESMO lote do React (o updater do setOrders decide): a foto velha não desfaz o pagamento", async () => {
    await montarComPedidoAguardando();

    let emVoo!: Promise<unknown>;
    await act(async () => {
      emVoo = hook().fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(2);

    // Tudo dentro de UM act: o evento enfileira o setOrders do pagamento e a
    // resposta velha chega antes de o React renderizar — `ordersRef` ainda é
    // o T1, só o updater enxerga o estado mais recente.
    await act(async () => {
      await eventoDeUpdate(pagoT2(usuario));
      rede.pedidos[1].resolve({ data: [aguardandoT1(usuario)], error: null });
      await emVoo;
    });

    expect(lista()).toHaveLength(1);
    expect(lista()[0].paymentStatus).toBe("pago");
    expect(lista()[0].status).toBe("processing");
  });
});
