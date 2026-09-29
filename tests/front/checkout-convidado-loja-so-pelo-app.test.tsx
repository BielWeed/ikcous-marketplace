// @vitest-environment jsdom
//
// FORMAS DE PAGAMENTO POR LOJA (25/09/2026, migration 20261174000000) — A2/A9
// do crítico de desenho: uma loja que desligou as três formas na entrega
// (formasPagamentoEntrega = []) e vende só pelo app (pagamentoOnlineLigado
// = true) é um estado VÁLIDO (o pedido original do dono: "vender só com
// pagamento pelo app"). O que este arquivo prova, com o CheckoutView REAL
// (efeitos, guardas e render de verdade — só as fontes externas de dado são
// dublê, mesmo padrão do resto desta pasta) e não só as funções puras de
// guarda-de-frete.ts (que têm suíte própria em
// pagamento-incompativel-com-frete.test.ts):
//   1. o grupo "Na entrega/retirada" NUNCA aparece (lista vazia);
//   2. o `paymentMethod` NUNCA vira "online" para quem não tem conta — o
//      aviso de login aparece no lugar, nunca a Public Key/Brick do MP
//      (pagamento pelo app exige conta, P6, decisão do dono, não mexer);
//   3. o Finalizar fica desabilitado (nenhuma forma válida para um
//      convidado nesta loja);
//   4. a porta "Entrar ou criar conta" navega para "auth".
//
// Andaime copiado de checkout-convidado-so-compra-local.test.tsx (mesmo
// padrão de mocks desta pasta para o caso convidado) + o mock de
// @/lib/flags de checkout-chave-de-idempotencia-muda-com-o-eixo-do-
// pagamento.test.tsx (única forma de ligar pagamentoOnlineLigado() sem
// montar o SDK do Mercado Pago de verdade).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national",
    originCep: "38500-000",
    // A LOJA SÓ VENDE PELO APP: as três formas na entrega desligadas.
    formasPagamentoEntrega: [] as ("pix" | "card" | "cash")[],
  },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
  }),
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

// CONVIDADO de propósito — o assunto deste arquivo inteiro.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
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
    // Entrega LOCAL selecionada (não null): sem opção nenhuma, a guarda de
    // frete (`finalizarBloqueadoPorFrete`) já desabilita o Finalizar
    // sozinha e os avisos vermelhos da barra (região ~4340-4390) nem
    // chegam a avaliar `formaDePagamentoDesligada` — o teste da ANOTAÇÃO 2
    // (abaixo) precisa que o frete NÃO seja o motivo do bloqueio, para
    // provar que o aviso de pagamento por si só não contradiz o aviso de
    // login. `ehEntregaLocal` continua true com este id, então o aviso de
    // login (que também exige `!selectedShippingOption || ehEntregaLocal`)
    // segue satisfeito.
    selectedShippingOption: {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    },
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

// A LOJA TEM O PAGAMENTO PELO APP LIGADO — é essa combinação (formas na
// entrega vazias + online ligado) que faria um efeito mal escrito cair no
// fallback errado (selecionar "online" para quem não tem conta).
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// Nunca deveria ser alcançado por um convidado nesta loja — mockado para o
// import não tentar montar o SDK do Mercado Pago de verdade, e para que um
// eventual render dele (o BUG que este arquivo existe para pegar) apareça
// no DOM de um jeito que dá para consultar.
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => <div data-testid="pagamento-online-brick" />,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pegarBotaoFinalizar(): HTMLButtonElement {
  const botao = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement;
  expect(botao).toBeDefined();
  return botao;
}

describe("CheckoutView (convidado) — loja que vende só pelo app (formas na entrega desligadas)", () => {
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
    mockConfig.formasPagamentoEntrega = [];
  });

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
  }

  // A barra com o botão "Finalizar Pedido" é renderizada com atraso
  // proposital (useDeferredRender) — microtarefas não bastam.
  async function esperarBarra() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
  }

  it("o grupo 'Na entrega/retirada' não aparece, o aviso de login aparece no lugar, e o Brick do MP nunca monta para o convidado", async () => {
    await montar();
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain(
      "Para comprar nesta loja, entre na sua conta — o pagamento é feito pelo app",
    );
    expect(texto).not.toContain("Pix na Entrega");
    expect(texto).not.toContain("Cartão na Entrega");
    expect(texto).not.toContain("Dinheiro na Entrega");
    // A PROVA CENTRAL do A9: o convidado NUNCA fica com paymentMethod =
    // "online" selecionado — se ficasse, o componente do Brick do MP
    // montaria (mesmo que o pagamento pelo app dependa de conta, um efeito
    // mal escrito que selecionasse "online" por engano faria este nó
    // aparecer ANTES da barreira de login barrar o clique).
    expect(
      document.body.querySelector('[data-testid="pagamento-online-brick"]'),
    ).toBeNull();
  });

  // ANOTAÇÃO 2 da revisão Opus do commit 085282c3: o aviso vermelho
  // "escolha outra na lista acima" contradiz o aviso de login — não existe
  // NENHUMA lista acima para o convidado escolher (o grupo "Na entrega"
  // inteiro está ausente, provado no teste de cima). Os dois avisos juntos
  // mandam a pessoa em direções opostas no mesmo instante.
  it("o aviso vermelho 'escolha outra na lista acima' NÃO aparece junto do aviso de login (não existe lista para escolher)", async () => {
    await montar();
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain(
      "Para comprar nesta loja, entre na sua conta — o pagamento é feito pelo app",
    );
    expect(texto).not.toContain("escolha outra na lista acima");
  });

  it("o Finalizar fica desabilitado — nenhuma forma de pagamento válida para um convidado nesta loja", async () => {
    await montar();
    await esperarBarra();

    expect(pegarBotaoFinalizar().disabled).toBe(true);
  });

  it("a porta 'Entrar ou criar conta' navega para auth", async () => {
    await montar();
    await esperarBarra();

    const porta = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar ou criar conta"),
    ) as HTMLButtonElement;
    expect(porta).toBeDefined();
    await act(async () => {
      porta.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  it("EDGE CASE — a mesma loja com pix ainda ligado (não a última forma desligada): o grupo aparece normal, sem aviso de login", async () => {
    // Finalizar continua desabilitado nesta fixture MESMO com pix ligado —
    // por um eixo DIFERENTE (`finalizarBloqueadoPorFrete`: nenhuma opção de
    // frete selecionada, `selectedShippingOption: null` no mock de
    // useCart acima). Este teste prova só o eixo do PAGAMENTO: o aviso de
    // login que travava o caso anterior SOME quando sobra uma forma ligada.
    mockConfig.formasPagamentoEntrega = ["pix"];
    await montar();
    await esperarBarra();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain(
      "Para comprar nesta loja, entre na sua conta — o pagamento é feito pelo app",
    );
    expect(texto).toContain("Pix na Entrega");
  });
});
