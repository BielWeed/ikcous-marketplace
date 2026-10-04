// @vitest-environment jsdom
//
// CONFIRMAÇÃO DO CARTÃO SEM FIM (03/10/2026, pedido do dono) — depois do
// desafio 3DS, "Confirmando com o banco…" só saía quando o CheckoutView via
// o pedido `pago` no banco; nada perguntava ao servidor. Num pedido de teste
// real a vaga já tinha sido solta e o pedido expirado, e a tela seguia
// girando. Agora a tela do cartão consulta a edge com o contrato SEM
// COBRANÇA (`metodo: "verificar"`), numa cadência limitada, e termina sempre
// num estado explícito.
//
// O que estes testes provam (relógio falso, minutos inteiros):
// - chamada que NUNCA volta: a tela para de girar, mostra o estado incerto,
//   e só UMA chamada real existe (bloqueio da revisão independente);
// - resposta tardia não faz a tela regredir;
// - aprovado tardio, recusa, prazo acabado, 409 terminal, rede caindo,
//   em análise, outra order na vaga, aba escondida, teto das retomadas pela
//   aba e dos toques, sessão perdida;
// - NUNCA outro POST de cartão: toda chamada depois do envio é `verificar`.
//
// Andaime: o PagamentoComCartao DE VERDADE; só o SDK do Mercado Pago e
// `criarPagamento` são dublês (mesmo molde de pagamento-com-cartao.test.tsx).
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
  type CartaoEmCurso,
  MOTIVO_DA_TENTATIVA_ENCERRADA,
  PagamentoComCartao,
} from "@/components/checkout/PagamentoComCartao";
import {
  ESPERAS_DA_CONFIRMACAO_MS,
  ESPERAS_DA_RODADA_MANUAL_MS,
  ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS,
  RETOMADAS_PELA_ABA_DA_CONFIRMACAO,
  RODADAS_MANUAIS_DA_CONFIRMACAO,
} from "@/components/checkout/confirmacao-do-cartao";
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

const PEDIDO = "ped-confirmacao-1";
const ORDER = "ORD01CONFIRMA";
const URL_DO_DESAFIO =
  "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
const PRAZO_VENCIDO = "2000-01-01T00:00:00.000Z";
const SO_CREDITO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 1,
};

const CONFIRMANDO = "Confirmando com o banco…";
const SEM_RESPOSTA = "O banco ainda não confirmou este pagamento.";
const APROVADO = "Pagamento aprovado! Confirmando seu pedido…";
const PRAZO_ACABOU =
  "O pagamento com cartão não foi concluído, e o prazo para pagar este pedido acabou.";

/** Soma das esperas da cadência automática, com folga para cada consulta. */
const CADENCIA_INTEIRA_MS =
  ESPERAS_DA_CONFIRMACAO_MS.reduce((a, b) => a + b, 0) + 60_000;

let visibilidade: "visible" | "hidden" = "visible";

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
  return create;
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Uma promessa que o teste resolve quando quiser (ou nunca). */
function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

describe("Confirmação do cartão depois do 3DS: nunca mais um spinner sem fim", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;
  let props: Record<string, any>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    criarPagamento.mockReset();
    visibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade,
    });
    create = instalarSdkFalso();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    props = {
      orderId: PEDIDO,
      valor: 120,
      config: SO_CREDITO,
      emailDoPagador: "cliente@exemplo.com",
      onErro: vi.fn(),
      onPagarComPix: vi.fn(),
      onCobrancaEmDuvida: vi.fn(),
      onCartaoEmCurso: vi.fn(),
      onCartaoEncerradoPelaConsulta: vi.fn(),
      onVerMeusPedidos: vi.fn(),
      onEntrarDeNovo: vi.fn(),
      sessaoAtiva: true,
      cartaoEncerrado: null,
    };
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllEnvs();
  });

  async function renderizar() {
    await act(async () => {
      raiz.render(<PagamentoComCartao {...(props as any)} />);
    });
  }

  /** Avança o relógio falso e deixa as promessas resolverem no caminho. */
  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function chamadasVerificar(): number {
    return criarPagamento.mock.calls.filter(
      ([args]) => (args as { metodo?: unknown }).metodo === "verificar",
    ).length;
  }

  function nenhumOutroPostDeCartao() {
    const cartao = criarPagamento.mock.calls.filter(
      ([args]) => (args as { metodo?: unknown }).metodo === "cartao",
    );
    expect(cartao, "só o envio original do cartão").toHaveLength(1);
  }

  function botao(texto: string): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement | undefined;
  }

  function girando(): boolean {
    return hospedeiro.querySelector(".animate-spin") !== null;
  }

  /**
   * Formulário → envio (o servidor grava a order e pede o 3DS) → o banco
   * avisa que o desafio terminou → "Confirmando com o banco…", JÁ com o
   * relógio falso ligado (a cadência nasce agendada nele).
   */
  async function chegarAoConfirmando(order: string | null = ORDER) {
    await renderizar();
    await act(async () => {
      await esperarMicrotarefas();
    });
    criarPagamento.mockResolvedValueOnce({
      paymentId: order,
      statusPagamento: "aguardando",
      expiraEm: PRAZO_FUTURO,
      desafio3ds: { url: URL_DO_DESAFIO },
    });
    const chamada = create.mock.calls.at(-1);
    if (!chamada) throw new Error("O formulário do cartão não foi criado.");
    const { callbacks } = chamada[2];
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      await callbacks.onSubmit(
        {
          token: "tok-teste",
          payment_method_id: "master",
          installments: 1,
          payer: {
            email: "cliente@exemplo.com",
            identification: { type: "CPF", number: "11144477735" },
          },
        },
        { paymentTypeId: "credit_card" },
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(chamadasVerificar()).toBe(0);
  }

  it("BLOQUEIO: consulta que NUNCA volta — depois de minutos a tela para de girar, mostra o estado incerto, e só existe UMA chamada real", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockImplementation(() => new Promise(() => {}));

    await avancar(10 * 60_000);

    expect(chamadasVerificar()).toBe(1);
    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);
    expect(hospedeiro.textContent).not.toContain(CONFIRMANDO);
    expect(girando()).toBe(false);
    expect(botao("Verificar de novo")).toBeDefined();
    expect(botao("Pagar com PIX")).toBeDefined();
    expect(botao("Ver meus pedidos")).toBeDefined();

    // "Verificar de novo" com a chamada ainda pendurada: nenhuma segunda.
    await act(async () => {
      botao("Verificar de novo")?.click();
    });
    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(1);
    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);
    expect(girando()).toBe(false);
    nenhumOutroPostDeCartao();
  });

  it("resposta TARDIA (depois do limite da tela) não faz a tela regredir para o spinner", async () => {
    await chegarAoConfirmando();
    const pendurada = adiada<unknown>();
    criarPagamento.mockImplementationOnce(() => pendurada.promessa);
    criarPagamento.mockImplementation(() => new Promise(() => {}));

    await avancar(CADENCIA_INTEIRA_MS + 60_000);
    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);

    await act(async () => {
      pendurada.resolver({
        verificacao: "desafio3ds",
        paymentId: ORDER,
        desafio3ds: { url: URL_DO_DESAFIO },
        expiraEm: PRAZO_FUTURO,
      });
    });
    await avancar(1_000);

    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);
    expect(girando()).toBe(false);
    expect(chamadasVerificar()).toBe(1);
  });

  it("resposta tardia de 'continue esperando' NÃO abre uma segunda cadência (concorrência não cresce)", async () => {
    await chegarAoConfirmando();
    const aindaNoDesafio = {
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    };
    // A 1ª volta só depois do limite da tela (35 s); as outras na hora.
    criarPagamento.mockImplementationOnce(
      () =>
        new Promise((resolver) => {
          setTimeout(() => resolver(aindaNoDesafio), 36_000);
        }),
    );
    criarPagamento.mockResolvedValue(aindaNoDesafio);

    await avancar(CADENCIA_INTEIRA_MS + 60_000);

    expect(chamadasVerificar()).toBe(ESPERAS_DA_CONFIRMACAO_MS.length);
    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);
    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(ESPERAS_DA_CONFIRMACAO_MS.length);
  });

  it("aprovado TARDIO: o banco ainda decide nas primeiras consultas e aprova na terceira — tela de aprovado, sem PIX, e as consultas param", async () => {
    await chegarAoConfirmando();
    const aindaNoDesafio = {
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    };
    criarPagamento
      .mockResolvedValueOnce(aindaNoDesafio)
      .mockResolvedValueOnce(aindaNoDesafio)
      .mockResolvedValueOnce({
        verificacao: "pago",
        paymentId: ORDER,
        expiraEm: PRAZO_FUTURO,
      });

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);
    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    await avancar(
      ESPERAS_DA_CONFIRMACAO_MS[1] + ESPERAS_DA_CONFIRMACAO_MS[2] + 1,
    );

    expect(chamadasVerificar()).toBe(3);
    expect(hospedeiro.textContent).toContain(APROVADO);
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(botao("Tentar outro cartão")).toBeUndefined();

    // MP aprovou ≠ pedido registrado: depois de um minuto a tela diz isso.
    await avancar(ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS + 1);
    expect(hospedeiro.textContent).toContain("O banco aprovou o pagamento");
    expect(hospedeiro.textContent).toContain("Não pague de novo");
    expect(botao("Ver meus pedidos")).toBeDefined();

    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(3);
    nenhumOutroPostDeCartao();
  });

  it("recusa (vaga solta por prova, dentro do prazo): 'não foi concluído' com outro cartão/PIX, e o pai recebe a marca da tentativa", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockResolvedValueOnce({
      verificacao: "recusado",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);

    expect(hospedeiro.textContent).toContain(MOTIVO_DA_TENTATIVA_ENCERRADA);
    expect(hospedeiro.textContent).not.toContain("não foi aprovado");
    expect(props.onCartaoEncerradoPelaConsulta).toHaveBeenCalledWith({
      orderId: PEDIDO,
      paymentId: ORDER,
    } satisfies CartaoEmCurso);
    await act(async () => {
      botao("Pagar com PIX")?.click();
    });
    expect(props.onPagarComPix).toHaveBeenCalledWith(false);
    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(1);
  });

  it("vaga solta com o prazo JÁ vencido: mensagem final, sem outro cartão e sem PIX", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockResolvedValueOnce({
      verificacao: "livre",
      paymentId: null,
      expiraEm: PRAZO_VENCIDO,
    });

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);

    expect(hospedeiro.textContent).toContain(PRAZO_ACABOU);
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(botao("Tentar outro cartão")).toBeUndefined();
    expect(botao("Ver meus pedidos")).toBeDefined();
  });

  it("409 terminal da edge (o pedido não espera mais pagamento — o caso real medido): mensagem da edge, sem nova cobrança oferecida", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockRejectedValueOnce(
      Object.assign(new Error("Este pedido não está aguardando pagamento."), {
        terminal: true,
        cartaoEmAnalise: false,
      }),
    );

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);

    expect(hospedeiro.textContent).toContain(
      "Este pedido não está aguardando pagamento.",
    );
    expect(girando()).toBe(false);
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(botao("Tentar outro cartão")).toBeUndefined();
    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(1);
  });

  it("rede caindo em toda consulta: a cadência inteira roda, para no estado incerto com PIX 'vivo', e os toques em 'Verificar de novo' têm teto", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockRejectedValue(new Error("Failed to fetch"));

    await avancar(CADENCIA_INTEIRA_MS);
    expect(chamadasVerificar()).toBe(ESPERAS_DA_CONFIRMACAO_MS.length);
    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);
    expect(girando()).toBe(false);
    expect(hospedeiro.textContent).not.toContain("é cancelado");

    for (let toque = 1; toque <= RODADAS_MANUAIS_DA_CONFIRMACAO; toque++) {
      const antes = chamadasVerificar();
      await act(async () => {
        botao("Verificar de novo")?.click();
      });
      await avancar(
        ESPERAS_DA_RODADA_MANUAL_MS.reduce((a, b) => a + b, 0) + 5_000,
      );
      expect(chamadasVerificar() - antes).toBe(
        ESPERAS_DA_RODADA_MANUAL_MS.length,
      );
    }
    expect(botao("Verificar de novo")).toBeUndefined();

    // O cartão continua tratado como VIVO: a edge decide se o PIX pode nascer.
    await act(async () => {
      botao("Pagar com PIX")?.click();
    });
    expect(props.onPagarComPix).toHaveBeenCalledWith(true);
    nenhumOutroPostDeCartao();
  });

  it("em análise: a tela troca para 'em análise', continua consultando, e um 'pago' depois vira aprovado", async () => {
    await chegarAoConfirmando();
    criarPagamento
      .mockResolvedValueOnce({
        verificacao: "em_analise",
        paymentId: ORDER,
        expiraEm: PRAZO_FUTURO,
      })
      .mockResolvedValueOnce({ verificacao: "pago", paymentId: ORDER });

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);
    expect(hospedeiro.textContent).toContain(
      "Pagamento em análise pelo banco.",
    );
    await avancar(ESPERAS_DA_CONFIRMACAO_MS[1] + 1);
    expect(hospedeiro.textContent).toContain(APROVADO);
    expect(chamadasVerificar()).toBe(2);
  });

  it("OUTRA order na vaga (outra aba começou outra tentativa): para sem afirmar recusa nem aprovação", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockResolvedValueOnce({
      verificacao: "desafio3ds",
      paymentId: "ORD-DE-OUTRA-ABA",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);

    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);
    expect(hospedeiro.textContent).not.toContain(MOTIVO_DA_TENTATIVA_ENCERRADA);
    expect(hospedeiro.textContent).not.toContain(APROVADO);
    expect(props.onCartaoEncerradoPelaConsulta).not.toHaveBeenCalled();
    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(1);
  });

  it("aba escondida não consulta nem gasta tentativa; ao voltar, consulta na hora", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    visibilidade = "hidden";

    await avancar(10 * 60_000);
    expect(chamadasVerificar()).toBe(0);
    expect(hospedeiro.textContent).toContain(CONFIRMANDO);

    visibilidade = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(1);
    expect(chamadasVerificar()).toBe(1);
  });

  it("volta para a aba depois da cadência parada: reabre rodadas, mas no máximo o teto por tentativa", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockRejectedValue(new Error("Failed to fetch"));
    await avancar(CADENCIA_INTEIRA_MS);
    const depoisDaCadencia = chamadasVerificar();
    expect(hospedeiro.textContent).toContain(SEM_RESPOSTA);

    for (
      let volta = 0;
      volta < RETOMADAS_PELA_ABA_DA_CONFIRMACAO + 3;
      volta++
    ) {
      await avancar(31_000);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await avancar(
        ESPERAS_DA_RODADA_MANUAL_MS.reduce((a, b) => a + b, 0) + 5_000,
      );
    }

    expect(chamadasVerificar() - depoisDaCadencia).toBe(
      RETOMADAS_PELA_ABA_DA_CONFIRMACAO * ESPERAS_DA_RODADA_MANUAL_MS.length,
    );
    // Os toques manuais continuam disponíveis (contagem separada).
    expect(botao("Verificar de novo")).toBeDefined();
  });

  it("resposta velha depois que o pai já encerrou a tentativa (C6) não sobrescreve a recusa", async () => {
    await chegarAoConfirmando();
    const pendurada = adiada<unknown>();
    criarPagamento.mockImplementationOnce(() => pendurada.promessa);

    await avancar(ESPERAS_DA_CONFIRMACAO_MS[0] + 1);
    expect(chamadasVerificar()).toBe(1);

    props = {
      ...props,
      cartaoEncerrado: { orderId: PEDIDO, paymentId: ORDER },
    };
    await renderizar();
    await avancar(1);
    expect(hospedeiro.textContent).toContain(MOTIVO_DA_TENTATIVA_ENCERRADA);

    await act(async () => {
      pendurada.resolver({ verificacao: "pago", paymentId: ORDER });
    });
    await avancar(1);

    expect(hospedeiro.textContent).toContain(MOTIVO_DA_TENTATIVA_ENCERRADA);
    expect(hospedeiro.textContent).not.toContain(APROVADO);
  });

  it("sessão perdida: não consulta nada, não oferece PIX nem outro cartão, pede para entrar de novo", async () => {
    await chegarAoConfirmando();
    criarPagamento.mockResolvedValue({ verificacao: "pago", paymentId: ORDER });

    props = { ...props, sessaoAtiva: false };
    await renderizar();
    await avancar(10 * 60_000);

    expect(chamadasVerificar()).toBe(0);
    expect(hospedeiro.textContent).toContain("Sua sessão expirou.");
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(botao("Tentar outro cartão")).toBeUndefined();
    await act(async () => {
      botao("Entrar de novo")?.click();
    });
    expect(props.onEntrarDeNovo).toHaveBeenCalledTimes(1);
  });
});
