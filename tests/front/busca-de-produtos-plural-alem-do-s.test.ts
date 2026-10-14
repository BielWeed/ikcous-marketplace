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
