// @vitest-environment jsdom
//
// LOTE 210 (r210-d) — quem vai BUSCAR na loja não lê "entrega" no checkout.
//
// A modalidade da loja (`ehModalidadeDaLoja`) junta entrega local e retirada, e
// vários textos só olhavam para ela: a retirada herdava "endereço de entrega" e
// "meio de pagamento na entrega". Só o TEXTO muda; nenhuma trava, total, frete
// ou dado do pedido mexe. A entrega local é o controle de cada caso: lá a frase
// de sempre continua igual.
//
// Montagem copiada de checkout-convidado-retirada-so-pede-cep.test.tsx; a flag
// do pagamento pelo app é mutável para provar o aviso "saiu do ar".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { estado, createOrder, toastError } = vi.hoisted(() => ({
  estado: {
    user: null as null | { id: string },
    opcao: null as unknown,
    enderecos: [] as unknown[],
    appLigado: true,
  },
  createOrder: vi.fn(),
  toastError: vi.fn(),
}));

const CEP = "38500-000";

const OPCAO = {
  retirada: {
    id: "store-pickup",
    name: "Retirar na loja",
    price: 0,
    deliveryDays: 0,
    provider: "pickup",
    pickupAddress: "Rua Fictícia de Teste, 100 — Centro",
  },
  entregaLocal: {
    id: "local-delivery",
    name: "Entrega Local",
    price: 0,
    deliveryDays: 1,
    provider: "local",
  },
};

const ENDERECO_SALVO = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: CEP,
  street: "Rua Teste",
  number: "100",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  is_default: true,
};

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localDeliveryEnabled: true,
      enabledShippingMethods: ["sedex", "pac", "store-pickup"],
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.enderecos,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, profile: null, loading: false }),
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
            description: "",
            price: 100,
            images: [],
            category: "geral",
            stock: 10,
            sold: 0,
            isActive: true,
            isBestseller: false,
            freeShipping: false,
            createdAt: new Date(0).toISOString(),
          },
          quantity: 1,
        },
      ],
      cartTotal: 100,
      shippingFee: 0,
      freteIndefinido: false,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: estado.opcao,
      shippingCep: CEP,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => estado.appLigado,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  expect(el, `campo #${id} na tela`).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const texto = () => (document.body.textContent ?? "").replaceAll(" ", " ");
const semAcento = (s: string) => s.normalize("NFD").replaceAll(/[̀-ͯ]/g, "");

function botaoFinalizar(): HTMLButtonElement {
  const botao = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement;
  expect(botao, "botão Finalizar Pedido").toBeDefined();
  return botao;
}

describe("CheckoutView — a retirada na loja não fala em entrega de endereço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.user = null;
    estado.opcao = null;
    estado.enderecos = [];
    estado.appLigado = true;
    createOrder.mockReset();
    toastError.mockReset();
    const armazem = new Map<string, string>();
    pararABuscaDeCep();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    const sessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => sessao.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        sessao.set(chave, valor);
      },
      removeItem: (chave: string) => {
        sessao.delete(chave);
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
  });

  async function esperar() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  async function renderizar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await esperar();
  }

  async function preencher(valores: Record<string, string>) {
    for (const [id, valor] of Object.entries(valores)) {
      await act(async () => {
        digitar(id, valor);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await esperar();
  }

  const pendencia = () =>
    document.querySelector("[data-testid='checkout-pendencia-identificacao']")
      ?.textContent;

  it("(a) visitante: o cabeçalho do CEP não diz 'endereço de entrega' na retirada (controle: na entrega diz)", async () => {
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    expect(semAcento(texto())).toContain("Endereco de Entrega");

    estado.opcao = OPCAO.retirada;
    await renderizar();
    expect(semAcento(texto()).toLowerCase()).not.toContain(
      "endereco de entrega",
    );
    expect(texto()).toContain("Seu CEP");
  });

  it("(b) visitante sem CEP: o resumo e a barra pedem o CEP, não um 'endereço de entrega' (controle: na entrega pedem o endereço)", async () => {
    const SO_DADOS = {
      "checkout-name": "Cliente Teste",
      "checkout-tel": "34999999999",
    };
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    await preencher(SO_DADOS);
    expect(pendencia()).toBe("Complete o endereço de entrega para finalizar");
    expect(texto()).toContain("Informe o endereço de entrega");

    estado.opcao = OPCAO.retirada;
    await renderizar();
    await preencher(SO_DADOS);
    expect(pendencia()).toBe("Informe o CEP para finalizar");
    expect(texto()).not.toContain("Informe o endereço de entrega");
    expect(texto()).toContain("Informe o CEP");
  });

  it("(c) quem tem conta e já salvou endereço: a seção chama 'Seu endereço' na retirada, não 'Endereço de entrega'", async () => {
    estado.user = { id: "user-1" };
    estado.enderecos = [ENDERECO_SALVO];
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    expect(semAcento(texto())).toContain("Endereco de Entrega");

    estado.opcao = OPCAO.retirada;
    await renderizar();
    expect(semAcento(texto()).toLowerCase()).not.toContain(
      "endereco de entrega",
    );
    expect(texto()).toContain("Seu endereço");
  });

  // O rótulo do cartão de resumo é o `aria-label` da região (não entra no
  // texto da tela), por isso o caso (a)/(c) acima não o enxerga.
  const regioes = () =>
    [...document.querySelectorAll("section[aria-label]")].map((r) =>
      r.getAttribute("aria-label"),
    );

  it("(h) o cartão de resumo do endereço se chama 'Seu CEP' (visitante) ou 'Seu endereço' (conta) na retirada, e 'Endereço de entrega' na entrega", async () => {
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    expect(regioes()).toContain("Endereço de entrega");

    estado.opcao = OPCAO.retirada;
    await renderizar();
    expect(regioes()).toContain("Seu CEP");
    expect(regioes()).not.toContain("Endereço de entrega");
  });

  it("(i) o mesmo cartão, para quem tem conta, se chama 'Seu endereço' na retirada", async () => {
    estado.user = { id: "user-1" };
    estado.enderecos = [ENDERECO_SALVO];
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    expect(regioes()).toContain("Endereço de entrega");

    estado.opcao = OPCAO.retirada;
    await renderizar();
    expect(regioes()).toContain("Seu endereço");
    expect(regioes()).not.toContain("Endereço de entrega");
  });

  it("(d) quem tem conta e ainda não cadastrou endereço: o convite não diz 'de entrega' na retirada", async () => {
    estado.user = { id: "user-1" };
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    expect(texto()).toContain("Cadastre um endereço de entrega");

    estado.opcao = OPCAO.retirada;
    await renderizar();
    expect(texto()).not.toContain("Cadastre um endereço de entrega");
    expect(texto()).toContain("Cadastre um endereço");
  });

  it("(e) o aviso ao tocar em Finalizar sem endereço escolhido não diz 'de entrega' na retirada", async () => {
    estado.user = { id: "user-1" };
    async function tocarEmFinalizar() {
      const botao = botaoFinalizar();
      const chaveProps = Object.keys(botao).find((k) =>
        k.startsWith("__reactProps$"),
      )!;
      const aoClicar = (
        Reflect.get(botao, chaveProps) as { onClick: () => Promise<void> }
      ).onClick;
      await act(async () => {
        await aoClicar();
      });
      await esperar();
    }

    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    await preencher({
      "checkout-name": "Cliente Teste",
      "checkout-tel": "34999999999",
    });
    await tocarEmFinalizar();
    expect(toastError).toHaveBeenLastCalledWith(
      "Por favor, adicione ou selecione um endereço de entrega.",
    );

    // Desde 26/11/2026 a retirada não exige endereço de quem tem conta
    // (checkout-retirada-com-conta-so-pede-cep.test.tsx): nenhum aviso de
    // endereço, nem o "de entrega" nem o sem ele.
    estado.opcao = OPCAO.retirada;
    toastError.mockClear();
    await renderizar();
    await tocarEmFinalizar();
    expect(toastError).not.toHaveBeenCalledWith(
      "Por favor, adicione ou selecione um endereço de entrega.",
    );
    expect(toastError).not.toHaveBeenCalledWith(
      "Por favor, adicione ou selecione um endereço.",
    );
  });

  describe("pagamento pelo app que saiu do ar com o PIX já marcado", () => {
    async function marcarPixPeloAppEDerrubarOApp(opcao: unknown) {
      estado.user = { id: "user-1" };
      estado.enderecos = [ENDERECO_SALVO];
      estado.opcao = opcao;
      await renderizar();
      await preencher({
        "checkout-name": "Cliente Teste",
        "checkout-tel": "34999999999",
      });
      const radio = [...document.querySelectorAll("[role='radio']")].find((r) =>
        r.textContent?.includes("Pagar agora com PIX"),
      ) as HTMLButtonElement;
      expect(radio, "opção Pagar agora com PIX").toBeDefined();
      await act(async () => {
        radio.click();
        await Promise.resolve();
      });
      await esperar();
      estado.appLigado = false;
      await renderizar();
    }

    const alertaVisivel = () =>
      [...document.querySelectorAll("[role='alert']")]
        .map((a) => a.textContent ?? "")
        .find((t) => t.includes("Pagamento pelo app indisponível"));

    async function tocarEmFinalizar() {
      const botao = botaoFinalizar();
      const chaveProps = Object.keys(botao).find((k) =>
        k.startsWith("__reactProps$"),
      )!;
      const aoClicar = (
        Reflect.get(botao, chaveProps) as { onClick: () => Promise<void> }
      ).onClick;
      await act(async () => {
        await aoClicar();
      });
      await esperar();
    }

    it("(f) retirada: o aviso e a mensagem mandam escolher pagamento NA RETIRADA", async () => {
      await marcarPixPeloAppEDerrubarOApp(OPCAO.retirada);
      expect(alertaVisivel()).toContain("meio de pagamento na retirada");
      expect(alertaVisivel()).not.toContain("na entrega");

      await tocarEmFinalizar();
      const mensagem = String(toastError.mock.lastCall?.[0]);
      expect(mensagem).toContain("meio de pagamento na retirada");
      expect(mensagem).not.toContain("na entrega");
    });

    it("(g) controle: entrega local continua mandando escolher pagamento na entrega", async () => {
      await marcarPixPeloAppEDerrubarOApp(OPCAO.entregaLocal);
      expect(alertaVisivel()).toContain("meio de pagamento na entrega");

      await tocarEmFinalizar();
      expect(String(toastError.mock.lastCall?.[0])).toContain(
        "meio de pagamento na entrega",
      );
    });
  });
});
