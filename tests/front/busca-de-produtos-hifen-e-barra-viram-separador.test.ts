// A cliente digita o nome como se escreve: "guarda-chuva". A loja cadastrou
// "Guarda Chuva" (sem hifen) e a busca dizia "nenhum produto": o hifen e a
// barra DENTRO da palavra nao separavam nada, entao a busca virava UMA palavra
// "guarda-chuva" que so existia em nome cadastrado com hifen. Agora `-` e `/`
// separam palavras na busca E no texto do produto, nos dois sentidos.
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string, category = "Geral") => ({ name, category });

describe("produtoCombinaComBusca — hifen e barra viram separador", () => {
  it.each([
    ["Guarda Chuva Compacto", "guarda-chuva"],
    ["Porta Joias Veludo", "porta-joias"],
    ["Meia Calça Fio 40", "meia-calca"],
    ["Camiseta Manga Curta", "manga/curta"],
    ["Camiseta Manga Curta", "manga-curta"],
  ])("nome sem hifen '%s' acha buscando '%s'", (nome, busca) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it.each([
    ["Guarda-Chuva Compacto", "guarda chuva"],
    ["Guarda-Chuva Compacto", "guarda-chuva"],
    ["Porta-Joias Veludo", "porta joias"],
    ["Camiseta Manga/Curta", "manga curta"],
    ["Camiseta Manga/Curta", "manga/curta"],
  ])("nome com hifen/barra '%s' acha buscando '%s'", (nome, busca) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("hifen no meio junto de plural e acento: 'guarda-chuvas' e 'Porta-Joias' continuam achando", () => {
    expect(
      produtoCombinaComBusca(produto("Guarda Chuva Compacto"), "guarda-chuvas"),
    ).toBe(true);
    expect(
      produtoCombinaComBusca(produto("Porta Jóias Veludo"), "PORTA-JOIAS"),
    ).toBe(true);
  });

  it("'3-4 anos' acha o produto cujas variacoes ativas sao 3 e 4", () => {
    const roupa = {
      name: "Conjunto Infantil",
      category: "Roupas por anos",
      variants: [
        { value: "3", active: true },
        { value: "4", active: true },
      ],
    };
    expect(produtoCombinaComBusca(roupa, "3-4 anos")).toBe(true);
    expect(produtoCombinaComBusca(roupa, "3/4 anos")).toBe(true);
  });

  it("'3-4 anos' nao acha produto que so tem a variacao 3 (o 4 tambem precisa existir)", () => {
    const roupa = {
      name: "Conjunto Infantil",
      category: "Roupas por anos",
      variants: [{ value: "3", active: true }],
    };
    expect(produtoCombinaComBusca(roupa, "3-4 anos")).toBe(false);
  });

  it("variacao cadastrada com hifen ('P-M') e achada por 'p m' e por 'p-m'", () => {
    const camisa = {
      name: "Camisa",
      category: "Geral",
      variants: [{ value: "P-M", active: true }],
    };
    expect(produtoCombinaComBusca(camisa, "p m")).toBe(true);
    expect(produtoCombinaComBusca(camisa, "p-m")).toBe(true);
  });

  it("controle: o separador nao faz achar o que nao existe", () => {
    expect(
      produtoCombinaComBusca(produto("Guarda Chuva Compacto"), "guarda-sol"),
    ).toBe(false);
    expect(
      produtoCombinaComBusca(produto("Guarda Chuva Compacto"), "porta-joias"),
    ).toBe(false);
  });

  it("hifen ou barra nas pontas continua sendo pontuacao que nao conta", () => {
    const camiseta = produto("Camiseta Basica");
    expect(produtoCombinaComBusca(camiseta, "-camiseta-")).toBe(true);
    expect(produtoCombinaComBusca(camiseta, "/camiseta/")).toBe(true);
  });

  it.each(["-", "/", "---", "- / -"])(
    "busca so de simbolo '%s' segue como antes: nao vira busca vazia que acha tudo",
    (busca) => {
      expect(produtoCombinaComBusca(produto("Camiseta Basica"), busca)).toBe(
        false,
      );
    },
  );

  it("controles que ja valiam: acento, plural, ordem e ligacoes", () => {
    const vestido = produto("Vestido Festa Longo", "Vestidos");
    expect(produtoCombinaComBusca(vestido, "VESTIDOS")).toBe(true);
    expect(produtoCombinaComBusca(vestido, "longo vestido")).toBe(true);
    expect(produtoCombinaComBusca(vestido, "vestido de festa")).toBe(true);
    expect(produtoCombinaComBusca(produto("Óculos de Sol"), "oculos")).toBe(
      true,
    );
  });
});
