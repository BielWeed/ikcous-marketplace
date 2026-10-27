// @vitest-environment jsdom
//
// Caça 7 (26/10/2026) — três furos do caminho de finalizar o pedido do cliente:
//
// A) PEDIDO EM DOBRO DEPOIS DE FECHAR O APP. A chave de idempotência (a que faz
//    o servidor reconhecer uma repetição) morava no sessionStorage. Rede cai
//    depois de o servidor gravar o pedido -> "tente de novo, não sai em dobro"
//    -> o cliente fecha e abre o PWA (o carrinho segue no localStorage) ->
//    Finalizar girava chave NOVA -> segundo pedido, estoque baixado duas
//    vezes. Agora a chave mora no localStorage, com a conta no nome e 30 min
//    de validade.
//
// B) VOLTAR DO CELULAR ENQUANTO O PEDIDO SAI. O voltar só era interceptado com
//    modal/resumo/sucesso; durante o envio a tela era desmontada e a resposta
//    de sucesso descartada (pedido nasce, carrinho segue cheio, o cupom de uso
//    único que o 1º pedido gastou muda a compra e o 2º pedido nasce sem
//    desconto). Agora o voltar fica retido até o envio terminar.
//
// C) SESSÃO VENCIDA + REDE RUIM. O pedido de quem tem conta ia como anônimo
//    (sem conta nem endereço) e sumia de "Meus pedidos". Agora a sessão é
//    conferida antes de enviar.
//
// Harness copiado de checkout-convidada-tenta-de-novo-a-mesma-compra.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { estado, produto } = vi.hoisted(() => {
  const produto = {
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
  };
  return {
    produto,
    estado: {
      user: null as null | { id: string },
      enderecos: [] as unknown[],
      cart: [{ product: produto, quantity: 1 }] as unknown[],
      cartTotal: 100,
      config: {
        shippingCoverage: "local",
        originCep: "38500-000",
        localCepRange: "01310-100",
        enableCoupons: false,
        whatsappNumber: "",
      } as Record<string, unknown>,
      offline: false,
    },
  };
});

const createOrder = vi.fn();
const clearCart = vi.fn();
const removeFromCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
const sessaoAindaEhDoDono = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
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
      cart: estado.cart,
      cartTotal: estado.cartTotal,
      shippingFee: 0,
      clearCart,
      removeFromCart,
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: (...args: unknown[]) => sessaoAindaEhDoDono(...args),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: toastInfo },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_CONVIDADO = "ikcous-chave-do-pedido:convidado";
const CHAVE_DA_CONTA_1 = "ikcous-chave-do-pedido:user-1";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

const botaoFinalizar = () => botaoPorTexto("Finalizar Pedido");

/** Convidada: preenche o formulário inteiro e espera o botão. */
async function preencherComoConvidada() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    digitar("guest-street", "Rua Teste");
    digitar("guest-number", "100");
    digitar("guest-neighborhood", "Centro");
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-cep", "01310-100");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-city", "Cidade Teste");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-state", "SP");
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

/** Conta: endereço já cadastrado; só nome, WhatsApp e a forma de pagamento. */
async function preencherComoConta() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
  await act(async () => {
    botaoPorTexto("Dinheiro na Entrega")?.click();
    await esperarMicrotarefas();
  });
}

async function clicarFinalizar() {
  await act(async () => {
    botaoFinalizar()!.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

const ENDERECO_DA_CONTA = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "01310-100",
  street: "Rua Teste",
  number: "100",
  neighborhood: "Centro",
  city: "Cidade Teste",
  state: "SP",
  is_default: true,
};

describe("CheckoutView — caça 7: chave que sobrevive ao app fechado, voltar retido e sessão conferida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O localStorage do aparelho: sobrevive a "fechar o app" (a raiz nova).
  let armazem: Map<string, string>;

  async function elemento() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    return (
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
  }

  async function abrirOApp() {
    const el = await elemento();
    await act(async () => {
      raiz.render(el);
    });
  }

  /** Fechar e abrir o PWA: a tela some, o sessionStorage some, o localStorage fica. */
  async function fecharEAbrirOApp() {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await abrirOApp();
  }

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockReset().mockImplementation(() => {
      estado.cart = [];
      estado.cartTotal = 0;
    });
    removeFromCart.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    onNavigate.mockReset();
    onSetBackOverride.mockReset();
    sessaoAindaEhDoDono.mockReset().mockResolvedValue(true);
    estado.user = null;
    estado.enderecos = [];
    estado.cart = [{ product: produto, quantity: 1 }];
    estado.cartTotal = 100;
    estado.offline = false;
    estado.config = {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    };
    sessionStorage.clear();
    pararABuscaDeCep();
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("A) a chave sobrevive a fechar e abrir o app", () => {
    it("convidada: rede cai, fecha e abre o app, Finalizar de novo manda a MESMA chave (e a chave mora no localStorage, não no sessionStorage)", async () => {
      createOrder.mockRejectedValueOnce({});
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();
      expect(createOrder).toHaveBeenCalledTimes(1);
      const chaveDeHoje = createOrder.mock.calls[0][0].idempotencyKey;

      expect(JSON.parse(armazem.get(CHAVE_CONVIDADO)!).chave).toBe(chaveDeHoje);
      expect(sessionStorage.getItem("ikcous-chave-do-pedido")).toBeNull();
      expect(sessionStorage.getItem(CHAVE_CONVIDADO)).toBeNull();

      await fecharEAbrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(chaveDeHoje);
    });

    it("com conta: o registro leva o id da conta e a mesma chave volta depois de fechar e abrir", async () => {
      estado.user = { id: "user-1" };
      estado.enderecos = [ENDERECO_DA_CONTA];
      createOrder.mockRejectedValueOnce({});
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();
      const chaveDeHoje = createOrder.mock.calls[0][0].idempotencyKey;
      expect(JSON.parse(armazem.get(CHAVE_DA_CONTA_1)!).chave).toBe(
        chaveDeHoje,
      );
      expect(armazem.has(CHAVE_CONVIDADO)).toBe(false);

      await fecharEAbrirOApp();
      await preencherComoConta();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(chaveDeHoje);
    });

    it("outra conta no mesmo aparelho NÃO herda a chave da primeira", async () => {
      estado.user = { id: "user-1" };
      estado.enderecos = [ENDERECO_DA_CONTA];
      createOrder.mockRejectedValueOnce({});
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();
      const chaveDaConta1 = createOrder.mock.calls[0][0].idempotencyKey;

      estado.user = { id: "user-2" };
      estado.enderecos = [
        { ...ENDERECO_DA_CONTA, id: "addr-2", user_id: "user-2" },
      ];
      sessaoAindaEhDoDono.mockResolvedValue(true);
      await fecharEAbrirOApp();
      await preencherComoConta();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(createOrder.mock.calls[1][0].idempotencyKey).not.toBe(
        chaveDaConta1,
      );
    });

    it("a compra de AMANHÃ, no mesmo carrinho, nasce com chave nova (validade de 30 min)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
      createOrder.mockRejectedValueOnce({});
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();
      const chaveDeHoje = createOrder.mock.calls[0][0].idempotencyKey;

      vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
      await fecharEAbrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(createOrder.mock.calls[1][0].idempotencyKey).not.toBe(chaveDeHoje);
    });

    it("no SUCESSO a chave é apagada: a compra seguinte, mesmo idêntica, nasce com chave nova", async () => {
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(armazem.has(CHAVE_CONVIDADO)).toBe(false);
    });

    it("registro corrompido no localStorage não quebra o Finalizar: segue com chave nova", async () => {
      armazem.set(CHAVE_CONVIDADO, "{isso nao e json");
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0].idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-/,
      );
    });
  });

  describe("B) o voltar do celular fica retido enquanto o pedido sai", () => {
    function overrideAtual(): (() => void) | null {
      const ultima = onSetBackOverride.mock.calls.at(-1)?.[0] as
        | (() => () => void)
        | null
        | undefined;
      return typeof ultima === "function" ? ultima() : null;
    }

    it("durante o envio o voltar não sai da tela: avisa e devolve a guarda ao histórico", async () => {
      let responder!: (pedido: { id: string }) => void;
      createOrder.mockImplementationOnce(
        () => new Promise((resolve) => (responder = resolve)),
      );
      const empurrar = vi.spyOn(globalThis.history, "pushState");
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      // Enviando: há uma guarda no histórico e um override do voltar.
      expect(empurrar).toHaveBeenCalledWith(
        { modal: "checkout-enviando" },
        "",
        globalThis.location.pathname,
      );
      const voltar = overrideAtual();
      expect(voltar).not.toBeNull();

      const antes = empurrar.mock.calls.length;
      voltar!();
      expect(toastInfo).toHaveBeenCalledWith(
        "Aguarde, estamos enviando seu pedido.",
      );
      expect(onNavigate).not.toHaveBeenCalled();
      // O popstate consumiu a guarda: ela volta, para o PRÓXIMO toque também ser retido.
      expect(empurrar.mock.calls.length).toBe(antes + 1);

      // O pedido termina: a tela mostra o sucesso e o voltar vira o de sempre.
      await act(async () => {
        responder({ id: "pedido-1234abcd" });
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
      expect(document.body.textContent).toContain("Pedido recebido");
      overrideAtual()!();
      expect(onNavigate).toHaveBeenCalledWith("home");
    });

    it("se o envio FALHA, o voltar é solto: a pessoa não fica presa", async () => {
      let recusar!: (erro: unknown) => void;
      createOrder.mockImplementationOnce(
        () => new Promise((_, rejeitar) => (recusar = rejeitar)),
      );
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();
      expect(overrideAtual()).not.toBeNull();

      await act(async () => {
        recusar({ code: "23514", message: "Estoque insuficiente" });
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });

      expect(onSetBackOverride.mock.calls.at(-1)?.[0]).toBeNull();
      expect(botaoFinalizar()).toBeDefined();
    });

    it("sem envio em curso o voltar NÃO é retido (o fluxo de antes não muda)", async () => {
      await abrirOApp();
      await preencherComoConvidada();
      expect(onSetBackOverride.mock.calls.at(-1)?.[0] ?? null).toBeNull();
    });
  });

  describe("C) a sessão de quem tem conta é conferida antes de enviar", () => {
    beforeEach(() => {
      estado.user = { id: "user-1" };
      estado.enderecos = [ENDERECO_DA_CONTA];
    });

    it("sessão vencida: NÃO envia, avisa, oferece entrar de novo e solta o Finalizar", async () => {
      sessaoAindaEhDoDono.mockResolvedValue(false);
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();

      expect(sessaoAindaEhDoDono).toHaveBeenCalledWith("user-1");
      expect(createOrder).not.toHaveBeenCalled();
      expect(String(toastError.mock.calls.at(-1)?.[0])).toContain(
        "Sua sessão expirou. Entre de novo para finalizar o pedido.",
      );
      const entrar = document.querySelector(
        'button[data-acao="entrar_na_conta"]',
      ) as HTMLButtonElement | null;
      expect(entrar).not.toBeNull();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Sua sessão expirou. Entre de novo para finalizar o pedido.",
      );
      // A trava de envio foi solta: o botão não ficou preso.
      expect(botaoFinalizar()!.disabled).toBe(false);
      expect(onSetBackOverride.mock.calls.at(-1)?.[0] ?? null).toBeNull();

      // O botão leva ao login pelo caminho que o app já usa.
      await act(async () => {
        entrar!.click();
        await esperarMicrotarefas();
      });
      expect(onNavigate).toHaveBeenCalledWith("auth");
    });

    it("sessão vencida e depois renovada: o mesmo Finalizar passa a enviar", async () => {
      sessaoAindaEhDoDono.mockResolvedValueOnce(false);
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();
      expect(createOrder).not.toHaveBeenCalled();

      sessaoAindaEhDoDono.mockResolvedValue(true);
      await clicarFinalizar();
      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    it("sessão válida: envia como sempre, com a conta no pedido", async () => {
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();

      expect(sessaoAindaEhDoDono).toHaveBeenCalledWith("user-1");
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0].addressId).toBe("addr-1");
    });

    it("a conferência que falha por lançar exceção também NÃO envia (não sei nunca vira pode enviar)", async () => {
      sessaoAindaEhDoDono.mockRejectedValue(new Error("sem rede"));
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();

      expect(createOrder).not.toHaveBeenCalled();
      expect(botaoFinalizar()!.disabled).toBe(false);
    });

    it("a conferência que nunca responde tem prazo: não envia e não prende a tela", async () => {
      sessaoAindaEhDoDono.mockImplementation(() => new Promise(() => {}));
      await abrirOApp();
      await preencherComoConta();
      const agendar = globalThis.setTimeout;
      vi.spyOn(globalThis, "setTimeout").mockImplementation(
        (callback, prazo, ...args) =>
          agendar(callback, prazo === 12_000 ? 1 : prazo, ...args),
      );
      await clicarFinalizar();

      expect(createOrder).not.toHaveBeenCalled();
      expect(botaoFinalizar()!.disabled).toBe(false);
      expect(
        document.querySelector('button[data-acao="entrar_na_conta"]'),
      ).not.toBeNull();
    });

    it("convidada nunca consulta a sessão (não tem conta para conferir)", async () => {
      estado.user = null;
      estado.enderecos = [];
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(sessaoAindaEhDoDono).not.toHaveBeenCalled();
      expect(createOrder).toHaveBeenCalledTimes(1);
    });
  });
});
