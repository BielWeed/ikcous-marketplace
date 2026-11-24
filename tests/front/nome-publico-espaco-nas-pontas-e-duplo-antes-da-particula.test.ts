// Protege `nomePublicoDe` (src/lib/nome-publico.ts) contra espaço sobrando no
// nome cadastrado. A função espelha `public.nome_publico_de(text)` do banco,
// que descarta as partes vazias ao separar por espaço; o espelho do front faz
// isso com `trim()` + `split(/\s+/)`:
//  - sem o `trim()`, " Maria Silva" virava "Cliente" (a primeira "palavra" era
//    vazia) e a avaliação perdia o nome de quem avaliou;
//  - com `split(/\s/)` (sem o `+`), "Ana  de" (dois espaços antes da partícula)
//    deixava uma palavra vazia no fim da lista e a função QUEBRAVA com
//    TypeError ao tirar a inicial dela — derrubando a tela de avaliações.
// Os testes vizinhos só usam um espaço entre palavras, ou espaços no meio de
// um nome que termina em sobrenome de verdade, e nenhum dos dois caía.
import { nomePublicoDe } from "@/lib/nome-publico";
import { describe, expect, it } from "vitest";

describe("nomePublicoDe com espaços sobrando", () => {
  it.each([
    [" Maria Silva", "Maria S."],
    ["Maria Silva ", "Maria S."],
    ["  Maria   Silva  ", "Maria S."],
    ["\tMaria\nSilva\t", "Maria S."],
    ["\u{a0}Maria\u{a0}Silva\u{a0}", "Maria S."],
    [" Madonna ", "Madonna"],
  ])("converte %j em %j", (original, esperado) => {
    expect(nomePublicoDe(original)).toBe(esperado);
  });

  it.each([
    ["Ana  de", "Ana"],
    ["Ana   de   da", "Ana"],
    ["Ana \t de \u{a0} dos", "Ana"],
    ["  Ana  de  ", "Ana"],
  ])(
    "partícula no fim com espaço duplo (%j) não quebra e fica só com o primeiro nome",
    (original, esperado) => {
      expect(() => nomePublicoDe(original)).not.toThrow();
      expect(nomePublicoDe(original)).toBe(esperado);
    },
  );

  it("o resultado de um nome com espaço sobrando é estável ao reaplicar", () => {
    const uma = nomePublicoDe("  Maria   de   Souza  ");
    expect(uma).toBe("Maria S.");
    expect(nomePublicoDe(uma)).toBe(uma);
  });
});
