// @vitest-environment jsdom
//
// Testes de MUTAÇÃO (24/11/2026) da tela do PIX, o que a cliente lê:
//  - "Este pagamento não foi concluído" NÃO pode vir junto de "Volte ao
//    carrinho só se não pagou" (frase de quem pode ter pago e não sabe);
//  - PIX sem prazo legível não pode dizer "o horário previsto já passou" (um
//    prazo ausente lido como 1970 faria isso) e o valor ilegível não vira
//    "R$ NaN". Tirar cada guarda não derrubava nenhum teste.
import {
  AvisoDePixEncerrado,
  PagamentoOnline,
} from "@/components/checkout/PagamentoOnline";
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

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("tela do PIX — aviso de encerrado e dados ilegíveis", () => {
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

  it("'não foi concluído' não repete a frase 'Volte ao carrinho só se não pagou'; o código vencido, sim", async () => {
    await act(async () => {
      raiz.render(
        <AvisoDePixEncerrado
          orderId="ped-1"
          onVoltarAoCarrinho={() => {}}
          pagamentoNaoConcluido
        />,
      );
    });
    expect(hospedeiro.textContent).toContain(
      "Este pagamento não foi concluído",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Volte ao carrinho só se não pagou",
    );

    await act(async () => {
      raiz.render(
        <AvisoDePixEncerrado orderId="ped-1" onVoltarAoCarrinho={() => {}} />,
      );
    });
    expect(hospedeiro.textContent).toContain("Este código não vale mais");
    expect(hospedeiro.textContent).toContain(
      "Volte ao carrinho só se não pagou",
    );
  });

  it("PIX sem prazo legível e sem valor: diz que não leu o prazo, não declara 'já passou' e não escreve 'R$ NaN'", async () => {
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: undefined,
      qrCode: "000201-codigo-copia-e-cola",
      qrCodeBase64: "abc123",
    });
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-1"
          valor={Number.NaN}
          onErro={() => {}}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Copiar código Pix");
    expect(texto).toContain("Não conseguimos ler o prazo deste Pix");
    expect(texto).not.toContain("O horário previsto para pagar já passou");
    expect(texto).not.toContain("NaN");
    expect(texto).not.toContain("R$");
  });
});
