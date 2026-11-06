// @vitest-environment jsdom
//
// No carrinho, com o frete ainda "A calcular" o Total aparecia como número
// FECHADO (só os produtos) — a cliente lia "Total R$ 100,00", tocava em
// Finalizar e via outro valor no resumo do checkout, que já tinha sido
// corrigido para não fazer isso. Agora o Total do painel do computador e o do
// rodapé do celular dizem "A calcular" enquanto não existe frete escolhido.
//
// Só a EXIBIÇÃO muda: nada de preço, regra de frete nem o que o checkout
// envia. A linha do Total NÃO some (o texto troca, a altura é a mesma), para
// a barra de baixo não pular quando o frete fica pronto.
//
// Controles: retirada na loja (frete zero CONHECIDO), frete grátis, frete
// grátis de transportadora (preço 0 cotado) e frete cotado continuam com o
// número fechado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type OpcaoDoTeste = { id: string; name: string; price: number } | null;

const estado = vi.hoisted(() => ({
  freteGratis: false,
  freteIndefinido: true,
  shippingFee: 15,
  selecionada: null as { id: string; name: string; price: number } | null,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 15, freeShippingMin: 0 },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
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
          stock: 5,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date(0).toISOString(),
        },
        quantity: 1,
      },
    ],
    shippingFee: estado.shippingFee,
    freteIndefinido: estado.freteIndefinido,
    freteGratis: estado.freteGratis,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estado.selecionada,
    setSelectedShippingOption: vi.fn(),
    shippingCep: null,
    setShippingCep: vi.fn(),
    enderecoSelecionadoId: null,
    setEnderecoSelecionadoId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function definir(
  frete:
    | { tipo: "a-calcular" }
    | { tipo: "escolhido"; opcao: NonNullable<OpcaoDoTeste>; gratis?: boolean },
) {
  if (frete.tipo === "a-calcular") {
    estado.freteGratis = false;
    estado.freteIndefinido = true;
    // O valor de fábrica que NUNCA pode entrar na conta.
    estado.shippingFee = 15;
    estado.selecionada = null;
    return;
  }
  estado.freteGratis = frete.gratis ?? false;
  estado.freteIndefinido = false;
  estado.shippingFee = frete.opcao.price;
  estado.selecionada = frete.opcao;
}

describe("CartView — Total não fecha enquanto o frete está 'A calcular'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    definir({ tipo: "a-calcular" });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const resumoDoComputador = () =>
    Array.from(hospedeiro.querySelectorAll("h3"))
      .find((h) => h.textContent === "Resumo do Pedido")
      ?.closest(".sticky") as HTMLElement | null | undefined;
  const rodapeDoCelular = () =>
    document.querySelector(".bottom-docked-navigation") as HTMLElement | null;

  /** O número (ou o texto) que está embaixo do rótulo "Total". */
  function valorDoTotal(raizDoResumo: HTMLElement | null | undefined): string {
    expect(raizDoResumo).toBeTruthy();
    const rotulos = Array.from(
      raizDoResumo?.querySelectorAll("span") ?? [],
    ).filter((s) => s.textContent?.trim() === "Total");
    expect(rotulos).toHaveLength(1);
    const valor = rotulos[0]?.nextElementSibling;
    expect(valor, "a linha do Total tem de continuar existindo").toBeTruthy();
    return (valor?.textContent ?? "").replace(/\u00A0/g, " ").trim();
  }

  it("A CALCULAR: o painel do computador NÃO mostra número no Total (nem o chute de R$ 15)", async () => {
    await renderizarCarrinho();
    const resumo = resumoDoComputador();

    expect(valorDoTotal(resumo)).toBe("A calcular");
    const texto = (resumo?.textContent ?? "").replace(/\u00A0/g, " ");
    // O subtotal segue honesto, e o chute de fábrica não foi somado.
    expect(texto).toContain("R$ 100,00");
    expect(texto).not.toContain("R$ 115,00");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("A CALCULAR: o rodapé do celular NÃO mostra número no Total", async () => {
    await renderizarCarrinho();
    const rodape = rodapeDoCelular();

    expect(valorDoTotal(rodape)).toBe("A calcular");
    const texto = (rodape?.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain("R$ 100,00");
    expect(texto).not.toContain("R$ 115,00");
    expect(texto).not.toContain("GRÁTIS");
    // A linha do Frete continua dizendo a mesma coisa.
    expect(texto).toContain("A calcular");
  });

  it("controle, RETIRADA NA LOJA (frete zero conhecido): Total fechado, nos dois resumos", async () => {
    definir({
      tipo: "escolhido",
      opcao: { id: "store-pickup", name: "Retirar na loja", price: 0 },
    });
    await renderizarCarrinho();

    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 100,00");
    expect(valorDoTotal(rodapeDoCelular())).toBe("R$ 100,00");
    expect(resumoDoComputador()?.textContent ?? "").toContain(
      "Retirada na loja",
    );
    expect(rodapeDoCelular()?.textContent ?? "").not.toContain("A calcular");
  });

  it("controle, FRETE GRÁTIS (veredito da loja): Total fechado, nos dois resumos", async () => {
    definir({
      tipo: "escolhido",
      gratis: true,
      opcao: { id: "local-delivery", name: "Entrega local", price: 0 },
    });
    await renderizarCarrinho();

    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 100,00");
    expect(valorDoTotal(rodapeDoCelular())).toBe("R$ 100,00");
    expect(rodapeDoCelular()?.textContent ?? "").toContain("GRÁTIS");
  });

  it("controle, transportadora COTADA a R$ 0,00 (preço zero é preço, não 'a calcular'): Total fechado", async () => {
    definir({
      tipo: "escolhido",
      opcao: { id: "melhorenvio-pac", name: "PAC", price: 0 },
    });
    await renderizarCarrinho();

    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 100,00");
    expect(valorDoTotal(rodapeDoCelular())).toBe("R$ 100,00");
  });

  it("controle, FRETE CALCULADO: Total = produtos + frete, nos dois resumos", async () => {
    definir({
      tipo: "escolhido",
      opcao: { id: "melhorenvio-pac", name: "PAC", price: 18.37 },
    });
    await renderizarCarrinho();

    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 118,37");
    expect(valorDoTotal(rodapeDoCelular())).toBe("R$ 118,37");
    expect(rodapeDoCelular()?.textContent ?? "").not.toContain("A calcular");
  });
});
