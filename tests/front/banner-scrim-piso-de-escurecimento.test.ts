// O escurecimento atrás do texto do banner (`classeDoScrimDoBanner`) é a garantia
// LOCAL de contraste do texto branco quando a lojista deixa o overlay em 0%.
// Os outros testes só olham o TIPO do degradê (rodapé, centro, nenhum); este
// trava o PISO de força: quem afinar o degradê não pode deixá-lo mais fraco do
// que o que o laudo de acessibilidade aprovou (rodapé: 75% na base e 45% no
// meio; centro: 70% no meio e 45% na borda do miolo).
import { classeDoScrimDoBanner } from "@/lib/banner-scrim";
import { describe, expect, it } from "vitest";

const porcento = (classe: string, regra: RegExp): number => {
  const achou = regra.exec(classe);
  if (!achou?.[1]) throw new Error(`a classe não tem ${regra}: ${classe}`);
  return Number(achou[1]);
};

describe("o piso de escurecimento atrás do texto", () => {
  it.each([
    "default",
    "split_left",
    "split_right",
    "neon_glow",
    undefined,
    null,
  ])(
    "texto no rodapé (%s): base a 75% ou mais e meio a 45% ou mais, clareando para cima",
    (modelo) => {
      const classe = classeDoScrimDoBanner(modelo);

      const base = porcento(classe, /from-black\/(\d+)/);
      const meio = porcento(classe, /via-black\/(\d+)/);

      expect(classe).toContain("bg-gradient-to-t");
      expect(classe).toContain("to-transparent");
      expect(base).toBeGreaterThanOrEqual(75);
      expect(meio).toBeGreaterThanOrEqual(45);
      expect(base).toBeGreaterThan(meio);
    },
  );

  it("texto no centro: miolo a 70% ou mais e 45% ou mais antes de sumir", () => {
    const classe = classeDoScrimDoBanner("split_center");

    const miolo = porcento(classe, /rgba\(0,0,0,([\d.]+)\)_0%/) * 100;
    const meio = porcento(classe, /rgba\(0,0,0,([\d.]+)\)_45%/) * 100;

    expect(miolo).toBeGreaterThanOrEqual(70);
    expect(meio).toBeGreaterThanOrEqual(45);
    expect(classe).toContain("rgba(0,0,0,0)_80%");
  });

  it("glassmorphic não ganha degradê: a caixa do texto já escurece", () => {
    expect(classeDoScrimDoBanner("glassmorphic")).toBe("");
  });
});
