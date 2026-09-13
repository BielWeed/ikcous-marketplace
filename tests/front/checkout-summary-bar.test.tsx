import type { CartItem, Product } from "@/types";
// @vitest-environment jsdom
//
// D1 refinado (pedido do Gabriel, 12/09/2026, ditado com o print da tela no
// ar): o centro da barra SUPERIOR (onde fica a logo) tinha um espaço vazio
// — vira o gatilho do resumo (miniaturas + "N itens" + "ver mais"), portado
// para lá via `createPortal` no `HEADER_CENTER_SLOT_ID` que o Header expõe.
// Clicar nele abre o MESMO painel de sempre (lista de itens + Subtotal /
// Entrega / Desconto / Total), agora ancorado logo abaixo da barra
// superior em vez de subir da barra de baixo. A barra de baixo, por sua
// vez, perde "1x maleta..." e "Inclui R$ X de entrega" (foram para o
// gatilho/painel de cima) e fica só com Subtotal + Total + o botão
// "Finalizar" (era "Finalizar Pedido").
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

// Achado 5 da revisão (17/08/2026): a setinha e o fundo do painel fecham via
// `globalThis.history.back()` em vez de `setIsSummaryPanelOpen(false)`
// direto — quem fecha o painel de verdade é o `popstate` (disparado de
// forma assíncrona por `history.back()`) chamando o override que
// `onSetBackOverride` guardou, o mesmo mecanismo de `backOverrideRef` em
// App.tsx. Sem simular os dois junto, o teste ficaria verde ou vermelho por
// um motivo que não é o da produção.
let backOverride: (() => void) | null = null;
const onSetBackOverride = vi.fn();
function fecharPeloPopstate() {
  backOverride?.();
}

const { mockValidateCoupon } = vi.hoisted(() => ({
  mockValidateCoupon: vi.fn(),
}));

// `selectedShippingOption`/`freteIndefinido` mutáveis por teste (via
// `vi.hoisted`, porque `vi.mock` é hoisted acima dos imports — mesmo padrão
// de `mockValidateCoupon`): por padrão simula frete JÁ COTADO (opção
// selecionada), para os casos que testam o VALOR da entrega. Um caso
// dedicado zera a opção para provar "a calcular".
const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    selectedShippingOption: { id: "opcao-padrao", name: "Padrão" } as {
      id: string;
      name: string;
    } | null,
    freteIndefinido: false,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
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
    shippingCep: "",
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
    ...mockUseCartOverrides,
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
 * produto — achado 7 da revisão original: sem um caso assim, a fórmula do
 * painel (`item.variantId ? variante?.priceOverride || item.product.price
 * : ...`) podia virar `item.product.price` sem nenhum teste ficar
 * vermelho. */
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
 * checkout-view-flag-off.test.tsx:199-203). O gatilho do topo NÃO depende
 * disto (é portado assim que o carrinho existe), mas os testes continuam
 * esperando porque a maioria também confere a barra de baixo. */
async function esperarBarraMontar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em
 * vez de dormir um tempo fixo — mesmo helper e mesma ressalva de
 * `AnimatePresence`/`requestAnimationFrame` da versão anterior deste
 * arquivo: só serve para condições SÍNCRONAS ao commit do React (um
 * atributo `aria-*`), nunca para esperar um nó do portal sair do DOM. */
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

/** O gatilho do resumo (miniaturas + "N itens" + "ver mais") é PORTADO para
 * o slot do Header — não é descendente do host de render, e o Header real
 * não está montado nestes testes. Achamos pelo `aria-expanded`, único
 * atributo exclusivo dele (o botão "Finalizar" não tem). */
function localizarGatilhoDoResumo() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.hasAttribute("aria-expanded"),
  ) as HTMLButtonElement | undefined;
}

function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Finalizar pedido",
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — gatilho do resumo no topo, painel e barra de baixo compacta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  beforeEach(async () => {
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    mockUseCartOverrides.selectedShippingOption = {
      id: "opcao-padrao",
      name: "Padrão",
    };
    mockUseCartOverrides.freteIndefinido = false;
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

    // Simula o ponto de encaixe que o Header (lazy, não montado nestes
    // testes) expõe no centro da barra superior — mesmo ID que
    // `HEADER_CENTER_SLOT_ID` (Header.tsx), provado separadamente em
    // tests/front/header-center-slot.test.tsx.
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    globalThis.removeEventListener("popstate", fecharPeloPopstate);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carrinho vazio: o gatilho do topo não aparece", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={[]}
          subtotal={0}
          shipping={0}
          total={0}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    expect(localizarGatilhoDoResumo()).toBeUndefined();
  });

  it("com 1 produto de quantidade 1, o gatilho mostra '1 item' (singular) e uma miniatura com a foto do produto", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({
          name: "Coxinha de frango",
          price: 4.5,
          images: ["https://loja.example/coxinha.jpg"],
        }),
        quantity: 1,
      },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={4.5}
          shipping={0}
          total={4.5}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    const gatilho = localizarGatilhoDoResumo();
    expect(gatilho).toBeDefined();
    expect(gatilho!.textContent).toContain("1 item");
    expect(gatilho!.textContent).not.toContain("2 item");
    expect(gatilho!.textContent).toContain("ver mais");

    const imagens = gatilho!.querySelectorAll("img");
    expect(imagens).toHaveLength(1);
    expect(imagens[0].getAttribute("src")).toBe(
      "https://loja.example/coxinha.jpg",
    );
  });

  it("produto sem foto: círculo neutro no gatilho, nunca um <img> com src vazio", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      { product: produto({ name: "Sem Foto", images: [] }), quantity: 1 },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={10}
          shipping={0}
          total={10}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    const gatilho = localizarGatilhoDoResumo();
    expect(gatilho).toBeDefined();
    // Nenhuma tag <img> — nem uma com `src=""` (dispararia requisição para
    // a própria URL da página).
    expect(gatilho!.querySelectorAll("img")).toHaveLength(0);
  });

  it("com 2 produtos distintos, o gatilho soma as quantidades e mostra 'N itens' (plural)", async () => {
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

    const gatilho = localizarGatilhoDoResumo();
    expect(gatilho).toBeDefined();
    expect(gatilho!.textContent).toContain("3 itens");
    // Nome dos produtos fica só no painel (fechado por padrão) — o gatilho
    // não repete a lista.
    expect(gatilho!.textContent).not.toContain("Coxinha");
  });

  it("com 4 produtos distintos, mostra só 2 miniaturas com foto e a 3ª vira '+N'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ id: "p1", images: ["https://loja.example/1.jpg"] }),
        quantity: 1,
      },
      {
        product: produto({ id: "p2", images: ["https://loja.example/2.jpg"] }),
        quantity: 1,
      },
      {
        product: produto({ id: "p3", images: ["https://loja.example/3.jpg"] }),
        quantity: 1,
      },
      {
        product: produto({ id: "p4", images: ["https://loja.example/4.jpg"] }),
        quantity: 1,
      },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={40}
          shipping={0}
          total={40}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    const gatilho = localizarGatilhoDoResumo();
    expect(gatilho).toBeDefined();
    // 4 produtos distintos: até 3 miniaturas, mas a partir do 4º produto a
    // ÚLTIMA vira "+N" — sobram 2 fotos + 1 bolha "+2".
    expect(gatilho!.querySelectorAll("img")).toHaveLength(2);
    expect(gatilho!.textContent).toContain("+2");
  });

  it("achado 3 do bloqueante (12/09/2026): com a cápsula de aviso do sino ativa, o gatilho recolhe para só as miniaturas — texto sai do DOM, nome acessível migra para aria-label", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({
          id: "p1",
          name: "Coxinha",
          images: ["https://loja.example/coxinha.jpg"],
        }),
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

    const gatilho = localizarGatilhoDoResumo();
    expect(gatilho).toBeDefined();
    expect(gatilho!.textContent).toContain("ver mais");
    expect(gatilho!.getAttribute("aria-label")).toBeNull();

    // Mesmo evento global que o Header escuta para abrir a cápsula de
    // aviso do sino (src/utils/headerToast.ts) — duração curta (80ms) para
    // não segurar o teste.
    await act(async () => {
      globalThis.dispatchEvent(
        new CustomEvent("header-toast-event", {
          detail: { id: "t1", message: "Pedido salvo", duration: 80 },
        }),
      );
    });

    // Miniatura continua visível (a foto não pode sumir), mas o texto "N
    // itens"/"ver mais" tem que sair do DOM — não só ficar cortado.
    expect(gatilho!.querySelectorAll("img")).toHaveLength(1);
    expect(gatilho!.textContent).not.toContain("ver mais");
    expect(gatilho!.textContent).not.toContain("item");
    // Nome acessível não pode desaparecer junto com o texto visível.
    expect(gatilho!.getAttribute("aria-label")).toBe(
      "2 itens, ver mais, toque para ver os detalhes do pedido",
    );

    // Depois que a cápsula do sino fecha sozinha (duração vencida), o
    // gatilho tem que voltar ao normal — a compactação é temporária, presa
    // ao aviso, não um estado que gruda. Espera de verdade (não
    // `esperarAte`, feito para condição SÍNCRONA ao commit — aqui quem
    // dispara a mudança é um `setTimeout` da própria app, já agendado
    // ANTES deste `act`, e não uma reação síncrona a um evento disparado
    // DENTRO dele).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(gatilho!.textContent).toContain("ver mais");
    expect(gatilho!.getAttribute("aria-label")).toBeNull();
  });

  it("um toque no gatilho do topo abre o painel com os itens e a conta batendo com subtotal + entrega", async () => {
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

    const gatilho = localizarGatilhoDoResumo();
    expect(gatilho).toBeDefined();
    expect(gatilho!.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      gatilho!.click();
    });

    expect(gatilho!.getAttribute("aria-expanded")).toBe("true");
    expect(gatilho!.textContent).toContain("ver menos");

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Coxinha de frango");
    expect(texto).toContain("Pastel de carne");
    expect(texto).toContain("R$ 15,00");
    expect(texto).toContain("R$ 5,00");
    expect(texto).toContain("R$ 20,00");

    // Fecha pela setinha. Achado 5 da revisão original: a setinha chama
    // `history.back()`, não fecha o estado direto.
    const setinha = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Fechar resumo do pedido",
    ) as HTMLButtonElement | undefined;
    expect(setinha).toBeDefined();
    await act(async () => {
      setinha!.click();
    });
    await esperarAte(() => gatilho!.getAttribute("aria-expanded") === "false");
    expect(gatilho!.getAttribute("aria-expanded")).toBe("false");
  });

  it("sem cotação válida para o endereço atual, a linha de Entrega do painel mostra 'a calcular' — nunca um valor antigo", async () => {
    // `selectedShippingOption: null` + `freteIndefinido: true` é exatamente
    // `semFreteSelecionado` (guarda-de-frete.ts): sem opção escolhida e sem
    // cotação definida. O `shipping` de 15 aqui simula um valor de
    // FALLBACK antigo que NÃO pode aparecer.
    mockUseCartOverrides.selectedShippingOption = null;
    mockUseCartOverrides.freteIndefinido = true;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ id: "p1", name: "Coxinha", price: 9 }),
        quantity: 1,
      },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={9}
          shipping={15}
          total={9}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("a calcular");
    expect(texto).not.toContain("R$ 15,00");
  });

  it("achado 1 do bloqueante (12/09/2026): sem cotação válida, o TOTAL da barra de baixo E do painel mostram 'a calcular' — nunca um total fechado com frete tratado como zero", async () => {
    // Reproduz o cenário exato do achado: endereço sem cotação válida e
    // carrinho de R$ 100. Em produção (sem props) `total` sai de
    // `ctxSubtotal + (ctxFreteIndefinido ? 0 : ctxShipping)`
    // (CheckoutView.tsx:349-350) — com frete indefinido isso já fecha em
    // 100 (frete tratado como zero). `total={100}` aqui simula esse valor
    // exatamente como a produção o calcularia, para isolar o que o achado
    // aponta: mesmo com esse total "fechado" chegando pronto, a EXIBIÇÃO
    // não pode tratá-lo como definitivo quando `semFreteSelecionado`.
    mockUseCartOverrides.selectedShippingOption = null;
    mockUseCartOverrides.freteIndefinido = true;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ id: "p1", name: "Produto caro", price: 100 }),
        quantity: 1,
      },
    ];

    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={100}
          shipping={0}
          total={100}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();

    // Barra de baixo: Subtotal fecha em 100, mas o TOTAL não pode aparecer
    // fechado — antes da correção ele mostrava "R$ 100,00", passando a
    // impressão de frete grátis com conta encerrada.
    expect(document.body.textContent).toContain("Subtotal");
    expect(document.body.textContent).toContain("R$ 100,00");
    expect(document.body.textContent).toContain("a calcular");

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });

    // A afirmação é SOBRE O PAINEL, não sobre o corpo inteiro: contar no
    // corpo somava o "a calcular" do Total da barra de baixo com o da
    // Entrega do painel e dava 2 mesmo com o Total do painel mostrando
    // "R$ 100,00" (mutante medido pela revisão de 12/09/2026, 17/17 verde).
    // A afirmação lê a LINHA de cada rótulo (Entrega, Total), porque
    // "R$ 100,00" aparece legitimamente no item e no Subtotal.
    const painel = document.body.querySelector(
      '[role="dialog"][aria-label="Resumo do pedido"]',
    );
    expect(painel).not.toBeNull();
    const valorDaLinha = (rotulo: string) => {
      const linha = Array.from(painel!.querySelectorAll("div")).find(
        (d) =>
          d.children.length === 2 &&
          d.children[0].textContent?.trim() === rotulo,
      );
      expect(linha, `linha "${rotulo}" no painel`).toBeDefined();
      return linha!.children[1].textContent?.trim();
    };
    expect(valorDaLinha("Entrega")).toBe("a calcular");
    expect(valorDaLinha("Total")).toBe("a calcular");
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
    // Subtotal = 2 × 44,50 (priceOverride da variante) + 1 × 12,30 = 101,30.
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

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
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
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });

    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Desconto");
    expect(texto).toContain("-R$ 3,00");
    // Total = 20 (total prop) - 3 (desconto) = 17.
    expect(texto).toContain("R$ 17,00");
  });

  it("focar um campo do formulário fecha o painel (teclado do celular + painel aberto não cabem juntos)", async () => {
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

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });
    expect(gatilho!.getAttribute("aria-expanded")).toBe("true");

    const campoNome = document.getElementById(
      "checkout-name",
    ) as HTMLInputElement;
    expect(campoNome).not.toBeNull();
    await act(async () => {
      campoNome.focus();
      // `onFocusCapture` chama `history.back()` (não fecha o estado
      // direto) — mesmo motivo de sempre: consumir a entrada do
      // `pushState`. O `popstate` chega de forma assíncrona.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await esperarAte(() => gatilho!.getAttribute("aria-expanded") === "false");
    expect(gatilho!.getAttribute("aria-expanded")).toBe("false");
    // O foco tem que FICAR no campo — fechar o painel não pode roubar o
    // foco de volta para o gatilho no meio da digitação.
    expect(document.activeElement).toBe(campoNome);
  });

  it("achado 2 do bloqueante (12/09/2026): um toque de VERDADE (pointerdown, não campo.focus() direto) fora do painel fecha o painel E chega ao campo por baixo, numa entrada SÓ do histórico", async () => {
    // O teste acima (`campoNome.focus()` direto) pula o fundo que comia o
    // toque — não prova o pedido, só o efeito colateral do foco. Este
    // reproduz a ORDEM real do navegador: `pointerdown` primeiro (o
    // listener de captura do achado 2 fecha o painel SEM
    // `preventDefault`/`stopPropagation`), e só then o próprio toque move
    // o foco para o campo como ação padrão do navegador — que aqui é
    // simulado chamando `.focus()` logo depois, porque o jsdom não executa
    // essa ação padrão sozinho a partir de um `dispatchEvent` sintético.
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

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });
    expect(gatilho!.getAttribute("aria-expanded")).toBe("true");

    const campoNome = document.getElementById(
      "checkout-name",
    ) as HTMLInputElement;
    expect(campoNome).not.toBeNull();

    // Espia `history.back()` diretamente — a contagem de `popstate` (versão
    // anterior deste teste) fica em 1 no jsdom mesmo com DOIS `back()`
    // disparados na mesma volta de evento (jsdom colapsa popstates
    // síncronos), o que deixava passar sem alarme os mutantes m4 (guarda
    // `fechandoPorFocoDoFormularioRef` removida — dois `history.back()` na
    // mesma interação) e m7 (o `pointerdown` desligado, e só o `.focus()`
    // manual do teste fecha o painel sozinho). `toHaveBeenCalledTimes`
    // conta as CHAMADAS de verdade, não o resultado colapsado.
    const historyBackSpy = vi.spyOn(globalThis.history, "back");

    const evento = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      campoNome.dispatchEvent(evento);
      campoNome.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Sem `preventDefault`/`stopPropagation` — é isto que deixa o MESMO
    // toque continuar até o elemento de baixo (aqui, o próprio foco nativo
    // do campo; no "Editar" do endereço seria o `onClick` do botão).
    expect(evento.defaultPrevented).toBe(false);

    await esperarAte(() => gatilho!.getAttribute("aria-expanded") === "false");
    expect(gatilho!.getAttribute("aria-expanded")).toBe("false");
    // O MESMO toque fecha o painel E deixa o foco no campo — sem precisar
    // de uma segunda tentativa.
    expect(document.activeElement).toBe(campoNome);
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
  });

  it("achado 2 do bloqueante (12/09/2026): um toque num elemento NÃO focável fora do painel fecha sozinho, sem depender de `.focus()` — prova o `pointerdown` isolado do foco", async () => {
    // O teste acima segue foco em `campoNome`, e `campoNome.focus()`
    // sozinho já fecha o painel pelo `onFocusCapture` — se o listener de
    // `pointerdown` estivesse desligado (mutante m7), aquele teste
    // continuaria verde. Aqui o alvo do toque (`document.body`) não é
    // focável: nada chama `.focus()`, então só o `pointerdown` pode fechar.
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

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });
    expect(gatilho!.getAttribute("aria-expanded")).toBe("true");

    const historyBackSpy = vi.spyOn(globalThis.history, "back");
    const evento = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.body.dispatchEvent(evento);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await esperarAte(() => gatilho!.getAttribute("aria-expanded") === "false");
    expect(gatilho!.getAttribute("aria-expanded")).toBe("false");
    expect(historyBackSpy).toHaveBeenCalledTimes(1);
  });

  it("achado 1 do bloqueante (12/09/2026): clicar de novo no gatilho ('ver menos') fecha por history.back(), não por setState direto — sem entrada de histórico órfã", async () => {
    // Antes da correção, `onToggle` alternava o estado direto nos dois
    // sentidos: abrir empurrava uma entrada (efeito de `isSummaryPanelOpen`),
    // mas fechar por aqui NUNCA consumia essa entrada — ela ficava órfã, e
    // um "voltar" físico do celular, depois de fechar pelo gatilho, não
    // fazia nada visível. Este teste prova o caminho que passou a ser
    // usado: o MESMO `history.back()` da setinha, do Escape e do toque
    // fora.
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

    const gatilho = localizarGatilhoDoResumo();
    await act(async () => {
      gatilho!.click();
    });
    expect(gatilho!.getAttribute("aria-expanded")).toBe("true");

    const historyBackSpy = vi.spyOn(globalThis.history, "back");
    await act(async () => {
      gatilho!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(historyBackSpy).toHaveBeenCalledTimes(1);
    await esperarAte(() => gatilho!.getAttribute("aria-expanded") === "false");
    expect(gatilho!.getAttribute("aria-expanded")).toBe("false");
  });

  it("barra de baixo: mostra Subtotal e Total, e o botão 'Finalizar' compacto (sem '1x ...' nem 'Inclui R$ ... de entrega')", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const cart: CartItem[] = [
      {
        product: produto({ name: "Maleta de canetas coloridas", price: 9 }),
        quantity: 1,
      },
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

    const botaoFinalizar = localizarBotaoFinalizar();
    expect(botaoFinalizar).toBeDefined();
    // Texto VISÍVEL compacto — "Finalizar", não "Finalizar Pedido" (o nome
    // completo continua acessível via `aria-label`, já usado para achar o
    // botão acima).
    const spanVisivel = botaoFinalizar!.querySelector("span:not(.sr-only)");
    expect(spanVisivel?.textContent).toBe("Finalizar");
    // `textContent` do botão inteiro segue contendo "Finalizar Pedido"
    // (span `sr-only` completando), de propósito: mantém toda suíte antiga
    // que procura o botão por esse texto funcionando.
    expect(botaoFinalizar!.textContent).toContain("Finalizar Pedido");

    expect(document.body.textContent).not.toContain("1× Maleta");
    expect(document.body.textContent).not.toContain("Inclui R$");
    expect(document.body.textContent).not.toContain("TOTAL A PAGAR");

    expect(document.body.textContent).toContain("Subtotal");
    expect(document.body.textContent).toContain("R$ 9,00");
    // "Total" aparece na barra de baixo — sem abrir o painel, "R$ 17,00" já
    // está visível (produtos + frete, sem desconto).
    expect(document.body.textContent).toContain("R$ 17,00");
  });

  it("a barra de baixo não fica mais alta do que antes (2 linhas de texto, sem o antigo bloco de 3-4 linhas)", async () => {
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

    const botaoFinalizar = localizarBotaoFinalizar();
    // A coluna de Subtotal/Total é irmã do botão, dentro do mesmo container
    // `flex items-center justify-between` — subimos até achar esse
    // container e contamos as LINHAS internas da coluna de texto (a prova
    // de altura em pixels de verdade é medição no navegador, registrada no
    // relatório; jsdom não faz layout).
    const linha = botaoFinalizar!.closest(
      "div.flex.items-center.justify-between",
    );
    expect(linha).not.toBeNull();
    const colunaDeTexto = linha!.querySelector("div.flex-col");
    expect(colunaDeTexto).not.toBeNull();
    expect(colunaDeTexto!.children).toHaveLength(2);
  });
});
