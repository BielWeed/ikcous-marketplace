import {
  comOEstoqueDaVariacao,
  soMudouOEstoqueDaVariacao,
} from "@/utils/peca-somada-no-formulario";
import { describe, expect, it } from "vitest";

// A tela do produto depois de somar a peca sem tamanho (20261642000000): so
// adota a versao nova do banco quando a UNICA mudanca e' o estoque do tamanho
// que recebeu a peca. Ids e nomes inventados.
const m = {
  id: "v-m",
  name: "Tamanho",
  value: "M",
  active: true,
  stockIncrement: 3,
};
const g = {
  id: "v-g",
  name: "Tamanho",
  value: "G",
  active: true,
  stockIncrement: 2,
};
const base = { name: "Blusa", price: "50", stock: "5", variants: [m, g] };

describe("soMudouOEstoqueDaVariacao", () => {
  it("so o estoque do M (e a soma) mudou: adota", () => {
    const banco = {
      ...base,
      stock: "6",
      variants: [{ ...m, stockIncrement: 4 }, g],
    };
    expect(soMudouOEstoqueDaVariacao(base, banco, "v-m")).toBe(true);
  });

  it("o estoque de OUTRO tamanho tambem mudou (venda no meio): nao adota", () => {
    const banco = {
      ...base,
      stock: "5",
      variants: [
        { ...m, stockIncrement: 4 },
        { ...g, stockIncrement: 1 },
      ],
    };
    expect(soMudouOEstoqueDaVariacao(base, banco, "v-m")).toBe(false);
  });

  it("outro campo do produto mudou: nao adota", () => {
    const banco = {
      ...base,
      price: "60",
      variants: [{ ...m, stockIncrement: 4 }, g],
    };
    expect(soMudouOEstoqueDaVariacao(base, banco, "v-m")).toBe(false);
  });

  it("o tamanho foi desligado ou criado outro no meio: nao adota", () => {
    expect(
      soMudouOEstoqueDaVariacao(
        base,
        { ...base, variants: [{ ...m, stockIncrement: 4, active: false }, g] },
        "v-m",
      ),
    ).toBe(false);
    expect(
      soMudouOEstoqueDaVariacao(
        base,
        {
          ...base,
          variants: [
            { ...m, stockIncrement: 4 },
            g,
            { ...g, id: "v-p", value: "P" },
          ],
        },
        "v-m",
      ),
    ).toBe(false);
  });

  it("o tamanho nao esta na base ou sumiu do banco: nao adota", () => {
    expect(
      soMudouOEstoqueDaVariacao(base, { ...base, variants: [g] }, "v-m"),
    ).toBe(false);
    expect(soMudouOEstoqueDaVariacao(base, base, "v-x")).toBe(false);
  });
});

describe("comOEstoqueDaVariacao", () => {
  it("troca so o estoque do M e recalcula a soma; o resto fica", () => {
    const tela = {
      ...base,
      name: "Blusa azul",
      variants: [m, { ...g, stockIncrement: 7 }],
    };
    const r = comOEstoqueDaVariacao(tela, "v-m", 4);
    expect(r.name).toBe("Blusa azul");
    expect(r.variants).toEqual([
      { ...m, stockIncrement: 4 },
      { ...g, stockIncrement: 7 },
    ]);
    expect(r.stock).toBe("11");
  });

  it("tamanho fora da lista (excluido na tela): devolve o MESMO objeto", () => {
    const tela = { ...base, variants: [g] };
    expect(comOEstoqueDaVariacao(tela, "v-m", 4)).toBe(tela);
  });
});
