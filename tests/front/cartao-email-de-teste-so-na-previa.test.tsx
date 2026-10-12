// @vitest-environment jsdom
//
// E-MAIL DE TESTE DO MERCADO PAGO SÓ NA PRÉVIA (04/10/2026). Com credenciais
// de teste, a Orders API só fecha a order se o pagador for
// `test@testuser.com`. A opção `VITE_MP_TEST_PAYER_EMAIL` troca o e-mail SÓ
// da tentativa de cartão e SÓ quando `import.meta.env.DEV === true` e o valor
// é o literal exato. Aqui se prova: (1) ligada, o CORPO enviado à edge leva o
// literal mesmo com o callback do Brick omitindo ou trazendo outro e-mail;
// (2) desligada (produção, ausente, vazia, diferente), o corpo é IDÊNTICO ao
// de antes; (3) o PIX não é tocado.
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
  enviarPagamentoComCartao,
  montarBrickDeCartao,
  montarCorpoDoCartao,
} from "@/components/checkout/PagamentoComCartao";
import { dispararPagamentoPix } from "@/components/checkout/PagamentoOnline";
import {
  EMAIL_DE_TESTE_DO_MERCADO_PAGO,
  emailDeTesteDoMercadoPago,
} from "@/components/checkout/email-de-teste-do-mercado-pago";
import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

// Em produção a chave pública vem da ficha da loja, não do env; aqui ela é
// fixa para o teste isolar só a decisão do e-mail (chave fictícia de teste).
vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  chavePublicaMercadoPago: () => "TEST-000000-0000-0000-0000-000000000000",
}));

const LITERAL = "test@testuser.com";
const EMAIL_DO_CLIENTE = "cliente@exemplo.com";

const SO_CREDITO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 6,
};

function dadosDoBrick(email?: unknown) {
  return {
    token: "tok-ficticio",
    payment_method_id: "master",
    installments: 1,
    payer: {
      ...(email === undefined ? {} : { email }),
      identification: { type: "CPF", number: "123.456.789-09" },
    },
  };
}

function base(email?: unknown) {
  return {
    orderId: "ped-1",
    dados: dadosDoBrick(email),
    adicionais: { paymentTypeId: "credit_card" },
    config: SO_CREDITO,
  };
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  return create;
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
});

afterEach(() => {
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("emailDeTesteDoMercadoPago — liga só com DEV === true, modo development E o literal exato", () => {
  it("o literal exportado é o e-mail de teste da doc do Mercado Pago", () => {
    expect(EMAIL_DE_TESTE_DO_MERCADO_PAGO).toBe(LITERAL);
  });

  it("DEV true + literal exato liga", () => {
    expect(
      emailDeTesteDoMercadoPago({
        dev: true,
        modo: "development",
        valor: LITERAL,
      }),
    ).toBe(LITERAL);
  });

  it("produção (DEV false/ausente/'true' em texto) nunca liga, mesmo com o literal", () => {
    for (const dev of [false, undefined, null, "true", 1]) {
      expect(
        emailDeTesteDoMercadoPago({ dev, modo: "development", valor: LITERAL }),
      ).toBeNull();
    }
  });

  it("DEV com valor ausente, vazio, com espaço, outra caixa ou outro e-mail não liga", () => {
    for (const valor of [
      undefined,
      null,
      "",
      " test@testuser.com",
      "test@testuser.com ",
      "TEST@testuser.com",
      EMAIL_DO_CLIENTE,
      "test@testuser.com.br",
    ]) {
      expect(
        emailDeTesteDoMercadoPago({ dev: true, modo: "development", valor }),
      ).toBeNull();
    }
  });

  it("DEV true com modo que não é 'development' (build de produção com NODE_ENV=development, teste) não liga", () => {
    for (const modo of [
      "production",
      "test",
      "staging",
      undefined,
      "Development",
    ]) {
      expect(
        emailDeTesteDoMercadoPago({ dev: true, modo, valor: LITERAL }),
      ).toBeNull();
    }
  });

  it("lê o ambiente do build: DEV true + literal mas MODE production não liga", () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "production");
    expect(emailDeTesteDoMercadoPago()).toBeNull();
  });

  it("lê o ambiente do build: sem a variável, desligada", () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", undefined);
    expect(emailDeTesteDoMercadoPago()).toBeNull();
  });

  it("lê o ambiente do build: DEV + literal liga; PROD com o literal não liga", () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    expect(emailDeTesteDoMercadoPago()).toBe(LITERAL);
    vi.stubEnv("DEV", false);
    expect(emailDeTesteDoMercadoPago()).toBeNull();
  });
});

describe("montarCorpoDoCartao — ligada, o corpo leva o literal; desligada, nada muda", () => {
  it("ligada: callback com OUTRO e-mail → corpo.email === literal", () => {
    const r = montarCorpoDoCartao({
      ...base(EMAIL_DO_CLIENTE),
      emailDeTeste: LITERAL,
    });
    expect(r.ok && r.corpo.email === LITERAL).toBe(true);
  });

  it("ligada: callback SEM e-mail (omitido, vazio, não-texto) → corpo.email === literal", () => {
    for (const email of [undefined, "", "   ", 42, null]) {
      const r = montarCorpoDoCartao({ ...base(email), emailDeTeste: LITERAL });
      expect(r.ok && r.corpo.email === LITERAL).toBe(true);
    }
  });

  it("desligada: corpo idêntico ao do fluxo normal (e-mail do callback, ou sem a chave)", () => {
    const normal = montarCorpoDoCartao({
      ...base(EMAIL_DO_CLIENTE),
      emailDeTeste: null,
    });
    expect(normal.ok && normal.corpo.email === EMAIL_DO_CLIENTE).toBe(true);

    const semEmail = montarCorpoDoCartao({ ...base(), emailDeTeste: null });
    expect(semEmail.ok && !("email" in semEmail.corpo)).toBe(true);
  });

  it("ligada: só o e-mail muda — o resto do corpo é byte a byte o do fluxo normal", () => {
    const normal = montarCorpoDoCartao({
      ...base(EMAIL_DO_CLIENTE),
      emailDeTeste: null,
    });
    const teste = montarCorpoDoCartao({
      ...base(EMAIL_DO_CLIENTE),
      emailDeTeste: LITERAL,
    });
    if (!normal.ok || !teste.ok) throw new Error("montagem falhou");
    expect({ ...teste.corpo, email: EMAIL_DO_CLIENTE }).toEqual(normal.corpo);
  });

  it("ligada: a validação local continua igual (token ausente falha sem corpo)", () => {
    const r = montarCorpoDoCartao({
      ...base(EMAIL_DO_CLIENTE),
      dados: { ...dadosDoBrick(EMAIL_DO_CLIENTE), token: "" },
      emailDeTeste: LITERAL,
    });
    expect(r.ok).toBe(false);
  });

  it("sem injeção, PROD com o literal na variável → corpo com o e-mail do callback", () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", false);
    const r = montarCorpoDoCartao(base(EMAIL_DO_CLIENTE));
    expect(r.ok && r.corpo.email === EMAIL_DO_CLIENTE).toBe(true);
  });

  it("sem injeção, DEV com o literal na variável → corpo com o literal", () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    const r = montarCorpoDoCartao(base(EMAIL_DO_CLIENTE));
    expect(r.ok && r.corpo.email === LITERAL).toBe(true);
  });
});

describe("enviarPagamentoComCartao — o que chega ao POST", () => {
  it("DEV + literal: o POST de cartão recebe email === literal, mesmo com callback diferente", async () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    const criarPagamento = vi.fn(async () => ({
      status: "aguardando",
      paymentId: "ORD-1",
    }));
    await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(EMAIL_DO_CLIENTE),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento: criarPagamento as any,
    });
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    const corpo = (criarPagamento.mock.calls[0] as any[])[0];
    expect(corpo.email === LITERAL).toBe(true);
  });

  it("PROD com o literal na variável: o POST leva o e-mail normal do callback", async () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", false);
    const criarPagamento = vi.fn(async () => ({
      status: "aguardando",
      paymentId: "ORD-1",
    }));
    await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(EMAIL_DO_CLIENTE),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento: criarPagamento as any,
    });
    const corpo = (criarPagamento.mock.calls[0] as any[])[0];
    expect(corpo.email === EMAIL_DO_CLIENTE).toBe(true);
  });
});

describe("montarBrickDeCartao — o Brick nasce com o literal só com a opção ligada", () => {
  async function emailDoInitialization(emailDoPagador: string | null) {
    const create = instalarSdkFalso();
    const desmontar = montarBrickDeCartao({
      containerId: "mp-cartao-teste",
      valor: 11,
      config: SO_CREDITO,
      emailDoPagador,
      onEnviar: vi.fn(async () => {}),
      onFalhaDeMontagem: vi.fn(),
      onPronto: vi.fn(),
    });
    for (let i = 0; i < 5 && create.mock.calls.length === 0; i++) {
      await esperarMicrotarefas();
    }
    desmontar();
    const chamada = create.mock.calls.at(-1);
    if (!chamada) throw new Error("O Brick não foi criado.");
    return chamada[2].initialization.payer?.email;
  }

  it("DEV + literal: payer.email === literal (com ou sem e-mail da conta)", async () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    expect((await emailDoInitialization(EMAIL_DO_CLIENTE)) === LITERAL).toBe(
      true,
    );
    expect((await emailDoInitialization(null)) === LITERAL).toBe(true);
  });

  it("PROD com o literal: payer.email é o da conta; sem conta, sem payer", async () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", false);
    expect(
      (await emailDoInitialization(EMAIL_DO_CLIENTE)) === EMAIL_DO_CLIENTE,
    ).toBe(true);
    expect((await emailDoInitialization(null)) === undefined).toBe(true);
  });

  it("DEV sem a variável: payer.email é o da conta (fluxo normal)", async () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", undefined);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    expect(
      (await emailDoInitialization(EMAIL_DO_CLIENTE)) === EMAIL_DO_CLIENTE,
    ).toBe(true);
  });
});

describe("PIX não é tocado pela opção", () => {
  it("DEV + literal: o POST do PIX continua só { orderId, metodo: 'pix' }", async () => {
    vi.stubEnv("VITE_MP_TEST_PAYER_EMAIL", LITERAL);
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    const criarPagamento = vi.fn(async () => ({ status: "aguardando" }));
    const cancelar = dispararPagamentoPix({
      orderId: "ped-pix-email-teste",
      criarPagamento: criarPagamento as any,
      onErro: vi.fn(),
      onPix: vi.fn(),
    });
    await esperarMicrotarefas();
    cancelar();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect((criarPagamento.mock.calls[0] as any[])[0]).toEqual({
      orderId: "ped-pix-email-teste",
      metodo: "pix",
    });
  });
});
