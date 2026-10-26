// @vitest-environment jsdom
//
// Pedido do dono (26/10/2026): "o botão de WhatsApp original" na loja do cliente.
// Sobravam 3 ações de contato com o desenho antigo: o botão só-ícone e a linha
// "Falar com a loja" do pedido, e o círculo de "Dúvidas no WhatsApp" do produto
// (glifo BRANCO sobre #25D366 = ~2:1, abaixo dos 3:1 que a WCAG pede).
//
// RENDER DE VERDADE das duas telas. Prova: (1) desenho original (verde oficial,
// glifo oficial ESCURO), (2) clique abre o MESMO link (número, mensagem,
// _blank, noopener), (3) continua aparecendo só com WhatsApp cadastrado.
import type { Order, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { numeroDoPedido } from "@/lib/numero-do-pedido";

const config: Record<string, unknown> = {
  enableReviews: false,
  whatsappNumber: "34999999999",
  shippingCoverage: "local",
  storeCity: "Sao Paulo",
  storeState: "SP",
};

const pedido: Order = {
  id: "pedido-restante-0042",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    { productId: "prod-1", name: "Blusa", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  status: "shipping",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([pedido]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config, isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));
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
vi.mock("@/components/ui/custom/ProductQA", () => ({ ProductQA: () => null }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const produto: Product = {
  id: "prod-wa",
  name: "Produto Zap",
  description: "Descricao de teste",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
};

function caminhoOficial(): string {
  const host = document.createElement("div");
  const r = createRoot(host);
  act(() => {
    r.render(<IconeWhatsapp />);
  });
  const d = host.querySelector("path")?.getAttribute("d") ?? "";
  act(() => {
    r.unmount();
  });
  return d;
}

function temClasse(botao: Element | null | undefined, c: string) {
  return (botao?.className ?? "").split(/\s+/).includes(c);
}

function confereDesenhoOriginal(botao: HTMLButtonElement | undefined) {
  expect(botao).toBeDefined();
  const classes = botao?.className ?? "";
  expect(classes).toContain("bg-[#25D366]");
  expect(classes).toContain("text-[#0B141A]");
  // nada do desenho antigo: glifo verde/branco sobre cinza ou círculo branco
  expect(classes).not.toContain("text-white");
  expect(classes).not.toContain("bg-zinc-100");
  expect(classes).not.toContain("hover:opacity-90");
  expect(botao?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(
    [...(botao?.querySelectorAll("svg path") ?? [])].map((p) =>
      p.getAttribute("d"),
    ),
  ).toEqual([caminhoOficial()]);
  expect(classes).toContain("focus-visible:ring-2");
}

function confereLink(abrir: ReturnType<typeof vi.fn>, mensagem: RegExp) {
  expect(abrir).toHaveBeenCalledTimes(1);
  const [url, alvo, recursos] = abrir.mock.calls[0] as [string, string, string];
  expect(url.startsWith("https://wa.me/5534999999999?text=")).toBe(true);
  expect(decodeURIComponent(url.split("?text=")[1] ?? "")).toMatch(mensagem);
  expect(alvo).toBe("_blank");
  expect(recursos).toBe("noopener,noreferrer");
}

describe("pedido do cliente (OrderDetailsView): contato com o desenho original", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config.whatsappNumber = "34999999999";
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={pedido.id}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
  }
  const topo = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Falar com a loja no WhatsApp"]',
    ) ?? undefined;
  const linha = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Falar com a loja",
    );

  it("o botão só-ícone do topo: verde oficial, glifo oficial escuro, alvo >= 44 px", async () => {
    await renderizar();
    const botao = topo();
    confereDesenhoOriginal(botao);
    expect(botao?.textContent).toBe("");
    expect(temClasse(botao, "size-11")).toBe(true);
  });

  it("a ação 'Falar com a loja' da lista é o botão original com rótulo", async () => {
    await renderizar();
    const botao = linha();
    confereDesenhoOriginal(botao);
    expect(temClasse(botao, "h-12")).toBe(true);
  });

  it("os dois cliques abrem o MESMO link: DDI 55, mensagem com o número do pedido, aba isolada", async () => {
    await renderizar();
    for (const pegar of [topo, linha]) {
      abrir.mockClear();
      await act(async () => {
        pegar()?.click();
      });
      confereLink(
        abrir,
        new RegExp(`^Olá! .*#${numeroDoPedido(pedido.id)}\\b`),
      );
    }
  });

  it("sem WhatsApp cadastrado os dois somem (mesma regra de antes)", async () => {
    config.whatsappNumber = "";
    await renderizar();
    expect(topo()).toBeUndefined();
    expect(linha()).toBeUndefined();
  });
});

describe("produto (ProductView): 'Dúvidas no WhatsApp' com o desenho original", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config.whatsappNumber = "34999999999";
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
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

  async function renderizar() {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }
  const botao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Dúvidas no WhatsApp"]',
    ) ?? undefined;

  it("continua redondo, >= 48 px, ao lado do seletor, mas verde oficial com glifo ESCURO", async () => {
    await renderizar();
    const b = botao();
    confereDesenhoOriginal(b);
    expect(b?.textContent).toBe("");
    expect(temClasse(b, "rounded-full")).toBe(true);
    expect(temClasse(b, "size-[52px]")).toBe(true);
    expect(b?.getAttribute("title")).toBe("Dúvidas no WhatsApp");
  });

  it("clicar abre o MESMO link: DDI 55, mensagem do produto, aba isolada", async () => {
    await renderizar();
    await act(async () => {
      botao()?.click();
    });
    confereLink(abrir, /^Olá! Tenho interesse no produto: Produto Zap - /);
  });

  it("sem WhatsApp cadastrado o botão continua sumindo", async () => {
    config.whatsappNumber = null;
    await renderizar();
    expect(botao()).toBeUndefined();
  });
});
