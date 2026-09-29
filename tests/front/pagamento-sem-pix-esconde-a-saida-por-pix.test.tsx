// @vitest-environment jsdom
//
// P1 DO PR #711 — quando a sonda da edge diz que o PIX NÃO está pronto
// (`pix === false`), as saídas "Pagar com PIX" de dentro do fluxo do cartão
// viram beco sem saída: o 409 `pixSemChaveDeAssinatura` é terminal, e — com o
// cartão ainda vivo (desafio 3DS, "confirmando", "em análise") — ainda liga a
// cobrança incerta. Com `podePagarComPix={false}` a tela do cartão NÃO oferece
// o PIX em nenhum dos quatro pontos (+ o fallback "cartão indisponível"); a
// saída que sobrar é a que existe sem PIX. Sem a prop (ou `true`) tudo segue
// como sempre foi — os testes de pagamento-com-cartao.test.tsx seguem valendo.
//
// Mesmo andaime de pagamento-com-cartao.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE,
  desafioConcluido,
} from "@/components/checkout/PagamentoComCartao";
import {
  PagamentoOnline,
  dispararPagamentoPix,
} from "@/components/checkout/PagamentoOnline";
import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const SO_CREDITO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 6,
};

function dadosDoBrick() {
  return {
    token: "tok-secreto-123",
    issuer_id: "25",
    payment_method_id: "master",
    transaction_amount: 150,
    installments: 3,
    payer: {
      email: "cliente@exemplo.com",
      identification: { type: "CPF", number: "123.456.789-09" },
    },
  };
}

function instalarSdkFalso() {
  const create = vi.fn(
    async (_brick: string, _container: string, _config: any) => ({
      unmount: vi.fn(),
    }),
  );
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  return { create };
}

function ultimaConfig(create: ReturnType<typeof instalarSdkFalso>["create"]) {
  const chamada = create.mock.calls.at(-1);
  if (!chamada) throw new Error("O Brick não foi criado.");
  return chamada[2];
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

beforeEach(() => {
  vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  criarPagamento.mockReset();
});

afterEach(() => {
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const URL_3DS =
  "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";

describe("PagamentoOnline em modo cartão com o PIX indisponível (podePagarComPix={false})", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function renderCartao({
    podePagarComPix,
    config = SO_CREDITO as ConfigDoCartao | null,
  }: { podePagarComPix?: boolean; config?: ConfigDoCartao | null } = {}) {
    const onErro = vi.fn();
    const onTrocarParaPix = vi.fn();
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-12345678"
          valor={150}
          metodo="cartao"
          configDoCartao={config}
          emailDoPagador="cliente@exemplo.com"
          onErro={onErro}
          onTrocarParaPix={onTrocarParaPix}
          podePagarComPix={podePagarComPix}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return { onErro, onTrocarParaPix };
  }

  async function enviarCartao(
    create: ReturnType<typeof instalarSdkFalso>["create"],
  ) {
    const { callbacks } = ultimaConfig(create);
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      try {
        await callbacks.onSubmit(dadosDoBrick(), {
          paymentTypeId: "credit_card",
        });
      } catch {
        // relançado para o Brick; irrelevante aqui
      }
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    );
  const nenhumTextoDePix = () =>
    expect(hospedeiro.textContent).not.toMatch(/PIX/i);

  it("recusado: sem 'Pagar com PIX'; 'Tentar outro cartão' continua e é a saída", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "recusado",
      expiraEm: "x",
      motivoRecusa: "Saldo insuficiente.",
      podeTentarDeNovo: true,
    });
    await renderCartao({ podePagarComPix: false });
    await enviarCartao(create);

    expect(hospedeiro.textContent).toContain("Saldo insuficiente.");
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(botao("Tentar outro cartão")).toBeDefined();
  });

  it("CONTROLE: o mesmo recusado SEM a prop (ou true) oferece 'Pagar com PIX', como sempre foi", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "recusado",
      expiraEm: "x",
      motivoRecusa: "Saldo insuficiente.",
      podeTentarDeNovo: true,
    });
    await renderCartao();
    await enviarCartao(create);
    expect(botao("Pagar com PIX")).toBeDefined();
  });

  it("3-D Secure: o iframe fica, mas sem botão de PIX e sem a frase 'você pode pagar com PIX'; a saída é esperar o banco / a reserva vencer", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "x",
      desafio3ds: { url: URL_3DS },
    });
    const { onTrocarParaPix } = await renderCartao({ podePagarComPix: false });
    await enviarCartao(create);

    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(botao("Tentar outro cartão")).toBeUndefined();
    nenhumTextoDePix();
    // Nunca deixa a pessoa sem orientação: diz que o pedido expira sozinho.
    expect(hospedeiro.textContent).toContain("expira sozinho");
    expect(onTrocarParaPix).not.toHaveBeenCalled();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("'Confirmando com o banco…': sem 'Pagar com PIX' e sem a frase que promete PIX", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "x",
      desafio3ds: { url: URL_3DS },
    });
    await renderCartao({ podePagarComPix: false });
    await enviarCartao(create);
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });

    expect(desafioConcluido({ status: "COMPLETE" })).toBe(true);
    expect(hospedeiro.textContent).toContain("Confirmando com o banco…");
    expect(botao("Pagar com PIX")).toBeUndefined();
    nenhumTextoDePix();
  });

  describe("em análise: nem depois dos minutos de espera aparece 'Pagar com PIX'", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("passado o teto de minutos, o botão continua ausente", async () => {
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue({
        paymentId: "pay-1",
        statusPagamento: "aguardando",
        expiraEm: "x",
      });
      const { onTrocarParaPix } = await renderCartao({
        podePagarComPix: false,
      });
      await enviarCartao(create);
      await act(async () => {
        vi.advanceTimersByTime(
          MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE * 60_000 + 10_000,
        );
      });

      expect(hospedeiro.textContent).toContain(
        "Pagamento em análise pelo banco.",
      );
      expect(botao("Pagar com PIX")).toBeUndefined();
      expect(onTrocarParaPix).not.toHaveBeenCalled();
    });
  });

  it("cartão indisponível no meio do pagamento + PIX indisponível: a mensagem fica, o botão de PIX não", async () => {
    instalarSdkFalso();
    await renderCartao({ podePagarComPix: false, config: null });

    expect(hospedeiro.textContent).toContain(
      "O pagamento com cartão não está disponível nesta loja agora.",
    );
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("CONTROLE: cartão indisponível com o PIX disponível mantém o botão, como sempre foi", async () => {
    instalarSdkFalso();
    await renderCartao({ config: null });
    expect(botao("Pagar com PIX")).toBeDefined();
  });
});

describe("dispararPagamentoPix — o 409 sem chave de assinatura chega ao pai como sinal próprio", () => {
  const TEXTO_409 =
    "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.";

  it("erro com .pixSemChaveDeAssinatura === true → onErro(msg, 'terminal', 'pixSemChave')", async () => {
    const onErro = vi.fn();
    const criar = vi.fn().mockRejectedValue(
      Object.assign(new Error(TEXTO_409), {
        terminal: true,
        pixSemChaveDeAssinatura: true,
      }),
    );
    dispararPagamentoPix({
      orderId: "ped-pix-sem-chave-1",
      criarPagamento: criar,
      onErro,
      onPix: vi.fn(),
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith(TEXTO_409, "terminal", "pixSemChave");
  });

  it("o MESMO texto sem a flag NÃO vira sinal (contrato é o campo, não o texto) — sai com dois argumentos", async () => {
    const onErro = vi.fn();
    const criar = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error(TEXTO_409), { terminal: true }),
      );
    dispararPagamentoPix({
      orderId: "ped-pix-sem-chave-2",
      criarPagamento: criar,
      onErro,
      onPix: vi.fn(),
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(onErro).toHaveBeenCalledWith(TEXTO_409, "terminal");
  });

  it("cartaoEmAnalise continua ganhando: os dois campos juntos mantêm o sinal do cartão vivo", async () => {
    const onErro = vi.fn();
    const criar = vi.fn().mockRejectedValue(
      Object.assign(new Error("Há um pagamento com cartão em análise."), {
        terminal: false,
        cartaoEmAnalise: true,
        pixSemChaveDeAssinatura: true,
      }),
    );
    dispararPagamentoPix({
      orderId: "ped-pix-sem-chave-3",
      criarPagamento: criar,
      onErro,
      onPix: vi.fn(),
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(onErro).toHaveBeenCalledWith(
      "Há um pagamento com cartão em análise.",
      "recuperavel",
      "cartaoEmAnalise",
    );
  });
});
