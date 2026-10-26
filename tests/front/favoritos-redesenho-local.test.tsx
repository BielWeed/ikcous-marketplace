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

  it("a escolha de ordem aparece no rótulo e marca o botão; 'Ordem original' volta ao rótulo simples", () => {
    montar();
    const ordem = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Ordem dos favoritos"]',
    )!;
    const rotulo = () => ordem.parentElement!;
    expect(rotulo().textContent).toContain("Ordem");
    expect(rotulo().textContent).not.toContain("Ordem:");
    expect(rotulo().getAttribute("aria-current")).toBeNull();
    act(() => {
      ordem.value = "nome";
      ordem.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rotulo().textContent).toContain("Ordem: A–Z");
    expect(rotulo().getAttribute("aria-current")).toBe("true");
    act(() => {
      ordem.value = "original";
      ordem.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rotulo().getAttribute("aria-current")).toBeNull();
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

describe("Favoritos — o atalho ativo acompanha a rolagem nos dois sentidos", () => {
  const quatro = [
    produto("a", "Bola", 10, "Brinquedos"),
    produto("b", "Bloco", 10, "Papelaria"),
    produto("c", "Camisa", 10, "Roupas"),
    produto("d", "Solto", 10, "Cozinha"),
  ];

  /** Posiciona as seções (topo de cada uma na tela) e avisa a rolagem. */
  function rolarPara(
    topos: number[],
    fim = false,
    painel: HTMLElement | null = null,
  ) {
    const secoesEl = [...container.querySelectorAll("section")];
    secoesEl.forEach((sec, i) => {
      sec.getBoundingClientRect = () =>
        ({ top: topos[i], bottom: topos[i] + 100, height: 100 }) as DOMRect;
    });
    const raiz = painel ?? document.documentElement;
    Object.defineProperty(raiz, "scrollHeight", {
      value: 3000,
      configurable: true,
    });
    Object.defineProperty(raiz, "clientHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(raiz, "scrollTop", {
      value: fim ? 2200 : -topos[0],
      configurable: true,
    });
    act(() => {
      (painel ?? document).dispatchEvent(new Event("scroll"));
    });
  }
  const ativo = () =>
    [...container.querySelectorAll('nav[aria-label="Categorias"] button')]
      .filter((b) => b.getAttribute("aria-current") === "true")
      .map((b) => b.textContent);

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    montar(quatro);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolando para baixo e depois para cima, o chip preto volta para a seção da tela", () => {
    expect(ativo()).toEqual(["Brinquedos 1"]);
    rolarPara([-500, -100, 300, 700]);
    expect(ativo()).toEqual(["Papelaria 1"]);
    rolarPara([-900, -500, -100, 300]);
    expect(ativo()).toEqual(["Roupas 1"]);
    rolarPara([-500, -100, 300, 700]);
    expect(ativo()).toEqual(["Papelaria 1"]);
    rolarPara([0, 400, 800, 1200]);
    expect(ativo()).toEqual(["Brinquedos 1"]);
  });

  it("no fim da página a última seção fica ativa, mesmo curta demais para chegar ao topo", () => {
    rolarPara([-600, -450, 300, 450], true);
    expect(ativo()).toEqual(["Cozinha 1"]);
    // subindo um pouco, deixa de ser o fim da página
    rolarPara([-500, -350, 400, 550], false);
    expect(ativo()).toEqual(["Papelaria 1"]);
  });

  it("não escuta mais a rolagem depois de sair da tela", () => {
    const remover = vi.spyOn(document, "removeEventListener");
    act(() => raiz.unmount());
    expect(remover.mock.calls.some(([tipo]) => tipo === "scroll")).toBe(true);
    raiz = createRoot(container);
  });

  describe("depois de tocar num atalho", () => {
    const rolar = vi.fn();
    // Passo a passo de uma rolagem suave até "Roupas" (topo em 348): a
    // posição vai de 0 até 348 em quadros sucessivos.
    const quadros = [50, 120, 200, 280, 348].map((dy) => [
      -dy,
      174 - dy,
      348 - dy,
      522 - dy,
    ]);
    beforeEach(() => {
      rolar.mockClear();
      Element.prototype.scrollIntoView = rolar;
      rolarPara([0, 174, 348, 522]);
    });

    it("o atalho tocado fica ativo do primeiro ao último quadro da rolagem suave e termina nele", () => {
      tocar("Roupas 1");
      expect(rolar).toHaveBeenCalledTimes(1);
      expect(ativo()).toEqual(["Roupas 1"]);
      for (const topos of quadros) {
        rolarPara(topos);
        expect(ativo()).toEqual(["Roupas 1"]);
      }
      act(() => vi.advanceTimersByTime(200));
      expect(ativo()).toEqual(["Roupas 1"]);
    });

    it("funciona também quando a rolagem é de um painel interno, não da janela", () => {
      const painel = container;
      tocar("Roupas 1");
      for (const topos of quadros) {
        rolarPara(topos, false, painel);
        expect(ativo()).toEqual(["Roupas 1"]);
      }
      act(() => vi.advanceTimersByTime(200));
      expect(ativo()).toEqual(["Roupas 1"]);
      // soltou o comando: a próxima rolagem manual no painel volta a mandar
      rolarPara([-348, -174, 0, 174], false, painel);
      expect(ativo()).toEqual(["Cozinha 1"]);
    });

    it("toque numa das últimas categorias que chega ao fim da página não passa o destaque para a última", () => {
      tocar("Roupas 1");
      rolarPara([-100, 74, 248, 422]);
      rolarPara([-300, -126, 48, 222], true);
      expect(ativo()).toEqual(["Roupas 1"]);
      act(() => vi.advanceTimersByTime(200));
      expect(ativo()).toEqual(["Roupas 1"]);
    });

    it("tocar na tela ou girar a roda durante a rolagem devolve o comando à rolagem manual", () => {
      for (const tipo of ["touchstart", "wheel"]) {
        tocar("Roupas 1");
        rolarPara([-50, 124, 298, 472]);
        expect(ativo()).toEqual(["Roupas 1"]);
        act(() => {
          document.dispatchEvent(new Event(tipo, { bubbles: true }));
        });
        rolarPara([-60, 114, 288, 462]);
        expect(ativo()).toEqual(["Papelaria 1"]);
        rolarPara([0, 174, 348, 522]);
      }
    });

    it("tecla de rolagem também destrava", () => {
      tocar("Roupas 1");
      rolarPara([-50, 124, 298, 472]);
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
        );
      });
      rolarPara([-60, 114, 288, 462]);
      expect(ativo()).toEqual(["Papelaria 1"]);
    });

    it("com 'scrollend' destrava no fim da rolagem, sem recalcular por cima do tocado", () => {
      tocar("Roupas 1");
      for (const topos of quadros) rolarPara(topos);
      act(() => {
        document.dispatchEvent(new Event("scrollend"));
      });
      expect(ativo()).toEqual(["Roupas 1"]);
      rolarPara([-348, -174, 0, 174]);
      expect(ativo()).toEqual(["Cozinha 1"]);
    });

    it("um 'scrollend' espúrio no começo (antes de a posição andar) não solta o atalho", () => {
      tocar("Roupas 1");
      rolarPara([0, 174, 348, 522]);
      act(() => {
        document.dispatchEvent(new Event("scrollend"));
      });
      rolarPara([-50, 124, 298, 472]);
      expect(ativo()).toEqual(["Roupas 1"]);
    });

    it("sem 'scrollend' destrava ~150ms depois do último scroll", () => {
      tocar("Roupas 1");
      rolarPara([-50, 124, 298, 472]);
      act(() => vi.advanceTimersByTime(100));
      rolarPara([-60, 114, 288, 462]);
      expect(ativo()).toEqual(["Roupas 1"]);
      act(() => vi.advanceTimersByTime(200));
      rolarPara([-348, -174, 0, 174]);
      expect(ativo()).toEqual(["Cozinha 1"]);
    });

    it("rolagem que nunca para destrava no teto de ~1 segundo", () => {
      tocar("Roupas 1");
      for (let t = 0; t < 12; t++) {
        rolarPara([-50, 124, 298, 472]);
        act(() => vi.advanceTimersByTime(100));
      }
      rolarPara([-348, -174, 0, 174]);
      expect(ativo()).toEqual(["Cozinha 1"]);
    });

    it("tocar sem que a página role (já estava lá) destrava sozinho", () => {
      tocar("Roupas 1");
      expect(ativo()).toEqual(["Roupas 1"]);
      act(() => vi.advanceTimersByTime(400));
      rolarPara([-348, -174, 0, 174]);
      expect(ativo()).toEqual(["Cozinha 1"]);
    });

    it("ao sair da tela não deixa temporizador nem escuta para trás", () => {
      tocar("Roupas 1");
      const remover = vi.spyOn(document, "removeEventListener");
      act(() => raiz.unmount());
      const tipos = remover.mock.calls.map(([tipo]) => tipo);
      for (const esperado of [
        "scroll",
        "scrollend",
        "touchstart",
        "wheel",
        "keydown",
      ]) {
        expect(tipos).toContain(esperado);
      }
      expect(vi.getTimerCount()).toBe(0);
      raiz = createRoot(container);
    });
  });
});
