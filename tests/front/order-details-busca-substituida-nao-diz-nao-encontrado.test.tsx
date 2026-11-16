// @vitest-environment jsdom
//
// Falso "Pedido não encontrado" no detalhe do pedido (dado de cliente).
//
// A cliente (sem cópia do pedido neste aparelho) abre o detalhe: a busca A fica
// em voo. Ela sai e volta ao app: a recarga por visibilidade (500 ms depois)
// abre a busca B e CANCELA a A. A cancelada devolvia `[]` sem erro, a ficha lia
// "lista vazia" como "esse pedido não existe" e dizia "Pedido não encontrado"
// enquanto a B ainda corria -- logo depois de PAGAR, o susto que induz a
// segunda compra. Busca CANCELADA não é busca que confirmou ausência.
//
// Aqui o hook `useOrders` e a ficha são os REAIS; só a rede (supabase) é
// controlada à mão, uma promessa em aberto por consulta, para decidir a ordem.
// Contrato provado:
//   - durante a B: "Sincronizando pedido…", NUNCA "Pedido não encontrado";
//   - B traz o pedido: a ficha o mostra; B falha ou estoura o prazo: erro com
//     "Tentar de novo"; B responde VÁLIDA sem o pedido: "Pedido não encontrado";
//   - cadeia A -> B -> C: só a última manda;
//   - quem NÃO pede para seguir a substituta (as outras telas) continua
//     recebendo `[]` na hora; e a espera nunca atravessa a troca de conta.
import { act, useEffect } from "react";
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
type Buscar = (
  silent?: boolean,
  opcoes?: { aguardarSubstituta?: boolean },
) => Promise<unknown>;
const exposto = vi.hoisted(() => ({
  fetchUserOrders: null as null | Buscar,
  aoTrocarDeLeitura: null as null | ((buscar: Buscar) => void),
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

import { PRAZO_DA_CONSULTA_DE_PEDIDOS_MS, useOrders } from "@/hooks/useOrders";
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

const ID_DO_PEDIDO = "pedido-777";
const NAO_ENCONTRADO = "Pedido não encontrado";

describe("OrderDetailsView — busca substituída não é 'pedido não encontrado'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrirDetalhe() {
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={ID_DO_PEDIDO}
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

  // Sai e volta ao app: a recarga por visibilidade abre a busca seguinte 500 ms
  // depois e cancela a que estava em voo.
  async function voltarAoApp() {
    await act(async () => {
      globalThis.dispatchEvent(new Event("visibilitychange"));
    });
    await passar(500);
  }

  const texto = () => hospedeiro.textContent ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    rede.pedidos.length = 0;
    conta.atual = "cliente-1";
    localStorage.clear();
    sessionStorage.clear();
    // Aparelho com cache da conta, mas SEM este pedido (comprou em outro).
    localStorage.setItem(
      "ikcous_orders_cache_cliente-1",
      JSON.stringify([{ ...linha("outro-pedido"), id: "outro-pedido" }]),
    );
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

  it("durante a busca que substituiu a cancelada: 'Sincronizando', nunca 'não encontrado'; ao chegar, mostra o pedido", async () => {
    await abrirDetalhe();
    expect(rede.pedidos).toHaveLength(1); // A em voo
    expect(texto()).toContain("Sincronizando");

    await voltarAoApp();
    expect(rede.pedidos).toHaveLength(2); // B abriu e cancelou a A
    await passar(0);

    // A já voltou cancelada; a B ainda corre.
    expect(texto()).toContain("Sincronizando");
    expect(texto()).not.toContain(NAO_ENCONTRADO);

    await act(async () => {
      rede.pedidos[1].resolve({ data: [linha(ID_DO_PEDIDO)], error: null });
    });
    await passar(0);

    expect(texto()).not.toContain(NAO_ENCONTRADO);
    expect(texto()).not.toContain("Sincronizando");
    expect(texto()).toContain("Meu pedido");
  });

  it("a busca substituta falha: erro com 'Tentar de novo', nunca 'não encontrado'", async () => {
    await abrirDetalhe();
    await voltarAoApp();
    await passar(0);
    expect(texto()).not.toContain(NAO_ENCONTRADO);

    await act(async () => {
      rede.pedidos[1].resolve({ data: null, error: { message: "boom" } });
    });
    await passar(0);

    expect(texto()).not.toContain(NAO_ENCONTRADO);
    expect(texto()).toContain("Não conseguimos carregar agora");
    expect(texto()).toContain("Tentar de novo");
  });

  it("a busca substituta estoura o prazo: erro com 'Tentar de novo', e 'Sincronizando' até lá", async () => {
    await abrirDetalhe();
    await voltarAoApp();
    await passar(0);

    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS - 600);
    expect(texto()).toContain("Sincronizando");
    expect(texto()).not.toContain(NAO_ENCONTRADO);

    await passar(1000);
    expect(texto()).not.toContain(NAO_ENCONTRADO);
    expect(texto()).toContain("Não conseguimos carregar agora");
    expect(texto()).toContain("Tentar de novo");
  });

  it("a busca substituta responde VÁLIDA sem o pedido: continua 'Pedido não encontrado'", async () => {
    await abrirDetalhe();
    await voltarAoApp();
    await passar(0);
    expect(texto()).toContain("Sincronizando");

    await act(async () => {
      rede.pedidos[1].resolve({
        data: [linha("outro-pedido")],
        error: null,
      });
    });
    await passar(0);

    expect(texto()).toContain(NAO_ENCONTRADO);
    expect(texto()).not.toContain("Sincronizando");
  });

  it("resposta válida e VAZIA da substituta (conta sem nenhum pedido): 'Pedido não encontrado'", async () => {
    await abrirDetalhe();
    await voltarAoApp();
    await passar(0);

    await act(async () => {
      rede.pedidos[1].resolve({ data: [], error: null });
    });
    await passar(0);

    expect(texto()).toContain(NAO_ENCONTRADO);
  });

  it("sem substituição nenhuma: a busca da abertura que responde válida sem o pedido diz 'não encontrado'", async () => {
    await abrirDetalhe();
    await act(async () => {
      rede.pedidos[0].resolve({ data: [linha("outro-pedido")], error: null });
    });
    await passar(0);

    expect(texto()).toContain(NAO_ENCONTRADO);
  });

  it("cadeia A -> B -> C: só a última busca decide; a B cancelada também não vira 'não encontrado'", async () => {
    await abrirDetalhe();
    await voltarAoApp(); // B cancela A
    await voltarAoApp(); // C cancela B
    expect(rede.pedidos).toHaveLength(3);
    await passar(0);

    expect(texto()).toContain("Sincronizando");
    expect(texto()).not.toContain(NAO_ENCONTRADO);

    await act(async () => {
      rede.pedidos[2].resolve({ data: [linha(ID_DO_PEDIDO)], error: null });
    });
    await passar(0);

    expect(texto()).not.toContain(NAO_ENCONTRADO);
    expect(texto()).toContain("Meu pedido");
  });
});

// O contrato do hook em si: a espera é opt-in e nunca atravessa a conta.
describe("useOrders.fetchUserOrders — seguir a busca substituta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  function Alvo() {
    const hook = useOrders(true, false) as unknown as {
      fetchUserOrders: NonNullable<typeof exposto.fetchUserOrders>;
    };
    useEffect(() => {
      exposto.fetchUserOrders = hook.fetchUserOrders;
    });
    // Mesmo molde da ficha: refaz a leitura quando `fetchUserOrders` troca.
    useEffect(() => {
      exposto.aoTrocarDeLeitura?.(hook.fetchUserOrders);
    }, [hook.fetchUserOrders]);
    return null;
  }

  async function montar() {
    await act(async () => {
      raiz.render(<Alvo />);
    });
  }

  // Dispara a leitura sem esperá-la e marca quando ela termina.
  async function iniciar(
    silencioso: boolean,
    opcoes?: { aguardarSubstituta?: boolean },
  ) {
    const marca: { terminou: boolean; valor: unknown } = {
      terminou: false,
      valor: undefined,
    };
    await act(async () => {
      void exposto.fetchUserOrders!(silencioso, opcoes).then((valor) => {
        marca.terminou = true;
        marca.valor = valor;
      });
    });
    return marca;
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    rede.pedidos.length = 0;
    conta.atual = "cliente-1";
    exposto.fetchUserOrders = null;
    exposto.aoTrocarDeLeitura = null;
    localStorage.clear();
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
  });

  it("sem pedir: a leitura cancelada por outra continua devolvendo [] na hora (contrato das outras telas)", async () => {
    await montar();
    const a = await iniciar(false);
    await iniciar(true);
    await passar(0);

    expect(a.terminou).toBe(true);
    expect(a.valor).toEqual([]);
  });

  it("pedindo: a leitura cancelada espera a substituta e devolve o que ELA trouxe", async () => {
    await montar();
    const a = await iniciar(false, { aguardarSubstituta: true });
    await iniciar(true);
    await passar(0);
    expect(a.terminou).toBe(false);

    await act(async () => {
      rede.pedidos[1].resolve({ data: [linha("ped-1")], error: null });
    });
    await passar(0);

    expect(a.terminou).toBe(true);
    expect(a.valor).toEqual([expect.objectContaining({ id: "ped-1" })]);
  });

  it("pedindo, mas a conta trocou: a leitura da conta nova abre NO MESMO commit (como a ficha) e a antiga devolve [], nunca os pedidos da conta nova", async () => {
    // A ficha refaz a busca num efeito que depende de `fetchUserOrders`, que
    // troca com a conta: a limpeza do hook cancela a leitura da conta 1 e, no
    // mesmo commit, a leitura da conta 2 já abriu -- quando a antiga acorda, a
    // vigente é da OUTRA conta.
    exposto.aoTrocarDeLeitura = (buscar) => {
      if (conta.atual === "cliente-2") void buscar(true);
    };
    await montar();
    const a = await iniciar(false, { aguardarSubstituta: true });

    conta.atual = "cliente-2";
    await montar(); // a troca de id cancela a leitura da conta 1 e abre a da 2
    await passar(0);
    expect(rede.pedidos).toHaveLength(2);
    expect(rede.pedidos[1].usuario).toBe("cliente-2");

    await act(async () => {
      rede.pedidos[1].resolve({
        data: [linha("ped-da-conta-2", "cliente-2")],
        error: null,
      });
    });
    await passar(0);

    expect(a.terminou).toBe(true);
    expect(a.valor).toEqual([]);
  });

  it("pedindo, mas o desmonte cancelou a leitura (nenhuma substituta): devolve [] na hora", async () => {
    await montar();
    const a = await iniciar(false, { aguardarSubstituta: true });

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await passar(0);

    expect(a.terminou).toBe(true);
    expect(a.valor).toEqual([]);
  });
});
