// Título do banner era cortado com `slice(0, 60)`: conta unidades de texto do
// JavaScript, não letras. O corte caía no meio de uma palavra ou no meio de um
// emoji (metade de um par substituto vira um "�" na vitrine) e ninguém era
// avisado. `cortarTexto` corta em letra inteira, de preferência entre
// palavras, e põe "…" para dizer que houve corte.
import { cortarTexto } from "@/lib/cortar-texto";
import { describe, expect, it } from "vitest";

describe("cortarTexto", () => {
  it("texto que cabe volta igual, sem reticências", () => {
    expect(cortarTexto("Vestido Floral", 60)).toBe("Vestido Floral");
    const exato = "a".repeat(60);
    expect(cortarTexto(exato, 60)).toBe(exato);
  });

  it("texto longo corta entre palavras e avisa com reticências", () => {
    const nome =
      "Vestido Longo Floral Manga Bufante Tamanho Único Premium Coleção";
    const saida = cortarTexto(nome, 60);
    expect(saida.endsWith("…")).toBe(true);
    expect(saida.length).toBeLessThanOrEqual(60);
    // Não termina no meio de uma palavra: o que sobra antes do "…" é
    // prefixo do original que acaba numa palavra inteira.
    const semPontos = saida.slice(0, -1);
    expect(nome.startsWith(semPontos)).toBe(true);
    expect(nome.charAt(semPontos.length)).toBe(" ");
  });

  it("palavra sem nenhum espaço é cortada na letra, não some", () => {
    const saida = cortarTexto("x".repeat(100), 60);
    expect(saida).toBe(`${"x".repeat(59)}…`);
  });

  it("nunca parte um emoji ao meio", () => {
    // 58 letras + emoji (2 unidades) na posição 59-60 + mais texto.
    const nome = `${"a".repeat(58)}💎bbbbbb`;
    const saida = cortarTexto(nome, 60);
    // Nenhuma metade solta de par substituto.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(saida)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(saida)).toBe(false);
    expect(saida.length).toBeLessThanOrEqual(60);
    expect(saida.endsWith("…")).toBe(true);
  });

  it("emoji inteiro que cabe é mantido", () => {
    const nome = `${"a".repeat(40)}💎 ${"b".repeat(40)}`;
    const saida = cortarTexto(nome, 60);
    expect(saida).toContain("💎");
    expect(saida.length).toBeLessThanOrEqual(60);
  });

  it("não deixa espaço antes das reticências", () => {
    const saida = cortarTexto(`${"a".repeat(30)} ${"b".repeat(60)}`, 60);
    expect(saida).toBe(`${"a".repeat(30)}…`);
  });
});
