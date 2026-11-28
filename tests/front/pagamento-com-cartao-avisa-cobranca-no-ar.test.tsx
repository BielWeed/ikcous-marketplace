// @vitest-environment jsdom
//
// Caça "voltar do navegador" (27/11/2026): com o cartão sendo cobrado, o
// Voltar do celular saía da tela calado — a tela do cartão desmontava, a
// resposta do banco era descartada (`montadoRef`) e a cliente não sabia se
// tinha pago. Quem segura o Voltar é o CheckoutView, e ele só sabe que há
// cobrança no ar se a tela do cartão AVISAR: `onCartaoNoAr(true)` quando o
// envio sai, `onCartaoNoAr(false)` quando a resposta chega (qualquer uma) ou
// quando a tela desmonta com o envio ainda no ar. Andaime de
// pagamento-com-cartao-fala-enquanto-envia.test.tsx.
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

import { PagamentoComCartao } from "@/components/checkout/PagamentoComCartao";
import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";

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

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
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
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const DADOS_DO_CARTAO = {
  token: "tok-de-teste",
  issuer_id: "25",
  payment_method_id: "master",
  transaction_amount: 150,
  installments: 1,
  payer: {
    email: "cliente@exemplo.com",
    identification: { type: "CPF", number: "11144477735" },
  },
};

// Devolve o envio DENTRO de um objeto: uma Promise devolvida direto por
// função `async` seria esperada por quem chama — e ela só resolve com a
// resposta do banco, que o teste segura de propósito.
async function montarEEnviar(
  onCartaoNoAr: (noAr: boolean) => void,
): Promise<{ envio: Promise<unknown> }> {
  const create = instalarSdkFalso();
  await act(async () => {
    raiz.render(
      <PagamentoComCartao
        orderId="ped-no-ar-1"
        valor={150}
        config={{ credito: true, debito: false, parcelasMax: 6 }}
        emailDoPagador="cliente@exemplo.com"
        onErro={vi.fn()}
        onPagarComPix={vi.fn()}
        onCartaoNoAr={onCartaoNoAr}
      />,
    );
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
  const { callbacks } = create.mock.calls.at(-1)![2];
  await act(async () => {
    callbacks.onReady();
  });
  // Antes de qualquer envio, nada no ar: o pai não ouviu `true`.
  expect(onCartaoNoAr).not.toHaveBeenCalledWith(true);

  let envio: Promise<unknown> = Promise.resolve();
  await act(async () => {
    envio = callbacks
      .onSubmit(DADOS_DO_CARTAO, { paymentTypeId: "credit_card" })
      .catch(() => {});
    await esperarMicrotarefas();
  });
  return { envio };
}

describe("PagamentoComCartao — avisa o pai enquanto o cartão está sendo cobrado", () => {
  it("liga ao enviar e desliga quando a resposta (mesmo de erro) chega", async () => {
    let recusar: (erro: unknown) => void = () => {};
    criarPagamento.mockReturnValue(
      new Promise((_, reject) => {
        recusar = reject;
      }),
    );
    const onCartaoNoAr = vi.fn();
    const { envio } = await montarEEnviar(onCartaoNoAr);

    expect(onCartaoNoAr.mock.calls.at(-1)).toEqual([true]);

    await act(async () => {
      recusar(new Error("rede caiu"));
      await envio;
      await esperarMicrotarefas();
    });
    expect(onCartaoNoAr.mock.calls.at(-1)).toEqual([false]);
  });

  it("desmontar com o envio no ar desliga o aviso (a bandeira nunca fica presa)", async () => {
    // Resposta que nunca chega: só o desmonte pode soltar.
    criarPagamento.mockReturnValue(new Promise(() => {}));
    const onCartaoNoAr = vi.fn();
    await montarEEnviar(onCartaoNoAr);
    expect(onCartaoNoAr.mock.calls.at(-1)).toEqual([true]);

    act(() => {
      raiz.render(<div />);
    });
    expect(onCartaoNoAr.mock.calls.at(-1)).toEqual([false]);
  });
});
