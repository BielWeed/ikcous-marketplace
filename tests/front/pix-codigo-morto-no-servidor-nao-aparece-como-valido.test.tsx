// @vitest-environment jsdom
//
// F1 (fase 3 dos pagamentos, 04/10/2026) — a tela do PIX não mostra QR nem
// "Copiar código" como válidos quando o SERVIDOR já gravou o pedido como
// morto (`payment_status = 'expirado'`, ou `aguardando` + `status =
// 'cancelled'`). Antes, o cliente seguia copiando um código que o banco ia
// recusar. O relógio do aparelho continua sem decidir nada (só avisa com
// prudência, como sempre). O polling NÃO para: um pagamento que chega depois
// ainda vira "pago fora do prazo" (coberto em checkout-view-pix-confirmacao).
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

const AVISO =
  "Este código não vale mais. Se você já pagou, fique nesta tela: a confirmação aparece aqui. Se ainda não pagou, faça um pedido novo.";

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  criarPagamento.mockReset().mockResolvedValue({
    paymentId: "pay-1",
    statusPagamento: "aguardando",
    // Prazo no FUTURO do aparelho: só o servidor diz que o código morreu.
    expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    qrCode: "000201CODIGOCOPIAECOLA",
    qrCodeBase64: "abc123",
    ticketUrl: "https://www.mercadopago.com.br/payments/checkout?id=abc123",
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
  vi.restoreAllMocks();
});

async function renderizar(
  pedidoMortoNoServidor?: boolean,
  onVerMeusPedidos?: () => void,
) {
  await act(async () => {
    raiz.render(
      <PagamentoOnline
        orderId="ped-1"
        valor={100}
        onErro={() => {}}
        pedidoMortoNoServidor={pedidoMortoNoServidor}
        onVerMeusPedidos={onVerMeusPedidos}
      />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const texto = () => hospedeiro.textContent ?? "";
const botaoCopiar = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Copiar código PIX"),
  );

describe("PagamentoOnline (PIX) — pedido morto no servidor", () => {
  it("CONTROLE: com o pedido vivo, o código, o QR e o link aparecem como sempre", async () => {
    await renderizar(false);
    expect(botaoCopiar()).toBeDefined();
    expect(texto()).toContain("000201CODIGOCOPIAECOLA");
    expect(
      hospedeiro.querySelector('img[alt="QR code do PIX"]'),
    ).not.toBeNull();
    expect(texto()).toContain("Pagar pelo Mercado Pago");
    expect(texto()).not.toContain("Este código não vale mais");
  });

  it("com o pedido morto: nada de QR, 'Copiar código', código copia e cola nem link — só o aviso", async () => {
    await renderizar(true);

    expect(botaoCopiar()).toBeUndefined();
    expect(texto()).not.toContain("000201CODIGOCOPIAECOLA");
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.querySelector("a")).toBeNull();
    expect(hospedeiro.querySelector("textarea")).toBeNull();
    expect(texto()).toContain(AVISO);
    // O texto da tela de "pago fora do prazo" é outra coisa.
    expect(texto()).not.toContain("prazo de reserva venceu");
  });

  it("o servidor grava o pedido como morto DEPOIS do QR aparecer: a tela troca na hora, sem nova chamada à edge", async () => {
    await renderizar(false);
    expect(botaoCopiar()).toBeDefined();
    expect(criarPagamento).toHaveBeenCalledTimes(1);

    await renderizar(true);

    expect(botaoCopiar()).toBeUndefined();
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(texto()).toContain(AVISO);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("o aviso é anunciado ao leitor de tela (alerta)", async () => {
    await renderizar(true);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Este código não vale mais.",
    );
  });

  // Saída do aviso: o cliente que já pagou (ou que quer conferir) precisa de
  // um caminho até a lista de pedidos; "faça um pedido novo" sozinho o deixa
  // numa tela sem botão.
  it("com o pedido morto e a saída conhecida: 'Ver meus pedidos' leva à lista de pedidos", async () => {
    const aoVerMeusPedidos = vi.fn();
    await renderizar(true, aoVerMeusPedidos);

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Ver meus pedidos"),
    );
    expect(botao).toBeDefined();
    act(() => {
      botao?.click();
    });
    expect(aoVerMeusPedidos).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: sem a saída conhecida não nasce botão mudo", async () => {
    await renderizar(true);
    expect(texto()).not.toContain("Ver meus pedidos");
  });

  it("CONTROLE: com o pedido vivo o botão não aparece (o PIX segue sendo pago aqui)", async () => {
    await renderizar(false, vi.fn());
    expect(texto()).not.toContain("Ver meus pedidos");
  });
});
