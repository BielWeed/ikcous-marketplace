// @vitest-environment jsdom
//
// A lojista cancela um pedido sem internet; a rede volta e ESTÁVEL, mas na hora
// da passada o servidor responde 500 (ou estoura o tempo). O item voltava à
// fila com "Tentando novamente mais tarde" e NADA tentava de novo: nenhum novo
// `online` acontece com a rede estável, e a tela (otimista) já mostrava
// "cancelado" enquanto o servidor seguia com o status antigo -- num tablet
// aberto o dia todo, até o item vencer em 72 h.
//
// Agora, ao fim de uma passada que deixou item na fila por falha PASSAGEIRA,
// o hook marca nova passada com recuo crescente (30 s, 2 min, 10 min, teto de
// 10 min). A nova passada é a mesma de sempre: só AGENDA, e passa pelas mesmas
// guardas (sessão do dono antes de cada envio, etapa esperada, erro terminal,
// validade de 72 h, uma passada por vez). Aqui se prova o relógio e os limites:
// erro terminal e parada por rede NÃO marcam nada; desmonte e troca de usuário
// cancelam; duas passadas nunca se sobrepõem.
import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpcMock } = vi.hoisted(() => ({
  // `id`: o usuário da tela; `sessao`: quem o cliente Supabase diz ser agora.
  auth: { id: null as string | null, sessao: null as string | null },
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: rpcMock,
    auth: {
      // A sessão do cliente é SEMPRE a do usuário da tela: a rede está boa.
      getSession: vi.fn(async () => ({
        data: { session: auth.sessao ? { user: { id: auth.sessao } } : null },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: () => {} } },
      })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            abortSignal: () => Promise.resolve({ data: [], error: null }),
          }),
          single: () =>
            Promise.resolve({ data: { status: "pending" }, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "t"),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.id ? { id: auth.id } : null,
    isAdmin: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — padrão do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_A = "orders_offline_updates_queue:admin-a";
const CHAVE_B = "orders_offline_updates_queue:admin-b";
const AGORA = new Date("2026-11-17T12:00:00Z").getTime();
const HORA = 60 * 60 * 1000;
const S = 1000;

const cancelamento = {
  orderId: "pedido-1",
  status: "cancelled",
  statusEsperado: "pending",
  silent: false,
  timestamp: AGORA - HORA,
};

const erro500 = { message: "Internal Server Error", code: "500" };

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;
// Quantas vezes uma passada leu a fila de A: cada passada começa por aí.
let leiturasDaFilaDeA = 0;

function fila(chave = CHAVE_A): any[] | null {
  const bruto = armazem.get(chave);
  return bruto === undefined ? null : JSON.parse(bruto);
}

function Sonda() {
  useOrders(false, false);
  return null;
}

async function renderizar() {
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("fila offline de pedidos — tenta de novo depois de falha passageira", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    auth.id = "admin-a";
    auth.sessao = "admin-a";
    leiturasDaFilaDeA = 0;
    armazem = new Map([[CHAVE_A, JSON.stringify([cancelamento])]]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => {
        if (chave === CHAVE_A) leiturasDaFilaDeA++;
        return armazem.get(chave) ?? null;
      },
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    rpcMock.mockReset();
    // A sessão do cliente é a do usuário da tela (a rede está boa); cada teste
    // que precisa de outra a troca, e esta linha desfaz a troca.
    vi.mocked(supabase.auth.getSession).mockImplementation((async () => ({
      data: { session: auth.sessao ? { user: { id: auth.sessao } } : null },
      error: null,
    })) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const t of [
      toast.loading,
      toast.success,
      toast.error,
      toast.info,
      toast.warning,
      toast.dismiss,
    ]) {
      vi.mocked(t).mockClear();
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("500 na passada: o item fica, e passados 30 s a nova passada o envia (silenciosa) e esvazia a fila", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: erro500 })
      .mockResolvedValue({ data: null, error: null });

    await renderizar();
    await passar(1 * S); // a passada da montagem (1 s)

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fila()).toEqual([cancelamento]);
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Antes dos 30 s (+ 1 s da passada agendada) nada acontece.
    await passar(30 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(fila()).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    // A nova tentativa não pisca "Sincronizando…" outra vez.
    expect(toast.loading).toHaveBeenCalledTimes(1);

    // Fila vazia: o relógio acabou, nenhuma passada nova.
    await passar(60 * 60 * S);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("falha que persiste: o recuo cresce (30 s, 2 min, 10 min) e fica em 10 min", async () => {
    rpcMock.mockResolvedValue({ data: null, error: erro500 });

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // 1ª espera: 30 s + 1 s de passada agendada.
    await passar(31 * S - 1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    await passar(1);
    expect(rpcMock).toHaveBeenCalledTimes(2);

    // 2ª espera: 2 min + 1 s.
    await passar(121 * S - 1);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    await passar(1);
    expect(rpcMock).toHaveBeenCalledTimes(3);

    // 3ª e 4ª esperas: 10 min + 1 s cada (teto).
    await passar(601 * S - 1);
    expect(rpcMock).toHaveBeenCalledTimes(3);
    await passar(1);
    expect(rpcMock).toHaveBeenCalledTimes(4);
    await passar(601 * S - 1);
    expect(rpcMock).toHaveBeenCalledTimes(4);
    await passar(1);
    expect(rpcMock).toHaveBeenCalledTimes(5);

    // Nunca duas passadas de uma vez só: uma chamada por rodada.
    expect(fila()).toEqual([cancelamento]);
  });

  it("a fila foi esvaziada por outro caminho (outra aba enviou): a nova tentativa acha a fila vazia e o relógio PARA de vez", async () => {
    rpcMock.mockResolvedValue({ data: null, error: erro500 });

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // A outra aba enviou o item e limpou a fila.
    armazem.delete(CHAVE_A);
    await passar(31 * S);
    const leiturasAteAqui = leiturasDaFilaDeA;
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Sem falha na passada que achou a fila vazia, nada mais é marcado: nenhuma
    // passada nova (nenhuma leitura da fila) em horas.
    await passar(3 * HORA);
    expect(leiturasDaFilaDeA).toBe(leiturasAteAqui);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("erro TERMINAL (o servidor recusa de vez): o item sai da fila e NÃO há nova tentativa", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "pedido_status_mudou", code: "P0001" },
    });

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fila()).toBeNull();

    await passar(2 * HORA);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("'Acesso negado.' (42501, o avanço de quem não é admin): o item sai da fila e NÃO há nova tentativa", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Acesso negado.", code: "42501" },
    });
    const avanco = {
      ...cancelamento,
      status: "processing",
      statusEsperado: "pending",
    };
    armazem.set(CHAVE_A, JSON.stringify([avanco]));

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fila()).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();

    await passar(3 * HORA);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("a passada que parou por falta de sessão (conta trocada, sem rede) NÃO marca recuo: quem religa é o religador", async () => {
    // A sessão do cliente é de OUTRO usuário: a trava de troca de conta
    // encerra a passada sem enviar -- isso não é falha passageira.
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "admin-b" } } },
      error: null,
    } as never);

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);

    await passar(2 * HORA);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falha num item e a CONTA TROCA antes do seguinte: passada interrompida não marca nova tentativa (e o segundo item não sai com o login de B)", async () => {
    const segundo = { ...cancelamento, orderId: "pedido-2" };
    armazem.set(CHAVE_A, JSON.stringify([cancelamento, segundo]));
    rpcMock.mockResolvedValue({ data: null, error: erro500 });
    // A sessão é conferida antes de CADA envio: no primeiro item é a do dono,
    // no segundo já é de outro usuário (e depois volta a ser a do dono, para
    // que uma nova tentativa, se existisse, ENVIASSE).
    const sessaoDe = (id: string) =>
      ({ data: { session: { user: { id } } }, error: null }) as never;
    vi.mocked(supabase.auth.getSession)
      .mockResolvedValueOnce(sessaoDe("admin-a")) // antes da releitura
      .mockResolvedValueOnce(sessaoDe("admin-a")) // depois da releitura
      .mockResolvedValueOnce(sessaoDe("admin-b"));

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fila()).toHaveLength(2);

    await passar(2 * HORA);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("sair da tela cancela a nova tentativa marcada", async () => {
    rpcMock.mockResolvedValue({ data: null, error: erro500 });

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    act(() => {
      raiz.unmount();
    });
    await passar(2 * HORA);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fila()).toEqual([cancelamento]);
    // o afterEach desmonta de novo: recria a raiz para não duplicar.
    raiz = createRoot(host);
  });

  it("sair da tela com a passada AINDA em voo: o fim dela não marca nova tentativa", async () => {
    let concluirEnvio: () => void = () => {};
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          concluirEnvio = () => resolve({ data: null, error: erro500 });
        }),
    );

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    act(() => {
      raiz.unmount();
    });
    await act(async () => {
      concluirEnvio();
      await vi.advanceTimersByTimeAsync(0);
    });
    await passar(2 * HORA);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    raiz = createRoot(host);
  });

  it("trocar de usuário cancela a nova tentativa do ANTERIOR: a fila de A fica intacta e nada sai", async () => {
    rpcMock.mockResolvedValue({ data: null, error: erro500 });

    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // O tablet passa para B (fila vazia). A sessão do cliente segue a de A de
    // propósito: assim a trava de troca de conta NÃO esconde uma nova
    // tentativa de A que sobrasse -- só o cancelamento do relógio a impede.
    auth.id = "admin-b";
    await renderizar();
    await passar(2 * HORA);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fila(CHAVE_A)).toEqual([cancelamento]);
    expect(fila(CHAVE_B)).toBeNull();
  });

  it("`online` e a nova tentativa marcada caindo JUNTOS enviam uma vez só por rodada (passadas não se sobrepõem)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: erro500 });
    await renderizar();
    await passar(1 * S);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // O envio da próxima passada fica pendurado.
    let concluirEnvio: () => void = () => {};
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          concluirEnvio = () => resolve({ data: null, error: null });
        }),
    );

    // A nova tentativa marcada dispara em t = 31 s (30 s de recuo + 1 s da
    // passada agendada); um `online` logo antes agenda outra no MESMO segundo.
    await passar(30 * S - 1);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(2 * S);
    });
    // As duas passadas dispararam com a primeira ainda em voo: um envio só.
    expect(rpcMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      concluirEnvio();
      await vi.advanceTimersByTimeAsync(1 * S);
    });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(fila()).toBeNull();
  });
});
