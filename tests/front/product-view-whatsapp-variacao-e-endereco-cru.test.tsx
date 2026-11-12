// @vitest-environment jsdom
//
// "Dúvidas no WhatsApp" da página do produto (ProductView.handleWhatsApp).
// Três promessas que nenhum teste fixava:
//
//  1. Com variação obrigatória por escolher, o botão NÃO abre o WhatsApp: avisa
//     (o toast cita o grupo que falta) e fica nisso. Sem a guarda, a loja
//     recebia "Tenho interesse no produto: X - R$ <preço base>" sem dizer
//     qual tamanho/cor, e a cliente era mandada embora sem ter escolhido.
//  2. Com a variação escolhida, a mensagem leva a variação e o PREÇO DELA (o
//     override), não o do produto.
//  3. O endereço que sai em `window.open` é o texto CRU: '#', '&' e espaço do
//     nome do produto viram %23/%26/%20 -- um '&' solto corta a mensagem ali e
//     um '#' solto vira âncora. Os testes que já existem decodificam a URL
//     (decodeURIComponent), e por isso não veem um encode trocado por outro
//     mais fraco (encodeURI deixa '#' e '&' passarem).
//
// RENDER DE VERDADE (react-dom/client + jsdom), mesmo molde de
// aviso-de-variacao-diz-o-que-falta e whatsapp-restante-cliente.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
    isLoaded: true,
  }),
}));
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variantes: ProductVariant[] = [
  {
    id: "v-p",
    productId: "prod-pb",
    name: "Tamanho",
    value: "P",
    stockIncrement: 5,
    active: true,
  },
  {
    id: "v-g",
    productId: "prod-pb",
    name: "Tamanho",
    value: "G",
    stockIncrement: 5,
    priceOverride: 90,
    active: true,
  },
];

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-pb",
    name: "Camisa P&B Acao",
    description: "Descricao de teste",
    price: 80,
    images: [],
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

describe("ProductView — 'Dúvidas no WhatsApp': variação, preço e endereço cru", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
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
    const { toast } = await import("sonner");
    (toast.warning as ReturnType<typeof vi.fn>).mockClear();
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

  async function renderizar(produto: Product) {
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

  const botaoWhatsapp = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Dúvidas no WhatsApp"]',
    );

  async function tocarWhatsapp() {
    const botao = botaoWhatsapp();
    expect(botao).not.toBeNull();
    await act(async () => {
      botao?.click();
    });
  }

  async function escolherTamanho(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    const botao = span?.closest("button") as HTMLButtonElement | null;
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.click();
    });
  }

  function textoDaMensagem(url: string): string {
    return decodeURIComponent(url.split("?text=")[1] ?? "");
  }

  it("variação por escolher: avisa qual grupo falta e NÃO abre o WhatsApp", async () => {
    await renderizar(criarProduto({ variants: variantes }));

    await tocarWhatsapp();

    const { toast } = await import("sonner");
    const chamada = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(chamada).toBeDefined();
    // o título cita o grupo que falta (é o que a cliente precisa para agir)
    expect(chamada[0]).toContain("Tamanho");
    expect(abrir).not.toHaveBeenCalled();
  });

  it("com a variação escolhida: abre o WhatsApp, a mensagem leva a variação e o PREÇO DELA", async () => {
    await renderizar(criarProduto({ variants: variantes }));
    await escolherTamanho("G");

    await tocarWhatsapp();

    const { toast } = await import("sonner");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(textoDaMensagem(url)).toBe(
      "Olá! Tenho interesse no produto: Camisa P&B Acao (Tamanho: G) - R$ 90,00",
    );
    // nunca o preço base do produto (R$ 80) quando a variação custa outro
    expect(textoDaMensagem(url)).not.toContain("80,00");
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
  });

  it("sem variações no produto: abre direto, sem '(…)' na mensagem, com o preço do produto", async () => {
    await renderizar(criarProduto());

    await tocarWhatsapp();

    expect(abrir).toHaveBeenCalledTimes(1);
    const [url] = abrir.mock.calls[0] as [string];
    expect(textoDaMensagem(url)).toBe(
      "Olá! Tenho interesse no produto: Camisa P&B Acao - R$ 80,00",
    );
  });

  it("o endereço é CRU: '&' e '#' do nome e os espaços saem como %26, %23 e %20", async () => {
    await renderizar(criarProduto({ name: "P&B #1 Acao" }));

    await tocarWhatsapp();

    const [url] = abrir.mock.calls[0] as [string];
    expect(url.startsWith("https://wa.me/5534999999999?text=")).toBe(true);
    const query = url.split("?text=")[1] ?? "";
    // '&' solto abre outro parâmetro e '#' solto vira âncora: os dois cortam
    // a mensagem. Espaço literal também não pode ir na URL.
    expect(query).toContain("P%26B%20%231%20Acao");
    expect(query).not.toMatch(/[&#\s]/);
    expect(url).not.toContain("#");
    // um único '?': a estrutura da URL não ganhou parâmetro extra
    expect(url.split("?")).toHaveLength(2);
    // e o texto decodificado continua o original
    expect(textoDaMensagem(url)).toContain("P&B #1 Acao");
  });
});
