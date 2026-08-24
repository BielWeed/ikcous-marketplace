// @vitest-environment jsdom
//
// Medido na tela em 23/08/2026: ao tentar comprar sem escolher a variação
// obrigatória, o aviso saía CORTADO -- "Por favor, selecione:..." -- e o
// nome do grupo que faltava (o que a pessoa precisava para agir) ficava no
// FIM de um título que trunca com reticências. A descrição, logo abaixo,
// tinha espaço de sobra e dizia algo genérico que a pessoa já sabia.
//
// O conserto (src/views/customer/ProductView.tsx, handleAddToCart) inverte
// onde cada coisa mora: o título fica curto e fixo (nunca trunca), e o nome
// do grupo que falta vai para a descrição, que é a parte com espaço.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de product-view-gate-avaliacoes.test.tsx -- o que este
// arquivo prova é o clique real no botão "Adicionar ao Carrinho" disparando
// `handleAddToCart`, não uma chamada direta de função interna do teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getReviewsByProduct = vi.fn();
const subscribeToReviews = vi.fn(() => () => {});
const markHelpful = vi.fn();

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct,
    markHelpful,
    subscribeToReviews,
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

// Stub vazio: ProductQA é de outra trilha, editada em paralelo neste working
// tree -- mesmo motivo de product-view-gate-avaliacoes.test.tsx.
vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    isLoaded: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

// jsdom não implementa IntersectionObserver -- o efeito de recomendações do
// ProductView cria um a cada montagem. Sem o stub, `new IntersectionObserver`
// lança e o render inteiro falha antes de chegar perto do que este arquivo
// testa. Mesmo stub de product-view-gate-avaliacoes.test.tsx.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarVariantesTamanho(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-m",
      productId: "prod-camiseta",
      name: "Tamanho",
      value: "M",
      stockIncrement: 5,
      active: true,
    },
  ];
}

function criarVariantesCor(): ProductVariant[] {
  return [
    {
      id: "var-azul",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Azul",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-vermelho",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Vermelho",
      stockIncrement: 5,
      active: true,
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

describe("ProductView -- o aviso de variação faltando diz O QUE falta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    getReviewsByProduct.mockClear();
    subscribeToReviews.mockClear();
    // O mock de "sonner" é criado UMA vez para o módulo inteiro -- sem
    // limpar aqui, o `toast.warning` de um teste vaza para o próximo e o
    // controle negativo veria chamadas de testes anteriores.
    const { toast } = await import("sonner");
    (toast.warning as ReturnType<typeof vi.fn>).mockClear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    // jsdom não implementa `CSS.escape` -- useDocumentMeta usa para montar o
    // seletor do <script> de JSON-LD. Mesmo passthrough de
    // product-view-gate-avaliacoes.test.tsx.
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    // jsdom não expõe `window.localStorage` como Storage de verdade nesta
    // versão -- o cache de recomendações do ProductView usa. Mesmo dublê em
    // memória de product-view-gate-avaliacoes.test.tsx.
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
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

  async function renderizarProduto(produto: Product) {
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

  // O botão sticky do console de compra: "Adicionar ao Carrinho" (visão
  // >=380px) / "Adicionar" (visão estreita) -- as duas variantes do rótulo
  // convivem na árvore (CSS decide qual aparece), então o texto combinado
  // sempre contém "Adicionar".
  function botaoAdicionar(hospedeiroEl: HTMLElement): HTMLButtonElement {
    const botoes = Array.from(hospedeiroEl.querySelectorAll("button"));
    const botao = botoes.find((b) => b.textContent?.includes("Adicionar"));
    if (!botao) throw new Error("botão 'Adicionar ao Carrinho' não encontrado");
    return botao as HTMLButtonElement;
  }

  function selecionarVariante(
    hospedeiroEl: HTMLElement,
    grupo: string,
    valor: string,
  ) {
    const rotulo = Array.from(hospedeiroEl.querySelectorAll("span")).find(
      (s) => s.textContent === `Selecione ${grupo}`,
    );
    if (!rotulo) throw new Error(`grupo "${grupo}" não encontrado na tela`);
    const container = rotulo.parentElement as HTMLElement;
    const botaoValor = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.startsWith(valor),
    );
    if (!botaoValor)
      throw new Error(`opção "${valor}" não encontrada no grupo "${grupo}"`);
    act(() => {
      (botaoValor as HTMLButtonElement).click();
    });
  }

  it("um grupo não escolhido: o texto (título + descrição) contém o nome do grupo", async () => {
    const produto = criarProduto({ variants: criarVariantesTamanho() });
    await renderizarProduto(produto);

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    const { toast } = await import("sonner");
    const chamada = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(chamada).toBeDefined();
    const textoCompleto = `${chamada[0]} ${chamada[1]?.description ?? ""}`;
    expect(textoCompleto).toContain("Tamanho");
  });

  it("dois grupos não escolhidos: o texto contém os dois nomes, e a frase está no plural", async () => {
    const produto = criarProduto({
      variants: [...criarVariantesTamanho(), ...criarVariantesCor()],
    });
    await renderizarProduto(produto);

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    const { toast } = await import("sonner");
    const chamada = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(chamada).toBeDefined();
    const descricao: string = chamada[1]?.description ?? "";
    expect(descricao).toContain("Tamanho");
    expect(descricao).toContain("Cor");
    // Plural: "as opções de", nunca "a opção de" -- e sem o
    // "opção(ões)" que o pedido proíbe explicitamente.
    expect(descricao).toContain("as opções de");
    expect(descricao).not.toContain("a opção de");
    // O pedido proíbe explicitamente o atalho "opção(ões)".
    expect(descricao).not.toMatch(/op[çc][ãa]o\(/i);
  });

  // O caso que prende a correção: sem esta asserção, alguém "conserta"
  // devolvendo o nome do grupo para o TÍTULO (voltando ao defeito original,
  // que trunca) e este teste continuaria verde se só checasse o texto
  // combinado.
  it("o nome do grupo NÃO está no título -- ele mora na parte que não trunca", async () => {
    const produto = criarProduto({ variants: criarVariantesTamanho() });
    await renderizarProduto(produto);

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    const { toast } = await import("sonner");
    const chamada = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];
    const titulo: string = chamada[0];
    expect(titulo).not.toContain("Tamanho");
  });

  // Controle negativo: sem ele, um aviso que dispara SEMPRE (mesmo com a
  // variação escolhida) passaria em todos os casos acima.
  it("controle negativo: com a variação já escolhida, nenhum toast de aviso é disparado", async () => {
    const produto = criarProduto({ variants: criarVariantesTamanho() });
    await renderizarProduto(produto);

    selecionarVariante(hospedeiro, "Tamanho", "P");

    await act(async () => {
      botaoAdicionar(hospedeiro).click();
    });

    const { toast } = await import("sonner");
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
