// Fronteiras dos textos e números do CRM que nenhum teste segurava (achadas
// por mutação em 24/11/2026):
//  - os seis períodos do trilho (ordem e rótulo que a lojista toca);
//  - dinheiro compacto de valor negativo (prejuízo grande também encurta) e
//    com uma casa ("R$ 12,3 mil", não "R$ 12 mil");
//  - inteiro "—" quando não se sabe, e arredondado (nunca "1,5 pedidos");
//  - data ilegível vira "—" em vez de derrubar a tela;
//  - o dinheiro pequeno do bloco de cada grupo também encurta a partir de
//    R$ 10 mil (o bloco é estreito no celular);
//  - a frase do cartão "App × loja física": a fronteira exata do "quase
//    igual" (10 pontos) e o arredondamento do percentual citado.
import {
  PERIODOS_DO_CRM,
  formatarData,
  formatarInteiro,
  formatarMoedaCompacta,
  fraseLeituraDosCanais,
  textoDoValorDoBlocoDeSegmento,
} from "@/lib/crm";
import type { CanalDoCrm } from "@/types/crm";
import { describe, expect, it } from "vitest";

const semNbsp = (texto: string) => texto.replace(/\u00a0/g, " ");

describe("períodos do trilho do CRM", () => {
  it("seis períodos, na ordem e com o rótulo que a lojista toca", () => {
    expect(PERIODOS_DO_CRM.map((p) => [p.id, p.rotulo])).toEqual([
      ["hoje", "Hoje"],
      ["7d", "7 dias"],
      ["30d", "30 dias"],
      ["90d", "90 dias"],
      ["mes", "Mês"],
      ["ano", "Ano"],
    ]);
  });
});

describe("formatadores: bordas", () => {
  it("dinheiro compacto: negativo grande também encurta, e vem com uma casa", () => {
    expect(semNbsp(formatarMoedaCompacta(-15_000))).toBe("-R$ 15 mil");
    expect(semNbsp(formatarMoedaCompacta(-9_999))).toBe("-R$ 9.999,00");
    expect(semNbsp(formatarMoedaCompacta(12_345))).toBe("R$ 12,3 mil");
  });

  it("inteiro: '—' é não sei, zero medido aparece, fração arredonda", () => {
    expect(formatarInteiro(null)).toBe("—");
    expect(formatarInteiro(undefined)).toBe("—");
    expect(formatarInteiro(0)).toBe("0");
    expect(formatarInteiro(1.4)).toBe("1");
    expect(formatarInteiro(1234.6)).toBe("1.235");
  });

  it("data que não é data vira '—', nunca derruba a tela", () => {
    expect(formatarData("não é uma data")).toBe("—");
    expect(formatarData("")).toBe("—");
  });
});

describe("bloco do grupo de clientes: dinheiro compacto", () => {
  it("receita grande encurta ('R$ 12,3 mil'); em aberto leva o qualificador", () => {
    expect(semNbsp(textoDoValorDoBlocoDeSegmento("leais", 12_345) ?? "")).toBe(
      "R$ 12,3 mil",
    );
    expect(
      semNbsp(textoDoValorDoBlocoDeSegmento("pediu_nao_pagou", 12_345) ?? ""),
    ).toBe("R$ 12,3 mil em aberto");
  });
});

describe("fraseLeituraDosCanais: fronteiras", () => {
  const canal = (nome: string, receita: number): CanalDoCrm => ({
    canal: nome,
    receita,
    pedidos: 1,
    ticketMedio: receita,
  });
  const frase = (online: number, presencial: number) =>
    fraseLeituraDosCanais(
      canal("online", online),
      canal("presencial", presencial),
    );

  it("10 pontos de diferença ainda é 'quase igual'; 12 já aponta quem vendeu mais", () => {
    expect(frase(55, 45)).toBe(
      "App e loja física dividem a receita quase igual neste período.",
    );
    expect(frase(45, 55)).toBe(
      "App e loja física dividem a receita quase igual neste período.",
    );
    expect(frase(56, 44)).toBe("O app fez 56% da receita do período.");
    expect(frase(44, 56)).toBe("A loja física fez 56% da receita do período.");
  });

  it("o percentual citado arredonda (56,4 vira 56, 56,6 vira 57), não corta", () => {
    expect(frase(564, 436)).toBe("O app fez 56% da receita do período.");
    expect(frase(566, 434)).toBe("O app fez 57% da receita do período.");
    // 43,6% do app: a loja física fez o resto, 56,4% → 56 (e não 57, que é o
    // que sai se o app for cortado para 43).
    expect(frase(436, 564)).toBe(
      "A loja física fez 56% da receita do período.",
    );
  });
});
