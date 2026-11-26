// `src/utils/fileiras-de-variacao.ts`: bordas que os testes vizinhos não seguravam.
//
//  - `existe` ("há estoque em ALGUMA combinação") com UMA peça: uma peça é
//    estoque. Se o corte virasse "mais de uma", o P que só tem uma peça (na cor
//    Branca) ficaria "esgotado de vez" e travado ao escolher a cor Preta, em
//    vez de apenas apagado pela combinação;
//  - uma linha legada com os nomes de atributo DIFERENTES (Cor / Material ao
//    lado de Cor / Tamanho) impede desmontar a grade inteira: tudo volta ao
//    formato bruto, nenhuma fileira "Cor" é inventada pela metade;
//  - com dois grupos antigos em linhas separadas, escolher só um deles não fecha
//    a seleção: sem variante (senão a cliente poria no carrinho a linha da cor
//    sem ter escolhido o tamanho);
//  - o desempate final da ordem dos valores é o texto cru ("azul" e "Azul"
//    diferem), e a lista do painel ordena a grade composta pelo atributo que a
//    loja mostra primeiro MESMO quando o lojista gravou a ordem invertida
//    ("Cor / Tamanho"), e mantém a ordem gravada entre atributos de mesmo peso.
import type { ProductVariant } from "@/types";
import {
  compararValores,
  fileirasDeVariacao,
  ordenarVariantesDoPainel,
} from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

const variante = (
  id: string,
  name: string,
  value: string,
  stockIncrement = 2,
): ProductVariant => ({
  id,
  productId: "produto",
  name,
  value,
  stockIncrement,
  active: true,
});

describe("fileirasDeVariacao — `existe` nos limites do estoque", () => {
  const grade = (estoqueDoPBranca: number) => [
    variante("a", "Tamanho / Cor", "P / Branca", estoqueDoPBranca),
    variante("b", "Tamanho / Cor", "M / Preta", 5),
  ];
  const doP = (estoqueDoPBranca: number) =>
    fileirasDeVariacao(grade(estoqueDoPBranca), { Cor: "Preta" })
      .fileiras.find((f) => f.nome === "Tamanho")
      ?.valores.find((v) => v.valor === "P");

  it("uma peça só, em outra cor: apagado pela combinação, mas existe", () => {
    expect(doP(1)).toMatchObject({
      valor: "P",
      disponivel: false,
      estoque: 0,
      existe: true,
    });
  });

  it("controle: zero peça em qualquer combinação é esgotado de vez (existe falso)", () => {
    expect(doP(0)).toMatchObject({ disponivel: false, existe: false });
  });
});

describe("fileirasDeVariacao — linha legada e seleção incompleta", () => {
  it("nomes de atributo diferentes entre as linhas: tudo volta ao formato bruto", () => {
    const { fileiras } = fileirasDeVariacao([
      variante("a", "Cor / Tamanho", "Branca / PP"),
      variante("b", "Cor / Material", "Branca / Algodão"),
    ]);
    expect(fileiras.map((f) => f.nome).sort()).toEqual([
      "Cor / Material",
      "Cor / Tamanho",
    ]);
  });

  const antigo = [
    variante("c", "Cor", "Branca", 3),
    variante("t", "Tamanho", "P", 3),
  ];

  it("dois grupos antigos em linhas separadas: só um escolhido não devolve variante", () => {
    expect(
      fileirasDeVariacao(antigo, { Cor: "Branca" }).variante,
    ).toBeUndefined();
    expect(
      fileirasDeVariacao(antigo, { Tamanho: "P" }).variante,
    ).toBeUndefined();
  });

  it("controle: com os dois escolhidos a seleção fecha numa variante", () => {
    expect(
      fileirasDeVariacao(antigo, { Cor: "Branca", Tamanho: "P" }).variante,
    ).toBeDefined();
  });
});

describe("compararValores — o texto cru é o último desempate", () => {
  it("'azul' e 'Azul' não empatam, e o sinal se inverte ao trocar os lados", () => {
    expect(compararValores("Azul", "azul")).toBe(-1);
    expect(compararValores("azul", "Azul")).toBe(1);
    expect(compararValores("azul", "azul")).toBe(0);
  });

  it("'Azul' e 'azul' saem sempre na mesma ordem, qualquer que seja a entrada", () => {
    expect(["azul", "Azul"].sort(compararValores)).toEqual(["Azul", "azul"]);
    expect(["Azul", "azul"].sort(compararValores)).toEqual(["Azul", "azul"]);
  });
});

describe("ordenarVariantesDoPainel — grade composta gravada em ordem invertida", () => {
  const valores = (lista: ProductVariant[]) => lista.map((v) => v.value);

  it("'Cor / Tamanho' ordena pelo TAMANHO primeiro, depois pela cor", () => {
    const vindas = [
      variante("a", "Cor / Tamanho", "Azul / M"),
      variante("b", "Cor / Tamanho", "Verde / P"),
      variante("c", "Cor / Tamanho", "Azul / P"),
      variante("d", "Cor / Tamanho", "Azul / G"),
    ];
    expect(valores(ordenarVariantesDoPainel(vindas))).toEqual([
      "Azul / P",
      "Verde / P",
      "Azul / M",
      "Azul / G",
    ]);
  });

  it("atributos de mesmo peso ('Marca / Material') mantêm a ordem gravada", () => {
    const vindas = [
      variante("a", "Marca / Material", "Zeta / Algodão"),
      variante("b", "Marca / Material", "Alfa / Seda"),
      variante("c", "Marca / Material", "Alfa / Linho"),
    ];
    expect(valores(ordenarVariantesDoPainel(vindas))).toEqual([
      "Alfa / Linho",
      "Alfa / Seda",
      "Zeta / Algodão",
    ]);
  });
});
