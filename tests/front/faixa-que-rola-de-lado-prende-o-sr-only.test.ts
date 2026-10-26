// Tela que rolava de lado sozinha (Avisar clientes, 26/10/2026): o texto `sr-only`
// (só para leitor de tela) dentro de uma faixa que rola na horizontal é
// `position: absolute`. Sem um ancestral posicionado DENTRO da faixa, ele se
// ancora num ancestral de fora, não é cortado pela faixa e alarga a área
// rolável da tela inteira (medido em navegador real a 360 px: 719 px de largura
// rolável num painel de 360 px, por causa dos `sr-only` dos cartões fora da vista).
//
// jsdom não faz layout: este arquivo prende as duas travas por análise estática.
// A medição em navegador real (360 px, painel com `overflow-x-hidden`) deu
// 360 px depois da correção, e 901 px no controle sem ela.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do proprio repositorio
  readFileSync(resolve(__dirname, "../..", caminho), "utf8");

describe("faixas que rolam de lado não vazam o texto sr-only para a tela", () => {
  it("o CSS global torna `relative` a faixa que rola de lado e carrega um sr-only", () => {
    const css = ler("src/index.css");
    expect(css).toMatch(
      /:where\(\.overflow-x-auto\):has\(\.sr-only\):not\(\.absolute, \.fixed, \.sticky\)\s*\{\s*position:\s*relative;/,
    );
  });

  it("as duas faixas do Avisar clientes (modelos e público) já nascem relative", () => {
    const view = ler("src/views/admin/AdminPushView.tsx");
    const faixas = view.match(/className="[^"]*overflow-x-auto[^"]*"/g) ?? [];
    expect(faixas.length).toBeGreaterThanOrEqual(2);
    for (const faixa of faixas) {
      expect(faixa).toMatch(/"relative |\srelative\s/);
    }
  });
});
