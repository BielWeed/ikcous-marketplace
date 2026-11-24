// @vitest-environment jsdom

import { CheckoutView } from "@/views/customer/CheckoutView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const validateCoupon = vi.fn();
const sessaoAindaEhDoDono = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const entrega = {
  id: "local-delivery",
  name: "Entrega local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};
const endereco = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "38500-000",
  street: "Rua Teste",
  number: "100",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  is_default: true,
};
const enderecos = [endereco];
const usuario = { id: "user-1" };
let total = 76.5;
let formas: string[];
let cuponsLigados = false;
let opcaoDeFrete = entrega;

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () => sessaoAindaEhDoDono(),
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: cuponsLigados,
      formasPagamentoEntrega: formas,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: enderecos,
      loading: false,
    }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
            id: "prod-1",
            name: "Produto Teste",
            price: total,
            images: [],
            stock: 10,
          },
          quantity: 1,
        },
      ],
      cartTotal: total,
      shippingFee: opcaoDeFrete.price,
      selectedShippingOption: opcaoDeFrete,
      shippingCep: endereco.cep,
      clearCart: vi.fn(),
      renovarCarrinhoPeloCatalogo: async () => {},
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOrders")>()),
  useOrders: () => ({ createOrder }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(campo: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(campo),
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const AVISO_SEM_VALOR =
  "Informe um valor em reais para o troco, com até 9 dígitos antes dos centavos.";
const AVISO_NAO_COBRE = "Informe um valor maior que o total do pedido.";

describe("CheckoutView — limites do valor do troco (mensagem, centavos e formato)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const campo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#checkout-valor-para-troco")!;
  const aviso = () => hospedeiro.querySelector("#checkout-aviso-troco")!;
  const escolha = (valor: string) =>
    hospedeiro.querySelector<HTMLInputElement>(
      `input[name="checkout-troco"][value="${valor}"]`,
    )!;
  const botao = (texto: string, dentroDe: ParentNode = hospedeiro) =>
    [...dentroDe.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    )!;
  const finalizar = () => botao("Finalizar Pedido", document.body);

  beforeEach(() => {
    onNavigate.mockClear();
    total = 76.5;
    formas = ["pix", "cash"];
    cuponsLigados = false;
    opcaoDeFrete = entrega;
    validateCoupon.mockReset().mockResolvedValue({ valid: true, discount: 0 });
    createOrder.mockReset().mockResolvedValue({ id: "ped-1" });
    sessaoAindaEhDoDono.mockReset().mockResolvedValue(true);
    vi.stubGlobal("scrollTo", vi.fn());
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montarComTroco(valor: string) {
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#checkout-name")!,
        "Cliente Teste",
      );
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#checkout-tel")!,
        "34999999999",
      );
      await vi.advanceTimersByTimeAsync(420);
    });
    act(() => botao("Dinheiro na Entrega").click());
    act(() => escolha("sim").click());
    act(() => digitar(campo(), valor));
  }

  async function enviar() {
    expect(finalizar().disabled).toBe(false);
    await act(async () => {
      finalizar().click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    return createOrder.mock.calls[0][0];
  }

  // Cada recusa tem a SUA frase: "falta informar" não é "não cobre o total".
  // Sem checar o texto exato, trocar uma pela outra passava despercebido.
  it.each([
    ["", AVISO_SEM_VALOR],
    ["0", AVISO_SEM_VALOR],
    ["0,00", AVISO_SEM_VALOR],
    ["abc", AVISO_SEM_VALOR],
    ["1.0000", AVISO_SEM_VALOR],
    ["10.00.000", AVISO_SEM_VALOR],
    ["50", AVISO_NAO_COBRE],
    ["76,49", AVISO_NAO_COBRE],
    ["76,50", AVISO_NAO_COBRE],
  ])(
    "valor %j recusa com a frase certa e sem criar pedido",
    async (valor, frase) => {
      await montarComTroco(valor);
      expect(aviso().textContent).toBe(frase);
      expect(campo().getAttribute("aria-invalid")).toBe("true");
      expect(finalizar().disabled).toBe(true);
      act(() => finalizar().click());
      expect(createOrder).not.toHaveBeenCalled();
    },
  );

  it("um centavo acima do total já é troco válido (a fronteira é estrita)", async () => {
    await montarComTroco("76,51");
    expect(aviso().textContent).toBe("");
    expect(campo().getAttribute("aria-invalid")).toBe("false");
    const pedido = await enviar();
    expect(pedido.notes.split("\n")[0]).toBe(
      "Troco para R$ 76,51 (levar R$ 0,01)",
    );
  });

  // 1,15 x 100 = 114.99999999999999 em ponto flutuante: sem arredondar, o
  // total viraria 114 centavos e "1,15" passaria como troco de R$ 0,01.
  it.each([
    [1.15, "1,15", "1,16", "Troco para R$ 1,16 (levar R$ 0,01)"],
    [4.35, "4,35", "4,36", "Troco para R$ 4,36 (levar R$ 0,01)"],
  ])(
    "total %s: dinheiro exato (%s) é recusado, um centavo a mais (%s) é aceito",
    async (preco, exato, acima, prefixo) => {
      total = preco;
      await montarComTroco(exato);
      expect(aviso().textContent).toBe(AVISO_NAO_COBRE);
      expect(finalizar().disabled).toBe(true);
      act(() => digitar(campo(), acima));
      expect(aviso().textContent).toBe("");
      const pedido = await enviar();
      expect(pedido.notes.split("\n")[0]).toBe(prefixo);
    },
  );

  it.each([
    ["999999999", "Troco para R$ 999.999.999,00 (levar R$ 999.999.922,50)"],
    [
      "999.999.999,99",
      "Troco para R$ 999.999.999,99 (levar R$ 999.999.923,49)",
    ],
    ["1.000.000,00", "Troco para R$ 1.000.000,00 (levar R$ 999.923,50)"],
    ["1.000", "Troco para R$ 1.000,00 (levar R$ 923,50)"],
    ["  100  ", "Troco para R$ 100,00 (levar R$ 23,50)"],
    ["r$ 100", "Troco para R$ 100,00 (levar R$ 23,50)"],
    ["R$100,5", "Troco para R$ 100,50 (levar R$ 24,00)"],
  ])("aceita %j e manda a nota %j", async (valor, prefixo) => {
    await montarComTroco(valor);
    expect(aviso().textContent).toBe("");
    const pedido = await enviar();
    expect(pedido.notes.split("\n")[0]).toBe(prefixo);
  });

  it("sem troco pedido, o botão e a nota ficam como estão (Não é o padrão)", async () => {
    await montarComTroco("100");
    act(() => escolha("nao").click());
    expect(aviso().textContent).toBe("");
    const pedido = await enviar();
    expect(pedido.notes ?? "").not.toContain("Troco para");
  });
});
