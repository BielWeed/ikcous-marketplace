// Protege a regra do caminho de volta do plural em "-ao": o singular digitado
// vira "-oes" so quando o radical tem 2+ letras ("cartao" -> "cartoes"). Com
// radical de UMA letra ("pao", "cao", "mao") a forma "-oes" ("poes", "coes",
// "moes") e outra palavra: "pao" nao pode achar um produto que so tem "Poes"
// como palavra inteira. O plural certo desses ("paes", "caes", "maos") segue
// achando.
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string) => ({
  name,
  category: "Geral",
  description: null,
});

describe("radical de uma letra nao ganha a forma -oes", () => {
  it.each([
    ["pao", "Poes de Cima"],
    ["cao", "Coes de Cima"],
    ["mao", "Moes de Cima"],
  ])("%s NAO acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(false);
  });

  it.each([
    ["pao", "Paes Frescos"],
    ["cao", "Caes de Raca"],
    ["mao", "Maos de Fada"],
  ])("%s ainda acha o plural certo %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("radical de duas letras segue ganhando -oes: cartao acha Cartoes", () => {
    expect(produtoCombinaComBusca(produto("Cartoes Postais"), "cartao")).toBe(
      true,
    );
  });
});
