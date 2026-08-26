// @vitest-environment jsdom
//
// LOJA-01 (auditoria 26/08/2026): `produtos.rating` nasce com `DEFAULT 5`
// (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql:832) e
// nada no sistema recalcula esse campo a partir das avaliações -- não existe
// gatilho em `reviews`, nenhuma RPC faz `UPDATE ... SET rating`. Antes desta
// correção, `ProductCard` renderizava `<StarRating rating={product.rating ||
// 5} />` sempre que `showRating` era verdadeiro, sem checar se existe
// avaliação de verdade por trás (`reviewCount`). Resultado: todo produto sem
// nenhuma avaliação aparecia com cinco estrelas cheias na grade, e a própria
// página do produto dizia "Este produto ainda não foi avaliado".
//
// Esta correção NÃO calcula a nota certa (isso exige migration com gatilho
// e backfill, fora desta tarefa) -- só impede a mentira: sem
// `reviewCount > 0`, nenhuma estrela aparece.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de product-card-gate-avaliacoes.test.tsx -- o que este
// teste prova é a ÁRVORE renderizada (presença ou ausência do <svg> da
// estrela), não uma chamada de função isolada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- ver
// product-card-gate-avaliacoes.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoBase: Product = {
  id: "prod-loja01",
  name: "Produto Nunca Avaliado",
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
  // `rating` deixado no default de banco (5) DE PROPÓSITO -- é exatamente o
  // valor que a coluna carrega hoje para todo produto, avaliado ou não.
  rating: 5,
  reviewCount: 0,
};

describe("ProductCard — não inventa avaliação sem reviewCount (LOJA-01)", () => {
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

  it("showRating=true e reviewCount=0: nenhuma estrela aparece, mesmo com rating=5 no banco", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoBase}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
  });

  it("showRating=true e reviewCount ausente (undefined): também nenhuma estrela", async () => {
    const produtoSemCampo: Product = { ...produtoBase, reviewCount: undefined };
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoSemCampo}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
  });

  it("showRating=true e reviewCount>0: a estrela continua aparecendo (não regride o caso avaliado)", async () => {
    const produtoAvaliado: Product = {
      ...produtoBase,
      reviewCount: 3,
      rating: 4,
    };
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoAvaliado}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(5);
  });
});
