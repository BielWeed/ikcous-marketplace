import type { ProductVariant } from "@/types";
import {
  criarEixosDaVariacao,
  disponibilidadeDoValor,
  escolherValorDoEixo,
  preselecionarCor,
  resolverSelecaoDosEixos,
} from "@/utils/eixos-da-variacao";
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
const escolhas = (valores: string[]) =>
  new Map(valores.map((v, i) => [modelo().eixos.at(i)!.chave, v]));

describe("eixos da variação — tradução sem mudar a linha entregue", () => {
  it("produto sem variante não inventa eixo nem seleção", () => {
    const m = criarEixosDaVariacao([]);
    expect(m.eixos).toEqual([]);
    expect([...resolverSelecaoDosEixos(m, new Map())]).toEqual([]);
  });

  it("separa dois eixos com valores únicos na ordem cadastrada; ignora inativos", () => {
    const m = criarEixosDaVariacao([
      ...variantes,
      variante("Rosa / GG", 10, { active: false }),
    ]);
    expect(m.eixos.map((e) => [e.nome, e.valores])).toEqual([
      ["Cor", ["Azul", "Verde", "Preto"]],
      ["Tamanho", ["PP", "M"]],
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
      m.eixos.map((e, i) => [e.chave, ["Azul", "M", "Longa"].at(i)!]),
    );
    expect([
      ...resolverSelecaoDosEixos(m, new Map([...s].slice(0, 2))),
    ]).toEqual([]);
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
    expect([...preselecionarCor(m, new Map()).values()]).toEqual(["Azul"]);
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
    const tamanho = m.eixos[1]!.chave;
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
      ...escolherValorDoEixo(m, s, m.eixos[0]!.chave, "Verde").values(),
    ]).toEqual(["Verde", "M"]);
    expect([
      ...escolherValorDoEixo(m, s, m.eixos[0]!.chave, "Preto").values(),
    ]).toEqual(["Preto"]);
    expect([...s.values()]).toEqual(["Azul", "M"]);
  });

  it("dois grupos legados ficam brutos, sem cruzar estoques de grupos independentes", () => {
    const m = criarEixosDaVariacao([
      variante("Azul / M", 3),
      variante("220V", 2, { name: "Voltagem" }),
    ]);
    expect(m.eixos.map((e) => e.nome)).toEqual(["Cor / Tamanho", "Voltagem"]);
    const s = new Map(
      m.eixos.map((e, i) => [e.chave, ["Azul / M", "220V"].at(i)!]),
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
    ]).toEqual(["Azul"]);
    const legado = criarEixosDaVariacao([
      variante("Azul", 3, { name: "Cor" }),
      variante("M", 2, { name: "Tamanho" }),
    ]);
    const s = new Map(
      legado.eixos.map((e, i) => [e.chave, ["Azul", "M"].at(i)!]),
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
        m.eixos.map((e, i) => [e.chave, v.value.split(" / ").at(i)!]),
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
