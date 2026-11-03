// @vitest-environment jsdom
//
// Achado f15 (caça 5): as abas Carrinho e Perfil ficam montadas no fundo e cada
// uma tem a SUA instância de `useOrders(true, false)`. Ao voltar do banco/WhatsApp
// os listeners de `visibilitychange` de TODAS as instâncias recarregam a lista de
// pedidos da cliente: N consultas idênticas (pedidos + itens + endereço) em vez
// de uma. A correção compartilha, entre instâncias, a consulta de rede em voo
// por usuário. Este arquivo prende:
//   - N instâncias do MESMO usuário => UMA consulta de rede, e o resultado chega
//     a todas;
//   - o cancelamento é por instância: quem cancela não derruba a consulta das
//     outras, e a consulta só é cancelada de verdade quando não resta ninguém
//     esperando por ela;
//   - usuários diferentes nunca se misturam;
//   - leitura pedida pela cliente (não silenciosa) nunca pega carona numa
//     consulta que já voava antes do pedido (não devolve dado velho);
//   - consulta que terminou (ok ou falha) sai do compartilhamento.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pendente = {
  usuario: string | null;
  sinal: AbortSignal | null;
  resolve: (corpo: unknown) => void;
  reject: (erro: unknown) => void;
};

const rede = vi.hoisted(() => ({
  pedidos: [] as Array<Pendente>,
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
      ordersLoadError: unknown;
      orders: Array<{ id: string }>;
    }
  >(),
}));
const visibilidade = vi.hoisted(() => ({ estado: "visible" }));

vi.mock("@/lib/supabase", () => {
  const builder = (tabela: string) => {
    let usuario: string | null = null;
    let sinal: AbortSignal | null = null;
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
      // Só REGISTRA o sinal (cancelar é pedido ao transporte).
      abortSignal: (s: AbortSignal) => {
        sinal = s;
        return alvo;
      },
      single: () => alvo,
      maybeSingle: () => alvo,
    };
    // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
    Object.defineProperty(alvo, "then", {
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) =>
        new Promise((resolve, reject) => {
          if (tabela === "marketplace_orders") {
            rede.pedidos.push({ usuario, sinal, resolve, reject });
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
      removeChannel: () => {},
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
    ordersLoadError?: unknown;
    orders: Array<{ id: string }>;
  };
  exposto.instancias.set(nome, {
    fetchUserOrders: hook.fetchUserOrders,
    ordersLoadError: hook.ordersLoadError,
    orders: hook.orders,
  });
  return null;
}

describe("useOrders — a leitura dos pedidos da cliente é compartilhada entre instâncias", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let descritorOriginal: PropertyDescriptor | undefined;

  async function montar(instancias: Array<[string, string]>) {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await renderizar(instancias);
  }

  async function renderizar(instancias: Array<[string, string]>) {
    await act(async () => {
      raiz.render(
        <>
          {instancias.map(([nome, usuario]) => (
            <Alvo key={nome} nome={nome} usuario={usuario} />
          ))}
        </>,
      );
    });
  }

  const ids = (nome: string) =>
    (exposto.instancias.get(nome)?.orders ?? []).map((o) => o.id);

  beforeEach(() => {
    rede.pedidos.length = 0;
    conta.atual = "cliente-A";
    exposto.instancias.clear();
    visibilidade.estado = "visible";
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    descritorOriginal = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade.estado,
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    if (descritorOriginal) {
      Object.defineProperty(document, "visibilityState", descritorOriginal);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("3 instâncias do mesmo usuário recarregando em silêncio fazem UMA consulta e todas recebem o resultado", async () => {
    await montar([
      ["a", "cliente-A"],
      ["b", "cliente-A"],
      ["c", "cliente-A"],
    ]);

    const retornos: Array<Promise<unknown>> = [];
    await act(async () => {
      for (const nome of ["a", "b", "c"]) {
        retornos.push(exposto.instancias.get(nome)!.fetchUserOrders(true));
      }
    });

    expect(rede.pedidos).toHaveLength(1);
    expect(rede.pedidos[0].usuario).toBe("cliente-A");

    await act(async () => {
      rede.pedidos[0].resolve({
        data: [linha("ped-1", "cliente-A")],
        error: null,
      });
      await Promise.all(retornos);
    });

    expect(ids("a")).toEqual(["ped-1"]);
    expect(ids("b")).toEqual(["ped-1"]);
    expect(ids("c")).toEqual(["ped-1"]);
    // O valor devolvido a cada chamada também é a lista mapeada.
    const devolvidos = (await Promise.all(retornos)) as Array<
      Array<{ id: string }>
    >;
    for (const lista of devolvidos) {
      expect(lista.map((o) => o.id)).toEqual(["ped-1"]);
    }
    // O cache local da cliente foi gravado.
    expect(localStorage.getItem("ikcous_orders_cache_cliente-A")).toContain(
      "ped-1",
    );
  });

  it("voltar para o app (visibilitychange) com duas abas montadas faz UMA consulta", async () => {
    vi.useFakeTimers();
    await montar([
      ["carrinho", "cliente-A"],
      ["perfil", "cliente-A"],
    ]);
    expect(rede.pedidos).toHaveLength(0);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    // O React confirma os efeitos num `act` SEPARADO do avanço do relógio.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await act(async () => {});

    expect(rede.pedidos).toHaveLength(1);

    await act(async () => {
      rede.pedidos[0].resolve({
        data: [linha("ped-v", "cliente-A")],
        error: null,
      });
    });
    await act(async () => {});
    expect(ids("carrinho")).toEqual(["ped-v"]);
    expect(ids("perfil")).toEqual(["ped-v"]);
  });

  it("cancelamento é por instância: uma sai da tela e a outra ainda recebe a resposta", async () => {
    await montar([
      ["a", "cliente-A"],
      ["b", "cliente-A"],
    ]);
    const fetchB = exposto.instancias.get("b")!.fetchUserOrders;
    let leituraB!: Promise<unknown>;
    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
      leituraB = fetchB(true);
    });
    expect(rede.pedidos).toHaveLength(1);
    const sinal = rede.pedidos[0].sinal!;
    expect(sinal.aborted).toBe(false);

    // A instância "a" desmonta (cancela a leitura dela).
    await renderizar([["b", "cliente-A"]]);
    // A consulta compartilhada NÃO foi cancelada: "b" ainda espera por ela.
    expect(sinal.aborted).toBe(false);

    await act(async () => {
      rede.pedidos[0].resolve({
        data: [linha("ped-b", "cliente-A")],
        error: null,
      });
      await leituraB;
    });
    expect(ids("b")).toEqual(["ped-b"]);
  });

  it("quando NINGUÉM mais espera, a consulta é cancelada de verdade", async () => {
    await montar([
      ["a", "cliente-A"],
      ["b", "cliente-A"],
    ]);
    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
      void exposto.instancias.get("b")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(1);
    const sinal = rede.pedidos[0].sinal!;

    await renderizar([]);

    expect(sinal.aborted).toBe(true);
  });

  it("usuários diferentes não se misturam: cada um faz a sua consulta e só recebe os seus pedidos", async () => {
    await montar([
      ["a", "cliente-A"],
      ["b", "cliente-B"],
    ]);
    let leituraA!: Promise<unknown>;
    let leituraB!: Promise<unknown>;
    await act(async () => {
      leituraA = exposto.instancias.get("a")!.fetchUserOrders(true);
      leituraB = exposto.instancias.get("b")!.fetchUserOrders(true);
    });

    expect(rede.pedidos).toHaveLength(2);
    expect(rede.pedidos.map((p) => p.usuario).sort()).toEqual([
      "cliente-A",
      "cliente-B",
    ]);

    // Responde na ordem inversa de propósito.
    const deB = rede.pedidos.find((p) => p.usuario === "cliente-B")!;
    const deA = rede.pedidos.find((p) => p.usuario === "cliente-A")!;
    await act(async () => {
      deB.resolve({ data: [linha("ped-B", "cliente-B")], error: null });
      deA.resolve({ data: [linha("ped-A", "cliente-A")], error: null });
      await Promise.all([leituraA, leituraB]);
    });

    expect(ids("a")).toEqual(["ped-A"]);
    expect(ids("b")).toEqual(["ped-B"]);
  });

  it("leitura NÃO silenciosa (pedida pela cliente) não pega carona numa consulta que já voava", async () => {
    await montar([
      ["a", "cliente-A"],
      ["b", "cliente-A"],
    ]);
    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    await act(async () => {
      void exposto.instancias.get("b")!.fetchUserOrders(false);
    });

    expect(rede.pedidos).toHaveLength(2);
  });

  it("consulta que terminou sai do compartilhamento: a próxima recarga consulta de novo", async () => {
    await montar([["a", "cliente-A"]]);
    let primeira!: Promise<unknown>;
    await act(async () => {
      primeira = exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    await act(async () => {
      rede.pedidos[0].resolve({ data: [], error: null });
      await primeira;
    });
    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
    });

    expect(rede.pedidos).toHaveLength(2);
  });

  it("falha na consulta compartilhada chega a todas as instâncias e também libera a próxima", async () => {
    await montar([
      ["a", "cliente-A"],
      ["b", "cliente-A"],
    ]);
    const retornos: Array<Promise<unknown>> = [];
    await act(async () => {
      retornos.push(exposto.instancias.get("a")!.fetchUserOrders(true));
      retornos.push(exposto.instancias.get("b")!.fetchUserOrders(true));
    });
    expect(rede.pedidos).toHaveLength(1);

    await act(async () => {
      rede.pedidos[0].resolve({
        data: null,
        error: { message: "Failed to fetch" },
      });
      await Promise.all(retornos);
    });
    expect(exposto.instancias.get("a")!.ordersLoadError).not.toBeNull();
    expect(exposto.instancias.get("b")!.ordersLoadError).not.toBeNull();

    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    expect(rede.pedidos).toHaveLength(2);
  });

  it("a MESMA instância que pede de novo cancela a anterior e consulta de novo (comportamento de antes)", async () => {
    await montar([["a", "cliente-A"]]);
    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
    });
    await act(async () => {
      void exposto.instancias.get("a")!.fetchUserOrders(true);
    });

    expect(rede.pedidos).toHaveLength(2);
    expect(rede.pedidos[0].sinal!.aborted).toBe(true);
    expect(rede.pedidos[1].sinal!.aborted).toBe(false);
  });
});
