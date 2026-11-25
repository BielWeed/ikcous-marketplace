// O teto da trilha de telas do painel (`src/utils/trilha-do-painel.ts`): o teste
// de origem só exige "no máximo o teto", que passaria com um teto de 1 ou de
// 100. Aqui o valor e o lado do corte ficam presos: 30 telas, e quando passa
// disso sai a MAIS ANTIGA, nunca a que a pessoa acabou de abrir (senão o
// Voltar levaria a uma tela de horas atrás).
import type { View } from "@/types";
import {
  TAMANHO_MAXIMO_DA_TRILHA,
  avancarTrilha,
  origemDaTrilha,
} from "@/utils/trilha-do-painel";
import { describe, expect, it } from "vitest";

const TELAS: readonly View[] = [
  "admin-orders",
  "admin-products",
  "admin-settings",
];

describe("teto da trilha do painel", () => {
  it("o teto é de 30 telas lembradas", () => {
    expect(TAMANHO_MAXIMO_DA_TRILHA).toBe(30);
  });

  it("cresce uma tela por avanço até 30 e daí em diante fica em 30", () => {
    let trilha: readonly View[] = [];
    for (let i = 0; i < 45; i++) {
      trilha = avancarTrilha(trilha, TELAS[i % 3]);
      expect(trilha.length, `depois de ${i + 1} avanços`).toBe(
        Math.min(i + 1, 30),
      );
    }
  });

  it("ao passar do teto sai a tela MAIS ANTIGA e a mais nova fica no fim", () => {
    let trilha: readonly View[] = [];
    // 40 avanços, todos diferentes da tela anterior e da penúltima.
    for (let i = 0; i < 40; i++) trilha = avancarTrilha(trilha, TELAS[i % 3]);

    // As 30 últimas são as de índice 10 a 39 do ciclo.
    expect(trilha).toEqual(
      Array.from({ length: 30 }, (_, k) => TELAS[(10 + k) % 3]),
    );
    expect(trilha.at(-1)).toBe(TELAS[39 % 3]);
    expect(origemDaTrilha(trilha)).toBe(TELAS[38 % 3]);
  });

  it("voltar com a trilha cheia ainda encolhe e mantém a ordem", () => {
    let trilha: readonly View[] = [];
    for (let i = 0; i < 40; i++) trilha = avancarTrilha(trilha, TELAS[i % 3]);
    const anterior = origemDaTrilha(trilha) as View;

    const depois = avancarTrilha(trilha, anterior);

    expect(depois).toHaveLength(29);
    expect(depois).toEqual(trilha.slice(0, -1));
  });
});
