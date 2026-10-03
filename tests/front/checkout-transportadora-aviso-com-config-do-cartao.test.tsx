// @vitest-environment jsdom
//
// O aviso do frete por transportadora ("Envio por transportadora exige
// pagamento antecipado — …") dizia "só oferecemos o PIX no app aqui" também
// enquanto a config do cartão AINDA CARREGAVA ou quando a leitura FALHOU: uma
// afirmação sobre as formas disponíveis feita antes de o checkout saber quais
// são. Agora, em `carregando` e `erro` a redação é NEUTRA (não afirma "só PIX"
// nem que o cartão existe); em `pronto` continua a de sempre — "pagamento pelo
// app" com o cartão ligado, "o PIX no app" com ele desligado de verdade. Só o
// TEXTO muda: nenhuma regra de frete ou de formas.
//
// Montagem copiada de checkout-view-cartao-online.test.tsx; o hook é dublê
// (estados estáveis de duble-use-config-do-cartao.ts) e o aviso é localizado
// pelo texto visível.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstadoDaConfigDoCartao } from "@/hooks/useConfigDoCartao";
import { ESTADO_CARREGANDO, estadoPronto } from "./duble-use-config-do-cartao";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-777" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [
      {
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
      },
    ],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

let mockUser: { id: string; email?: string } | null = {
  id: "user-1",
  email: "cliente@exemplo.com",
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const item = () => ({
  product: {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  },
  quantity: 1,
});

let mockCart = [item()];
let mockCartTotal = 100;
let mockShippingFee = 20;
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      clearCart: () => {
        mockCart = [];
        mockCartTotal = 0;
        mockShippingFee = 0;
        mockSelectedShippingOption = null;
      },
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: null,
      setSelectedShippingOption: (opt: typeof mockSelectedShippingOption) => {
        mockSelectedShippingOption = opt;
      },
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

let estadoDoCartao: EstadoDaConfigDoCartao = ESTADO_CARREGANDO;
vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => estadoDoCartao,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ESTADO_ERRO: EstadoDaConfigDoCartao = Object.freeze({
  estado: "erro",
  tentarDeNovo: () => {},
});
const CARTAO_LIGADO = { credito: true, debito: true, parcelasMax: 6 };

const TRANSPORTADORA = {
  id: "pac",
  name: "PAC",
  price: 30,
  deliveryDays: 5,
  provider: "correios",
};

const NEUTRO =
  "Envio por transportadora exige pagamento antecipado — as formas de pagamento disponíveis aparecem abaixo.";
const COM_CARTAO =
  "Envio por transportadora exige pagamento antecipado — por isso só oferecemos o pagamento pelo app aqui.";
const SO_PIX =
  "Envio por transportadora exige pagamento antecipado — por isso só oferecemos o PIX no app aqui.";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** O aviso, localizado pelo que ele diz — não por classe nem posição. */
function textoDoAviso(): string | undefined {
  return [...document.body.querySelectorAll("p")]
    .map((p) => p.textContent ?? "")
    .find((texto) => texto.includes("Envio por transportadora exige"));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () => {
    raiz.render(
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — aviso do frete por transportadora acompanha o estado da config do cartão", () => {
  beforeEach(() => {
    createOrder.mockReset();
    onNavigate.mockClear();
    mockUser = { id: "user-1", email: "cliente@exemplo.com" };
    mockCart = [item()];
    mockCartTotal = 100;
    mockShippingFee = 30;
    mockSelectedShippingOption = { ...TRANSPORTADORA };
    estadoDoCartao = ESTADO_CARREGANDO;
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("config CARREGANDO: redação neutra — não afirma 'só PIX' nem que o cartão existe", async () => {
    estadoDoCartao = ESTADO_CARREGANDO;
    await montar();

    expect(textoDoAviso()).toBe(NEUTRO);
  });

  it("config em ERRO: a mesma redação neutra", async () => {
    estadoDoCartao = ESTADO_ERRO;
    await montar();

    expect(textoDoAviso()).toBe(NEUTRO);
  });

  it("config PRONTA com cartão ligado: 'pagamento pelo app' (o que já dizia)", async () => {
    estadoDoCartao = estadoPronto(CARTAO_LIGADO);
    await montar();

    expect(textoDoAviso()).toBe(COM_CARTAO);
  });

  it("config PRONTA com cartão desligado de verdade: 'o PIX no app' (o que já dizia)", async () => {
    estadoDoCartao = estadoPronto(null);
    await montar();

    expect(textoDoAviso()).toBe(SO_PIX);
  });

  it("a regra não mudou: com transportadora o grupo 'Na entrega' continua fora em todos os estados", async () => {
    for (const estado of [
      ESTADO_CARREGANDO,
      ESTADO_ERRO,
      estadoPronto(CARTAO_LIGADO),
      estadoPronto(null),
    ]) {
      estadoDoCartao = estado;
      await montar();
      expect(hospedeiro.textContent).not.toContain("Na entrega");
      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
    }
  });
});
