import {
  buscaLigada,
  filtrarOpcoes,
  partesDoTrecho,
} from "@/components/admin/primitivos/lista-de-escolha/busca";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { describe, expect, it } from "vitest";

const ESTADOS: OpcaoDaLista[] = [
  { valor: "PI", rotulo: "Piauí", sigla: "PI" },
  { valor: "RJ", rotulo: "Rio de Janeiro", sigla: "RJ" },
  { valor: "RN", rotulo: "Rio Grande do Norte", sigla: "RN" },
  { valor: "RS", rotulo: "Rio Grande do Sul", sigla: "RS" },
  { valor: "RO", rotulo: "Rondônia", sigla: "RO" },
  { valor: "SP", rotulo: "São Paulo", sigla: "SP", termos: "sampa" },
];

const rotulos = (lista: readonly OpcaoDaLista[]) => lista.map((o) => o.rotulo);

describe("filtrarOpcoes", () => {
  it("termo vazio (ou só espaço) devolve todas, na mesma ordem", () => {
    expect(filtrarOpcoes(ESTADOS, "")).toEqual(ESTADOS);
    expect(filtrarOpcoes(ESTADOS, "   ")).toEqual(ESTADOS);
  });

  it('"rio" acha os três Rios', () => {
    expect(rotulos(filtrarOpcoes(ESTADOS, "rio"))).toEqual([
      "Rio de Janeiro",
      "Rio Grande do Norte",
      "Rio Grande do Sul",
    ]);
  });

  it("ignora acento e caixa nos dois lados", () => {
    expect(rotulos(filtrarOpcoes(ESTADOS, "PIAUI"))).toEqual(["Piauí"]);
    expect(rotulos(filtrarOpcoes(ESTADOS, "rondonia"))).toEqual(["Rondônia"]);
    expect(rotulos(filtrarOpcoes(ESTADOS, "são"))).toEqual(["São Paulo"]);
    expect(rotulos(filtrarOpcoes(ESTADOS, "SAO"))).toEqual(["São Paulo"]);
  });

  it("acha pela sigla e pelos termos escondidos", () => {
    expect(rotulos(filtrarOpcoes(ESTADOS, "rs"))).toEqual([
      "Rio Grande do Sul",
    ]);
    expect(rotulos(filtrarOpcoes(ESTADOS, "sampa"))).toEqual(["São Paulo"]);
  });

  it("nada encontrado devolve lista vazia", () => {
    expect(filtrarOpcoes(ESTADOS, "xyz")).toEqual([]);
  });
});

describe("partesDoTrecho", () => {
  it("sem termo, o texto inteiro sem destaque", () => {
    expect(partesDoTrecho("Rio de Janeiro", "")).toEqual([
      { texto: "Rio de Janeiro", achado: false },
    ]);
  });

  it("destaca o trecho achado no texto ORIGINAL", () => {
    expect(partesDoTrecho("Rio Grande do Sul", "rio")).toEqual([
      { texto: "Rio", achado: true },
      { texto: " Grande do Sul", achado: false },
    ]);
  });

  it("com acento, o índice cai no lugar certo do texto original", () => {
    expect(partesDoTrecho("São Paulo", "sao")).toEqual([
      { texto: "São", achado: true },
      { texto: " Paulo", achado: false },
    ]);
    expect(partesDoTrecho("Rondônia", "doni")).toEqual([
      { texto: "Ron", achado: false },
      { texto: "dôni", achado: true },
      { texto: "a", achado: false },
    ]);
  });

  it("acento composto em dois códigos (NFD na fonte) não desloca o destaque", () => {
    const decomposto = "Piau\u0301 grande"; // "Piaú grande" com o acento separado
    expect(partesDoTrecho(decomposto, "piau")).toEqual([
      { texto: "Piau\u0301", achado: true },
      { texto: " grande", achado: false },
    ]);
  });

  it("termo que não está no rótulo (achado pela sigla) não destaca nada", () => {
    expect(partesDoTrecho("Rio Grande do Sul", "rs")).toEqual([
      { texto: "Rio Grande do Sul", achado: false },
    ]);
  });
});

describe("buscaLigada", () => {
  const opcoes = (n: number): OpcaoDaLista[] =>
    Array.from({ length: n }, (_, i) => ({
      valor: String(i),
      rotulo: `${i}x`,
    }));

  it("liga com 10 opções e não com 9", () => {
    expect(buscaLigada(opcoes(9))).toBe(false);
    expect(buscaLigada(opcoes(10))).toBe(true);
  });

  it("respeita o pedido explícito da tela", () => {
    expect(buscaLigada(opcoes(48), false)).toBe(false);
    expect(buscaLigada(opcoes(3), true)).toBe(true);
  });
});
