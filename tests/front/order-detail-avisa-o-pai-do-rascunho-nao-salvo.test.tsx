// @vitest-environment jsdom
//
// Ficha do pedido (painel): a anotação interna e o código de rastreio
// DIGITADOS e ainda não salvos só existem no estado local da ficha. Para o
// Voltar do aparelho poder perguntar antes de jogar o texto fora, quem manda
// na navegação (AdminOrdersView) precisa saber, a cada momento, se existe
// rascunho de verdade — texto diferente do que está gravado, não só o campo
// aberto. É o que `onRascunhoPendente` entrega.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { salvar, atualizar, ler, gravarNota } = vi.hoisted(() => ({
  salvar: vi.fn(),
  atualizar: vi.fn(),
  ler: vi.fn(),
  gravarNota: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: (coluna: string, id: string) => ({
          maybeSingle: () =>
            tabela === "config_mototaxi"
              ? Promise.resolve({
                  data: { whatsapp: null, nome: null },
                  error: null,
                })
              : ler(tabela, colunas, coluna, id),
        }),
      }),
      // Anotação nova (a ficha leu "sem anotação"): grava com `insert`.
      insert: (valores: { order_id: string; note: string }) => ({
        select: () => {
          gravarNota(tabela, valores);
          return Promise.resolve({
            data: [{ updated_at: "2026-11-08T10:00:00+00:00" }],
            error: null,
          });
        },
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      update: (valores: unknown) => {
        atualizar(tabela, valores);
        return { eq: salvar };
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(id = "A"): Order {
  return {
    id,
    notes: "",
    trackingCode: `CODIGO-${id}`,
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

describe("ficha do pedido — avisa o pai quando há rascunho não salvo", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onStatusChange = vi.fn();
  const onRascunhoPendente = vi.fn();
  const ultimo = () => onRascunhoPendente.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    vi.clearAllMocks();
    salvar.mockReset().mockResolvedValue({ error: null });
    ler
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve({ data: { note: "Interna de A" }, error: null }),
      );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function mostrar(order: Order) {
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={order}
          onStatusChange={onStatusChange}
          onRascunhoPendente={onRascunhoPendente}
        />,
      );
    });
  }

  function campo(seletor: string) {
    const elemento = hospedeiro.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(seletor);
    if (!elemento) throw new Error(`Campo ausente: ${seletor}`);
    return elemento;
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent === texto ||
        b.getAttribute("title") === texto ||
        b.getAttribute("aria-label") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  async function editarNotas() {
    await act(async () => clicar("Editar notas"));
  }

  function digitar(seletor: string, texto: string) {
    const elemento = campo(seletor);
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(elemento, texto);
      elemento.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("r66 aba inativa não deixa recibo no body e preserva o rascunho ao reativar", async () => {
    const order = pedido();
    await mostrar(order);
    expect(
      document.body.querySelector('[class~="print:block"]'),
    ).not.toBeNull();
    await editarNotas();
    digitar("#notes-textarea", "Rascunho preservado");
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={order}
          active={false}
          onStatusChange={onStatusChange}
        />,
      );
    });
    expect(document.body.querySelector('[class~="print:block"]')).toBeNull();
    expect(campo("#notes-textarea").value).toBe("Rascunho preservado");
    await mostrar(order);
    expect(
      document.body.querySelector('[class~="print:block"]'),
    ).not.toBeNull();
    expect(campo("#notes-textarea").value).toBe("Rascunho preservado");
  });

  it("sem rascunho a ficha avisa 'não'; só abrir o campo da anotação também não é rascunho", async () => {
    await mostrar(pedido());
    expect(ultimo()).toBe(false);

    await editarNotas();
    expect(campo("#notes-textarea").value).toBe("Interna de A");
    expect(ultimo()).toBe(false);
  });

  it("anotação digitada e não salva é rascunho; voltar ao texto gravado deixa de ser", async () => {
    await mostrar(pedido());
    await editarNotas();

    digitar("#notes-textarea", "Entregar depois das 18h");
    expect(ultimo()).toBe(true);

    digitar("#notes-textarea", "Interna de A");
    expect(ultimo()).toBe(false);
  });

  it("cancelar a edição da anotação descarta o rascunho de propósito", async () => {
    await mostrar(pedido());
    await editarNotas();
    digitar("#notes-textarea", "Entregar depois das 18h");
    expect(ultimo()).toBe(true);

    clicar("Cancelar edição das anotações");
    expect(ultimo()).toBe(false);
  });

  it("salvar a anotação limpa o rascunho", async () => {
    await mostrar(pedido());
    await editarNotas();
    digitar("#notes-textarea", "Entregar depois das 18h");
    expect(ultimo()).toBe(true);

    await act(async () => clicar("Salvar"));
    expect(gravarNota).toHaveBeenCalled();
    expect(ultimo()).toBe(false);
  });

  it("código de rastreio digitado e não salvo é rascunho; cancelar e salvar limpam", async () => {
    await mostrar(pedido());
    clicar("Editar Código");
    expect(ultimo()).toBe(false);

    digitar("#tracking-input", "BR999999999BR");
    expect(ultimo()).toBe(true);

    clicar("Cancelar edição do código");
    expect(ultimo()).toBe(false);

    clicar("Editar Código");
    digitar("#tracking-input", "BR999999999BR");
    expect(ultimo()).toBe(true);
    await act(async () => clicar("Salvar"));
    expect(atualizar).toHaveBeenCalled();
    expect(ultimo()).toBe(false);
  });

  it("ao sair da ficha com rascunho, o pai fica sabendo que acabou (nada de desvio preso)", async () => {
    await mostrar(pedido());
    await editarNotas();
    digitar("#notes-textarea", "Entregar depois das 18h");
    expect(ultimo()).toBe(true);

    act(() => raiz.render(<div />));
    expect(ultimo()).toBe(false);
  });
});
