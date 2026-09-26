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

import type { Order } from "@/types";

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
  // Achado 2, rodada 6 (revisão do achado 1 da rodada 5): expor `orders`
  // também — sem isto, o teste só provava que a PROMISE rejeita, nunca que
  // NENHUM update otimista rodou. Com `useOrders(false, false)` e cache
  // vazio, `orders` já nasce `[]`; testar contra um array vazio não
  // distingue "o guard rodou antes do otimista" de "o otimista rodou, mas
  // não achou o pedido para mudar" — os dois cenários dão `[]` do mesmo
  // jeito. Só um pedido SEMEADO no cache prova a ordem certa.
  orders: [] as Order[],
}));

/** Mesma fixture de `cancelar-enviado-otimista-marca-que-precisa-devolver.
 * test.tsx` — só o `status` muda por chamada. */
function pedidoFake(status: Order["status"]): Order {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status,
    paymentStatus: "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

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
    exposto.orders = hook.orders;
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

  it("offline: o cancelamento do CLIENTE rejeita na hora, sem chamar a RPC, sem entrar na fila E sem update otimista", async () => {
    // Achado 2, rodada 6: sem um pedido SEMEADO no cache, `orders` nasce
    // `[]` de qualquer jeito — provar que o array continua `[]` depois não
    // distingue "o guard bloqueou antes do otimista" de "o otimista rodou,
    // mas não achou nada para mudar". Só com um pedido de verdade em
    // `orders` dá pra provar que o STATUS dele nunca vira "cancelled".
    localStorage.setItem(
      "ikcous_orders_cache_cliente-1",
      JSON.stringify([pedidoFake("pending")]),
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      raiz.render(<Alvo isAdmin={false} />);
    });

    // Achado 2, rodada 7: confere a semeadura ANTES de chamar
    // `updateOrderStatus` — se a hidratação do cache mudar de forma (nome da
    // chave, formato do JSON, o `useState` inicial parar de ler
    // `localStorage`), esta asserção falha aqui, com uma mensagem que aponta
    // pro problema certo ("o seed nunca chegou"), em vez de falhar lá
    // embaixo parecendo que o guard não rodou.
    expect(exposto.orders.find((o) => o.id === "pedido-1")?.status).toBe(
      "pending",
    );

    // `act` (não só `await expect(...).rejects`) é o que importa aqui: sem
    // envolver a chamada, o `setOrders` do update otimista (se rodasse)
    // aconteceria fora do React, e o efeito de `Alvo` que copia `hook.orders`
    // para `exposto.orders` só flusharia DEPOIS desta função já ter lido o
    // valor antigo — a asserção do update otimista, mais abaixo, passaria
    // por acidente mesmo com o bug presente (medido: aconteceu na mutação de
    // prova antes deste ajuste).
    let erroCapturado: unknown;
    await act(async () => {
      try {
        await exposto.updateOrderStatus!("pedido-1", "cancelled");
      } catch (erro) {
        erroCapturado = erro;
      }
    });
    expect(erroCapturado).toBeInstanceOf(Error);
    expect((erroCapturado as Error).message).toContain(
      "Sem conexão com a internet",
    );

    expect(rpcMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("orders_offline_updates_queue")).toBeNull();
    // Achado 3, rodada 6: a frase não pode afirmar que o pedido "continua
    // reservado" — este erro dispara para QUALQUER cancelamento de cliente
    // offline, inclusive de um pedido já `processing`/`shipping`, onde
    // "reservado" não faz sentido nenhum.
    expect(toasts.warning).toHaveBeenCalledWith(
      "Sem conexão com a internet. O pedido não foi cancelado — conecte-se e tente de novo.",
    );
    // Achado 1: nenhum segundo toast — o erro já tem o seu próprio, o
    // catch genérico de updateOrderStatus não pode dobrar o aviso.
    expect(toasts.error).not.toHaveBeenCalled();
    // Achado 2, rodada 6: a prova que faltava — o pedido semeado continua
    // "pending" em `orders`. Se o update otimista tivesse rodado antes da
    // checagem de rede, isto seria "cancelled" mesmo com a RPC nunca tendo
    // sido chamada.
    expect(exposto.orders.find((o) => o.id === "pedido-1")?.status).toBe(
      "pending",
    );
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
