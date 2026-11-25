// Duas bordas do intervalo na "margem em formação"
// (`src/lib/margem-em-formacao.ts`) que o teste do módulo não pisava:
//   · um período que COMEÇA no mês corrente mas termina em outro mês à frente
//     (ex.: de 1º de novembro até uma data de dezembro) ainda é o mês parcial
//     que distorce o percentual: em formação;
//   · um período com o fim ANTES do começo (datas trocadas no filtro) é lixo,
//     e lixo nunca esconde a margem.
import { margemEmFormacao } from "@/lib/margem-em-formacao";
import { describe, expect, it } from "vitest";

describe("margemEmFormacao — fim do período", () => {
  it("começa no mês corrente e termina em mês futuro: em formação", () => {
    expect(
      margemEmFormacao(-80, "2026-11-05", {
        inicio: "2026-11-01",
        fim: "2026-12-31",
      }),
    ).toBe(true);
  });

  it("começa no mês corrente e termina no mesmo mês: em formação (controle)", () => {
    expect(
      margemEmFormacao(-80, "2026-11-05", {
        inicio: "2026-11-01",
        fim: "2026-11-30",
      }),
    ).toBe(true);
  });

  it("fim em mês ANTERIOR ao do começo (datas trocadas): não está em formação", () => {
    expect(
      margemEmFormacao(-80, "2026-11-05", {
        inicio: "2026-11-01",
        fim: "2026-10-31",
      }),
    ).toBe(false);
  });
});
