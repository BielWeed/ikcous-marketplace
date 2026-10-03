// @vitest-environment jsdom
//
// DEVICE ID NO CARTÃO (03/10/2026). Um pagamento real com cartão foi recusado
// pelo antifraude do Mercado Pago (`high_risk`) porque o Device ID do comprador
// nunca chegava. O `security.js` do MP cria `window.MP_DEVICE_SESSION_ID`; a
// tela do cartão (1) carrega esse script UMA vez, só quando monta o Brick,
// (2) lê o valor no instante do envio, valida o formato e o manda como
// `device_id` para a edge `criar-pagamento`, e (3) NUNCA deixa a falta dele
// travar o pagamento. Mesmo andaime de pagamento-com-cartao.test.tsx.
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
  enviarPagamentoComCartao,
  montarBrickDeCartao,
  montarCorpoDoCartao,
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

const ID_REAL = "armor.8c1f0e2b9d7a4c35b6e1f0a9d8c7b6a5.XyZ123abc.9f8e7d6c5b4a";

function dadosDoBrick() {
  return {
    token: "tok-secreto-123",
    payment_method_id: "master",
    installments: 3,
    payer: {
      email: "cliente@exemplo.com",
      identification: { type: "CPF", number: "123.456.789-09" },
    },
  };
}

function tagsDoDevice(): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[data-mp-device-id]"),
  );
}

function instalarSdkFalso() {
  const create = vi.fn(
    async (_brick: string, _container: string, _config: any) => ({
      unmount: vi.fn(),
    }),
  );
  const MercadoPagoSpy = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = MercadoPagoSpy;
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
  for (const tag of tagsDoDevice()) tag.remove();
  Reflect.deleteProperty(globalThis, "MP_DEVICE_SESSION_ID");
});

afterEach(() => {
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  Reflect.deleteProperty(globalThis, "MP_DEVICE_SESSION_ID");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("montarCorpoDoCartao — o device_id só entra se for do formato fechado", () => {
  const base = {
    orderId: "ped-1",
    dados: dadosDoBrick(),
    adicionais: { paymentTypeId: "credit_card" },
    config: SO_CREDITO,
  };

  it("deviceId válido vai no corpo como device_id (snake_case, o campo que a edge lê)", () => {
    const r = montarCorpoDoCartao({ ...base, deviceId: ID_REAL });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.corpo.device_id).toBe(ID_REAL);
  });

  it("sem deviceId (coleta atrasada, script bloqueado) o corpo sai SEM a chave — nem undefined, nem vazio", () => {
    for (const deviceId of [undefined, null]) {
      const r = montarCorpoDoCartao({ ...base, deviceId });
      expect(r.ok).toBe(true);
      if (r.ok) expect("device_id" in r.corpo).toBe(false);
    }
    const semArgumento = montarCorpoDoCartao(base);
    expect(semArgumento.ok).toBe(true);
    if (semArgumento.ok) expect("device_id" in semArgumento.corpo).toBe(false);
  });

  it("deviceId fora do formato é DESCARTADO (não bloqueia o pagamento, não repassa lixo)", () => {
    for (const ruim of [
      "",
      "com espaço",
      "abc\r\nX-Evil: 1",
      "x".repeat(513),
    ]) {
      const r = montarCorpoDoCartao({ ...base, deviceId: ruim });
      expect(r.ok).toBe(true);
      if (r.ok) expect("device_id" in r.corpo).toBe(false);
    }
  });
});

describe("enviarPagamentoComCartao — o device_id chega na edge e a falta dele não impede a cobrança", () => {
  it("com deviceId: criarPagamento recebe device_id no corpo", async () => {
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    const r = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento,
      deviceId: ID_REAL,
    });
    expect(r.tipo).toBe("aprovado");
    expect(criarPagamento.mock.calls[0][0]).toMatchObject({
      orderId: "ped-1",
      metodo: "cartao",
      device_id: ID_REAL,
    });
  });

  it("sem deviceId: a cobrança sai igual, sem o campo", async () => {
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    const r = await enviarPagamentoComCartao({
      orderId: "ped-1",
      dados: dadosDoBrick(),
      adicionais: { paymentTypeId: "credit_card" },
      config: SO_CREDITO,
      criarPagamento,
    });
    expect(r.tipo).toBe("aprovado");
    expect("device_id" in criarPagamento.mock.calls[0][0]).toBe(false);
  });
});

describe("montarBrickDeCartao — o security.js entra junto do Brick, uma vez, e nunca o derruba", () => {
  function opcoes(): Parameters<typeof montarBrickDeCartao>[0] {
    return {
      containerId: "mp-cartao-teste",
      valor: 150,
      config: SO_CREDITO,
      emailDoPagador: "cliente@exemplo.com",
      onEnviar: vi.fn(async () => {}),
      onFalhaDeMontagem: vi.fn(),
      onPronto: vi.fn(),
    };
  }

  it("ao montar o Brick, carrega o security.js (view=checkout) — e o Brick é criado normalmente", async () => {
    const { create } = instalarSdkFalso();
    expect(tagsDoDevice()).toHaveLength(0);

    const o = opcoes();
    montarBrickDeCartao(o);
    await esperarMicrotarefas();

    expect(tagsDoDevice()).toHaveLength(1);
    const [tag] = tagsDoDevice();
    expect(tag.getAttribute("src")).toBe(
      "https://www.mercadopago.com/v2/security.js",
    );
    expect(tag.getAttribute("view")).toBe("checkout");
    expect(create).toHaveBeenCalledTimes(1);
    expect(o.onFalhaDeMontagem).not.toHaveBeenCalled();
  });

  it("montar de novo (StrictMode, Tentar outro cartão) NÃO duplica o script", async () => {
    instalarSdkFalso();
    const o = opcoes();
    const limpar1 = montarBrickDeCartao(o);
    limpar1();
    const limpar2 = montarBrickDeCartao(o);
    await esperarMicrotarefas();
    const limpar3 = montarBrickDeCartao(o);
    await esperarMicrotarefas();

    expect(tagsDoDevice()).toHaveLength(1);
    limpar2();
    limpar3();
  });

  it("security.js que FALHA ao carregar não quebra o Brick: ele monta, fica pronto e a falha de montagem NÃO dispara", async () => {
    const { create } = instalarSdkFalso();
    const o = opcoes();
    montarBrickDeCartao(o);
    await esperarMicrotarefas();

    expect(() =>
      tagsDoDevice()[0].dispatchEvent(new Event("error")),
    ).not.toThrow();
    await esperarMicrotarefas();

    expect(create).toHaveBeenCalledTimes(1);
    ultimaConfig(create).callbacks.onReady();
    expect(o.onPronto).toHaveBeenCalledTimes(1);
    expect(o.onFalhaDeMontagem).not.toHaveBeenCalled();
  });
});

describe("PagamentoOnline — só o cartão carrega o security.js e manda o device_id", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

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

  async function renderCartao() {
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-12345678"
          valor={150}
          metodo="cartao"
          configDoCartao={SO_CREDITO}
          emailDoPagador="cliente@exemplo.com"
          onErro={vi.fn()}
          onTrocarParaPix={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function enviar(create: ReturnType<typeof instalarSdkFalso>["create"]) {
    const { callbacks } = ultimaConfig(create);
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      await callbacks.onSubmit(dadosDoBrick(), {
        paymentTypeId: "credit_card",
      });
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("o Device ID que o security.js já criou vai no corpo do POST do cartão", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    await renderCartao();
    expect(tagsDoDevice()).toHaveLength(1);

    // O script do MP terminou a coleta ENQUANTO o cliente digitava.
    Reflect.set(globalThis, "MP_DEVICE_SESSION_ID", ID_REAL);
    await enviar(create);

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toMatchObject({
      orderId: "ped-12345678",
      metodo: "cartao",
      device_id: ID_REAL,
    });
  });

  it("o valor é lido NO ENVIO, não na montagem: criado depois de montar o Brick, ainda assim vai", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    await renderCartao();
    // Na montagem ainda não existia.
    expect(
      (globalThis as { MP_DEVICE_SESSION_ID?: unknown }).MP_DEVICE_SESSION_ID,
    ).toBeUndefined();
    Reflect.set(globalThis, "MP_DEVICE_SESSION_ID", ID_REAL);
    await enviar(create);

    expect(criarPagamento.mock.calls[0][0].device_id).toBe(ID_REAL);
  });

  it("sem Device ID (a coleta não terminou ou o script foi bloqueado) o pagamento SEGUE, sem o campo", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    await renderCartao();
    await enviar(create);

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect("device_id" in criarPagamento.mock.calls[0][0]).toBe(false);
    expect(hospedeiro.textContent).toContain(
      "Pagamento aprovado! Confirmando seu pedido…",
    );
  });

  it("Device ID com cara de lixo no global NÃO vai para a edge, e o pagamento segue", async () => {
    const { create } = instalarSdkFalso();
    criarPagamento.mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "pago",
      expiraEm: "x",
    });
    await renderCartao();
    Reflect.set(globalThis, "MP_DEVICE_SESSION_ID", "com espaço\r\nX-Evil: 1");
    await enviar(create);

    expect("device_id" in criarPagamento.mock.calls[0][0]).toBe(false);
    expect(hospedeiro.textContent).toContain(
      "Pagamento aprovado! Confirmando seu pedido…",
    );
  });

  it("PIX NÃO carrega o security.js", async () => {
    criarPagamento.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId="ped-12345678"
          valor={150}
          metodo="pix"
          onErro={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: "ped-12345678",
      metodo: "pix",
    });
    expect(tagsDoDevice()).toHaveLength(0);
  });
});
