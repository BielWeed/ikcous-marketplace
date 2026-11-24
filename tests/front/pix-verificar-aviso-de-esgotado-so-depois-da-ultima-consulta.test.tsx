// @vitest-environment jsdom
//
// PIX — "Já paguei — verificar", o aviso de verificações esgotadas.
//
// O botão tem teto de 5 consultas por PIX. O aviso "As verificações manuais
// deste Pix acabaram" fala em PASSADO: só pode aparecer quando a 5ª consulta
// JÁ TERMINOU. Enquanto ela ainda está em voo o botão diz "Verificando…" e a
// cliente não deve ler que acabou — se a 5ª consulta vier "pago", o aviso de
// esgotado teria dito o contrário do que está acontecendo.
//
// Buraco achado por mutação em `PagamentoOnline.tsx`: trocar
// `{esgotou && !verificando && (` por `{esgotou && (` não derrubava teste
// nenhum — os testes só olham o aviso depois que as 5 consultas assentaram.
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
const AVISO_ESGOTADO = "As verificações manuais deste Pix acabaram.";
const AINDA_NAO_CONFIRMADO = "Ainda não confirmado.";

function botao(hospedeiro: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) =>
      (b.textContent ?? "").includes(ROTULO) ||
      (b.textContent ?? "").includes("Verificando"),
  );
}

describe("PIX — o aviso de esgotado espera a última consulta terminar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  it("na 5ª consulta ainda em voo o botão diz 'Verificando…' e NÃO diz que as verificações acabaram; ao terminar, diz", async () => {
    let responderA5 = (_: { verificacao: string }) => {};
    let chamadasDeVerificar = 0;
    criarPagamento.mockImplementation(
      (args: { orderId: string; metodo: string }) => {
        if (args.metodo === "pix") {
          return Promise.resolve({
            paymentId: "pay-1",
            statusPagamento: "aguardando",
            expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            qrCode: "000201-codigo-copia-e-cola",
            qrCodeBase64: "abc123",
          });
        }
        chamadasDeVerificar += 1;
        if (chamadasDeVerificar < 5) {
          return Promise.resolve({ verificacao: "pix" });
        }
        return new Promise<{ verificacao: string }>((resolve) => {
          responderA5 = resolve;
        });
      },
    );

    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-1"
          valor={100}
          onErro={() => {}}
          onRelerPagamentoPix={vi.fn()}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // Quatro consultas completas, cada uma depois do intervalo de 15 s.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        botao(hospedeiro)?.click();
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
    }
    expect(chamadasDeVerificar).toBe(4);
    expect(hospedeiro.textContent).not.toContain(AVISO_ESGOTADO);

    // A 5ª: fica pendurada.
    await act(async () => {
      botao(hospedeiro)?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(chamadasDeVerificar).toBe(5);
    expect(botao(hospedeiro)?.textContent).toContain("Verificando…");
    expect(botao(hospedeiro)?.disabled).toBe(true);
    expect(hospedeiro.textContent).not.toContain(AVISO_ESGOTADO);

    // A 5ª termina sem confirmar: agora sim, o aviso de esgotado — e não o
    // "Ainda não confirmado" (que é de quem ainda tem consultas).
    await act(async () => {
      responderA5({ verificacao: "pix" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hospedeiro.textContent).toContain(AVISO_ESGOTADO);
    expect(hospedeiro.textContent).not.toContain(AINDA_NAO_CONFIRMADO);
    expect(botao(hospedeiro)?.disabled).toBe(true);
  });
});
