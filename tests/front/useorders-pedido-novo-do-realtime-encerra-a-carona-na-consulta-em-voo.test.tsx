// @vitest-environment jsdom
//
// Complemento de `useorders-leitura-do-cliente-compartilha-consulta-em-voo`.
// As instâncias de `useOrders` da cliente compartilham a consulta de rede em
// voo. A consulta Q é um RETRATO do banco tirado antes de um pedido novo X. Se
// X chega pelo realtime enquanto Q voa, quem pede DEPOIS não pode pegar carona
// em Q: o `idsNoInicio` dessa instância já contém X (o realtime o pôs na
// lista), Q não o traz, e `mesclarPedidosDaConsulta` entende que X "já estava
// lá e o servidor apagou" — X sumia da lista e do cache da cliente. O INSERT
// do realtime tem de encerrar o compartilhamento: quem pede depois abre uma
// consulta nova (que já enxerga X); quem já esperava por Q segue esperando.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pendente = {
  usuario: string | null;
  resolve: (corpo: unknown) => void;
};

const rede = vi.hoisted(() => ({
  pedidos: [] as Array<Pendente>,
  // Linha que a leitura por id (a do INSERT do realtime) devolve.
  porId: new Map<string, unknown>(),
  // Entrega do evento do canal, por filtro (um canal por usuário de teste).
  eventos: new Map<string, (payload: unknown) => Promise<void>>(),
}));
const conta = vi.hoisted(() => ({
  atual: "cliente-A",
  usuarios: new Map<string, { id: string }>(),
}));
const exposto = vi.hoisted(() => ({
  instancias: new Map<
    string,
    {
      fetchUserOrders: (silent?: boolean) => Promise<unknown>;
      orders: Array<{ id: string }>;
    }
  >(),
}));

vi.mock("@/lib/supabase", () => {
  const builder = (tabela: string) => {
    let usuario: string | null = null;
    let idAlvo: string | null = null;
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: (coluna: string, valor: string) => {
        if (coluna === "user_id") usuario = valor;
        if (coluna === "id") idAlvo = valor;
        return alvo;
      },
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
          if (tabela === "marketplace_orders" && idAlvo) {
            // Leitura por id do INSERT do realtime: responde na hora.
            resolve({ data: rede.porId.get(idAlvo) ?? null, error: null });
          } else if (tabela === "marketplace_orders") {
            rede.pedidos.push({ usuario, resolve });
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

const linha = (id: string, usuario: string) => ({
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

function definirContaDoRender(usuario: string) {
  conta.atual = usuario;
}

function Alvo({ nome, usuario }: { nome: string; usuario: string }) {
  // A conta é lida pelo `useAuth` dublê DURANTE este render, logo abaixo.
  definirContaDoRender(usuario);
  const hook = useOrders(true, false) as unknown as {
    fetchUserOrders: (silent?: boolean) => Promise<unknown>;
    orders: Array<{ id: string }>;
  };
  exposto.instancias.set(nome, {
    fetchUserOrders: hook.fetchUserOrders,
    orders: hook.orders,
  });
  return null;
}

describe("useOrders — pedido novo do realtime encerra a carona na consulta em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Um usuário por teste: o canal do realtime e a consulta compartilhada são de
  // módulo, e usuário próprio isola um teste do outro.
  let usuario = "";
  let contador = 0;

  async function montar(nomes: string[]) {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        nomes.map((nome) => <Alvo key={nome} nome={nome} usuario={usuario} />),
      );
    });
  }

  const ids = (nome: string) =>
    (exposto.instancias.get(nome)?.orders ?? []).map((o) => o.id);

  const chegaPeloRealtime = async (idDoPedido: string) => {
    const entregar = rede.eventos.get(`user_id=eq.${usuario}`);
    expect(entregar).toBeDefined();
    await act(async () => {
      await entregar!({
        eventType: "INSERT",
        new: { id: idDoPedido },
        old: {},
      });
    });
  };

  beforeEach(() => {
    contador += 1;
    usuario = `cliente-realtime-${contador}`;
    conta.atual = usuario;
    rede.pedidos.length = 0;
    rede.porId.clear();
    exposto.instancias.clear();
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

  it("pedido X chega pelo realtime durante a consulta Q: quem pede depois NÃO pega carona em Q e X continua na lista dela", async () => {
    await montar(["a", "b"]);

    // "a" abre Q (retrato do banco SEM o pedido X).
    let leituraA!: Promise<unknown>;
    await act(async () => {
      leituraA = exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(1);

    // X nasce e chega pelo realtime enquanto Q ainda voa.
    rede.porId.set("ped-X", linha("ped-X", usuario));
    await chegaPeloRealtime("ped-X");
    expect(ids("b")).toContain("ped-X");

    // "b" pede DEPOIS: o `idsNoInicio` dela já tem X.
    let leituraB!: Promise<unknown>;
    await act(async () => {
      leituraB = exposto.instancias.get("b")!.fetchUserOrders(true);
    });

    // Q chega, antiga: não traz X.
    await act(async () => {
      rede.pedidos[0].resolve({ data: [], error: null });
      await leituraA;
    });
    // Se "b" abriu consulta nova (já enxerga X), ela responde com X.
    if (rede.pedidos[1]) {
      await act(async () => {
        rede.pedidos[1].resolve({
          data: [linha("ped-X", usuario)],
          error: null,
        });
      });
    }
    await act(async () => {
      await leituraB;
    });

    expect(ids("b")).toContain("ped-X");
    expect(ids("a")).toContain("ped-X");
    // E o motivo: "b" abriu a SUA consulta, não pegou carona em Q.
    expect(rede.pedidos).toHaveLength(2);
  });

  it("a consulta nova não é apagada quando a antiga termina: o terceiro a pedir pega carona na NOVA", async () => {
    await montar(["a", "b", "c"]);

    let leituraA!: Promise<unknown>;
    await act(async () => {
      leituraA = exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    rede.porId.set("ped-X", linha("ped-X", usuario));
    await chegaPeloRealtime("ped-X");
    await act(async () => {
      void exposto.instancias.get("b")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(2);

    // A consulta ANTIGA termina (e o `finally`/`liberar` dela roda).
    await act(async () => {
      rede.pedidos[0].resolve({ data: [], error: null });
      await leituraA;
    });

    // A NOVA ainda voa e continua compartilhada: "c" não abre a terceira.
    await act(async () => {
      void exposto.instancias.get("c")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(2);

    await act(async () => {
      rede.pedidos[1].resolve({
        data: [linha("ped-X", usuario)],
        error: null,
      });
    });
    expect(ids("c")).toEqual(["ped-X"]);
  });

  it("quem já esperava por Q continua recebendo a resposta de Q (a carona anterior não é cancelada)", async () => {
    await montar(["a", "b"]);

    let leituraA!: Promise<unknown>;
    let leituraB!: Promise<unknown>;
    await act(async () => {
      leituraA = exposto.instancias.get("a")!.fetchUserOrders(true);
      leituraB = exposto.instancias.get("b")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(1);

    rede.porId.set("ped-X", linha("ped-X", usuario));
    await chegaPeloRealtime("ped-X");

    await act(async () => {
      rede.pedidos[0].resolve({
        data: [linha("ped-antigo", usuario)],
        error: null,
      });
      await Promise.all([leituraA, leituraB]);
    });

    // Os dois esperavam por Q desde antes de X: ambos ficam com o antigo E com X.
    expect(ids("a").sort()).toEqual(["ped-X", "ped-antigo"]);
    expect(ids("b").sort()).toEqual(["ped-X", "ped-antigo"]);
    expect(rede.pedidos).toHaveLength(1);
  });

  it("INSERT de pedido de OUTRA conta (descartado) não desfaz o compartilhamento", async () => {
    await montar(["a", "b"]);

    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(1);

    // A leitura por id devolve um pedido que não é desta cliente.
    rede.porId.set("ped-alheio", linha("ped-alheio", "outra-cliente"));
    await chegaPeloRealtime("ped-alheio");

    await act(async () => {
      void exposto.instancias.get("b")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(1);
  });
});
