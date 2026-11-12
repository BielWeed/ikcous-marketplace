// @vitest-environment jsdom
/**
 * Salvar o rastreio DEPOIS da atualização ao vivo não apaga o do outro
 * atendente (lote r185-a).
 *
 * Cenário: a atendente A abre o pedido com um código antigo e começa a
 * digitar. A atendente B salva o código certo. A atualização ao vivo chega em
 * A, que mantém o que digitou. Antes, a "referência de segurança" da gravação
 * (o código que A tinha visto) era trocada pelo código de B nessa hora, e o
 * Salvar de A gravava por cima de B sem A nunca ter visto o código dele. Agora
 * a referência só muda quando A deixa de ter rascunho (cancela) ou quando o
 * Salvar descobre o conflito e avisa.
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  codigo: "" as string,
  escritas: [] as Array<{ gravou: string | null; condicao: string }>,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      update: (valores: { tracking_code: string | null }) => {
        let condicao = "SEM-CONDICAO";
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            if (coluna === "tracking_code") condicao = String(valor);
            return cadeia;
          },
          or: () => {
            condicao = "VAZIO";
            return cadeia;
          },
          select: async () => {
            const confere =
              condicao === "SEM-CONDICAO" ||
              (condicao === "VAZIO"
                ? banco.codigo === ""
                : banco.codigo === condicao);
            if (!confere) return { data: [], error: null };
            banco.codigo = valores.tracking_code ?? "";
            banco.escritas.push({ gravou: valores.tracking_code, condicao });
            return { data: [{ id: "A" }], error: null };
          },
        };
        return cadeia;
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              tabela === "marketplace_orders"
                ? { tracking_code: banco.codigo || null }
                : tabela === "config_mototaxi"
                  ? { whatsapp: null, nome: null }
                  : null,
            error: null,
          }),
        }),
      }),
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const AVISO_DE_CONFLITO =
  "O código de rastreio mudou em outro aparelho. O que você digitou foi mantido. Confira antes de salvar de novo.";

function pedido(id: string, trackingCode: string): Order {
  return {
    id,
    notes: "",
    trackingCode,
    customer: { name: "Pessoa Fixture", whatsapp: "11900000000" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-11T10:00:00Z",
    updatedAt: "2026-11-11T10:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — salvar depois da atualização ao vivo", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    banco.codigo = "";
    banco.escritas = [];
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
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  async function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    await act(async () => botao.click());
  }

  async function cancelarEdicao() {
    const cancelar = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Cancelar edição do código"]',
    );
    if (!cancelar) throw new Error("Cancelar ausente");
    await act(async () => cancelar.click());
  }

  function campo() {
    const elemento =
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    if (!elemento) throw new Error("Campo do rastreio ausente");
    return elemento;
  }

  function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** A abre o pedido com ANTIGO e digita RASCUNHO; B salva CODIGO-CORRETO. */
  async function aDigitaEBSalva() {
    banco.codigo = "ANTIGO";
    await mostrar(pedido("A", "ANTIGO"));
    await clicar("Editar Código");
    digitar("RASCUNHO");
    banco.codigo = "CODIGO-CORRETO";
    await mostrar(pedido("A", "CODIGO-CORRETO"));
  }

  it("Salvar logo depois da atualização ao vivo grava condicionado ao ANTIGO, não apaga o de B e avisa", async () => {
    await aDigitaEBSalva();
    // A atualização ao vivo manteve o que A digitou e avisou.
    expect(campo().value).toBe("RASCUNHO");
    expect(toast.info).toHaveBeenCalledTimes(1);

    await clicar("Salvar");

    expect(banco.codigo).toBe("CODIGO-CORRETO");
    expect(banco.escritas).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(AVISO_DE_CONFLITO);
    expect(campo().value).toBe("RASCUNHO");
  });

  it("depois do aviso, o segundo Salvar (consciente) grava condicionado ao código de B", async () => {
    await aDigitaEBSalva();
    await clicar("Salvar");
    expect(banco.escritas).toEqual([]);

    await clicar("Salvar");

    expect(banco.escritas).toEqual([
      { gravou: "RASCUNHO", condicao: "CODIGO-CORRETO" },
    ]);
    expect(banco.codigo).toBe("RASCUNHO");
    expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
    expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
    expect(hospedeiro.textContent).toContain("RASCUNHO");
  });

  it("sem rascunho, a atualização ao vivo atualiza o campo e o Salvar grava condicionado ao novo", async () => {
    banco.codigo = "ANTIGO";
    await mostrar(pedido("A", "ANTIGO"));
    await clicar("Editar Código");
    banco.codigo = "CODIGO-CORRETO";
    await mostrar(pedido("A", "CODIGO-CORRETO"));

    expect(campo().value).toBe("CODIGO-CORRETO");
    expect(toast.info).not.toHaveBeenCalled();

    await clicar("Salvar");

    expect(banco.escritas).toEqual([
      { gravou: "CODIGO-CORRETO", condicao: "CODIGO-CORRETO" },
    ]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cancelar a edição depois da atualização ao vivo mostra o código novo e a edição seguinte parte dele", async () => {
    await aDigitaEBSalva();

    await cancelarEdicao();

    expect(hospedeiro.textContent).toContain("CODIGO-CORRETO");
    expect(hospedeiro.textContent).not.toContain("ANTIGO");
    expect(hospedeiro.textContent).not.toContain("RASCUNHO");

    await clicar("Editar Código");
    expect(campo().value).toBe("CODIGO-CORRETO");
    digitar("OUTRO-TEXTO");
    await clicar("Salvar");

    expect(banco.escritas).toEqual([
      { gravou: "OUTRO-TEXTO", condicao: "CODIGO-CORRETO" },
    ]);
  });

  it("se o que A digitou é igual ao código de B, não há conflito: grava condicionado ao novo", async () => {
    banco.codigo = "ANTIGO";
    await mostrar(pedido("A", "ANTIGO"));
    await clicar("Editar Código");
    digitar("CODIGO-CORRETO");
    banco.codigo = "CODIGO-CORRETO";
    await mostrar(pedido("A", "CODIGO-CORRETO"));

    await clicar("Salvar");

    expect(toast.error).not.toHaveBeenCalled();
    expect(banco.escritas).toEqual([
      { gravou: "CODIGO-CORRETO", condicao: "CODIGO-CORRETO" },
    ]);
  });

  it("a referência retida de um pedido não vaza para o pedido seguinte", async () => {
    await aDigitaEBSalva();

    banco.codigo = "CODIGO-DE-B";
    await mostrar(pedido("B", "CODIGO-DE-B"));

    expect(hospedeiro.textContent).toContain("CODIGO-DE-B");
    expect(hospedeiro.textContent).not.toContain("CODIGO-CORRETO");
    await clicar("Editar Código");
    digitar("NOVO-DE-B");
    await clicar("Salvar");

    expect(banco.escritas).toEqual([
      { gravou: "NOVO-DE-B", condicao: "CODIGO-DE-B" },
    ]);
  });

  it("pedido que começou sem código: o rascunho também não apaga o código salvo por B", async () => {
    banco.codigo = "";
    await mostrar(pedido("A", ""));
    await clicar("Adicionar rastreio");
    digitar("RASCUNHO");
    banco.codigo = "CODIGO-CORRETO";
    await mostrar(pedido("A", "CODIGO-CORRETO"));

    await clicar("Salvar");

    expect(banco.codigo).toBe("CODIGO-CORRETO");
    expect(banco.escritas).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(AVISO_DE_CONFLITO);
  });
});
