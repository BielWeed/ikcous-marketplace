// A cliente da Savy digitava "bolsa preta" e o catalogo dizia "nenhum
// resultado" embora existisse "Bolsa Grande Preta": o filtro exigia a FRASE
// inteira, na mesma ordem. Plural ("shorts", "saias") tambem nao achava. Agora
// a busca quebra em palavras: TODAS tem de aparecer (nome, categoria ou
// descricao), em qualquer ordem, ignorando acento, maiuscula e "s" final.
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (
  name: string,
  category = "Geral",
  description: string | null = null,
) => ({ name, category, description });

const bolsa = produto("Bolsa Grande Preta", "Bolsas");
const jaqueta = produto("Jaqueta Biker Cropped Muts Preta", "Jaquetas");
const calcaJeans = produto("Calça Jeans Preta", "Calças");
const vestido = produto("Vestido Midi Preto", "Vestidos");
const short = produto("Short Jeans Cintura Alta", "Shorts");
const saia = produto("Saia Midi Plissada", "Saias");

describe("produtoCombinaComBusca", () => {
  it("bolsa preta acha Bolsa Grande Preta (palavras separadas)", () => {
    expect(produtoCombinaComBusca(bolsa, "bolsa preta")).toBe(true);
  });

  it("jaqueta preta acha Jaqueta Biker Cropped Muts Preta", () => {
    expect(produtoCombinaComBusca(jaqueta, "jaqueta preta")).toBe(true);
  });

  it("preta jeans acha Calca Jeans Preta (ordem diferente)", () => {
    expect(produtoCombinaComBusca(calcaJeans, "preta jeans")).toBe(true);
  });

  it("a ordem das palavras e irrelevante", () => {
    expect(produtoCombinaComBusca(bolsa, "preta bolsa")).toBe(true);
    expect(produtoCombinaComBusca(bolsa, "grande preta bolsa")).toBe(true);
  });

  it("shorts (plural) acha Short", () => {
    expect(produtoCombinaComBusca(short, "shorts")).toBe(true);
  });

  it("saias (plural) acha Saia", () => {
    expect(produtoCombinaComBusca(saia, "saias")).toBe(true);
  });

  it("plural dentro da frase: bolsas pretas acha Bolsa Grande Preta", () => {
    expect(produtoCombinaComBusca(bolsa, "bolsas pretas")).toBe(true);
  });

  it("vestido preto acha Vestido Midi Preto", () => {
    expect(produtoCombinaComBusca(vestido, "vestido preto")).toBe(true);
  });

  it("TODAS as palavras precisam aparecer: bolsa vermelha nao acha", () => {
    expect(produtoCombinaComBusca(bolsa, "bolsa vermelha")).toBe(false);
    expect(produtoCombinaComBusca(jaqueta, "bolsa preta")).toBe(false);
  });

  it("palavras podem vir de campos diferentes (nome + categoria + descricao)", () => {
    const p = produto("Midi Plissada", "Saias", "Tecido leve de verao");
    expect(produtoCombinaComBusca(p, "saia plissada verao")).toBe(true);
  });

  it("acentos continuam funcionando: calca acha Calca com cedilha", () => {
    expect(produtoCombinaComBusca(calcaJeans, "calca")).toBe(true);
    expect(produtoCombinaComBusca(calcaJeans, "CALÇA preta")).toBe(true);
  });

  it("uma palavra so continua achando", () => {
    expect(produtoCombinaComBusca(bolsa, "bolsa")).toBe(true);
    expect(produtoCombinaComBusca(bolsa, "saia")).toBe(false);
  });

  it("palavra curta nao e reduzida a quase nada (gas nao vira ga)", () => {
    const gas = produto("Botijao de Gas", "Casa");
    const garrafa = produto("Garrafa Termica", "Casa");
    expect(produtoCombinaComBusca(gas, "gas")).toBe(true);
    expect(produtoCombinaComBusca(garrafa, "gas")).toBe(false);
  });

  it("descricao nula nao quebra", () => {
    expect(
      produtoCombinaComBusca(produto("Colar", "Joias", null), "colar"),
    ).toBe(true);
  });

  it("busca vazia ou so de espacos combina com tudo (lista cheia)", () => {
    expect(produtoCombinaComBusca(bolsa, "")).toBe(true);
    expect(produtoCombinaComBusca(bolsa, "   ")).toBe(true);
  });
});
