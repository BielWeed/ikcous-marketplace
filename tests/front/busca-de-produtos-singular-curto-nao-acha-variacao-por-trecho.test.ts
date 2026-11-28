// Protege a regra da forma de singular de 3 letras ("cores" -> "cor", "luzes" ->
// "luz") na hora de olhar as VARIACOES a venda: ela so vale como palavra
// inteira ali tambem. Sem isso, quem digita "cores" achava todo produto com uma
// variacao "Coral" (o "cor" aparece por trecho dentro de "coral"), e o plural
// "luzes" achava a variacao "Luzidio".
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const comVariacao = (value: string, active = true) => ({
  name: "Bolsa Grande",
  category: "Geral",
  description: null,
  variants: [{ value, active, stockIncrement: 1 }],
});

describe("singular derivado de 3 letras nas variacoes", () => {
  it.each([
    ["cores", "Coral"],
    ["luzes", "Luzidio"],
  ])("%s NAO acha a variacao %s (so trecho de palavra)", (busca, valor) => {
    expect(produtoCombinaComBusca(comVariacao(valor), busca)).toBe(false);
  });

  it.each([
    ["cores", "Cor"],
    ["luzes", "Luz"],
  ])("%s acha a variacao %s quando ela e a palavra inteira", (busca, valor) => {
    expect(produtoCombinaComBusca(comVariacao(valor), busca)).toBe(true);
  });

  it("variacao desligada nao conta nem como palavra inteira", () => {
    expect(produtoCombinaComBusca(comVariacao("Cor", false), "cores")).toBe(
      false,
    );
  });
});
