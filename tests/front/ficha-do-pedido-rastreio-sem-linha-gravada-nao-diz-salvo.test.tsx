// @vitest-environment jsdom
/**
 * Código de rastreio na ficha do pedido: "salvo" só se alguma linha foi gravada.
 *
 * A política de update de `marketplace_orders` filtra EM SILÊNCIO quando a
 * sessão deixou de ser admin (token sem papel, admin rebaixado com a aba
 * aberta): o banco responde 0 linhas e `error: null`. Sem conferir as linhas
 * devolvidas, a ficha dizia "Código de rastreio salvo!", fechava o campo e o
 * código nunca foi gravado — a cliente não recebia o rastreio e a lojista
 * achava que tinha avisado. A anotação interna da mesma ficha já confere
 * (`gravarNotaInterna`); o rastreio tem que fazer igual.
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { atualizar, resposta } = vi.hoisted(() => ({
  atualizar: vi.fn(),
  // o que o banco devolve ao `update().eq().select()` do código de rastreio
  resposta: {
    atual: { data: [{ id: "A" }], error: null } as {
      data: { id: string }[] | null;
      error: { message: string } | null;
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data:
                tabela === "config_mototaxi"
                  ? { whatsapp: null, nome: null }
                  : null,
              error: null,
            }),
        }),
      }),
      update: (valores: unknown) => {
        atualizar(tabela, valores);
        // Como o cliente do Supabase: `eq()` já é "esperável" (forma antiga,
        // sem pedir linhas de volta) e também encadeia `.select()`; as duas
        // formas resolvem com o que o teste mandou em `resposta.atual`.
        return {
          eq: () =>
            Object.assign(Promise.resolve(resposta.atual), {
              select: () => Promise.resolve(resposta.atual),
            }),
        };
      },
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));

import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(trackingCode: string): Order {
  return {
    id: "A",
    notes: "",
    trackingCode,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-10-16T10:00:00Z",
    updatedAt: "2026-10-16T10:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — rastreio: sem linha gravada não diz 'salvo'", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onStatusChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resposta.atual = { data: [{ id: "A" }], error: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function mostrar(order: Order) {
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  function campo() {
    return hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
  }

  function digitarNoCampoDoCodigo(texto: string) {
    const elemento = campo();
    if (!elemento) throw new Error("Campo ausente: #tracking-input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(elemento, texto);
      elemento.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function digitarESalvar(texto: string) {
    await mostrar(pedido("CODIGO-ANTIGO"));
    clicar("Editar Código");
    digitarNoCampoDoCodigo(texto);
    await act(async () => clicar("Salvar"));
  }

  it("o banco responde 0 linhas e sem erro (sessão sem papel de admin): NÃO diz salvo, o campo fica aberto com o texto digitado e avisa que não gravou", async () => {
    resposta.atual = { data: [], error: null };
    await digitarESalvar("aa123456789br");

    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    // o campo de edição continua aberto, com o que a lojista digitou
    expect(campo()?.value).toBe("AA123456789BR");
    expect(toast.error).toHaveBeenCalledTimes(1);
    const aviso = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(aviso).toMatch(/não foi salvo/i);
    expect(aviso).toMatch(/tente de novo|recarregue/i);
    expect(aviso).toMatch(/sessão/i);
    // nada de "sem resposta": o banco respondeu, só não gravou
    expect(aviso).not.toMatch(/sem resposta|conferir/i);
  });

  it("o banco nem devolve a lista de linhas (data ausente): também NÃO diz salvo", async () => {
    resposta.atual = { data: null, error: null };
    await digitarESalvar("AA123456789BR");

    expect(toast.success).not.toHaveBeenCalled();
    expect(campo()?.value).toBe("AA123456789BR");
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("controle: o banco grava 1 linha — diz salvo, fecha o campo e mostra o código", async () => {
    await digitarESalvar("aa123456789br");

    expect(atualizar).toHaveBeenCalledWith("marketplace_orders", {
      tracking_code: "AA123456789BR",
    });
    expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
    expect(toast.error).not.toHaveBeenCalled();
    expect(campo()).toBeNull();
    expect(hospedeiro.textContent).toContain("AA123456789BR");
  });

  it("erro do banco (error preenchido): continua com o aviso de erro de antes, campo aberto", async () => {
    resposta.atual = { data: null, error: { message: "boom" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await digitarESalvar("AA123456789BR");

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Erro ao salvar código de rastreio.",
    );
    expect(campo()?.value).toBe("AA123456789BR");
  });
});
