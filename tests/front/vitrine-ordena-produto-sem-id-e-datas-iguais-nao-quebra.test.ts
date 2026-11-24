// A ordem da vitrine desempata por id quando as datas são iguais. A prévia do
// painel e rascunhos ainda sem id (produto novo que ainda não foi gravado)
// passam pela MESMA função: sem id nos dois lados, o desempate não pode tentar
// comparar texto que não existe (quebraria a prévia inteira), e a ordem de
// chegada fica como está.
import { ordenarParaVitrine } from "@/lib/vitrine";
import { describe, expect, it } from "vitest";

describe("ordenarParaVitrine — produto sem id e datas iguais", () => {
  it("dois sem id e mesma data: não quebra e mantém a ordem de chegada", () => {
    const a = { stock: 1, createdTime: 5, nome: "a" };
    const b = { stock: 1, createdTime: 5, nome: "b" };
    expect(() => ordenarParaVitrine([a, b])).not.toThrow();
    expect(ordenarParaVitrine([a, b]).map((p) => p.nome)).toEqual(["a", "b"]);
    expect(ordenarParaVitrine([b, a]).map((p) => p.nome)).toEqual(["b", "a"]);
  });

  it("só um com id e mesma data: não quebra e mantém a ordem de chegada", () => {
    const comId = { id: "x", stock: 1, createdTime: 5, nome: "com" };
    const semId = { stock: 1, createdTime: 5, nome: "sem" };
    expect(() => ordenarParaVitrine([comId, semId])).not.toThrow();
    expect(ordenarParaVitrine([semId, comId]).map((p) => p.nome)).toEqual([
      "sem",
      "com",
    ]);
  });

  it("com ids e mesma data, o id decide (mesmo vindo em ordem trocada)", () => {
    const a = { id: "a", stock: 1, createdTime: 5 };
    const b = { id: "b", stock: 1, createdTime: 5 };
    expect(ordenarParaVitrine([b, a]).map((p) => p.id)).toEqual(["a", "b"]);
  });
});
