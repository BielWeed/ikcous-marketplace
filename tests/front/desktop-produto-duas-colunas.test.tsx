// @vitest-environment jsdom
// F3: os tokens do computador nunca alteram as classes nem a ordem do celular.
import type { Product } from "@/types";
import { ProductView } from "@/views/customer/ProductView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

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
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
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
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true }, isLoaded: true }),
}));

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "produto-desktop",
  name: "Blusa de teste",
  description: "Descrição da blusa",
  price: 100,
  images: ["/foto-1.png", "/foto-2.png"],
  category: "Roupas",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-28T12:00:00Z",
};

describe("F3 — produto no computador e celular preservado", () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("matchMedia", undefined);
    host = document.createElement("main");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar(dados = produto) {
    await act(async () =>
      root.render(
        <ProductView
          product={dados}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      ),
    );
  }
  function elemento(seletor: string, raiz: ParentNode = host): HTMLElement {
    const el = raiz.querySelector<HTMLElement>(seletor);
    expect(el, seletor).not.toBeNull();
    return el!;
  }
  function classe(
    seletor: string,
    celular: string,
    desktop: string,
    raiz: ParentNode = host,
  ) {
    const el = elemento(seletor, raiz);
    expect(classesDoCelular(el.className)).toBe(celular);
    expect(el.classList.contains(desktop)).toBe(true);
    return el;
  }

  it("F3.1 mantém a ordem e a cadeia das seções, com wrappers neutros no celular", async () => {
    await montar();
    // Raiz da view: no desktop recusa o encolhimento do wrapper da cliente
    // (App.tsx) -- sem isso, com o rodapé da loja montado como irmão dentro
    // do container de rolagem, ele caía no MEIO da página (prévia 29/09) e a
    // descrição rolava por baixo do bloco preto.
    const raiz = host.firstElementChild!;
    expect(classesDoCelular(raiz.className)).toBe(
      "pb-customer relative min-h-full bg-white",
    );
    expect(raiz.classList.contains("lg:shrink-0")).toBe(true);
    expect(raiz.classList.contains("lg:pb-0")).toBe(true);
    const titulo = elemento("h1");
    const compra = titulo.parentElement!.parentElement!;
    expect(classesDoCelular(compra.className)).toBe("");
    expect(compra.classList.contains("lg:sticky")).toBe(true);
    expect(compra.classList.contains("lg:row-span-2")).toBe(true);
    expect(compra.classList.contains("lg:col-start-2")).toBe(true);
    const info = compra.parentElement!;
    expect(classesDoCelular(info.className)).toBe("px-5 py-4");
    expect(info.classList.contains("lg:contents")).toBe(true);
    const grade = info.parentElement!;
    expect(classesDoCelular(grade.className)).toBe("");
    expect(grade.classList.contains("lg:grid")).toBe(true);
    const secoes = elemento("#details-section").parentElement!;
    expect(classesDoCelular(secoes.className)).toBe("");
    expect(
      secoes.contains(elemento("nav[aria-label='Seções do produto']")),
    ).toBe(true);
    expect(secoes.contains(elemento("#reviews-section"))).toBe(true);
    expect(secoes.contains(elemento("#chat-section"))).toBe(true);
    expect(secoes.contains(elemento(".h-44"))).toBe(true);
    const textos = [
      "Início",
      "Blusa de teste",
      "R$ 100,00",
      "Adicionar ao Carrinho",
      "Detalhes",
      "Descrição da blusa",
      "Este produto ainda não foi avaliado",
      "Perguntas e Respostas",
      "Você também pode gostar",
    ];
    const texto = host.textContent!;
    const indices = textos.map((t) => texto.indexOf(t));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("F3.2 limita a galeria, mantém as setas visíveis e oculta só os pontos no desktop", async () => {
    await montar();
    const foto = elemento(".main-product-image");
    const caixa = foto.parentElement!.parentElement!;
    expect(classesDoCelular(caixa.className)).toBe(
      "group relative aspect-[4/3] overflow-hidden rounded-b-[2rem] bg-[#F8F9FA] sm:aspect-[4/3]",
    );
    expect(caixa.classList.contains("lg:rounded-3xl")).toBe(true);
    expect(
      caixa.classList.contains(
        "lg:max-h-[calc(100dvh-var(--header-height)-96px)]",
      ),
    ).toBe(true);
    expect(foto.parentElement!.classList.contains("lg:h-[70vh]")).toBe(false);
    expect(foto.getAttribute("sizes")).toBe("(min-width: 1024px) 720px, 100vw");
    expect(
      elemento(
        "button[aria-label='Foto 1 de 2']",
      ).parentElement!.classList.contains("lg:hidden"),
    ).toBe(true);
    expect(
      elemento(
        "button[aria-label='Foto anterior']",
      ).parentElement!.classList.contains("lg:!opacity-100"),
    ).toBe(true);
  });

  it.each([false, true])(
    "F3.4 conserva título e preço, inclusive promoção=%s",
    async (promocao) => {
      await montar({ ...produto, originalPrice: promocao ? 150 : undefined });
      classe(
        "h1",
        "text-xl font-black leading-tight tracking-tight text-zinc-900",
        "lg:text-3xl",
      );
      classe(
        "span.text-2xl",
        `text-2xl font-black tracking-tight ${promocao ? "text-emerald-600" : "text-zinc-900"}`,
        "lg:text-4xl",
      );
      const comprar = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Adicionar ao Carrinho"),
      )!;
      expect(comprar.classList.contains("lg:h-12")).toBe(true);
      expect(comprar.classList.contains("lg:text-xs")).toBe(true);
      // O CTA ocupa a linha inteira no desktop: dividindo a linha com
      // quantidade e WhatsApp, o rótulo transbordava e era cortado pela
      // borda do cartão (prévia 29/09, 1440px).
      expect(comprar.classList.contains("lg:basis-full")).toBe(true);
      const linhaDeAcao = comprar.parentElement!;
      expect(classesDoCelular(linhaDeAcao.className)).toBe(
        "mb-5 flex items-center gap-2",
      );
      expect(linhaDeAcao.classList.contains("lg:flex-wrap")).toBe(true);
    },
  );

  it("F3.5 esconde a barra dockada e sua reserva só no desktop", async () => {
    await montar();
    classe(".h-44", "h-44 md:h-36", "lg:hidden");
    expect(
      elemento(".bottom-docked-navigation", document).classList.contains(
        "lg:hidden",
      ),
    ).toBe(true);
  });

  it("F3.6 alinha as abas e dá escala de leitura à descrição e perguntas", async () => {
    await montar();
    const abas = classe(
      "nav[aria-label='Seções do produto']",
      "mx-auto flex w-full max-w-[290px] items-center gap-0.5 rounded-full border border-zinc-200/40 bg-zinc-100/60 p-0.5",
      "lg:mx-0",
    );
    // Desktop: abas de site -- linha inteira com separador embaixo, não a
    // pílula flutuante de 360px (prévia 29/09).
    expect(abas.classList.contains("lg:max-w-none")).toBe(true);
    expect(abas.classList.contains("lg:bg-transparent")).toBe(true);
    // A barra sticky não sangra a coluna com as margens negativas do celular.
    expect(abas.parentElement!.classList.contains("lg:mx-0")).toBe(true);
    // O indicador ativo vira um traço preto rente ao separador: o pill
    // (motion.div) é o primeiro filho do botão com aria-current.
    const pill = abas.querySelector("button[aria-current='true'] > div");
    expect(pill).not.toBeNull();
    expect(pill!.classList.contains("lg:bg-zinc-950")).toBe(true);
    expect(pill!.classList.contains("lg:h-[2.5px]")).toBe(true);
    classe(
      "#details-section p",
      "text-sm leading-relaxed text-gray-600",
      "lg:text-base",
    );
    expect(
      elemento("#details-section p").parentElement!.classList.contains(
        "lg:max-w-prose",
      ),
    ).toBe(true);
    classe("#chat-section h3 + p", "text-xs text-zinc-500", "lg:text-sm");
  });

  it("F3.7 relacionados em três colunas sem alterar a grade de celular", async () => {
    await montar();
    classe(
      ".grid-cols-2",
      "-mx-4 grid grid-cols-2 gap-2 px-2",
      "lg:grid-cols-3",
    );
  });

  it("F3.3 monta miniaturas só no computador e o clique troca a foto", async () => {
    await montar();
    expect(
      host.querySelector("button[aria-label='Ver foto 2 de 2']"),
    ).toBeNull();
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(min-width: 1024px)",
    }));
    await montar();
    const miniatura = elemento("button[aria-label='Ver foto 2 de 2']");
    await act(async () => miniatura.click());
    // AnimatePresence conserva a imagem de saída durante a transição.
    expect(
      host.querySelector(".main-product-image[src='/foto-2.png']"),
    ).not.toBeNull();
    expect(miniatura.getAttribute("aria-current")).toBe("true");
  });

  it("F3.3 não mostra miniaturas para foto única nem variação com imagem própria", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(min-width: 1024px)",
    }));
    await montar({ ...produto, images: ["/foto-1.png"] });
    expect(host.querySelector("button[aria-label^='Ver foto']")).toBeNull();
    await montar({
      ...produto,
      variants: [
        {
          id: "v-m",
          productId: produto.id,
          name: "Tamanho",
          value: "M",
          active: true,
          stockIncrement: 5,
          imageUrl: "/foto-m.png",
        },
      ],
    });
    const tamanho = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "M(5 un.)",
    )!;
    expect(tamanho).toBeDefined();
    await act(async () => tamanho.click());
    expect(host.querySelector("button[aria-label^='Ver foto']")).toBeNull();
    expect(elemento(".main-product-image").getAttribute("src")).toContain(
      "foto-m.png",
    );
  });
});
