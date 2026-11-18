// @vitest-environment jsdom
//
// "Dúvidas no WhatsApp" da página do produto (ProductView.handleWhatsApp).
// Três promessas que nenhum teste fixava:
//
//  1. Sem variação escolhida, o botão de dúvidas abre o WhatsApp com o nome
//     do produto, inclusive quando todas as opções estão esgotadas.
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
const contato = vi.hoisted(() => ({ numero: "34999999999" }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: contato.numero },
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
    contato.numero = "34999999999";
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

  it.each(["034 99999-1234", "0055 34 99999-1234", "5534999991234"])(
    "normaliza o contato legado %s sem trocar o destinatário",
    async (numero) => {
      contato.numero = numero;
      await renderizar(criarProduto());
      await tocarWhatsapp();
      expect(abrir.mock.calls[0][0]).toMatch(
        /^https:\/\/wa.me\/5534999991234\?text=/,
      );
    },
  );

  it.each([false, true])(
    "sem variação escolhida abre dúvidas com o produto, todas esgotadas=%s",
    async (esgotadas) => {
      await renderizar(
        criarProduto({
          stock: esgotadas ? 0 : 10,
          variants: esgotadas
            ? variantes.map((variante) => ({ ...variante, stockIncrement: 0 }))
            : variantes,
        }),
      );
      if (esgotadas) {
        for (const valor of ["P", "G"]) {
          const opcao = hospedeiro.querySelector<HTMLButtonElement>(
            `button[aria-label="${valor}, esgotado"]`,
          );
          expect(opcao).not.toBeNull();
          expect(opcao?.disabled).toBe(true);
        }
      }

      await tocarWhatsapp();

      expect(abrir).toHaveBeenCalledTimes(1);
      expect(textoDaMensagem(abrir.mock.calls[0][0])).toBe(
        "Olá! Tenho interesse no produto: Camisa P&B Acao",
      );
      const { toast } = await import("sonner");
      expect(toast.warning).not.toHaveBeenCalled();
    },
  );

  it("sem escolha não envia o preço base quando todas as variações têm preço próprio", async () => {
    await renderizar(
      criarProduto({
        price: 50,
        variants: variantes.map((variante, indice) => ({
          ...variante,
          priceOverride: indice === 0 ? 100 : 120,
        })),
      }),
    );
    expect(hospedeiro.textContent).toContain("A partir de");
    expect(hospedeiro.textContent).toContain("100,00");

    await tocarWhatsapp();

    expect(abrir).toHaveBeenCalledTimes(1);
    const mensagem = textoDaMensagem(abrir.mock.calls[0][0]);
    expect(mensagem).not.toContain("R$ 50");
    expect(mensagem).toBe("Olá! Tenho interesse no produto: Camisa P&B Acao");
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

  it("escolha incompleta em cadastro de dois grupos: a mensagem sai sem preço nenhum", async () => {
    const cor = (valor: string, id: string): ProductVariant => ({
      id,
      productId: "prod-pb",
      name: "Cor",
      value: valor,
      stockIncrement: 5,
      active: true,
    });
    await renderizar(
      criarProduto({
        variants: [cor("Azul", "v-az"), cor("Preto", "v-pr"), ...variantes],
      }),
    );
    await escolherTamanho("G");

    await tocarWhatsapp();

    expect(abrir).toHaveBeenCalledTimes(1);
    const mensagem = textoDaMensagem(abrir.mock.calls[0][0]);
    expect(mensagem).not.toContain("R$");
    expect(mensagem).toContain("Camisa P&B Acao");
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
