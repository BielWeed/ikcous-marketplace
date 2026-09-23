// @vitest-environment jsdom
//
// Dois defeitos no texto da barra de progresso do carrinho
// (`ShippingProgress`, montada por `CartView`) — nenhum muda o valor
// cobrado, mas a tela mentia sobre o que aconteceu com o frete:
//
// CASO A (retirada): `store-pickup` chega SEMPRE com preço 0 da edge — o
// preço zero dela é a natureza da retirada, não a meta de valor da loja
// tendo sido batida (`precoFinalDaOpcao`, estrategias-de-frete.ts: a regra
// local aplicada num preço já 0 continua 0, com QUALQUER preset). Loja com
// meta local "acima de R$ 100", subtotal R$ 50, cliente escolhe retirada:
// antes desta correção a barra dizia "Frete Grátis Liberado" mesmo a meta
// não tendo sido alcançada. Com a meta REALMENTE batida e retirada
// escolhida, "Liberado" continua valendo (a entrega sairia grátis mesmo).
//
// CASO B (nacional "mais_barata"): a meta de valor nacional pode estar
// batida sem que a opção de transportadora ESCOLHIDA seja a beneficiada —
// o alcance "mais_barata" só zera a mais barata; as demais mantêm o preço
// cheio (contrato §3: o front nunca recalcula, só lê o preço final que a
// edge já mandou). Antes desta correção, meta batida + opção escolhida
// cobrando ainda assim mostrava "Meta Frete Grátis · 100% · Faltam R$
// 0,00" — uma promessa que a opção escolhida não cumpre.
//
// Três camadas provadas aqui: a função pura `estadoDaBarraDeFrete`
// (CartView.tsx, mesmo padrão de `deveExibirMetaDeFreteGratis` —
// decisão de dinheiro se prova em unit test que discrimina, não colada na
// árvore de JSX), o componente `ShippingProgress` renderizado com cada
// `estado`, e o `CartView` inteiro para os dois casos (mesmo padrão de
// carrinho-retirada-nao-comemora-liberado-sem-gratis.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importar a CartView arrasta `@/lib/supabase` (via AuthContext/useAddresses)
// — mesmo motivo do mock em carrinho-nao-anuncia-meta-de-frete-gratis-
// desligado.test.tsx.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import type { Product } from "@/types";
import { estadoDaBarraDeFrete } from "@/views/customer/CartView";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// shipping-progress-contraste-aa.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────────────────────────────────────────────────────
// Camada 1: a função pura.
// ───────────────────────────────────────────────────────────────────────
describe("estadoDaBarraDeFrete — função pura", () => {
  it("CASO A: retirada com a meta local AINDA NÃO batida — nunca 'liberado', o estado é a meta real", () => {
    expect(
      estadoDaBarraDeFrete({
        freteGratis: true, // retirada sempre chega com preço 0 da edge
        ehRetirada: true,
        estrategiaDoCanal: "acima_de_valor",
        minimoDoCanal: 100,
        nationalBenefitScope: "todas",
        subtotal: 50,
        precoDaOpcaoEscolhida: 0,
      }),
    ).toBe("meta");
  });

  it("CASO A com a meta local JÁ batida + retirada escolhida: 'liberado' continua verdadeiro", () => {
    expect(
      estadoDaBarraDeFrete({
        freteGratis: true,
        ehRetirada: true,
        estrategiaDoCanal: "acima_de_valor",
        minimoDoCanal: 100,
        nationalBenefitScope: "todas",
        subtotal: 150,
        precoDaOpcaoEscolhida: 0,
      }),
    ).toBe("liberado");
  });

  it("CASO B: nacional 'mais_barata', meta batida, opção escolhida ainda cobra — 'gratis_so_na_mais_barata'", () => {
    expect(
      estadoDaBarraDeFrete({
        freteGratis: false,
        ehRetirada: false,
        estrategiaDoCanal: "acima_de_valor",
        minimoDoCanal: 150,
        nationalBenefitScope: "mais_barata",
        subtotal: 200,
        precoDaOpcaoEscolhida: 45,
      }),
    ).toBe("gratis_so_na_mais_barata");
  });

  it("alcance 'todas' residual (cotação nacional desatualizada): meta batida, opção cobra, sem 'mais_barata' — 'meta_atingida_sem_gratis'", () => {
    expect(
      estadoDaBarraDeFrete({
        freteGratis: false,
        ehRetirada: false,
        estrategiaDoCanal: "acima_de_valor",
        minimoDoCanal: 150,
        nationalBenefitScope: "todas",
        subtotal: 200,
        precoDaOpcaoEscolhida: 45,
      }),
    ).toBe("meta_atingida_sem_gratis");
  });

  it("entrega local normal, meta ainda longe (sem retirada, sem meta batida): 'meta'", () => {
    expect(
      estadoDaBarraDeFrete({
        freteGratis: false,
        ehRetirada: false,
        estrategiaDoCanal: "acima_de_valor",
        minimoDoCanal: 100,
        nationalBenefitScope: "todas",
        subtotal: 40,
        precoDaOpcaoEscolhida: 15,
      }),
    ).toBe("meta");
  });

  it("frete grátis real (preset 'sempre', sem retirada): 'liberado'", () => {
    expect(
      estadoDaBarraDeFrete({
        freteGratis: true,
        ehRetirada: false,
        estrategiaDoCanal: "sempre",
        minimoDoCanal: 0,
        nationalBenefitScope: "todas",
        subtotal: 10,
        precoDaOpcaoEscolhida: 0,
      }),
    ).toBe("liberado");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Camada 2: o componente, com cada `estado`.
// ───────────────────────────────────────────────────────────────────────
describe("ShippingProgress — o texto segue `estado`, não `shipping === 0`", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function textoDoCorpo(): string {
    return (hospedeiro.textContent ?? "").replaceAll(
      String.fromCharCode(160),
      " ",
    );
  }

  it("CASO A renderizado: estado 'meta' nunca diz 'Frete Grátis Liberado' e mostra 'Faltam R$ 50,00'", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          estado="meta"
          savings={0}
          progressPercent={50}
          amountToFree={50}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Frete Grátis Liberado");
    expect(texto).toContain("Faltam");
    expect(texto).toContain("R$ 50,00");
  });

  it("CASO B renderizado: estado 'gratis_so_na_mais_barata' nunca diz 'Faltam R$ 0,00' nem 'Liberado', e avisa que é só na mais barata", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          estado="gratis_so_na_mais_barata"
          savings={0}
          progressPercent={100}
          amountToFree={0}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Faltam");
    expect(texto).not.toContain("R$ 0,00");
    expect(texto).not.toContain("Liberado");
    expect(texto).toContain("mais barata");
  });
});

// ───────────────────────────────────────────────────────────────────────
// REVISÃO Opus (BLOQUEIA 1, 23/09/2026): "Frete grátis na opção mais
// barata" media ~270px em Inter contra ~221px da coluna do título no
// celular de 375px — cortava (`truncate`) para "FRETE GRÁTIS NA OPÇÃO
// MAI…", sumindo a restrição e sugerindo que a opção ESCOLHIDA é grátis.
// O jsdom não mede layout (não há `getBoundingClientRect` real aqui), então
// o controle possível é o comprimento do texto: ~24 caracteres é o piso
// medido para caber em ~200px nesta fonte/peso — e o título precisa entrar
// pela restrição (não pode começar prometendo "grátis" sem qualificar).
// ───────────────────────────────────────────────────────────────────────
describe("ShippingProgress — o título dos estados não-liberado cabe no celular (BLOQUEIA 1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  const LIMITE_DE_CARACTERES = 24;

  async function tituloDoEstado(
    estado: "meta" | "gratis_so_na_mais_barata" | "meta_atingida_sem_gratis",
  ): Promise<string> {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          estado={estado}
          savings={0}
          progressPercent={estado === "meta" ? 40 : 100}
          amountToFree={estado === "meta" ? 60 : 0}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    const h3 = hospedeiro.querySelector("h3");
    return h3?.textContent ?? "";
  }

  it.each([
    ["meta", "Meta Frete Grátis"],
    ["gratis_so_na_mais_barata", "Grátis só na mais barata"],
    ["meta_atingida_sem_gratis", "Meta atingida"],
  ] as const)(
    "estado '%s': título é '%s', com no máximo 24 caracteres",
    async (estado, esperado) => {
      const titulo = await tituloDoEstado(estado);
      expect(titulo).toBe(esperado);
      expect(titulo.length).toBeLessThanOrEqual(LIMITE_DE_CARACTERES);
    },
  );

  it("estado 'gratis_so_na_mais_barata': o título entra pela restrição ('Grátis só'), não promete a opção escolhida", async () => {
    const titulo = await tituloDoEstado("gratis_so_na_mais_barata");

    expect(titulo.startsWith("Grátis só")).toBe(true);
    // Mesmo cortado no meio de uma palavra, o prefixo visível já avisa a
    // restrição — nunca lê como "Frete Grátis" (a promessa incondicional).
    expect(titulo.slice(0, 12)).not.toBe("Frete Grátis".slice(0, 12));
  });

  it("estado 'meta_atingida_sem_gratis': o título nunca promete 'grátis' para a opção escolhida", async () => {
    const titulo = await tituloDoEstado("meta_atingida_sem_gratis");

    expect(titulo.toLowerCase()).not.toContain("grátis");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Camada 3: a CartView inteira, os dois casos pela tela.
// ───────────────────────────────────────────────────────────────────────
const estadoDoCarrinho = vi.hoisted(() => ({
  freteGratis: true,
  shippingFee: 0,
  selectedShippingOption: null as {
    id: string;
    name: string;
    price: number;
  } | null,
  config: {
    shippingFee: 10,
    freeShippingMin: 100,
    nationalShippingStrategy: "desligado" as
      | "desligado"
      | "acima_de_valor"
      | "sempre"
      | "por_produto"
      | "desconto_na_mais_barata",
    nationalShippingMin: 0,
    nationalDiscountType: null as "percentual" | "fixo" | null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "todas" as "mais_barata" | "todas",
  },
  produtoPreco: 50,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estadoDoCarrinho.config }),
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
          price: estadoDoCarrinho.produtoPreco,
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
    shippingFee: estadoDoCarrinho.shippingFee,
    freteIndefinido: false,
    freteGratis: estadoDoCarrinho.freteGratis,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: estadoDoCarrinho.selectedShippingOption,
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
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div data-testid="rodape" />,
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
// ShippingProgress NÃO é dublê aqui de propósito: é o texto dela que este
// bloco prova.

describe("CartView — a barra de progresso fala da opção ESCOLHIDA", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function textoDoCorpo(): string {
    return (hospedeiro.textContent ?? "").replaceAll(
      String.fromCharCode(160),
      " ",
    );
  }

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("CASO A pela tela: loja com meta local 'acima de R$ 100', subtotal R$ 50, retirada escolhida — mostra o progresso REAL (50%, Faltam R$ 50,00), nunca 'Frete Grátis Liberado'", async () => {
    estadoDoCarrinho.freteGratis = true; // retirada sempre chega 0 da edge
    estadoDoCarrinho.shippingFee = 0;
    estadoDoCarrinho.selectedShippingOption = {
      id: "store-pickup",
      name: "Retirar na loja",
      price: 0,
    };
    estadoDoCarrinho.config = {
      shippingFee: 10,
      freeShippingMin: 100, // preset "acima_de_valor", meta R$ 100
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "todas",
    };
    estadoDoCarrinho.produtoPreco = 50; // subtotal R$ 50 < meta R$ 100

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Frete Grátis Liberado");
    expect(texto).toContain("Meta Frete Grátis");
    expect(texto).toContain("Faltam");
    expect(texto).toContain("R$ 50,00");
  });

  it("CASO B pela tela: nacional 'acima_de_valor' com alcance 'mais_barata', meta batida, transportadora escolhida NÃO é a mais barata (cobra R$ 45) — nunca 'Faltam R$ 0,00' nem 'Liberado'", async () => {
    estadoDoCarrinho.freteGratis = false; // a opção escolhida cobra R$ 45
    estadoDoCarrinho.shippingFee = 45;
    estadoDoCarrinho.selectedShippingOption = {
      id: "melhor-envio-sedex",
      name: "Sedex",
      price: 45,
    };
    estadoDoCarrinho.config = {
      shippingFee: 10,
      freeShippingMin: 0, // local desligado, irrelevante (transportadora selecionada)
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 150,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    };
    estadoDoCarrinho.produtoPreco = 200; // subtotal R$ 200 >= meta nacional R$ 150

    await renderizarCarrinho();

    const texto = textoDoCorpo();
    expect(texto).not.toContain("Faltam R$ 0,00");
    expect(texto).not.toContain("Liberado");
    expect(texto).toContain("mais barata");
  });
});
