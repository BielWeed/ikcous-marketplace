// A regra de plural da busca tirava UM "s" final e mais nada. Quem digitava
// "colares", "flores", "aneis", "lencois", "batons", "bombons", "cordoes" ou
// "paes" nao achava "Colar", "Flor", "Anel", "Lencol", "Batom", "Bombom",
// "Cordao" nem "Pao": o plural PT-BR muda a palavra, nao so acrescenta "s".
// Aqui o contrato: cada plural acha o singular, e o que ja funcionava continua
// funcionando (sem regressao nem sumico de palavra que ja termina em "s").
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string, category = "Geral", description?: string) => ({
  name,
  category,
  description: description ?? null,
});

describe("plural alem do 's' simples acha o singular", () => {
  it.each([
    ["colares", "Colar Coração Dourado"],
    ["flores", "Flor de Cerejeira"],
    ["aneis", "Anel Solitário"],
    ["anéis", "Anel Solitário"],
    ["lençóis", "Lençol de Algodão"],
    ["lencois", "Lençol de Algodão"],
    ["batons", "Batom Matte"],
    ["bombons", "Bombom de Morango"],
    ["cordões", "Cordão de Prata"],
    ["cordoes", "Cordão de Prata"],
    ["pães", "Pão Francês"],
    ["paes", "Pão Francês"],
    ["azuis", "Bolsa Azul"],
    ["animais", "Bichinho Animal de Pelúcia"],
    ["luzes", "Luz de Presença"],
  ])("%s acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("o plural vale em frase: colares dourados acha Colar Coração Dourado", () => {
    expect(
      produtoCombinaComBusca(
        produto("Colar Coração Dourado"),
        "colares dourados",
      ),
    ).toBe(true);
  });

  it("continua exigindo TODAS as palavras: colares vermelhos nao acha o dourado", () => {
    expect(
      produtoCombinaComBusca(
        produto("Colar Coração Dourado"),
        "colares vermelhos",
      ),
    ).toBe(false);
  });

  it("plural nao acha o que nao e o singular dele", () => {
    // Âncora: se a regra virasse "aceita tudo", as linhas acima passariam
    // pelo motivo errado.
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "colares")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "aneis")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Blusa Branca"), "paes")).toBe(false);
  });
});

describe("o que ja funcionava continua funcionando", () => {
  it.each([
    ["blusas", "Blusa de Seda"],
    ["brincos", "Brinco de Pérola"],
    ["calças", "Calça Jeans"],
    ["calcas", "Calça Jeans"],
    ["tenis", "Tênis Branco"],
    ["shorts", "Short Jeans"],
    ["saias", "Saia Midi"],
  ])("%s acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });
});

describe("palavra singular que termina em 's' nao some da busca", () => {
  it.each([
    ["óculos", "Óculos de Sol"],
    ["oculos", "Óculos de Sol"],
    ["lápis", "Lápis de Olho"],
    ["lapis", "Lápis de Olho"],
    ["pires", "Pires de Porcelana"],
    ["ônibus", "Ônibus de Brinquedo"],
    ["onibus", "Ônibus de Brinquedo"],
    ["jeans", "Calça Jeans"],
    ["gas", "Botijão de Gas"],
  ])("%s ainda acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("palavra de ate 3 letras nao e mexida (gas nao vira ga)", () => {
    expect(produtoCombinaComBusca(produto("Garrafa Termica"), "gas")).toBe(
      false,
    );
  });

  it("o singular derivado nao cola em palavra curta demais (mais nao vira mal)", () => {
    expect(produtoCombinaComBusca(produto("Malha de Algodão"), "mais")).toBe(
      false,
    );
  });
});

// Medido na revisao: o singular de 3 letras ("cases" -> "cas") achava por
// TRECHO tudo que tivesse essas 3 letras. Como palavra inteira, so acha o que
// e' a palavra mesma.
describe("singular derivado de 3 letras so vale como palavra inteira", () => {
  const catalogo = [
    produto("Case iPhone", "Acessórios"),
    produto("Casaco Longo", "Roupas"),
    produto("Parka Verde", "Casa"),
    produto("Tinta Cor Azul", "Casa"),
    produto("Colar Coração", "Joias"),
    produto("Corrente Dourada", "Joias"),
    produto("Cordão de Prata", "Joias"),
    produto("Base Líquida", "Maquiagem"),
    produto("Camiseta Básica", "Roupas"),
    produto("Pires de Porcelana", "Cozinha"),
    produto("Espiral Decorativa", "Casa"),
    produto("Pirulito de Morango", "Doces"),
    produto("Botijão de Gás", "Casa"),
    produto("Gasolina Aditivo", "Carro"),
    produto("Par de Brincos", "Joias"),
    produto("Luz de Presença", "Casa"),
    produto("Pendente Luz", "Casa"),
    produto("Luzia Perfume", "Beleza"),
  ];
  const quemAcha = (busca: string) =>
    catalogo.filter((p) => produtoCombinaComBusca(p, busca)).map((p) => p.name);

  it.each([
    ["cases", ["Case iPhone"]],
    ["cores", ["Tinta Cor Azul"]],
    ["bases", ["Base Líquida"]],
    ["pires", ["Pires de Porcelana"]],
    ["gases", ["Botijão de Gás"]],
    ["pares", ["Par de Brincos"]],
  ])("%s acha so o que e' o singular de verdade", (busca, esperado) => {
    expect(quemAcha(busca)).toEqual(esperado);
  });

  it("luzes continua achando a palavra Luz, no comeco e no fim, e nao Luzia", () => {
    expect(quemAcha("luzes")).toEqual(["Luz de Presença", "Pendente Luz"]);
  });

  it("forma de 2 letras nunca vale (ares nao vira ar)", () => {
    expect(produtoCombinaComBusca(produto("Ar Condicionado"), "ares")).toBe(
      false,
    );
  });

  it("jeans nao inventa jeam (so e/i/o/u + ns vira m)", () => {
    expect(produtoCombinaComBusca(produto("Jeam Fashion"), "jeans")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Calça Jeans"), "jeans")).toBe(true);
  });
});
