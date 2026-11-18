import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import type { ProductVariant } from "@/types";
import {
  criarEixosDaVariacao,
  disponibilidadeDoValor,
  escolherValorDoEixo,
  preselecionarCor,
  preselecionarOpcaoUnica,
  resolverSelecaoDosEixos,
  variantesCompativeis,
} from "@/utils/eixos-da-variacao";
import { fileirasDeVariacao } from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

const variante = (
  value: string,
  stockIncrement = 3,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id: value,
  productId: "teste",
  name: "Cor / Tamanho",
  value,
  stockIncrement,
  active: true,
  ...extra,
});
const variantes = [
  variante("Azul / PP", 5, { priceOverride: 60 }),
  variante("Azul / M", 3, { priceOverride: 75 }),
  variante("Verde / PP", 0),
  variante("Verde / M", 1, { priceOverride: 0 }),
  variante("Preto / PP", 2),
];
const modelo = () => criarEixosDaVariacao(variantes);
// Os valores vêm na ordem em que o produto foi GRAVADO (Cor, Tamanho); a tela
// mostra Tamanho antes, então o eixo se acha pela posição gravada (`indice`).
const escolhas = (valores: string[]) =>
  new Map(
    valores.map((v, i) => [
      modelo().eixos.find((e) => e.indice === i)!.chave,
      v,
    ]),
  );
const eixoDe = (m: ReturnType<typeof modelo>, nome: string) =>
  m.eixos.find((e) => e.nome === nome)!;

describe("eixos da variação — tradução sem mudar a linha entregue", () => {
  it("resolve o valor legado mesmo sem Array.prototype.at", () => {
    // A linha legada tem nome composto e só um valor. Assim o leitor de
    // atributos (fora deste lote) devolve a linha bruta sem usar .at().
    const legado = variante("Azul");
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "at")!;
    let resultado: unknown;
    try {
      Reflect.deleteProperty(Array.prototype, "at");
      const m = criarEixosDaVariacao([legado]);
      const chave = m.eixos[0]!.chave;
      const selecao = new Map([[chave, "Azul"]]);
      resultado = {
        vazio: criarEixosDaVariacao([]),
        valores: m.eixos[0]!.valores,
        disponibilidade: disponibilidadeDoValor(m, selecao, chave, "Azul"),
        compativeis: variantesCompativeis(m, selecao),
        resolvida: [...resolverSelecaoDosEixos(m, selecao)],
      };
    } finally {
      Object.defineProperty(Array.prototype, "at", descriptor);
    }
    expect(resultado).toEqual({
      vazio: { eixos: [], grupos: [] },
      valores: ["Azul"],
      disponibilidade: { existe: true, disponivel: true, ultima: false },
      compativeis: [legado],
      resolvida: [["Cor / Tamanho", "Azul"]],
    });
  });

  it("produto sem variante não inventa eixo nem seleção", () => {
    const m = criarEixosDaVariacao([]);
    expect(m.eixos).toEqual([]);
    expect([...resolverSelecaoDosEixos(m, new Map())]).toEqual([]);
  });

  it("separa dois eixos com valores únicos, Tamanho antes de Cor (como a página); ignora inativos", () => {
    const m = criarEixosDaVariacao([
      ...variantes,
      variante("Rosa / GG", 10, { active: false }),
    ]);
    expect(m.eixos.map((e) => [e.nome, e.valores])).toEqual([
      ["Tamanho", ["PP", "M"]],
      ["Cor", ["Azul", "Verde", "Preto"]],
    ]);
  });

  it("a ordem é a MESMA régua da página: Tamanho/Voltagem, Cor, depois os outros na gravação", () => {
    const nomes = (name: string, value: string) =>
      criarEixosDaVariacao([variante(value, 1, { name })]).eixos.map(
        (e) => e.nome,
      );
    expect(nomes("Tecido / Cor / Tamanho", "Seda / Azul / P")).toEqual([
      "Tamanho",
      "Cor",
      "Tecido",
    ]);
    expect(nomes("Material / Estampa / Cor", "Seda / Lisa / Azul")).toEqual([
      "Cor",
      "Material",
      "Estampa",
    ]);
    expect(nomes("COR / tamanho", "Azul / P")).toEqual(["tamanho", "COR"]);
    expect(nomes("Côr / Voltagem", "Azul / 220V")).toEqual(["Voltagem", "Côr"]);
  });

  it("a posição gravada (chave e indice) não muda com a ordem da tela", () => {
    const m = modelo();
    expect(eixoDe(m, "Cor")).toMatchObject({ indice: 0, chave: "0:0" });
    expect(eixoDe(m, "Tamanho")).toMatchObject({ indice: 1, chave: "0:1" });
  });

  it("grupos legados independentes aparecem com o tamanho primeiro, mas o grupo principal (do carrinho) não troca", () => {
    const m = criarEixosDaVariacao([
      variante("Azul", 1, { name: "Cor", priceOverride: 99 }),
      variante("M", 3, { name: "Tamanho" }),
    ]);
    expect(m.eixos.map((e) => e.nome)).toEqual(["Tamanho", "Cor"]);
    expect(m.grupos.map((g) => g.nome)).toEqual(["Cor", "Tamanho"]);
    const s = new Map(
      m.eixos.map((e) => [e.chave, e.nome === "Cor" ? "Azul" : "M"]),
    );
    expect([...resolverSelecaoDosEixos(m, s)]).toEqual([
      ["Cor", "Azul"],
      ["Tamanho", "M"],
    ]);
  });

  it("contagem inválida em QUALQUER linha conserva o grupo inteiro bruto", () => {
    const m = criarEixosDaVariacao([
      ...variantes,
      variante("Cinza / Preto / M"),
    ]);
    expect(m.eixos.map((e) => e.nome)).toEqual(["Cor / Tamanho"]);
    const s = new Map([[m.eixos[0]!.chave, "Cinza / Preto / M"]]);
    expect([...resolverSelecaoDosEixos(m, s)]).toEqual([
      ["Cor / Tamanho", "Cinza / Preto / M"],
    ]);
  });

  it("três eixos só resolvem depois da terceira escolha", () => {
    const m = criarEixosDaVariacao([
      variante("Azul / M / Longa", 4, { name: "Cor / Tamanho / Manga" }),
    ]);
    const s = new Map(
      m.eixos.map((e) => [e.chave, ["Azul", "M", "Longa"].at(e.indice)!]),
    );
    expect([
      ...resolverSelecaoDosEixos(m, new Map([...s].slice(0, 2))),
    ]).toEqual([]);
    expect(m.eixos.map((e) => e.nome)).toEqual(["Tamanho", "Cor", "Manga"]);
    expect([...resolverSelecaoDosEixos(m, s)]).toEqual([
      ["Cor / Tamanho / Manga", "Azul / M / Longa"],
    ]);
  });

  it("pré-escolhe só Cor com estoque, nem eixo único de voltagem/tamanho/sabor", () => {
    for (const nome of [
      "Cor",
      "cores",
      "color",
      "Estampa",
      "Tamanho",
      "Voltagem",
      "Sabor",
      "Numeração",
    ]) {
      const m = criarEixosDaVariacao([variante("único", 1, { name: nome })]);
      expect([...preselecionarCor(m, new Map()).values()]).toEqual(
        /^(cor|cores|color|estampa)$/i.test(nome) ? ["único"] : [],
      );
    }
    const m = criarEixosDaVariacao([
      variante("Verde / M", 0),
      variante("Azul / M", 2),
    ]);
    // Com Tamanho na frente a pagina nao pre-marca nada; o card tambem nao.
    expect([...preselecionarCor(m, new Map()).values()]).toEqual([]);
    const semTamanho = criarEixosDaVariacao([
      variante("Verde / Algodão", 0, { name: "Cor / Material" }),
      variante("Azul / Algodão", 2, { name: "Cor / Material" }),
    ]);
    expect([...preselecionarCor(semTamanho, new Map()).values()]).toEqual([
      "Azul",
    ]);
  });

  it("opção única com estoque entra marcada em qualquer eixo; entre duas ou mais, nenhuma", () => {
    for (const nome of ["Cor", "Tamanho", "Voltagem", "Sabor", "Numeração"]) {
      const m = criarEixosDaVariacao([variante("único", 1, { name: nome })]);
      expect([...preselecionarOpcaoUnica(m, new Map()).values()]).toEqual([
        "único",
      ]);
      const dois = criarEixosDaVariacao([
        variante("a", 1, { name: nome }),
        variante("b", 1, { name: nome }),
      ]);
      expect([...preselecionarOpcaoUnica(dois, new Map()).values()]).toEqual(
        [],
      );
    }
  });

  it("opção única esgotada não é marcada; a com estoque do outro eixo é", () => {
    const esgotada = criarEixosDaVariacao([
      variante("M", 0, { name: "Tamanho" }),
    ]);
    expect(preselecionarOpcaoUnica(esgotada, new Map()).size).toBe(0);
    // Tamanho único (M) com cores 0/2 em estoque: M tem estoque numa delas.
    const m = criarEixosDaVariacao([
      variante("Verde / M", 0),
      variante("Azul / M", 2),
    ]);
    expect([...preselecionarOpcaoUnica(m, new Map()).values()]).toEqual(["M"]);
    // Único com todas as combinações zeradas: nada marcado.
    const zerado = criarEixosDaVariacao([
      variante("Verde / M", 0),
      variante("Azul / M", 0),
    ]);
    expect(preselecionarOpcaoUnica(zerado, new Map()).size).toBe(0);
  });

  it("opção única respeita escolha anterior, não a muda e não é mutada; só entra se combina com o escolhido", () => {
    const m = criarEixosDaVariacao([
      variante("Azul / PP", 5),
      variante("Azul / M", 3),
    ]);
    const cor = eixoDe(m, "Cor").chave;
    const tamanho = eixoDe(m, "Tamanho").chave;
    const antes = new Map([[tamanho, "M"]]);
    const depois = preselecionarOpcaoUnica(m, antes);
    expect([...antes]).toEqual([[tamanho, "M"]]);
    expect(depois.get(tamanho)).toBe("M");
    expect(depois.get(cor)).toBe("Azul");
    // Cor única, mas sem estoque no M já escolhido: com ele ela não entra.
    const semM = criarEixosDaVariacao([
      variante("Azul / PP", 5),
      variante("Azul / M", 0),
    ]);
    const ponto = new Map([[eixoDe(semM, "Tamanho").chave, "M"]]);
    expect(preselecionarOpcaoUnica(semM, ponto)).toEqual(ponto);
  });

  it("opção única em grupos legados: cada grupo com um valor só marca, e resolve a mesma linha do toque", () => {
    const m = criarEixosDaVariacao([
      variante("Azul", 4, { name: "Cor" }),
      variante("M", 3, { name: "Tamanho", priceOverride: 65 }),
    ]);
    const s = preselecionarOpcaoUnica(m, new Map());
    expect(s.size).toBe(2);
    expect([...resolverSelecaoDosEixos(m, s)]).toEqual([
      ["Cor", "Azul"],
      ["Tamanho", "M"],
    ]);
    // Um dos grupos com duas opções: só o único marca, a seleção não resolve.
    const meio = criarEixosDaVariacao([
      variante("Azul", 4, { name: "Cor" }),
      variante("M", 3, { name: "Tamanho" }),
      variante("G", 3, { name: "Tamanho" }),
    ]);
    const parcial = preselecionarOpcaoUnica(meio, new Map());
    expect([...parcial.values()]).toEqual(["Azul"]);
    expect([...resolverSelecaoDosEixos(meio, parcial)]).toEqual([]);
  });

  it("escolha anterior vence a pré-escolha e não é mutada", () => {
    const s = escolhas(["Verde", "M"]);
    expect(preselecionarCor(modelo(), s)).toEqual(s);
    expect([...s.values()]).toEqual(["Verde", "M"]);
  });

  it("só Cor não resolve seleção e não antecipa preço por variante", () => {
    expect([...resolverSelecaoDosEixos(modelo(), escolhas(["Azul"]))]).toEqual(
      [],
    );
  });

  it("distingue combinação que não existe, esgotada e última unidade", () => {
    const m = modelo();
    const tamanho = eixoDe(m, "Tamanho").chave;
    expect(
      disponibilidadeDoValor(m, escolhas(["Preto"]), tamanho, "M"),
    ).toMatchObject({ existe: false, disponivel: false, ultima: false });
    expect(
      disponibilidadeDoValor(m, escolhas(["Verde"]), tamanho, "PP"),
    ).toMatchObject({ existe: true, disponivel: false, ultima: false });
    expect(
      disponibilidadeDoValor(m, escolhas(["Verde"]), tamanho, "M"),
    ).toMatchObject({ existe: true, disponivel: true, ultima: true });
    expect(disponibilidadeDoValor(m, new Map(), tamanho, "M").ultima).toBe(
      false,
    );
    expect([...resolverSelecaoDosEixos(m, escolhas(["Preto", "M"]))]).toEqual(
      [],
    );
    expect([...resolverSelecaoDosEixos(m, escolhas(["Verde", "PP"]))]).toEqual(
      [],
    );
  });

  it("troca Cor mantendo tamanho válido ou desfazendo só o incompatível", () => {
    const m = modelo();
    const s = escolhas(["Azul", "M"]);
    expect([
      ...escolherValorDoEixo(m, s, eixoDe(m, "Cor").chave, "Verde").values(),
    ]).toEqual(["Verde", "M"]);
    expect([
      ...escolherValorDoEixo(m, s, eixoDe(m, "Cor").chave, "Preto").values(),
    ]).toEqual(["Preto"]);
    expect([...s.values()]).toEqual(["Azul", "M"]);
  });

  it("dois grupos legados ficam brutos, sem cruzar estoques de grupos independentes", () => {
    const m = criarEixosDaVariacao([
      variante("Azul / M", 3),
      variante("220V", 2, { name: "Voltagem" }),
    ]);
    // Voltagem vem antes na tela (como na página); o cru "Cor / Tamanho" é
    // "Outro" para a régua. Os grupos seguem a gravação.
    expect(m.eixos.map((e) => e.nome)).toEqual(["Voltagem", "Cor / Tamanho"]);
    expect(m.grupos.map((g) => g.nome)).toEqual(["Cor / Tamanho", "Voltagem"]);
    const s = new Map(
      m.eixos.map((e) => [
        e.chave,
        e.nome === "Voltagem" ? "220V" : "Azul / M",
      ]),
    );
    expect([...resolverSelecaoDosEixos(m, s)]).toEqual([
      ["Cor / Tamanho", "Azul / M"],
      ["Voltagem", "220V"],
    ]);
  });

  it("seleção parcial em grupos legados também não antecipa preço ou estoque", () => {
    const m = criarEixosDaVariacao([
      variante("M", 3, { name: "Tamanho" }),
      variante("Azul", 1, { name: "Cor", priceOverride: 99 }),
    ]);
    const s = preselecionarCor(m, new Map());
    expect([...resolverSelecaoDosEixos(m, s)]).toEqual([]);
  });

  it("revalida estoque sem escolher outro tamanho e preserva ordem do mapa legado", () => {
    const m = criarEixosDaVariacao(
      variantes.map((v) =>
        v.value === "Azul / M" ? { ...v, stockIncrement: 0 } : v,
      ),
    );
    expect([
      ...escolherValorDoEixo(m, escolhas(["Azul", "M"])).values(),
    ]).toEqual(["M"]); // a ordem da tela (Tamanho primeiro) decide quem fica
    const legado = criarEixosDaVariacao([
      variante("Azul", 3, { name: "Cor" }),
      variante("M", 2, { name: "Tamanho" }),
    ]);
    const s = new Map(
      legado.eixos.map((e) => [e.chave, e.nome === "Cor" ? "Azul" : "M"]),
    );
    const anterior = new Map([
      ["Tamanho", "M"],
      ["Cor", "Azul"],
    ]);
    expect([...resolverSelecaoDosEixos(legado, s, anterior)]).toEqual([
      ...anterior,
    ]);
  });

  it.each(variantes.filter((v) => v.stockIncrement > 0))(
    "a seleção nova devolve exatamente a mesma linha antiga: $value (inclusive preço zero)",
    (v) => {
      const m = modelo();
      const s = new Map(
        m.eixos.map((e) => [e.chave, v.value.split(" / ").at(e.indice)!]),
      );
      // O caminho antigo recebia diretamente a escolha do chip da combinação.
      const antiga = new Map([[v.name, v.value]]);
      const nova = resolverSelecaoDosEixos(m, s);
      expect([...nova]).toEqual([...antiga]);
      const item = (selecao: Map<string, string>) => {
        const objs = [...selecao].map(
          ([n, valor]) =>
            variantes.find((x) => x.name === n && x.value === valor)!,
        );
        return {
          variantId: objs[0]?.id,
          variantNames: [...selecao]
            .map(([n, valor]) => `${n}: ${valor}`)
            .join(", "),
          price: objs.reduce((p, x) => x.priceOverride ?? p, 50),
          quantity: Math.min(2, ...objs.map((x) => x.stockIncrement)),
        };
      };
      expect(item(nova)).toEqual(item(antiga));
      expect(item(nova).variantNames).toBe(`Cor / Tamanho: ${v.value}`);
    },
  );
});

describe("card da vitrine e página do produto resolvem a MESMA linha", () => {
  // Tamanho x Cor com buracos: Azul/M sem estoque, Preto/PP existe, Verde/PP
  // esgotado, Preto/M não existe.
  it.each(
    ["PP", "M"].flatMap((t) => ["Azul", "Verde", "Preto"].map((c) => [t, c])),
  )("%s + %s: mesma linha (ou nenhuma) nos dois caminhos", (tamanho, cor) => {
    const m = modelo();
    const doCard = resolverSelecaoDosEixos(
      m,
      new Map([
        [eixoDe(m, "Tamanho").chave, tamanho],
        [eixoDe(m, "Cor").chave, cor],
      ]),
    );
    const daPagina = fileirasDeVariacao(variantes, {
      Tamanho: tamanho,
      Cor: cor,
    }).variante;
    if (!daPagina) {
      expect([...doCard]).toEqual([]);
      return;
    }
    expect([...doCard]).toEqual([[daPagina.name, daPagina.value]]);
    expect(
      variantes.find(
        (x) =>
          x.name === daPagina.name && x.value === doCard.get(daPagina.name),
      ),
    ).toBe(daPagina);
  });

  it("a ordem dos eixos do card é a das fileiras da página", () => {
    expect(modelo().eixos.map((e) => e.nome)).toEqual(
      fileirasDeVariacao(variantes).fileiras.map((f) => f.nome),
    );
  });
});

// Escolha PARCIAL: o preço anunciado só pode ser de uma combinação que ainda
// cabe no que a cliente já marcou. Produto "De 100": todas as cores do M a 50,
// todas as do P a 90. Com o P marcado e a cor pendente, anunciar 50 (menor do
// produto inteiro) é preço que nenhuma combinação P tem.
describe("variantesCompativeis — o que ainda cabe na escolha parcial", () => {
  const grade = [
    variante("Azul / M", 3, { priceOverride: 50 }),
    variante("Verde / M", 3, { priceOverride: 50 }),
    variante("Azul / P", 3, { priceOverride: 90 }),
    variante("Verde / P", 3, { priceOverride: 90 }),
  ];
  const m = criarEixosDaVariacao(grade);
  const chave = (nome: string) => eixoDe(m, nome).chave;
  const anunciado = (esc: Map<string, string>) =>
    precoDeVitrine({
      price: 100,
      originalPrice: 100,
      variants: variantesCompativeis(m, esc),
    });

  it("sem nenhuma escolha: todas as variações, o menor do produto (50)", () => {
    expect(variantesCompativeis(m, new Map())).toHaveLength(4);
    const v = anunciado(new Map());
    expect([v.preco, v.aPartirDe, v.desconto]).toEqual([50, true, 50]);
  });

  it("só o tamanho P marcado: 90, -10% e sem 'a partir de'", () => {
    const v = anunciado(new Map([[chave("Tamanho"), "P"]]));
    expect([v.preco, v.aPartirDe, v.desconto]).toEqual([90, false, 10]);
  });

  it("só o tamanho M marcado: continua 50 e -50%", () => {
    const v = anunciado(new Map([[chave("Tamanho"), "M"]]));
    expect([v.preco, v.aPartirDe, v.desconto]).toEqual([50, false, 50]);
  });

  it("só a cor marcada restringe pela cor (preços diferentes: a partir de)", () => {
    const v = anunciado(new Map([[chave("Cor"), "Azul"]]));
    expect([v.preco, v.aPartirDe]).toEqual([50, true]);
  });

  it("escolha completa: só a combinação marcada", () => {
    const esc = new Map([
      [chave("Tamanho"), "P"],
      [chave("Cor"), "Verde"],
    ]);
    expect(variantesCompativeis(m, esc).map((x) => x.value)).toEqual([
      "Verde / P",
    ]);
  });

  it("variação inativa não entra", () => {
    const comInativa = criarEixosDaVariacao([
      ...grade,
      variante("Rosa / P", 3, { priceOverride: 10, active: false }),
    ]);
    expect(variantesCompativeis(comInativa, new Map())).toHaveLength(4);
  });
});
