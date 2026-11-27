// @vitest-environment jsdom
//
// ACESSIBILIDADE NO DINHEIRO (27/11/2026): o "Finalizar" fica `disabled`
// enquanto o pedido é enviado. O navegador tira o foco de um botão que fica
// desabilitado (regra de "focus fixup" do HTML: o foco volta ao <body>), então
// quando o envio era RECUSADO depois de uma espera (sessão, frete, carrinho,
// forma de pagamento, erro do banco) quem usa teclado ou leitor de tela ficava
// sem lugar nenhum: o próximo Tab recomeçava do topo da página e o motivo da
// recusa não estava perto do foco.
//
// Esperado: o foco vai para o que explica o problema — o painel da recusa
// quando ele aparece, os valores do pedido quando o total precisa ser
// conferido, a forma de pagamento marcada quando foi ela que mudou.
//
// O jsdom não faz o "focus fixup" (e o `blur()` dele ignora elemento
// desabilitado): o teste o imita em `imitarFocusFixup`, assim que o botão
// apaga, como o navegador faz.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

let liberarSessao: (valor: boolean) => void = () => {};
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () =>
    new Promise<boolean>((resolve) => {
      liberarSessao = resolve;
    }),
}));

vi.mock("@/components/ui/custom/ShippingCalculator", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/ui/custom/ShippingCalculator")
    >();
  return { ...real, ShippingCalculator: () => null };
});

// A config que a loja devolve AGORA: o teste troca o objeto inteiro.
const loja: { config: Record<string, unknown> } = { config: {} };
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
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
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

const mockUser = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

interface OpcaoDeTeste {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
}

const ENTREGA_PROPRIA: OpcaoDeTeste = {
  id: "local-delivery",
  name: "Entrega pela loja",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};

let freteEscolhido: OpcaoDeTeste | null = ENTREGA_PROPRIA;

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
            createdAt: new Date().toISOString(),
          },
          quantity: 1,
        },
      ],
      cartTotal: 100,
      shippingFee: freteEscolhido?.price ?? 0,
      clearCart,
      selectedShippingOption: freteEscolhido,
      shippingCep: "38500-000",
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

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function radio(rotulo: string): HTMLButtonElement {
  const achado = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ].find((b) => b.textContent?.includes(rotulo));
  if (!achado) throw new Error(`opção "${rotulo}" não está na tela`);
  return achado;
}

function botaoFinalizar(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '[aria-label="Finalizar pedido"]',
  )!;
}

// O que o navegador faz com o foco de um botão que acabou de ficar
// `disabled`: devolve ao <body>. Reabilita por um instante só para o `blur()`
// do jsdom agir, e devolve o `disabled` que o React pôs.
function imitarFocusFixup(botao: HTMLButtonElement) {
  expect(botao.disabled).toBe(true);
  botao.disabled = false;
  botao.blur();
  botao.disabled = true;
  expect(document.activeElement).toBe(document.body);
}

describe("CheckoutView — Finalizar recusado leva o foco ao problema", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    toastError.mockReset();
    liberarSessao = () => {};
    freteEscolhido = ENTREGA_PROPRIA;
    loja.config = {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
      formasPagamentoEntrega: ["pix", "card", "cash"],
    };
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
    });
  }

  // Foca o Finalizar, toca nele e imita o navegador: o botão apagou, o foco
  // cai no <body>. O envio PARA na conferência da sessão.
  async function iniciarEnvioPeloTeclado() {
    await renderizar();
    await act(async () => {
      radio("Pix na Entrega").click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    const botao = botaoFinalizar();
    expect(botao.disabled).toBe(false);
    botao.focus();
    expect(document.activeElement).toBe(botao);
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
    imitarFocusFixup(botao);
  }

  async function terminarASessao(vale = true) {
    await act(async () => {
      liberarSessao(vale);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  const valoresDoPedido = () =>
    document.querySelector<HTMLElement>(
      '[role="group"][aria-label="Valores do pedido"]',
    );
  const painelDaRecusa = () =>
    document.getElementById("checkout-saida-da-recusa");

  it("sessão que não vale: o foco vai para o painel da recusa (que diz o que fazer)", async () => {
    await iniciarEnvioPeloTeclado();
    await terminarASessao(false);

    expect(createOrder).not.toHaveBeenCalled();
    const painel = painelDaRecusa();
    expect(painel).not.toBeNull();
    expect(painel?.textContent).toContain("Não deu para fechar o pedido");
    expect(document.activeElement).toBe(painel);
  });

  it("o banco recusa o pedido: o foco vai para o painel da recusa", async () => {
    await iniciarEnvioPeloTeclado();
    createOrder.mockRejectedValue({
      code: "P0001",
      message: "Estoque insuficiente para o produto Produto Teste",
    });
    await terminarASessao();
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(painelDaRecusa());
    expect(painelDaRecusa()).not.toBeNull();
  });

  it("o frete muda no meio do envio: o foco vai para os valores do pedido (o aviso manda conferir o total)", async () => {
    await iniciarEnvioPeloTeclado();
    freteEscolhido = { ...ENTREGA_PROPRIA, price: 15 };
    await renderizar();
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "A forma de entrega mudou enquanto o pedido era enviado. Confira o total e finalize.",
    );
    expect(document.activeElement).toBe(valoresDoPedido());
    expect(valoresDoPedido()?.textContent).toContain("Total");
  });

  it("a forma de pagamento muda no meio do envio: o foco vai para a forma marcada agora", async () => {
    await iniciarEnvioPeloTeclado();
    loja.config = { ...loja.config, formasPagamentoEntrega: ["card", "cash"] };
    await renderizar();
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    const marcada = document.querySelector(
      '[role="radio"][aria-checked="true"]',
    );
    expect(marcada).not.toBeNull();
    expect(document.activeElement).toBe(marcada);
  });

  it("envio que dá certo não puxa o foco para os valores nem para a recusa", async () => {
    await iniciarEnvioPeloTeclado();
    createOrder.mockResolvedValue({ id: "ped-ok", totalAmount: 110 });
    await terminarASessao();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(valoresDoPedido());
    expect(painelDaRecusa()).toBeNull();
  });

  it("quem foi para outro campo durante a espera não tem o foco roubado", async () => {
    await iniciarEnvioPeloTeclado();
    const observacao = document.querySelector<HTMLTextAreaElement>("textarea");
    expect(observacao).not.toBeNull();
    observacao!.focus();
    await terminarASessao(false);

    expect(painelDaRecusa()).not.toBeNull();
    expect(document.activeElement).toBe(observacao);
  });

  it("o foco no painel não fica preso: o próximo envio recusado volta a levá-lo", async () => {
    await iniciarEnvioPeloTeclado();
    await terminarASessao(false);
    expect(document.activeElement).toBe(painelDaRecusa());

    // A cliente fecha o aviso e tenta de novo pelo teclado.
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Fechar o aviso"]')
        ?.click();
      await esperarMicrotarefas();
    });
    expect(painelDaRecusa()).toBeNull();
    const botao = botaoFinalizar();
    botao.focus();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    imitarFocusFixup(botao);
    await terminarASessao(false);
    expect(document.activeElement).toBe(painelDaRecusa());
  });
});
