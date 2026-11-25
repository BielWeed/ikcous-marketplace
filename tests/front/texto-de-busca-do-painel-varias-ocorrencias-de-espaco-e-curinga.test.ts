// A busca do painel (`src/lib/texto-de-busca-do-painel.ts`) manda o termo a
// RPCs que o concatenam num LIKE/ILIKE. O teste do módulo cobre UMA ocorrência
// de cada coisa; aqui são VÁRIAS, porque um escape que só troca a primeira
// ocorrência deixa o resto virar curinga (`%` e `_`) ou barra solta:
//   · "50%_off%" tem dois `%` e um `_`;
//   · espaços repetidos em mais de um ponto do texto colapsam todos;
//   · a barra é escapada ANTES dos outros, senão a barra que o próprio escape
//     acrescenta seria escapada de novo.
import {
  normalizarTextoDeBuscaDoPainel,
  prepararTextoDeBuscaDoPainel,
} from "@/lib/texto-de-busca-do-painel";
import { describe, expect, it } from "vitest";

describe("normalizarTextoDeBuscaDoPainel — várias sequências de espaço", () => {
  it("colapsa TODAS as sequências, não só a primeira", () => {
    expect(normalizarTextoDeBuscaDoPainel("  a   b \t\n c    d  ")).toBe(
      "a b c d",
    );
  });

  it("espaço simples entre palavras fica como está", () => {
    expect(normalizarTextoDeBuscaDoPainel("camisa azul")).toBe("camisa azul");
  });

  it("só espaços vira texto vazio", () => {
    expect(normalizarTextoDeBuscaDoPainel(" \t\n ")).toBe("");
  });
});

describe("prepararTextoDeBuscaDoPainel — escape de TODAS as ocorrências", () => {
  it("escapa todos os % e todos os _", () => {
    expect(prepararTextoDeBuscaDoPainel("50%_off%_")).toBe("50\\%\\_off\\%\\_");
  });

  it("escapa todas as barras invertidas", () => {
    expect(prepararTextoDeBuscaDoPainel("a\\b\\c")).toBe("a\\\\b\\\\c");
  });

  it("a barra é escapada antes: a barra do escape não é escapada de novo", () => {
    // Entrada: `\%`. Saída certa: barra dobrada + percentual escapado.
    expect(prepararTextoDeBuscaDoPainel("\\%")).toBe("\\\\\\%");
    expect(prepararTextoDeBuscaDoPainel("\\_")).toBe("\\\\\\_");
  });

  it("normaliza os espaços antes de escapar", () => {
    expect(prepararTextoDeBuscaDoPainel("  50%   off  ")).toBe("50\\% off");
  });

  it("texto sem caractere especial sai igual", () => {
    expect(prepararTextoDeBuscaDoPainel("camisa azul")).toBe("camisa azul");
  });
});
