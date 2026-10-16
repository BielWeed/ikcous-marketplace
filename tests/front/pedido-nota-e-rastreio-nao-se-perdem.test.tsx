// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { salvar, atualizar } = vi.hoisted(() => ({
  salvar: vi.fn(),
  atualizar: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (valores: unknown) => {
        atualizar(valores);
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
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(id = "A"): Order {
  return {
    id,
    notes: `Nota de ${id}`,
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

function envioPendente() {
  let concluir!: (resposta: { error: Error | null }) => void;
  const resposta = new Promise<{ error: Error | null }>((resolve) => {
    concluir = resolve;
  });
  return { resposta, concluir };
}

describe("pedido — anotações e rastreio não se perdem", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onStatusChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    salvar.mockReset().mockResolvedValue({ error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function mostrar(order: Order) {
    // Reutiliza a instância, como a ficha do painel.
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
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
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
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
    expect(campo(seletor).value).toBe(texto);
  }

  it.each([
    { resultado: "sucesso", error: null },
    { resultado: "erro", error: new Error("Falha simulada") },
  ])("resposta de A com $resultado não altera B", async ({ error }) => {
    const envioA = envioPendente();
    salvar.mockReturnValueOnce(envioA.resposta);
    await mostrar(pedido("A"));
    clicar("Editar notas");
    digitar("#notes-textarea", "  Nova nota de A  ");
    clicar("Salvar");

    expect(atualizar).toHaveBeenCalledWith({ notes: "Nova nota de A" });
    expect(salvar).toHaveBeenCalledWith("id", "A");
    await mostrar(pedido("B"));
    clicar("Editar notas");
    expect(campo("#notes-textarea").disabled).toBe(false);
    digitar("#notes-textarea", "Rascunho de B");

    await act(async () => envioA.concluir({ error }));

    expect(campo("#notes-textarea").value).toBe("Rascunho de B");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    const cancelar = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Cancelar edição das anotações"]',
    );
    expect(cancelar).not.toBeNull();
    act(() => cancelar!.click());
    expect(hospedeiro.textContent).toContain("Nota de B");
    expect(hospedeiro.textContent).not.toContain("Nova nota de A");
  });

  it("a conclusão de A não libera o salvamento ainda pendente de B", async () => {
    const envioA = envioPendente();
    const envioB = envioPendente();
    salvar
      .mockReturnValueOnce(envioA.resposta)
      .mockReturnValueOnce(envioB.resposta);
    await mostrar(pedido("A"));
    clicar("Editar notas");
    clicar("Salvar");
    await mostrar(pedido("B"));
    clicar("Editar notas");
    digitar("#notes-textarea", "Nova nota de B");
    clicar("Salvar");
    expect(salvar).toHaveBeenLastCalledWith("id", "B");

    await act(async () => envioA.concluir({ error: null }));
    expect(campo("#notes-textarea").disabled).toBe(true);

    await act(async () => envioB.concluir({ error: null }));
    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(hospedeiro.textContent).toContain("Nova nota de B");
  });

  it("salvar no pedido atual mostra a nota salva e fecha o editor", async () => {
    await mostrar(pedido());
    clicar("Editar notas");
    digitar("#notes-textarea", "  Entregar depois das 18h  ");
    await act(async () => clicar("Salvar"));

    expect(hospedeiro.querySelector("#notes-textarea")).toBeNull();
    expect(hospedeiro.textContent).toContain("Entregar depois das 18h");
    expect(toast.success).toHaveBeenCalledWith("Notas operacionais salvas!");
  });

  it("atualizar só o rastreio preserva a anotação em edição", async () => {
    const order = pedido();
    await mostrar(order);
    clicar("Editar notas");
    digitar("#notes-textarea", "Anotação ainda não salva");

    await mostrar({ ...order, trackingCode: "CODIGO-NOVO" });

    expect(campo("#notes-textarea").value).toBe("Anotação ainda não salva");
    expect(hospedeiro.textContent).toContain("CODIGO-NOVO");
  });

  it("atualizar só a anotação preserva o rastreio em edição", async () => {
    const order = pedido();
    await mostrar(order);
    clicar("Editar Código");
    digitar("#tracking-input", "RASTREIO-EM-EDICAO");

    await mostrar({ ...order, notes: "Anotação recebida ao vivo" });

    expect(campo("#tracking-input").value).toBe("RASTREIO-EM-EDICAO");
    expect(hospedeiro.textContent).toContain("Anotação recebida ao vivo");
  });

  it("trocar o id descarta ambos os rascunhos mesmo com valores salvos iguais", async () => {
    const order = pedido();
    await mostrar(order);
    clicar("Editar notas");
    digitar("#notes-textarea", "Rascunho antigo");
    clicar("Editar Código");
    digitar("#tracking-input", "RASTREIO-ANTIGO");

    await mostrar({ ...order, id: "B" });

    clicar("Editar notas");
    clicar("Editar Código");
    expect(campo("#notes-textarea").value).toBe("Nota de A");
    expect(campo("#tracking-input").value).toBe("CODIGO-A");
  });
});
