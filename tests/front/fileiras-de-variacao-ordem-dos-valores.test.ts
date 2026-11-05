import type { ProductVariant } from "@/types";
import { fileirasDeVariacao } from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

// O catálogo lê `product_variants(*)` sem ORDER BY: depois de uma venda a linha
// atualizada pode ir para o fim. A ordem dos chips (PP, P, M, G...) não pode
// depender de quem o banco devolve primeiro.

const linha = (
  id: string,
  value: string,
  name = "Tamanho",
  stockIncrement = 2,
): ProductVariant => ({
  id,
  productId: "produto",
  name,
  value,
  stockIncrement,
  active: true,
});

/** Todas as ordens possíveis das linhas de entrada. */
function permutacoes<T>(itens: T[]): T[][] {
  if (itens.length <= 1) return [itens];
  return itens.flatMap((item, i) =>
    permutacoes([...itens.slice(0, i), ...itens.slice(i + 1)]).map((resto) => [
      item,
      ...resto,
    ]),
  );
}

const valoresDe = (variantes: ProductVariant[], fileira = 0) =>
  fileirasDeVariacao(variantes)
    .fileiras.at(fileira)
    ?.valores.map((v) => v.valor);

describe("ordem dos valores dentro de cada fileira", () => {
  it("tamanhos seguem a escada PP, P, M, G, GG, XG e Único fica por último, em qualquer ordem de entrada", () => {
    const esperado = ["PP", "P", "M", "G", "GG", "XG", "Único"];
    const linhas = esperado.map((v, i) => linha(`t${i}`, v));
    // 7 linhas = 5040 ordens de entrada, todas.
    const ordens = permutacoes(linhas);
    for (const ordem of ordens) expect(valoresDe(ordem)).toEqual(esperado);
  });

  it("a escada não depende de maiúscula nem de acento", () => {
    const ordem = valoresDe([
      linha("a", "unico"),
      linha("b", "gg"),
      linha("c", "pp"),
      linha("d", "m"),
    ]);
    expect(ordem).toEqual(["pp", "m", "gg", "unico"]);
  });

  it("números saem por valor, não por texto (110 depois de 40) e antes do que não é número", () => {
    const esperado = ["34", "36", "40", "110V", "220V"];
    for (const ordem of permutacoes(
      esperado.map((v, i) => linha(`n${i}`, v)),
    )) {
      expect(valoresDe(ordem)).toEqual(esperado);
    }
    expect(
      valoresDe([linha("x", "Azul"), linha("y", "40"), linha("z", "36")]),
    ).toEqual(["36", "40", "Azul"]);
  });

  it("o resto sai em ordem alfabética de português, com acento no lugar certo", () => {
    const esperado = ["Âmbar", "Azul", "Branco", "Cinza", "Preto", "Verde"];
    for (const ordem of permutacoes(
      esperado.map((v, i) => linha(`c${i}`, v, "Cor")),
    )) {
      expect(valoresDe(ordem)).toEqual(esperado);
    }
  });

  it("grade composta (Cor / Tamanho) devolve as mesmas fileiras, valor e estoque, seja qual for a ordem das linhas", () => {
    const tamanhos = ["P", "M", "G"];
    const cores = ["Preto", "Azul"];
    const linhas = tamanhos.flatMap((t) =>
      cores.map((c, i) =>
        linha(`${c}-${t}`, `${c} / ${t}`, "Cor / Tamanho", i + 1),
      ),
    );
    const referencia = fileirasDeVariacao(linhas, { Tamanho: "M" });
    expect(referencia.fileiras.map((f) => f.nome)).toEqual(["Tamanho", "Cor"]);
    expect(referencia.fileiras[0].valores.map((v) => v.valor)).toEqual([
      "P",
      "M",
      "G",
    ]);
    expect(referencia.fileiras[1].valores.map((v) => v.valor)).toEqual([
      "Azul",
      "Preto",
    ]);
    // Embaralha de modo determinístico: reversa, rotações e intercalada.
    const embaralhadas = [
      [...linhas].reverse(),
      [...linhas.slice(2), ...linhas.slice(0, 2)],
      [...linhas.slice(4), ...linhas.slice(0, 4)].reverse(),
      linhas
        .filter((_, i) => i % 2 === 1)
        .concat(linhas.filter((_, i) => i % 2 === 0)),
    ];
    for (const ordem of embaralhadas) {
      expect(fileirasDeVariacao(ordem, { Tamanho: "M" }).fileiras).toEqual(
        referencia.fileiras,
      );
    }
  });
});
