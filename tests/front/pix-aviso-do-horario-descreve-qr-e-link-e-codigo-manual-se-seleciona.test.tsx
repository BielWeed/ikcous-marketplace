// @vitest-environment jsdom
//
// Teste de MUTAÇÃO (24/11/2026) de dois comportamentos da tela do PIX que só
// o teste de "estrutura congelada" (desktop-p77) enxergava — e ele nota a
// mudança, não prova o efeito:
// 1) passado o horário previsto, o aviso âmbar descreve o botão de copiar, a
//    IMAGEM do QR e o link "Pagar pelo Mercado Pago" (`aria-describedby`): quem
//    usa leitor de tela ouve o aviso junto de cada caminho de pagamento. Tirar
//    o atributo da imagem ou do link não derrubava teste de comportamento;
// 2) quando a cópia automática falha, o código aparece num campo que se
//    SELECIONA INTEIRO ao tocar (`onFocus`): sem isso a cliente teria de
//    arrastar o dedo sobre o código no celular.
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

const CODIGO = "000201-codigo-pix-de-teste-3";
const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("tela do PIX — aviso do horário e campo do código manual", () => {
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
    Reflect.deleteProperty(window.navigator, "clipboard");
  });

  async function mostrarPix(expiraEm: string) {
    criarPagamento.mockResolvedValue({
      paymentId: "pay-aria-1",
      statusPagamento: "aguardando",
      expiraEm,
      qrCode: CODIGO,
      qrCodeBase64: "abc123",
      ticketUrl: "https://www.mercadopago.com.br/ticket/abc",
    });
    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-aria-1" valor={25} onErro={() => {}} />,
      );
    });
    await act(async () => {
      await esperar();
    });
  }

  const qr = () => hospedeiro.querySelector("img[alt='QR code do Pix']");
  const link = () =>
    [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Pagar pelo Mercado Pago"),
    );
  const botaoCopiar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Copiar código Pix"),
    );

  it("horário já passou: o aviso é descrição do botão de copiar, do QR e do link — os três apontam para o MESMO aviso", async () => {
    await mostrarPix(new Date(Date.now() - 60_000).toISOString());

    const aviso = [...hospedeiro.querySelectorAll("div[id]")].find((el) =>
      el.textContent?.includes("O horário previsto para pagar já passou."),
    );
    expect(aviso).toBeDefined();
    const idDoAviso = aviso?.id ?? "";
    expect(idDoAviso).not.toBe("");

    expect(botaoCopiar()?.getAttribute("aria-describedby")).toBe(idDoAviso);
    expect(qr()?.getAttribute("aria-describedby")).toBe(idDoAviso);
    expect(link()?.getAttribute("aria-describedby")).toBe(idDoAviso);
  });

  it("CONTROLE: horário ainda no futuro, nenhum dos três descreve um aviso que não existe", async () => {
    await mostrarPix(new Date(Date.now() + 30 * 60_000).toISOString());

    expect(botaoCopiar()).toBeDefined();
    expect(qr()).not.toBeNull();
    expect(link()).toBeDefined();
    expect(botaoCopiar()?.hasAttribute("aria-describedby")).toBe(false);
    expect(qr()?.hasAttribute("aria-describedby")).toBe(false);
    expect(link()?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("cópia negada: o campo do código seleciona o código INTEIRO quando recebe o toque (foco)", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("NotAllowedError")) },
      configurable: true,
    });
    await mostrarPix(new Date(Date.now() + 30 * 60_000).toISOString());

    await act(async () => {
      botaoCopiar()?.click();
      await esperar();
    });
    const campo = hospedeiro.querySelector("textarea");
    expect(campo).not.toBeNull();
    expect(campo?.value).toBe(CODIGO);
    // Antes do foco nada está selecionado.
    expect(campo?.selectionStart).toBe(campo?.selectionEnd);

    await act(async () => {
      campo?.focus();
    });
    expect(campo?.selectionStart).toBe(0);
    expect(campo?.selectionEnd).toBe(CODIGO.length);
  });
});
