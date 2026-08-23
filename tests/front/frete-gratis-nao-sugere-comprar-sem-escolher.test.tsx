// @vitest-environment jsdom
//
// A QUARTA porta do mesmo buraco de dinheiro (ver
// card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx): o bloco "falta X
// para o frete grátis" do carrinho (ShippingProgress.tsx) tem um "Adicionar"
// PRÓPRIO -- `onAddToCart?.(p, getQuantity(p.id))`, sem `variantId`, sem
// passar pelo `ProductCard`. A lista de produtos sugeridos vinha de
// `getFreeShippingEligibleProducts` (useProducts.ts), que filtrava só por
// `isActive && stock > 0` -- não excluía produto com variação obrigatória.
// Camiseta P/M com estoque, cliente toca em "Adicionar" ali, pedido nasce
// com `variant_id = NULL` -- mesmo defeito de dinheiro dos três já
// consertados: a RPC cobra o preço base (ignorando o preço da variação) e
// debita `produtos.estoque`, que é reescrito como a SOMA das variações a
// cada edição da lojista -- as unidades vendidas voltam para o catálogo.
//
// O conserto tem DOIS elos, e este arquivo prova os dois:
//
// 1) NA ORIGEM (bloco "getFreeShippingEligibleProducts (useProducts) --"):
//    a lista de sugestão nem oferece produto com variação ativa -- melhor
//    sugestão do que sugerir e barrar, porque este bloco existe para
//    completar o carrinho e ganhar frete grátis, e um produto que exige três
//    toques a mais é pior sugestão que outra qualquer.
// 2) REDE DE SEGURANÇA no botão (bloco "ShippingProgress --"): mesmo que um
//    produto com variação ativa chegue à lista por outro caminho, o
//    "Adicionar" do bloco não adiciona -- leva para a tela do produto, onde
//    a escolha é obrigatória (ProductView.tsx). Mesmo critério dos três
//    botões já consertados: `product.variants?.some(v => v.active)`.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de selo-de-frete-gratis-nao-mente.test.tsx e
// card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx -- o que este
// arquivo prova é a árvore reagindo ao CLIQUE real do botão (e, no bloco 1,
// ao hook real), não uma chamada direta de função interna do teste.
import { useProducts } from "@/hooks/useProducts";
import type { Product, ProductVariant } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: { refreshSession: vi.fn(), onAuthStateChange: vi.fn() },
    storage: { from: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

function criarVariantes(ativas: boolean): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: ativas,
    },
    {
      id: "var-m",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "M",
      stockIncrement: 5,
      active: ativas,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-camiseta",
    name: "Camiseta",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Bloco 1: a origem da lista (useProducts.getFreeShippingEligibleProducts)
// não sugere produto com variação ativa.
// ---------------------------------------------------------------------

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts();
  useEffect(() => {
    onReady(api);
  });
  return null;
}

let mockContextProducts: Product[] = [];
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: mockContextProducts,
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false }),
}));

describe("getFreeShippingEligibleProducts (useProducts) -- não sugere produto com variação ativa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let onLineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiRef = undefined;
    // useProducts.ts agenda um setTimeout REAL (fila offline) a cada
    // montagem quando navigator.onLine é true (padrão do jsdom) -- sem
    // isto o timer sobrevive ao unmount e explode depois do teste. Mesmo
    // ajuste de use-products-delete-fases.test.tsx.
    onLineSpy = vi
      .spyOn(window.navigator, "onLine", "get")
      .mockReturnValue(false);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    onLineSpy.mockRestore();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
  }

  it("produto com variação ativa não aparece na sugestão de frete grátis", async () => {
    mockContextProducts = [criarProduto({ variants: criarVariantes(true) })];
    await montar();

    const sugestoes = apiRef!.getFreeShippingEligibleProducts([]);

    expect(sugestoes.map((p) => p.id)).not.toContain("prod-camiseta");
  });

  it("controle negativo: produto sem variação continua sendo sugerido", async () => {
    mockContextProducts = [criarProduto()];
    await montar();

    const sugestoes = apiRef!.getFreeShippingEligibleProducts([]);

    expect(sugestoes.map((p) => p.id)).toContain("prod-camiseta");
  });

  it("variação inativa não conta: produto com todas as variações desativadas continua sendo sugerido", async () => {
    mockContextProducts = [criarProduto({ variants: criarVariantes(false) })];
    await montar();

    const sugestoes = apiRef!.getFreeShippingEligibleProducts([]);

    expect(sugestoes.map((p) => p.id)).toContain("prod-camiseta");
  });
});

// ---------------------------------------------------------------------
// Bloco 2: rede de segurança no botão do próprio ShippingProgress. Os
// produtos são passados DIRETO por prop (sem passar pelo hook) -- é o
// caminho que qualquer outra origem de `freeShippingProducts` teria que
// atravessar, e é ele que garante que a obrigatoriedade não depende só do
// filtro de useProducts.ts.
// ---------------------------------------------------------------------

describe("ShippingProgress -- o botão 'Adicionar' do bloco de frete grátis não deixa comprar sem escolher a variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar(
    produto: Product,
    onAddToCart: (product: Product, quantity?: number) => void,
    onNavigate: (view: any, id?: string) => void,
  ) {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    await act(async () => {
      raiz.render(
        <ShippingProgress
          shipping={20}
          savings={0}
          progressPercent={40}
          amountToFree={30}
          isNearlyThere={false}
          freeShippingProducts={[produto]}
          onAddToCart={onAddToCart}
          onNavigate={onNavigate}
        />,
      );
    });
  }

  function botaoAdicionar(hospedeiroEl: HTMLElement): HTMLButtonElement {
    const botoes = Array.from(hospedeiroEl.querySelectorAll("button"));
    // Ordem do JSX: [0] diminuir quantidade, [1] aumentar quantidade,
    // [2] "Adicionar"/"Escolher opções".
    return botoes[2] as HTMLButtonElement;
  }

  it("produto com variação ativa: tocar em 'Adicionar' não chama onAddToCart e leva para a tela do produto", async () => {
    const onAddToCart = vi.fn();
    const onNavigate = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizar(produto, onAddToCart, onNavigate);

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    expect(onAddToCart).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("product-detail", produto.id);
  });

  it("o rótulo diz o que o toque faz: com variação ativa, o botão convida a escolher", async () => {
    const produto = criarProduto({ variants: criarVariantes(true) });

    await renderizar(produto, vi.fn(), vi.fn());

    expect(botaoAdicionar(hospedeiro).textContent).toContain("Escolher opções");
  });

  it("controle negativo: produto sem variação, tocar em 'Adicionar' continua adicionando ao carrinho", async () => {
    const onAddToCart = vi.fn();
    const onNavigate = vi.fn();
    const produto = criarProduto();

    await renderizar(produto, onAddToCart, onNavigate);

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart.mock.calls[0][0]).toEqual(produto);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(botaoAdicionar(hospedeiro).textContent).toContain("Adicionar");
  });

  it("variação inativa não conta: produto com todas as variações desativadas se comporta como sem variação", async () => {
    const onAddToCart = vi.fn();
    const onNavigate = vi.fn();
    const produto = criarProduto({ variants: criarVariantes(false) });

    await renderizar(produto, onAddToCart, onNavigate);

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
