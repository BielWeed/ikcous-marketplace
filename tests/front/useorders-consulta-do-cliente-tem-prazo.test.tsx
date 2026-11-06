// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e não responde) na consulta dos pedidos DA CLIENTE.
//
// Só a leitura silenciosa tinha um limite (de carona, 15 s); a consulta normal
// -- a de quem toca no aviso de pedido ou abre a aba Pedidos -- não tinha
// prazo nenhum: `loading` ficava ligado para sempre e a tela girava sem erro e
// sem "Tentar de novo". Contrato provado aqui (fake timers + promessa que não
// resolve):
//   - estourou o prazo -> `ordersLoadError` setado, `loading` solto, retorno []
//     (o contrato antigo de quem só espera a promessa) e a frase em português;
//   - o estouro NÃO é AbortError (o catch engole abortos em silêncio);
//   - resposta dentro do prazo -> nenhum erro e nenhum relógio sobrando;
//   - conta trocada durante a espera -> o estouro não vira erro da conta nova;
//   - resposta que chega DEPOIS do estouro não regrava a lista;
//   - "Tentar de novo" depois do estouro funciona.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  modo: "pendurado" as "pendurado" | "ok" | "vazio",
  linhas: [] as unknown[],
  // resolvedores das consultas penduradas, para o teste da resposta tardia
  pendentes: [] as ((valor: unknown) => void)[],
}));
const toasts = vi.hoisted(() => ({ erro: vi.fn(), info: vi.fn() }));
const exposto = vi.hoisted(() => ({
  fetchUserOrders: null as null | ((silent?: boolean) => Promise<unknown>),
  ordersLoadError: undefined as unknown,
  orders: [] as unknown[],
  loading: undefined as unknown,
}));

vi.mock("@/lib/supabase", () => {
  const builder = () => {
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
      value: (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => {
        if (rede.modo === "pendurado") {
          return new Promise((resolver) => {
            rede.pendentes.push(resolver);
          }).then(res, rej);
        }
        return Promise.resolve({
          data: rede.modo === "vazio" ? [] : rede.linhas,
          error: null,
          count: 0,
        }).then(res, rej);
      },
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
      from: () => builder(),
      rpc: () => builder(),
      channel: () => canal(),
      // devolve Promise: a limpeza do canal (relógio do hook) faz `.catch`
      removeChannel: () => Promise.resolve("ok"),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

const conta = vi.hoisted(() => ({
  id: "cliente-1",
  usuarios: new Map<string, { id: string }>(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    let user = conta.usuarios.get(conta.id);
    if (!user) {
      user = { id: conta.id };
      conta.usuarios.set(conta.id, user);
    }
    return { user, isAdmin: false };
  },
}));

vi.mock("sonner", () => ({
  toast: { error: toasts.erro, info: toasts.info, success: vi.fn() },
}));

import { PRAZO_DA_CONSULTA_DE_PEDIDOS_MS, useOrders } from "@/hooks/useOrders";
import { MENSAGEM_CONEXAO_LENTA } from "@/lib/prazo-da-requisicao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Alvo() {
  const hook = useOrders(true, false) as unknown as {
    fetchUserOrders: (silent?: boolean) => Promise<unknown>;
    ordersLoadError?: unknown;
    orders: unknown[];
    loading: unknown;
  };
  useEffect(() => {
    exposto.fetchUserOrders = hook.fetchUserOrders;
    exposto.ordersLoadError = hook.ordersLoadError;
    exposto.orders = hook.orders;
    exposto.loading = hook.loading;
  });
  return null;
}

describe("useOrders — a consulta dos pedidos da cliente tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar() {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Alvo />);
    });
  }

  // Dispara a consulta SEM esperá-la: a promessa só resolve no estouro.
  async function iniciar(silencioso = false) {
    const entrega: { promessa: Promise<unknown> | null } = { promessa: null };
    await act(async () => {
      entrega.promessa = exposto.fetchUserOrders!(silencioso);
    });
    // `terminou` deixa o teste afirmar "a espera acabou" sem pendurar o
    // próprio teste num `await` que, sem prazo, nunca voltaria.
    const marca = { terminou: false };
    void entrega.promessa!.then(() => {
      marca.terminou = true;
    });
    return { promessa: entrega.promessa!, marca };
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    rede.modo = "pendurado";
    rede.linhas = [];
    rede.pendentes.length = 0;
    toasts.erro.mockClear();
    toasts.info.mockClear();
    exposto.fetchUserOrders = null;
    exposto.ordersLoadError = undefined;
    exposto.orders = [];
    exposto.loading = undefined;
    conta.id = "cliente-1";
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("consulta normal que nunca responde: depois do prazo expõe o erro, solta o loading e devolve []", async () => {
    await montar();
    const { promessa, marca } = await iniciar();

    // Antes do prazo: ainda carregando, sem erro (nada de pânico precoce).
    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS - 1);
    expect(exposto.loading).toBe(true);
    expect(exposto.ordersLoadError).toBeNull();

    await passar(1);
    expect(marca.terminou).toBe(true);
    await expect(promessa).resolves.toEqual([]);
    expect(exposto.loading).toBe(false);
    expect(exposto.ordersLoadError).toEqual(expect.stringContaining("Não"));
    expect(exposto.orders).toEqual([]);
    // A frase em português, e não "Erro" genérico nem texto de aborto.
    expect(toasts.erro).toHaveBeenCalledWith(MENSAGEM_CONEXAO_LENTA);
  });

  it("leitura silenciosa pendurada também solta o loading e sinaliza, sem toast", async () => {
    await montar();
    const { promessa, marca } = await iniciar(true);

    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS);
    expect(marca.terminou).toBe(true);
    await expect(promessa).resolves.toEqual([]);
    expect(exposto.loading).toBe(false);
    expect(exposto.ordersLoadError).not.toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("resposta dentro do prazo: sem erro e nenhum relógio sobrando", async () => {
    await montar();
    rede.modo = "vazio";
    // O hook tem outros relógios (realtime, etc.): conta-se só o DESTA leitura.
    const relogiosAntes = vi.getTimerCount();
    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    expect(exposto.ordersLoadError).toBeNull();
    expect(exposto.loading).toBe(false);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(relogiosAntes);
  });

  it("sem internet de verdade (navigator.onLine=false), o estouro diz o fato e não 'conexão lenta'", async () => {
    await montar();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { promessa, marca } = await iniciar();

    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS);
    expect(marca.terminou).toBe(true);
    await promessa;

    expect(toasts.info).toHaveBeenCalledWith(
      "Você está sem internet",
      expect.anything(),
    );
    expect(toasts.erro).not.toHaveBeenCalled();
    online.mockRestore();
  });

  it("troca de conta durante a espera: o estouro não vira erro da conta nova", async () => {
    await montar();
    const { promessa, marca } = await iniciar();

    conta.id = "cliente-2";
    await act(async () => {
      raiz.render(<Alvo />);
    });
    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS);
    expect(marca.terminou).toBe(true);
    await promessa;

    expect(exposto.ordersLoadError).toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("resposta que chega DEPOIS do estouro não regrava a lista nem o cache", async () => {
    await montar();
    const { promessa, marca } = await iniciar();
    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS);
    expect(marca.terminou).toBe(true);
    await promessa;
    expect(exposto.ordersLoadError).not.toBeNull();

    await act(async () => {
      for (const resolver of rede.pendentes) {
        resolver({
          data: [
            {
              id: "ped-tardio",
              user_id: "cliente-1",
              items: [],
              created_at: new Date(0).toISOString(),
            },
          ],
          error: null,
        });
      }
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(exposto.orders).toEqual([]);
    expect(localStorage.getItem("ikcous_orders_cache_cliente-1")).toBeNull();
    expect(exposto.ordersLoadError).not.toBeNull();
  });

  it("'Tentar de novo' depois do estouro: a leitura seguinte limpa o erro", async () => {
    await montar();
    const { promessa, marca } = await iniciar();
    await passar(PRAZO_DA_CONSULTA_DE_PEDIDOS_MS);
    expect(marca.terminou).toBe(true);
    await promessa;
    expect(exposto.ordersLoadError).not.toBeNull();

    rede.modo = "vazio";
    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    expect(exposto.ordersLoadError).toBeNull();
    expect(exposto.loading).toBe(false);
  });
});
