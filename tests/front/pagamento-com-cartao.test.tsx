// @vitest-environment jsdom
//
// CARTÃO PELO APP (Fase 3.5, 26/09/2026) — Card Payment Brick, 3-D Secure,
// recusa com "Tentar outro cartão"/"Pagar com PIX" e a regra de ouro do
// modo cartão: NUNCA criar PIX sozinho. Contrato da edge em
// docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md ("Cartão
// online"). Mesmo andaime de pagamento-online.test.tsx: `act` puro, sem
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
  classificarRespostaCartao,
  desafioConcluido,
  enviarPagamentoComCartao,
  montarBrickDeCartao,
  montarCorpoDoCartao,
  origemDoMercadoPago,
  urlDoDesafioValida,
} from "@/components/checkout/PagamentoComCartao";
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
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
const SO_DEBITO: ConfigDoCartao = {
  credito: false,
  debito: true,
  parcelasMax: 6,
};
const OS_DOIS: ConfigDoCartao = { credito: true, debito: true, parcelasMax: 6 };

/** CardData do Brick — o token e o documento são o que NUNCA pode vazar. */
function dadosDoBrick(sobrepor: Record<string, unknown> = {}) {
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
    ...sobrepor,
  };
}

/** Dublê do SDK: cada `create()` devolve um controlador com `unmount` próprio. */
function instalarSdkFalso() {
  const unmounts: Array<ReturnType<typeof vi.fn>> = [];
  const create = vi.fn(
    async (_brick: string, _container: string, _config: any) => {
      const unmount = vi.fn();
      unmounts.push(unmount);
      return { unmount };
    },
  );
  const MercadoPagoSpy = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = MercadoPagoSpy;
  return { create, unmounts, MercadoPagoSpy };
}

function ultimaConfig(create: ReturnType<typeof instalarSdkFalso>["create"]) {
  const chamada = create.mock.calls.at(-1);
  if (!chamada) throw new Error("O Brick não foi criado.");
  return chamada[2];
}

// O SDK carrega UMA vez por módulo (`promessaSdk`): resolve aqui, no começo,
// e todos os testes abaixo já encontram o script "carregado".
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

describe("montarCorpoDoCartao — o corpo da edge sai do que o Brick entregou", () => {
  it("crédito: token, bandeira, tipo do AdditionalData, parcelas, documento só com dígitos e e-mail", () => {
    const r = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: OS_DOIS,
    });
    expect(r).toEqual({
      ok: true,
      corpo: {
        orderId: "ped-1",
        metodo: "cartao",
        token: "tok-secreto-123",
        paymentMethodId: "master",
        paymentTypeId: "credit_card",
        parcelas: 3,
        documento: { type: "CPF", number: "12345678909" },
        email: "cliente@exemplo.com",
      },
    });
  });

  it("débito é sempre à vista, mesmo se o Brick mandar outra parcela", () => {
    const r = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick({ payment_method_id: "debelo", installments: 1 }),
      adicionais: { paymentTypeId: "debit_card" },
      config: OS_DOIS,
    });
    expect(r.ok && r.corpo.parcelas).toBe(1);
    expect(r.ok && r.corpo.paymentTypeId).toBe("debit_card");
  });

  it("sem o tipo no AdditionalData, cai no payment_type_id do CardData; e com um tipo só ligado, é ele", () => {
    const peloCardData = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick({ payment_type_id: "debit_card", installments: 1 }),
      adicionais: undefined,
      config: OS_DOIS,
    });
    expect(peloCardData.ok && peloCardData.corpo.paymentTypeId).toBe(
      "debit_card",
    );

    const peloUnicoLigado = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: {},
      config: SO_CREDITO,
    });
    expect(peloUnicoLigado.ok && peloUnicoLigado.corpo.paymentTypeId).toBe(
      "credit_card",
    );
  });

  it("tipo desconhecido com crédito E débito ligados não chuta: recusa com frase curada", () => {
    const r = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "prepaid_card" },
      config: OS_DOIS,
    });
    expect(r).toEqual({
      ok: false,
      mensagem:
        "Não foi possível identificar se o cartão é de crédito ou débito. Tente de novo.",
    });
  });

  it("débito numa loja só de crédito é recusado aqui, antes da edge", () => {
    const r = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick({ installments: 1 }),
      adicionais: { paymentTypeId: "debit_card" },
      config: SO_CREDITO,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.mensagem).toContain("não aceita cartão de débito");
  });

  it("parcelas acima do teto da lojista, zero ou quebradas não passam", () => {
    for (const installments of [7, 0, 2.5, "abc"]) {
      const r = montarCorpoDoCartao({
        orderId: "ped-1",
        dados: dadosDoBrick({ installments }),
        adicionais: { paymentTypeId: "credit_card" },
        config: SO_CREDITO,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("sem token, sem bandeira ou com documento fora de CPF/CNPJ não chama a edge", () => {
    const casos = [
      dadosDoBrick({ token: "" }),
      dadosDoBrick({ payment_method_id: undefined }),
      dadosDoBrick({
        payer: { identification: { type: "DNI", number: "123" } },
      }),
      dadosDoBrick({
        payer: { identification: { type: "CPF", number: "..." } },
      }),
    ];
    for (const dados of casos) {
      const r = montarCorpoDoCartao({
        orderId: "ped-1",
        dados,
        adicionais: { paymentTypeId: "credit_card" },
        config: SO_CREDITO,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("CNPJ em minúsculas vira CNPJ; e-mail ausente não entra no corpo", () => {
    const r = montarCorpoDoCartao({
      orderId: "ped-1",
      dados: dadosDoBrick({
        payer: {
          identification: { type: "cnpj", number: "11.222.333/0001-81" },
        },
      }),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
    });
    expect(r.ok && r.corpo.documento).toEqual({
      type: "CNPJ",
      number: "11222333000181",
    });
    expect(r.ok && "email" in r.corpo).toBe(false);
  });
});

describe("classificarRespostaCartao — o que a tela faz com a resposta 200", () => {
  const base = { paymentId: "pay-1", expiraEm: "2026-09-26T12:30:00Z" };

  it("pago → aprovado; aguardando sem desafio → em análise", () => {
    expect(
      classificarRespostaCartao({ ...base, statusPagamento: "pago" }),
    ).toEqual({ tipo: "aprovado" });
    expect(
      classificarRespostaCartao({ ...base, statusPagamento: "aguardando" }),
    ).toEqual({ tipo: "em-analise" });
  });

  it("aguardando com desafio3ds do Mercado Pago → desafio com a URL", () => {
    const url =
      "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "aguardando",
        desafio3ds: { url },
      }),
    ).toEqual({ tipo: "desafio", url });
  });

  it("desafio com URL fora do Mercado Pago NÃO vira iframe — erro recuperável", () => {
    for (const url of [
      "https://golpe.io/3ds",
      "http://www.mercadopago.com.br/3ds",
      "javascript:alert(1)",
    ]) {
      const r = classificarRespostaCartao({
        ...base,
        statusPagamento: "aguardando",
        desafio3ds: { url },
      });
      expect(r.tipo).toBe("erro");
      expect(r.tipo === "erro" && r.categoria).toBe("recuperavel");
    }
  });

  it("recusado mostra o motivo da edge (ou o padrão) e deixa tentar de novo", () => {
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "recusado",
        motivoRecusa: "Saldo insuficiente.",
        podeTentarDeNovo: true,
      }),
    ).toEqual({ tipo: "recusado", motivo: "Saldo insuficiente." });
    const semMotivo = classificarRespostaCartao({
      ...base,
      statusPagamento: "recusado",
    });
    expect(semMotivo.tipo).toBe("recusado");
  });

  it("recusado com podeTentarDeNovo:false é terminal (o pedido não aceita mais tentativa)", () => {
    expect(
      classificarRespostaCartao({
        ...base,
        statusPagamento: "recusado",
        motivoRecusa: "A reserva deste pedido acabou.",
        podeTentarDeNovo: false,
      }),
    ).toEqual({
      tipo: "erro",
      mensagem: "A reserva deste pedido acabou.",
      categoria: "terminal",
    });
  });

  it("expirado, estornado, desconhecido e AUSENTE nunca viram sucesso silencioso", () => {
    for (const statusPagamento of [
      "expirado",
      "estornado",
      "in_process:pending_review_manual",
      undefined,
    ]) {
      const r = classificarRespostaCartao({
        ...base,
        statusPagamento: statusPagamento as string,
      });
      expect(r.tipo).toBe("erro");
      expect(r.tipo === "erro" && r.categoria).toBe("terminal");
    }
  });
});

describe("origem e aviso do desafio 3-D Secure", () => {
  it("aceita só HTTPS nos domínios do Mercado Pago/Mercado Livre", () => {
    for (const origem of [
      "https://www.mercadopago.com.br",
      "https://mercadopago.com",
      "https://api.mercadolibre.com",
      "https://www.mercadolivre.com.br",
      "https://mercadolivre.com",
    ]) {
      expect(origemDoMercadoPago(origem)).toBe(true);
    }
    for (const origem of [
      "http://www.mercadopago.com.br",
      "https://mercadopago.com.br.golpe.io",
      "https://golpemercadopago.com.br",
      "null",
      "",
    ]) {
      expect(origemDoMercadoPago(origem)).toBe(false);
    }
  });

  it("urlDoDesafioValida recusa o que não é texto", () => {
    expect(urlDoDesafioValida(undefined)).toBe(false);
    expect(urlDoDesafioValida(42)).toBe(false);
    expect(urlDoDesafioValida("https://www.mercadopago.com.br/x")).toBe(true);
  });

  it("status COMPLETE conclui (objeto ou JSON em texto); o resto não", () => {
    expect(desafioConcluido({ status: "COMPLETE" })).toBe(true);
    expect(desafioConcluido('{"status":"COMPLETE"}')).toBe(true);
    expect(desafioConcluido({ status: "PENDING" })).toBe(false);
    expect(desafioConcluido("COMPLETE")).toBe(false);
    expect(desafioConcluido(null)).toBe(false);
  });
});

describe("enviarPagamentoComCartao — o onSubmit sem o Brick", () => {
  it("chama a edge com o corpo do contrato e classifica a resposta", async () => {
    const criar = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    const r = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento: criar,
    });
    expect(r).toEqual({ tipo: "aprovado" });
    expect(criar).toHaveBeenCalledWith({
      orderId: "ped-1",
      metodo: "cartao",
      token: "tok-secreto-123",
      paymentMethodId: "master",
      paymentTypeId: "credit_card",
      parcelas: 3,
      documento: { type: "CPF", number: "12345678909" },
      email: "cliente@exemplo.com",
    });
  });

  it("erro da edge com .terminal=true é terminal; sem o campo, recuperável", async () => {
    const terminal = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento: vi.fn().mockRejectedValue(
        Object.assign(new Error("O prazo para pagar este pedido acabou."), {
          terminal: true,
        }),
      ),
    });
    expect(terminal).toEqual({
      tipo: "erro",
      mensagem: "O prazo para pagar este pedido acabou.",
      categoria: "terminal",
    });

    const recuperavel = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento: vi
        .fn()
        .mockRejectedValue(new Error("Não foi possível gerar a cobrança.")),
    });
    expect(recuperavel.tipo === "erro" && recuperavel.categoria).toBe(
      "recuperavel",
    );
  });

  it("dado inválido do Brick não chega à edge", async () => {
    const criar = vi.fn();
    const r = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick({ token: undefined }),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento: criar,
    });
    expect(r.tipo).toBe("erro");
    expect(criar).not.toHaveBeenCalled();
  });
});

describe("montarBrickDeCartao — ciclo de vida do Card Payment Brick", () => {
  function opcoes(
    sobrepor: Partial<Parameters<typeof montarBrickDeCartao>[0]> = {},
  ): Parameters<typeof montarBrickDeCartao>[0] {
    return {
      containerId: "mp-cartao-teste",
      valor: 150,
      config: SO_CREDITO,
      emailDoPagador: "cliente@exemplo.com",
      onEnviar: vi.fn(async () => {}),
      onFalhaDeMontagem: vi.fn(),
      onPronto: vi.fn(),
      ...sobrepor,
    };
  }

  it("cria o cardPayment no contêiner com valor, e-mail, teto de parcelas e só os tipos ligados", async () => {
    const { create, MercadoPagoSpy } = instalarSdkFalso();
    montarBrickDeCartao(opcoes());
    await esperarMicrotarefas();

    expect(MercadoPagoSpy).toHaveBeenCalledWith(
      "TEST-000000-0000-0000-0000-000000000000",
      { locale: "pt-BR" },
    );
    expect(create).toHaveBeenCalledTimes(1);
    const [brick, container, config] = create.mock.calls[0];
    expect(brick).toBe("cardPayment");
    expect(container).toBe("mp-cartao-teste");
    expect(config.initialization).toEqual({
      amount: 150,
      payer: { email: "cliente@exemplo.com" },
    });
    expect(config.customization.paymentMethods).toEqual({
      minInstallments: 1,
      maxInstallments: 6,
      types: { included: ["credit_card"] },
    });
  });

  it("só débito: parcelas travadas em 1 e só debit_card; sem e-mail, sem payer", async () => {
    const { create } = instalarSdkFalso();
    montarBrickDeCartao(opcoes({ config: SO_DEBITO, emailDoPagador: null }));
    await esperarMicrotarefas();

    const config = ultimaConfig(create);
    expect(config.initialization).toEqual({ amount: 150 });
    expect(config.customization.paymentMethods).toEqual({
      minInstallments: 1,
      maxInstallments: 1,
      types: { included: ["debit_card"] },
    });
  });

  it("StrictMode (mount → cleanup → mount antes de o create rodar) cria o Brick uma vez só", async () => {
    const { create } = instalarSdkFalso();
    const o = opcoes();
    const limpar1 = montarBrickDeCartao(o);
    limpar1();
    const limpar2 = montarBrickDeCartao(o);
    await esperarMicrotarefas();

    expect(create).toHaveBeenCalledTimes(1);
    expect(o.onFalhaDeMontagem).not.toHaveBeenCalled();
    limpar2();
  });

  it("cleanup depois de montado desmonta o controlador", async () => {
    const { unmounts } = instalarSdkFalso();
    const limpar = montarBrickDeCartao(opcoes());
    await esperarMicrotarefas();
    expect(unmounts).toHaveLength(1);
    expect(unmounts[0]).not.toHaveBeenCalled();

    limpar();
    expect(unmounts[0]).toHaveBeenCalledTimes(1);
  });

  it("cancelado com o create() em voo: desmonta assim que ele termina", async () => {
    const unmount = vi.fn();
    let resolver!: (v: { unmount: () => void }) => void;
    const create = vi.fn(
      () =>
        new Promise<{ unmount: () => void }>((r) => {
          resolver = r;
        }),
    );
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };
    const limpar = montarBrickDeCartao(opcoes());
    await esperarMicrotarefas();
    limpar();
    resolver({ unmount });
    await esperarMicrotarefas();
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it("onReady avisa que o formulário está pronto; onSubmit repassa (CardData, AdditionalData)", async () => {
    const { create } = instalarSdkFalso();
    const o = opcoes();
    montarBrickDeCartao(o);
    await esperarMicrotarefas();

    const { callbacks } = ultimaConfig(create);
    callbacks.onReady();
    expect(o.onPronto).toHaveBeenCalledTimes(1);

    const dados = dadosDoBrick();
    await callbacks.onSubmit(dados, { paymentTypeId: "credit_card" });
    expect(o.onEnviar).toHaveBeenCalledWith(dados, {
      paymentTypeId: "credit_card",
    });
  });

  it("onError não crítico (campo incompleto) não derruba a tela; crítico derruba", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { create } = instalarSdkFalso();
    const o = opcoes();
    montarBrickDeCartao(o);
    await esperarMicrotarefas();

    const { callbacks } = ultimaConfig(create);
    callbacks.onError({
      type: "non_critical",
      cause: "incomplete_fields",
      message: "x",
    });
    expect(o.onFalhaDeMontagem).not.toHaveBeenCalled();

    callbacks.onError({
      type: "critical",
      cause: "fields_setup_failed",
      message: "y",
    });
    expect(o.onFalhaDeMontagem).toHaveBeenCalledTimes(1);
  });

  it("create() rejeitando com texto do bundle: avisa a falha e só o console vê o texto", async () => {
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi
      .fn()
      .mockRejectedValue(new Error("Invalid public key format provided"));
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };
    const o = opcoes();
    montarBrickDeCartao(o);
    await esperarMicrotarefas();

    expect(o.onFalhaDeMontagem).toHaveBeenCalledTimes(1);
    expect(consoleErro).toHaveBeenCalledWith(
      "montarBrickDeCartao:",
      expect.any(Error),
    );
  });
});

describe("PagamentoOnline em modo cartão (render de verdade)", () => {
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
    config = SO_CREDITO as ConfigDoCartao | null,
    onErro = vi.fn(),
    onTrocarParaPix = vi.fn(),
  } = {}) {
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

  it("monta o Brick no contêiner da tela e NÃO cria PIX sozinho", async () => {
    const { create } = instalarSdkFalso();
    await renderCartao();

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const idDoContainer = create.mock.calls[0][1];
    expect(document.getElementById(idDoContainer)).not.toBeNull();
    expect(hospedeiro.textContent).toContain("Pagamento com cartão");
    expect(hospedeiro.textContent).toContain(
      "Carregando o formulário do cartão",
    );

    await act(async () => {
      ultimaConfig(create).callbacks.onReady();
    });
    expect(hospedeiro.textContent).not.toContain(
      "Carregando o formulário do cartão",
    );
  });

  it("aprovado: mostra 'Pagamento aprovado! Confirmando seu pedido…' e desmonta o Brick", async () => {
    const { create, unmounts } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    await renderCartao();
    await enviarCartao(create);

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toMatchObject({
      orderId: "ped-12345678",
      metodo: "cartao",
      paymentTypeId: "credit_card",
    });
    expect(hospedeiro.textContent).toContain(
      "Pagamento aprovado! Confirmando seu pedido…",
    );
    expect(unmounts[0]).toHaveBeenCalledTimes(1);
  });

  it("em análise: avisa que o banco está analisando", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "x",
    });
    await renderCartao();
    await enviarCartao(create);

    expect(hospedeiro.textContent).toContain(
      "Pagamento em análise pelo banco. Você será avisado quando for aprovado.",
    );
  });

  it("recusado: mostra o motivo; 'Tentar outro cartão' remonta o Brick do zero", async () => {
    const { create, unmounts } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "recusado",
      expiraEm: "x",
      motivoRecusa: "Saldo insuficiente. Tente outro cartão ou pague com PIX.",
      podeTentarDeNovo: true,
    });
    const { onErro } = await renderCartao();
    await enviarCartao(create);

    expect(onErro).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Saldo insuficiente.");
    expect(unmounts[0]).toHaveBeenCalledTimes(1);

    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Tentar outro cartão",
    )!;
    await act(async () => {
      tentar.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).not.toContain("Saldo insuficiente.");
    // Continua sem PIX nenhum: só a primeira tentativa de cartão chamou a edge.
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("recusado: 'Pagar com PIX' troca para o PIX na MESMA tela, gera o QR e avisa o pai", async () => {
    const { create, unmounts } = instalarSdkFalso();
    criarPagamento
      .mockResolvedValueOnce({
        paymentId: "pay-1",
        statusPagamento: "recusado",
        expiraEm: "x",
        motivoRecusa: "Cartão recusado pelo banco.",
        podeTentarDeNovo: true,
      })
      .mockResolvedValueOnce({
        paymentId: "pay-2",
        statusPagamento: "aguardando",
        expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(),
        qrCode: "000201-pix",
        qrCodeBase64: "abc123",
      });
    const { onTrocarParaPix } = await renderCartao();
    await enviarCartao(create);

    const pix = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Pagar com PIX",
    )!;
    await act(async () => {
      pix.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(onTrocarParaPix).toHaveBeenCalledTimes(1);
    expect(criarPagamento).toHaveBeenLastCalledWith({
      orderId: "ped-12345678",
      metodo: "pix",
    });
    expect(
      hospedeiro.querySelector("img[alt='QR code do PIX']"),
    ).not.toBeNull();
    expect(unmounts.every((u) => u.mock.calls.length === 1)).toBe(true);
  });

  it("recusado sem nova tentativa possível vai para o onErro como terminal", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "recusado",
      expiraEm: "x",
      motivoRecusa: "Este pedido não aceita mais tentativas.",
      podeTentarDeNovo: false,
    });
    const { onErro } = await renderCartao();
    const erro = await enviarCartao(create);

    expect(onErro).toHaveBeenCalledWith(
      "Este pedido não aceita mais tentativas.",
      "terminal",
    );
    // Relançado para o Brick sair do "processando".
    expect(erro).toBeInstanceOf(Error);
  });

  it("3-D Secure: abre o iframe credentialless e só o COMPLETE do Mercado Pago troca para 'Confirmando com o banco…'", async () => {
    const { create } = instalarSdkFalso();
    const url =
      "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "x",
      desafio3ds: { url },
    });
    await renderCartao();
    await enviarCartao(create);

    const iframe = hospedeiro.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("title")).toBe("Autenticação do seu banco");
    expect(iframe!.getAttribute("src")).toBe(url);
    expect(iframe!.hasAttribute("credentialless")).toBe(true);

    // Origem estranha: ignorado.
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://golpe.io",
        }),
      );
    });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();

    // Mercado Pago, mas ainda não concluído: ignorado.
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "PENDING" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();

    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(hospedeiro.textContent).toContain("Confirmando com o banco…");
  });

  it("falha de rede no envio: onErro recuperável e o erro volta ao Brick", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockRejectedValue(
      new Error("Não foi possível gerar a cobrança."),
    );
    const { onErro } = await renderCartao();
    const erro = await enviarCartao(create);

    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível gerar a cobrança.",
      "recuperavel",
    );
    expect(erro).toBeInstanceOf(Error);
  });

  it("nenhum dado do cartão (token, documento) vai para o console — nem no erro", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map(
      (nivel) => vi.spyOn(console, nivel).mockImplementation(() => {}),
    );
    const { create } = instalarSdkFalso();
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("Falha"), { terminal: false }),
    );
    await renderCartao();
    await enviarCartao(create);
    await act(async () => {
      ultimaConfig(create).callbacks.onError({
        type: "critical",
        cause: "card_token_creation_failed",
        message: "tok-secreto-123",
      });
    });

    const tudoQueFoiLogado = espioes
      .flatMap((espiao) => espiao.mock.calls.flat())
      .map((arg) => {
        try {
          return `${String(arg)} ${JSON.stringify(arg)}`;
        } catch {
          return String(arg);
        }
      })
      .join("\n");
    expect(tudoQueFoiLogado).not.toContain("tok-secreto-123");
    expect(tudoQueFoiLogado).not.toContain("12345678909");
    expect(tudoQueFoiLogado).not.toContain("123.456.789-09");
  });

  it("desmontar a tela desmonta o Brick", async () => {
    const { unmounts } = instalarSdkFalso();
    await renderCartao();
    expect(unmounts).toHaveLength(1);

    act(() => {
      raiz.render(<div />);
    });
    expect(unmounts[0]).toHaveBeenCalledTimes(1);
  });

  it("modo cartão com a config desligada/ausente: não monta Brick, não cria PIX — o cliente escolhe", async () => {
    const { create } = instalarSdkFalso();
    await renderCartao({ config: null });

    expect(create).not.toHaveBeenCalled();
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain(
      "O pagamento com cartão não está disponível nesta loja agora.",
    );
  });
});
