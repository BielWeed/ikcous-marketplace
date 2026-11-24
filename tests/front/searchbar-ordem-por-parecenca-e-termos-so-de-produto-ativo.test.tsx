// @vitest-environment jsdom
//
// Caixinha de sugestoes do topo (caca por mutacao, 24/11/2026):
// (1) entre produtos com estoque, o mais PARECIDO com o que se digitou vem
// primeiro (nome igual > comeca com > contem). Como a caixinha mostra so 6, a
// ordem decide quem entra: com muitos achados, o nome igual ao termo nao pode
// ficar de fora so por estar no fim do catalogo. Inverter a ordem da pontuacao
// passava em toda a suite -- os testes vizinhos so olham QUEM entra.
// (2) As "Sugestoes de Busca" (palavras clicaveis) nascem so de produto ATIVO:
// uma palavra que so existe num produto pausado ("Bolsas" de "Bolsas Premium")
// nao vira chip, mesmo que outro produto ativo a ache pelo plural.
// (3) Os chips sao AUTOCOMPLETAR: a palavra tem de COMECAR com o que se digitou
// ("olsa" nao sugere "Bolsa", embora a lista ache o produto) e aparece com a
// primeira letra maiuscula e o resto minusculo ("CAMISA" -> "Camisa"), sem a
// pontuacao colada ("Bolsa," -> "Bolsa"). A categoria so vira chip pelo COMECO
// do nome ("cess" nao sugere "Acessorios" como chip), e o selo "Categorias
// Encontradas" exige TODAS as palavras ("bolsa preta" nao mostra a categoria "Bolsas").
// (4) A palavra sugerida precisa ser achada por um produto ATIVO (um pausado
// com o mesmo nome nao a salva) e o anuncio "N resultados" para o leitor de
// tela continua quando o catalogo tem copia mesmo com a ultima atualizacao
// falha.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const base = {
  description: "",
  // Com foto: a sugestao sem foto vira o quadrado "Sem foto" (sem <img>), e
  // este teste localiza a sugestao pelo <img alt=nome>.
  images: ["https://loja.example.com/foto.jpg"],
  category: "Acessorios",
  price: 50,
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

// Os parecidos MENOS (so "contem bolsa") vem primeiro no catalogo; o nome igual
// ao termo e o ultimo de oito.
const catalogo: Product[] = [
  ...Array.from({ length: 7 }, (_, i) => ({
    ...base,
    id: `m${i}`,
    name: `Mini Bolsa Modelo ${i + 1}`,
  })),
  { ...base, id: "exata", name: "Bolsa" },
] as Product[];

// So tres produtos: nome igual, comeca com, contem (nessa ordem de pontos).
const trio: Product[] = [
  { ...base, id: "contem", name: "Mini Bolsa Preta" },
  { ...base, id: "comeca", name: "Bolsa Grande" },
  { ...base, id: "exata", name: "Bolsa" },
] as Product[];

let produtosDaLoja: Product[] = catalogo;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtosDaLoja }),
}));

const loja = vi.hoisted(() => ({ catalogoErro: false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, catalogoErro: loja.catalogoErro }),
}));

vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Um produto ativo e um pausado cuja palavra difere so pelo plural.
const comPausado: Product[] = [
  { ...base, id: "ativo", name: "Bolsa Azul" },
  { ...base, id: "pausado", name: "Bolsas Premium", isActive: false },
] as Product[];

describe("SearchBar — ordem por parecenca e termos so de produto ativo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    loja.catalogoErro = false;
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

  async function digitar(texto: string) {
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** Os nomes das sugestoes de produto, na ordem da tela. */
  function sugestoes(): string[] {
    return [...hospedeiro.querySelectorAll("button img")].map(
      (img) =>
        img.closest("button")?.querySelector("span + span")?.textContent ?? "",
    );
  }

  it("nome igual, depois 'comeca com', depois 'contem'", async () => {
    produtosDaLoja = trio;
    await digitar("bolsa");

    expect(sugestoes()).toEqual(["Bolsa", "Bolsa Grande", "Mini Bolsa Preta"]);
  });

  it("com oito achados, o nome igual ao termo (ultimo do catalogo) abre a lista e as seis vagas", async () => {
    produtosDaLoja = catalogo;
    await digitar("bolsa");

    const nomes = sugestoes();
    expect(nomes).toHaveLength(6);
    expect(nomes[0]).toBe("Bolsa");
    // O titulo conta o TOTAL (8), nao so as 6 mostradas.
    expect(hospedeiro.textContent).toContain("Produtos (8)");
  });

  /** As palavras clicaveis de "Sugestoes de Busca", na ordem da tela. */
  function chips(): string[] {
    const titulo = [...hospedeiro.querySelectorAll("span")].find(
      (span) => span.textContent === "Sugestões de Busca",
    );
    const secao = titulo?.parentElement?.parentElement;
    return [...(secao?.querySelectorAll("button span") ?? [])].map(
      (span) => span.textContent ?? "",
    );
  }

  it("palavra que so existe em produto pausado nao vira sugestao de busca", async () => {
    produtosDaLoja = comPausado;
    await digitar("bol");

    expect(chips()).toEqual(["Bolsa"]);
  });

  it("autocompletar so pelo comeco da palavra: 'olsa' acha o produto, mas nao sugere 'Bolsa'", async () => {
    produtosDaLoja = comPausado.slice(0, 1);
    await digitar("olsa");

    expect(chips()).toEqual([]);
    expect(sugestoes()).toEqual(["Bolsa Azul"]);
  });

  it("a palavra sugerida vem com a primeira maiuscula e o resto minusculo", async () => {
    produtosDaLoja = [
      { ...base, id: "caps", name: "CAMISA POLO" },
    ] as Product[];
    await digitar("cam");

    expect(chips()).toEqual(["Camisa"]);
  });

  /** Os selos de "Categorias Encontradas", na ordem da tela. */
  function categoriasEncontradas(): string[] {
    const titulo = [...hospedeiro.querySelectorAll("span")].find(
      (span) => span.textContent === "Categorias Encontradas",
    );
    const secao = titulo?.parentElement?.parentElement;
    return [...(secao?.querySelectorAll("button > span") ?? [])].map(
      (span) => span.textContent ?? "",
    );
  }

  it("a categoria so vira chip de busca pelo COMECO do nome: 'cess' nao, 'aces' sim", async () => {
    produtosDaLoja = [
      { ...base, id: "p", name: "Bolsa Azul", category: "Acessorios" },
    ] as Product[];
    await digitar("cess");
    expect(chips()).toEqual([]);
    // O selo "Categorias Encontradas" e outra regra (a palavra aparece em
    // qualquer parte do nome da categoria) e continua achando.
    expect(categoriasEncontradas()).toEqual(["Acessorios"]);

    await digitar("aces");
    expect(chips()).toEqual(["Acessorios"]);
    expect(categoriasEncontradas()).toEqual(["Acessorios"]);
  });

  it("'Categorias Encontradas' exige TODAS as palavras: 'bolsa preta' nao mostra a categoria Bolsas", async () => {
    produtosDaLoja = [
      { ...base, id: "p", name: "Bolsa Preta", category: "Bolsas" },
    ] as Product[];
    await digitar("bolsa preta");

    expect(sugestoes()).toEqual(["Bolsa Preta"]);
    expect(categoriasEncontradas()).toEqual([]);
  });

  it("ancora: uma palavra so ('bolsa') mostra a categoria Bolsas", async () => {
    produtosDaLoja = [
      { ...base, id: "p", name: "Bolsa Preta", category: "Bolsas" },
    ] as Product[];
    await digitar("bolsa");

    expect(categoriasEncontradas()).toEqual(["Bolsas"]);
  });

  it("palavra de produto ativo que so um produto PAUSADO acha nao vira chip", async () => {
    // "Guarda-Chuva" perde o hifen na palavra sugerida ("Guardachuva"), e ela
    // nao acha o proprio produto ativo -- so o pausado, que tem esse nome.
    produtosDaLoja = [
      { ...base, id: "ativo", name: "Guarda-Chuva Azul" },
      { ...base, id: "pausado", name: "Guardachuva Preto", isActive: false },
    ] as Product[];
    await digitar("guarda");

    expect(chips()).toEqual([]);
  });

  it("pontuacao colada na palavra nao vai para o chip: 'Bolsa,' vira 'Bolsa'", async () => {
    produtosDaLoja = [{ ...base, id: "p", name: "Bolsa, Grande" }] as Product[];
    await digitar("bol");

    expect(chips()).toEqual(["Bolsa"]);
  });

  it("catalogo com copia e ultima atualizacao falha ainda anuncia os resultados", async () => {
    loja.catalogoErro = true;
    produtosDaLoja = catalogo;
    await digitar("bolsa");

    const anuncio = hospedeiro.querySelector('[role="status"].sr-only');
    expect(anuncio?.textContent).toBe("8 resultados");
  });
});
