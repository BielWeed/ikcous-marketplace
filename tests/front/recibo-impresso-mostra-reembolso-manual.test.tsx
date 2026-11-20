// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-com-devolucao",
  customer: { name: "Cliente Teste", whatsapp: "" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  shippingOptionId: "local-delivery",
  paymentStatus: "recebido_na_entrega",
  createdAt: "2026-11-18T16:00:00Z",
  updatedAt: "2026-11-18T16:00:00Z",
  cancelledAfterShipping: false,
};

function resumo(id: string, status = "concluida") {
  return {
    id,
    protocolo: `DV-${id}`,
    status,
    tipo: "arrependimento",
    resolucao_desejada: "reembolso",
    metodo_retorno: "entrega_na_loja",
    valor_itens: 100,
    created_at: "2026-11-19T13:00:00Z",
  };
}

function detalhe(id: string, valor: number, manual = true) {
  return {
    ...resumo(id),
    order_id: pedido.id,
    modalidade: "local",
    motivo: "desisti",
    resolucao_final: "reembolso",
    valor_reembolso: valor,
    reembolso_manual: manual,
  };
}

function simularDevolucoes(
  lista: ReturnType<typeof resumo>[],
  detalhes: ReturnType<typeof detalhe>[],
) {
  rpc.mockImplementation((nome: string, args: { p_id?: string }) => {
    if (nome === "devolucoes_do_pedido") {
      return Promise.resolve({ data: lista, error: null });
    }
    if (nome === "devolucao_detalhe") {
      const data = detalhes.find(({ id }) => id === args.p_id);
      return Promise.resolve({ data, error: data ? null : { code: "P0002" } });
    }
    throw new Error(`RPC inesperada: ${nome}`);
  });
}

describe("recibo da ficha — reembolso feito pela loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(order: Order = pedido) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  const papel = () => document.body.querySelector(".print\\:block");
  const textosDeParagrafos = () =>
    [...(papel()?.querySelectorAll("p") ?? [])].map((p) => p.textContent);
  const linhaManual = () =>
    [...(papel()?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "Devolvido ao cliente (manual):",
    );

  it("soma só os reembolsos manuais concluídos; integral não diz apenas Pago", async () => {
    simularDevolucoes(
      [resumo("a"), resumo("b"), resumo("aberta", "recebida")],
      [detalhe("a", 33.33), detalhe("b", 66.67), detalhe("aberta", 100)],
    );
    await montar();

    expect(linhaManual()?.nextElementSibling?.textContent).toBe("R$ 100,00");
    expect(textosDeParagrafos()).toContain("Estornado");
    expect(textosDeParagrafos()).not.toContain("Pago");
    expect(rpc).not.toHaveBeenCalledWith("devolucao_detalhe", {
      p_id: "aberta",
    });
  });

  it("mostra apenas o valor manual parcial e não confunde com Mercado Pago", async () => {
    simularDevolucoes(
      [resumo("manual"), resumo("mp")],
      [detalhe("manual", 20), detalhe("mp", 80, false)],
    );
    await montar();

    expect(linhaManual()?.nextElementSibling?.textContent).toBe("R$ 20,00");
    expect(textosDeParagrafos()).toContain("Pago");
    expect(textosDeParagrafos()).not.toContain("Estornado");
  });

  it("o reembolso manual e o confirmado pelo Mercado Pago podem completar o total", async () => {
    simularDevolucoes([resumo("manual")], [detalhe("manual", 30)]);
    await montar({
      ...pedido,
      paymentMethod: "online",
      paymentStatus: "pago",
      valorEstornado: 70,
    });

    expect(linhaManual()?.nextElementSibling?.textContent).toBe("R$ 30,00");
    expect(papel()?.textContent).toContain("Reembolsado pelo Mercado Pago:");
    expect(textosDeParagrafos()).toContain("Estornado");
  });

  it("uma devolução ainda não concluída não gera reembolso no papel", async () => {
    simularDevolucoes([resumo("aberta", "recebida")], []);
    await montar();

    expect(papel()).not.toBeNull();
    expect(linhaManual()).toBeUndefined();
    expect(textosDeParagrafos()).toContain("Pago");
    expect(rpc).not.toHaveBeenCalledWith("devolucao_detalhe", {
      p_id: "aberta",
    });
  });

  it("se faltar o detalhe de uma devolução, não imprime uma soma pela metade", async () => {
    simularDevolucoes(
      [resumo("lida"), resumo("sem-resposta")],
      [detalhe("lida", 33.33)],
    );
    await montar();

    expect(linhaManual()).toBeUndefined();
    expect(papel()?.textContent).toContain("Reembolsos manuais não conferidos");
    expect(textosDeParagrafos()).not.toContain("Estornado");
    expect(hospedeiro.textContent).toContain("DV-sem-resposta");
  });

  it("enquanto confere os reembolsos, o papel não sai com o aviso de não conferido", async () => {
    let liberar!: (resposta: { data: unknown[]; error: null }) => void;
    rpc.mockImplementation((nome: string) => {
      if (nome === "devolucoes_do_pedido") {
        return new Promise((resolve) => {
          liberar = resolve;
        });
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    await montar();

    expect(papel()).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "Conferindo os reembolsos feitos à mão.",
    );
    expect(document.body.textContent).not.toContain(
      "Reembolsos manuais não conferidos",
    );

    await act(async () => {
      liberar({ data: [], error: null });
    });

    expect(papel()).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Conferindo os reembolsos");
    expect(papel()?.textContent).not.toContain("não conferidos");
  });
});
