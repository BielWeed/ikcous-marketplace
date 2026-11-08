// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e não responde) na lista de pedidos do PAINEL.
//
// `loadOrders` esperava a RPC `get_admin_orders_paged` sem prazo nenhum:
// `loading` ficava ligado para sempre, a lista ficava apagada e sem clique
// ("Sincronizando pedidos…") e não aparecia erro nem "Tentar de novo".
// Contrato provado aqui (fake timers + promessa que não resolve):
//   - estourou o prazo -> `erroDaListagem` setado, `loading` solto, retorno
//     vazio e a frase de conexão lenta no aviso (a tela já tem "Tentar de novo");
//   - o estouro NÃO é AbortError (o catch engole abortos em silêncio);
//   - leitura silenciosa pendurada também solta e sinaliza, sem aviso na tela;
//   - resposta dentro do prazo -> sem erro e o prazo não dispara depois;
//   - consulta nova cancela a velha: a velha cancelada não solta o loading da
//     nova nem vira erro;
//   - resposta que chega DEPOIS do estouro não regrava a lista;
//   - "Tentar de novo" depois do estouro limpa o erro.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  modo: "pendurado" as "pendurado" | "ok",
  resposta: { data: [] as unknown[], total_count: 0 },
  // resolvedores das consultas penduradas, para o teste da resposta tardia
  pendentes: [] as ((valor: unknown) => void)[],
  // sinais de cancelamento recebidos em `abortSignal`
  sinais: [] as AbortSignal[],
}));
const toasts = vi.hoisted(() => ({ erro: vi.fn(), info: vi.fn() }));
const exposto = vi.hoisted(() => ({
  loadOrders: null as
    | null
    | ((
        pagina?: number,
        tamanho?: number,
        status?: string,
        busca?: string,
        inicio?: string,
        fim?: string,
        silencioso?: boolean,
      ) => Promise<{ orders: unknown[]; total: number }>),
  erroDaListagem: undefined as unknown,
  orders: [] as unknown[],
  loading: undefined as unknown,
  isLoaded: undefined as unknown,
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
      abortSignal: (sinal: AbortSignal) => {
        rede.sinais.push(sinal);
        return alvo;
      },
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
        return Promise.resolve({ data: rede.resposta, error: null }).then(
          res,
          rej,
        );
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
  usuario: { id: "admin-1" },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario, isAdmin: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: toasts.erro, info: toasts.info, success: vi.fn() },
}));

import { PRAZO_DA_LISTA_DO_PAINEL_MS, useOrders } from "@/hooks/useOrders";
import { MENSAGEM_CONEXAO_LENTA } from "@/lib/prazo-da-requisicao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Alvo() {
  const hook = useOrders(true, true) as unknown as {
    loadOrders: NonNullable<typeof exposto.loadOrders>;
    erroDaListagem: unknown;
    orders: unknown[];
    loading: unknown;
    isLoaded: unknown;
  };
  useEffect(() => {
    exposto.loadOrders = hook.loadOrders;
    exposto.erroDaListagem = hook.erroDaListagem;
    exposto.orders = hook.orders;
    exposto.loading = hook.loading;
    exposto.isLoaded = hook.isLoaded;
  });
  return null;
}

describe("useOrders — a lista de pedidos do painel tem prazo", () => {
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
    const entrega: {
      promessa: Promise<{ orders: unknown[]; total: number }> | null;
    } = { promessa: null };
    await act(async () => {
      entrega.promessa = exposto.loadOrders!(
        0,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        silencioso,
      );
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
    rede.resposta = { data: [], total_count: 0 };
    rede.pendentes.length = 0;
    rede.sinais.length = 0;
    toasts.erro.mockClear();
    toasts.info.mockClear();
    exposto.loadOrders = null;
    exposto.erroDaListagem = undefined;
    exposto.orders = [];
    exposto.loading = undefined;
    exposto.isLoaded = undefined;
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

  it("consulta que nunca responde: depois do prazo expõe o erro, solta a lista e devolve vazio", async () => {
    await montar();
    const { promessa, marca } = await iniciar();

    // Antes do prazo: ainda carregando, sem erro (nada de pânico precoce).
    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS - 1);
    expect(exposto.loading).toBe(true);
    expect(exposto.erroDaListagem).toBeNull();

    await passar(1);
    expect(marca.terminou).toBe(true);
    await expect(promessa).resolves.toEqual({ orders: [], total: 0 });
    expect(exposto.loading).toBe(false);
    expect(exposto.isLoaded).toBe(true);
    expect(exposto.erroDaListagem).toEqual(expect.stringContaining("Não"));
    // A frase de conexão lenta, e não "Erro" genérico nem texto de aborto.
    expect(toasts.erro).toHaveBeenCalledWith(MENSAGEM_CONEXAO_LENTA);
  });

  it("leitura silenciosa pendurada também solta a lista e sinaliza, sem aviso", async () => {
    await montar();
    const { promessa, marca } = await iniciar(true);

    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS);
    expect(marca.terminou).toBe(true);
    await promessa;
    expect(exposto.loading).toBe(false);
    expect(exposto.erroDaListagem).not.toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("resposta dentro do prazo: sem erro e o relógio do prazo não dispara depois", async () => {
    await montar();
    rede.modo = "ok";
    await act(async () => {
      await exposto.loadOrders!();
    });

    expect(exposto.erroDaListagem).toBeNull();
    expect(exposto.loading).toBe(false);
    // O hook tem outros relógios (realtime, etc.); o que importa é que o
    // relógio do PRAZO desta leitura foi desarmado: passado o prazo inteiro,
    // nada acusa lentidão.
    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS + 1);
    expect(exposto.erroDaListagem).toBeNull();
    expect(exposto.loading).toBe(false);
    expect(toasts.erro).not.toHaveBeenCalled();
  });

  it("estouro larga a requisição pendurada (cancela o pedido de rede)", async () => {
    await montar();
    const { marca } = await iniciar();
    const sinal = rede.sinais[rede.sinais.length - 1]!;
    expect(sinal.aborted).toBe(false);

    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS);
    expect(marca.terminou).toBe(true);
    expect(sinal.aborted).toBe(true);
  });

  it("consulta nova cancela a velha: a velha não solta o loading da nova nem vira erro", async () => {
    await montar();
    await iniciar();
    await passar(5000);
    const segunda = await iniciar();

    // A primeira foi cancelada pela segunda (o comportamento que já existia).
    expect(rede.sinais[0]!.aborted).toBe(true);
    expect(rede.sinais[1]!.aborted).toBe(false);

    // A velha rejeita com aborto quando cancelada de verdade; aqui o dublê só
    // a deixa pendurada e o prazo DELA estoura com a segunda ainda esperando.
    // O que importa: a nova segue carregando, sem erro e sem aviso.
    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS - 5000);
    expect(exposto.loading).toBe(true);
    expect(exposto.erroDaListagem).toBeNull();
    expect(toasts.erro).not.toHaveBeenCalled();

    // O prazo da nova estoura no seu tempo, e aí sim vira falha.
    await passar(5000);
    expect(segunda.marca.terminou).toBe(true);
    expect(exposto.loading).toBe(false);
    expect(exposto.erroDaListagem).not.toBeNull();
  });

  it("resposta que chega DEPOIS do estouro não regrava a lista", async () => {
    await montar();
    const { promessa, marca } = await iniciar();
    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS);
    expect(marca.terminou).toBe(true);
    await promessa;
    expect(exposto.erroDaListagem).not.toBeNull();

    await act(async () => {
      for (const resolver of rede.pendentes) {
        resolver({
          data: {
            total_count: 1,
            data: [
              {
                id: "ped-tardio",
                user_id: "cliente-1",
                items: [],
                created_at: new Date(0).toISOString(),
              },
            ],
          },
          error: null,
        });
      }
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(exposto.orders).toEqual([]);
    expect(exposto.erroDaListagem).not.toBeNull();
  });

  it("'Tentar de novo' depois do estouro: a leitura seguinte limpa o erro", async () => {
    await montar();
    const { promessa, marca } = await iniciar();
    await passar(PRAZO_DA_LISTA_DO_PAINEL_MS);
    expect(marca.terminou).toBe(true);
    await promessa;
    expect(exposto.erroDaListagem).not.toBeNull();

    rede.modo = "ok";
    await act(async () => {
      await exposto.loadOrders!();
    });

    expect(exposto.erroDaListagem).toBeNull();
    expect(exposto.loading).toBe(false);
  });
});
