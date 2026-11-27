// @vitest-environment jsdom
// Memória do pedido de fechamento do caixa (`lembrarPedidoDeFechamento` e
// `pediuEsteFechamentoHaPouco`, em `tentativasDoCaixa.ts`): a folha que perdeu
// a resposta do fechamento reconhece o `replay` do banco como o pedido DELA.
//
// As chaves da sangria/suprimento já têm teste direto; esta metade do arquivo
// só era exercida por dentro das telas do caixa. Aqui ficam fixadas:
//  - a entrada com mais de 10 minutos some quando outra é gravada (a lista na
//    aba não cresce para sempre, e o replay de tela velha não vira "foi você");
//  - JSON quebrado ou uma LISTA no armazenamento não derrubam nada: a leitura
//    responde `false` e a gravação seguinte recomeça do vazio;
//  - um horário no futuro (relógio voltou) não vale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lembrarPedidoDeFechamento,
  pediuEsteFechamentoHaPouco,
} from "@/components/admin/financeiro/tentativasDoCaixa";

const CHAVE = "ikcous_fin_caixa_pedidos_de_fechamento";
const MINUTO = 60_000;
const INICIO = new Date("2026-11-27T15:00:00.000Z");

const guardado = (): Record<string, unknown> =>
  JSON.parse(sessionStorage.getItem(CHAVE) ?? "{}");
const endereco = (autor: string, sessao: string, contado: number) =>
  JSON.stringify([autor, sessao, Math.round(contado * 100)]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INICIO);
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

describe("pedido de fechamento: prazo de 10 minutos", () => {
  it("entrada com mais de 10 minutos some ao gravar uma nova; a de 10 minutos exatos fica", () => {
    lembrarPedidoDeFechamento("ana", "sess-velha", 100);
    vi.setSystemTime(INICIO.getTime() + 1);
    lembrarPedidoDeFechamento("ana", "sess-no-limite", 50);

    // 10 min + 1 ms depois da primeira; 10 min exatos depois da segunda.
    vi.setSystemTime(INICIO.getTime() + 10 * MINUTO + 1);
    lembrarPedidoDeFechamento("ana", "sess-nova", 80);

    expect(Object.keys(guardado()).sort()).toEqual(
      [
        endereco("ana", "sess-no-limite", 50),
        endereco("ana", "sess-nova", 80),
      ].sort(),
    );
    expect(pediuEsteFechamentoHaPouco("ana", "sess-velha", 100)).toBe(false);
    expect(pediuEsteFechamentoHaPouco("ana", "sess-no-limite", 50)).toBe(true);
    expect(pediuEsteFechamentoHaPouco("ana", "sess-nova", 80)).toBe(true);
  });

  it("o mesmo pedido vale até o minuto 10 e deixa de valer 1 ms depois", () => {
    lembrarPedidoDeFechamento("ana", "sess-1", 123.45);
    vi.setSystemTime(INICIO.getTime() + 10 * MINUTO);
    expect(pediuEsteFechamentoHaPouco("ana", "sess-1", 123.45)).toBe(true);
    vi.setSystemTime(INICIO.getTime() + 10 * MINUTO + 1);
    expect(pediuEsteFechamentoHaPouco("ana", "sess-1", 123.45)).toBe(false);
  });
});

describe("pedido de fechamento: armazenamento com conteúdo estranho", () => {
  it.each([
    ["JSON inválido", "{isto não é json"],
    [
      "uma lista no lugar do objeto",
      JSON.stringify([endereco("ana", "sess-1", 100)]),
    ],
    ["um número solto", "42"],
  ])("%s: a leitura responde false sem quebrar", (_nome, bruto) => {
    sessionStorage.setItem(CHAVE, bruto);
    expect(() =>
      pediuEsteFechamentoHaPouco("ana", "sess-1", 100),
    ).not.toThrow();
    expect(pediuEsteFechamentoHaPouco("ana", "sess-1", 100)).toBe(false);
  });

  it.each([
    ["JSON inválido", "{isto não é json"],
    ["uma lista no lugar do objeto", JSON.stringify(["lixo", 1, 2])],
  ])(
    "%s: gravar um pedido recomeça do vazio e o pedido novo vale",
    (_nome, bruto) => {
      sessionStorage.setItem(CHAVE, bruto);
      expect(() =>
        lembrarPedidoDeFechamento("ana", "sess-1", 100),
      ).not.toThrow();
      expect(guardado()).toEqual({
        [endereco("ana", "sess-1", 100)]: INICIO.getTime(),
      });
      expect(pediuEsteFechamentoHaPouco("ana", "sess-1", 100)).toBe(true);
    },
  );

  it("horário que não é número não vale", () => {
    sessionStorage.setItem(
      CHAVE,
      JSON.stringify({
        [endereco("ana", "sess-1", 100)]: "2026-11-27T15:00:00Z",
      }),
    );
    expect(pediuEsteFechamentoHaPouco("ana", "sess-1", 100)).toBe(false);
  });
});

describe("pedido de fechamento: data no futuro", () => {
  it("um horário gravado no futuro não vale (relógio que voltou não ressuscita pedido)", () => {
    sessionStorage.setItem(
      CHAVE,
      JSON.stringify({
        [endereco("ana", "sess-1", 100)]: INICIO.getTime() + 1,
      }),
    );
    expect(pediuEsteFechamentoHaPouco("ana", "sess-1", 100)).toBe(false);
  });

  it("o pedido gravado no futuro também some ao gravar um novo", () => {
    sessionStorage.setItem(
      CHAVE,
      JSON.stringify({
        [endereco("ana", "sess-1", 100)]: INICIO.getTime() + MINUTO,
      }),
    );
    lembrarPedidoDeFechamento("ana", "sess-2", 70);
    expect(Object.keys(guardado())).toEqual([endereco("ana", "sess-2", 70)]);
  });
});
