// `primeiraLetra` (`src/lib/primeira-letra.ts`): o texto reserva é só para
// quando o nome está vazio. O teste do módulo passava reserva SÓ junto de nomes
// vazios, então uma reserva que "vencesse" o nome real (todo avatar mostrando
// "?" em vez da inicial) não era pega.
import { primeiraLetra } from "@/lib/primeira-letra";
import { describe, expect, it } from "vitest";

describe("primeiraLetra — a reserva não vence um nome de verdade", () => {
  it("nome real com reserva informada devolve a inicial, não a reserva", () => {
    expect(primeiraLetra("ana", 1, "?")).toBe("A");
    expect(primeiraLetra("🌸 Maria", 1, "L")).toBe("🌸");
    expect(primeiraLetra("maria", 2, "CX")).toBe("MA");
  });

  it("nome vazio, só espaços, nulo ou ausente devolve a reserva", () => {
    expect(primeiraLetra("", 2, "CX")).toBe("CX");
    expect(primeiraLetra("   ", 1, "?")).toBe("?");
    expect(primeiraLetra(null, 1, "L")).toBe("L");
    expect(primeiraLetra(undefined, 3, "XYZ")).toBe("XYZ");
  });

  it("sem reserva informada, o nome vazio dá texto vazio (a reserva padrão é vazia)", () => {
    expect(primeiraLetra("")).toBe("");
    expect(primeiraLetra("  ", 2)).toBe("");
  });

  it("a quantidade padrão é uma letra só", () => {
    expect(primeiraLetra("maria")).toBe("M");
  });

  it("pedir mais letras do que o nome tem devolve só as que existem", () => {
    expect(primeiraLetra("a", 3)).toBe("A");
  });
});
