// @vitest-environment jsdom
//
// A Home da cliente: as três faixas AUTOMÁTICAS (Últimos Lançamentos, Ofertas
// Imperdíveis, Destaques em Alta) só mostram produto que ela consegue comprar E
// que tem foto de verdade; faixa que fica sem ninguém DESAPARECE (sem deixar
// esqueleto cinza para trás); o Catálogo continua com tudo; faixa montada à mão
// pela lojista não muda; o produto que cabe em mais de uma faixa continua em
// todas. As regras em si vivem em `src/lib/vitrine-do-painel.ts` (testadas em
// vitrine-faixas-automaticas-so-a-venda-e-com-foto.test.ts); aqui se prova que
// a HomeView as usa e o que a cliente vê.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let configDaLoja: Record<string, unknown> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => Promise.resolve({ data: null, error: null });
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => null,
}));

// Dublês que só expõem o título e os produtos recebidos: o que está em dúvida
// é QUAIS produtos a Home entrega a cada faixa (e ao Catálogo).
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: ({
    title,
    products,
  }: {
    readonly title: string;
    readonly products: readonly Product[];
  }) => (
    <section data-faixa={title}>
      {products.map((p) => (
        <i key={p.id} data-na-faixa={p.id} />
      ))}
    </section>
  ),
}));
vi.mock("@/components/ui/custom/PremiumOffers", async () => {
  const { fileirasDaFaixa } = await import(
    "@/components/ui/custom/ofertas-lateral-duplo-altura"
  );
  return {
    PremiumOffers: ({
      title,
      products,
    }: {
      readonly title: string;
      readonly products: readonly Product[];
    }) => (
      // `data-fileiras` é a conta que o PremiumOffers real faz com o que recebe.
      <section
        data-faixa={title}
        data-fileiras={fileirasDaFaixa(products.length)}
      >
        {products.map((p) => (
          <i key={p.id} data-na-faixa={p.id} />
        ))}
      </section>
    ),
  };
});
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: ({ products }: { readonly products: readonly Product[] }) => (
    <div data-catalogo>
      {products.map((p) => (
        <i key={p.id} data-no-catalogo={p.id} />
      ))}
    </div>
  ),
}));

const FOTO = "https://cdn.exemplo/foto.jpg";
const GENERICA = "https://placehold.co/600x400?text=Sem+Imagem";

const produto = (id: string, extras: Partial<Product> = {}): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price: 100,
  images: [FOTO],
  category: "Roupas",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  createdTime: 1000,
  ...extras,
});

describe("HomeView — faixas automáticas só com produto à venda e com foto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let memoria: Map<string, string>;

  beforeEach(() => {
    configDaLoja = {};
    memoria = new Map();
    // O jsdom deste runner não entrega localStorage funcional: um fake por
    // caso, para a memória da Home (último desenho) poder ser lida e gravada.
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => memoria.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        memoria.set(chave, String(valor));
      },
      removeItem: (chave: string) => {
        memoria.delete(chave);
      },
    });
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const render = async (produtos: Product[], isLoading = false) => {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          selectedCategory="Todas"
          searchQuery=""
          sortBy="default"
          isLoading={isLoading}
          onCategoryChange={() => {}}
          onSortByChange={() => {}}
        />,
      );
    });
  };

  const naFaixa = (titulo: string) =>
    Array.from(
      hospedeiro.querySelectorAll(`[data-faixa="${titulo}"] [data-na-faixa]`),
    ).map((el) => el.getAttribute("data-na-faixa"));
  const faixaExiste = (titulo: string) =>
    hospedeiro.querySelector(`[data-faixa="${titulo}"]`) !== null;
  const noCatalogo = () =>
    Array.from(hospedeiro.querySelectorAll("[data-no-catalogo]")).map((el) =>
      el.getAttribute("data-no-catalogo"),
    );
  const memoriaGravada = () =>
    JSON.parse(memoria.get("ikcous_home_memoria") ?? "{}");
  const LANC = "Últimos Lançamentos";
  const OFERTAS = "Ofertas Imperdíveis";
  const DESTAQUES = "Destaques em Alta";

  it("(1) todos à venda e com foto: as três faixas e o Catálogo mostram os três", async () => {
    await render(
      ["a", "b", "c"].map((id, i) =>
        produto(id, {
          createdTime: (i + 1) * 100,
          originalPrice: 150,
          isBestseller: true,
        }),
      ),
    );
    expect(naFaixa(LANC)).toEqual(["c", "b", "a"]);
    expect(naFaixa(OFERTAS)).toEqual(["c", "b", "a"]);
    expect(naFaixa(DESTAQUES)).toEqual(["c", "b", "a"]);
    expect(noCatalogo()).toHaveLength(3);
  });

  it("(2) um esgotado entre três: Lançamentos mostra dois; o Catálogo segue com os três, o esgotado no fim", async () => {
    await render([
      produto("a", { createdTime: 100 }),
      produto("esgotado", { createdTime: 900, stock: 0 }),
      produto("c", { createdTime: 200 }),
    ]);
    expect(naFaixa(LANC)).toEqual(["c", "a"]);
    expect(noCatalogo()).toEqual(["c", "a", "esgotado"]);
  });

  it("(3) tudo esgotado: nenhuma faixa automática aparece e o Catálogo mostra os três", async () => {
    await render(
      ["a", "b", "c"].map((id) =>
        produto(id, { stock: 0, originalPrice: 150, isBestseller: true }),
      ),
    );
    expect(faixaExiste(LANC)).toBe(false);
    expect(faixaExiste(OFERTAS)).toBe(false);
    expect(faixaExiste(DESTAQUES)).toBe(false);
    expect(noCatalogo()).toHaveLength(3);
    // Nem título solto, nem esqueleto cinza no lugar da faixa
    expect(hospedeiro.querySelector('[data-testid^="esqueleto"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain(LANC);
  });

  it("(4) cor em estoque mas todos os tamanhos zerados: fica fora da faixa, no Catálogo", async () => {
    await render([
      produto("sem-tamanho", {
        stock: 8,
        variants: [
          {
            id: "v1",
            name: "Cor",
            value: "Azul",
            active: true,
            stockIncrement: 8,
          },
          {
            id: "v2",
            name: "Tamanho",
            value: "P",
            active: true,
            stockIncrement: 0,
          },
        ] as unknown as Product["variants"],
      }),
      produto("normal"),
    ]);
    expect(naFaixa(LANC)).toEqual(["normal"]);
    expect(noCatalogo()).toContain("sem-tamanho");
  });

  it("(5) sem foto (ou só a imagem cinza): fora das 3 faixas, dentro do Catálogo", async () => {
    await render([
      produto("sem-foto", {
        images: [],
        originalPrice: 150,
        isBestseller: true,
      }),
      produto("cinza", {
        images: [GENERICA],
        originalPrice: 150,
        isBestseller: true,
      }),
      produto("boa", { originalPrice: 150, isBestseller: true }),
    ]);
    expect(naFaixa(LANC)).toEqual(["boa"]);
    expect(naFaixa(OFERTAS)).toEqual(["boa"]);
    expect(naFaixa(DESTAQUES)).toEqual(["boa"]);
    expect(noCatalogo().sort()).toEqual(["boa", "cinza", "sem-foto"]);
  });

  it("(6) destaque que esgota sai de Destaques e volta ao repor; faixa some e volta", async () => {
    const base = produto("d", { isBestseller: true });
    await render([base]);
    expect(naFaixa(DESTAQUES)).toEqual(["d"]);
    await render([{ ...base, stock: 0 }]);
    expect(faixaExiste(DESTAQUES)).toBe(false);
    expect(noCatalogo()).toEqual(["d"]);
    await render([{ ...base, stock: 3 }]);
    expect(naFaixa(DESTAQUES)).toEqual(["d"]);
  });

  it("(7) faixa montada à mão: mostra o que a lojista escolheu, até esgotado e sem foto", async () => {
    configDaLoja = {
      homeSections: [
        {
          id: "custom_kits",
          title: "Kits",
          active: true,
          isCustom: true,
          productIds: ["esgotado", "sem-foto"],
        },
        {
          id: "offers",
          title: OFERTAS,
          active: true,
          productIds: ["esgotado", "sem-foto"],
        },
      ],
    };
    await render([
      produto("esgotado", { stock: 0, originalPrice: 150 }),
      produto("sem-foto", { images: [], originalPrice: 150 }),
      produto("boa", { originalPrice: 150 }),
    ]);
    expect(naFaixa("Kits")).toEqual(["esgotado", "sem-foto"]);
    expect(naFaixa(OFERTAS)).toEqual(["esgotado", "sem-foto"]);
  });

  it("(8) lançamento em oferta e destaque continua nas TRÊS faixas", async () => {
    await render([produto("p", { originalPrice: 150, isBestseller: true })]);
    expect(naFaixa(LANC)).toEqual(["p"]);
    expect(naFaixa(OFERTAS)).toEqual(["p"]);
    expect(naFaixa(DESTAQUES)).toEqual(["p"]);
  });

  it("(10) Ofertas com 1 produto restante: fileira única, sem lugar vazio reservado", async () => {
    await render([
      produto("so-ele", { originalPrice: 150 }),
      produto("esgotado", { stock: 0, originalPrice: 150 }),
      produto("sem-foto", { images: [], originalPrice: 150 }),
    ]);
    expect(naFaixa(OFERTAS)).toEqual(["so-ele"]);
    expect(
      hospedeiro
        .querySelector(`[data-faixa="${OFERTAS}"]`)
        ?.getAttribute("data-fileiras"),
    ).toBe("1");
    // E a memória da próxima visita guarda 1 (esqueleto de uma fileira só)
    expect(memoriaGravada()).toMatchObject({ temOfertas: true, qtdOfertas: 1 });
  });

  describe("a faixa que desaparece não pisca um bloco cinza", () => {
    const semearMemoria = (extra: Record<string, unknown>) =>
      memoria.set(
        "ikcous_home_memoria",
        JSON.stringify({
          temBanner: false,
          temOfertas: false,
          temBestsellers: false,
          ...extra,
          gravadoEm: Date.now(),
        }),
      );

    it("a visita que termina sem nenhum lançamento à venda grava isso para a próxima", async () => {
      await render([produto("a", { stock: 0 })]);
      expect(memoriaGravada()).toMatchObject({ temLancamentos: false });
      await render([produto("a")]);
      expect(memoriaGravada()).toMatchObject({ temLancamentos: true });
    });

    it("volta a loja que ficou sem lançamentos: carregando, nenhum esqueleto de lançamentos nasce", async () => {
      semearMemoria({ temLancamentos: false });
      await render([], true);
      expect(
        hospedeiro.querySelector('[data-testid="esqueleto-carrossel"]'),
      ).toBeNull();
    });

    it("controle: memória sem a informação (versão anterior) ou 'tinha' continua reservando o esqueleto", async () => {
      semearMemoria({});
      await render([], true);
      expect(
        hospedeiro.querySelector('[data-testid="esqueleto-carrossel"]'),
      ).not.toBeNull();
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      semearMemoria({ temLancamentos: true });
      await render([], true);
      expect(
        hospedeiro.querySelector('[data-testid="esqueleto-carrossel"]'),
      ).not.toBeNull();
    });

    it("carregou e ninguém restou: o esqueleto que existia some junto com a faixa", async () => {
      await render([], true);
      expect(
        hospedeiro.querySelector('[data-testid="esqueleto-carrossel"]'),
      ).not.toBeNull();
      await render([produto("a", { stock: 0 })], false);
      expect(
        hospedeiro.querySelector('[data-testid="esqueleto-carrossel"]'),
      ).toBeNull();
      expect(faixaExiste(LANC)).toBe(false);
    });
  });
});
