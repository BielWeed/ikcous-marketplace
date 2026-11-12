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
  it.each([
    ["Vestido Festa Longo", "vestido de festa"],
    ["Óculos Sol Feminino", "oculos de sol"],
    ["Bolsa Notebook", "bolsa para notebook"],
    ["Bolsa Couro", "bolsa com couro"],
  ])("frase natural acha %s buscando %s", (nome, busca) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it.each([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "para",
    "com",
    "e",
    "em",
    "a",
    "o",
    "um",
    "uma",
  ])("ligacao %s nao e obrigatoria junto de outros termos", (ligacao) => {
    expect(
      produtoCombinaComBusca(produto("Kit Lux", "Xyz"), `kit ${ligacao} lux`),
    ).toBe(true);
  });

  it("ligacoes sozinhas preservam a busca antiga e tamanho continua obrigatorio", () => {
    expect(produtoCombinaComBusca(produto("Verde"), "de")).toBe(true);
    expect(produtoCombinaComBusca(produto("Verde"), "e")).toBe(true);
    expect(produtoCombinaComBusca(produto("Bolsa"), "a o")).toBe(true);
    expect(produtoCombinaComBusca(produto("Vestido Festa"), "de")).toBe(false);
    expect(produtoCombinaComBusca(produto("Uma bolsa"), "uma")).toBe(true);
    expect(produtoCombinaComBusca(produto("Vestido Festa"), "de para")).toBe(
      false,
    );
    expect(produtoCombinaComBusca(produto("Camisa Polo"), "camisa de m")).toBe(
      false,
    );
  });

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

// A cor e o tamanho moram so nas variacoes ("Camiseta Basica" com Cor: Azul,
// Cor: Preto e Tamanho: GG): quem digitava "azul" ouvia "nenhum produto".
describe("produtoCombinaComBusca — cor e tamanho das variacoes", () => {
  const variacao = (name: string, value: string, active = true) => ({
    name,
    value,
    active,
  });
  const camiseta = {
    ...produto("Camiseta Básica", "Roupas", "Algodão macio"),
    variants: [
      variacao("Cor", "Azul"),
      variacao("Cor", "Preto"),
      variacao("Tamanho", "GG"),
      variacao("Cor", "Vermelho", false),
    ],
  };

  it("azul, preto e GG acham a camiseta pelo valor da variacao", () => {
    expect(produtoCombinaComBusca(camiseta, "azul")).toBe(true);
    expect(produtoCombinaComBusca(camiseta, "preto")).toBe(true);
    expect(produtoCombinaComBusca(camiseta, "GG")).toBe(true);
  });

  it("acha com o nome do produto junto: camiseta azul", () => {
    expect(produtoCombinaComBusca(camiseta, "camiseta azul")).toBe(true);
    expect(produtoCombinaComBusca(camiseta, "camiseta verde")).toBe(false);
  });

  it("plural da cor tambem acha: azuis acha Azul", () => {
    expect(produtoCombinaComBusca(camiseta, "azuis")).toBe(true);
  });

  it("variacao inativa nao acha: vermelho nao esta a venda", () => {
    expect(produtoCombinaComBusca(camiseta, "vermelho")).toBe(false);
  });

  it("o NOME do grupo nao conta: 'cor' e 'tamanho' nao acham todo produto", () => {
    expect(produtoCombinaComBusca(camiseta, "cor")).toBe(false);
    expect(produtoCombinaComBusca(camiseta, "tamanho")).toBe(false);
  });

  it("valor curto (1 ou 2 letras) vale como palavra inteira, nao como trecho", () => {
    const blusa = {
      ...produto("Blusa Lisa", "Roupas"),
      variants: [variacao("Tamanho", "M"), variacao("Cor", "Branco")],
    };
    // "m" e' a variacao M: acha. Mas "Marrom" nao pode casar com "m" por trecho.
    expect(produtoCombinaComBusca(blusa, "blusa m")).toBe(true);
    const calca = {
      ...produto("Calça Reta", "Roupas"),
      variants: [variacao("Cor", "Marrom"), variacao("Tamanho", "42")],
    };
    expect(produtoCombinaComBusca(calca, "calca m")).toBe(false);
    expect(produtoCombinaComBusca(calca, "calca 42")).toBe(true);
    expect(produtoCombinaComBusca(calca, "calca 4")).toBe(false);
  });

  it.each(["p", "m", "g", "pp", "gg", "xg", "ab"])(
    "tamanho %s nao casa dentro do nome, categoria ou descricao",
    (tamanho) => {
      const polo = {
        ...produto("Camisa Polo", "Roupas", `Estampa ${tamanho}extra`),
        variants: [variacao("Tamanho", "42")],
      };
      expect(produtoCombinaComBusca(polo, `camisa ${tamanho}`)).toBe(false);
      expect(
        produtoCombinaComBusca(
          {
            ...polo,
            variants: [variacao("Tamanho", tamanho)],
          },
          `camisa ${tamanho}`,
        ),
      ).toBe(true);
      expect(
        produtoCombinaComBusca(
          produto(`Camisa ${tamanho}`),
          `camisa ${tamanho}`,
        ),
      ).toBe(true);
    },
  );

  it("uma letra so e palavra inteira, duas letras sozinhas ainda completam", () => {
    expect(produtoCombinaComBusca(produto("Camisa Social"), "m")).toBe(false);
    expect(produtoCombinaComBusca(produto("Camisa Social"), "ca")).toBe(true);
  });

  it("valor composto 'Azul / M' acha por cada palavra", () => {
    const polo = {
      ...produto("Polo Clássica", "Roupas"),
      variants: [variacao("Cor", "Azul / M")],
    };
    expect(produtoCombinaComBusca(polo, "polo azul m")).toBe(true);
    expect(produtoCombinaComBusca(polo, "polo azul g")).toBe(false);
  });

  it("produto sem variacoes continua achando so por nome, categoria e descricao", () => {
    expect(produtoCombinaComBusca(bolsa, "azul")).toBe(false);
    expect(
      produtoCombinaComBusca({ ...bolsa, variants: undefined }, "bolsa"),
    ).toBe(true);
  });
});
