import { ordenarParaVitrine } from "@/lib/vitrine";
// Item 15 do laudo "o que falta" (29/08, degrau 3): o preview do carrossel
// no painel ordenava só por data enquanto a loja põe sem-estoque no fim — a
// lojista montava a vitrine vendo uma ordem que a loja não mostrava.
//
// O conserto extrai a regra da loja para `ordenarParaVitrine`
// (src/lib/vitrine.ts) e preview e loja passam a chamar A MESMA função —
// mesma lição do #53 (frete grátis escrito em sete lugares): regra de
// negócio em um lugar.
import { describe, expect, it } from "vitest";

type Produto = { nome: string; stock: number | null; createdTime: number };

const p = (
  nome: string,
  stock: number | null,
  createdTime: number,
): Produto => ({
  nome,
  stock,
  createdTime,
});

describe("ordenarParaVitrine — a regra que a loja sempre usou", () => {
  it("sem estoque vai para o FIM, mesmo sendo mais recente", () => {
    // O caso do item 15: o preview mostrava o esgotado em cima por ser novo;
    // a loja escondia ele no fim. Agora os dois mostram o mesmo.
    const lista = [p("Esgotado novo", 0, 300), p("Disponível antigo", 5, 100)];
    const ordenada = ordenarParaVitrine(lista);
    expect(ordenada.map((x) => x.nome)).toEqual([
      "Disponível antigo",
      "Esgotado novo",
    ]);
  });

  it("dentro de cada grupo, mais recente primeiro", () => {
    const lista = [
      p("Disp. velho", 5, 100),
      p("Disp. novo", 3, 200),
      p("Esgotado velho", 0, 50),
      p("Esgotado novo", 0, 150),
    ];
    const ordenada = ordenarParaVitrine(lista);
    expect(ordenada.map((x) => x.nome)).toEqual([
      "Disp. novo",
      "Disp. velho",
      "Esgotado novo",
      "Esgotado velho",
    ]);
  });

  it("stock nulo conta como sem estoque (a loja nunca mostrou null > 0)", () => {
    const lista = [p("Stock nulo (legado)", null, 999), p("Disponível", 1, 1)];
    const ordenada = ordenarParaVitrine(lista);
    expect(ordenada[0].nome).toBe("Disponível");
  });

  it("createdTime ausente não quebra (vira 0, vai para o fim do grupo)", () => {
    const lista = [
      {
        nome: "Sem data",
        stock: 5,
        createdTime: undefined as unknown as number,
      },
      p("Com data", 5, 100),
    ];
    const ordenada = ordenarParaVitrine(lista);
    expect(ordenada[0].nome).toBe("Com data");
  });

  it("não muta a lista de entrada (o preview reusa o array do hook)", () => {
    const lista = [p("B", 0, 300), p("A", 5, 100)];
    const copia = [...lista];
    ordenarParaVitrine(lista);
    expect(lista).toEqual(copia);
  });
});
