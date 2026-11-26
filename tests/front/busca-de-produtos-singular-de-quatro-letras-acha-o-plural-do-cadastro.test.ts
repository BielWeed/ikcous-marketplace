// O caminho de volta do plural: a cliente digita o SINGULAR e o cadastro está
// no plural irregular (palavra inteira). As regras valem a partir de 4 letras;
// os testes vizinhos provavam palavras longas (refil, batom, cartao) e deixavam
// solto o limite exato de 4 letras e a vogal "u" de "-um":
//   - consoante + "il" -> "is":   anil -> anis        (4 letras, no limite)
//   - e/i/o/u + "m" -> "ns":      item -> itens       (4 letras, no limite)
//                                 atum -> atuns, album -> albuns  (vogal "u")
//   - "-ao" -> "-oes" com radical de 2 letras: leao -> leoes
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string) => ({
  name,
  category: "Geral",
  description: null,
});

describe("singular curto digitado acha o plural irregular do cadastro", () => {
  it.each([
    ["anil", "Anis Estrelado"],
    ["item", "Itens do Kit"],
    ["atum", "Atuns em Lata"],
    ["album", "Albuns de Foto"],
    ["leao", "Leoes de Pelucia"],
  ])("%s acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("e só como palavra inteira: o plural não é achado dentro de outra palavra", () => {
    expect(produtoCombinaComBusca(produto("Kit Itensilios"), "item")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Mesa Albunsal"), "album")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Capa Leoesa"), "leao")).toBe(false);
  });

  it("não é regra de aceitar tudo: o singular curto não acha produto sem a palavra", () => {
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "atum")).toBe(false);
    expect(produtoCombinaComBusca(produto("Bolsa Grande"), "anil")).toBe(false);
  });

  it("palavra de 3 letras continua fora da regra (limite de baixo)", () => {
    // "pao" -> "poes" acharia Poesia; "mil" nem chega a virar "mis".
    expect(produtoCombinaComBusca(produto("Livro de Poes"), "pao")).toBe(false);
    expect(produtoCombinaComBusca(produto("Kit Mis"), "mil")).toBe(false);
  });
});
