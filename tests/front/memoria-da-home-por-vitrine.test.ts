// @vitest-environment jsdom
import {
  gravarMemoriaDaHome,
  lerMemoriaDaHome,
} from "@/hooks/useMemoriaDaHome";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let dados: Map<string, string>;
const base = { temBanner: false, temOfertas: true, temBestsellers: false };
beforeEach(() => {
  dados = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => dados.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("volta a ler layout e quantidade sem misturar ids", () => {
  gravarMemoriaDaHome({
    ...base,
    vitrines: {
      new_arrivals: { layout: "lateral", qtd: 1 },
      curada: { layout: "lateral-duplo", qtd: 2 },
    },
  });
  expect(lerMemoriaDaHome()?.vitrines).toEqual({
    new_arrivals: { layout: "lateral", qtd: 1 },
    curada: { layout: "lateral-duplo", qtd: 2 },
  });
});

it("valor inválido de layout vira padrão, quantidade inválida fica sem informação", () => {
  dados.set(
    "ikcous_home_memoria",
    JSON.stringify({
      ...base,
      gravadoEm: Date.now(),
      vitrines: {
        new_arrivals: { layout: "futuro", qtd: -1 },
        curada: { layout: null, qtd: 1.5 },
        offers: { layout: "lateral-duplo", qtd: 0 },
        lixo: null,
      },
    }),
  );
  expect(lerMemoriaDaHome()?.vitrines).toEqual({
    new_arrivals: { layout: "padrao", qtd: undefined },
    curada: { layout: "padrao", qtd: undefined },
    offers: { layout: "lateral-duplo", qtd: 0 },
  });
});

it.each([null, [], "lixo"].map((vitrines) => ({ vitrines })))(
  "mapa de vitrines inválido $vitrines não invalida a memória antiga",
  ({ vitrines }) => {
    dados.set(
      "ikcous_home_memoria",
      JSON.stringify({
        ...base,
        gravadoEm: Date.now(),
        layoutOfertas: "compacto",
        qtdOfertas: 1,
        vitrines,
      }),
    );
    expect(lerMemoriaDaHome()).toMatchObject({
      ...base,
      layoutOfertas: "compacto",
      qtdOfertas: 1,
    });
    expect(lerMemoriaDaHome()?.vitrines).toBeUndefined();
  },
);

it("memória antiga continua válida sem inventar vitrines", () => {
  gravarMemoriaDaHome({
    ...base,
    layoutOfertas: "lateral-duplo",
    qtdOfertas: 1,
  });
  expect(lerMemoriaDaHome()).toMatchObject({
    ...base,
    layoutOfertas: "lateral-duplo",
    qtdOfertas: 1,
  });
  expect(lerMemoriaDaHome()?.vitrines).toBeUndefined();
});
