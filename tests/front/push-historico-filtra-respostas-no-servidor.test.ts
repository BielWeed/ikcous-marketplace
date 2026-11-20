import { filtroDeTitulosDeRespostaDaLoja } from "@/lib/historico-de-campanhas";
import { describe, expect, it } from "vitest";

describe("filtro do histórico de campanhas no servidor", () => {
  it("usa os três títulos exatos entre aspas", () => {
    expect(filtroDeTitulosDeRespostaDaLoja()).toBe(
      '("Sua pergunta foi respondida!","Sua avaliacao foi respondida!","Sua avaliação foi respondida!")',
    );
  });

  it("escapa aspas e barras invertidas dentro de um título", () => {
    expect(filtroDeTitulosDeRespostaDaLoja(['Uma "resposta" \\ nova'])).toBe(
      String.raw`("Uma \"resposta\" \\ nova")`,
    );
  });
});
