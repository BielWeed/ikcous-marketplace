// @vitest-environment jsdom
//
// Textos da vitrine que ficavam escuro-sobre-escuro nos temas escuro e vidro.
//
// A loja tem três temas (claro, escuro, vidro) por tokens CSS: `text-foreground`,
// `text-muted-foreground`, `bg-background`. Alguns textos usavam cor FIXA de tema
// claro (`text-zinc-900`, `text-zinc-600`, `text-gray-600`) sobre um fundo que
// muda com o tema — no escuro, o fundo vira quase preto e o texto escuro some.
//
// O jsdom não calcula CSS, então o teste LÊ AS CLASSES renderizadas (mesma
// técnica de address-list-perfil-usa-cores-do-tema.test.tsx):
//   1. Descrição do produto (MarkdownRenderer): fundo do tema -> só tokens.
//   2. Nome do produto (h1): fundo do tema no celular, mas no computador ele
//      está dentro do cartão `lg:bg-white` -> `text-foreground` + o escuro fixo
//      só do `lg:` (o computador continua como estava).
//   3. Telas de retomada do checkout e "Situação do pagamento": a camada
//      `bg-gray-50/10` é translúcida sobre o fundo do tema -> só tokens.
//
// Controle (onde NÃO se troca): o cartão `bg-white` explícito da "Situação do
// pagamento" segue com texto escuro fixo — o fundo ali não muda com o tema.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const createOrder = vi.fn();
const onNavigate = vi.fn();

const { lerPedido, criarPagamento, estadoDoCartao } = vi.hoisted(() => ({
  lerPedido: vi.fn(),
  criarPagamento: vi.fn(),
  // Constantes do dublê (referência estável: objeto novo por render reativa
  // efeitos do CheckoutView em laço). Preenchido no beforeEach.
  estadoDoCartao: { atual: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => lerPedido(),
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      enableReviews: true,
      whatsappNumber: "34999998888",
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
  useAuth: () => ({
    user: null,
    profile: null,
    isAdmin: false,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
            id: "prod-1",
            name: "Produto Teste",
            description: "",
            price: 100,
            images: [],
            category: "geral",
            stock: 10,
            sold: 0,
            isActive: true,
            isBestseller: false,
            freeShipping: false,
            createdAt: new Date().toISOString(),
          },
          quantity: 1,
        },
      ],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({
      createOrder,
      updateOrderStatus: vi.fn(),
      criarPagamento,
    }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => estadoDoCartao.atual,
}));

// Hooks da página do produto.
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: () => () => {},
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
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [],
    carregando: true,
    consultado: false,
  }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Cor fixa de tema claro em texto, sem prefixo de variante (`lg:` não conta:
// ele só liga no computador).
const TEXTO_CLARO_FIXO = /^text-(zinc-(600|900)|gray-600)$/;
const classesDe = (el: Element) => [...el.classList];
const coresFixas = (el: Element) =>
  classesDe(el).filter((c) => TEXTO_CLARO_FIXO.test(c));

/** O elemento usa o token do tema e nenhuma cor de texto fixa. */
function usaToken(el: Element, token: string) {
  expect(classesDe(el), el.outerHTML.slice(0, 120)).toContain(token);
  expect(coresFixas(el), el.outerHTML.slice(0, 120)).toEqual([]);
}

function acharPorTexto(raiz: ParentNode, seletor: string, texto: string) {
  const el = [...raiz.querySelectorAll(seletor)].find((e) =>
    e.textContent?.includes(texto),
  );
  expect(el, `${seletor} com "${texto}"`).toBeDefined();
  return el as HTMLElement;
}

const esperarMicrotarefas = () => new Promise((r) => setTimeout(r, 0));

async function esvaziar() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("vitrine — textos legíveis nos temas escuro e vidro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    sessionStorage.clear();
    lerPedido.mockReset();
    createOrder.mockReset();
    criarPagamento.mockReset();
    // A consulta da "Situação do pagamento" nunca volta: a tela fica em
    // "Consultando…", que é o trecho que o teste mede.
    criarPagamento.mockReturnValue(new Promise(() => {}));
    onNavigate.mockReset();
    const { ESTADO_PRONTO_SEM_CARTAO } = await import(
      "./duble-use-config-do-cartao"
    );
    estadoDoCartao.atual = ESTADO_PRONTO_SEM_CARTAO;
    pararABuscaDeCep();
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
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("matchMedia", undefined);
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("descrição do produto (MarkdownRenderer)", () => {
    const DESCRICAO = [
      "### Medidas",
      "Largura: 10 cm",
      "",
      "Parágrafo com **destaque** no meio",
      "",
      "* Algodão",
      "* Lavar à mão",
      "",
      "**Características**",
      "* Tema: Stitch",
    ].join("\n");

    async function montarDescricao() {
      const { MarkdownRenderer } = await import(
        "@/components/ui/custom/MarkdownRenderer"
      );
      await act(async () => {
        raiz.render(<MarkdownRenderer content={DESCRICAO} />);
      });
    }

    it("títulos e negritos usam text-foreground; parágrafos e itens usam text-muted-foreground", async () => {
      await montarDescricao();

      usaToken(hospedeiro.querySelector("h3")!, "text-foreground");
      const negritos = [...hospedeiro.querySelectorAll("strong")];
      expect(negritos.length).toBeGreaterThanOrEqual(2);
      for (const negrito of negritos) usaToken(negrito, "text-foreground");

      const paragrafos = [...hospedeiro.querySelectorAll("p")];
      expect(paragrafos.length).toBeGreaterThanOrEqual(2);
      for (const p of paragrafos) usaToken(p, "text-muted-foreground");

      const itens = [...hospedeiro.querySelectorAll("li")];
      expect(itens.length).toBe(3);
      for (const li of itens) usaToken(li, "text-muted-foreground");
    });

    it("nenhum texto da descrição leva cor fixa de tema claro", async () => {
      await montarDescricao();
      const comCorFixa = [...hospedeiro.querySelectorAll("*")].filter(
        (el) => coresFixas(el).length > 0,
      );
      expect(comCorFixa.map((el) => el.tagName)).toEqual([]);
    });
  });

  describe("página do produto (ProductView)", () => {
    const produto = {
      id: "produto-tema",
      name: "Blusa de teste",
      description: "Descrição da blusa **boa**",
      price: 100,
      images: ["/foto-1.png"],
      category: "Roupas",
      stock: 10,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: "2026-09-28T12:00:00Z",
    };

    async function montarProduto() {
      const { ProductView } = await import("@/views/customer/ProductView");
      await act(async () =>
        raiz.render(
          <ProductView
            product={produto}
            isFavorite={false}
            onToggleFavorite={() => {}}
            onAddToCart={() => {}}
            onBack={() => {}}
          />,
        ),
      );
    }

    const temFundoBranco = (el: Element) =>
      classesDe(el).some((c) => /^(lg:)?bg-white$/.test(c));
    const ancestraisComFundoBranco = (el: Element) => {
      const achados: string[] = [];
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (temFundoBranco(p)) {
          achados.push(
            classesDe(p).find((c) => /^(lg:)?bg-white$/.test(c)) as string,
          );
        }
      }
      return achados;
    };

    it("nome do produto: token do tema no celular, e o escuro fixo só no computador (onde o cartão é lg:bg-white)", async () => {
      await montarProduto();
      const h1 = hospedeiro.querySelector("h1")!;
      expect(h1.textContent).toBe("Blusa de teste");
      // Premissa que justifica o `lg:text-zinc-900`: no computador o nome mora
      // num cartão branco FIXO, e só no computador (nunca `bg-white` no celular).
      expect(ancestraisComFundoBranco(h1)).toEqual(["lg:bg-white"]);
      expect(classesDe(h1)).toContain("text-foreground");
      expect(classesDe(h1)).toContain("lg:text-zinc-900");
      expect(coresFixas(h1)).toEqual([]);
    });

    it("descrição: fica sobre o fundo do tema (sem cartão branco atrás) e usa tokens", async () => {
      await montarProduto();
      const secao = hospedeiro.querySelector("#details-section")!;
      // Premissa que justifica o token puro, sem `lg:`: nenhum fundo branco
      // fixo atrás da descrição, nem no celular nem no computador.
      expect(ancestraisComFundoBranco(secao)).toEqual([]);
      usaToken(secao.querySelector("p")!, "text-muted-foreground");
      usaToken(secao.querySelector("strong")!, "text-foreground");
    });
  });

  describe("telas de retomada do pagamento (CheckoutView)", () => {
    const PEDIDO = "ped-777";

    async function montarRetomada() {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await act(async () => {
        raiz.render(
          <CheckoutView
            onNavigate={onNavigate}
            onSetBackOverride={() => {}}
            retomarPedidoId={PEDIDO}
            retomadaDaRecarga={false}
          />,
        );
      });
      await esvaziar();
    }

    it("'Abrindo o pedido…': título e explicação usam tokens", async () => {
      lerPedido.mockReturnValue(new Promise(() => {}));
      await montarRetomada();
      usaToken(
        acharPorTexto(hospedeiro, "h1", "Retomar o pagamento do pedido"),
        "text-foreground",
      );
      usaToken(
        acharPorTexto(hospedeiro, "p", "Abrindo o pedido"),
        "text-muted-foreground",
      );
    });

    it("pedido que não aguarda pagamento: título e explicação usam tokens", async () => {
      lerPedido.mockResolvedValue({
        data: {
          total: 80,
          metodo_online: "pix",
          status: "cancelled",
          payment_status: "aguardando",
        },
        error: null,
      });
      await montarRetomada();
      usaToken(
        acharPorTexto(
          hospedeiro,
          "h1",
          "Este pedido não está aguardando pagamento",
        ),
        "text-foreground",
      );
      usaToken(
        acharPorTexto(hospedeiro, "p", "Ele já foi pago, cancelado"),
        "text-muted-foreground",
      );
    });

    it("escolhendo a forma de pagamento: título e explicações usam tokens", async () => {
      const { ESTADO_CARREGANDO } = await import(
        "./duble-use-config-do-cartao"
      );
      estadoDoCartao.atual = ESTADO_CARREGANDO;
      lerPedido.mockResolvedValue({
        data: {
          total: 80,
          metodo_online: null,
          status: "pending",
          payment_status: "aguardando",
        },
        error: null,
      });
      await montarRetomada();
      usaToken(
        acharPorTexto(hospedeiro, "h1", "Como você quer pagar este pedido?"),
        "text-foreground",
      );
      usaToken(
        acharPorTexto(hospedeiro, "p", "Nada é cobrado até você escolher"),
        "text-muted-foreground",
      );
      usaToken(
        acharPorTexto(hospedeiro, "p", "Carregando formas de pagamento"),
        "text-muted-foreground",
      );
    });
  });

  describe("Situação do pagamento (VerificacaoDoPagamento)", () => {
    async function montarVerificacao() {
      const { VerificacaoDoPagamento } = await import(
        "@/components/checkout/VerificacaoDoPagamento"
      );
      await act(async () => {
        raiz.render(
          <VerificacaoDoPagamento
            orderId="3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b"
            onVerMeusPedidos={() => {}}
            onRetomadaLiberada={() => {}}
          />,
        );
        await esperarMicrotarefas();
      });
    }

    it("título e 'Consultando…' usam tokens", async () => {
      await montarVerificacao();
      usaToken(
        acharPorTexto(hospedeiro, "h1", "Situação do pagamento"),
        "text-foreground",
      );
      usaToken(
        acharPorTexto(hospedeiro, "p", "Consultando o pagamento"),
        "text-muted-foreground",
      );
    });
  });
});
