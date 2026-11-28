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
import {
  PREFIXO_DA_CHAVE_DO_PEDIDO as PREFIXO,
  haChaveDoPedidoVigente,
} from "@/lib/chave-do-pedido";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concluirBuscaDeCepSemEndereco } from "./duble-busca-de-cep";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

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
      // Lote 257: liga a conferência de sessão REAL (o dublê da lib sai do meio).
      libReal: false,
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
const getSession = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: estado.enderecos,
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

vi.mock("@/lib/sessao-ainda-e-do-dono", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/sessao-ainda-e-do-dono")>();
  return {
    sessaoAindaEhDoDono: (...args: unknown[]) =>
      estado.libReal
        ? (real.sessaoAindaEhDoDono as (...a: unknown[]) => unknown)(...args)
        : sessaoAindaEhDoDono(...args),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: toastInfo },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_SEM_CONEXAO =
  "Sem conexão agora. Seu carrinho está guardado; tente de novo em instantes.";
const FRASE_LOGIN_MUDOU_NA_VISITANTE =
  "O login deste aparelho mudou enquanto você finalizava. Nada foi enviado: confira na tela se está comprando com ou sem conta e finalize de novo.";
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
    getSession.mockReset();
    estado.libReal = false;
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
    concluirBuscaDeCepSemEndereco();
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

      expect(sessaoAindaEhDoDono).toHaveBeenCalledWith(
        "user-1",
        expect.any(Function),
      );
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

    // r60-b: a chave nasce SÓ quando o pedido vai mesmo ser enviado. Uma saída
    // sem envio que a deixasse gravada contaria como "pedido em curso" por 30
    // min e congelaria a releitura de preço e estoque do carrinho.
    describe("saída sem envio não deixa chave de pedido gravada", () => {
      it("sessão vencida: nenhum registro de chave no aparelho e nenhum pedido em curso", async () => {
        sessaoAindaEhDoDono.mockResolvedValue(false);
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(createOrder).not.toHaveBeenCalled();
        expect(
          [...armazem.keys()].filter((k) => k.startsWith(PREFIXO)),
        ).toEqual([]);
        expect(haChaveDoPedidoVigente("user-1")).toBe(false);
      });

      it("conferência que falha por rede: nenhum registro de chave e nenhum pedido em curso", async () => {
        sessaoAindaEhDoDono.mockRejectedValue(new Error("sem rede"));
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(createOrder).not.toHaveBeenCalled();
        expect(armazem.has(CHAVE_DA_CONTA_1)).toBe(false);
        expect(haChaveDoPedidoVigente("user-1")).toBe(false);
      });

      it("conferência que estoura o prazo: nenhum registro de chave e nenhum pedido em curso", async () => {
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
        expect(armazem.has(CHAVE_DA_CONTA_1)).toBe(false);
        expect(haChaveDoPedidoVigente("user-1")).toBe(false);
      });

      it("a saída sem envio NÃO apaga a chave de um envio anterior que ficou sem resposta (nada de pedido em dobro)", async () => {
        // 1º toque: a conferência passa, o pedido SAI e a resposta se perde.
        // (Falha de rede de verdade: "tentar de novo" não trava o botão.)
        createOrder.mockRejectedValueOnce({
          code: "",
          message: "TypeError: Failed to fetch",
        });
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();
        expect(createOrder).toHaveBeenCalledTimes(1);
        const chaveDoEnvio = createOrder.mock.calls[0][0].idempotencyKey;
        expect(JSON.parse(armazem.get(CHAVE_DA_CONTA_1)!).chave).toBe(
          chaveDoEnvio,
        );

        // 2º toque: a conferência da sessão falha, nada sai, e a chave do
        // envio anterior continua gravada, intacta.
        sessaoAindaEhDoDono.mockResolvedValueOnce(false);
        await clicarFinalizar();
        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(JSON.parse(armazem.get(CHAVE_DA_CONTA_1)!).chave).toBe(
          chaveDoEnvio,
        );
        expect(haChaveDoPedidoVigente("user-1")).toBe(true);

        // 3º toque: a sessão volta e a retentativa leva a MESMA chave.
        createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
        await clicarFinalizar();
        expect(createOrder).toHaveBeenCalledTimes(2);
        expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(chaveDoEnvio);
      });

      it("sessão válida: a chave nasce e vai junto no pedido (a idempotência segue igual)", async () => {
        createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(createOrder.mock.calls[0][0].idempotencyKey).toEqual(
          expect.any(String),
        );
        expect(
          createOrder.mock.calls[0][0].idempotencyKey.length,
        ).toBeGreaterThan(8);
      });
    });

    it("sessão válida: envia como sempre, com a conta no pedido", async () => {
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConta();
      await clicarFinalizar();

      expect(sessaoAindaEhDoDono).toHaveBeenCalledWith(
        "user-1",
        expect.any(Function),
      );
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

    it("a conferência que nunca responde tem prazo: não envia, não prende a tela e diz que é a internet (não a sessão)", async () => {
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
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(FRASE_SEM_CONEXAO);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        FRASE_SEM_CONEXAO,
      );
      expect(
        document.querySelector('button[data-acao="entrar_na_conta"]'),
      ).toBeNull();
      expect(
        document.querySelector('button[data-acao="tentar_de_novo"]'),
      ).not.toBeNull();
    });

    // Lote 257 (caça 13-C, achado 4): rede caída NÃO é sessão expirada.
    describe("internet fora ao conferir a sessão", () => {
      const semNenhumaSessao = () => ({ data: { session: null }, error: null });
      const semInternet = () => ({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });

      it("renovar o token sem internet: NÃO envia e diz 'Sem conexão', sem mandar entrar de novo", async () => {
        // Cadeia inteira de verdade: o erro de rede do supabase-js -> a
        // conferência real -> a tela. O dublê só devolve o que o servidor de
        // autenticação devolve sem internet.
        estado.libReal = true;
        getSession.mockResolvedValue(semInternet());
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(getSession).toHaveBeenCalled();
        expect(createOrder).not.toHaveBeenCalled();
        expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
          FRASE_SEM_CONEXAO,
        );
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
          FRASE_SEM_CONEXAO,
        );
        expect(document.body.textContent).not.toContain("sessão expirou");
        expect(
          document.querySelector('button[data-acao="entrar_na_conta"]'),
        ).toBeNull();
        expect(
          document.querySelector('button[data-acao="tentar_de_novo"]'),
        ).not.toBeNull();
        expect(botaoFinalizar()!.disabled).toBe(false);
        expect(onSetBackOverride.mock.calls.at(-1)?.[0] ?? null).toBeNull();
      });

      it("a internet volta: o mesmo Finalizar passa a enviar (a conta nunca caiu)", async () => {
        estado.libReal = true;
        getSession.mockResolvedValueOnce(semInternet()).mockResolvedValue({
          data: { session: { user: { id: "user-1" } } },
          error: null,
        });
        createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();
        expect(createOrder).not.toHaveBeenCalled();

        await clicarFinalizar();
        expect(createOrder).toHaveBeenCalledTimes(1);
      });

      it("sessão de fato ausente (sem erro de rede): segue 'Sua sessão expirou' e o botão Entrar, sem enviar", async () => {
        estado.libReal = true;
        getSession.mockResolvedValue(semNenhumaSessao());
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(createOrder).not.toHaveBeenCalled();
        expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
          "Sua sessão expirou. Entre de novo para finalizar o pedido.",
        );
        expect(document.body.textContent).not.toContain("Sem conexão agora");
        expect(
          document.querySelector('button[data-acao="entrar_na_conta"]'),
        ).not.toBeNull();
      });

      it("sessão de outra conta (sem erro de rede): segue 'Sua sessão expirou' e NÃO envia", async () => {
        estado.libReal = true;
        getSession.mockResolvedValue({
          data: { session: { user: { id: "user-2" } } },
          error: null,
        });
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(createOrder).not.toHaveBeenCalled();
        expect(String(toastError.mock.calls.at(-1)?.[0])).toContain(
          "Sua sessão expirou",
        );
        expect(
          document.querySelector('button[data-acao="entrar_na_conta"]'),
        ).not.toBeNull();
      });

      it("ler a sessão lançando exceção: NÃO envia (não sei nunca vira pode enviar) e fica a frase de sempre", async () => {
        estado.libReal = true;
        getSession.mockRejectedValue(new Error("armazenamento quebrado"));
        await abrirOApp();
        await preencherComoConta();
        await clicarFinalizar();

        expect(createOrder).not.toHaveBeenCalled();
        expect(String(toastError.mock.calls.at(-1)?.[0])).toContain(
          "Sua sessão expirou",
        );
      });
    });
  });

  // TROCA DE CONTA NA MESMA ABA (caça 27/11/2026). A visitante toca em
  // Finalizar numa rede lenta; a conferência do frete espera a rede e, nesse
  // meio-tempo, OUTRA aba do mesmo aparelho entra na conta B. A gravação usa a
  // sessão ativa no instante do envio: o pedido saía na conta de B, com o nome,
  // o WhatsApp e o endereço da visitante, e aparecia em "Meus pedidos" de B.
  // Agora a visitante também confere, antes de enviar, que a sessão continua
  // VAZIA — e sai pela MESMA saída do caminho de conta.
  describe("D) a visitante confere que a sessão continua vazia antes de enviar", () => {
    const sessaoDeOutraConta = () => ({
      data: { session: { user: { id: "user-b" } } },
      error: null,
    });

    it("a conferência é pedida para 'ninguém' e, com a sessão vazia, o pedido sai", async () => {
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(sessaoAindaEhDoDono).toHaveBeenCalledWith(
        null,
        expect.any(Function),
      );
      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    it("outra aba entrou na conta B durante a espera: NÃO envia, diz que o login mudou (nunca 'sessão expirou') e o Finalizar fica livre", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue(sessaoDeOutraConta());
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(getSession).toHaveBeenCalled();
      expect(createOrder).not.toHaveBeenCalled();
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
        FRASE_LOGIN_MUDOU_NA_VISITANTE,
      );
      // Ela não tinha sessão para "expirar", e o botão "Entrar" a tiraria do
      // checkout para uma tela de login de quem já está logado.
      expect(document.body.textContent).not.toContain("sessão expirou");
      expect(
        document.querySelector('button[data-acao="entrar_na_conta"]'),
      ).toBeNull();
      expect(
        document.querySelector('button[data-acao="tentar_de_novo"]'),
      ).not.toBeNull();
      // Nada saiu: nenhuma chave de pedido de convidada ficou "em curso".
      expect(armazem.has(CHAVE_CONVIDADO)).toBe(false);
      expect(botaoFinalizar()!.disabled).toBe(false);
      expect(onSetBackOverride.mock.calls.at(-1)?.[0] ?? null).toBeNull();
    });

    it("a leitura da sessão demora e, quando responde, já é a da conta B: o pedido não sai", async () => {
      // O que vale é a sessão do instante do envio (B), não a do clique
      // (vazia): a tela só sabe quem está logado AGORA lendo de novo.
      estado.libReal = true;
      let liberarLeitura: (valor: unknown) => void = () => {};
      getSession.mockImplementation(
        () =>
          new Promise((resolve) => {
            liberarLeitura = resolve;
          }),
      );
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();
      expect(createOrder).not.toHaveBeenCalled();

      await act(async () => {
        liberarLeitura(sessaoDeOutraConta());
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
      expect(createOrder).not.toHaveBeenCalled();
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
        FRASE_LOGIN_MUDOU_NA_VISITANTE,
      );
    });

    it("sessão vazia lida de verdade (sem dublê da conferência): o pedido sai como sempre", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue({ data: { session: null }, error: null });
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0].addressId ?? null).toBeNull();
    });

    it("há sessão de alguém mas a renovação não saiu por falta de internet: NÃO envia e diz 'Sem conexão'", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).not.toHaveBeenCalled();
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(FRASE_SEM_CONEXAO);
      expect(
        document.querySelector('button[data-acao="tentar_de_novo"]'),
      ).not.toBeNull();
    });

    it("a conferência que falha (lança) também NÃO envia (não sei nunca vira pode enviar)", async () => {
      sessaoAindaEhDoDono.mockRejectedValue(new Error("sem rede"));
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).not.toHaveBeenCalled();
      expect(botaoFinalizar()!.disabled).toBe(false);
    });
  });

  // O "TENTAR DE NOVO" DA VISITANTE (caça 28/11/2026). O Finalizar já conferia a
  // sessão (D), mas o reenvio da compra congelada não: olhava só a conta da
  // TELA e mandava a RPC. Visitante sem resposta -> outra aba entra numa conta
  // (a leitura da sessão nesta aba espera a trava da outra: segundos, com rede
  // lenta) -> "Tentar de novo" -> o pedido saía na conta B. E como a chave só
  // devolve o pedido já gravado ao MESMO dono, com outro dono nascia um pedido
  // NOVO: dois pedidos, estoque e cupom gastos duas vezes.
  describe("E) o 'Tentar de novo' da visitante confere a sessão como o Finalizar", () => {
    const semNenhumaSessao = () => ({ data: { session: null }, error: null });
    const sessaoDaContaB = () => ({
      data: { session: { user: { id: "user-b" } } },
      error: null,
    });
    const CHAVE_DO_PEDIDO_SEM_RESPOSTA = "ikcous-pedido-sem-resposta-v1";
    const botaoTentarDeNovo = () =>
      document.body.querySelector(
        'button[data-acao="reenviar_mesma_compra"]',
      ) as HTMLButtonElement | null;

    /** A primeira tentativa fica sem resposta: o painel oferece o reenvio. */
    async function ficarSemResposta() {
      createOrder.mockRejectedValueOnce({});
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(botaoTentarDeNovo()).not.toBeNull();
    }

    async function clicarTentarDeNovo() {
      await act(async () => {
        botaoTentarDeNovo()!.click();
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
    }

    it("sessão segue vazia: reenvia a MESMA compra, com a MESMA chave, e as duas sem sessão", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue(semNenhumaSessao());
      await ficarSemResposta();
      const leiturasAntes = getSession.mock.calls.length;

      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await clicarTentarDeNovo();

      // A conferência leu a sessão de novo antes do reenvio.
      expect(getSession.mock.calls.length).toBeGreaterThan(leiturasAntes);
      expect(createOrder).toHaveBeenCalledTimes(2);
      const [primeiro, opcoesDoPrimeiro] = createOrder.mock.calls[0];
      const [segundo, opcoesDoSegundo] = createOrder.mock.calls[1];
      expect(typeof primeiro.idempotencyKey).toBe("string");
      expect(segundo.idempotencyKey).toBe(primeiro.idempotencyKey);
      expect(segundo).toEqual(primeiro);
      // O pedido da visitante vai SEM sessão mesmo que uma apareça entre a
      // conferência e a RPC (a janela de milissegundos).
      expect(opcoesDoPrimeiro).toEqual({
        comPagamentoOnline: false,
        semSessao: true,
      });
      expect(opcoesDoSegundo).toEqual({
        comPagamentoOnline: false,
        semSessao: true,
      });
    });

    it("outra aba entrou na conta B antes do toque: NÃO reenvia e sai como o Finalizar", async () => {
      estado.libReal = true;
      let sessao: unknown = semNenhumaSessao();
      getSession.mockImplementation(async () => sessao);
      await ficarSemResposta();
      expect(
        sessionStorage.getItem(CHAVE_DO_PEDIDO_SEM_RESPOSTA),
      ).not.toBeNull();

      sessao = sessaoDaContaB();
      await clicarTentarDeNovo();

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
        FRASE_LOGIN_MUDOU_NA_VISITANTE,
      );
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        FRASE_LOGIN_MUDOU_NA_VISITANTE,
      );
      expect(botaoTentarDeNovo()).toBeNull();
      expect(
        document.querySelector('button[data-acao="tentar_de_novo"]'),
      ).not.toBeNull();
      expect(document.body.textContent).not.toContain("sessão expirou");
      expect(botaoFinalizar()!.disabled).toBe(false);
      // A compra congelada (nome, WhatsApp e endereço da visitante) não fica
      // no aparelho para a conta que entrou.
      expect(sessionStorage.getItem(CHAVE_DO_PEDIDO_SEM_RESPOSTA)).toBeNull();
    });

    it("a leitura da sessão demora e, quando responde, já é a da conta B: o reenvio não sai", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue(semNenhumaSessao());
      await ficarSemResposta();

      let liberarLeitura: (valor: unknown) => void = () => {};
      getSession.mockImplementation(
        () =>
          new Promise((resolve) => {
            liberarLeitura = resolve;
          }),
      );
      await clicarTentarDeNovo();
      expect(createOrder).toHaveBeenCalledTimes(1);

      await act(async () => {
        liberarLeitura(sessaoDaContaB());
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
        FRASE_LOGIN_MUDOU_NA_VISITANTE,
      );
    });

    it("sem internet na conferência: NÃO reenvia, diz 'Sem conexão' e o 'Tentar de novo' fica; com a rede de volta, reenvia com a MESMA chave", async () => {
      estado.libReal = true;
      let sessao: unknown = semNenhumaSessao();
      getSession.mockImplementation(async () => sessao);
      await ficarSemResposta();

      sessao = {
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      };
      await clicarTentarDeNovo();

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(FRASE_SEM_CONEXAO);
      // A compra congelada segue: o reenvio exato é a saída mais segura.
      expect(botaoTentarDeNovo()).not.toBeNull();
      expect(botaoFinalizar()!.disabled).toBe(true);

      sessao = semNenhumaSessao();
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await clicarTentarDeNovo();
      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(
        createOrder.mock.calls[0][0].idempotencyKey,
      );
    });

    // O reenvio da compra congelada só nasce para quem compra SEM conta
    // (`decidirSaidaDoCheckout`); a conferência é a MESMA função do Finalizar
    // e espera o dono da compra. Para a conta, a regra é a de sempre.
    it("a conferência do envio espera o dono da compra: conta A com a sessão virando B recusa como o Finalizar da conta", async () => {
      estado.libReal = true;
      const { conferirSessaoAntesDoEnvio } = await import(
        "@/views/customer/CheckoutView"
      );

      getSession.mockResolvedValue(sessaoDaContaB());
      expect(await conferirSessaoAntesDoEnvio("user-a")).toEqual({
        semRede: false,
        recusa: {
          acao: "entrar_na_conta",
          mensagem:
            "Sua sessão expirou. Entre de novo para finalizar o pedido.",
        },
      });
      expect(await conferirSessaoAntesDoEnvio(null)).toEqual({
        semRede: false,
        recusa: {
          acao: "tentar_de_novo",
          mensagem: FRASE_LOGIN_MUDOU_NA_VISITANTE,
        },
      });

      getSession.mockResolvedValue({
        data: { session: { user: { id: "user-a" } } },
        error: null,
      });
      expect(await conferirSessaoAntesDoEnvio("user-a")).toBeNull();
    });
  });

  // O LOGIN VELHO DO PRÓPRIO APARELHO (caça 28/11/2026). O app abriu sem
  // internet com o login vencido: a renovação falha por rede, o supabase-js
  // NÃO apaga a sessão guardada, e a tela trata a pessoa como visitante. A rede
  // volta, ela finaliza como visitante, e a conferência renova a sessão — que é
  // a DELA. Antes do #2070 o pedido saía na conta dela sem ela ver; depois, ela
  // ouvia "Sua sessão expirou. Entre de novo" e era levada ao login, logada.
  // Agora nada sai numa conta que ela não viu, a frase diz o que houve, e ela
  // fica no checkout: a renovação avisa o AuthContext, a tela passa a mostrar a
  // conta com o formulário preenchido, e o próximo Finalizar sai pela conta que
  // ela VÊ.
  describe("F) visitante com o login velho do aparelho renovado na conferência", () => {
    const sessaoDaDona = () => ({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    it("não envia, não fala em sessão expirada, não leva ao login, e o checkout continua preenchido", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue(sessaoDaDona());
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();

      expect(createOrder).not.toHaveBeenCalled();
      expect(String(toastError.mock.calls.at(-1)?.[0])).toBe(
        FRASE_LOGIN_MUDOU_NA_VISITANTE,
      );
      expect(document.body.textContent).not.toContain("sessão expirou");
      expect(
        document.querySelector('button[data-acao="entrar_na_conta"]'),
      ).toBeNull();
      expect(onNavigate).not.toHaveBeenCalled();
      expect(clearCart).not.toHaveBeenCalled();
      expect(
        (document.getElementById("checkout-name") as HTMLInputElement).value,
      ).toBe("Cliente Teste");
      expect(
        (document.getElementById("guest-street") as HTMLInputElement).value,
      ).toBe("Rua Teste");
      expect(botaoFinalizar()!.disabled).toBe(false);
    });

    it("a tela passa a mostrar a conta dela: os dados digitados continuam, e o próximo Finalizar sai pela conta que ela vê", async () => {
      estado.libReal = true;
      getSession.mockResolvedValue(sessaoDaDona());
      await abrirOApp();
      await preencherComoConvidada();
      await clicarFinalizar();
      expect(createOrder).not.toHaveBeenCalled();

      // A renovação avisou o AuthContext (TOKEN_REFRESHED): a tela é dela.
      estado.user = { id: "user-1" };
      estado.enderecos = [ENDERECO_DA_CONTA];
      await abrirOApp();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 420));
      });
      expect(
        (document.getElementById("checkout-name") as HTMLInputElement).value,
      ).toBe("Cliente Teste");

      await act(async () => {
        botaoPorTexto("Dinheiro na Entrega")?.click();
        await esperarMicrotarefas();
      });
      createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
      await clicarFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0].addressId).toBe("addr-1");
      expect(createOrder.mock.calls[0][1]).toEqual({
        comPagamentoOnline: false,
      });
    });
  });
});
