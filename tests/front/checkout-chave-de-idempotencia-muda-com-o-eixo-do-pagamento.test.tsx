// @vitest-environment jsdom
//
// Fecha a tarefa chave-do-pedido-25 (achado 15/09/2026): a impressão digital
// da compra ganhou `paymentMethod` em `impressaoDaCompra`
// (src/lib/chave-do-pedido.ts), mas o ÚNICO chamador — este CheckoutView,
// linha ~1756 — não passava o campo. A correção morria antes de chegar à
// produção: gerava-se a MESMA chave trocando de meio de pagamento no mesmo
// carrinho, e a RPC devolvia o pedido gravado pelo OUTRO meio.
//
// Este arquivo cobre a metade que os testes puros de chave-do-pedido.ts não
// alcançam (eles testam a função isolada — ver
// tests/front/chave-do-pedido-inclui-meio-de-pagamento.test.ts): que o
// CheckoutView de fato PASSA o campo, e que passa só o EIXO que muda a RPC
// (`online` x `entrega`), não o método fino (pix/card/cash na entrega usam a
// MESMA RPC — invalidar a chave entre eles giraria pedido novo à toa numa
// retentativa legítima).
//
// Andaime copiado de checkout-view-pix-confirmacao.test.tsx (mesmos dublês —
// cliente LOGADO com endereço padrão já cadastrado, relógio falso — é o
// único jeito de alcançar "Pagar agora com PIX" sem cair na barreira de
// convidado, e o único deste arquivo que roda de verdade em menos de
// segundos nesta árvore).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// Referências ESTÁVEIS por fora dos mocks de propósito (achado desta própria
// tarefa, na hora de escrever o teste): um mock que devolve `{...}`/`[...]`
// literal NOVO a cada chamada muda de identidade a cada render, e um efeito
// do CheckoutView que dependa dessa identidade (array/objeto) reexecuta e
// gira estado a cada volta — loop de render infinito, sem erro nenhum no
// console (só trava o `act()`). O mesmo padrão já existe em
// checkout-view-pix-confirmacao.test.tsx (`mockCart`/`mockWhatsappNumber` por
// fora do `vi.mock`) — aqui não muda entre testes, então é `const`, não `let`.
const configDaLoja = {
  shippingCoverage: "local",
  originCep: "38500-000",
  enableCoupons: false,
  whatsappNumber: "34999998888",
};

const enderecoPadrao = {
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
const enderecos = [enderecoPadrao];

const usuarioLogado = { id: "user-1" };

const produtoDoCarrinho = {
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
const carrinho = [{ product: produtoDoCarrinho, quantity: 1 }];

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configDaLoja,
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: enderecos,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// Cliente LOGADO de propósito: só assim dá para exercitar os quatro meios de
// pagamento no mesmo teste — "Pagar agora com PIX" (online) navega para
// "auth" em vez de selecionar quando não há sessão (ver
// checkout-view-flag-on.test.tsx).
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: carrinho,
    cartTotal: 100,
    shippingFee: 0,
    clearCart,
    addToCart: vi.fn(),
    // ENTREGA LOCAL selecionada (regra frete × pagamento do dono,
    // 21/09/2026): a guarda do Finalizar (`finalizarBloqueadoPorFrete`)
    // passou a exigir a ESCOLHA de entrega — o servidor recusa id ausente
    // (FRETE V2 EMENDA, ELSIF do bloco 4). O assunto deste arquivo é outro;
    // sem a opção, o botão travaria por um motivo que ele não prova.
    selectedShippingOption: {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    },
    shippingCep: "38500-000",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Espalha o módulo REAL (mensagemAmigavelErroPedido incluída) e só troca o
// hook: o catch do CheckoutView chama `mensagemAmigavelErroPedido(error)`
// para a recusa "comum" que estes testes usam (não a assinatura de falha de
// rede) — um mock que a omitisse quebraria o clique em Finalizar.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
        }),
      }),
    }),
  },
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// Nunca alcançado nestes testes (createOrder sempre recusa antes de chegar
// na tela de pagamento online) — mockado só para o import não tentar montar
// o SDK do Mercado Pago de verdade.
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — a chave de idempotência acompanha o EIXO do meio de pagamento (chave-do-pedido-25)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    // Rejeita sempre com uma recusa "comum" (não a assinatura de falha de
    // rede) — o pedido NÃO é dado como criado, `onClearCart`/`esquecer()` não
    // rodam, e o mesmo carrinho pode ser reenviado várias vezes no mesmo
    // teste para comparar a chave a cada tentativa. Ver decidirSaidaDoCheckout
    // em CheckoutView.tsx: só a assinatura de rede vira `tentar_de_novo`.
    createOrder.mockRejectedValue({
      code: "23505",
      message: "erro genérico do banco, não é falha de rede",
    });
    updateOrderStatus.mockReset();
    clearCart.mockClear();
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
    const armazemSessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => armazemSessao.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazemSessao.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazemSessao.delete(chave);
      },
    });
    vi.useFakeTimers();
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

  async function montarEPreencher() {
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
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    // useDeferredRender(380) — o botão "Finalizar Pedido" só nasce depois
    // deste atraso deliberado (evita o flash de layout no primeiro paint).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(420);
    });
  }

  async function escolherMeioDePagamento(rotulo: string) {
    const botao = localizarBotaoPorTexto(hospedeiro, rotulo)!;
    await act(async () => {
      botao.click();
    });
  }

  async function clicarFinalizar() {
    const botao = localizarBotaoPorTexto(document.body, "Finalizar Pedido")!;
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  function chaveDaUltimaChamada(): string {
    const chamada = createOrder.mock.calls.at(-1);
    expect(chamada).toBeDefined();
    return chamada![0].idempotencyKey;
  }

  it("trocar de 'Pagar agora com PIX' (online) para 'Dinheiro na Entrega' (entrega), mesmo carrinho, gira chave DIFERENTE", async () => {
    await montarEPreencher();

    await escolherMeioDePagamento("Pagar agora com PIX");
    await clicarFinalizar();
    const chaveOnline = chaveDaUltimaChamada();

    await escolherMeioDePagamento("Dinheiro na Entrega");
    await clicarFinalizar();
    const chaveNaEntrega = chaveDaUltimaChamada();

    // Sem a correção (impressaoDaCompra chamada sem paymentMethod no
    // CheckoutView), as duas chaves seriam IGUAIS — a RPC devolveria para
    // quem está pagando na entrega o pedido gravado pelo pagamento online (ou
    // o contrário), com o status do OUTRO meio.
    expect(chaveNaEntrega).not.toBe(chaveOnline);
  });

  it("trocar entre 'Pix na Entrega' e 'Dinheiro na Entrega' (mesmo eixo 'entrega') NÃO gira chave nova — não invalida a chave à toa", async () => {
    await montarEPreencher();

    await escolherMeioDePagamento("Pix na Entrega");
    await clicarFinalizar();
    const chavePix = chaveDaUltimaChamada();

    await escolherMeioDePagamento("Dinheiro na Entrega");
    await clicarFinalizar();
    const chaveDinheiro = chaveDaUltimaChamada();

    // Os dois meios finos ("pix" e "cash" na entrega) gravam na MESMA RPC
    // (create_marketplace_order_v23) — só o eixo online/entrega decide qual
    // RPC recebe o pedido. Trocar entre pix/card/cash na entrega tem de
    // continuar sendo a MESMA retentativa aos olhos do servidor.
    expect(chaveDinheiro).toBe(chavePix);
  });
});
