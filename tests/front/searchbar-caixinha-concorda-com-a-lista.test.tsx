// @vitest-environment jsdom
//
// A caixinha de sugestoes do topo e a lista da Home davam respostas
// DIFERENTES para a mesma busca: a caixinha achava "Produtos (2)" para
// "vestido azul" e, no Enter, a lista dizia "nenhum produto" (a caixinha
// aceitava QUALQUER palavra, a lista exige TODAS); "bolsas" nao achava nada na
// caixinha e a lista achava; o titulo contava o corte de 6 em vez do total.
// Agora as duas usam `produtoCombinaComBusca`: aqui se prova que, para cada
// busca, a caixinha mostra exatamente o que a lista mostraria.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import type { Product } from "@/types";

function produto(
  nome: string,
  id: string,
  extras: Partial<Product> = {},
): Product {
  return {
    id,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category: "Geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extras,
  };
}

const estado = vi.hoisted(() => ({ catalogo: [] as unknown[] }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("a caixinha de sugestoes concorda com a lista", () => {
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

  async function digitar(catalogo: Product[], texto: string) {
    estado.catalogo = catalogo;
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");

    function Involucro() {
      const [valor, setValor] = useState("");
      return <SearchBar value={valor} onChange={setValor} />;
    }

    await act(async () => {
      raiz.render(<Involucro />);
    });

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      campo.focus();
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // `useDeferredValue` empurra o resultado para um render seguinte.
    await act(async () => {
      await Promise.resolve();
    });
  }

  const nomesNaCaixinha = () =>
    Array.from(hospedeiro.querySelectorAll("button img")).map(
      (img) => (img as HTMLImageElement).alt,
    );
  const tituloDosProdutos = () =>
    Array.from(hospedeiro.querySelectorAll("span"))
      .map((s) => s.textContent ?? "")
      .find((t) => t.startsWith("Produtos ("));
  const termosSugeridos = () => {
    const bloco = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) => s.textContent === "Sugestões de Busca",
    );
    const botoes =
      bloco?.parentElement?.parentElement?.querySelectorAll("button span");
    return Array.from(botoes ?? []).map((b) => b.textContent ?? "");
  };
  /** O que a lista da Home mostraria: ativos que a regra unica aceita. */
  const nomesNaLista = (catalogo: Product[], busca: string) =>
    catalogo
      .filter((p) => p.isActive && produtoCombinaComBusca(p, busca))
      .map((p) => p.name);

  const vitrine = [
    produto("Vestido Azul Longo", "p1", { category: "Vestidos" }),
    produto("Vestido Vermelho Curto", "p2", { category: "Vestidos" }),
    produto("Bolsa Preta", "p3", { category: "Acessórios" }),
    produto("Kit Mimo", "p4", {
      category: "Kits",
      description: "Ideal para presente",
    }),
    produto("Caixa Surpresa", "p5", {
      category: "Caixas",
      tags: ["brinde"],
    }),
    produto("Vestido Azul Pausado", "p6", {
      category: "Vestidos",
      isActive: false,
    }),
  ];

  it("'vestido azul' (as duas palavras) mostra 1 produto, nao os 2 de 'qualquer palavra'", async () => {
    await digitar(vitrine, "vestido azul");

    expect(nomesNaLista(vitrine, "vestido azul")).toEqual([
      "Vestido Azul Longo",
    ]);
    expect(nomesNaCaixinha()).toEqual(["Vestido Azul Longo"]);
    expect(tituloDosProdutos()).toBe("Produtos (1)");
  });

  it("'bolsas' (plural) acha a Bolsa na caixinha, como a lista", async () => {
    await digitar(vitrine, "bolsas");

    expect(nomesNaLista(vitrine, "bolsas")).toEqual(["Bolsa Preta"]);
    expect(nomesNaCaixinha()).toEqual(["Bolsa Preta"]);
    expect(tituloDosProdutos()).toBe("Produtos (1)");
  });

  it("'presente' acha pela descricao, nos dois", async () => {
    await digitar(vitrine, "presente");

    expect(nomesNaLista(vitrine, "presente")).toEqual(["Kit Mimo"]);
    expect(nomesNaCaixinha()).toEqual(["Kit Mimo"]);
  });

  it("etiqueta sozinha NAO acha (a lista nunca procurou nelas): nem produto, nem termo sugerido", async () => {
    // Decisao registrada em busca-de-produtos.ts: etiquetas ficam fora da
    // regra unica. A caixinha nao pode prometer 'brinde' se a lista, no Enter,
    // diz que nao ha nada.
    await digitar(vitrine, "brinde");

    expect(nomesNaLista(vitrine, "brinde")).toEqual([]);
    expect(nomesNaCaixinha()).toEqual([]);
    expect(tituloDosProdutos()).toBe("Produtos (0)");
    expect(termosSugeridos()).not.toContain("brinde");
  });

  it("produto pausado nao aparece na caixinha, como na lista", async () => {
    await digitar(vitrine, "pausado");

    expect(nomesNaLista(vitrine, "pausado")).toEqual([]);
    expect(nomesNaCaixinha()).toEqual([]);
  });

  it("o titulo mostra o total REAL (8), mesmo mostrando so 6 produtos", async () => {
    const colares = Array.from({ length: 8 }, (_, i) =>
      produto(`Colar Modelo ${i + 1}`, `c${i}`, { category: "Joias" }),
    );
    await digitar(colares, "colar");

    expect(nomesNaLista(colares, "colar")).toHaveLength(8);
    expect(nomesNaCaixinha()).toHaveLength(6);
    expect(tituloDosProdutos()).toBe("Produtos (8)");
  });

  it("plural alem do 's': 'colares' acha Colar na caixinha", async () => {
    const colares = [produto("Colar Estrela", "c1", { category: "Joias" })];
    await digitar(colares, "colares");

    expect(nomesNaCaixinha()).toEqual(["Colar Estrela"]);
  });

  it("todo termo sugerido leva a pelo menos um produto na lista", async () => {
    // O termo sugerido e' o que a pessoa toca para buscar: se a lista nao o
    // acha, a sugestao e' uma promessa vazia. 'Colar-Coração' perdia o hifen
    // ao virar termo e nao achava o proprio produto.
    const catalogo = [
      produto("Colar-Coração Dourado", "c1", { category: "Joias" }),
      produto("Colar Estrela", "c2", { category: "Joias" }),
    ];
    await digitar(catalogo, "colar");

    const termos = termosSugeridos();
    expect(termos.length).toBeGreaterThan(0);
    for (const termo of termos) {
      expect(nomesNaLista(catalogo, termo).length).toBeGreaterThan(0);
    }
  });
});
