// @vitest-environment jsdom
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loja = vi.hoisted(() => ({
  config: { enableReviews: false } as Record<string, unknown>,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.config, products: [] }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ erro: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));

function produto(
  id: string,
  name: string,
  price: number,
  category: string,
  originalPrice?: number,
  stock = 10,
): Product {
  return {
    id,
    name,
    price,
    category,
    originalPrice,
    description: "",
    images: [],
    stock,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-10-20T12:00:00Z",
    variants: [],
  };
}
const favoritos = [
  produto("a", "Zebra", 90, "Brinquedo"),
  produto("b", "Bola", 12, "Brinquedo", 25),
  produto("c", "Agenda", 30, "Papelaria", 30),
];
let raiz: Root;
let container: HTMLDivElement;
const navegar = vi.fn();

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  loja.config = { enableReviews: false };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  navegar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function montar(lista = favoritos, isActive = true) {
  act(() =>
    raiz.render(
      <FavoritesView
        favorites={lista}
        onToggleFavorite={vi.fn()}
        onProductClick={vi.fn()}
        onNavigate={navegar}
        isActive={isActive}
      />,
    ),
  );
}
function nomes() {
  return [...container.querySelectorAll("h3 button")].map(
    (el) => el.textContent,
  );
}
function botao(nome: string) {
  const el = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  );
  expect(el, `botão ${nome}`).toBeDefined();
  return el!;
}
function tocar(nome: string) {
  act(() => botao(nome).click());
}
function secoes() {
  return [...container.querySelectorAll("section")].map((sec) => ({
    titulo: sec.querySelector("h2")?.textContent,
    itens: [...sec.querySelectorAll("h3 button")].map((el) => el.textContent),
  }));
}
function muitos(qtd: number, categoria: string, prefixo = "Item") {
  return Array.from({ length: qtd }, (_, i) =>
    produto(`${prefixo}${i}`, `${prefixo} ${i + 1}`, 10 + i, categoria),
  );
}

describe("Favoritos — lista vertical por categoria", () => {
  it("mostra título, contador e leva a 'Ver mais produtos' no fim da lista, dentro da tela", () => {
    montar();
    expect(container.querySelector("h1")?.textContent).toBe("Favoritos");
    expect(container.textContent).toContain("3 produtos que você salvou");
    const acao = botao("Ver mais produtos");
    expect(container.contains(acao)).toBe(true);
    act(() => acao.click());
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("agrupa por categoria, com nome e contagem no cabeçalho de cada seção", () => {
    montar();
    expect(secoes()).toEqual([
      { titulo: "Brinquedo", itens: ["Zebra", "Bola"] },
      { titulo: "Papelaria", itens: ["Agenda"] },
    ]);
    const cabecalho = container.querySelector("section")!.textContent;
    expect(cabecalho).toContain("2 produtos");
    expect(container.textContent).toContain("1 produto");
  });

  it("mostra só os 3 primeiros; 'Ver todos (N)' expande e 'Mostrar menos' recolhe", () => {
    montar(muitos(5, "Brinquedo"));
    expect(nomes()).toEqual(["Item 1", "Item 2", "Item 3"]);
    const ver = botao("Ver todos (5)");
    expect(ver.getAttribute("aria-expanded")).toBe("false");
    act(() => ver.click());
    expect(nomes()).toHaveLength(5);
    const menos = botao("Mostrar menos");
    expect(menos.getAttribute("aria-expanded")).toBe("true");
    act(() => menos.click());
    expect(nomes()).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(botao("Ver todos (5)").getAttribute("aria-expanded")).toBe("false");
  });

  it("categoria com até 3 itens não oferece 'Ver todos'", () => {
    montar(muitos(3, "Brinquedo"));
    expect(container.textContent).not.toContain("Ver todos");
  });

  it("expandir uma categoria não expande as outras", () => {
    montar([...muitos(5, "Brinquedo", "B"), ...muitos(5, "Papelaria", "P")]);
    act(() => botao("Ver todos (5)").click());
    expect(secoes().map((s) => s.itens.length)).toEqual([5, 3]);
  });

  it("só mostra a faixa de atalhos com 3 ou mais categorias", () => {
    montar();
    expect(container.querySelector('nav[aria-label="Categorias"]')).toBeNull();
    montar([...favoritos, produto("d", "Caneca", 20, "Cozinha")]);
    const faixa = container.querySelector('nav[aria-label="Categorias"]');
    expect(faixa).not.toBeNull();
    expect(
      [...faixa!.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Brinquedo 2", "Papelaria 1", "Cozinha 1"]);
  });

  it("tocar num atalho rola até a seção e marca o atalho como ativo", () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    montar([...favoritos, produto("d", "Caneca", 20, "Cozinha")]);
    tocar("Papelaria 1");
    expect(rolar).toHaveBeenCalledTimes(1);
    const secao = rolar.mock.contexts[0] as HTMLElement;
    expect(secao.querySelector("h2")?.textContent).toBe("Papelaria");
    expect(botao("Papelaria 1").getAttribute("aria-current")).toBe("true");
    expect(botao("Brinquedo 2").getAttribute("aria-current")).toBeNull();
  });

  it("ordena por preço e nome dentro de cada categoria, sem modificar a lista recebida", () => {
    montar();
    const ordem = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Ordem dos favoritos"]',
    );
    expect(ordem).not.toBeNull();
    expect(nomes()).toEqual(["Zebra", "Bola", "Agenda"]);
    for (const [valor, esperado] of [
      ["menor", ["Bola", "Zebra", "Agenda"]],
      ["maior", ["Zebra", "Bola", "Agenda"]],
      ["nome", ["Bola", "Zebra", "Agenda"]],
      ["original", ["Zebra", "Bola", "Agenda"]],
    ] as const) {
      act(() => {
        ordem!.value = valor;
        ordem!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(nomes()).toEqual(esperado);
    }
    expect(favoritos.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("'Com desconto' está sempre à mão e filtra; tocar de novo devolve todos", () => {
    montar();
    expect(botao("Com desconto 1").getAttribute("aria-pressed")).toBe("false");
    tocar("Com desconto 1");
    expect(nomes()).toEqual(["Bola"]);
    expect(botao("Com desconto 1").getAttribute("aria-pressed")).toBe("true");
    tocar("Com desconto 1");
    expect(nomes()).toEqual(["Zebra", "Bola", "Agenda"]);
  });

  it("sem nenhum produto em promoção o filtro continua lá e leva a 'Limpar filtros'", () => {
    montar([favoritos[2]]);
    expect(container.textContent).toContain("1 produto que você salvou");
    tocar("Com desconto");
    expect(nomes()).toEqual([]);
    expect(container.textContent).toContain(
      "Nenhum favorito com esses filtros.",
    );
    tocar("Limpar filtros");
    expect(nomes()).toEqual(["Agenda"]);
  });

  it("inclui brinde com preço zero no desconto e não inventa promoção com preço original menor", () => {
    montar([
      produto("gratis", "Brinde", 0, "", 10),
      produto("normal", "Normal", 20, "", 10),
    ]);
    tocar("Com desconto 1");
    expect(nomes()).toEqual(["Brinde"]);
  });

  it("produto sem categoria cai numa seção 'Outros'", () => {
    montar([produto("x", "Solto", 5, "")]);
    expect(secoes()).toEqual([{ titulo: "Outros", itens: ["Solto"] }]);
  });

  it("ao remover o último item que casa com o filtro, permite limpar sem alterar favoritos", () => {
    montar();
    tocar("Com desconto 1");
    montar([favoritos[0], favoritos[2]]);
    expect(nomes()).toEqual([]);
    tocar("Limpar filtros");
    expect(nomes()).toEqual(["Zebra", "Agenda"]);
  });
});

describe("Favoritos — o que cada linha diz", () => {
  it("promoção: preço atual, 'De' riscado e % de desconto", () => {
    montar([produto("b", "Bola", 12.9, "Brinquedo", 24.9)]);
    const texto = container.textContent ?? "";
    expect(texto).toContain("12,90");
    expect(texto).toContain("24,90");
    expect(texto).toContain("48% OFF");
    expect(container.querySelector(".line-through")?.textContent).toContain(
      "24,90",
    );
  });

  it("estoque: normal, poucas unidades e sem estoque, com texto e não só cor", () => {
    montar([
      produto("a", "Cheio", 10, "X", undefined, 50),
      produto("b", "Quase", 10, "X", undefined, 3),
      produto("c", "Acabou", 10, "X", undefined, 0),
    ]);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Estoque: 50");
    expect(texto).toContain("Restam 3");
    expect(texto).toContain("Sem estoque");
    const acoes = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="product-card-action"]',
      ),
    ];
    expect(acoes.map((b) => b.disabled)).toEqual([false, false, true]);
  });

  it("cada linha anuncia nome, preço e estoque; os botões levam o nome do produto", () => {
    montar([produto("b", "Bola", 12, "Brinquedo", undefined, 3)]);
    const nome = container.querySelector<HTMLButtonElement>("h3 button")!;
    const info = document.getElementById(
      nome.getAttribute("aria-describedby")!,
    );
    expect(info?.textContent).toContain("12,00");
    expect(info?.textContent).toContain("Restam 3");
    expect(
      container
        .querySelector('[data-testid="product-card-action"]')
        ?.getAttribute("aria-label"),
    ).toContain("Bola");
    expect(
      container
        .querySelector("[data-botao-favorito]")
        ?.getAttribute("aria-label"),
    ).toContain("Bola");
  });

  it("mantém o selo de frete grátis do produto, sem ocupar uma linha extra", () => {
    loja.config = { enableReviews: false, freeShippingMin: -1 };
    montar([{ ...produto("f", "Frete", 10, "X"), freeShipping: true }]);
    expect(container.textContent).toContain("Frete");
    expect(container.textContent?.toLowerCase()).toContain("frete grátis");
  });

  it("não usa grade de 2 colunas (sem rolagem horizontal de página)", () => {
    montar();
    expect(container.querySelector(".grid-cols-2")).toBeNull();
  });
});

describe("Favoritos — estado vazio", () => {
  it("diz que não há favoritos e chama para ver produtos", () => {
    montar([]);
    expect(container.textContent).toContain("Você ainda não tem favoritos");
    expect(container.textContent).toContain("Nenhum produto salvo ainda");
    act(() => botao("Ver produtos").click());
    expect(navegar).toHaveBeenCalledWith("home");
    expect(
      container.querySelector('select[aria-label="Ordem dos favoritos"]'),
    ).toBeNull();
  });
});
