// @vitest-environment jsdom
//
// Laudo varredura profunda #2 (P-9): offline, "Meus Pedidos" mostra a lista
// do cache E um toast vermelho de "Erro ao carregar seus pedidos" — o app
// tem a informação de que está sem sinal e mesmo assim diz "erro". Com
// internet caída, o toast agora diz o fato (info: "Você está sem internet",
// mostrando os pedidos salvos); com a rede de pé e falha de verdade, o
// "Erro ao carregar seus pedidos" se mantém.
import { act } from "react";
import { createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let usuarioAtual: { id: string } | null = null;
let liderAtual = true;
let respostaDoFetch: { data: unknown[]; error: { message: string } | null } = {
  data: [],
  error: null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => builderDoFetch()),
    channel: vi.fn(() => {
      const canal: any = {};
      canal.on = vi.fn(() => canal);
      canal.subscribe = vi.fn();
      return canal;
    }),
    removeChannel: vi.fn(() => Promise.resolve()),
    rpc: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: liderAtual }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";
import { toast } from "sonner";

function builderDoFetch() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  builder.single = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve(respostaDoFetch).then(resolve, reject);
  return builder;
}

// @ts-expect-error flag interna do React, sem tipo público — padrão do projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let onLineOriginal: boolean;

function Sonda(props: {
  onResultado: (resultado: ReturnType<typeof useOrders>) => void;
}) {
  props.onResultado(useOrders(true, false));
  return null;
}

describe("useOrders — offline não é 'Erro': o toast diz o fato (laudo #2, P-9)", () => {
  let raiz: Root | null = null;
  let hospedeiro: HTMLDivElement | null = null;

  beforeEach(() => {
    usuarioAtual = { id: "user-offline-p9" };
    liderAtual = true;
    onLineOriginal = navigator.onLine;
    respostaDoFetch = { data: [], error: null };
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
  });

  afterEach(() => {
    if (raiz) {
      act(() => {
        raiz?.unmount();
      });
      raiz = null;
    }
    hospedeiro?.remove();
    hospedeiro = null;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => onLineOriginal,
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function montarEFetch() {
    const caixa: { valor: ReturnType<typeof useOrders> | null } = {
      valor: null,
    };
    raiz = createRoot(hospedeiro as HTMLDivElement);
    await act(async () => {
      raiz?.render(
        createElement(Sonda, { onResultado: (r) => (caixa.valor = r) }),
      );
    });
    await act(async () => {
      await caixa.valor?.fetchUserOrders();
    });
    return caixa.valor;
  }

  it("sem internet: toast INFO 'Você está sem internet' e NÃO 'Erro ao carregar seus pedidos'", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    respostaDoFetch = { data: [], error: { message: "Failed to fetch" } };

    await montarEFetch();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.info).mock.calls[0][0])).toContain(
      "Você está sem internet",
    );
  });

  it("com internet e falha real de rede: o 'Erro ao carregar seus pedidos' se mantém", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    respostaDoFetch = { data: [], error: { message: "Internal server error" } };

    await montarEFetch();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
