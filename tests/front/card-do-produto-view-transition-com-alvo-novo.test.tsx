// @vitest-environment jsdom
//
// B3 (card sem botão dentro de botão) tem um risco específico no
// ProductCard: `handleCardClick` usava `e.currentTarget.querySelector("img")`
// para marcar a foto do card clicado com `view-transition-name` -- contrato
// vivo com `useViewTransition` (02/09). Ao mover o alvo acessível para um
// <button> do nome, `e.currentTarget` desse clique é o BOTÃO (sem <img>
// dentro), e a view transition da foto quebrava. A correção usa um `ref` do
// card inteiro (`cardRef.current?.querySelector("img")`), acionado pela MESMA
// função tanto no wrapper quanto no botão do nome.
//
// POR QUE ARQUIVO SEPARADO: `isViewTransitionSupported`
// (src/hooks/useViewTransition.ts) é um `const` calculado UMA VEZ, no
// carregamento do módulo, a partir de `"startViewTransition" in document` --
// ausente no jsdom. Para exercitar o branch que usa a View Transition API é
// preciso que `document.startViewTransition` já exista ANTES do primeiro
// import do módulo -- daí o `beforeAll` com import dinâmico isolado neste
// arquivo (outro arquivo de teste que importasse ProductCard sem esse stub
// travaria `isViewTransitionSupported` em `false` para sempre, por módulo
// já estar em cache).
//
// POR QUE ESPIONAR `style.setProperty`/`removeProperty` EM VEZ DE LER O CSS
// DEPOIS: o parser de CSS do jsdom não conhece `view-transition-name` --
// afirmar por ele seria testar o jsdom, não o nosso código (mesmo raciocínio
// de view-transition-nao-descasca-estrutura.test.tsx, que é o molde daqui).
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ProductCard as ProductCardType } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ProductCard: typeof ProductCardType;

beforeAll(async () => {
  // Precisa existir ANTES do import do módulo -- ver comentário do topo.
  (
    document as unknown as { startViewTransition?: () => void }
  ).startViewTransition = () => {};
  ({ ProductCard } = await import("@/components/ui/custom/ProductCard"));
});

afterAll(() => {
  // biome-ignore lint/performance/noDelete: limpar o stub global do teste.
  delete (document as unknown as { startViewTransition?: () => void })
    .startViewTransition;
});

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-vt-a11y",
    name: "Camiseta Azul Marinho",
    description: "Descrição de teste",
    price: 100,
    images: ["https://example.com/img.png"],
    category: "geral",
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

/**
 * Espelha o uso real (App.tsx): o pai guarda `selectedProductId` e o
 * atualiza quando o card chama `onClick`. É essa segunda renderização --
 * com `selectedProductId === product.id` -- que liga
 * `shouldApplyTransitionName` dentro do ProductCard.
 */
function Harness({
  produto,
  onClickSpy,
}: {
  produto: Product;
  onClickSpy: (id: string) => void;
}) {
  const [selectedProductId, setSelectedProductId] = useState<
    string | undefined
  >(undefined);
  return (
    <ProductCard
      product={produto}
      isFavorite={false}
      onToggleFavorite={() => {}}
      onClick={(id: string) => {
        onClickSpy(id);
        setSelectedProductId(id);
      }}
      showRating={false}
      priority
      selectedProductId={selectedProductId}
    />
  );
}

describe("ProductCard — view transition sobrevive ao novo alvo (botão do nome)", () => {
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

  /** Espiona `setProperty`/`removeProperty` do ÚNICO <img> renderizado. */
  function espionarImagem(): { chamadasSet: [string, string][] } {
    const img = hospedeiro.querySelector("img")!;
    const chamadasSet: [string, string][] = [];
    const originalSet = img.style.setProperty.bind(img.style);
    img.style.setProperty = (prop: string, valor: string) => {
      chamadasSet.push([prop, valor]);
      return originalSet(prop, valor);
    };
    return { chamadasSet };
  }

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
  }

  it("abrir PELO ALVO (botão do nome) marca a imagem DESTE card com view-transition-name", async () => {
    const produto = criarProduto();
    const onClickSpy = vi.fn();
    await act(async () => {
      raiz.render(<Harness produto={produto} onClickSpy={onClickSpy} />);
    });

    const espiao = espionarImagem();
    const botaoDoNome = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.trim() === produto.name)!;

    await clicar(botaoDoNome);

    expect(onClickSpy).toHaveBeenCalledWith(produto.id);
    expect(espiao.chamadasSet).toContainEqual([
      "view-transition-name",
      "product-image",
    ]);
  });

  it("abrir PELO CARD (área vazia do wrapper) marca a imagem DESTE card com view-transition-name", async () => {
    const produto = criarProduto({ id: "prod-vt-a11y-2" });
    const onClickSpy = vi.fn();
    await act(async () => {
      raiz.render(<Harness produto={produto} onClickSpy={onClickSpy} />);
    });

    const espiao = espionarImagem();
    const areaVazia = hospedeiro.querySelector<HTMLElement>(
      ".aspect-\\[4\\/5\\]",
    )!;

    await clicar(areaVazia);

    expect(onClickSpy).toHaveBeenCalledWith(produto.id);
    expect(espiao.chamadasSet).toContainEqual([
      "view-transition-name",
      "product-image",
    ]);
  });
});
