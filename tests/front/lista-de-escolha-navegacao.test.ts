import {
  porLetra,
  primeiraHabilitada,
  proximaHabilitada,
  ultimaHabilitada,
} from "@/components/admin/primitivos/lista-de-escolha/navegacao";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { describe, expect, it } from "vitest";

const CONTAS: OpcaoDaLista[] = [
  { valor: "sis", rotulo: "Sistema", desabilitada: true },
  { valor: "caixa", rotulo: "Caixa da loja" },
  { valor: "banco", rotulo: "Conta no banco" },
  { valor: "velha", rotulo: "Conta velha", desabilitada: true },
  { valor: "mp", rotulo: "Mercado Pago" },
  { valor: "fim", rotulo: "Cofre", desabilitada: true },
];

describe("proximaHabilitada", () => {
  it("anda para baixo pulando a desabilitada", () => {
    expect(proximaHabilitada(CONTAS, 2, 1)).toBe(4);
  });

  it("anda para cima pulando a desabilitada", () => {
    expect(proximaHabilitada(CONTAS, 4, -1)).toBe(2);
  });

  it("não dá a volta: na última habilitada, ↓ fica onde está", () => {
    expect(proximaHabilitada(CONTAS, 4, 1)).toBe(4);
  });

  it("não dá a volta: na primeira habilitada, ↑ fica onde está", () => {
    expect(proximaHabilitada(CONTAS, 1, -1)).toBe(1);
  });

  it("sem ativa (-1), ↓ vai para a primeira habilitada e ↑ para a última", () => {
    expect(proximaHabilitada(CONTAS, -1, 1)).toBe(1);
    expect(proximaHabilitada(CONTAS, -1, -1)).toBe(4);
  });

  it("lista vazia ou toda desabilitada devolve -1", () => {
    expect(proximaHabilitada([], -1, 1)).toBe(-1);
    expect(
      proximaHabilitada(
        [{ valor: "a", rotulo: "A", desabilitada: true }],
        -1,
        1,
      ),
    ).toBe(-1);
  });
});

describe("primeira e última habilitadas", () => {
  it("pulam as desabilitadas das pontas", () => {
    expect(primeiraHabilitada(CONTAS)).toBe(1);
    expect(ultimaHabilitada(CONTAS)).toBe(4);
  });

  it("-1 quando não há nenhuma", () => {
    expect(primeiraHabilitada([])).toBe(-1);
    expect(ultimaHabilitada([])).toBe(-1);
  });
});

describe("porLetra", () => {
  it("pula para a próxima habilitada que começa com a letra, ignorando caixa", () => {
    expect(porLetra(CONTAS, "c", -1)).toBe(1);
    expect(porLetra(CONTAS, "C", 1)).toBe(2);
  });

  it("a mesma letra de novo dá a volta entre as que começam com ela, sem cair na desabilitada", () => {
    expect(porLetra(CONTAS, "c", 2)).toBe(1);
  });

  it("ignora acento e pula desabilitada", () => {
    const lista: OpcaoDaLista[] = [
      { valor: "a", rotulo: "Ágata", desabilitada: true },
      { valor: "b", rotulo: "Amora" },
    ];
    expect(porLetra(lista, "a", -1)).toBe(1);
  });

  it("letra sem opção mantém onde estava", () => {
    expect(porLetra(CONTAS, "z", 2)).toBe(2);
  });
});
