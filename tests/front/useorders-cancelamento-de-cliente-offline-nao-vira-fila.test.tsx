// @vitest-environment jsdom
//
// Achado 1, rodada 5 da revisão de risco pré-publicação (26/09/2026,
// migration 80 — outra frente, `fix/cancelar-com-cartao-vivo`): a fila
// offline de `updateOrderStatus` (mesmo arquivo, alguns milhares de linhas
// abaixo) foi escrita pensando no ADMIN — o update OTIMISTA pinta o status
// novo na tela ANTES de checar a rede, e só depois o item vai para
// `localStorage`, resolvendo sem lançar. Para o CLIENTE cancelando o PRÓPRIO
// pedido isso tem duas falhas que se somam: a tela já mente "cancelado" no
// clique, e a migration 80 ensina `update_order_status_atomic` a recusar
// esse cancelamento com P0001 quando o cartão pode estar em confirmação com
// o banco — recusa que `erroDeSincronizacaoEhTerminal` não reconhece, então
// o item voltaria para a fila a cada reconexão, PARA SEMPRE, enquanto a tela
// segue mentindo. Este arquivo prova a correção escolhida (recusar ANTES de
// entrar na fila, nunca marcar a mensagem nova como terminal): offline, o
// cliente nem chega a ver "cancelado" — a promise rejeita na hora, com o
// mesmo texto que `CheckoutView.tsx` já usa no seu próprio pré-checagem de
// `isOffline`.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}));
const exposto = vi.hoisted(() => ({
  updateOrderStatus: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

let mockIsAdmin = false;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" }, isAdmin: mockIsAdmin }),
}));

import { useOrders } from "@/hooks/useOrders";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Alvo({ isAdmin }: { isAdmin: boolean }) {
  const hook = useOrders(false, isAdmin);
  // No efeito, não no render — mesmo padrão de
  // useorders-erro-silencioso-nao-tosta.test.tsx: o eslint
  // (react-hooks/immutability) não deixa o corpo do componente escrever em
  // objeto de fora, e o efeito roda depois de cada render.
  useEffect(() => {
    exposto.updateOrderStatus = hook.updateOrderStatus as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;
  });
  return null;
}

describe("useOrders — cancelamento de cliente offline não vira fila (achado 1, rodada 5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockIsAdmin = false;
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    toasts.warning.mockClear();
    toasts.error.mockClear();
    toasts.success.mockClear();
    toasts.info.mockClear();
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) =>
        armazenamento.set(chave, valor),
      removeItem: (chave: string) => armazenamento.delete(chave),
      clear: () => armazenamento.clear(),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offline: o cancelamento do CLIENTE rejeita na hora, sem chamar a RPC e sem entrar na fila", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      raiz.render(<Alvo isAdmin={false} />);
    });

    await expect(
      exposto.updateOrderStatus!("pedido-1", "cancelled"),
    ).rejects.toThrow("Sem conexão com a internet");

    expect(rpcMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("orders_offline_updates_queue")).toBeNull();
    expect(toasts.warning).toHaveBeenCalledWith(
      "Sem conexão com a internet. Conecte-se e tente cancelar de novo — o pedido continua reservado.",
    );
    // Achado 1: nenhum segundo toast — o erro já tem o seu próprio, o
    // catch genérico de updateOrderStatus não pode dobrar o aviso.
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("controle: ONLINE, o mesmo cancelamento do cliente segue para a RPC normalmente", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(async () => {
      raiz.render(<Alvo isAdmin={false} />);
    });

    await act(async () => {
      await exposto.updateOrderStatus!("pedido-1", "cancelled");
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "update_order_status_atomic",
      expect.objectContaining({
        p_order_id: "pedido-1",
        p_new_status: "cancelled",
      }),
    );
    expect(localStorage.getItem("orders_offline_updates_queue")).toBeNull();
  });

  it("controle: o ramo de fila OFFLINE continua vivo para o ADMIN — este achado é só do cliente", async () => {
    mockIsAdmin = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      raiz.render(<Alvo isAdmin={true} />);
    });

    await act(async () => {
      await exposto.updateOrderStatus!("pedido-9", "processing");
    });

    expect(rpcMock).not.toHaveBeenCalled();
    const fila = JSON.parse(
      localStorage.getItem("orders_offline_updates_queue") ?? "[]",
    );
    expect(fila).toEqual([
      expect.objectContaining({ orderId: "pedido-9", status: "processing" }),
    ]);
  });
});
