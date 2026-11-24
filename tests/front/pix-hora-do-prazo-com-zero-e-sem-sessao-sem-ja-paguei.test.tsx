// @vitest-environment jsdom
//
// PIX — duas bordas da tela do QR que os testes vizinhos deixavam passar
// (achadas por mutação em `PagamentoOnline.tsx`):
//
//  1. a hora do prazo sai sempre com DOIS dígitos: "Prazo informado: até 09:05"
//     (e, depois dela, "o prazo informado era até 09:05") — nunca "9:05". Os
//     testes só usavam horas de duas casas. O instante nasce do relógio LOCAL,
//     então vale em qualquer fuso do CI.
//  2. sem sessão (`sessaoAtiva=false`) a tela NÃO oferece "Já paguei —
//     verificar": a consulta passa pela releitura do pedido, que exige a conta.
//     Oferecer o botão ali é prometer uma conferência que nunca acontece.
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROTULO = "Já paguei — verificar";
const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

function respostaDoPix(expiraEm: string) {
  return {
    paymentId: "pay-1",
    statusPagamento: "aguardando",
    expiraEm,
    qrCode: "000201-codigo-copia-e-cola",
    qrCodeBase64: "abc123",
  };
}

describe("PIX — hora do prazo e botão de verificar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    criarPagamento.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function mostrar(
    expiraEm: string,
    extra: { sessaoAtiva?: boolean } = {},
  ) {
    criarPagamento.mockResolvedValue(respostaDoPix(expiraEm));
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-1"
          valor={100}
          onErro={() => {}}
          onRelerPagamentoPix={vi.fn()}
          {...extra}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
  }

  it("prazo no futuro, antes das dez da manhã: 'até 09:05' (com o zero)", async () => {
    await mostrar(new Date(2999, 0, 1, 9, 5).toISOString());
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Prazo informado: até 09:05");
    expect(texto).not.toContain("até 9:05");
  });

  it("prazo já passado, antes das dez da manhã: 'O prazo informado era até 09:05' (com o zero)", async () => {
    await mostrar(new Date(2000, 0, 1, 9, 5).toISOString());
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("O prazo informado era até 09:05");
    expect(texto).not.toContain("até 9:05");
  });

  it("com sessão, o botão 'Já paguei — verificar' aparece (controle)", async () => {
    await mostrar(new Date(2999, 0, 1, 12, 0).toISOString(), {
      sessaoAtiva: true,
    });
    expect(hospedeiro.textContent).toContain(ROTULO);
  });

  it("sem sessão (a conta caiu), o botão 'Já paguei — verificar' NÃO aparece, mas o QR e o código seguem", async () => {
    await mostrar(new Date(2999, 0, 1, 12, 0).toISOString(), {
      sessaoAtiva: false,
    });
    expect(hospedeiro.textContent).not.toContain(ROTULO);
    expect(
      hospedeiro.querySelector("img[alt='QR code do Pix']"),
    ).not.toBeNull();
    expect(hospedeiro.textContent).toContain("Copiar código Pix");
  });
});
