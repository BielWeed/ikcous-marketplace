// @vitest-environment jsdom
//
// Varredura de bugs (12/10/2026), frente telas-formatacao-a11y. Seis achados
// nas telas do cliente, cada um preso por um teste que falha no HEAD antigo:
//
//  1. Dinheiro sem separador de milhar: `toFixed(2).replace(".", ",")` dava
//     "R$ 1234,50" (e o texto de compartilhar saía "por R$1234.50"). A fonte
//     única é `formatCurrency` (Intl pt-BR) -> "R$ 1.234,50".
//  2. Botão de foto (só o ícone Camera) sem nome acessível, em ProfileView e
//     AccountSettingsView.
//  3. `getInitials` duplicada: nome só com espaços dava iniciais vazias e
//     emoji/astral era partido ao meio por `charAt`.
//  4. ProductQA: inputs só com placeholder e botão de enviar só com ícone.
//  5. OrderDetailsView mostrava o preço UNITÁRIO ao lado de "Qtd. N" sem
//     rótulo — a coluna não somava com "Produtos".
//  6. OrderDetailsView: efeito de "já avaliou?" sem cancelamento — resposta
//     velha sobrescrevia a do pedido atual.
//
// Os espaços inseparáveis do Intl são normalizados por `txt` — o que se
// prova é o separador de milhar e a vírgula, não o tipo de espaço.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Order, Product, Review } from "@/types";

// ---------- dublês compartilhados (cada teste reatribui o que precisa) ------

let pedidos: Order[] = [];
const fetchUserOrders = vi.fn();
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidos,
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));

// `user` precisa ser a MESMA referência a cada render (deps do efeito).
const usuario = { id: "user-1", email: "cliente@teste.com" };
let isAdminAtual = false;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, isAdmin: isAdminAtual }),
}));

let shareTextDaLoja = "Olha que achei na Loja X!";
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      whatsappNumber: "34999999999",
      storeCity: "Sao Paulo",
      storeState: "SP",
      shareText: shareTextDaLoja,
    },
    isLoaded: true,
  }),
}));

// Consultas do supabase: `reviews` (efeito de OrderDetailsView) devolve uma
// promessa que o teste controla; `public_profiles` + RPCs servem o
// UserProfileView.
const consultasDeAvaliacao: Array<{
  produtos: string[];
  resolver: (ids: string[]) => void;
}> = [];
let perfilPublico: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: perfilPublico, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: (_col: string, produtos: string[]) =>
              new Promise((resolve) => {
                consultasDeAvaliacao.push({
                  produtos,
                  resolver: (ids) =>
                    resolve({
                      data: ids.map((product_id) => ({ product_id })),
                      error: null,
                    }),
                });
              }),
          }),
        }),
      };
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

let perguntas: Array<Record<string, unknown>> = [];
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: perguntas,
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Normaliza espaço inseparável e espaços duplos do Intl. */
const txt = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ");

let raiz: Root;
let hospedeiro: HTMLDivElement;
let textoCopiado = "";

beforeEach(() => {
  pedidos = [];
  perguntas = [];
  isAdminAtual = false;
  perfilPublico = null;
  textoCopiado = "";
  shareTextDaLoja = "Olha que achei na Loja X!";
  consultasDeAvaliacao.length = 0;
  fetchUserOrders.mockReset();
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("CSS", { escape: (v: string) => v });
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: (c: string, v: string) => {
      armazem.set(c, v);
    },
    removeItem: (c: string) => {
      armazem.delete(c);
    },
  });
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        textoCopiado = t;
        return Promise.resolve();
      },
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
  document.getElementById("product-structured-data")?.remove();
  vi.unstubAllGlobals();
});

async function montar(el: React.ReactElement) {
  await act(async () => {
    raiz.render(el);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------- fábricas ----------------------------------------------------

function pedido(extra: Partial<Order> = {}): Order {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      {
        productId: "prod-1",
        name: "Blusa Teste",
        price: 1234.5,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 1234.5,
    shipping: 1234.5,
    discount: 1234.5,
    total: 1234.5,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    ...extra,
  };
}

function produto(extra: Partial<Product> = {}): Product {
  return {
    id: "prod-caro",
    name: "Produto Caro",
    description: "Descricao",
    price: 1234.5,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

async function montarPedido(orderId = "pedido-1") {
  fetchUserOrders.mockResolvedValue(pedidos);
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await montar(
    <OrderDetailsView
      orderId={orderId}
      onBack={() => {}}
      onNavigate={() => {}}
    />,
  );
}

// ---------- 1. dinheiro com milhar -------------------------------------

describe("1. dinheiro com separador de milhar", () => {
  it("OrderDetailsView: item, produtos, frete, desconto e total", async () => {
    pedidos = [pedido()];
    await montarPedido();
    const t = txt(hospedeiro.textContent);
    expect(t).not.toContain("1234,50");
    // item + produtos + frete + desconto + total = 5 ocorrências
    expect(t.split("R$ 1.234,50").length - 1).toBe(5);
  });

  it("ProductView: preço grande, 'De:' e barra de compra", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");
    await montar(
      <ProductView
        product={produto({ originalPrice: 2345.6 })}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onAddToCart={() => {}}
        onBack={() => {}}
      />,
    );
    const t = txt(hospedeiro.textContent);
    expect(t).not.toContain("1234,50");
    expect(t).not.toContain("2345,60");
    expect(t).toContain("R$ 1.234,50");
    expect(t).toContain("De: R$ 2.345,60");
  });

  it("ProductView: texto de compartilhar sem marcador usa 'R$ 1.234,50'", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");
    await montar(
      <ProductView
        product={produto()}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onAddToCart={() => {}}
        onBack={() => {}}
      />,
    );
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Compartilhar"]',
    );
    await act(async () => {
      botao!.click();
      await Promise.resolve();
    });
    expect(textoCopiado).not.toBe("");
    expect(txt(textoCopiado)).toContain("Produto Caro por R$ 1.234,50");
    expect(textoCopiado).not.toContain("1234.50");
  });

  it("ProductView: texto de compartilhar com [preco] usa milhar", async () => {
    shareTextDaLoja = "[nome] por [preco] [link]";
    const { ProductView } = await import("@/views/customer/ProductView");
    await montar(
      <ProductView
        product={produto()}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onAddToCart={() => {}}
        onBack={() => {}}
      />,
    );
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Compartilhar"]',
    );
    await act(async () => {
      botao!.click();
      await Promise.resolve();
    });
    expect(txt(textoCopiado)).toContain("por R$ 1.234,50");
  });

  it("CartItemsList: preço e preço antigo riscado", async () => {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    const item: CartItem = {
      product: produto({ originalPrice: 2345.6 }),
      quantity: 1,
    };
    await montar(
      <CartItemsList
        cart={[item]}
        removingId={null}
        onUpdateQuantity={() => {}}
        onRemove={() => {}}
        handleClearCart={() => {}}
      />,
    );
    const t = txt(hospedeiro.textContent);
    expect(t).toContain("R$ 1.234,50");
    expect(t).toContain("R$ 2.345,60");
  });

  it("CouponInput: 'Você economiza' com milhar", async () => {
    const { CouponInput } = await import("@/components/ui/custom/CouponInput");
    await montar(
      <CouponInput
        onApply={() => {}}
        onRemove={() => {}}
        appliedCoupon={{ code: "BIG", discount: 1234.5 } as never}
      />,
    );
    expect(txt(hospedeiro.textContent)).toContain("economiza R$ 1.234,50");
  });

  it("ShippingProgress: preço dos produtos que atingem a meta", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    await montar(
      <ShippingProgress
        estado="meta"
        savings={0}
        progressPercent={40}
        amountToFree={60}
        isNearlyThere={false}
        freeShippingProducts={[produto({ images: ["x.png"] })]}
        onAddToCart={() => {}}
      />,
    );
    const t = txt(hospedeiro.textContent);
    expect(t).toContain("R$ 1.234,50");
    expect(t).not.toContain("1234,50");
  });
});

// ---------- 2. nome acessível do botão de foto -------------------------

describe("2. botão de trocar foto tem nome acessível", () => {
  const fontes = import.meta.glob<string>("/src/views/customer/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  // Por que lê FONTE: o botão mora dentro de um Dialog, atrás de hooks de
  // perfil/endereço/mapa — mesma decisão de acess-onda1-contrato.test.tsx.
  it.each([
    ["/src/views/customer/ProfileView.tsx", "profile-avatar-upload-icon"],
    [
      "/src/views/customer/AccountSettingsView.tsx",
      "account-avatar-upload-icon",
    ],
  ])(
    "%s: o label do ícone Camera traz texto para leitor de tela",
    (arq, id) => {
      const src = Object.entries(fontes).find(([k]) => k === arq)?.[1] ?? "";
      expect(src).not.toBe("");
      const ini = src.indexOf(`htmlFor="${id}"`);
      expect(ini).toBeGreaterThan(-1);
      const fim = src.indexOf("</label>", ini);
      const label = src.slice(ini, fim);
      expect(label).toContain("<Camera");
      expect(label).toMatch(
        /<span\s+className="sr-only"\s*>\s*Trocar foto de perfil\s*<\/span>/,
      );
    },
  );
});

// ---------- 3. iniciais --------------------------------------------------

describe("3. iniciais do avatar", () => {
  const review = (customerName: string): Review => ({
    id: "r1",
    productId: "prod-1",
    customerName,
    rating: 5,
    comment: "Ótimo",
    verified: false,
    helpful: 0,
    createdAt: new Date(0).toISOString(),
  });

  it("ReviewCard: nome só com espaços cai no 'U'", async () => {
    const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
    await montar(<ReviewCard review={review("   ")} />);
    const fallback = hospedeiro.querySelector(".select-none.font-bold");
    expect(fallback?.textContent).toBe("U");
  });

  it("ReviewCard: emoji no começo não é partido ao meio", async () => {
    const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
    await montar(<ReviewCard review={review("😀 Ana")} />);
    const fallback = hospedeiro.querySelector(".select-none.font-bold");
    expect(fallback?.textContent).toBe("😀A");
  });

  it("ProductQA: autor de pergunta com nome em branco cai no 'U'", async () => {
    perguntas = [
      {
        id: "q1",
        productId: "prod-1",
        customerName: "   ",
        question: "Tem na cor azul?",
        createdAt: new Date(0).toISOString(),
        answers: [],
      },
    ];
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await montar(<ProductQA productId="prod-1" />);
    const iniciais = Array.from(
      hospedeiro.querySelectorAll(".select-none.font-bold"),
    ).map((e) => e.textContent);
    // [0] = avatar do compositor (e-mail "cliente@teste.com" -> "C"), [1] = autor
    expect(iniciais).toContain("U");
    expect(iniciais.every((i) => i !== "")).toBe(true);
  });

  it("UserProfileView: nome só com espaços cai no 'U'", async () => {
    perfilPublico = {
      id: "user-alvo",
      full_name: "   ",
      avatar_url: null,
      created_at: new Date().toISOString(),
      cover_url: null,
    };
    const { UserProfileView } = await import(
      "@/views/customer/UserProfileView"
    );
    await montar(<UserProfileView userId="user-alvo" onNavigate={() => {}} />);
    const iniciais = hospedeiro.querySelector(".select-none.text-xl");
    expect(iniciais?.textContent).toBe("U");
  });
});

// ---------- 4. ProductQA: nomes acessíveis -------------------------------

describe("4. ProductQA: campos e botões com nome acessível", () => {
  it("compositor: input e botão de enviar têm aria-label", async () => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await montar(<ProductQA productId="prod-1" />);
    const input = hospedeiro.querySelector("#qa-new-question");
    expect(input?.getAttribute("aria-label")).toBeTruthy();
    const enviar = hospedeiro.querySelector('button[title="Enviar pergunta"]');
    expect(enviar?.getAttribute("aria-label")).toBe("Enviar pergunta");
  });

  it("admin: input de resposta e botão de enviar têm aria-label", async () => {
    isAdminAtual = true;
    perguntas = [
      {
        id: "q1",
        productId: "prod-1",
        customerName: "Maria Silva",
        question: "Tem na cor azul?",
        createdAt: new Date(0).toISOString(),
        answers: [],
      },
    ];
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await montar(<ProductQA productId="prod-1" />);
    const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Responder Pergunta"),
    );
    await act(async () => {
      abrir!.click();
    });
    const input = hospedeiro.querySelector("#qa-reply-q1");
    expect(input?.getAttribute("aria-label")).toBeTruthy();
    const enviar = hospedeiro.querySelector('button[title="Enviar resposta"]');
    expect(enviar?.getAttribute("aria-label")).toBe("Enviar resposta");
  });
});

// ---------- 5. OrderDetailsView: preço da linha -------------------------

describe("5. OrderDetailsView: o valor ao lado de 'Qtd.' é claro", () => {
  it("quantidade 2: a coluna mostra o total da linha e o unitário rotulado", async () => {
    pedidos = [
      pedido({
        items: [
          {
            productId: "prod-1",
            name: "Blusa Teste",
            price: 50,
            quantity: 2,
            image: "",
          },
        ],
        subtotal: 100,
        shipping: 0,
        discount: 0,
        total: 100,
      }),
    ];
    await montarPedido();
    const t = txt(hospedeiro.textContent);
    expect(t).toContain("Qtd. 2");
    expect(t).toContain("R$ 50,00 un.");
    // total da linha (50 x 2) = o mesmo "Produtos" do resumo
    const valores = Array.from(hospedeiro.querySelectorAll("span.font-bold"))
      .map((e) => txt(e.textContent).trim())
      .filter((s) => s.startsWith("R$"));
    expect(valores[0]).toBe("R$ 100,00");
  });
});

// ---------- 6. OrderDetailsView: efeito de avaliações cancelável --------

describe("6. OrderDetailsView: resposta velha de avaliações não sobrescreve", () => {
  it("trocar de pedido descarta a resposta do pedido anterior", async () => {
    const item = (productId: string) => ({
      productId,
      name: `Item ${productId}`,
      price: 10,
      quantity: 1,
      image: "",
    });
    pedidos = [
      pedido({
        id: "pedido-A",
        status: "delivered",
        items: [item("prod-comum")],
        subtotal: 10,
        shipping: 0,
        discount: 0,
        total: 10,
      }),
      pedido({
        id: "pedido-B",
        status: "delivered",
        items: [item("prod-comum")],
        subtotal: 10,
        shipping: 0,
        discount: 0,
        total: 10,
      }),
    ];
    await montarPedido("pedido-A");
    expect(consultasDeAvaliacao.length).toBeGreaterThan(0);
    const consultaA = consultasDeAvaliacao[consultasDeAvaliacao.length - 1];

    await montarPedido("pedido-B");
    const consultaB = consultasDeAvaliacao[consultasDeAvaliacao.length - 1];
    expect(consultaB).not.toBe(consultaA);

    // B responde primeiro: nada avaliado. A responde depois (atrasada).
    await act(async () => {
      consultaB.resolver([]);
      await Promise.resolve();
    });
    await act(async () => {
      consultaA.resolver(["prod-comum"]);
      await Promise.resolve();
    });

    expect(txt(hospedeiro.textContent)).not.toContain("Avaliado");
  });
});
