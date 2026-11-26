// @vitest-environment jsdom
//
// Caça por mutação no carrinho da cliente (aba Carrinho): pontos que nenhum
// teste vizinho prendia.
//   - a aba diz "Carrinho (N)" com a soma das quantidades, e o resumo do
//     computador diz "1 item selecionado" / "N itens selecionados";
//   - linha estragada (produto sem preço, quantidade zero ou ausente) não entra
//     na conta: nem no subtotal, nem no "N itens" -- nunca "R$ NaN";
//   - o cartão de progresso do frete grátis é de quem tem CONTA (o convidado vê
//     o aviso simples), e não aparece para loja que só tem retirada, mesmo com
//     um frete "grátis" que sobrou salvo;
//   - com a meta batida mas a opção escolhida ainda cobrando, a barra fica em
//     100% e nada falta (nunca "Faltam R$ 0,00").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = { preco?: number; quantidade?: number; id?: string };
type Opcao = { id: string; name: string; price: number } | null;

const estado = vi.hoisted(() => ({
  linhas: [] as Linha[],
  user: { id: "u1" } as { id: string } | null,
  config: { shippingFee: 10, freeShippingMin: 350 } as Record<string, unknown>,
  frete: 18.37,
  freteIndefinido: false,
  freteGratis: false,
  opcao: null as Opcao,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: estado.linhas.map((linha, i) => ({
      product: {
        id: linha.id ?? `prod-${i}`,
        name: `Produto ${i}`,
        description: "",
        price: linha.preco,
        variants: [],
        images: [],
        category: "geral",
        stock: 50,
        sold: 0,
        isActive: true,
        isBestseller: false,
        freeShipping: false,
        createdAt: new Date(0).toISOString(),
      },
      quantity: linha.quantidade,
    })),
    shippingFee: estado.frete,
    freteIndefinido: estado.freteIndefinido,
    freteGratis: estado.freteGratis,
    cartTotal: 0,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estado.opcao,
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
  useAuth: () => ({ user: estado.user }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
// O cartão de progresso vira uma marca que expõe o que a tela lhe entrega.
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: ({
    estado: situacao,
    progressPercent,
    amountToFree,
  }: {
    estado: string;
    progressPercent: number;
    amountToFree: number;
  }) => (
    <div
      data-testid="progresso"
      data-estado={situacao}
      data-percentual={String(progressPercent)}
      data-falta={String(amountToFree)}
    />
  ),
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

describe("CartView — contagem, subtotal de linhas estragadas e barra de frete do convidado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.linhas = [{ preco: 100, quantidade: 1 }];
    estado.user = { id: "u1" };
    estado.config = { shippingFee: 10, freeShippingMin: 350 };
    estado.frete = 18.37;
    estado.freteIndefinido = false;
    estado.freteGratis = false;
    estado.opcao = { id: "melhorenvio-pac", name: "PAC", price: 18.37 };
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

  const resumo = () =>
    Array.from(hospedeiro.querySelectorAll("h3"))
      .find((h) => h.textContent === "Resumo do Pedido")
      ?.closest(".sticky") as HTMLElement;
  const abaCarrinho = () =>
    normalizar(hospedeiro.querySelector("#tab-cart")?.textContent);
  const itensSelecionados = () =>
    normalizar(
      Array.from(resumo().querySelectorAll("p")).find((p) =>
        p.textContent?.includes("selecionado"),
      )?.textContent,
    );
  const subtotal = () => {
    const rotulo = Array.from(resumo().querySelectorAll("span")).find(
      (s) => s.textContent === "Subtotal",
    );
    return normalizar(rotulo?.nextElementSibling?.textContent);
  };
  const progresso = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="progresso"]');

  describe("a aba e o resumo contam as unidades", () => {
    it("uma unidade: 'Carrinho (1)' e '1 item selecionado' (singular)", async () => {
      estado.linhas = [{ preco: 100, quantidade: 1 }];
      await renderizarCarrinho();
      expect(abaCarrinho()).toBe("Carrinho (1)");
      expect(itensSelecionados()).toBe("1 item selecionado");
    });

    it("duas unidades da mesma linha: 'Carrinho (2)' e '2 itens selecionados' (plural)", async () => {
      estado.linhas = [{ preco: 100, quantidade: 2 }];
      await renderizarCarrinho();
      expect(abaCarrinho()).toBe("Carrinho (2)");
      expect(itensSelecionados()).toBe("2 itens selecionados");
    });

    it("três unidades em duas linhas: soma as quantidades", async () => {
      estado.linhas = [
        { preco: 100, quantidade: 2 },
        { preco: 30, quantidade: 1 },
      ];
      await renderizarCarrinho();
      expect(abaCarrinho()).toBe("Carrinho (3)");
      expect(itensSelecionados()).toBe("3 itens selecionados");
      expect(subtotal()).toBe("R$ 230,00");
    });
  });

  describe("linha estragada não entra na conta", () => {
    it("quantidade zero ou ausente não soma unidade nem preço", async () => {
      estado.linhas = [
        { preco: 100, quantidade: 2 },
        { preco: 50, quantidade: 0 },
        { preco: 40, quantidade: undefined },
      ];
      await renderizarCarrinho();
      expect(abaCarrinho()).toBe("Carrinho (2)");
      expect(subtotal()).toBe("R$ 200,00");
    });

    it("produto sem preço (dado corrompido) fica fora do subtotal: nunca 'R$ NaN'", async () => {
      estado.linhas = [
        { preco: 100, quantidade: 2 },
        { preco: undefined, quantidade: 3 },
      ];
      await renderizarCarrinho();
      expect(subtotal()).toBe("R$ 200,00");
      expect(hospedeiro.textContent).not.toContain("NaN");
    });
  });

  describe("cartão de progresso do frete grátis", () => {
    it("quem tem conta, com frete cotado, vê o cartão", async () => {
      estado.linhas = [{ preco: 100, quantidade: 1 }];
      await renderizarCarrinho();
      expect(progresso()).not.toBeNull();
      expect(progresso()?.dataset.estado).toBe("meta");
    });

    it("convidado, mesmo com frete cotado, não vê o cartão (vê o aviso simples)", async () => {
      estado.user = null;
      estado.linhas = [{ preco: 100, quantidade: 1 }];
      await renderizarCarrinho();
      expect(progresso()).toBeNull();
    });

    it("loja que só tem retirada: o frete 'grátis' que sobrou salvo não vira cartão", async () => {
      estado.config = {
        shippingFee: 10,
        freeShippingMin: 350,
        localDeliveryEnabled: false,
        shippingCoverage: "local",
        enabledShippingMethods: ["store-pickup"],
      };
      estado.freteGratis = true;
      estado.frete = 0;
      estado.opcao = { id: "melhorenvio-pac", name: "PAC", price: 0 };
      estado.linhas = [{ preco: 100, quantidade: 1 }];
      await renderizarCarrinho();
      expect(progresso()).toBeNull();
    });

    it("meta batida com a opção ainda cobrando: 100% e nada falta", async () => {
      estado.config = {
        shippingFee: 10,
        freeShippingMin: 350,
        nationalBenefitScope: "mais_barata",
      };
      estado.linhas = [{ preco: 400, quantidade: 1 }];
      await renderizarCarrinho();
      expect(progresso()?.dataset.estado).toBe("gratis_so_na_mais_barata");
      expect(progresso()?.dataset.percentual).toBe("100");
      expect(progresso()?.dataset.falta).toBe("0");
    });

    it("meta ainda não batida: o percentual é a fração e falta a diferença", async () => {
      estado.linhas = [{ preco: 300, quantidade: 1 }];
      await renderizarCarrinho();
      expect(progresso()?.dataset.estado).toBe("meta");
      expect(Number(progresso()?.dataset.percentual)).toBeCloseTo(
        (300 / 350) * 100,
        5,
      );
      expect(Number(progresso()?.dataset.falta)).toBeCloseTo(50, 5);
    });
  });
});
