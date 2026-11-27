// @vitest-environment jsdom
//
// Caça de leitor de tela (27/11/2026): enquanto o cartão vai ao banco, o app
// não dizia nada — o contador de envios em curso só aparecia noutro aviso
// (pedido que deixou de aguardar pagamento). Agora uma região falada, sempre
// montada, diz "Enviando pagamento ao banco…" enquanto houver envio e esvazia
// ao terminar. Andaime de pagamento-com-cartao.test.tsx (SDK falso em
// `globalThis`, `criarPagamento` como dublê do `useOrders`).
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

function regiaoDoEnvio(): HTMLElement {
  const regiao = hospedeiro.querySelector<HTMLElement>(
    '[data-testid="aviso-do-envio-do-cartao"]',
  );
  expect(regiao).not.toBeNull();
  expect(regiao!.getAttribute("role")).toBe("status");
  return regiao!;
}

describe("PagamentoComCartao — o envio ao banco é falado", () => {
  it("a região existe vazia, diz 'Enviando pagamento ao banco…' durante o envio e esvazia ao terminar", async () => {
    const create = instalarSdkFalso();
    let responder: (erro: unknown) => void = () => {};
    criarPagamento.mockReturnValue(
      new Promise((_, reject) => {
        responder = reject;
      }),
    );
    await act(async () => {
      raiz.render(
        <PagamentoComCartao
          orderId="ped-envio-1"
          valor={150}
          config={{ credito: true, debito: false, parcelasMax: 6 }}
          emailDoPagador="cliente@exemplo.com"
          onErro={vi.fn()}
          onPagarComPix={vi.fn()}
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
    expect(regiaoDoEnvio().textContent).toBe("");

    let envio: Promise<unknown> = Promise.resolve();
    await act(async () => {
      envio = callbacks
        .onSubmit(
          {
            token: "tok-de-teste",
            issuer_id: "25",
            payment_method_id: "master",
            transaction_amount: 150,
            installments: 1,
            payer: {
              email: "cliente@exemplo.com",
              identification: { type: "CPF", number: "11144477735" },
            },
          },
          { paymentTypeId: "credit_card" },
        )
        .catch(() => {});
      await esperarMicrotarefas();
    });
    expect(regiaoDoEnvio().textContent).toBe("Enviando pagamento ao banco…");

    await act(async () => {
      responder(new Error("rede caiu"));
      await envio;
      await esperarMicrotarefas();
    });
    expect(regiaoDoEnvio().textContent).toBe("");
  });
});
