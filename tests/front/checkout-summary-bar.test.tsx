import type { CartItem, Product } from "@/types";
// @vitest-environment jsdom
//
// Defeito medido (17/08/2026): três das quatro formas de pagamento do
// checkout são "na entrega" (Pix, cartão e dinheiro na porta), e a barra
// fixa do rodapé mostrava só o valor total, sem dizer o que tem dentro nem o
// que está sendo comprado. Esta suíte prova as três linhas novas da barra
// (item comprado, total — já existia, entrega inclusa) e o painel que abre
// ao tocar no bloco do total, listando os itens do carrinho com a conta
// batendo com subtotal + entrega - desconto.
//
// Mesmo padrão de tests/front/checkout-guest-cep.test.tsx: render de
// verdade (react-dom/client + jsdom), hooks de contexto trocados por
// dublês, e os valores de carrinho/total controlados via PROPS
// (propCart/propSubtotal/propShipping/propTotal) — não via o mock de
// useCart — porque são exatamente os valores que a barra e o painel têm que
// exibir sem inventar conta nova.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();

// Achado 5 da revisão (17/08/2026): a setinha e o fundo do painel passaram a
// fechar via `globalThis.history.back()` em vez de `setIsSummaryPanelOpen
// (false)` direto — quem fecha o painel de verdade é o `popstate` (medido:
// disparado de forma assíncrona por `history.back()`, mas antes de um
// `setTimeout(0)`) chamando o override que `onSetBackOverride` guardou, o
// mesmo mecanismo de `backOverrideRef` em App.tsx. Sem simular os dois
// junto, o teste anterior (que fechava direto pelo estado) ficaria
// verde ou vermelho por um motivo que não é o da produção.
let backOverride: (() => void) | null = null;
// Sem implementação aqui de propósito — `vi.restoreAllMocks()` no
// `afterEach` já existente neste arquivo zera a implementação de QUALQUER
// `vi.fn()`, mesmo a passada na criação. A implementação real é religada a
// cada `beforeEach`, senão só o primeiro teste do arquivo teria o mecanismo
// de fato funcionando.
const onSetBackOverride = vi.fn();
function fecharPeloPopstate() {
  backOverride?.();
}

// `mockValidateCoupon` precisa ser declarado via `vi.hoisted` porque
// `vi.mock` é hoisted acima dos imports — mesmo padrão de
// checkout-guest-cep.test.tsx e address-form-cep-race.test.tsx. Mutável de
// propósito: o caso de desconto (achado 7 da revisão) resolve um cupom
// válido; os demais casos nunca chamam a função.
const { mockValidateCoupon } = vi.hoisted(() => ({
  mockValidateCoupon: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    // `enableCoupons: true` — sem isto o bloco do cupom nem monta
    // (`config.enableCoupons &&` em CheckoutView.tsx), e o caso de desconto
    // do achado 7 não teria como aplicar um cupom.
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: true,
    },
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

// A barra e o painel são exibidos a partir dos PROPS do componente
// (propCart etc.), não deste mock — mas o componente sempre chama useCart()
// para addToCart/selectedShippingOption/shippingCep, então o dublê precisa
// existir mesmo assim.
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    cartTotal: 0,
    shippingFee: 0,
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: mockValidateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de CheckoutView.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(overrides: Partial<Product> = {}): Product {
  return {
    id: overrides.id ?? "prod-1",
    name: overrides.name ?? "Produto Teste",
    description: "",
    price: overrides.price ?? 10,
    images: overrides.images ?? [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Produto com uma variante cujo `priceOverride` é DIFERENTE do `price` do
 * produto — achado 7 da revisão: sem um caso assim, a fórmula do painel
 * (`item.variantId ? variante?.priceOverride || item.product.price : ...`)
 * podia virar `item.product.price` sem nenhum teste ficar vermelho. */
function produtoComVariante(overrides: Partial<Product> = {}): Product {
  const base = produto(overrides);
  return {
    ...base,
    variants: [
      {
        id: "var-1",
        productId: base.id,
        name: "Tamanho",
        value: "M",
        stockIncrement: 10,
        priceOverride: 44.5,
        active: true,
      },
    ],
  };
}

/** Digita num input controlado usando o setter nativo — `el.value = x` não
 * dispara o listener do React. Mesmo padrão de
 * tests/front/checkout-guest-cep.test.tsx. */
function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Espera o `useDeferredRender(380)` do CheckoutView resolver — a barra do
 * total só monta depois disso (mesmo padrão de
 * checkout-view-flag-off.test.tsx:199-203). */
async function esperarBarraMontar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em
 * vez de dormir um tempo fixo.
 *
 * Medido em 17/08/2026: com um `setTimeout(resolve, 260)` fixo depois do
 * clique que fecha o painel, `VITE_PAGAMENTO_ONLINE=false npx vitest run`
 * (a suíte de front INTEIRA, não este arquivo isolado) reprovava de forma
 * intermitente no caso "abre o painel" — não porque um nó do CASO ANTERIOR
 * sobrevivia ao `document.body` (o `beforeEach` desse caso sempre mediu 0
 * filhos no body, inclusive nas rodadas que reprovaram), mas porque a
 * saída animada do próprio painel (framer-motion, `exit`, 0.2s) depende do
 * `requestAnimationFrame` do jsdom progredir (via `setInterval` a 60Hz, em
 * tempo real) — e, com a suíte inteira disputando CPU, medido que essa
 * animação às vezes NUNCA termina de sair do body dentro de uma janela
 * generosa (15s, mais que a suíte inteira leva pra rodar), mesmo o ESTADO
 * já tendo fechado. Por isso este helper serve só para condições
 * SÍNCRONAS ao commit do React (ex.: um atributo `aria-*`) — nunca para
 * esperar um nó de `AnimatePresence` sair do DOM, porque essa condição não
 * é garantida a acontecer em tempo finito neste ambiente. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

// A barra e o painel nascem via `createPortal(..., document.body)` — não
// são descendentes do host de render.
function localizarBlocoDoTotal() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Total a Pagar"),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — barra do total mostra o que está sendo comprado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    backOverride = null;
    onSetBackOverride.mockImplementation((updater: unknown) => {
      backOverride =
        typeof updater === "function"
          ? (updater as () => (() => void) | null)()
          : null;
    });
    globalThis.addEventListener("popstate", fecharPeloPopstate);
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
    globalThis.removeEventListener("popstate", fecharPeloPopstate);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("com 1 item, mostra quantidade × nome do produto", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ name: "Coxinha de frango", price: 4.5 }),
        quantity: 2,
      },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={9}
          shipping={0}
          total={9}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    expect(document.body.textContent).toContain("2× Coxinha de frango");
  });

  it("com 2+ itens distintos, mostra a soma das quantidades", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ id: "p1", name: "Coxinha", price: 4.5 }),
        quantity: 2,
      },
      { product: produto({ id: "p2", name: "Pastel", price: 6 }), quantity: 1 },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={15}
          shipping={0}
          total={15}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    expect(document.body.textContent).toContain("3 itens no pedido");
    expect(document.body.textContent).not.toContain("Coxinha");
  });

  it("mostra o valor da entrega quando shipping > 0", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      { product: produto({ name: "Coxinha", price: 9 }), quantity: 1 },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={9}
          shipping={8}
          total={17}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    expect(document.body.textContent).toContain("Inclui R$ 8,00 de entrega");
    expect(document.body.textContent).not.toContain("Entrega grátis inclusa");
  });

  it("mostra 'Entrega grátis inclusa' quando shipping é zero", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      { product: produto({ name: "Coxinha", price: 9 }), quantity: 1 },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={9}
          shipping={0}
          total={9}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    expect(document.body.textContent).toContain("Entrega grátis inclusa");
    expect(document.body.textContent).not.toContain("Inclui R$");
  });

  it("um toque no bloco do total abre o painel com os itens e a conta batendo com subtotal + entrega", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ id: "p1", name: "Coxinha de frango", price: 4.5 }),
        quantity: 2,
      },
      {
        product: produto({ id: "p2", name: "Pastel de carne", price: 6 }),
        quantity: 1,
      },
    ];
    // subtotal (15) + shipping (5) = 20 = total, sem cupom (discount = 0).
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={15}
          shipping={5}
          total={20}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    // Painel fechado por padrão: itens individuais não aparecem na tela.
    expect(document.body.textContent).not.toContain("Pastel de carne");

    const bloco = localizarBlocoDoTotal();
    expect(bloco).toBeDefined();

    await act(async () => {
      bloco!.click();
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Coxinha de frango");
    expect(texto).toContain("Pastel de carne");
    // Subtotal, entrega e total exibidos são os PROPS recebidos — sem conta
    // nova: 15 (subtotal), 5 (entrega) e 20 (total = subtotal + shipping,
    // discount = 0 aqui).
    expect(texto).toContain("R$ 15,00");
    expect(texto).toContain("R$ 5,00");
    expect(texto).toContain("R$ 20,00");

    // Fecha pela setinha. Achado 5 da revisão: a setinha chama
    // `history.back()`, não fecha o estado direto — o `popstate`
    // (fecharPeloPopstate, simulando App.tsx) é quem invoca o override que
    // fecha o painel.
    //
    // Medido em 17/08/2026 (item 5 do relatório de execução): com
    // `VITE_PAGAMENTO_ONLINE=false npx vitest run` (suíte de front INTEIRA,
    // não este arquivo isolado), o texto "Pastel de carne" às vezes NUNCA
    // some de `document.body` — nem esperando 15s reais (mais que a suíte
    // inteira leva para rodar), embora o ESTADO já tenha fechado (o
    // `backOverride` volta a `null` logo depois do popstate, e o
    // `aria-expanded` do bloco abaixo já reflete isso). O sumiço do nó é
    // obra da saída animada do framer-motion, que depende do
    // `requestAnimationFrame` do jsdom progredir; sob a suíte inteira
    // disputando CPU, medido que ele pode nunca progredir o bastante para
    // aquele render terminar a animação. Por isso a prova de fechamento
    // aqui é sobre o ESTADO (`aria-expanded`, que o React atualiza no
    // commit, sem depender de animação) — não sobre o nó do portal ter
    // saído do body, que não é uma condição garantida a acontecer em tempo
    // finito neste ambiente.
    const setinha = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Fechar resumo do pedido",
    ) as HTMLButtonElement | undefined;
    expect(setinha).toBeDefined();
    await act(async () => {
      setinha!.click();
    });
    await esperarAte(() => bloco!.getAttribute("aria-expanded") === "false");
    expect(bloco!.getAttribute("aria-expanded")).toBe("false");
  });

  it("com item de variante e quantidade 2, o painel mostra o preço da variante (não o do produto), e o Subtotal fecha com a soma dos itens", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const produtoVariado = produtoComVariante({
      id: "p1",
      name: "Camiseta",
      price: 99, // decoy: se a fórmula do painel usar isto, o teste pega.
    });
    const cart: CartItem[] = [
      { product: produtoVariado, quantity: 2, variantId: "var-1" },
      {
        product: produto({ id: "p2", name: "Pastel de carne", price: 12.3 }),
        quantity: 1,
      },
    ];
    // Subtotal = 2 × 44,50 (priceOverride da variante) + 1 × 12,30 = 101,30
    // — mesmos números do exemplo em "O que NÃO mudar" do relatório.
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={101.3}
          shipping={10}
          total={111.3}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    const bloco = localizarBlocoDoTotal();
    await act(async () => {
      bloco!.click();
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("2 × R$ 44,50");
    expect(texto).not.toContain("2 × R$ 99,00");
    expect(texto).toContain("1 × R$ 12,30");
    expect(texto).toContain("R$ 101,30");
  });

  it("com cupom aplicado, o painel mostra a linha de Desconto e o Total abate o valor", async () => {
    mockValidateCoupon.mockResolvedValue({ valid: true, discount: 3 });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ id: "p1", name: "Coxinha", price: 15 }),
        quantity: 1,
      },
    ];
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={15}
          shipping={5}
          total={20}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    act(() => {
      digitar("coupon-code-input", "DESCONTO3");
    });
    const botaoAplicar = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === "Aplicar",
    ) as HTMLButtonElement | undefined;
    expect(botaoAplicar).toBeDefined();
    await act(async () => {
      botaoAplicar!.click();
      // `handleApplyCoupon` é assíncrono (`await validateCoupon(...)`) —
      // espera um macrotask para a Promise resolvida se propagar até o
      // `setAppliedCoupon`.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const bloco = localizarBlocoDoTotal();
    await act(async () => {
      bloco!.click();
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Desconto");
    expect(texto).toContain("-R$ 3,00");
    // Total = 20 (total prop) - 3 (desconto) = 17.
    expect(texto).toContain("R$ 17,00");
  });
});
