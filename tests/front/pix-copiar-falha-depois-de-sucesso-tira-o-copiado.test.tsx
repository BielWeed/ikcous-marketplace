// @vitest-environment jsdom
//
// Caça de leitor de tela (27/11/2026) do botão "Copiar código Pix" — o
// espelho de pix-copiar-sucesso-depois-de-falha-tira-o-aviso.test.tsx. A
// cliente copia ("Copiado!" por ~2 s), toca de novo e o navegador nega: o
// aviso de falha aparecia, mas o botão continuava dizendo "Copiado!" — a tela
// (e o leitor de tela, que lê o nome do botão) dizia as duas coisas.
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

const CODIGO = "000201-codigo-pix-de-teste-3";
const AVISO_DE_FALHA =
  "Não consegui copiar sozinho. Toque no código abaixo, segure e copie.";

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("PIX — copiar falha logo depois de um sucesso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    escrever.mockReset();
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: (texto: string) => escrever(texto) },
      configurable: true,
    });
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-copia-3",
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

  it("o 1º toque copia ('Copiado!'); o 2º, ainda dentro dos 2 s, é negado: o botão deixa de dizer 'Copiado!'", async () => {
    escrever.mockResolvedValueOnce(undefined);
    escrever.mockRejectedValueOnce(new Error("NotAllowedError"));

    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-copia-3" valor={50} onErro={() => {}} />,
      );
    });
    await act(async () => {
      await esperar();
    });

    await act(async () => {
      botaoCopiar()?.click();
      await esperar();
    });
    expect(botaoCopiar()?.textContent).toContain("Copiado!");

    await act(async () => {
      botaoCopiar()?.click();
      await esperar();
    });
    expect(escrever).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain(AVISO_DE_FALHA);
    expect(botaoCopiar()?.textContent).not.toContain("Copiado!");
    expect(botaoCopiar()?.textContent).toContain("Copiar código Pix");
  });
});
