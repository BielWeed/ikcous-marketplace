// @vitest-environment jsdom
// Protege os disabled de Salvar e Cancelar: gravação pendente não duplica nem perde a edição.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { salvar, atualizar, comLinhaGravada } = vi.hoisted(() => ({
  salvar: vi.fn(),
  atualizar: vi.fn(),
  // `.select("id")` pede a linha gravada de volta: o banco só a devolve quando
  // o update valeu (0 linhas = a política filtrou, e a ficha não diz "salvo").
  comLinhaGravada: <T extends { error: unknown }>(resposta: T) =>
    resposta.error ? resposta : { ...resposta, data: [{ id: "A" }] },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (valores: unknown) => {
        atualizar(valores);
        return {
          eq: (...filtro: unknown[]) => ({
            select: () =>
              Promise.resolve(salvar(...filtro)).then(comLinhaGravada),
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const pedido: Order = {
  id: "pedido-rastreio",
  notes: "Nota de teste",
  trackingCode: "CODIGO-ANTIGO",
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

describe("pedido — botões do rastreio travam durante a gravação", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  let concluir: (resposta: { error: null }) => void;
  const onStatusChange = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const pendente = new Promise<{ error: null }>((resolve) => {
      concluir = resolve;
    });
    salvar.mockReset().mockReturnValue(pendente);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedido} onStatusChange={onStatusChange} />,
      );
    });
  });

  afterEach(async () => {
    // Resolve inclusive quando o mutante falha, sem deixar prazo/tarefa pendurado.
    await act(async () => concluir({ error: null }));
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  function botao(texto: string) {
    const encontrado = [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.trim() === texto ||
        b.getAttribute("title") === texto ||
        b.getAttribute("aria-label") === texto,
    );
    if (!encontrado) throw new Error(`Botão ausente: ${texto}`);
    return encontrado;
  }

  function campo() {
    const encontrado =
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    if (!encontrado) throw new Error("Campo de rastreio ausente");
    return encontrado;
  }

  function editarESalvar() {
    act(() => botao("Editar Código").click());
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(campo(), "RASTREIO-NOVO");
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(campo().value).toBe("RASTREIO-NOVO");
    expect(botao("Salvar").disabled).toBe(false);
    expect(botao("Cancelar edição do código").disabled).toBe(false);
    act(() => botao("Salvar").click());
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledWith({ tracking_code: "RASTREIO-NOVO" });
    expect(salvar).toHaveBeenCalledWith("id", "pedido-rastreio");
    expect(campo().disabled).toBe(true);
  }

  it("Salvar desabilitado: segundo clique não manda outro update enquanto a resposta não chega", async () => {
    editarESalvar();
    const botaoSalvar = botao("Salvar");
    act(() => botaoSalvar.click());

    expect.soft(botaoSalvar.disabled).toBe(true);
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(campo().value).toBe("RASTREIO-NOVO");

    await act(async () => concluir({ error: null }));
    expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
    expect(hospedeiro.textContent).toContain("RASTREIO-NOVO");
  });

  it("Cancelar desabilitado: clicar não fecha a edição nem descarta o código durante o envio", async () => {
    editarESalvar();
    const botaoCancelar = botao("Cancelar edição do código");
    act(() => botaoCancelar.click());

    expect.soft(botaoCancelar.disabled).toBe(true);
    expect(hospedeiro.querySelector("#tracking-input")).not.toBeNull();
    expect(campo().value).toBe("RASTREIO-NOVO");
    expect(atualizar).toHaveBeenCalledTimes(1);

    await act(async () => concluir({ error: null }));
    expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
    expect(hospedeiro.textContent).toContain("RASTREIO-NOVO");

    // Controle: fora da gravação, Cancelar volta a funcionar normalmente.
    act(() => botao("Editar Código").click());
    expect(botao("Cancelar edição do código").disabled).toBe(false);
    act(() => botao("Cancelar edição do código").click());
    expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
  });
});
