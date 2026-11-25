// @vitest-environment jsdom
//
// Buracos de prova da tela de Favoritos achados por MUTAÇÃO (plantar um defeito
// de uma linha em `FavoritesView.tsx` e ver se algum teste cai). Nove defeitos
// sobreviviam a todos os testes vizinhos; cada teste abaixo derruba um deles:
// - "Tentar de novo" do catálogo: enquanto a busca corre a tela volta ao
//   esqueleto "Carregando favoritos" (sem isso a tela de erro ficava parada,
//   sem sinal de que o toque funcionou);
// - "Tentar agora" (retidos) e "Limpar indisponíveis": enquanto a ação corre o
//   botão diz "Tentando..."/"Limpando...", fica desabilitado e um segundo toque
//   não pede de novo. ATENÇÃO, mutantes EQUIVALENTES (não dá para derrubar): as
//   guardas `if (tentando) return;` e `if (limpando) return;` isoladas; o
//   `disabled` do botão já faz o mesmo e a guarda lê o MESMO estado de render
//   (`tentando`), então nem um toque em dobro dentro do mesmo quadro a vê;
// - o chip da ordem diz o nome certo de cada ordem ("Menor preço", "Maior
//   preço", "A–Z");
// - o "Tentar agora" da lista COM favoritos também pede o aviso de falha;
// - o carrinho: o toque do cartão entrega só o produto (o clique não vira
//   quantidade) e a quantidade que o cartão não informa vale 1;
// - quem pediu menos movimento (`prefers-reduced-motion`) rola SEM animação,
//   quem não pediu rola suave;
// - a tela de erro mostra o motivo que o contexto devolveu;
// - rolagem de algo que NÃO contém a lista (a própria faixa de atalhos andando
//   de lado) não muda o atalho ativo.
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const loja = vi.hoisted(() => ({
  products: [] as unknown[],
  loadingProducts: false,
  catalogoErro: false,
  fetchProducts: vi.fn(),
  erro: null as string | null,
  refresh: vi.fn(),
  pendingCount: 0,
  retentarPendentes: vi.fn(),
  favoritosIndisponiveis: 0,
  limparIndisponiveis: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    products: loja.products,
    loadingProducts: loja.loadingProducts,
    catalogoErro: loja.catalogoErro,
    fetchProducts: loja.fetchProducts,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    erro: loja.erro,
    refresh: loja.refresh,
    pendingCount: loja.pendingCount,
    retentarPendentes: loja.retentarPendentes,
    favoritosIndisponiveis: loja.favoritosIndisponiveis,
    limparIndisponiveis: loja.limparIndisponiveis,
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));
// Cartão de mentira: expõe só o que a tela lhe entrega, para o teste "tocar"
// nas funções como o cartão de verdade faria.
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: (props: {
    product: Product;
    onAddToCart?: (produto: Product, clique?: unknown) => unknown;
    onAddToCartWithVariants?: (
      produto: Product,
      variantId: string | undefined,
      variantNames: string,
      quantity?: number,
    ) => unknown;
  }) => (
    <div data-testid="cartao">
      <h3>{props.product.name}</h3>
      <button
        type="button"
        onClick={(clique) => props.onAddToCart?.(props.product, clique)}
      >
        Adicionar {props.product.name}
      </button>
      <button
        type="button"
        onClick={() =>
          props.onAddToCartWithVariants?.(props.product, "var-1", "Azul / M")
        }
      >
        Escolher {props.product.name}
      </button>
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(
  id: string,
  name: string,
  price: number,
  category: string,
): Product {
  return {
    id,
    name,
    price,
    category,
    description: "",
    images: [],
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-10-20T12:00:00Z",
    variants: [],
  } as Product;
}

const umProduto = [produto("a", "Bola", 20, "Brinquedos")];
const tresCategorias = [
  produto("a", "Bola", 20, "Brinquedos"),
  produto("b", "Bloco", 10, "Papelaria"),
  produto("c", "Camisa", 30, "Roupas"),
];

describe("FavoritesView — bordas do catálogo, da ordem, dos retidos e da rolagem", () => {
  let raiz: Root;
  let container: HTMLDivElement;
  let reduzirMovimento = false;
  const rolarAteaSecao = vi.fn();

  beforeAll(async () => {
    await import("@/views/customer/FavoritesView");
  }, 60_000);

  beforeEach(() => {
    loja.products = [];
    loja.loadingProducts = false;
    loja.catalogoErro = false;
    loja.erro = null;
    loja.pendingCount = 0;
    loja.favoritosIndisponiveis = 0;
    loja.fetchProducts.mockReset();
    loja.refresh.mockReset();
    loja.retentarPendentes.mockReset();
    loja.limparIndisponiveis.mockReset();
    loja.fetchProducts.mockResolvedValue(undefined);
    loja.retentarPendentes.mockResolvedValue(undefined);
    loja.limparIndisponiveis.mockResolvedValue(undefined);
    reduzirMovimento = false;
    rolarAteaSecao.mockReset();
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
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta.includes("reduce") ? reduzirMovimento : false,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    Element.prototype.scrollIntoView = rolarAteaSecao;
    container = document.createElement("div");
    document.body.appendChild(container);
    raiz = createRoot(container);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    container.remove();
    vi.unstubAllGlobals();
    // biome-ignore lint/performance/noDelete: o jsdom não traz o método; remover devolve o estado de antes.
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  async function montar(
    favoritos: Product[],
    onAddToCart?: (...args: unknown[]) => unknown,
  ) {
    const { FavoritesView } = await import("@/views/customer/FavoritesView");
    await act(async () => {
      raiz.render(
        <FavoritesView
          favorites={favoritos}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
          onAddToCart={onAddToCart}
        />,
      );
    });
  }

  const botao = (texto: string) =>
    [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement;

  it("catálogo falhou: ao tocar 'Tentar de novo' a tela volta ao esqueleto enquanto a busca corre", async () => {
    loja.catalogoErro = true;
    let terminar!: () => void;
    loja.fetchProducts.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    await montar([]);
    expect(container.textContent).toContain("Não conseguimos carregar");
    expect(
      container.querySelector('[aria-label="Carregando favoritos"]'),
    ).toBeNull();

    await act(async () => {
      botao("Tentar de novo").click();
    });
    expect(
      container.querySelector(
        '[role="status"][aria-label="Carregando favoritos"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Não conseguimos carregar");

    await act(async () => terminar());
    // A busca acabou e o erro continua: a tela de erro volta (não fica no esqueleto).
    expect(container.textContent).toContain("Não conseguimos carregar");
    expect(loja.fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("segundo toque no 'Tentar agora' dos retidos (a retentativa ainda corre) não pede outra", async () => {
    loja.pendingCount = 2;
    loja.retentarPendentes.mockImplementation(() => new Promise(() => {}));
    await montar([]);
    const tentar = botao("Tentar agora");
    await act(async () => {
      tentar.click();
    });
    await act(async () => {
      tentar.click();
    });
    expect(loja.retentarPendentes).toHaveBeenCalledTimes(1);
    expect(botao("Tentando...").disabled).toBe(true);
  });

  it("segundo toque no 'Limpar indisponíveis' (a limpeza ainda corre) não pede outra", async () => {
    loja.favoritosIndisponiveis = 3;
    loja.limparIndisponiveis.mockImplementation(() => new Promise(() => {}));
    await montar([]);
    const limpar = botao("Limpar indisponíveis");
    await act(async () => {
      limpar.click();
    });
    await act(async () => {
      limpar.click();
    });
    expect(loja.limparIndisponiveis).toHaveBeenCalledTimes(1);
    expect(botao("Limpando...").disabled).toBe(true);
  });

  it("com favoritos na lista, 'Tentar agora' dos retidos também pede o aviso de falha", async () => {
    loja.pendingCount = 1;
    await montar(umProduto);
    expect(container.textContent).toContain(
      "1 favorito ainda está sendo salvo",
    );
    await act(async () => {
      botao("Tentar agora").click();
    });
    expect(loja.retentarPendentes).toHaveBeenCalledTimes(1);
    expect(loja.retentarPendentes).toHaveBeenCalledWith({ avisarFalha: true });
  });

  it("o chip da ordem diz o nome de cada ordem escolhida", async () => {
    await montar(tresCategorias);
    const seletor = container.querySelector<HTMLSelectElement>(
      "select[aria-label='Ordem dos favoritos']",
    )!;
    const chip = seletor.closest("label")!;
    expect(chip.textContent).toContain("Ordem original");
    const rotuloDoChip = (el: Element) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("");
    const escolher = async (valor: string) => {
      await act(async () => {
        seletor.value = valor;
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await escolher("menor");
    expect(rotuloDoChip(chip)).toBe("Menor preço");
    await escolher("maior");
    expect(rotuloDoChip(chip)).toBe("Maior preço");
    await escolher("nome");
    expect(rotuloDoChip(chip)).toBe("A–Z");
  });

  it("carrinho: o toque do cartão entrega só o produto (o clique não vira quantidade)", async () => {
    const adicionar = vi.fn();
    await montar(umProduto, adicionar);
    await act(async () => {
      botao("Adicionar Bola").click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(adicionar.mock.calls[0]).toEqual([umProduto[0]]);
  });

  it("carrinho com opções: a quantidade que o cartão não informa vale 1", async () => {
    const adicionar = vi.fn();
    await montar(umProduto, adicionar);
    await act(async () => {
      botao("Escolher Bola").click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(adicionar).toHaveBeenCalledWith(
      umProduto[0],
      1,
      "var-1",
      "Azul / M",
    );
  });

  it.each([
    [false, "smooth"],
    [true, "auto"],
  ] as const)(
    "tocar num atalho de categoria: prefers-reduced-motion=%s rola com behavior '%s'",
    async (reduzir, comportamento) => {
      reduzirMovimento = reduzir;
      await montar(tresCategorias);
      await act(async () => {
        botao("Roupas 1").click();
      });
      expect(rolarAteaSecao).toHaveBeenCalledTimes(1);
      expect(rolarAteaSecao).toHaveBeenCalledWith({
        behavior: comportamento,
        block: "start",
      });
    },
  );

  it("lista vazia com erro: a tela de erro mostra o motivo e o botão relê os favoritos", async () => {
    loja.erro = "Servidor fora do ar.";
    await montar([]);
    expect(container.textContent).toContain(
      "Servidor fora do ar. Verifique sua conexão e tente de novo.",
    );
    await act(async () => {
      botao("Tentar de novo").click();
    });
    expect(loja.refresh).toHaveBeenCalledTimes(1);
  });

  it("rolar a faixa de atalhos (que não contém a lista) não muda o atalho ativo", async () => {
    await montar(tresCategorias);
    const ativo = () =>
      [...container.querySelectorAll('nav[aria-label="Categorias"] button')]
        .filter((b) => b.getAttribute("aria-current") === "true")
        .map((b) => b.textContent);
    expect(ativo()).toEqual(["Brinquedos 1"]);

    // A seção "Roupas" passou da linha de 35% da tela: uma rolagem DA LISTA
    // (janela) a tornaria ativa...
    const secoes = [...container.querySelectorAll("section")];
    const topos = new Map([
      ["Brinquedos", -400],
      ["Papelaria", -300],
      ["Roupas", 100],
    ]);
    for (const sec of secoes) {
      const top = topos.get(sec.dataset.secao ?? "") ?? 0;
      sec.getBoundingClientRect = () =>
        ({ top, bottom: top + 100, height: 100 }) as DOMRect;
    }
    const faixa = container.querySelector('nav[aria-label="Categorias"]')!;
    await act(async () => {
      faixa.dispatchEvent(new Event("scroll"));
    });
    // ...mas a rolagem foi da faixa de atalhos, e ela não diz nada sobre a lista.
    expect(ativo()).toEqual(["Brinquedos 1"]);

    await act(async () => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(ativo()).toEqual(["Roupas 1"]);
  });
});
