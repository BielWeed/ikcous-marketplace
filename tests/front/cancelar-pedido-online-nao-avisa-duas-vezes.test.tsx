// @vitest-environment jsdom
//
// r43-e, achado 2: cancelar pedido ONLINE pelo painel vai pela edge e a tela só
// muda com a resposta. A edge grava o cancelamento no banco ANTES de responder;
// se o aviso em tempo real chegar antes da resposta, a tela ainda tem a etapa
// antiga e a marca de "ação própria" não existia nesse caminho — saía um
// segundo aviso, "Pedido #N atualizado para Cancelado", como se OUTRA pessoa
// tivesse cancelado. O avanço de etapa e o cancelamento pela RPC já marcavam.
//
// Aqui o hook é o de verdade e o evento tem o formato REAL (`old` só com a
// chave primária); o aviso é decidido pela MESMA função que o painel usa
// (`tipoDoAvisoDoPedido`). A edge é uma promessa que o teste resolve na hora
// que quer, para provar o evento chegando ANTES da resposta.
import { useOrders } from "@/hooks/useOrders";
import {
  JANELA_DA_ACAO_PROPRIA_MS,
  eAcaoPropriaDoPedido,
  esquecerAcaoPropriaDoPedido,
} from "@/lib/acao-propria-do-painel";
import { tipoDoAvisoDoPedido } from "@/lib/aviso-de-pedido-atualizado";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const invoke = vi.fn();
let evento: ((payload: unknown) => Promise<void>) | undefined;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    channel: () => {
      const canal = {
        on: (_tipo: string, _filtro: unknown, handler: typeof evento) => {
          evento = handler;
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-r43e" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "p1";

function linha(status: string, payment_status = "aguardando") {
  return {
    id: ID,
    status,
    payment_status,
    payment_method: "online",
    customer_name: "Cliente Teste",
    created_at: "2026-11-06T10:00:00Z",
    updated_at: "2026-11-06T11:00:00Z",
    items: [],
  };
}

let recebidos: Array<Record<string, any>>;
let atuais: ReturnType<typeof useOrders>;
function Sonda() {
  const retorno = useOrders(true, true, {
    onRealtimeEvent: (payload) => recebidos.push(payload),
  });
  useEffect(() => {
    atuais = retorno;
  });
  return null;
}

/** Um UPDATE do realtime: o pedido virou `cancelled` no banco. */
async function chegaOCancelamentoPeloRealtime() {
  expect(evento).toBeDefined();
  await act(async () => {
    await evento!({
      eventType: "UPDATE",
      old: { id: ID },
      new: linha("cancelled"),
    });
  });
  return recebidos[recebidos.length - 1];
}

/** A edge, nas mãos do teste: a resposta só sai quando `responder` é chamado. */
function edgePendurada() {
  let responder!: (resposta: unknown) => void;
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        responder = resolve;
      }),
  );
  return { responder: (r: unknown) => responder(r) };
}

const CANCELADO = { data: { cancelamento: "cancelado" }, error: null };

describe("cancelar pedido online pelo painel não avisa duas vezes (r43-e)", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    evento = undefined;
    recebidos = [];
    esquecerAcaoPropriaDoPedido(ID);
    rpc.mockReset();
    invoke.mockReset();
    rpc.mockImplementation((nome: string) => {
      const paginaDe = (linhas: unknown[]) => ({
        abortSignal: () =>
          Promise.resolve({
            data: { data: linhas, total_count: linhas.length },
            error: null,
          }),
      });
      if (nome === "get_admin_orders_paged")
        return paginaDe([linha("pending")]);
      // Depois de cancelar, o hook refaz a varredura dos cancelados.
      if (nome === "get_admin_orders_cancelados_recentes") return paginaDe([]);
      throw new Error(`RPC inesperada: ${nome}`);
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await atuais.loadOrders(0, 12, "all", "", undefined, undefined, false);
    });
    expect(atuais.orders.map((p) => p.id)).toEqual([ID]);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      await vi.advanceTimersByTimeAsync(4001);
    });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Inicia o cancelamento e devolve a promessa (sem esperar a edge). */
  function comecarACancelar(silent = false) {
    let promessa!: Promise<unknown>;
    act(() => {
      promessa = atuais
        .updateOrderStatus(ID, "cancelled", undefined, silent)
        .then(
          () => null,
          (e: unknown) => e,
        );
    });
    return promessa;
  }

  it("o evento do próprio cancelamento chega ANTES da resposta da edge: nenhum aviso 'atualizado para'", async () => {
    const edge = edgePendurada();
    const terminou = comecarACancelar();

    const chegou = await chegaOCancelamentoPeloRealtime();
    // O "antes" é a etapa que a tela ainda tem — sem a marca, avisaria.
    expect(chegou.old).toMatchObject({ id: ID, status: "pending" });
    expect(tipoDoAvisoDoPedido(chegou)).toBeNull();

    await act(async () => {
      edge.responder(CANCELADO);
      await terminou;
    });
    expect(await terminou).toBeNull();
  });

  it("borda: edge LENTA (o Mercado Pago demorou mais que a janela de 15 s) — o evento que chega antes da resposta também não avisa", async () => {
    const edge = edgePendurada();
    const terminou = comecarACancelar();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JANELA_DA_ACAO_PROPRIA_MS + 5_000);
    });
    const chegou = await chegaOCancelamentoPeloRealtime();
    expect(tipoDoAvisoDoPedido(chegou)).toBeNull();

    await act(async () => {
      edge.responder(CANCELADO);
      await terminou;
    });
    expect(await terminou).toBeNull();
  });

  it("depois do cancelamento provado a marca volta à janela curta de 15 s (cancelamento de OUTRA pessoa mais tarde ainda avisa)", async () => {
    const edge = edgePendurada();
    const terminou = comecarACancelar();
    await act(async () => {
      edge.responder(CANCELADO);
      await terminou;
    });
    expect(eAcaoPropriaDoPedido(ID, "cancelled")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(JANELA_DA_ACAO_PROPRIA_MS + 1);
    });
    expect(eAcaoPropriaDoPedido(ID, "cancelled")).toBe(false);
  });

  it.each([
    ["ja_pago", { cancelamento: "ja_pago", mensagem: "Pago agora." }],
    ["em_analise", { cancelamento: "em_analise", mensagem: "Em análise." }],
    ["mudou", { cancelamento: "mudou", mensagem: "Mudou." }],
  ])(
    "a edge NÃO cancelou (%s): a marca é desfeita — um cancelamento que chegar depois é de outra pessoa e avisa",
    async (_nome, corpo) => {
      const edge = edgePendurada();
      const terminou = comecarACancelar();
      expect(eAcaoPropriaDoPedido(ID, "cancelled")).toBe(true);

      await act(async () => {
        edge.responder({ data: corpo, error: null });
        await terminou;
      });
      expect(await terminou).toMatchObject({
        name: "ErroCancelamentoNaoConcluido",
      });
      expect(eAcaoPropriaDoPedido(ID, "cancelled")).toBe(false);

      const chegou = await chegaOCancelamentoPeloRealtime();
      expect(tipoDoAvisoDoPedido(chegou)).toBe("status");
    },
  );

  it("borda: a chamada à edge falha (rede caiu): a marca é desfeita", async () => {
    invoke.mockRejectedValue(new TypeError("Failed to fetch"));
    const terminou = comecarACancelar();
    await act(async () => {
      await terminou;
    });
    expect(await terminou).toMatchObject({
      name: "ErroCancelamentoNaoConcluido",
    });
    expect(eAcaoPropriaDoPedido(ID, "cancelled")).toBe(false);
  });

  it("controle: sem clique da lojista (cancelamento de outra pessoa) o aviso sai como sempre", async () => {
    const chegou = await chegaOCancelamentoPeloRealtime();
    expect(tipoDoAvisoDoPedido(chegou)).toBe("status");
  });

  it("controle: chamada silenciosa (`silent`) não marca nada — nesse caminho o aviso continua sendo o único", async () => {
    const edge = edgePendurada();
    const terminou = comecarACancelar(true);
    expect(eAcaoPropriaDoPedido(ID, "cancelled")).toBe(false);
    await act(async () => {
      edge.responder(CANCELADO);
      await terminou;
    });
  });
});
