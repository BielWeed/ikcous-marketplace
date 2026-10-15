// As três páginas de política só existem para a cliente se o roteador manual
// do app as conhece nos TRÊS lugares que ele exige: o endereço de entrada
// (/terms, /privacy, /returns-policy — também o que o botão Voltar do
// navegador usa), o mapa de telas e o `switch` que desenha a tela. Faltar um
// deles não quebra o build: o link só "não faz nada" ou cai na home.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TELAS_DE_ENTRADA } from "@/config/rotas";
import {
  TIPOS_DE_POLITICA,
  VIEW_DA_POLITICA,
} from "@/lib/textos-das-politicas";

const APP = readFileSync(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("roteador — as três políticas", () => {
  it("cada página tem uma tela própria, diferente das outras", () => {
    const telas = TIPOS_DE_POLITICA.map((t) => VIEW_DA_POLITICA[t]);
    expect(telas).toEqual(["terms", "privacy", "returns-policy"]);
    expect(new Set(telas).size).toBe(3);
  });

  it.each(["terms", "privacy", "returns-policy"] as const)(
    "%s: é tela de entrada, está no mapa de telas e no switch",
    (tela) => {
      expect(TELAS_DE_ENTRADA).toContain(tela);
      const chave = tela.includes("-") ? `"${tela}"` : tela;
      expect(APP).toContain(`${chave}: PoliticaDaLojaView,`);
      expect(APP).toContain(`case "${tela}":`);
    },
  );
});
