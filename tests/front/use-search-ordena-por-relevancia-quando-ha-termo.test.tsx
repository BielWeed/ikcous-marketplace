// @vitest-environment jsdom
//
// Tela /search: com termo digitado e a ordenacao no padrao, os resultados vem
// por RELEVANCIA (a mesma pontuacao da caixinha do topo e da Home), nao do mais
// novo ao mais antigo. Sem termo continua "mais novos primeiro". Quem escolhe
// preco ou nome continua sendo obedecido, e esgotado nunca vem na frente.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(
  id: string,
  name: string,
  criadoEm: number,
  extra: Partial<Product> = {},
): Product {
  return {
    id,
    name,
    description: "",
    price: 100,
    images: [],
    category: "Geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(criadoEm).toISOString(),
    createdTime: criadoEm,
    ...extra,
  } as Product;
}

const PRODUTOS = [
  // O mais NOVO só cita "bolsa" na descrição.
  produto("novo", "Carteira", 3000, {
    description: "combina com bolsa",
    price: 10,
  }),
  // O nome é IGUAL ao termo, mas é o mais antigo.
  produto("exato", "Bolsa", 1000, { price: 300 }),
  produto("comeca", "Bolsa Grande", 2000, { price: 200 }),
  // Mesma pontuação ("começa com"): decide a data, o mais novo na frente.
  produto("tras", "Bolsa Preta", 500, { price: 250 }),
  produto("frente", "Bolsa Branca", 2500, { price: 150 }),
  // Esgotado com nome igual: não pode ir para a frente de quem tem estoque.
  produto("esgotado", "Bolsa", 4000, { stock: 0 }),
];

type Api = ReturnType<typeof useSearch>;

describe("useSearch — relevância quando há termo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  function Sonda({ produtos = PRODUTOS }: { produtos?: Product[] }) {
    const resultado = useSearch(produtos);
    useEffect(() => {
      api = resultado;
    });
    return null;
  }

  const ids = () => api.filteredProducts.map((p) => p.id);
  const digitar = (texto: string) => {
    act(() => {
      api.setQuery(texto);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(<Sonda />);
    });
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    vi.useRealTimers();
  });

  it("sem termo: continua do mais novo ao mais antigo (esgotado por último)", () => {
    expect(api.sort).toBe("newest");
    expect(ids()).toEqual([
      "novo",
      "frente",
      "comeca",
      "exato",
      "tras",
      "esgotado",
    ]);
  });

  it.each(["\u200B", "\u2060\u2800", "\u3164 \u200E"])(
    "termo só com invisível %j é termo vazio: lista completa, do mais novo ao mais antigo",
    (invisivel) => {
      digitar(invisivel);
      expect(ids()).toEqual([
        "novo",
        "frente",
        "comeca",
        "exato",
        "tras",
        "esgotado",
      ]);
    },
  );

  it("CONTROLE: termo com invisível colado ao texto ainda busca pelo texto", () => {
    digitar("\u200Bcarteira\u2060");
    expect(ids()).toEqual(["novo"]);
  });

  it("com termo e ordenação padrão: nome igual vem antes de nome que começa e de só descrição", () => {
    digitar("bolsa");
    expect(ids()).toEqual([
      "exato",
      "frente",
      "comeca",
      "tras",
      "novo",
      "esgotado",
    ]);
  });

  it.each([
    ["price_asc", ["novo", "frente", "comeca", "tras", "exato", "esgotado"]],
    ["price_desc", ["exato", "tras", "comeca", "frente", "novo", "esgotado"]],
  ] as const)(
    "%s: obedece à direção escolhida, com esgotado por último",
    (sort, esperados) => {
      act(() => {
        api.setSort(sort);
      });
      expect(ids()).toEqual(esperados);
    },
  );

  it.each([
    ["price_asc", ["simples", "variacao", "caro"]],
    ["price_desc", ["caro", "variacao", "simples"]],
  ] as const)(
    "%s: usa preço próprio da opção à venda, não a barata esgotada",
    (sort, esperados) => {
      const produtos = [
        produto("caro", "Casaco", 1000, { price: 200 }),
        produto("variacao", "Camiseta", 2000, {
          price: 300,
          variants: [
            {
              id: "p",
              productId: "variacao",
              name: "Tamanho",
              value: "P",
              active: true,
              stockIncrement: 0,
              priceOverride: 10,
            },
            {
              id: "g",
              productId: "variacao",
              name: "Tamanho",
              value: "G",
              active: true,
              stockIncrement: 3,
              priceOverride: 120,
            },
          ],
        }),
        produto("simples", "Boné", 3000, { price: 80 }),
      ];
      for (const entrada of [produtos, [...produtos].reverse()]) {
        act(() => {
          raiz.render(<Sonda produtos={entrada} />);
          api.setSort(sort);
        });
        expect(ids()).toEqual(esperados);
      }
    },
  );

  it.each([
    ["price_asc", ["promocional", "regular"]],
    ["price_desc", ["regular", "promocional"]],
  ] as const)(
    "%s: promoção ordena pelo preço exibido, não pelo riscado",
    (sort, esperados) => {
      act(() => {
        raiz.render(
          <Sonda
            produtos={[
              produto("regular", "Boné", 1000, { price: 100 }),
              produto("promocional", "Bolsa", 2000, {
                price: 60,
                originalPrice: 300,
              }),
            ]}
          />,
        );
        api.setSort(sort);
      });
      expect(ids()).toEqual(esperados);
    },
  );

  it("alfabética: respeita acento e caixa, mas Aba esgotada fica no fim", () => {
    const produtos = [
      produto("zebra", "Zebra", 1000),
      produto("erica", "Érica", 2000),
      produto("aba", "Aba", 3000, { stock: 0 }),
      produto("bolsa", "bolsa", 4000),
      produto("anel", "Anel", 5000),
      produto("agua", "Água", 6000),
    ];
    for (const entrada of [produtos, [...produtos].reverse()]) {
      act(() => {
        raiz.render(<Sonda produtos={entrada} />);
        api.setSort("name_asc");
      });
      expect(ids()).toEqual(["agua", "anel", "bolsa", "erica", "zebra", "aba"]);
    }
  });

  it("quem escolhe menor preço continua sendo obedecido, mesmo com termo", () => {
    act(() => {
      api.setSort("price_asc");
    });
    digitar("bolsa");
    expect(ids()).toEqual([
      "novo",
      "frente",
      "comeca",
      "tras",
      "exato",
      "esgotado",
    ]);
  });
});
