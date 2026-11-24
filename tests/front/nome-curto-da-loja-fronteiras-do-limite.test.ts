// O rótulo do ícone instalado tem teto de 12 caracteres. Os testes de
// `nome-curto-da-loja.test.ts` provam os casos do dia a dia; aqui ficam as
// FRONTEIRAS onde um "<" no lugar de "<=" (ou o contrário) muda o rótulo de
// uma loja de verdade: nome com exatamente 12 caracteres, palavras que somam
// exatamente 12, emoji (que ocupa 2 unidades do JavaScript e conta como 1
// caractere) e conectivo que sobra sozinho ou no fim.
import {
  LIMITE_DO_NOME_CURTO,
  nomeCurtoDaLoja,
} from "@/config/nomeCurtoDaLoja";
import { describe, expect, it } from "vitest";

describe("nomeCurtoDaLoja — fronteiras do limite de 12 caracteres", () => {
  it("o limite é 12", () => {
    expect(LIMITE_DO_NOME_CURTO).toBe(12);
  });

  it("nome com EXATAMENTE 12 caracteres fica inteiro, mesmo com ' - ' no meio", () => {
    // "Ana - Centro" tem 12 caracteres: cabe, então o separador nem é olhado.
    expect("Ana - Centro".length).toBe(12);
    expect(nomeCurtoDaLoja("Ana - Centro")).toBe("Ana - Centro");
    // Com 13, o separador passa a valer.
    expect(nomeCurtoDaLoja("Ana - Centros")).toBe("Ana");
  });

  it("palavras que somam EXATAMENTE 12 caracteres cabem todas", () => {
    // "Papel Bonito" = 12; "Papel Bonito Premium" estoura só na terceira.
    expect(nomeCurtoDaLoja("Papel Bonito Premium")).toBe("Papel Bonito");
    expect(nomeCurtoDaLoja("Papel Bonitos Premium")).toBe("Papel");
  });

  it("conta caractere de verdade: emoji vale 1, não 2", () => {
    // 4 + espaço + 4 + espaço + 2 = 12 caracteres (22 unidades de JavaScript).
    const nome = "🌸🌸🌸🌸 🌸🌸🌸🌸 🌸🌸";
    expect(Array.from(nome)).toHaveLength(12);
    expect(nome.length).toBeGreaterThan(12);
    expect(nomeCurtoDaLoja(nome)).toBe(nome);
  });

  it("nunca parte um emoji ao cortar a primeira palavra", () => {
    const longa = "🌸".repeat(15);
    const curto = nomeCurtoDaLoja(longa);
    expect(Array.from(curto)).toHaveLength(12);
    expect(curto).toBe("🌸".repeat(12));
  });

  it("conectivo que é a ÚNICA palavra que cabe não é removido (rótulo nunca fica vazio)", () => {
    expect(nomeCurtoDaLoja("Da Constantinopolitana")).toBe("Da");
  });

  it("o '&' sozinho no fim também não fica pendurado", () => {
    // "Pizza &" cabe, "Pizza & Cianorte" não: sobra o "&" no fim e ele sai.
    expect(nomeCurtoDaLoja("Pizza & Cianorte Grande")).toBe("Pizza");
  });

  it("vários conectivos seguidos no fim saem de uma vez", () => {
    // "Casa de e" cabe em 12; "Casa de e Praia" não.
    expect(nomeCurtoDaLoja("Casa de e Praiaaaaaa")).toBe("Casa");
  });

  it("nome só com espaços vira texto vazio, sem quebrar", () => {
    expect(nomeCurtoDaLoja("   ")).toBe("");
  });
});
