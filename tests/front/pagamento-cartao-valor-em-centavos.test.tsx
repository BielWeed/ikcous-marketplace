// @vitest-environment jsdom
import {
  PagamentoComCartao,
  montarBrickDeCartao,
} from "@/components/checkout/PagamentoComCartao";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));
vi.mock("@/components/checkout/sdk-mercado-pago", () => ({
  carregarSdkMercadoPago: async () => {},
}));
vi.mock("@/components/checkout/device-id-mercado-pago", () => ({
  carregarDeviceIdMercadoPago: () => {},
  lerDeviceIdDoMercadoPago: () => null,
  deviceIdValido: () => false,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const config = { credito: true, debito: false, parcelasMax: 3 };
const criarBrick = vi.fn(
  async (
    _tipo: string,
    _container: string,
    _opcoes: { initialization: { amount: number } },
  ) => ({ unmount: vi.fn() }),
);

describe("cartão recebe e exibe o valor arredondado do pedido", () => {
  beforeEach(() => {
    criarBrick.mockClear();
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    vi.stubGlobal(
      "MercadoPago",
      class {
        bricks() {
          return { create: criarBrick };
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("inicializa o SDK com 9,60 quando o cupom deixa 9,594999999999999", async () => {
    const limpar = montarBrickDeCartao({
      containerId: "brick-centavos",
      valor: 10.1 - 0.505,
      config,
      emailDoPagador: null,
      onEnviar: async () => {},
      onPronto: () => {},
      onFalhaDeMontagem: () => {},
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(criarBrick.mock.calls.at(-1)?.[2].initialization.amount).toBe(9.6);
    } finally {
      limpar();
    }
  });

  it("o cabeçalho exibe os mesmos 9,60 que o SDK recebe", async () => {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    try {
      await act(async () => {
        raiz.render(
          <PagamentoComCartao
            orderId="ped-centavos"
            valor={10.1 - 0.505}
            config={config}
            onErro={() => {}}
            onPagarComPix={() => {}}
          />,
        );
      });
      expect(
        hospedeiro.querySelector("header")?.textContent?.replace(/\s/g, ""),
      ).toContain("R$9,60");
    } finally {
      await act(async () => raiz.unmount());
      hospedeiro.remove();
    }
  });
});
