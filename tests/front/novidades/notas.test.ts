import { notasEntre } from "@/lib/novidades/notas";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/novidades/notas-das-versoes.json", () => {
  const nota = {
    titulo: "Pedidos mais claros",
    novidades: ["Veja seus pedidos com mais facilidade."],
    correcoes: [],
    melhorias: [],
  };
  return {
    default: {
      "1.5.10": nota,
      "2.0.0": nota,
      "1.5.2": nota,
      "1.5.9": nota,
      "1.5.11": { ...nota, titulo: "" },
      "1.5.12": { ...nota, correcoes: [42] },
      "1.5.13": { novidades: [], correcoes: [], melhorias: [] },
      "1.5.14": null,
      ilegivel: nota,
    },
  };
});

describe("notasEntre", () => {
  it("exclui a origem, inclui o destino e ordena por núcleo numérico", () => {
    expect(notasEntre("1.5.2", "2.0.0").map((item) => item.versao)).toEqual([
      "1.5.9",
      "1.5.10",
      "2.0.0",
    ]);
  });

  it("sem origem legível mostra somente a nota do destino", () => {
    for (const de of [null, "", "desconhecida"]) {
      expect(notasEntre(de, "1.5.10").map((item) => item.versao)).toEqual([
        "1.5.10",
      ]);
    }
  });

  it("ignora sufixos da origem e do destino", () => {
    expect(
      notasEntre("1.5.9-sha.antiga", "1.5.10+nova").map((item) => item.versao),
    ).toEqual(["1.5.10"]);
    expect(notasEntre(null, "1.5.10-sha.nova")[0]?.versao).toBe("1.5.10");
  });

  it("devolve vazio sem nota ou com destino ilegível", () => {
    expect(notasEntre(null, "1.5.8")).toEqual([]);
    expect(notasEntre("1.5.2", "1.5.8")).toEqual([]);
    expect(notasEntre("1.5.2", "desconhecida")).toEqual([]);
  });

  it("não repete a mesma versão nem anuncia uma versão anterior", () => {
    expect(notasEntre("1.5.10", "1.5.10")).toEqual([]);
    expect(notasEntre("2.0.0", "1.5.10")).toEqual([]);
  });

  it("ignora notas malformadas sem perder as válidas", () => {
    const versoes = notasEntre("1.5.9", "1.5.14").map((item) => item.versao);
    expect(versoes).toEqual(["1.5.10"]);
    expect(notasEntre(null, "1.5.13")).toEqual([]);
  });
});
