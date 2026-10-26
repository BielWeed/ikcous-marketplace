import type { ProductVariant } from "@/types";
import {
  criarEixosDaVariacao,
  disponibilidadeDoValor,
  escolherValorDoEixo,
  preselecionarCor,
  resolverSelecaoDosEixos,
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
