// @vitest-environment jsdom
//
// Busca do topo: as "Sugestões de Busca" mostram no máximo 4 termos. Antes, a
// lista de candidatos era filtrada INTEIRA (cada termo varrendo o catálogo com
// `produtoCombinaComBusca`) e só depois cortada em 4: com ~2.000 produtos, a 1ª
// e a 2ª letra digitada custavam 80-139 ms e travavam o digitar. Agora o laço
// PARA ao juntar 4. Este arquivo prova as duas metades: (1) a saída é IDÊNTICA
// à da implementação antiga (mesmos termos, mesma ordem, mesmo corte em 4) e
// (2) o laço não varre o que sobra depois do 4º termo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const estado = vi.hoisted(() => ({ catalogo: [] as unknown[] }));

// A regra real, só que espiada: o teste CONTA quantas vezes o laço a chama.
vi.mock("@/lib/busca-de-produtos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/busca-de-produtos")>();
  return {
    ...real,
    produtoCombinaComBusca: vi.fn(real.produtoCombinaComBusca),
  };
});
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
// Lista ESTÁVEL entre renders (como o hook real): um `[]` novo a cada render
// invalidaria o useMemo e as chamadas seriam contadas várias vezes.
const semCategorias = vi.hoisted(() => ({ categories: [], isLoading: false }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => semCategorias,
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BUSCA = "ca";

function produto(id: string, name: string, isActive = true): Product {
  return {
    id,
    name,
    description: "",
    price: 100,
    images: [],
    category: "Outros",
    stock: 5,
    sold: 0,
    isActive,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const regraReal = () =>
  vi.importActual<typeof import("@/lib/busca-de-produtos")>(
    "@/lib/busca-de-produtos",
  );

/**
 * A implementação ANTIGA, reimplementada: filtra TODOS os candidatos e só
 * depois corta em 4. `candidatos` são os termos do jeito que a caixinha os
 * monta (palavra do nome com 1ª maiúscula, na ordem do catálogo, sem repetir).
 */
async function saidaAntiga(candidatos: string[], produtos: Product[]) {
  const { produtoCombinaComBusca } = await regraReal();
  return candidatos
    .filter((termo) =>
      produtos.some((p) => p.isActive && produtoCombinaComBusca(p, termo)),
    )
    .slice(0, 4);
}

describe("SearchBar — sugestões de busca param no 4º termo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.clearAllMocks();
  });

  /** Renderiza a caixinha com o catálogo e devolve os termos sugeridos, em ordem. */
  async function sugestoesPara(produtos: Product[]): Promise<string[]> {
    estado.catalogo = produtos;
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value={BUSCA} onChange={() => {}} />);
    });
    const campo = hospedeiro.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    const titulo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) => s.textContent === "Sugestões de Busca",
    );
    if (!titulo) return [];
    const fileira = titulo.parentElement!.nextElementSibling!;
    return Array.from(fileira.querySelectorAll("button")).map(
      (b) => b.textContent ?? "",
    );
  }

  /** Chamadas do laço de sugestões: as da lista de achados usam a própria busca. */
  async function chamadasDoLacoDeSugestoes() {
    const { produtoCombinaComBusca } = await import("@/lib/busca-de-produtos");
    return vi
      .mocked(produtoCombinaComBusca)
      .mock.calls.filter(([, busca]) => busca !== BUSCA).length;
  }

  // "Ca-ixa" vira o termo "Caixa" (o hífen some), que a regra da busca NÃO acha
  // em nenhum produto: é o candidato que a sugestão tem de descartar.
  it("precondição: 'Caixa' é candidato que a regra rejeita", async () => {
    const { produtoCombinaComBusca } = await regraReal();
    expect(produtoCombinaComBusca(produto("x", "Ca-ixa"), "Caixa")).toBe(false);
    expect(produtoCombinaComBusca(produto("x", "Ca-bo"), "Cabo")).toBe(false);
  });

  const cenarios: {
    nome: string;
    produtos: Product[];
    candidatos: string[];
  }[] = [
    {
      nome: "0 termos sobrevivem (todos os candidatos são rejeitados)",
      produtos: [produto("1", "Ca-ixa"), produto("2", "Ca-bo")],
      candidatos: ["Caixa", "Cabo"],
    },
    {
      nome: "1 termo sobrevive entre candidatos rejeitados",
      produtos: [
        produto("1", "Ca-ixa"),
        produto("2", "Camisa"),
        produto("3", "Ca-bo"),
      ],
      candidatos: ["Caixa", "Camisa", "Cabo"],
    },
    {
      nome: "3 termos sobrevivem, com rejeitados no meio",
      produtos: [
        produto("1", "Camisa"),
        produto("2", "Ca-ixa"),
        produto("3", "Calca"),
        produto("4", "Ca-bo"),
        produto("5", "Casaco"),
        // Produto pausado não entra na busca, e a palavra dele nem é candidata.
        produto("6", "Cadeira", false),
      ],
      candidatos: ["Camisa", "Caixa", "Calca", "Cabo", "Casaco"],
    },
    {
      nome: "exatamente 4 termos sobrevivem",
      produtos: [
        produto("1", "Camisa"),
        produto("2", "Calca"),
        produto("3", "Ca-ixa"),
        produto("4", "Casaco"),
        produto("5", "Camiseta"),
      ],
      candidatos: ["Camisa", "Calca", "Caixa", "Casaco", "Camiseta"],
    },
    {
      nome: "10+ termos sobrevivem: fica só o começo da lista, na ordem do catálogo",
      produtos: [
        produto("1", "Ca-ixa"),
        produto("2", "Camisa"),
        produto("3", "Calca"),
        produto("4", "Ca-bo"),
        produto("5", "Casaco"),
        produto("6", "Camiseta"),
        produto("7", "Cachecol"),
        produto("8", "Calcao"),
        produto("9", "Cardigan"),
        produto("10", "Cachorro"),
        produto("11", "Caneca"),
        produto("12", "Caderno"),
        produto("13", "Camisa"), // repetida: o conjunto não duplica
      ],
      candidatos: [
        "Caixa",
        "Camisa",
        "Calca",
        "Cabo",
        "Casaco",
        "Camiseta",
        "Cachecol",
        "Calcao",
        "Cardigan",
        "Cachorro",
        "Caneca",
        "Caderno",
      ],
    },
  ];

  for (const { nome, produtos, candidatos } of cenarios) {
    it(`saída idêntica à antiga: ${nome}`, async () => {
      const esperado = await saidaAntiga(candidatos, produtos);
      const obtido = await sugestoesPara(produtos);
      expect(obtido).toEqual(esperado);
      expect(obtido.length).toBeLessThanOrEqual(4);
    }, 15000);
  }

  it("controle: o cenário de 10+ tem mais de 4 sobreviventes e o corte é o 4º", async () => {
    const { produtos, candidatos } = cenarios[4];
    const { produtoCombinaComBusca } = await regraReal();
    const sobreviventes = candidatos.filter((t) =>
      produtos.some((p) => produtoCombinaComBusca(p, t)),
    );
    expect(sobreviventes.length).toBeGreaterThan(4);
    expect(await sugestoesPara(produtos)).toEqual(sobreviventes.slice(0, 4));
  }, 15000);

  it("para cedo: com 40 termos que casam, o laço não varre os 36 que sobram", async () => {
    // Ca1..Ca40: cada termo acha o próprio produto, então todos sobrevivem.
    const produtos = Array.from({ length: 40 }, (_, i) =>
      produto(`p${i + 1}`, `Ca${i + 1}`),
    );
    const termos = await sugestoesPara(produtos);
    expect(termos).toHaveLength(4);

    const chamadas = await chamadasDoLacoDeSugestoes();
    // Os 4 primeiros termos, cada um parando no 1º produto que o acha, custam
    // no máximo 1+2+3+4 = 10 chamadas. O filtro completo faria 40 termos
    // varrendo o catálogo (centenas de chamadas).
    expect(chamadas).toBeGreaterThan(0);
    expect(chamadas).toBeLessThanOrEqual(10);
  }, 15000);
});
