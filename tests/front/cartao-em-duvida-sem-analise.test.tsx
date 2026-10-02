// @vitest-environment jsdom
//
// C5 (front B2, 02/10/2026) — nenhuma tela do cartão promete "em análise
// pelo banco" quando a resposta do servidor NÃO traz uma order confirmada
// (`paymentId`). Antes: a resposta da própria sessão que vinha sem order
// (`sem_registro` do C3; o `aguardando` com `paymentId: null` da chave de
// idempotência já usada; o 503 `indisponivel`) caía em "Pagamento em análise
// pelo banco. Você será avisado…" — com "Pagar com PIX" depois de alguns
// minutos — ou na caixa âmbar "Seu cartão está em análise pelo banco",
// quando talvez não exista cobrança nenhuma.
//
// Regra: "em análise" SÓ com `paymentId` não vazio E status em análise. Sem
// order, a resposta vira `em-duvida` — o pai abre a verificação (C4), que só
// consulta por `metodo: "verificar"`; daqui nunca sai PIX, cartão novo nem um
// segundo POST de cartão.
//
// Mesmo andaime de pagamento-com-cartao.test.tsx: `act` puro, sem
// @testing-library; o SDK do Mercado Pago é um dublê em `globalThis`.
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
  classificarRespostaCartao,
  enviarPagamentoComCartao,
} from "@/components/checkout/PagamentoComCartao";
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";
import type { RespostaCriarPagamento } from "@/hooks/useOrders";
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

const SO_CREDITO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 6,
};
const PRAZO = "2999-01-01T00:00:00.000Z";
const CANCELAMENTO_AUTOMATICO = "2026-10-03T15:00:00.000Z";

/** O 200 do C3: cartão sobre sentinela sem desfecho — nenhuma order. */
const SEM_REGISTRO = {
  verificacao: "sem_registro",
  paymentId: null,
  expiraEm: PRAZO,
  canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
};

/**
 * O 200 de `respostaCartaoEmVerificacao` (409 `idempotency_key_already_used`
 * do MP): `aguardando` SEM order — sem nenhuma marca de dúvida.
 */
const AGUARDANDO_SEM_ORDER = {
  paymentId: null,
  statusPagamento: "aguardando",
  expiraEm: PRAZO,
};

const comoResposta = (corpo: unknown) => corpo as RespostaCriarPagamento;

const erroIndisponivel = () =>
  Object.assign(new Error("Não foi possível consultar o pagamento agora."), {
    terminal: false,
    cartaoEmAnalise: false,
    verificacao: "indisponivel",
  });

function dadosDoBrick() {
  return {
    token: "tok-secreto-123",
    payment_method_id: "master",
    installments: 1,
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

describe("classificarRespostaCartao — sem order confirmada, nunca 'em análise'", () => {
  it("200 sem_registro do C3 vira em-duvida com a data REAL do cancelamento automático", () => {
    expect(classificarRespostaCartao(comoResposta(SEM_REGISTRO))).toEqual({
      tipo: "em-duvida",
      pontoDePartida: {
        verificacao: "sem_registro",
        canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
      },
    });
  });

  it("sem_registro decide ANTES do status: mesmo com 'aguardando' junto, é em-duvida", () => {
    const r = classificarRespostaCartao(
      comoResposta({ ...SEM_REGISTRO, statusPagamento: "aguardando" }),
    );
    expect(r.tipo).toBe("em-duvida");
  });

  it("'aguardando' sem paymentId (null, ausente, vazio ou só espaço) é em-duvida sem_registro — nunca em-analise", () => {
    for (const paymentId of [null, undefined, "", "   "]) {
      const r = classificarRespostaCartao(
        comoResposta({ ...AGUARDANDO_SEM_ORDER, paymentId }),
      );
      expect(r).toEqual({
        tipo: "em-duvida",
        pontoDePartida: { verificacao: "sem_registro" },
      });
    }
  });

  it("status desconhecido ou ausente SEM paymentId é em-duvida indisponível (nada prova que não houve cobrança)", () => {
    for (const statusPagamento of [
      "in_process:pending_review_manual",
      undefined,
    ]) {
      const r = classificarRespostaCartao(
        comoResposta({ paymentId: null, statusPagamento, expiraEm: PRAZO }),
      );
      expect(r).toEqual({
        tipo: "em-duvida",
        pontoDePartida: { verificacao: "indisponivel" },
      });
    }
  });

  it("CONTROLE: 'aguardando' COM paymentId continua em-analise (a order existe)", () => {
    expect(
      classificarRespostaCartao(
        comoResposta({ ...AGUARDANDO_SEM_ORDER, paymentId: "ORD-VIVA-1" }),
      ),
    ).toEqual({ tipo: "em-analise", paymentId: "ORD-VIVA-1" });
  });

  it("CONTROLE: recusa sem paymentId continua recusa (prova que não houve cobrança) — e pago decide pelo status", () => {
    expect(
      classificarRespostaCartao(
        comoResposta({
          paymentId: null,
          statusPagamento: "recusado",
          motivoRecusa: "Cartão recusado.",
          podeTentarDeNovo: true,
          expiraEm: PRAZO,
        }),
      ),
    ).toEqual({ tipo: "recusado", motivo: "Cartão recusado." });
    expect(
      classificarRespostaCartao(
        comoResposta({
          paymentId: null,
          statusPagamento: "pago",
          expiraEm: PRAZO,
        }),
      ),
    ).toEqual({ tipo: "aprovado" });
  });
});

describe("enviarPagamentoComCartao — 503 indisponivel não vira 'tente de novo com o cartão'", () => {
  it("erro com verificacao 'indisponivel' vira em-duvida indisponível, com UM POST só", async () => {
    criarPagamento.mockRejectedValue(erroIndisponivel());
    const r = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento,
    });
    expect(r).toEqual({
      tipo: "em-duvida",
      pontoDePartida: { verificacao: "indisponivel" },
    });
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE de segurança: 'indisponivel' com terminal:true continua terminal (o terminal vence)", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(erroIndisponivel(), { terminal: true }),
    );
    const r = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento,
    });
    expect(r.tipo).toBe("erro");
    expect(r.tipo === "erro" && r.categoria).toBe("terminal");
  });
});

describe("PagamentoOnline em modo cartão — resposta sem order abre a verificação, nunca 'em análise'", () => {
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
    vi.useRealTimers();
  });

  async function renderCartao(comCallback = true) {
    const onErro = vi.fn();
    const onTrocarParaPix = vi.fn();
    const onCobrancaEmDuvida = vi.fn();
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-12345678"
          valor={150}
          metodo="cartao"
          configDoCartao={SO_CREDITO}
          emailDoPagador="cliente@exemplo.com"
          onErro={onErro}
          onTrocarParaPix={onTrocarParaPix}
          {...(comCallback ? { onCobrancaEmDuvida } : {})}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return { onErro, onTrocarParaPix, onCobrancaEmDuvida };
  }

  async function enviarCartao(
    create: ReturnType<typeof instalarSdkFalso>["create"],
  ) {
    const { callbacks } = create.mock.calls.at(-1)![2];
    await act(async () => {
      callbacks.onReady();
    });
    let erro: unknown = null;
    await act(async () => {
      try {
        await callbacks.onSubmit(dadosDoBrick(), {
          paymentTypeId: "credit_card",
        });
      } catch (e) {
        erro = e;
      }
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return erro;
  }

  const botoes = () =>
    [...hospedeiro.querySelectorAll("button")].map((b) =>
      (b.textContent ?? "").trim(),
    );

  function semPromessaNemSaidaQueCobra() {
    expect(hospedeiro.textContent).not.toMatch(/em análise/i);
    expect(botoes()).not.toContain("Pagar com PIX");
    expect(botoes()).not.toContain("Tentar outro cartão");
  }

  for (const [nome, corpo] of [
    ["sem_registro do C3", SEM_REGISTRO],
    ["'aguardando' sem paymentId", AGUARDANDO_SEM_ORDER],
  ] as const) {
    it(`${nome}: avisa o pai por onCobrancaEmDuvida, sem 'em análise', sem PIX — nem depois dos minutos do B2`, async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      const { create } = instalarSdkFalso();
      criarPagamento.mockResolvedValue(corpo);
      const { onErro, onTrocarParaPix, onCobrancaEmDuvida } =
        await renderCartao();
      const erro = await enviarCartao(create);

      expect(criarPagamento).toHaveBeenCalledTimes(1);
      expect(onCobrancaEmDuvida).toHaveBeenCalledTimes(1);
      expect(onCobrancaEmDuvida.mock.calls[0][0].verificacao).toBe(
        "sem_registro",
      );
      expect(onErro).not.toHaveBeenCalled();
      // Relançado para o Brick sair do "processando".
      expect(erro).toBeInstanceOf(Error);
      semPromessaNemSaidaQueCobra();

      await act(async () => {
        vi.advanceTimersByTime(
          MINUTOS_ANTES_DE_OFERECER_PIX_EM_ANALISE * 60_000 + 10_000,
        );
      });
      semPromessaNemSaidaQueCobra();
      expect(onTrocarParaPix).not.toHaveBeenCalled();
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });
  }

  it("sem_registro leva a data do cancelamento automático ao pai", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    const { onCobrancaEmDuvida } = await renderCartao();
    await enviarCartao(create);
    expect(onCobrancaEmDuvida).toHaveBeenCalledWith({
      verificacao: "sem_registro",
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });
  });

  it("503 indisponivel: avisa o pai com 'indisponivel' e não pede outro cartão", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockRejectedValue(erroIndisponivel());
    const { onErro, onCobrancaEmDuvida } = await renderCartao();
    await enviarCartao(create);

    expect(onCobrancaEmDuvida).toHaveBeenCalledWith({
      verificacao: "indisponivel",
    });
    expect(onErro).not.toHaveBeenCalled();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    semPromessaNemSaidaQueCobra();
  });

  it("pai antigo SEM onCobrancaEmDuvida: cai no onErro com o sinal 'cartaoEmAnalise' (falha fechada: nunca PIX)", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue(SEM_REGISTRO);
    const { onErro } = await renderCartao(false);
    await enviarCartao(create);

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro.mock.calls[0][1]).toBe("recuperavel");
    expect(onErro.mock.calls[0][2]).toBe("cartaoEmAnalise");
    expect(String(onErro.mock.calls[0][0])).not.toMatch(/em análise/i);
    semPromessaNemSaidaQueCobra();
  });

  it("CONTROLE: 'aguardando' COM paymentId continua mostrando 'Pagamento em análise pelo banco'", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "ORD-VIVA-1",
      statusPagamento: "aguardando",
      expiraEm: PRAZO,
    });
    const { onCobrancaEmDuvida } = await renderCartao();
    await enviarCartao(create);

    expect(hospedeiro.textContent).toContain(
      "Pagamento em análise pelo banco. Você será avisado quando for aprovado.",
    );
    expect(onCobrancaEmDuvida).not.toHaveBeenCalled();
  });
});
