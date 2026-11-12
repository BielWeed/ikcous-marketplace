// @vitest-environment jsdom
// Protege o "ao vivo" da lista de pedidos da cliente (DADO DE CLIENTE):
//  (1) o INSERT consulta o pedido por id e só DEPOIS grava e avisa — se a
//      cliente saiu/trocou de conta (ou a tela fechou) no meio, nada disso
//      pode acontecer;
//  (2) um UPDATE mais VELHO que o que a lista já tem não desfaz status nem
//      pagamento (a leitura e a tela de detalhe já barravam; a lista não);
//  (3) um UPDATE que chega enquanto o INSERT ainda consulta (pedido ainda
//      ausente) não se perde: vale quando o pedido entra.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  porId: new Map<string, unknown>(),
  eventos: new Map<string, (payload: unknown) => Promise<void>>(),
  consultasPorId: vi.fn(),
  portao: null as Promise<void> | null,
  user: { id: "inicial" } as { id: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      let idAlvo: string | null = null;
      const alvo: Record<string, unknown> = {
        select: () => alvo,
        eq: (coluna: string, valor: string) => {
          if (coluna === "id") idAlvo = valor;
          return alvo;
        },
        order: () => alvo,
        range: () => alvo,
        limit: () => alvo,
        or: () => alvo,
        in: () => alvo,
        abortSignal: () => alvo,
        single: () => alvo,
        maybeSingle: () => alvo,
      };
      // biome-ignore lint/suspicious/noThenProperty: dublê awaitable do Supabase.
      Object.defineProperty(alvo, "then", {
        value: (resolve: (resposta: unknown) => unknown) => {
          if (tabela === "marketplace_orders" && idAlvo) {
            const id = idAlvo;
            rede.consultasPorId(id);
            const espera = rede.portao ?? Promise.resolve();
            return espera
              .then(() => ({ data: rede.porId.get(id) ?? null, error: null }))
              .then(resolve);
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(
            resolve,
          );
        },
      });
      return alvo;
    },
    channel: () => {
      const canal = {
        on: (
          _tipo: string,
          filtro: { filter?: string },
          handler: (payload: unknown) => Promise<void>,
        ) => {
          rede.eventos.set(filtro.filter ?? "", handler);
          return canal;
        },
        subscribe: (callback?: (status: string) => void) => {
          callback?.("SUBSCRIBED");
          return canal;
        },
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: rede.user, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { mesclarAtualizacaoRealtime, useOrders } from "@/hooks/useOrders";
import type { Order } from "@/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// O canal do realtime é global ao módulo e chaveado pela conta: cada teste usa
// contas novas para registrar o próprio canal (senão reaproveita o do anterior).
let sequencia = 0;

const T2 = "2026-11-10T10:02:00.000Z";
const T3 = "2026-11-10T10:03:00.000Z";
const T4 = "2026-11-10T10:04:00.000Z";

const linha = (
  id: string,
  userId: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  user_id: userId,
  customer_name: "Cliente de teste",
  customer_data: {},
  items: [],
  total: 10,
  subtotal: 10,
  shipping: 0,
  discount: 0,
  payment_method: "pix",
  payment_status: "aguardando",
  status: "pending",
  created_at: new Date(0).toISOString(),
  updated_at: T3,
  ...extra,
});

describe("useOrders — o ao vivo da cliente respeita a conta e a versão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: ReturnType<typeof useOrders>;
  let abrirPortao: () => void;
  let dono = "";
  let donoB = "";

  function Sonda() {
    const retorno = useOrders(true, false);
    useEffect(() => {
      atual = retorno;
    });
    return null;
  }

  const idsNaLista = () => atual.orders.map((pedido) => pedido.id);

  function fecharPortao() {
    rede.portao = new Promise<void>((resolve) => {
      abrirPortao = resolve;
    });
  }

  async function renderizar() {
    await act(async () => raiz.render(<Sonda />));
  }

  async function entregarEsperando(
    tipo: "INSERT" | "UPDATE",
    novo: Record<string, unknown>,
    donoDoCanal = dono,
  ) {
    const handler = rede.eventos.get(`user_id=eq.${donoDoCanal}`);
    expect(handler).toBeDefined();
    await act(async () => {
      await handler?.({ eventType: tipo, new: novo, old: {} });
    });
  }

  /** Entrega o evento e NÃO espera a consulta terminar (portão fechado). */
  function entregarSemEsperar(
    tipo: "INSERT" | "UPDATE",
    novo: Record<string, unknown>,
    donoDoCanal = dono,
  ) {
    const handler = rede.eventos.get(`user_id=eq.${donoDoCanal}`);
    expect(handler).toBeDefined();
    return handler?.({ eventType: tipo, new: novo, old: {} }) as Promise<void>;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    rede.porId.clear();
    rede.eventos.clear();
    rede.portao = null;
    sequencia += 1;
    dono = `cliente-a-${sequencia}`;
    donoB = `cliente-b-${sequencia}`;
    rede.user = { id: dono };
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await renderizar();
  });

  afterEach(() => {
    try {
      act(() => raiz.unmount());
    } catch {
      // já desmontado dentro do teste
    }
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("INSERT com a consulta em voo", () => {
    it("CONTROLE: mesma conta, consulta demorada — o pedido entra e avisa", async () => {
      rede.porId.set("ped-a", linha("ped-a", dono));
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-a" });
      await act(async () => {
        abrirPortao();
        await voo;
      });

      expect(idsNaLista()).toEqual(["ped-a"]);
      expect(toast.info).toHaveBeenCalledTimes(1);
    });

    it("Sair no meio da consulta: o pedido da conta anterior não entra na lista nem avisa", async () => {
      rede.porId.set("ped-a", linha("ped-a", dono));
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-a" });

      rede.user = null; // o Sair cai AQUI, no meio da consulta
      await renderizar();

      await act(async () => {
        abrirPortao();
        await voo;
      });

      expect(idsNaLista()).not.toContain("ped-a");
      expect(toast.info).not.toHaveBeenCalled();
    });

    it("Troca de conta no meio da consulta: o pedido de A não aparece para B", async () => {
      rede.porId.set("ped-a", linha("ped-a", dono));
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-a" });

      rede.user = { id: donoB };
      await renderizar();

      await act(async () => {
        abrirPortao();
        await voo;
      });

      expect(idsNaLista()).not.toContain("ped-a");
      expect(toast.info).not.toHaveBeenCalled();
    });

    it("Tela desmontada no meio da consulta: nada é avisado", async () => {
      rede.porId.set("ped-a", linha("ped-a", dono));
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-a" });

      act(() => raiz.unmount());

      await act(async () => {
        abrirPortao();
        await voo;
      });

      expect(toast.info).not.toHaveBeenCalled();
    });
  });

  describe("UPDATE atrasado não desfaz o que a lista já sabe", () => {
    async function listaComPedidoEm(extra: Record<string, unknown>) {
      rede.porId.set("ped-1", linha("ped-1", dono, extra));
      await entregarEsperando("INSERT", { id: "ped-1" });
      expect(idsNaLista()).toEqual(["ped-1"]);
    }

    it("UPDATE com updated_at MAIS ANTIGO (T2) é ignorado: continua em separação e pago (T3)", async () => {
      await listaComPedidoEm({
        status: "processing",
        payment_status: "pago",
        updated_at: T3,
      });

      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, {
          status: "pending",
          payment_status: "aguardando",
          updated_at: T2,
        }),
      );

      const pedido = atual.orders.find((p) => p.id === "ped-1");
      expect(pedido?.status).toBe("processing");
      expect(pedido?.paymentStatus).toBe("pago");
      expect(pedido?.updatedAt).toBe(T3);
    });

    it("UPDATE MAIS NOVO (T4) é aplicado", async () => {
      await listaComPedidoEm({ status: "pending", updated_at: T3 });

      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, { status: "processing", updated_at: T4 }),
      );

      const pedido = atual.orders.find((p) => p.id === "ped-1");
      expect(pedido?.status).toBe("processing");
      expect(pedido?.updatedAt).toBe(T4);
    });

    it("UPDATE sem data (controle, comportamento de hoje) é aplicado", async () => {
      await listaComPedidoEm({ status: "pending", updated_at: T3 });

      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, {
          status: "processing",
          updated_at: undefined,
        }),
      );

      expect(atual.orders.find((p) => p.id === "ped-1")?.status).toBe(
        "processing",
      );
    });

    it("UPDATE com a MESMA data e conteúdo diferente é aplicado (a otimista não mexe na data)", async () => {
      await listaComPedidoEm({ status: "pending", updated_at: T3 });

      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, { status: "processing", updated_at: T3 }),
      );

      expect(atual.orders.find((p) => p.id === "ped-1")?.status).toBe(
        "processing",
      );
    });
  });

  describe("UPDATE que chega enquanto o INSERT ainda consulta", () => {
    it("o UPDATE mais novo guardado vale quando o pedido entra (a consulta devolveu a versão velha)", async () => {
      rede.porId.set(
        "ped-1",
        linha("ped-1", dono, { payment_status: "aguardando", updated_at: T3 }),
      );
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-1" });

      // Chega pelo canal enquanto o pedido ainda não está na lista.
      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, { payment_status: "pago", updated_at: T4 }),
      );
      expect(idsNaLista()).toEqual([]);

      await act(async () => {
        abrirPortao();
        await voo;
      });

      const pedido = atual.orders.find((p) => p.id === "ped-1");
      expect(pedido?.paymentStatus).toBe("pago");
      expect(pedido?.updatedAt).toBe(T4);
    });

    it("LIMITE: o UPDATE guardado mais ANTIGO que a consulta não desfaz a consulta", async () => {
      rede.porId.set(
        "ped-1",
        linha("ped-1", dono, { payment_status: "pago", updated_at: T4 }),
      );
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-1" });

      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, {
          payment_status: "aguardando",
          updated_at: T2,
        }),
      );

      await act(async () => {
        abrirPortao();
        await voo;
      });

      expect(atual.orders.find((p) => p.id === "ped-1")?.paymentStatus).toBe(
        "pago",
      );
    });

    it("LIMITE: dois UPDATEs fora de ordem no voo (T4 e depois T2) — vale o mais novo (T4)", async () => {
      rede.porId.set(
        "ped-1",
        linha("ped-1", dono, { payment_status: "aguardando", updated_at: T3 }),
      );
      fecharPortao();
      const voo = entregarSemEsperar("INSERT", { id: "ped-1" });

      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, { payment_status: "pago", updated_at: T4 }),
      );
      await entregarEsperando(
        "UPDATE",
        linha("ped-1", dono, { payment_status: "recusado", updated_at: T2 }),
      );

      await act(async () => {
        abrirPortao();
        await voo;
      });

      const pedido = atual.orders.find((p) => p.id === "ped-1");
      expect(pedido?.paymentStatus).toBe("pago");
      expect(pedido?.updatedAt).toBe(T4);
    });

    it("CONTROLE: UPDATE sem INSERT em voo, de id já consultado antes, não vira estado do próximo INSERT do mesmo id", async () => {
      // 1º INSERT termina SEM inserir (pedido de outra conta). (A limpeza da
      // entrada do voo é higiene de memória: o INSERT seguinte já reinicia a
      // entrada, então nenhum teste de comportamento a distingue.)
      rede.porId.set("ped-x", linha("ped-x", donoB, { updated_at: T3 }));
      await entregarEsperando("INSERT", { id: "ped-x" });
      expect(idsNaLista()).toEqual([]);

      // UPDATE que ninguém está esperando (nenhum INSERT em voo).
      await entregarEsperando(
        "UPDATE",
        linha("ped-x", dono, { status: "shipped", updated_at: T4 }),
      );

      // Agora o pedido é da cliente e é inserido: vale a CONSULTA (T3), não o
      // UPDATE órfão (T4).
      rede.porId.set("ped-x", linha("ped-x", dono, { updated_at: T3 }));
      await entregarEsperando("INSERT", { id: "ped-x" });
      const pedido = atual.orders.find((p) => p.id === "ped-x");
      expect(pedido?.status).toBe("pending");
      expect(pedido?.updatedAt).toBe(T3);
    });

    it("LIMITE: UPDATE de pedido que ninguém está inserindo continua descartado (nada é guardado para sempre)", async () => {
      await entregarEsperando(
        "UPDATE",
        linha("ped-fantasma", dono, { updated_at: T4 }),
      );
      expect(idsNaLista()).toEqual([]);

      // Um INSERT posterior do mesmo id NÃO herda o UPDATE velho esquecido.
      rede.porId.set(
        "ped-fantasma",
        linha("ped-fantasma", dono, {
          status: "pending",
          updated_at: T3,
        }),
      );
      await entregarEsperando("INSERT", { id: "ped-fantasma" });
      expect(atual.orders.find((p) => p.id === "ped-fantasma")?.updatedAt).toBe(
        T3,
      );
    });
  });
});

describe("mesclarAtualizacaoRealtime — versão anterior não ganha", () => {
  const base = (extra: Partial<Order> = {}): Order =>
    ({
      id: "p-1",
      userId: "u-1",
      customer: { name: "Cliente Teste" },
      items: [{ productId: "x", name: "Blusa", price: 1, quantity: 1 }],
      subtotal: 10,
      shipping: 0,
      discount: 0,
      total: 10,
      paymentMethod: "pix",
      paymentStatus: "pago",
      status: "processing",
      createdAt: T2,
      updatedAt: T3,
      ...extra,
    }) as unknown as Order;

  it("linha estritamente anterior devolve o pedido da memória intacto (mesma referência)", () => {
    const atualDaMemoria = base();
    const resultado = mesclarAtualizacaoRealtime(
      atualDaMemoria,
      linha("p-1", "u-1", {
        status: "pending",
        payment_status: "aguardando",
        updated_at: T2,
      }) as never,
    );
    expect(resultado).toBe(atualDaMemoria);
  });

  it("linha de data ilegível não é 'velha': decide o conteúdo (aplica)", () => {
    const resultado = mesclarAtualizacaoRealtime(
      base(),
      linha("p-1", "u-1", {
        status: "shipped",
        updated_at: "isto-nao-e-data",
      }) as never,
    );
    expect(resultado.status).toBe("shipped");
  });
});
