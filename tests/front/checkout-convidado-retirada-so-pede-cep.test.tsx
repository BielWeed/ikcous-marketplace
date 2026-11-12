// @vitest-environment jsdom
//
// QUEM COMPRA SEM CONTA E VAI BUSCAR NA LOJA NÃO DÁ ENDEREÇO DE CASA (12/11/2026).
//
// Antes: o erro "Número é obrigatório" prendia o botão Finalizar numa compra
// que a pessoa ia buscar no balcão. O banco só precisa do CEP na retirada (a
// função que cria o pedido não lê rua/número/bairro/cidade/estado; exige o CEP
// e usa o CEP da cotação como último recurso — `v_cep_de_entrega`).
//
// Regra nova, no CheckoutView DE VERDADE:
//   - visitante + retirada: nome, WhatsApp e CEP bastam; rua/número/bairro/
//     cidade/estado somem da tela (frase no lugar) e NÃO são exigidos; o
//     pedido sai com `addressData === null` e o CEP viaja em `destinationCep`;
//   - visitante + entrega local: tudo como sempre (controle: o erro continua);
//   - voltar da retirada para a entrega: os campos reaparecem PREENCHIDOS e
//     voltam a ser exigidos (nada foi apagado);
//   - quem TEM conta: nada muda (continua barrado sem endereço salvo);
//   - o resumo recolhido não aponta endereço pendente na retirada.
//
// A calculadora de frete é dublê (a opção escolhida vem do `useCart` de teste,
// mutável); o assunto aqui é o formulário e o que vai ao pedido.
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
    shippingCep: "38500-000",
    enderecos: [] as unknown[],
  },
  createOrder: vi.fn(),
  toastError: vi.fn(),
}));

const FRASE = "Retirada na loja: não precisamos do seu endereço";
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
      shippingCep: estado.shippingCep,
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

const campo = (id: string) =>
  document.getElementById(id) as HTMLInputElement | null;

function botaoFinalizar(): HTMLButtonElement {
  const botao = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement;
  expect(botao, "botão Finalizar Pedido").toBeDefined();
  return botao;
}

const texto = () => (document.body.textContent ?? "").replaceAll(" ", " ");

describe("CheckoutView — visitante que retira na loja só informa nome, WhatsApp e CEP", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.user = null;
    estado.opcao = null;
    estado.shippingCep = CEP;
    estado.enderecos = [];
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-1", totalAmount: 100 });
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
  }

  /** Troca a opção de frete escolhida e redesenha (o `useCart` de teste lê
   * `estado.opcao` a cada render). */
  async function escolher(opcao: unknown) {
    estado.opcao = opcao;
    await renderizar();
    await esperar();
  }

  async function esperar() {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
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

  async function tocarNaPendencia() {
    const aviso = document.querySelector(
      "[data-testid='checkout-pendencia-identificacao']",
    ) as HTMLButtonElement | null;
    expect(aviso, "aviso de pendência na barra").not.toBeNull();
    await act(async () => {
      aviso!.click();
      await Promise.resolve();
    });
    await esperar();
  }

  const SO_CEP = {
    "checkout-name": "Cliente Teste",
    "checkout-tel": "34999999999",
    "guest-cep": CEP,
  };
  const ENDERECO = {
    "guest-street": "Rua Teste",
    "guest-number": "100",
    "guest-neighborhood": "Centro",
    "guest-city": "Monte Carmelo",
    "guest-state": "MG",
  };

  // (a) o caso que doía.
  it("(a) visitante: entrega local trava; trocar para retirada com só nome, WhatsApp e CEP libera o Finalizar e o pedido sai sem endereço", async () => {
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    await preencher(SO_CEP);
    // Precondição: com a entrega local, só o CEP não basta.
    expect(botaoFinalizar().disabled).toBe(true);

    await escolher(OPCAO.retirada);
    expect(botaoFinalizar().disabled).toBe(false);

    await act(async () => {
      botaoFinalizar().click();
      await Promise.resolve();
    });
    await esperar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.shippingOptionId).toBe("store-pickup");
    expect(pedido.addressData).toBeNull();
    expect(pedido.addressId).toBeNull();
    expect(pedido.destinationCep).toBe(CEP);
    expect(pedido.customer.name).toBe("Cliente Teste");
  });

  it("(a2) visitante que já abre a tela com a retirada marcada: só nome, WhatsApp e CEP bastam; a tela mostra a frase e esconde rua, número, bairro, cidade, estado e complemento, mas mantém o CEP", async () => {
    estado.opcao = OPCAO.retirada;
    await renderizar();
    await preencher(SO_CEP);

    expect(botaoFinalizar().disabled).toBe(false);
    expect(texto()).toContain(FRASE);
    expect(campo("guest-cep")).not.toBeNull();
    for (const id of [
      "guest-number",
      "guest-street",
      "guest-neighborhood",
      "guest-city",
      "guest-state",
      "guest-complement",
    ]) {
      expect(campo(id), `#${id} some na retirada`).toBeNull();
    }
  });

  it("(a3) retirada com o CEP incompleto continua barrada: o CEP é o único dado de endereço que a retirada exige", async () => {
    estado.opcao = OPCAO.retirada;
    await renderizar();
    await preencher({
      "checkout-name": "Cliente Teste",
      "checkout-tel": "34999999999",
      "guest-cep": "38500-0",
    });
    expect(botaoFinalizar().disabled).toBe(true);
  });

  // (b) controle: a entrega continua exigindo tudo.
  it("(b) controle: visitante + entrega local + só o CEP continua travado em 'Número é obrigatório'", async () => {
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    await preencher(SO_CEP);

    expect(botaoFinalizar().disabled).toBe(true);
    expect(texto()).not.toContain(FRASE);
    await tocarNaPendencia();
    expect(texto()).toContain("Número é obrigatório");
    expect(texto()).toContain("Rua é obrigatória");
    expect(createOrder).not.toHaveBeenCalled();
  });

  // (c) ida e volta.
  it("(c) retirada -> entrega: os campos voltam PREENCHIDOS e continuam valendo", async () => {
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    await preencher({ ...SO_CEP, ...ENDERECO });
    expect(botaoFinalizar().disabled).toBe(false);

    await escolher(OPCAO.retirada);
    expect(campo("guest-number")).toBeNull();
    expect(texto()).toContain(FRASE);
    expect(botaoFinalizar().disabled).toBe(false);

    await escolher(OPCAO.entregaLocal);
    expect(texto()).not.toContain(FRASE);
    expect(campo("guest-street")?.value).toBe("Rua Teste");
    expect(campo("guest-number")?.value).toBe("100");
    expect(campo("guest-neighborhood")?.value).toBe("Centro");
    expect(campo("guest-city")?.value).toBe("Monte Carmelo");
    expect(campo("guest-state")?.value).toBe("MG");
    expect(botaoFinalizar().disabled).toBe(false);

    // E o que foi digitado vai no pedido de entrega, como sempre foi.
    await act(async () => {
      botaoFinalizar().click();
      await Promise.resolve();
    });
    await esperar();
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.addressData).toMatchObject({
      cep: CEP,
      street: "Rua Teste",
      number: "100",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
    });
  });

  it("(c2) retirada sem endereço -> entrega: o Finalizar APAGA na hora e o endereço volta a ser exigido", async () => {
    estado.opcao = OPCAO.retirada;
    await renderizar();
    await preencher(SO_CEP);
    expect(botaoFinalizar().disabled).toBe(false);

    await escolher(OPCAO.entregaLocal);
    expect(campo("guest-number")).not.toBeNull();
    expect(campo("guest-number")?.value).toBe("");
    expect(botaoFinalizar().disabled).toBe(true);
    await tocarNaPendencia();
    expect(texto()).toContain("Número é obrigatório");
  });

  // (d) controle: quem tem conta não mudou.
  it("(d) controle: usuário COM conta + retirada, sem endereço salvo, continua barrado", async () => {
    estado.user = { id: "user-1" };
    estado.opcao = OPCAO.retirada;
    await renderizar();
    await preencher({
      "checkout-name": "Cliente Teste",
      "checkout-tel": "34999999999",
    });
    // Quem tem conta não vê a frase nem perde nenhum campo: o endereço dela é
    // o salvo, e a retirada ainda não o dispensa nesta rodada.
    expect(texto()).not.toContain(FRASE);

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

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("adicione ou selecione um endereço"),
    );
  });

  // (e) o resumo recolhido.
  it("(e) resumo recolhido: na retirada não aponta endereço pendente (e na entrega, com só o CEP, aponta)", async () => {
    estado.opcao = OPCAO.entregaLocal;
    await renderizar();
    await preencher(SO_CEP);
    // Controle: entrega local com só o CEP = endereço pendente no resumo.
    expect(
      document.querySelector("[data-testid='checkout-resumo-falta-endereco']"),
    ).not.toBeNull();

    await escolher(OPCAO.retirada);
    expect(
      document.querySelector("[data-testid='checkout-resumo-falta-endereco']"),
    ).toBeNull();
    expect(
      document.querySelector(
        "[data-testid='checkout-pendencia-identificacao']",
      ),
    ).toBeNull();
    expect(texto()).toContain(FRASE);
  });

  it("(f) retirada com OUTRO defeito no formulário (nome comprido demais): o aviso da barra não manda 'completar o endereço' nem procura campo de endereço que não está na tela", async () => {
    const rolagem = vi.fn();
    Element.prototype.scrollIntoView = rolagem;
    estado.opcao = OPCAO.retirada;
    await renderizar();
    await preencher({ ...SO_CEP, "checkout-name": "N".repeat(121) });
    expect(botaoFinalizar().disabled).toBe(true);

    const aviso = document.querySelector(
      "[data-testid='checkout-pendencia-identificacao']",
    );
    expect(aviso?.textContent).toBe(
      "Confira seus dados e entrega para finalizar",
    );
    await tocarNaPendencia();
    // Sem campo de endereço a focar, o aviso leva ao cabeçalho da seção.
    expect(rolagem).toHaveBeenCalled();
  });
});
