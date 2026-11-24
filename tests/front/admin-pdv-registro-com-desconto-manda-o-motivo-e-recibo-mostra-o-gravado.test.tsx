// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026) na tela de registro do balcão, com DESCONTO:
//  1. o que vai ao banco: o desconto, o total esperado já descontado (R$ 74,80,
//     em centavos exatos) e o motivo em `p_observacao` — só quando HÁ desconto
//     (um motivo velho de um desconto que a lojista zerou não vira observação
//     de uma venda sem desconto);
//  2. o recibo mostra o desconto que o BANCO gravou (a resposta da RPC), não o
//     que a tela achava: a linha "Desconto - R$ 5,00" e o total gravado.
//
// Molde: tests/front/admin-pdv-troco-nao-muda-o-registro.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

import {
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

// 2 x R$ 39,90 = R$ 79,80.
const ITEM = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

function respostaDoBanco(desconto: number, total: number) {
  return {
    ja_existia: false,
    order: {
      id: "abcdef12-3456-7890-abcd-ef1234567890",
      created_at: "2026-11-24T12:00:00.000Z",
      total,
      subtotal: 79.8,
      discount: desconto,
      payment_method: "cash" as const,
    },
    items: [
      {
        id: "item-1",
        product_id: "produto-1",
        variant_id: null,
        quantity: 2,
        price: 39.9,
        product_name: "Camiseta",
      },
    ],
  };
}

/** Texto como a lojista lê: cada pedaço de texto separado por espaço. */
function textoLegivel(el: Element): string {
  const pedacos: string[] = [];
  const andador = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = andador.nextNode(); n; n = andador.nextNode()) {
    pedacos.push(n.textContent ?? "");
  }
  return pedacos.join(" ").replace(/\s+/g, " ").trim();
}

function botaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("AdminPdvView — registro com desconto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function registrar(
    desconto: number,
    motivoDoDesconto: string,
    resposta: ReturnType<typeof respostaDoBanco>,
  ): Promise<Record<string, unknown>> {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "registrar_venda_presencial") {
        return { data: resposta, error: null };
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [ITEM],
        pagamento: "cash",
        desconto,
        motivoDoDesconto,
      }),
    );
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    const chamadas = rpcMock.mock.calls.filter(
      ([nome]) => nome === "registrar_venda_presencial",
    );
    expect(chamadas).toHaveLength(1);
    return chamadas[0][1] as Record<string, unknown>;
  }

  it("com desconto de R$ 5,00: manda desconto, total esperado R$ 74,80, motivo e a quantidade certa; o recibo mostra o desconto gravado", async () => {
    const argumentos = await registrar(
      5,
      "cliente fidelidade",
      respostaDoBanco(5, 74.8),
    );

    expect(argumentos).toEqual({
      p_itens: [{ product_id: "produto-1", variant_id: null, quantity: 2 }],
      p_pagamento: "cash",
      p_cliente_user_id: null,
      p_cliente_nome: null,
      p_cliente_whatsapp: null,
      p_desconto: 5,
      p_total_esperado: 74.8,
      p_observacao: "cliente fidelidade",
      p_idempotency_key: "chave-da-venda-teste",
    });

    // Recibo: o que o banco gravou. Número = 6 últimos caracteres do pedido.
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Venda registrada");
    expect(texto).toContain("Pedido #567890");
    const linhas = [...hospedeiro.querySelectorAll(".pdv-card .pdv-total")].map(
      (l) => textoLegivel(l),
    );
    expect(linhas).toEqual([
      "Subtotal R$ 79,80",
      "Desconto - R$ 5,00",
      "Total R$ 74,80",
    ]);
  });

  it("sem desconto, um motivo antigo que ficou no cupom NÃO vira observação da venda", async () => {
    const argumentos = await registrar(
      0,
      "motivo de um desconto que foi zerado",
      respostaDoBanco(0, 79.8),
    );

    expect(argumentos.p_desconto).toBe(0);
    expect(argumentos.p_observacao).toBeNull();
    expect(argumentos.p_total_esperado).toBe(79.8);
    const linhas = [...hospedeiro.querySelectorAll(".pdv-card .pdv-total")].map(
      (l) => textoLegivel(l),
    );
    expect(linhas).toEqual(["Subtotal R$ 79,80", "Total R$ 79,80"]);
  });
});
