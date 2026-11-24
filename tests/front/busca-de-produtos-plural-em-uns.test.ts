// Protege o plural em "-ns" de TODAS as vogais da regra (e/i/o/u): o "ns" vira
// "m" no singular. Os casos com e/i/o (homens, jardins, batons) ja eram
// vigiados; o "u" ("atuns" -> "atum", "comuns" -> "comum") nao era: quem
// digita o plural de um produto cujo singular termina em "-um" achava nada.
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string) => ({
  name,
  category: "Geral",
  description: null,
});

describe("plural em -uns acha o singular em -um", () => {
  it.each([
    ["atuns", "Atum em Lata"],
    ["comuns", "Pulseira Comum"],
    ["jejuns", "Kit Jejum Intermitente"],
  ])("%s acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("nao e regra de aceitar tudo: atuns nao acha um produto sem Atum", () => {
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "atuns")).toBe(
      false,
    );
  });

  it("a vogal 'a' segue de fora: jeans nao vira jeam", () => {
    expect(produtoCombinaComBusca(produto("Calca Jeam"), "jeans")).toBe(false);
  });
});
