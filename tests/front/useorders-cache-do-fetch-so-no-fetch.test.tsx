// @vitest-environment jsdom
//
// P-2 (laudo varredura profunda 01/09): o cache de "Meus Pedidos" estava
// desonesto em dois pontos.
//
// 1. Os TRÊS updaters de realtime (insert/update/delete) RE-SERIALIZAVAM a
//    lista inteira e gravavam no localStorage a CADA EVENTO — uma rajada de
//    PIX/status virava uma rajada de serialização O(n) por evento, e o cache
//    gravado podia ser uma lista SEM as junções (`items`/`address`) que só o
//    fetch traz. O estado EM MEMÓRIA continua sendo atualizado a cada
//    evento; o cache só se renova no fetch, que roda no mount.
//
// 2. O `setItem` do fetch não tinha try/catch: localStorage cheio
//    (QuotaExceededError) caía no catch do fetch inteiro e a pessoa levava
//    toast de "Erro ao carregar seus pedidos" — mentira, a rede funcionou;
//    quem falhou foi o armazenamento LOCAL.
//
// O teste monta o hook REAL (mesmo casco de
// `use-orders-estado-de-conexao-realtime.test.ts`), entrega o evento de
// realtime no handler do canal e espiona o `localStorage` stubado.
import { act } from "react";
import { createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let usuarioAtual: { id: string } | null = null;
let liderAtual = true;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => builderDoFetch()),
    channel: vi.fn(() => {
      handlersDoCanal = new Map();
      const canal: any = {};
      canal.on = vi.fn(
        (_tipo: string, cfg: any, handler: (payload: any) => void) => {
          handlersDoCanal.set(cfg.table, handler);
          return canal;
        },
      );
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

import { toast } from "sonner";
import { useOrders } from "@/hooks/useOrders";

let handlersDoCanal: Map<string, (payload: any) => void> = new Map();

// A linha CRUA que o fetch devolve (com as junções) — mesma forma do
// `linhaRealtimeDePagamentoConfirmado` de
// `realtime-atualiza-pagamento-sem-sair-da-tela.test.ts`.
function linhaDePedido(overrides: Record<string, any> = {}) {
  return {
    id: "pedido-1",
    address_id: null,
    coupon_id: null,
    customer_phone: null,
    expires_at: null,
    gateway_payment_id: null,
    observation: null,
    shipping_cost: null,
    total_amount: null,
    user_id: "user-1",
    customer_name: "Cliente Teste",
    customer_data: {
      whatsapp: "34999999999",
      address_id: "endereco-1",
      address: null,
      shipping_option_id: "padrão",
      destination_cep: "38400-000",
    },
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    payment_method: "pix",
    payment_status: "aguardando",
    status: "pending",
    notes: null,
    coupon_code: null,
    tracking_code: null,
    cancelled_after_shipping: false,
    returned_to_seller_at: null,
    created_at: "2026-08-26T10:00:00.000Z",
    updated_at: "2026-08-26T10:00:00.000Z",
    items: [
      {
        id: "item-1",
        order_id: "pedido-1",
        product_id: "prod-1",
        variant_id: null,
        quantity: 1,
        price: 100,
        product_name: "Blusa Teste",
        image_url: null,
        product: { imagem_url: null, imagem_urls: null },
      },
    ],
    address: null,
    ...overrides,
  };
}

function builderDoFetch(linhas: any[] = [linhaDePedido()]) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  builder.single = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: linhas, error: null }).then(resolve, reject);
  return builder;
}

/** localStorage stub com espião de setItem — e modo "cofre cheio". */
function stubLocalStorage({ estoura = false } = {}) {
  const loja = new Map<string, string>();
  const gravacoes: Array<{ chave: string; tamanho: number }> = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => loja.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (estoura) {
        const erro = new Error("The quota has been exceeded");
        erro.name = "QuotaExceededError";
        throw erro;
      }
      gravacoes.push({ chave: k, tamanho: v.length });
      loja.set(k, v);
    },
    removeItem: (k: string) => loja.delete(k),
  });
  return { gravacoes };
}

function stubBroadcastChannelVazio() {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda(props: {
  onResultado: (resultado: ReturnType<typeof useOrders>) => void;
}) {
  const resultado = useOrders(true, false);
  props.onResultado(resultado);
  return null;
}

function criarCaptura<T>() {
  const caixa: { valor: T | null } = { valor: null };
  return {
    onResultado: (r: T) => {
      caixa.valor = r;
    },
    get valor(): T | null {
      return caixa.valor;
    },
  };
}

describe("useOrders — o cache do localStorage é do fetch, não de cada evento realtime", () => {
  let raiz: Root | null = null;
  let hospedeiro: HTMLDivElement | null = null;
  let contadorDeUsuario = 0;

  beforeEach(() => {
    contadorDeUsuario += 1;
    // user.id único por teste: `globalOrderSubscriptions` é mapa de MÓDULO e
    // sobrevive entre `it`s — mesmo cuidado de
    // `use-orders-estado-de-conexao-realtime.test.ts`.
    usuarioAtual = { id: `user-cache-p2-${contadorDeUsuario}` };
    liderAtual = true;
    handlersDoCanal = new Map();
    stubBroadcastChannelVazio();
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
    vi.unstubAllGlobals();
  });

  async function montar() {
    const captura = criarCaptura<ReturnType<typeof useOrders>>();
    raiz = createRoot(hospedeiro as HTMLDivElement);
    await act(async () => {
      raiz?.render(createElement(Sonda, { onResultado: captura.onResultado }));
    });
    return captura;
  }

  it("o fetch grava o cache 1x; o evento realtime de status atualiza a MEMÓRIA e não escreve no localStorage", async () => {
    const espiao = stubLocalStorage();
    const captura = await montar();

    await act(async () => {
      await captura.valor?.fetchUserOrders();
    });

    // A lista aparece na tela (estado em memória).
    expect(captura.valor?.orders).toHaveLength(1);
    // O fetch grava o cache — UMA vez.
    expect(espiao.gravacoes).toHaveLength(1);
    expect(espiao.gravacoes[0].chave).toBe(
      `ikcous_orders_cache_${usuarioAtual?.id}`,
    );

    // O realtime do Postgres entrega a LINHA INTEIRA em payload.new.
    const linhaPago = linhaDePedido({ payment_status: "pago" });
    await act(async () => {
      handlersDoCanal.get("marketplace_orders")?.({
        eventType: "UPDATE",
        new: linhaPago,
        old: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // O estado EM MEMÓRIA atualiza (o PIX confirmou sem sair da tela).
    expect(captura.valor?.orders[0].paymentStatus).toBe("pago");
    // E o cache NÃO foi reescrito pelo evento.
    expect(espiao.gravacoes).toHaveLength(1);
  });

  it("DELETE por realtime atualiza a memória e não escreve no cache", async () => {
    const espiao = stubLocalStorage();
    const captura = await montar();
    await act(async () => {
      await captura.valor?.fetchUserOrders();
    });
    expect(espiao.gravacoes).toHaveLength(1);

    await act(async () => {
      handlersDoCanal.get("marketplace_orders")?.({
        eventType: "DELETE",
        new: null,
        old: { id: "pedido-1" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(captura.valor?.orders).toHaveLength(0);
    expect(espiao.gravacoes).toHaveLength(1);
  });

  it("localStorage cheio (quota estourada): o fetch NÃO vira toast de erro e a lista aparece na tela", async () => {
    stubLocalStorage({ estoura: true });
    const captura = await montar();

    await act(async () => {
      await captura.valor?.fetchUserOrders();
    });

    // A tela segue funcional: a lista está lá.
    expect(captura.valor?.orders).toHaveLength(1);
    // Armazenamento local cheio NÃO é erro de rede — sem toast.
    expect(toast.error).not.toHaveBeenCalled();
  });
});
