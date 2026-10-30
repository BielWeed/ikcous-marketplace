// @vitest-environment jsdom
//
// O CARRINHO DIZ O MESMO QUE A HOME SOBRE FRETE GRÁTIS (30/10/2026, medição
// da vitrine da Savy). Com R$ 419,60 a home dizia "Frete Grátis Liberado" e o
// rodapé do carrinho dizia "Frete A calcular"; com R$ 329,70 a home dizia
// "Faltam R$ 20,30" e o carrinho não dizia nada. O cartão de progresso que o
// carrinho já tinha só aparecia para quem estava LOGADO e com o frete já
// cotado — convidado, ou quem ainda não escolheu a entrega, ficava no escuro.
//
// O que este arquivo prende:
//   1. sem frete cotado (convidado ou logado) o carrinho mostra o MESMO aviso
//      da home — o mesmo componente, o mesmo cálculo, o mesmo texto;
//   2. nos limites: abaixo, exatamente no limite, um centavo abaixo e acima;
//   3. o limite vem da configuração da loja, nunca fixo no código;
//   4. loja sem frete grátis configurado (0) não ganha aviso nenhum;
//   5. com o frete já cotado e logado, continua só o cartão de progresso de
//      antes (nada de aviso duplicado), e com retirada na loja não aparece;
//   6. o aviso é só informação: o rodapé segue dizendo "A calcular" e o total
//      não muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: { shippingFee: 10, freeShippingMin: 350 } as Record<string, unknown>,
  total: 329.7,
  user: null as { id: string } | null,
  freteIndefinido: true,
  selectedShippingOption: null as { id: string; name: string } | null,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

// O bloco da HOME lê o total daqui; o carrinho lê o mesmo total via useCart().
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.total }),
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
          price: estado.total,
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
    shippingFee: 10,
    freteIndefinido: estado.freteIndefinido,
    freteGratis: false,
    // o carrinho agora le o total do contexto (mesma fonte da home e da regra real de frete)
    cartTotal: estado.total,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estado.selectedShippingOption,
    setSelectedShippingOption: vi.fn(),
    shippingCep: null,
    setShippingCep: vi.fn(),
    enderecoSelecionadoId: null,
    setEnderecoSelecionadoId: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso">progresso antigo</div>,
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

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replaceAll(String.fromCharCode(160), " ").replace(/\s+/g, " ");

describe("CartView — mostra frete grátis e quanto falta, igual à home", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { shippingFee: 10, freeShippingMin: 350 };
    estado.total = 329.7;
    estado.user = null;
    estado.freteIndefinido = true;
    estado.selectedShippingOption = null;
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
    return normalizar(hospedeiro.textContent);
  }

  it("convidado, R$ 329,70 e limite de R$ 350,00: diz quanto falta (R$ 20,30)", async () => {
    const texto = await renderizarCarrinho();

    expect(texto).toContain("R$ 20,30");
    expect(texto).toContain("frete grátis");
    expect(texto).not.toContain("Liberado");
  });

  it("convidado, R$ 419,60 (49,90 + 2×139,90 + 89,90): diz que o frete grátis está liberado", async () => {
    estado.total = 49.9 + 2 * 139.9 + 89.9;
    const texto = await renderizarCarrinho();

    expect(texto).toContain("Frete Grátis Liberado!");
    expect(texto).not.toContain("Falta pouquinho");
  });

  it("limite exato (R$ 350,00): liberado; um centavo abaixo (R$ 349,99): falta R$ 0,01", async () => {
    estado.total = 350;
    expect(await renderizarCarrinho()).toContain("Frete Grátis Liberado!");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    estado.total = 349.99;
    const texto = await renderizarCarrinho();
    expect(texto).toContain("R$ 0,01");
    expect(texto).not.toContain("Liberado");
  });

  it("soma que o ponto flutuante erra (10,10 + 10,20 contra limite de R$ 20,30): libera", async () => {
    estado.config = { shippingFee: 10, freeShippingMin: 20.3 };
    estado.total = 10.1 + 10.2;
    expect(await renderizarCarrinho()).toContain("Frete Grátis Liberado!");
  });

  it("o limite vem da configuração da loja: com limite de R$ 200,00 os mesmos R$ 329,70 já liberam", async () => {
    estado.config = { shippingFee: 10, freeShippingMin: 200 };
    const texto = await renderizarCarrinho();

    expect(texto).toContain("Frete Grátis Liberado!");
    expect(texto).not.toContain("R$ 20,30");
  });

  it("loja SEM frete grátis configurado (0): nenhum aviso de frete grátis no carrinho", async () => {
    estado.config = { shippingFee: 10, freeShippingMin: 0 };
    const texto = await renderizarCarrinho();

    // Âncora: o carrinho montou (o bloco do convidado está na árvore).
    expect(texto).toContain("Comprar como Convidado");
    expect(texto).not.toContain("Liberado");
    expect(texto).not.toContain("Falta pouquinho");
    expect(texto).not.toContain("Entrega Grátis");
  });

  it("é o MESMO aviso da home: o texto do cartão no carrinho é idêntico ao do FreeShippingBlock", async () => {
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    const hospedeiroDaHome = document.createElement("div");
    document.body.appendChild(hospedeiroDaHome);
    const raizDaHome = createRoot(hospedeiroDaHome);
    await act(async () => {
      raizDaHome.render(<FreeShippingBlock />);
    });
    const textoDaHome = normalizar(hospedeiroDaHome.textContent);
    act(() => {
      raizDaHome.unmount();
    });
    hospedeiroDaHome.remove();
    expect(textoDaHome).toContain("R$ 20,30");

    const textoDoCarrinho = await renderizarCarrinho();
    expect(textoDoCarrinho).toContain(textoDaHome);
  });

  it("logada e ainda SEM frete cotado: também mostra o aviso", async () => {
    estado.user = { id: "u1" };
    const texto = await renderizarCarrinho();

    expect(texto).toContain("R$ 20,30");
    expect(texto).not.toContain("progresso antigo");
  });

  it("logada COM frete cotado: segue só o cartão de progresso de antes — sem aviso duplicado", async () => {
    estado.user = { id: "u1" };
    estado.freteIndefinido = false;
    estado.selectedShippingOption = { id: "local-delivery", name: "Entrega" };
    const texto = await renderizarCarrinho();

    expect(texto).toContain("progresso antigo");
    expect(texto).not.toContain("Falta pouquinho");
    expect(texto).not.toContain("Entrega Grátis");
  });

  it("retirada na loja escolhida: o aviso de frete grátis não aparece", async () => {
    estado.freteIndefinido = false;
    estado.selectedShippingOption = { id: "store-pickup", name: "Retirar" };
    const texto = await renderizarCarrinho();

    expect(texto).not.toContain("Falta pouquinho");
    expect(texto).not.toContain("Entrega Grátis");
    expect(texto).not.toContain("Liberado");
  });

  it("só informa: o rodapé continua dizendo 'A calcular' e o total é o dos itens", async () => {
    estado.total = 419.6;
    const texto = await renderizarCarrinho();

    expect(texto).toContain("Frete Grátis Liberado!");
    expect(texto).toContain("A calcular");
    expect(texto).toContain("R$ 419,60");
  });
});
