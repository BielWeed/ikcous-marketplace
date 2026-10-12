// @vitest-environment jsdom
//
// F3 (fase 3 dos pagamentos, 04/10/2026) — o 503 passageiro do PIX.
//
// A edge `criar-pagamento` marca `terminal: true` também no 503 "Pagamento
// indisponível." (credencial do Mercado Pago que não pôde ser lida AGORA).
// Esse 503 não diz nada sobre o PEDIDO — o PIX nem chegou a ser criado — e
// repetir o pedido é seguro: a edge reavalia `podeCobrar` e reconsulta a
// vaga por CAS, nunca cria uma segunda cobrança. Antes, o PIX o tratava como
// fim de linha (caixa vermelha sem "Tentar de novo"); o cartão já só encerra
// com 409/404 (confirmacao-do-cartao.ts). Aqui o PIX segue a mesma régua: o
// 503 vira RECUPERÁVEL, e tudo o mais que a edge marca `terminal` continua
// terminal.
import { dispararPagamentoPix } from "@/components/checkout/PagamentoOnline";
import { describe, expect, it, vi } from "vitest";

// `PagamentoOnline` importa `useOrders` -> `@/lib/supabase`, que explode sem
// variáveis de ambiente. Nada do Supabase de verdade roda aqui.
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Erro como o `criarPagamento` do useOrders o monta (terminal + httpStatus). */
const erroDaEdge = (
  mensagem: string,
  extra: { terminal: boolean; httpStatus?: number },
) => Object.assign(new Error(mensagem), { cartaoEmAnalise: false, ...extra });

const RESPOSTA_PIX = {
  paymentId: "pay-1",
  statusPagamento: "aguardando",
  expiraEm: "2999-01-01T00:00:00.000Z",
  qrCode: "000201...",
  qrCodeBase64: "abc123",
};

describe("PIX — 503 'Pagamento indisponível.' (terminal na edge) não é fim de linha", () => {
  it("503 com terminal: true chega ao pai como 'recuperavel' (a caixa vermelha oferece 'Tentar de novo')", async () => {
    const onErro = vi.fn();
    const criarPagamento = vi.fn().mockRejectedValue(
      erroDaEdge("Pagamento indisponível.", {
        terminal: true,
        httpStatus: 503,
      }),
    );

    dispararPagamentoPix({
      orderId: "ped-503-a",
      criarPagamento,
      onErro,
      onPix: vi.fn(),
    });
    await esperarMicrotarefas();

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith(
      "Pagamento indisponível.",
      "recuperavel",
    );
  });

  it("o 'Tentar de novo' (nova montagem) repete o pedido e, com o servidor de volta, entrega o QR — a mesma chamada, sem cobrança paralela", async () => {
    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamento = vi
      .fn()
      .mockRejectedValueOnce(
        erroDaEdge("Pagamento indisponível.", {
          terminal: true,
          httpStatus: 503,
        }),
      )
      .mockResolvedValueOnce(RESPOSTA_PIX);

    const cancelar1 = dispararPagamentoPix({
      orderId: "ped-503-b",
      criarPagamento,
      onErro,
      onPix,
    });
    await esperarMicrotarefas();
    expect(onErro).toHaveBeenCalledWith(
      "Pagamento indisponível.",
      "recuperavel",
    );
    cancelar1(); // o CheckoutView trocou a tela pelo botão

    dispararPagamentoPix({
      orderId: "ped-503-b",
      criarPagamento,
      onErro,
      onPix,
    });
    await esperarMicrotarefas();

    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(criarPagamento).toHaveBeenNthCalledWith(2, {
      orderId: "ped-503-b",
      metodo: "pix",
    });
    expect(onPix).toHaveBeenCalledTimes(1);
  });

  // Controles: o que a edge marca terminal e FALA DO PEDIDO (ou da loja)
  // continua terminal — repetir daria a mesma resposta.
  for (const [rotulo, extra, mensagem] of [
    [
      "409 (prazo acabou / pedido cancelado / chave do webhook não cadastrada)",
      { terminal: true, httpStatus: 409 },
      "O prazo para pagar este pedido acabou.",
    ],
    [
      "404 (pedido não encontrado / não é o dono)",
      { terminal: true, httpStatus: 404 },
      "Pedido não encontrado.",
    ],
    [
      "403 (pagar pelo site exige conta)",
      { terminal: true, httpStatus: 403 },
      "Pagar pelo site exige conta. Entre ou crie uma conta para continuar.",
    ],
    [
      "terminal sem status HTTP legível (falha fechada, como sempre foi)",
      { terminal: true },
      "Este pedido não pode ser pago agora.",
    ],
  ] as const) {
    it(`CONTROLE: ${rotulo} segue 'terminal', uma chamada só`, async () => {
      const onErro = vi.fn();
      const criarPagamento = vi
        .fn()
        .mockRejectedValue(erroDaEdge(mensagem, extra));

      dispararPagamentoPix({
        orderId: `ped-controle-${rotulo.slice(0, 3)}`,
        criarPagamento,
        onErro,
        onPix: vi.fn(),
      });
      await esperarMicrotarefas();
      await esperarMicrotarefas();

      expect(onErro).toHaveBeenCalledTimes(1);
      expect(onErro).toHaveBeenCalledWith(mensagem, "terminal");
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });
  }

  it("CONTROLE: 503 SEM terminal continua 'recuperavel' (nada mudou para o que já era recuperável)", async () => {
    const onErro = vi.fn();
    const criarPagamento = vi.fn().mockRejectedValue(
      erroDaEdge("Não foi possível verificar o pedido.", {
        terminal: false,
        httpStatus: 503,
      }),
    );

    dispararPagamentoPix({
      orderId: "ped-503-c",
      criarPagamento,
      onErro,
      onPix: vi.fn(),
    });
    await esperarMicrotarefas();

    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível verificar o pedido.",
      "recuperavel",
    );
  });
});
