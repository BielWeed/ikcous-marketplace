import type { CartItem, Product } from "@/types";
// @vitest-environment jsdom
//
// Peça 1 do pedido do Gabriel (12/09/2026): a barra de baixo do checkout
// ganha uma pílula com a ECONOMIA obtida (cupom + o que o frete grátis
// deixou de cobrar). A tabela que decide QUANDO existe economia de frete
// (e se ela precisa cotar a edge) mora em `src/lib/economia-do-frete.ts`
// (economia-do-frete-regra-pura.test.ts) e o efeito em
// `src/hooks/useEconomiaDoFreteExibida.ts`
// (economia-do-frete-cotacao-hook.test.tsx). Este arquivo prova a
// INTEGRAÇÃO com a tela: a pílula aparece com o valor certo, o painel de
// cima explica ela riscando o valor da Entrega, e — a trava mais cara —
// nada disto entra no pedido de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-1" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0.01, // FRETE_GRATIS_SEMPRE
    enableCoupons: true,
  },
}));

const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    freteGratis: true,
    selectedShippingOption: null as { id: string; name: string } | null,
    freteIndefinido: false,
  },
}));

const setSelectedShippingOption = vi.fn();
const setShippingCep = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

const mockAddresses = [
  {
    id: "addr-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "01310-100", // Av. Paulista — fora da cidade da loja (originCep acima)
    street: "Av Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    is_default: true,
  },
];

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: mockAddresses,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// 🔴 `user` PRECISA ser uma referência ESTÁVEL entre renders — um objeto
// literal criado direto dentro da factory (`() => ({ user: { id: "..." } })`)
// nasce DIFERENTE a cada chamada de `useAuth()`, e o `useEffect` de
// CheckoutView que sincroniza nome/whatsapp do perfil tem `user` na lista de
// dependências: com uma referência nova a cada render, esse efeito nunca
// para de disparar (`form.trigger()` reagenda o próximo render, que cria
// outro `user` novo, que dispara o efeito de novo — laço sem fim, sem erro
// nenhum do React porque cada volta passa por um commit separado). Mesmo
// padrão de `mockUser` em checkout-view-pix-confirmacao.test.tsx.
const mockUser = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    cartTotal: 0,
    shippingFee: 0,
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    shippingCep: null,
    setSelectedShippingOption,
    setShippingCep,
    ...mockUseCartOverrides,
  }),
}));

const { mockValidateCoupon } = vi.hoisted(() => ({
  mockValidateCoupon: vi.fn(),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: mockValidateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));
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
    price: overrides.price ?? 50,
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

async function esperarBarraMontar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

/** Debounce real da cotação de exibição (`DEBOUNCE_MS` em
 * useEconomiaDoFreteExibida.ts) + folga. */
async function esperarCotacao() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
}

function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Finalizar pedido",
  ) as HTMLButtonElement | undefined;
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

describe("CheckoutView — pílula de economia (cupom + frete grátis) na barra de baixo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  beforeEach(async () => {
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    createOrder.mockClear();
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    mockValidateCoupon.mockReset();
    mockInvoke.mockReset();
    setSelectedShippingOption.mockClear();
    setShippingCep.mockClear();
    mockConfig.shippingCoverage = "national";
    mockConfig.originCep = "38500-000";
    mockConfig.localCepRange = undefined;
    mockConfig.localDeliveryFee = 12.9;
    mockConfig.freeShippingMin = 0.01;
    mockUseCartOverrides.freteGratis = true;
    mockUseCartOverrides.selectedShippingOption = null;
    mockUseCartOverrides.freteIndefinido = false;
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
    slotDoHeader.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("CEP LOCAL com frete grátis: a pílula mostra o valor de localDeliveryFee, sem chamar a edge", async () => {
    mockConfig.originCep = "38500-000";
    const cart: CartItem[] = [
      { product: produto({ name: "Coxinha", price: 20 }), quantity: 1 },
    ];
    const enderecoLocal = { ...mockAddresses[0], cep: "38500-000" };
    mockAddresses[0] = enderecoLocal;

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={20}
          shipping={0}
          total={20}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
    await esperarCotacao();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    const linhaTotal = botaoFinalizar.closest(
      "div.flex.items-center.justify-between",
    )!;
    const pilula = linhaTotal.querySelector(
      '[aria-label^="Desconto de R$"]',
    ) as HTMLElement | null;
    expect(pilula).not.toBeNull();
    expect(pilula!.getAttribute("aria-label")).toBe("Desconto de R$ 12,90");
    expect(pilula!.textContent).toContain("12,90");
    expect(mockInvoke).not.toHaveBeenCalled();

    // Restaura para os próximos testes (mockAddresses é módulo compartilhado).
    mockAddresses[0] = { ...enderecoLocal, cep: "01310-100" };
  });

  it("fora da cidade, cotação da edge devolve a mais barata: pílula = cupom + frete; sem cupom, só o frete", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        options: [
          { id: "sedex", name: "Sedex", price: 45, deliveryDays: 3 },
          { id: "pac", name: "PAC", price: 30, deliveryDays: 7 },
        ],
      },
      error: null,
    });
    const cart: CartItem[] = [
      { product: produto({ name: "Camiseta", price: 80 }), quantity: 1 },
    ];

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={80}
          shipping={0}
          total={80}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
    await esperarCotacao();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    const linhaTotal = botaoFinalizar.closest(
      "div.flex.items-center.justify-between",
    )!;
    const pilula = () =>
      linhaTotal.querySelector(
        '[aria-label^="Desconto de R$"]',
      ) as HTMLElement | null;

    expect(pilula()).not.toBeNull();
    expect(pilula()!.getAttribute("aria-label")).toBe("Desconto de R$ 30,00");

    // Painel de cima: a linha Entrega risca o valor e mostra "Grátis".
    const gatilho = [...document.body.querySelectorAll("button")].find((b) =>
      b.hasAttribute("aria-expanded"),
    ) as HTMLButtonElement;
    await act(async () => {
      gatilho.click();
    });
    const painel = document.body.querySelector(
      '[role="dialog"][aria-label="Resumo do pedido"]',
    )!;
    const linhaEntrega = Array.from(painel.querySelectorAll("div")).find(
      (d) =>
        d.children.length === 2 &&
        d.children[0].textContent?.trim() === "Entrega",
    )!;
    expect(linhaEntrega.textContent).toContain("Grátis");
    expect(linhaEntrega.querySelector(".line-through")?.textContent).toContain(
      "30,00",
    );
  });

  it("sem economia nenhuma (freteGratis falso, sem cupom): a pílula não aparece", async () => {
    mockUseCartOverrides.freteGratis = false;
    const cart: CartItem[] = [
      { product: produto({ name: "Coxinha", price: 20 }), quantity: 1 },
    ];

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={20}
          shipping={8}
          total={28}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
    await esperarCotacao();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    const linhaTotal = botaoFinalizar.closest(
      "div.flex.items-center.justify-between",
    )!;
    expect(
      linhaTotal.querySelector('[aria-label^="Desconto de R$"]'),
    ).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("🔴 TRAVA DE DINHEIRO: cotação de exibição fora da cidade NUNCA chama setSelectedShippingOption/setShippingCep, e o pedido criado mantém shippingOptionId/destinationCep de antes", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        options: [{ id: "pac", name: "PAC", price: 30, deliveryDays: 7 }],
      },
      error: null,
    });
    const cart: CartItem[] = [
      { product: produto({ name: "Camiseta", price: 80 }), quantity: 1 },
    ];

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={80}
          shipping={0}
          total={80}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
    // A cotação de EXIBIÇÃO roda (mockInvoke chamado) — mas...
    await esperarCotacao();
    expect(mockInvoke).toHaveBeenCalled();
    // ...nunca escreve no estado de frete REAL do carrinho.
    expect(setSelectedShippingOption).not.toHaveBeenCalled();
    expect(setShippingCep).not.toHaveBeenCalled();

    // Preenche o mínimo para habilitar o Finalizar (endereço já auto-seleciona
    // o padrão; falta nome/telefone).
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const botaoFinalizar = localizarBotaoFinalizar()!;
    expect(botaoFinalizar.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedidoEnviado] = createOrder.mock.calls[0];
    // Mesmo comportamento de ANTES desta peça: sem opção de frete real
    // escolhida (frete grátis não passa pela ShippingCalculator), o pedido
    // sai com `shippingOptionId: null` e `destinationCep` igual ao
    // `shippingCep` do carrinho (aqui, `null`) — nunca o CEP da cotação de
    // EXIBIÇÃO nem uma opção que a exibição "escolheu".
    expect(pedidoEnviado.shippingOptionId).toBeNull();
    expect(pedidoEnviado.destinationCep).toBeNull();
    expect(setSelectedShippingOption).not.toHaveBeenCalled();
    expect(setShippingCep).not.toHaveBeenCalled();
  });
});
