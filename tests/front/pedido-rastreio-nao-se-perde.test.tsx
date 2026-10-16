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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  let rejeitar!: (erro: Error) => void;
  const resposta = new Promise<{ error: Error | null }>((resolve, reject) => {
    concluir = resolve;
    rejeitar = reject;
  });
  return { resposta, concluir, rejeitar };
}

describe("pedido — rastreio não se perde", () => {
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
    vi.restoreAllMocks();
  });

  async function mostrar(order: Order) {
    // Reutiliza a ficha ao trocar de pedido.
    await act(async () => {
      raiz.render(
        <OrderDetail order={order} onStatusChange={onStatusChange} />,
      );
    });
  }

  function campo() {
    const elemento =
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    if (!elemento) throw new Error("Campo de rastreio ausente");
    return elemento;
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  function digitar(texto: string) {
    const elemento = campo();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(elemento, texto);
      elemento.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(campo().value).toBe(texto);
  }

  async function voltarParaAComEnvioPendente() {
    const envio = envioPendente();
    salvar.mockReturnValueOnce(envio.resposta);
    await mostrar(pedido("A"));
    clicar("Editar Código");
    digitar("RASTREIO-ANTIGO");
    clicar("Salvar");
    await mostrar(pedido("B"));
    await mostrar(pedido("A"));
    clicar("Editar Código");
    expect(campo().disabled).toBe(false);
    return envio;
  }

  it("A→B→A não revive a resposta antiga enquanto há um novo rascunho", async () => {
    const envioAntigo = await voltarParaAComEnvioPendente();
    digitar("RASCUNHO-NOVO");

    await act(async () => envioAntigo.concluir({ error: null }));

    expect(campo().value).toBe("RASCUNHO-NOVO");
    expect(campo().disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(["sucesso", "erro", "rejeição"])(
    "a resposta antiga com %s não fecha nem libera o segundo salvamento de A",
    async (resultado) => {
      const envioAntigo = await voltarParaAComEnvioPendente();
      const envioNovo = envioPendente();
      salvar.mockReturnValueOnce(envioNovo.resposta);
      digitar("RASTREIO-NOVO");
      clicar("Salvar");

      await act(async () => {
        if (resultado === "rejeição") {
          envioAntigo.rejeitar(new Error("Falha antiga"));
        } else {
          envioAntigo.concluir({
            error: resultado === "erro" ? new Error("Falha antiga") : null,
          });
        }
      });

      expect(campo().value).toBe("RASTREIO-NOVO");
      expect(campo().disabled).toBe(true);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();

      await act(async () => envioNovo.concluir({ error: null }));

      expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
      expect(hospedeiro.textContent).toContain("RASTREIO-NOVO");
      expect(hospedeiro.textContent).not.toContain("RASTREIO-ANTIGO");
      expect(toast.success).toHaveBeenCalledTimes(1);
    },
  );

  it("a resposta antiga não sobrescreve o segundo rastreio salvo nem fecha uma nova edição", async () => {
    const envioAntigo = await voltarParaAComEnvioPendente();
    digitar("RASTREIO-NOVO");
    await act(async () => clicar("Salvar"));
    clicar("Editar Código");
    digitar("OUTRO-RASCUNHO");

    await act(async () => envioAntigo.concluir({ error: null }));

    expect(campo().value).toBe("OUTRO-RASCUNHO");
    expect(campo().disabled).toBe(false);
    const cancelar = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Cancelar edição do código"]',
    );
    if (!cancelar) throw new Error("Botão de cancelar ausente");
    act(() => cancelar.click());
    expect(hospedeiro.textContent).toContain("RASTREIO-NOVO");
    expect(hospedeiro.textContent).not.toContain("RASTREIO-ANTIGO");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("salva o código sem espaços e fecha a edição no caminho normal", async () => {
    await mostrar(pedido());
    clicar("Editar Código");
    digitar("  BR123456789BR  ");
    await act(async () => clicar("Salvar"));

    expect(atualizar).toHaveBeenCalledWith({ tracking_code: "BR123456789BR" });
    expect(salvar).toHaveBeenCalledWith("id", "A");
    expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
    expect(hospedeiro.textContent).toContain("BR123456789BR");
    expect(toast.success).toHaveBeenCalledWith("Código de rastreamento salvo!");
    clicar("Editar Código");
    expect(campo().disabled).toBe(false);
  });

  it("erro do servidor mostra o aviso e mantém a edição aberta para tentar de novo", async () => {
    const erro = new Error("Falha simulada");
    vi.spyOn(console, "error").mockImplementation(() => {});
    salvar.mockResolvedValueOnce({ error: erro });
    await mostrar(pedido());
    clicar("Editar Código");
    digitar("RASTREIO-PARA-REPETIR");
    await act(async () => clicar("Salvar"));

    expect(campo().value).toBe("RASTREIO-PARA-REPETIR");
    expect(campo().disabled).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Erro ao salvar código de rastreamento.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
