// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) do botão "Copiar código Pix".
//
// Tirar o `setPixFalhouCopia(false)` do caminho de sucesso não derrubava
// teste nenhum: os testes existentes provam a falha OU o sucesso, nunca os dois
// em sequência. A cliente toca em copiar, o navegador nega (aviso "Não consegui
// copiar sozinho" + campo para copiar à mão), ela toca de novo, desta vez
// funciona — e o aviso de falha ficaria na tela ao lado de "Copiado!", dizendo
// as duas coisas ao mesmo tempo.
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

const escrever = vi.fn<(texto: string) => Promise<void>>();

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CODIGO = "000201-codigo-pix-de-teste-2";
const AVISO_DE_FALHA =
  "Não consegui copiar sozinho. Toque no código abaixo, segure e copie.";

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("PIX — copiar com sucesso depois de uma falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    escrever.mockReset();
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: (texto: string) => escrever(texto) },
      configurable: true,
    });
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-copia-2",
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      qrCode: CODIGO,
      qrCodeBase64: "abc123",
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(window.navigator, "clipboard");
  });

  const botaoCopiar = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes("Copiar código Pix") ||
        b.textContent?.includes("Copiado!"),
    );

  it("o 1º toque é negado (aviso + campo manual); o 2º funciona: 'Copiado!' e o aviso de falha SOME", async () => {
    escrever.mockRejectedValueOnce(new Error("NotAllowedError"));
    escrever.mockResolvedValueOnce(undefined);

    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-copia-2" valor={50} onErro={() => {}} />,
      );
    });
    await act(async () => {
      await esperar();
    });

    await act(async () => {
      botaoCopiar()?.click();
      await esperar();
    });
    expect(hospedeiro.textContent).toContain(AVISO_DE_FALHA);
    expect(hospedeiro.querySelector("textarea")).not.toBeNull();
    expect(botaoCopiar()?.textContent).not.toContain("Copiado!");

    await act(async () => {
      botaoCopiar()?.click();
      await esperar();
    });
    expect(escrever).toHaveBeenCalledTimes(2);
    expect(botaoCopiar()?.textContent).toContain("Copiado!");
    expect(hospedeiro.textContent).not.toContain(AVISO_DE_FALHA);
    expect(hospedeiro.querySelector("textarea")).toBeNull();
  });
});
