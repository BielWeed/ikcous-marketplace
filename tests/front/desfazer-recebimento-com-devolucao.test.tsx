// @vitest-environment jsdom

import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import type { Order } from "@/types";
import { act, useLayoutEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const pedido: Order = {
  id: "pedido-devolucao",
  customer: {
    name: "Cliente Teste",
    whatsapp: "",
    address: "",
    number: "",
    neighborhood: "",
    city: "",
    state: "",
  },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  paymentStatus: "recebido_na_entrega",
  createdAt: "2026-10-08T14:00:00Z",
  updatedAt: "2026-10-08T14:00:00Z",
  cancelledAfterShipping: false,
  pagamentoRecebidoEm: "2026-10-08T14:00:00Z",
  canal: "online",
};

function devolucao(status: string) {
  return {
    id: `dev-${status}`,
    protocolo: "DV260926-ABCDE",
    status,
    tipo: "arrependimento",
    resolucao_desejada: "reembolso",
    metodo_retorno: "envio_proprio",
    valor_itens: 50,
    created_at: "2026-10-09T12:00:00Z",
  };
}

function pendente() {
  let resolver!: (resposta: { data: unknown; error: unknown }) => void;
  const promessa = new Promise<{ data: unknown; error: unknown }>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoRegistrar = vi.fn();
const motivo =
  "Este pedido tem devolução; o recebimento não pode ser desfeito.";

function botao(texto: string, area: ParentNode = hospedeiro) {
  return Array.from(area.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  aoRegistrar.mockReset();
  rpc.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe.each(["ficha", "lista"] as const)("Desfazer na %s", (local) => {
  async function montar(order = pedido, aoMontar?: () => void) {
    // Lê o primeiro DOM antes do efeito que inicia a consulta.
    function Sonda() {
      useLayoutEffect(() => aoMontar?.(), [aoMontar]);
      return null;
    }
    await act(async () => {
      raiz.render(
        <>
          {local === "ficha" ? (
            <OrderDetail
              order={order}
              onStatusChange={vi.fn()}
              onRegistrarPagamento={aoRegistrar}
            />
          ) : (
            <AdminOrderCard
              order={order}
              viewMode="compact"
              onSelect={vi.fn()}
              onWhatsApp={vi.fn()}
              onRegistrarPagamento={aoRegistrar}
              registrandoPagamento={false}
            />
          )}
          <Sonda />
        </>,
      );
    });
  }

  const consultas = () =>
    rpc.mock.calls.filter(([nome]) => nome === "devolucoes_do_pedido");

  const abrirDesfazer = async () => {
    const desfazer = botao("Desfazer");
    expect(desfazer?.disabled).toBe(false);
    await act(async () => desfazer?.click());
  };

  it.each(["solicitada", "aprovada", "em_transito", "recebida", "concluida"])(
    "bloqueia e explica quando a devolução está %s",
    async (status) => {
      rpc.mockResolvedValue({ data: [devolucao(status)], error: null });
      await montar();
      if (local === "lista") {
        expect(consultas()).toEqual([]);
        await abrirDesfazer();
        expect(document.body.textContent).toContain(motivo);
        expect(botao("Desfazer recebimento", document.body)).toBeUndefined();
      } else {
        expect(hospedeiro.textContent).toContain(motivo);
        expect(botao("Desfazer")?.disabled ?? true).toBe(true);
      }
      expect(aoRegistrar).not.toHaveBeenCalled();
    },
  );

  it("aguarda a resposta desde a primeira renderização e não repete a consulta", async () => {
    const leitura = pendente();
    rpc.mockImplementation((nome: string) =>
      nome === "devolucoes_do_pedido" ? leitura.promessa : undefined,
    );
    let habilitadoAoMontar: boolean | undefined;
    await montar(pedido, () => {
      habilitadoAoMontar = botao("Desfazer")?.disabled === false;
    });

    expect(habilitadoAoMontar).toBe(local === "lista");
    if (local === "lista") {
      expect(consultas()).toEqual([]);
      await abrirDesfazer();
      expect(botao("Desfazer recebimento", document.body)).toBeUndefined();
    } else {
      expect(botao("Desfazer")?.disabled ?? true).toBe(true);
    }
    expect(document.body.textContent).not.toContain(motivo);
    expect(consultas()).toEqual([
      ["devolucoes_do_pedido", { p_order_id: pedido.id }],
    ]);

    await act(async () => {
      leitura.resolver({ data: [], error: null });
    });
    expect(
      local === "lista"
        ? botao("Desfazer recebimento", document.body)?.disabled
        : botao("Desfazer")?.disabled,
    ).toBe(false);
  });

  it("não usa a leitura do pedido anterior para habilitar a ação no novo", async () => {
    const outro = { ...pedido, id: "outro-pedido" };
    const leitura = pendente();
    rpc.mockImplementation((nome: string, params: { p_order_id: string }) => {
      if (nome !== "devolucoes_do_pedido") return undefined;
      return params.p_order_id === outro.id
        ? leitura.promessa
        : { data: [], error: null };
    });
    await montar();
    expect(botao("Desfazer")?.disabled).toBe(false);

    let habilitadoAoTrocar: boolean | undefined;
    await montar(outro, () => {
      habilitadoAoTrocar = botao("Desfazer")?.disabled === false;
    });
    expect(habilitadoAoTrocar).toBe(local === "lista");
    if (local === "lista") {
      expect(consultas()).toEqual([]);
      await abrirDesfazer();
      expect(consultas()).toEqual([
        ["devolucoes_do_pedido", { p_order_id: outro.id }],
      ]);
      expect(botao("Desfazer recebimento", document.body)).toBeUndefined();
    }

    await act(async () => {
      leitura.resolver({ data: [devolucao("concluida")], error: null });
    });
    expect(document.body.textContent).toContain(motivo);
  });

  it("avisa quando a leitura falha, sem tirar a confirmação nem a nova tentativa", async () => {
    let resposta: { data: unknown; error: unknown } = {
      data: null,
      error: { message: "rede indisponível" },
    };
    rpc.mockImplementation((nome: string) =>
      nome === "devolucoes_do_pedido" ? resposta : undefined,
    );
    await montar();
    await abrirDesfazer();

    expect(document.body.textContent).toContain(
      "Não consegui conferir as devoluções deste pedido.",
    );
    expect(botao("Desfazer recebimento", document.body)?.disabled).toBe(false);

    if (local === "ficha") {
      await act(async () => botao("Voltar", document.body)?.click());
    }
    const tentar = botao("Tentar de novo", document.body);
    expect(tentar?.disabled).toBe(false);
    resposta = { data: [devolucao("solicitada")], error: null };
    await act(async () => tentar?.click());

    expect(consultas()).toHaveLength(2);
    expect(document.body.textContent).toContain(motivo);
    expect(botao("Desfazer recebimento", document.body)).toBeUndefined();
    expect(aoRegistrar).not.toHaveBeenCalled();
  });

  it("permite confirmar se as devoluções foram recusadas, canceladas ou reprovadas", async () => {
    rpc.mockResolvedValue({
      data: ["recusada", "cancelada", "reprovada"].map(devolucao),
      error: null,
    });
    await montar();

    await act(async () => botao("Desfazer")?.click());
    expect(aoRegistrar).not.toHaveBeenCalled();
    const confirmar = botao("Desfazer recebimento", document.body);
    expect(confirmar).toBeDefined();
    await act(async () => confirmar?.click());
    expect(aoRegistrar).toHaveBeenCalledExactlyOnceWith(pedido.id, false);
  });
});
