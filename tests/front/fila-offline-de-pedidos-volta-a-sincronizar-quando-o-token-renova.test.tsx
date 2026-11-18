// @vitest-environment jsdom
//
// A lojista cancela um pedido sem internet, a rede volta com o token de login
// já vencido e a tela diz "cancelado" -- mas o servidor nunca recebia o
// cancelamento e o estoque não voltava.
//
// Causa: o evento `online` dispara a passada da fila 1 s depois da volta da
// rede. Nesse instante o supabase-js ainda NÃO renovou o token (guarda a falha
// de renovação por 60 s e `getSession()` devolve `session: null` com um erro de
// rede). A passada lia isso como "a conta trocou", devolvia a fila ao
// armazenamento sem enviar nada, apagava o aviso e NINGUÉM a reagendava: os
// efeitos só dependem de `user?.id`, `isAdmin` e do `online`.
//
// Agora, se a passada parou POR ERRO DE REDE (e só nesse caso), o hook espera o
// supabase-js avisar que a sessão voltou (`TOKEN_REFRESHED`/`SIGNED_IN` do MESMO
// usuário) e refaz a passada em silêncio. A trava de troca de conta continua:
// a passada refeita confere a sessão antes de CADA envio, como sempre.
//
// Mesma sonda dos outros testes de useOrders (sem @testing-library/react).
import { useOrders } from "@/hooks/useOrders";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type OuvinteDeAuth = (evento: string, sessao: unknown) => void;

const { auth, sessao, rpcMock, assinatura } = vi.hoisted(() => ({
  // O que o CONTEXTO de auth diz (de onde sai o uid de guardar e o de enviar).
  auth: { id: null as string | null, admin: false },
  // O que o cliente Supabase diz AGORA (`getSession`).
  sessao: {
    id: null as string | null,
    erro: null as unknown,
    // Quando preenchida, a leitura da sessão só responde depois dela.
    espera: null as null | Promise<void>,
  },
  rpcMock: vi.fn(),
  assinatura: {
    ouvintes: new Set<(evento: string, sessao: unknown) => void>(),
    cancelamentos: 0,
    // Simula "a renovação saiu ANTES de a assinatura existir": roda no momento
    // em que alguém assina e não entrega evento nenhum.
    aoAssinar: null as null | (() => void),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: rpcMock,
    auth: {
      getSession: vi.fn(async () => {
        await sessao.espera;
        return {
          data: { session: sessao.id ? { user: { id: sessao.id } } : null },
          error: sessao.erro,
        };
      }),
      onAuthStateChange: vi.fn((ouvinte: OuvinteDeAuth) => {
        assinatura.ouvintes.add(ouvinte);
        assinatura.aoAssinar?.();
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                assinatura.cancelamentos++;
                assinatura.ouvintes.delete(ouvinte);
              },
            },
          },
        };
      }),
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
    isAdmin: auth.admin,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — padrão do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "orders_offline_updates_queue:admin-a";
const AGORA = new Date("2026-11-17T12:00:00Z").getTime();
const HORA = 60 * 60 * 1000;

const cancelamento = {
  orderId: "pedido-1",
  status: "cancelled",
  silent: false,
  timestamp: AGORA - HORA,
};

let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;

const erroDeRede = () => new AuthRetryableFetchError("Failed to fetch", 0);

function fila(): any[] | null {
  const bruto = armazem.get(CHAVE);
  return bruto === undefined ? null : JSON.parse(bruto);
}

/** O supabase-js ainda não renovou o token: sem sessão, COM erro de rede. */
function tokenVencidoSemRede() {
  sessao.id = null;
  sessao.erro = erroDeRede();
}

/** A renovação funcionou: a sessão do dono voltou. */
function tokenRenovado(uid = "admin-a") {
  sessao.id = uid;
  sessao.erro = null;
}

/** O que o supabase-js faz quando a renovação sai: avisa todos os ouvintes. */
function avisar(evento: string, uid: string | null) {
  for (const ouvinte of [...assinatura.ouvintes]) {
    ouvinte(evento, uid ? { user: { id: uid } } : null);
  }
}

function Sonda() {
  useOrders(false, auth.admin);
  return null;
}

async function renderizar() {
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

async function passarUmSegundo() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

async function reconectar() {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1000);
  });
}

function pedidosEnviados(): string[] {
  return rpcMock.mock.calls.map(([, args]) => args.p_order_id);
}

describe("fila offline de pedidos — religa quando o token renova", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    auth.id = "admin-a";
    auth.admin = false;
    tokenVencidoSemRede();
    assinatura.ouvintes.clear();
    assinatura.cancelamentos = 0;
    assinatura.aoAssinar = null;
    sessao.espera = null;
    armazem = new Map([[CHAVE, JSON.stringify([cancelamento])]]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("token vencido e sem rede na volta: nada sai, a fila fica, e quando o token renova do MESMO usuário o cancelamento é enviado UMA vez", async () => {
    await renderizar();
    await reconectar();

    // A passada parou por erro de rede: nada enviado, fila intacta.
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);
    expect(assinatura.ouvintes.size).toBe(1);

    tokenRenovado();
    avisar("TOKEN_REFRESHED", "admin-a");
    await passarUmSegundo();

    expect(pedidosEnviados()).toEqual(["pedido-1"]);
    expect(fila()).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    // A espera é de uma vez só: já cumprida, a assinatura foi desfeita.
    expect(assinatura.ouvintes.size).toBe(0);

    // Um segundo aviso de renovação (de hora em hora, o supabase-js renova de
    // novo) não envia nada outra vez.
    avisar("TOKEN_REFRESHED", "admin-a");
    await passarUmSegundo();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("SIGNED_IN do mesmo usuário também religa a passada", async () => {
    await renderizar();
    await reconectar();
    expect(rpcMock).not.toHaveBeenCalled();

    tokenRenovado();
    avisar("SIGNED_IN", "admin-a");
    await passarUmSegundo();

    expect(pedidosEnviados()).toEqual(["pedido-1"]);
  });

  it("a retentativa é SILENCIOSA: nenhum 'Sincronizando…' novo, e o aviso da primeira passada não é apagado às cegas", async () => {
    await renderizar();
    await reconectar();
    // Primeira passada: o aviso aparece e é recolhido (comportamento de sempre).
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).toHaveBeenCalledWith("t");

    // A renovação sai, mas a rede ainda falha na hora de reler a sessão: a
    // retentativa para de novo por rede e NÃO pisca nada na tela.
    avisar("TOKEN_REFRESHED", "admin-a");
    await passarUmSegundo();
    expect(toast.loading).toHaveBeenCalledTimes(1);
    // `toast.dismiss()` SEM id apagaria TODOS os avisos da tela.
    expect(toast.dismiss).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    // E continua à espera da próxima renovação.
    expect(assinatura.ouvintes.size).toBe(1);

    // Agora a renovação de verdade: envia, sem 'Sincronizando…' novo.
    tokenRenovado();
    avisar("TOKEN_REFRESHED", "admin-a");
    await passarUmSegundo();
    expect(pedidosEnviados()).toEqual(["pedido-1"]);
    expect(toast.loading).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("sessão encerrada de verdade (sem erro de rede): NÃO reagenda nada", async () => {
    sessao.id = null;
    sessao.erro = null;
    await renderizar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);
    expect(assinatura.ouvintes.size).toBe(0);

    tokenRenovado();
    avisar("SIGNED_IN", "admin-a");
    await passarUmSegundo();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("renovação RECUSADA pelo servidor (token inválido, não é rede): NÃO reagenda", async () => {
    sessao.id = null;
    sessao.erro = new AuthApiError(
      "Invalid Refresh Token: Already Used",
      400,
      "refresh_token_already_used",
    );
    await renderizar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(assinatura.ouvintes.size).toBe(0);
  });

  it("a conta trocou no meio da passada (sessão de OUTRO usuário, sem erro): NÃO reagenda", async () => {
    sessao.id = "admin-b";
    sessao.erro = null;
    await renderizar();
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);
    expect(assinatura.ouvintes.size).toBe(0);
  });

  it("uma passada seguinte que NÃO parou pela rede desfaz a espera (a marca da anterior não vale mais)", async () => {
    await renderizar();
    await reconectar();
    expect(assinatura.ouvintes.size).toBe(1);

    // A lojista saiu da conta; a rede volta a oscilar e o `online` dispara de novo.
    sessao.id = null;
    sessao.erro = null;
    await reconectar();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(assinatura.ouvintes.size).toBe(0);
  });

  it("aviso de renovação de OUTRO usuário não religa a passada nem envia o item de A", async () => {
    await renderizar();
    await reconectar();
    expect(assinatura.ouvintes.size).toBe(1);

    // O tablet agora tem a sessão de B; o supabase-js avisa a renovação DELE.
    tokenRenovado("admin-b");
    avisar("TOKEN_REFRESHED", "admin-b");
    await passarUmSegundo();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);
    // Segue esperando o dono da fila.
    expect(assinatura.ouvintes.size).toBe(1);
  });

  it("aviso de renovação do dono, mas a sessão do cliente já é de OUTRO: a trava de troca de conta vale e nada é enviado", async () => {
    await renderizar();
    await reconectar();

    tokenRenovado("admin-b");
    avisar("TOKEN_REFRESHED", "admin-a");
    await passarUmSegundo();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);
  });

  it("`online` e a renovação chegando JUNTOS enviam o item uma vez só", async () => {
    await renderizar();
    await reconectar();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(assinatura.ouvintes.size).toBe(1);

    // O envio fica pendurado: as duas passadas agendadas (a do `online` e a da
    // renovação) disparam no mesmo segundo, com a primeira ainda em voo.
    let concluirEnvio: () => void = () => {};
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          concluirEnvio = () => resolve({ data: null, error: null });
        }),
    );
    tokenRenovado();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      avisar("TOKEN_REFRESHED", "admin-a");
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      concluirEnvio();
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(pedidosEnviados()).toEqual(["pedido-1"]);
    expect(fila()).toBeNull();
  });

  it("a renovação que saiu ENTRE a leitura da sessão e a assinatura não se perde", async () => {
    // Quando o hook assina, o token acabou de renovar -- e o aviso já passou.
    assinatura.aoAssinar = () => {
      tokenRenovado();
    };
    await renderizar();
    await reconectar();
    await passarUmSegundo();

    expect(pedidosEnviados()).toEqual(["pedido-1"]);
    expect(fila()).toBeNull();
  });

  it("sair da tela com a passada ainda lendo a sessão: o fim dela não deixa assinatura para trás", async () => {
    let responder: () => void = () => {};
    sessao.espera = new Promise<void>((resolve) => {
      responder = resolve;
    });
    await renderizar();
    await reconectar();
    expect(assinatura.ouvintes.size).toBe(0);

    act(() => {
      raiz.unmount();
    });
    // A leitura volta DEPOIS do desmonte, com erro de rede.
    await act(async () => {
      responder();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(assinatura.ouvintes.size).toBe(0);
    expect(rpcMock).not.toHaveBeenCalled();
    raiz = createRoot(host);
  });

  it("sair da tela desfaz a espera: sem assinatura sobrando e sem envio depois do desmonte", async () => {
    await renderizar();
    await reconectar();
    expect(assinatura.ouvintes.size).toBe(1);

    act(() => {
      raiz.unmount();
    });
    expect(assinatura.ouvintes.size).toBe(0);

    tokenRenovado();
    avisar("TOKEN_REFRESHED", "admin-a");
    await passarUmSegundo();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fila()).toEqual([cancelamento]);
    // o afterEach desmonta de novo: recria a raiz para não duplicar.
    raiz = createRoot(host);
  });
});
