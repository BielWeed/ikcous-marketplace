// @vitest-environment jsdom
//
// "COMO ENTREGO NA MINHA CIDADE" (16/10/2026) × a regra do convidado.
//
// A regra do convidado (30/08/2026): "entrega fora da cidade é só com
// conta". Em "Só retiro" a retirada vale para QUALQUER CEP — quem retira na
// loja não recebe nada em outra cidade, então não há o que acompanhar por
// conta — e a RPC do pedido já aceita o convidado nesse caso
// (`v_retirada_livre`). Sem esta mudança, o convidado de outra cidade veria
// "Entrega fora da cidade é só com conta" e ficaria travado diante de uma
// loja que só trabalha com retirada.
//
// O que este arquivo prova, no CheckoutView DE VERDADE (a barra com o aviso
// e o botão renderiza via portal):
//   - só retiro + retirada MARCADA + CEP de fora: sem aviso (o convidado
//     compra);
//   - só retiro SEM a retirada marcada (nada, "Entrega Local" velha vinda de
//     app/cache, transportadora): o aviso e o bloqueio continuam — nada é
//     escolhido sozinho e nada fica liberado por acidente;
//   - nos outros dois modos a retirada NUNCA libera o convidado de fora;
//   - CEP local: nenhum aviso em nenhum modo (como sempre foi);
//   - logada: nunca vê o aviso (controle — ver o comentário do caso).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig, mockCarrinho, mockAuth } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national",
    originCep: "38500-000",
  } as Record<string, unknown>,
  mockCarrinho: { selectedShippingOption: null as unknown },
  mockAuth: { user: null as unknown },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockAuth.user, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
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
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    freteIndefinido: false,
    clearCart: vi.fn(),
    selectedShippingOption: mockCarrinho.selectedShippingOption,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O texto da tela usa espaço não separável em alguns pontos.
const NBSP = String.fromCharCode(160);
const AVISO = "Entrega fora da cidade é só com conta";
const CEP_DE_FORA = "01310100";
const CEP_LOCAL = "38500000";

const OPCAO = {
  retirada: {
    id: "store-pickup",
    name: "Retirar na loja",
    price: 0,
    deliveryDays: 0,
    provider: "pickup",
    pickupAddress: "Rua Fictícia de Teste, 100 — Centro",
  },
  // A oferta "Entrega Local" que um app/cache antigo ainda carrega.
  entregaLocalVelha: {
    id: "local-delivery",
    name: "Entrega Local",
    price: 10,
    deliveryDays: 1,
    provider: "local",
  },
  transportadora: {
    id: "melhor-envio-1",
    name: "PAC",
    price: 25,
    deliveryDays: 5,
    provider: "melhor_envio",
  },
};

const MODO = {
  entrego: {
    localDeliveryEnabled: true,
    enabledShippingMethods: ["sedex", "pac"],
  },
  entregoERetiro: {
    localDeliveryEnabled: true,
    enabledShippingMethods: ["sedex", "pac", "store-pickup"],
  },
  soRetiro: {
    localDeliveryEnabled: false,
    enabledShippingMethods: ["sedex", "pac", "store-pickup"],
  },
};

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoFinalizar(): HTMLButtonElement {
  const botao = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement;
  expect(botao).toBeDefined();
  return botao;
}

describe("CheckoutView (convidado) × só retiro — a trava de 'fora da cidade'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
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
    for (const chave of Object.keys(mockConfig)) {
      Reflect.deleteProperty(mockConfig, chave);
    }
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
    });
    mockCarrinho.selectedShippingOption = null;
    mockAuth.user = null;
  });

  async function cenario(args: {
    modo: Record<string, unknown>;
    opcao: unknown;
    cep: string;
  }) {
    Object.assign(mockConfig, args.modo);
    mockCarrinho.selectedShippingOption = args.opcao;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    act(() => {
      digitar("guest-cep", args.cep);
    });
    // A barra renderiza via PORTAL com atraso proposital (useDeferredRender).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    return (document.body.textContent ?? "").replaceAll(NBSP, " ");
  }

  it("SÓ RETIRO + retirada marcada + CEP de fora: o aviso some (o convidado compra)", async () => {
    const texto = await cenario({
      modo: MODO.soRetiro,
      opcao: OPCAO.retirada,
      cep: CEP_DE_FORA,
    });
    expect(texto).not.toContain(AVISO);
  });

  it("SÓ RETIRO sem nenhuma opção marcada + CEP de fora: aviso e bloqueio continuam (nada é escolhido sozinho)", async () => {
    const texto = await cenario({
      modo: MODO.soRetiro,
      opcao: null,
      cep: CEP_DE_FORA,
    });
    expect(texto).toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("SÓ RETIRO com a 'Entrega Local' VELHA marcada (app/cache antigo) + CEP de fora: continua barrado", async () => {
    const texto = await cenario({
      modo: MODO.soRetiro,
      opcao: OPCAO.entregaLocalVelha,
      cep: CEP_DE_FORA,
    });
    expect(texto).toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("SÓ RETIRO com transportadora marcada + CEP de fora: continua barrado (a retirada é que libera, não o modo sozinho)", async () => {
    const texto = await cenario({
      modo: MODO.soRetiro,
      opcao: OPCAO.transportadora,
      cep: CEP_DE_FORA,
    });
    expect(texto).toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("ENTREGO E RETIRO + retirada marcada + CEP de fora: a retirada NÃO libera (a edge nem a oferece fora da área local)", async () => {
    const texto = await cenario({
      modo: MODO.entregoERetiro,
      opcao: OPCAO.retirada,
      cep: CEP_DE_FORA,
    });
    expect(texto).toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("ENTREGO + sem opção + CEP de fora: como sempre foi (aviso e bloqueio)", async () => {
    const texto = await cenario({
      modo: MODO.entrego,
      opcao: null,
      cep: CEP_DE_FORA,
    });
    expect(texto).toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("loja SEM as colunas novas (banco antigo: campos ausentes) + retirada marcada + CEP de fora: o padrão de hoje, barrado", async () => {
    const texto = await cenario({
      modo: { enabledShippingMethods: ["sedex", "pac", "store-pickup"] },
      opcao: OPCAO.retirada,
      cep: CEP_DE_FORA,
    });
    expect(texto).toContain(AVISO);
  });

  it("SÓ RETIRO + retirada marcada + CEP LOCAL: sem aviso", async () => {
    const texto = await cenario({
      modo: MODO.soRetiro,
      opcao: OPCAO.retirada,
      cep: CEP_LOCAL,
    });
    expect(texto).not.toContain(AVISO);
  });

  it("ENTREGO + Entrega Local + CEP LOCAL: sem aviso (como sempre foi)", async () => {
    const texto = await cenario({
      modo: MODO.entrego,
      opcao: OPCAO.entregaLocalVelha,
      cep: CEP_LOCAL,
    });
    expect(texto).not.toContain(AVISO);
  });

  // O aviso sumir não prova que o convidado COMPRA: o botão pode estar
  // apagado por outro motivo (formulário incompleto). Aqui o formulário vai
  // todo preenchido — então o Finalizar só pode estar apagado pela regra do
  // convidado, e a diferença entre os dois modos é a prova de que a trava
  // saiu do caminho dele (e só dele).
  async function cenarioComFormularioCompleto(args: {
    modo: Record<string, unknown>;
    opcao: unknown;
  }) {
    Object.assign(mockConfig, args.modo);
    mockCarrinho.selectedShippingOption = args.opcao;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    const micro = () => new Promise((r) => setTimeout(r, 0));
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await micro();
      await micro();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await micro();
    });
    await act(async () => {
      digitar("guest-city", "Cidade Teste");
      await micro();
    });
    await act(async () => {
      digitar("guest-state", "SP");
      await micro();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
    return (document.body.textContent ?? "").replaceAll(NBSP, " ");
  }

  it("COM O FORMULÁRIO COMPLETO: só retiro + retirada marcada + CEP de fora = Finalizar LIBERADO; entrego e retiro, no mesmo caso, = apagado", async () => {
    const soRetiro = await cenarioComFormularioCompleto({
      modo: MODO.soRetiro,
      opcao: OPCAO.retirada,
    });
    expect(soRetiro).not.toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(false);

    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    const entregoERetiro = await cenarioComFormularioCompleto({
      modo: MODO.entregoERetiro,
      opcao: OPCAO.retirada,
    });
    expect(entregoERetiro).toContain(AVISO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("LOGADA (controle): a regra do convidado não existe para quem tem conta — nunca vê o aviso, em nenhum modo", async () => {
    // Controle, não prova da mudança: para quem tem conta a expressão já
    // curto-circuitava em `!user`. Está aqui para a matriz ficar completa e
    // para pegar quem um dia tirar esse `!user`.
    mockAuth.user = { id: "u-1", email: "cliente@example.com" };
    for (const modo of [MODO.entrego, MODO.entregoERetiro, MODO.soRetiro]) {
      Object.assign(mockConfig, modo);
      mockCarrinho.selectedShippingOption = OPCAO.transportadora;
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
        await new Promise((r) => setTimeout(r, 900));
      });
      const texto = (document.body.textContent ?? "").replaceAll(NBSP, " ");
      expect(texto).not.toContain(AVISO);
    }
  });
});
