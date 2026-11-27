// @vitest-environment jsdom
//
// No carrinho, a cliente muda a quantidade e a calculadora espera 700 ms e
// recota — mas MANTÉM a opção escolhida enquanto a cotação nova não volta.
// O Total somava o frete da quantidade ANTERIOR nesse intervalo (frete de
// R$ 20 cotado para 1 unidade; a cliente põe 2 e, com rede lenta, lia o
// Total com os R$ 20 velhos). Com transportadora que deu grátis na
// quantidade antiga, o resumo seguia dizendo "GRÁTIS" que já não vale.
//
// O checkout já fazia o certo: enquanto a calculadora diz "cotando", o frete
// e o Total ficam "a calcular". O carrinho passa a ouvir o mesmo status e
// usar o "A calcular" que ele já tinha — nos dois resumos (painel do
// computador e rodapé do celular).
//
// Controle: a cotação volta ("pronto") e o Total fecha com o preço novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusDaCotacao } from "@/components/ui/custom/ShippingCalculator";

type Opcao = { id: string; name: string; price: number };

const estado = vi.hoisted(() => ({
  quantidade: 1,
  freteGratis: false,
  shippingFee: 20,
  selecionada: { id: "melhorenvio-pac", name: "PAC", price: 20 } as {
    id: string;
    name: string;
    price: number;
  },
  // O que o CartView entregou à calculadora no último render.
  avisarStatus: undefined as ((status: StatusDaCotacao) => void) | undefined,
  // Sem meta de frete grátis por padrão; o caso do cartão de progresso liga
  // a meta por valor.
  config: { shippingFee: 15, freeShippingMin: 0 } as Record<string, unknown>,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
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
        quantity: estado.quantidade,
      },
    ],
    shippingFee: estado.shippingFee,
    freteIndefinido: false,
    freteGratis: estado.freteGratis,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estado.selecionada,
    setSelectedShippingOption: vi.fn(),
    shippingCep: "38500-000",
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
// Dublê da calculadora: guarda o `onStatusChange` que o carrinho passou, para
// o teste fazer o papel da recotação (o comportamento real do status — debounce
// de 700 ms, "cotando" com a opção antiga mantida — está provado em
// shipping-calculator-recota-por-quantidade.test.tsx).
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: (props: {
    onStatusChange?: (status: StatusDaCotacao) => void;
  }) => {
    estado.avisarStatus = props.onStatusChange;
    return <div data-testid="calculadora" />;
  },
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  // Expõe o ESTADO que o carrinho mandou ("liberado", "meta"…).
  ShippingProgress: (props: { estado: string }) => (
    <div data-testid="progresso" data-estado={props.estado} />
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

function escolher(opcao: Opcao, gratis = false) {
  estado.selecionada = opcao;
  estado.shippingFee = opcao.price;
  estado.freteGratis = gratis;
}

describe("CartView — Total não soma o frete da quantidade anterior enquanto recalcula", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.quantidade = 1;
    estado.avisarStatus = undefined;
    estado.config = { shippingFee: 15, freeShippingMin: 0 };
    escolher({ id: "melhorenvio-pac", name: "PAC", price: 20 });
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

  async function calculadoraDiz(status: StatusDaCotacao) {
    await act(async () => {
      estado.avisarStatus?.(status);
    });
  }

  /** A cliente toca em "+": a quantidade muda, a opção escolhida (e o preço
   *  dela) continua a da cotação anterior até a nova voltar. */
  async function mudarQuantidadePara(quantidade: number) {
    estado.quantidade = quantidade;
    await renderizarCarrinho();
  }

  const resumoDoComputador = () =>
    Array.from(hospedeiro.querySelectorAll("h3"))
      .find((h) => h.textContent === "Resumo do Pedido")
      ?.closest(".sticky") as HTMLElement | null | undefined;
  const rodapeDoCelular = () =>
    document.querySelector(".bottom-docked-navigation") as HTMLElement | null;

  function linhaDoRotulo(
    raizDoResumo: HTMLElement | null | undefined,
    rotulo: string,
  ): Element {
    expect(raizDoResumo).toBeTruthy();
    const temTexto = (elemento: Element) =>
      elemento.textContent?.trim() === rotulo;
    const rotulos = Array.from(
      raizDoResumo?.querySelectorAll("*") ?? [],
    ).filter(
      (elemento) =>
        temTexto(elemento) && !Array.from(elemento.children).some(temTexto),
    );
    expect(rotulos).toHaveLength(1);
    const linha = rotulos[0]?.parentElement;
    expect(linha, `a linha de ${rotulo} precisa existir`).toBeTruthy();
    return linha!;
  }

  const semEspacoDuro = (texto: string | null | undefined) =>
    (texto ?? "").replace(/\u00A0/g, " ");

  function valorDoFrete(raizDoResumo: HTMLElement | null | undefined) {
    const linha = linhaDoRotulo(raizDoResumo, "Frete");
    return semEspacoDuro(linha.textContent).replace("Frete", "").trim();
  }

  function valorDoTotal(raizDoResumo: HTMLElement | null | undefined) {
    const linha = linhaDoRotulo(raizDoResumo, "Total");
    const valor = linha.querySelector('[role="status"]');
    expect(valor, "a linha do Total precisa ter um valor").toBeTruthy();
    return semEspacoDuro(valor?.textContent).trim();
  }

  it("frete de R$ 20 cotado para 1 unidade; a cliente põe 2 e a cotação nova não voltou: frete e Total 'A calcular', nos dois resumos", async () => {
    await renderizarCarrinho();
    await calculadoraDiz("pronto");
    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 120,00");

    await mudarQuantidadePara(2);
    await calculadoraDiz("cotando");

    for (const resumo of [resumoDoComputador(), rodapeDoCelular()]) {
      expect(valorDoTotal(resumo)).toBe("A calcular");
      expect(valorDoFrete(resumo)).toBe("A calcular");
      // O frete velho somado ao subtotal novo (200 + 20) nunca aparece.
      expect(semEspacoDuro(resumo?.textContent)).not.toContain("R$ 220,00");
      expect(semEspacoDuro(resumo?.textContent)).not.toContain("R$ 20,00");
    }
  });

  it("GRÁTIS da quantidade anterior (transportadora a R$ 0): enquanto recota, nada de 'GRÁTIS' e o Total fica 'A calcular'", async () => {
    estado.quantidade = 3;
    escolher({ id: "melhorenvio-pac", name: "PAC", price: 0 }, true);
    await renderizarCarrinho();
    await calculadoraDiz("pronto");
    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 300,00");

    await mudarQuantidadePara(1);
    await calculadoraDiz("cotando");

    for (const resumo of [resumoDoComputador(), rodapeDoCelular()]) {
      expect(valorDoTotal(resumo)).toBe("A calcular");
      expect(valorDoFrete(resumo)).toBe("A calcular");
      expect(resumo?.textContent ?? "").not.toContain("GRÁTIS");
      expect(resumo?.textContent ?? "").not.toContain("Frete grátis aplicado");
    }
  });

  it("controle: a cotação nova volta ('pronto') e o Total fecha com o preço NOVO", async () => {
    await renderizarCarrinho();
    await calculadoraDiz("pronto");
    await mudarQuantidadePara(2);
    await calculadoraDiz("cotando");
    expect(valorDoTotal(resumoDoComputador())).toBe("A calcular");

    escolher({ id: "melhorenvio-pac", name: "PAC", price: 32.5 });
    await renderizarCarrinho();
    await calculadoraDiz("pronto");

    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 232,50");
    expect(valorDoTotal(rodapeDoCelular())).toBe("R$ 232,50");
    expect(valorDoFrete(resumoDoComputador())).toBe("R$ 32,50");
  });

  it("frete grátis por valor mínimo, cliente logada: enquanto recota, o cartão de progresso NÃO diz 'liberado' (o resumo diz 'A calcular'); no 'pronto' ele volta", async () => {
    // Meta de R$ 150 para a transportadora; 2 unidades (R$ 200) bateram a
    // meta e a edge cotou a PAC a R$ 0.
    estado.config = {
      shippingFee: 15,
      freeShippingMin: 150,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 150,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "todas",
    };
    estado.quantidade = 2;
    escolher({ id: "melhorenvio-pac", name: "PAC", price: 0 }, true);
    const cartao = () =>
      hospedeiro.querySelector(
        '[data-testid="progresso"]',
      ) as HTMLElement | null;

    await renderizarCarrinho();
    await calculadoraDiz("pronto");
    expect(cartao()?.dataset.estado).toBe("liberado");

    // A cliente tira uma unidade (R$ 100, abaixo da meta): a opção R$ 0 da
    // cotação anterior continua na mesa até a nova voltar.
    await mudarQuantidadePara(1);
    await calculadoraDiz("cotando");
    expect(valorDoTotal(resumoDoComputador())).toBe("A calcular");
    expect(cartao()).toBeNull();

    // A cotação nova volta: PAC a R$ 25, sem grátis — o cartão reaparece
    // com a meta, não com "liberado".
    escolher({ id: "melhorenvio-pac", name: "PAC", price: 25 });
    await renderizarCarrinho();
    await calculadoraDiz("pronto");
    expect(cartao()).not.toBeNull();
    expect(cartao()?.dataset.estado).not.toBe("liberado");
    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 125,00");
  });

  it("controle: cotação que falhou ('erro') não é 'cotando' — o carrinho não inventa outro estado", async () => {
    await renderizarCarrinho();
    await calculadoraDiz("erro");

    expect(valorDoTotal(resumoDoComputador())).toBe("R$ 120,00");
  });
});
