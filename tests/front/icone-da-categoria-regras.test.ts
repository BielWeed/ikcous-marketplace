// O ícone que a vitrine mostra para cada categoria: a escolha da lojista vence,
// senão o nome decide (sem acento nem caixa, e na ordem das regras), e o que a
// lojista não escolheu nem o nome explica vira a etiqueta. Também a régua da
// FORMA própria do ícone (a segunda barreira depois do banco): só um path SVG,
// de até 400 caracteres.
import {
  CHAVES_DE_ICONES,
  TAMANHO_MAXIMO_DA_FORMA,
  formaDeIconeValida,
  iconeDaCategoria,
  iconeEscolhido,
  nomeDoIcone,
} from "@/lib/icones-de-categoria";
import { describe, expect, it } from "vitest";

describe("o ícone que a lojista escolheu", () => {
  it("vence o que o nome sugeriria", () => {
    expect(iconeDaCategoria({ name: "Brinquedos", icone: "moda" })).toBe(
      "moda",
    );
    expect(iconeEscolhido({ icone: "pet" })).toBe("pet");
  });

  it("toda chave do catálogo é aceita como escolha", () => {
    for (const chave of CHAVES_DE_ICONES) {
      expect(iconeEscolhido({ icone: chave })).toBe(chave);
      expect(nomeDoIcone(chave)).not.toBe("");
    }
  });

  it("chave desconhecida, vazia ou herdada do protótipo NÃO conta como escolha", () => {
    for (const icone of [
      "",
      "inexistente",
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(iconeEscolhido({ icone })).toBeNull();
    }
    expect(iconeEscolhido({ icone: null })).toBeNull();
    expect(iconeEscolhido({})).toBeNull();
    // Cai no nome em vez de quebrar a vitrine com um ícone que não existe.
    expect(
      iconeDaCategoria({ name: "Pet shop animal", icone: "constructor" }),
    ).toBe("pet");
  });
});

describe("o ícone deduzido pelo nome", () => {
  const casos: ReadonlyArray<readonly [string, string]> = [
    ["Autocuidado", "cuidado"],
    ["Banho", "cuidado"],
    ["Higiene pessoal", "cuidado"],
    ["Beleza", "beleza"],
    ["Perfumes", "beleza"],
    ["Cosméticos", "beleza"],
    ["Maquiagem", "beleza"],
    ["Brinquedos", "brinquedo"],
    ["Jogos", "brinquedo"],
    ["Calçados", "calcados"],
    ["Tênis", "calcados"],
    ["Sapatos", "calcados"],
    ["Sandálias", "calcados"],
    ["Roupas", "moda"],
    ["Camisetas", "moda"],
    ["Vestuário", "moda"],
    ["Casa e decoração", "casa"],
    ["Cozinha", "casa"],
    ["Cama", "casa"],
    ["Mesa posta", "casa"],
    ["Tecnologia", "tecnologia"],
    ["Eletrônicos", "tecnologia"],
    ["Celulares", "tecnologia"],
    ["Informática", "tecnologia"],
    ["Esportes", "esporte"],
    ["Fitness", "esporte"],
    ["Academia", "esporte"],
    ["Pet", "pet"],
    ["Animal de estimação", "pet"],
    ["Cachorros", "pet"],
    ["Gatos", "pet"],
    ["Alimentos", "alimento"],
    ["Bebidas", "alimento"],
    ["Comida", "alimento"],
    ["Mercado", "alimento"],
    ["Papelaria", "papelaria"],
    ["Cadernos", "papelaria"],
    ["Material escolar", "papelaria"],
    ["Ferramentas", "ferramentas"],
    ["Construção", "ferramentas"],
    ["Joias", "joias"],
    ["Bijuteria", "joias"],
    ["Relógios", "joias"],
  ];

  it.each(casos)("%s mostra o ícone %s", (nome, esperado) => {
    expect(iconeDaCategoria({ name: nome })).toBe(esperado);
  });

  it("ignora caixa e acento, nas duas direções", () => {
    expect(iconeDaCategoria({ name: "CALÇADOS" })).toBe("calcados");
    expect(iconeDaCategoria({ name: "calcados" })).toBe("calcados");
    expect(iconeDaCategoria({ name: "ELETRÔNICOS" })).toBe("tecnologia");
    expect(iconeDaCategoria({ name: "Decoração" })).toBe("casa");
  });

  it("'pet' só vale como palavra inteira: 'Carpete' e 'Petiscos' não são pet", () => {
    expect(iconeDaCategoria({ name: "Carpete" })).toBe("etiqueta");
    expect(iconeDaCategoria({ name: "Petiscos finos" })).toBe("etiqueta");
    expect(iconeDaCategoria({ name: "Pet shop" })).toBe("pet");
  });

  it("nome que nenhuma regra reconhece vira a etiqueta", () => {
    expect(iconeDaCategoria({ name: "Variedades" })).toBe("etiqueta");
    expect(iconeDaCategoria({ name: "" })).toBe("etiqueta");
    expect(iconeDaCategoria({ name: "Promoções", icone: null })).toBe(
      "etiqueta",
    );
  });

  it("nome que casa com duas regras fica com a PRIMEIRA da lista", () => {
    // moda antes de esporte; beleza antes de casa; pet antes de alimento.
    expect(iconeDaCategoria({ name: "Moda fitness" })).toBe("moda");
    expect(iconeDaCategoria({ name: "Perfumes para a casa" })).toBe("beleza");
    expect(iconeDaCategoria({ name: "Comida para animal" })).toBe("pet");
    // cuidado antes de beleza.
    expect(iconeDaCategoria({ name: "Higiene e beleza" })).toBe("cuidado");
  });
});

describe("a forma própria do ícone (path SVG)", () => {
  it("aceita um path que começa em M/m com o alfabeto do desenho", () => {
    expect(formaDeIconeValida("M3 3h18v13H3z")).toBe(true);
    expect(formaDeIconeValida("m3 10 9-8 9 8")).toBe(true);
    expect(formaDeIconeValida("M0,0 L1.5-2 Z")).toBe(true);
  });

  it("o limite é 400 caracteres: 400 serve, 401 não", () => {
    expect(TAMANHO_MAXIMO_DA_FORMA).toBe(400);
    expect(
      formaDeIconeValida(`M${"1".repeat(TAMANHO_MAXIMO_DA_FORMA - 1)}`),
    ).toBe(true);
    expect(formaDeIconeValida(`M${"1".repeat(TAMANHO_MAXIMO_DA_FORMA)}`)).toBe(
      false,
    );
  });

  it("recusa o que não é path: vazio, outro comando inicial, tag, script, não-texto", () => {
    for (const forma of [
      "",
      "L3 3",
      "3 3h18",
      "M3 3 <script>",
      'M3 3"onload=alert(1)',
      "M3 3 ; drop",
      "M3 3 e5",
    ]) {
      expect(formaDeIconeValida(forma)).toBe(false);
    }
    for (const naoTexto of [null, undefined, 3, {}, ["M0 0"]]) {
      expect(formaDeIconeValida(naoTexto)).toBe(false);
    }
  });
});
