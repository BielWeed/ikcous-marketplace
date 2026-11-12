// @vitest-environment jsdom
//
// A faixa "falta pouco para o frete grátis" (ShippingProgress) oferece um
// "Adicionar" por produto sugerido. A lista vem de
// `getFreeShippingEligibleProducts` (useProducts.ts). Ela só pode oferecer o
// que a cliente de fato consegue comprar agora e ainda não escolheu:
//   - produto esgotado (estoque 0) seria um "Adicionar" que falha;
//   - produto inativo (a lojista tirou da vitrine) nem deveria aparecer;
//   - produto que já está no carrinho seria "sugerir o que ela já pôs".
// O corte por variação ativa já é provado em
// frete-gratis-nao-sugere-comprar-sem-escolher.test.tsx; aqui ficam as três
// guardas restantes e o contrato de ordem/limite (a função NÃO ordena por
// preço nem corta por preço: devolve na ordem do catálogo, até `limit`).
//
// Hook real montado com o mesmo molde do vizinho (Sonda + StoreContext mocado).
import { useProducts } from "@/hooks/useProducts";
import type { Product } from "@/types";
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

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts();
  useEffect(() => {
    onReady(api);
  });
  return null;
}

function criarProduto(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

describe("getFreeShippingEligibleProducts -- só oferece o que dá para comprar e ainda não está no carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let onLineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiRef = undefined;
    // useProducts.ts agenda um setTimeout REAL (fila offline) a cada
    // montagem quando navigator.onLine é true -- mesmo ajuste do vizinho.
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
    mockContextProducts = [];
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

  it("não oferece produto esgotado (estoque 0)", async () => {
    mockContextProducts = [
      criarProduto("esgotado", { stock: 0 }),
      criarProduto("ok"),
    ];
    await montar();

    const ids = apiRef!.getFreeShippingEligibleProducts([]).map((p) => p.id);

    expect(ids).not.toContain("esgotado");
    expect(ids).toEqual(["ok"]);
  });

  it("não oferece produto inativo", async () => {
    mockContextProducts = [
      criarProduto("inativo", { isActive: false }),
      criarProduto("ok"),
    ];
    await montar();

    const ids = apiRef!.getFreeShippingEligibleProducts([]).map((p) => p.id);

    expect(ids).not.toContain("inativo");
    expect(ids).toEqual(["ok"]);
  });

  it("não oferece produto que já está no carrinho", async () => {
    mockContextProducts = [criarProduto("no-carrinho"), criarProduto("ok")];
    await montar();

    const ids = apiRef!
      .getFreeShippingEligibleProducts(["no-carrinho"])
      .map((p) => p.id);

    expect(ids).not.toContain("no-carrinho");
    expect(ids).toEqual(["ok"]);
  });

  it("controle: produto ativo, com estoque e fora do carrinho é oferecido", async () => {
    mockContextProducts = [criarProduto("a", { stock: 1 })];
    await montar();

    const ids = apiRef!
      .getFreeShippingEligibleProducts(["outro"])
      .map((p) => p.id);

    expect(ids).toEqual(["a"]);
  });

  it("junta as três guardas: só sobra quem passa em todas, na ordem do catálogo", async () => {
    mockContextProducts = [
      criarProduto("p1", { stock: 0 }),
      criarProduto("p2", { isActive: false }),
      criarProduto("p3"),
      criarProduto("p4"),
      criarProduto("p5", { price: 5 }),
    ];
    await montar();

    const ids = apiRef!
      .getFreeShippingEligibleProducts(["p4"])
      .map((p) => p.id);

    // p5 é o mais barato e vem DEPOIS de p3: a função não reordena por preço.
    expect(ids).toEqual(["p3", "p5"]);
  });

  it("respeita o limite: padrão 10, e o limite passado quando informado", async () => {
    mockContextProducts = Array.from({ length: 12 }, (_, i) =>
      criarProduto(`p${i + 1}`),
    );
    await montar();

    const padrao = apiRef!.getFreeShippingEligibleProducts([]).map((p) => p.id);
    const tres = apiRef!
      .getFreeShippingEligibleProducts([], 3)
      .map((p) => p.id);

    expect(padrao).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
    ]);
    expect(tres).toEqual(["p1", "p2", "p3"]);
  });
});
