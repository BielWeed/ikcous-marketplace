// @vitest-environment jsdom
//
// Falha de rede não é lista vazia — lado do HOOK.
//
// O catch de `fetchUserOrders` devolvia `[]` e dava um toast que some em
// segundos: a tela não tinha como saber que a consulta FALHOU, e desenhava
// "Nenhum pedido" para quem acabou de pagar um PIX. O hook passa a expor
// `ordersLoadError` (campo novo; nada do que já existia mudou de forma):
//   - falha de verdade  -> texto da falha, e `orders` NÃO é apagada;
//   - aborto/cancelamento (troca de conta, nova busca por cima) -> nunca erro;
//   - resposta ok (inclusive com 0 pedidos) -> limpa o erro;
//   - o retorno de `fetchUserOrders` continua `[]` na falha (contrato de
//     OrderDetailsView/ProfileView/CartView, que só esperam a promessa).
// A tela está em order-list-falha-de-carregamento-nao-e-lista-vazia.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resposta = vi.hoisted(() => ({
  modo: "ok" as "ok" | "erro" | "aborto" | "vazio",
  linhas: [] as unknown[],
}));
const toasts = vi.hoisted(() => ({
  erro: vi.fn(),
  info: vi.fn(),
}));
const exposto = vi.hoisted(() => ({
  fetchUserOrders: null as null | ((silent?: boolean) => Promise<unknown>),
  ordersLoadError: undefined as unknown,
  orders: [] as unknown[],
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
        if (resposta.modo === "aborto") {
          return Promise.reject(
            Object.assign(new Error("Fetch is aborted"), {
              name: "AbortError",
            }),
          ).then(res, rej);
        }
        const corpo =
          resposta.modo === "erro"
            ? { data: null, error: { message: "Failed to fetch" }, count: 0 }
            : {
                data: resposta.modo === "vazio" ? [] : resposta.linhas,
                error: null,
                count: 0,
              };
        return Promise.resolve(corpo).then(res, rej);
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
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" }, isAdmin: false }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toasts.erro,
    info: toasts.info,
    success: vi.fn(),
  },
}));

import { useOrders } from "@/hooks/useOrders";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CACHE = "ikcous_orders_cache_cliente-1";

const pedidoEmCache = {
  id: "ped-1",
  customer: { name: "Cliente", whatsapp: "34999999999" },
  items: [],
  subtotal: 10,
  shipping: 0,
  discount: 0,
  total: 10,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

function Alvo() {
  const hook = useOrders(true, false) as unknown as {
    fetchUserOrders: (silent?: boolean) => Promise<unknown>;
    ordersLoadError?: unknown;
    orders: unknown[];
  };
  useEffect(() => {
    exposto.fetchUserOrders = hook.fetchUserOrders;
    exposto.ordersLoadError = hook.ordersLoadError;
    exposto.orders = hook.orders;
  });
  return null;
}

describe("useOrders — falha de carregamento é exposta, não vira lista vazia", () => {
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

  beforeEach(() => {
    resposta.modo = "ok";
    resposta.linhas = [];
    toasts.erro.mockClear();
    toasts.info.mockClear();
    exposto.fetchUserOrders = null;
    exposto.ordersLoadError = undefined;
    exposto.orders = [];
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("antes de qualquer busca o erro é nulo (campo existe, não é undefined)", async () => {
    await montar();
    expect(exposto.ordersLoadError).toBeNull();
  });

  it("falha de rede SEM cache: expõe o erro, orders segue [] e o retorno segue []", async () => {
    await montar();
    resposta.modo = "erro";

    let retorno: unknown;
    await act(async () => {
      retorno = await exposto.fetchUserOrders!();
    });

    expect(exposto.ordersLoadError).toEqual(expect.stringContaining("Não"));
    expect(exposto.orders).toEqual([]);
    // Contrato antigo preservado: quem faz `await fetchUserOrders()` recebe [].
    expect(retorno).toEqual([]);
  });

  it("falha COM cache em memória: a lista que já estava fica, e o erro é sinalizado", async () => {
    localStorage.setItem(CACHE, JSON.stringify([pedidoEmCache]));
    await montar();
    expect(exposto.orders).toHaveLength(1);

    resposta.modo = "erro";
    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    expect(exposto.orders).toHaveLength(1);
    expect(exposto.ordersLoadError).toEqual(expect.stringContaining("Não"));
  });

  it("recarga silenciosa que falha também sinaliza (sem toast, como antes)", async () => {
    await montar();
    resposta.modo = "erro";

    await act(async () => {
      await exposto.fetchUserOrders!(true);
    });

    expect(exposto.ordersLoadError).not.toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("aborto/cancelamento NUNCA vira erro visível", async () => {
    await montar();
    resposta.modo = "aborto";

    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    expect(exposto.ordersLoadError).toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("aborto depois de uma falha NÃO apaga o erro nem inventa sucesso", async () => {
    await montar();
    resposta.modo = "erro";
    await act(async () => {
      await exposto.fetchUserOrders!();
    });
    expect(exposto.ordersLoadError).not.toBeNull();

    resposta.modo = "aborto";
    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    // Nada foi provado sobre o servidor: o erro anterior continua valendo.
    expect(exposto.ordersLoadError).not.toBeNull();
  });

  it("resposta ok com 0 pedidos: vazio de verdade, sem erro", async () => {
    await montar();
    resposta.modo = "vazio";

    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    expect(exposto.ordersLoadError).toBeNull();
    expect(exposto.orders).toEqual([]);
  });

  it("'Tentar de novo' que dá certo limpa o erro", async () => {
    await montar();
    resposta.modo = "erro";
    await act(async () => {
      await exposto.fetchUserOrders!();
    });
    expect(exposto.ordersLoadError).not.toBeNull();

    resposta.modo = "vazio";
    await act(async () => {
      await exposto.fetchUserOrders!();
    });

    expect(exposto.ordersLoadError).toBeNull();
  });
});
