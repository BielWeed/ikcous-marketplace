import type { CartItem, Product, ShippingOption } from "@/types";
// @vitest-environment jsdom
//
// A barra e o painel usam a mesma convenção: economia do frete no preço
// riscado da Entrega, Desconto só do cupom. A conta visível fecha no Total.
// A origem da economia continua em `src/lib/economia-do-frete.ts` e
// `src/hooks/useEconomiaDoFreteExibida.ts`: exibi-la não pode mudar o pedido.
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
    // ENTREGA LOCAL GRÁTIS selecionada por padrão (regra frete × pagamento
    // do dono, 21/09/2026): `finalizarBloqueadoPorFrete` passou a exigir a
    // ESCOLHA de entrega (o servidor recusa id ausente — FRETE V2 EMENDA,
    // ELSIF do bloco 4), e sem ela a barra mostra "a calcular" em vez dos
    // totais que ESTE arquivo audita. A opção de price 0 preserva o cenário
    // de frete grátis que a barra precisa explicar.
    selectedShippingOption: {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    } as ShippingOption | null,
    freteIndefinido: false,
  },
}));

const setSelectedShippingOption = vi.fn();
const setShippingCep = vi.fn();

// A calculadora de frete do checkout (cotação automática pelo endereço)
// tem suíte própria (shipping-calculator-*.test.tsx e
// checkout-frete-automatico-*.test.tsx). Aqui ela é neutra: não cota, não
// mexe na opção de frete que o teste preparou e não reporta status.
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

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

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: null,
      setSelectedShippingOption,
      setShippingCep,
      ...mockUseCartOverrides,
    })),
  };
});

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

describe("CheckoutView — economia do frete e conta visível na barra de baixo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  beforeEach(async () => {
    sessionStorage.clear();
    // 🔴 AJUSTE 2 (revisão Opus): o cache de cotação de exibição agora mora
    // no MÓDULO (sobrevive à desmontagem, de propósito). Mais de um teste
    // aqui usa o MESMO CEP (01310-100, de `mockAddresses`) com o MESMO
    // carrinho (produto "prod-1", quantidade 1) — sem limpar entre testes,
    // o 2º teste "herdaria" a cotação do 1º e nunca chamaria a edge de
    // novo, mascarando exatamente o que a TRAVA DE DINHEIRO abaixo precisa
    // provar (`mockInvoke` chamado de verdade nesta cotação).
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
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
    mockUseCartOverrides.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    };
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

  afterEach(async () => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    {
      nome: "frete grátis com economia e cupom",
      shipping: 0,
      gratis: true,
      retirada: false,
    },
    {
      nome: "entrega paga com cupom",
      shipping: 10,
      gratis: false,
      retirada: false,
    },
    { nome: "retirada com cupom", shipping: 0, gratis: false, retirada: true },
  ])(
    "a conta exibida na barra fecha: $nome",
    async ({ shipping, gratis, retirada }) => {
      mockConfig.freeShippingMin = gratis ? 50 : 0;
      mockUseCartOverrides.freteGratis = gratis;
      mockUseCartOverrides.selectedShippingOption = {
        id: retirada ? "store-pickup" : "local-delivery",
        name: retirada ? "Retirar na loja" : "Entrega Local",
        price: shipping,
        deliveryDays: 1,
        provider: "local",
      };
      mockInvoke.mockResolvedValue({
        data: {
          options: [{ id: "pac", name: "PAC", price: 10, deliveryDays: 7 }],
        },
        error: null,
      });
      mockValidateCoupon.mockResolvedValue({ valid: true, discount: 5 });
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await act(async () => {
        raiz.render(
          <CheckoutView
            cart={[{ product: produto({ price: 80 }), quantity: 1 }]}
            subtotal={80}
            shipping={shipping}
            total={80 + shipping}
            onNavigate={onNavigate}
            onSetBackOverride={onSetBackOverride}
          />,
        );
      });
      await esperarBarraMontar();
      await esperarCotacao();
      act(() => digitar("coupon-code-input", "CUPOM5"));
      await act(async () => {
        [...document.body.querySelectorAll("button")]
          .find((b) => b.textContent === "Aplicar")!
          .click();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const barra = localizarBotaoFinalizar()!.closest(
        ".bottom-docked-navigation",
      )!;
      const valores = barra.querySelector('[aria-label="Valores do pedido"]')!;
      const valorDaLinha = (rotulo: string) => {
        const linha = [...valores.querySelectorAll("div")].find(
          (el) => el.firstElementChild?.textContent === rotulo,
        )!;
        return linha.lastElementChild as HTMLElement;
      };
      const entrega = valorDaLinha("Entrega");
      if (gratis) {
        expect(entrega.textContent).toContain("Grátis");
        const riscado = entrega.querySelector(".line-through")!;
        expect(riscado.textContent).toContain("R$ 10,00");
        expect(riscado.classList.contains("text-zinc-500")).toBe(true);
        expect(
          [...entrega.querySelectorAll(".sr-only")].map((el) =>
            el.textContent?.trim(),
          ),
        ).toEqual(["de", "por"]);
      } else {
        expect(entrega.querySelector(".line-through")).toBeNull();
      }
      expect(valorDaLinha("Desconto").textContent).toBe("-R$ 5,00");
      const centavosVisiveis = (elemento: HTMLElement) => {
        const copia = elemento.cloneNode(true) as HTMLElement;
        copia.querySelectorAll(".line-through").forEach((el) => el.remove());
        if (copia.textContent?.includes("Grátis")) return 0;
        const numero = copia.textContent!.match(/R\$\s*([\d.,]+)/)![1];
        return Math.round(
          Number(numero.replaceAll(".", "").replace(",", ".")) * 100,
        );
      };
      expect(
        centavosVisiveis(valorDaLinha("Subtotal")) +
          centavosVisiveis(entrega) -
          centavosVisiveis(valorDaLinha("Desconto")),
      ).toBe(centavosVisiveis(valorDaLinha("Total")));
      expect(centavosVisiveis(valorDaLinha("Total"))).toBe(
        (75 + shipping) * 100,
      );
    },
  );

  it("CEP LOCAL com frete grátis: Entrega risca localDeliveryFee, sem chamar a edge", async () => {
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
    const linhaTotal = botaoFinalizar.closest(".bottom-docked-navigation")!;
    const entrega = linhaTotal.querySelector(".line-through")!;
    expect(entrega.textContent).toContain("12,90");
    expect(linhaTotal.textContent).toContain("Grátis");
    expect(
      linhaTotal.querySelector('[aria-label^="Desconto de R$"]'),
    ).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();

    // Restaura para os próximos testes (mockAddresses é módulo compartilhado).
    mockAddresses[0] = { ...enderecoLocal, cep: "01310-100" };
  });

  it("fora da cidade, Entrega risca a cotação mais barata, sem desconto de cupom inexistente", async () => {
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
    const linhaTotal = botaoFinalizar.closest(".bottom-docked-navigation")!;
    expect(linhaTotal.querySelector(".line-through")?.textContent).toContain(
      "30,00",
    );
    expect(linhaTotal.textContent).toContain("Grátis");
    expect(
      linhaTotal.querySelector('[aria-label^="Desconto de R$"]'),
    ).toBeNull();

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

  it("sem economia nenhuma (freteGratis falso, sem cupom): Desconto não aparece", async () => {
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
    const linhaTotal = botaoFinalizar.closest(".bottom-docked-navigation")!;
    expect(
      linhaTotal.querySelector('[aria-label^="Desconto de R$"]'),
    ).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  // T3 (23/09/2026): a opção NACIONAL já ESCOLHIDA carrega a própria
  // economia (`precoCheio − price`) -- linha 0 de `modoDeEconomiaDoFrete`.
  // Cenário de DESCONTO (não grátis): `freteGratis` é falso (o preço final
  // é positivo), mas a linha "Entrega" ainda precisa explicar
  // o desconto -- SEM cotar a edge de novo (a fonte é a própria opção).
  it("opção NACIONAL com desconto da loja (não grátis): Entrega risca o cheio e mostra o preço pago, sem chamar a edge de novo", async () => {
    mockUseCartOverrides.freteGratis = false;
    mockUseCartOverrides.selectedShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC com desconto da loja",
      price: 20,
      precoCheio: 35,
      deliveryDays: 8,
      provider: "melhor_envio",
    };
    const cart: CartItem[] = [
      { product: produto({ name: "Camiseta", price: 80 }), quantity: 1 },
    ];

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={80}
          shipping={20}
          total={100}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
    await esperarCotacao();

    // Fonte é a PRÓPRIA opção (precoCheio já veio da cotação real) — nunca
    // cota a edge de novo só para exibir a economia.
    expect(mockInvoke).not.toHaveBeenCalled();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    const linhaTotal = botaoFinalizar.closest(".bottom-docked-navigation")!;
    expect(linhaTotal.querySelector(".line-through")?.textContent).toContain(
      "35,00",
    );
    expect(linhaTotal.textContent).toContain("20,00");
    expect(linhaTotal.textContent).not.toContain("Grátis");
    expect(
      linhaTotal.querySelector('[aria-label^="Desconto de R$"]'),
    ).toBeNull();

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
    // NÃO grátis: mostra o preço FINAL (R$ 20,00), riscando o CHEIO
    // (R$ 35,00) — nunca "Grátis" (o desconto não é grátis).
    expect(linhaEntrega.textContent).not.toContain("Grátis");
    expect(linhaEntrega.textContent).toContain("20,00");
    expect(linhaEntrega.querySelector(".line-through")?.textContent).toContain(
      "35,00",
    );
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
    // Comportamento pós-regra 21/09/2026: a ESCOLHA de entrega é exigida
    // pelo Finalizar (o servidor recusa id ausente), então o pedido sai
    // com a opção que o CLIENTE escolheu ("local-delivery" grátis) —
    // NUNCA com a opção que a cotação de EXIBIÇÃO "achou" ("pac"/"sedex"
    // não aparecem aqui) — e `destinationCep` continua o `shippingCep` do
    // carrinho (aqui, `null`): a cotação de exibição não escreve em
    // estado nenhum do frete REAL.
    expect(pedidoEnviado.shippingOptionId).toBe("local-delivery");
    expect(pedidoEnviado.destinationCep).toBeNull();
    expect(setSelectedShippingOption).not.toHaveBeenCalled();
    expect(setShippingCep).not.toHaveBeenCalled();
  });
});
