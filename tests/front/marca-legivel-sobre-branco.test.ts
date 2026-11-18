// @vitest-environment jsdom
//
// A cor da loja como TEXTO, ÍCONE ou ANEL sobre fundo branco. A validação da
// cor aceita até #ffffff, e `text-primary`/`ring-primary` sobre branco some com
// cor clara (amarelo, dourado, branco). `--primary-legivel` é a cor da marca
// escurecida só o bastante para chegar a 4,5:1 contra branco, mantendo o matiz;
// lojas de cor já escura ficam IDÊNTICAS (o mesmo hexadecimal, o mesmo token).
import { afterEach, describe, expect, it } from "vitest";

import { aplicarCorDaLoja, hexToTailwindHsl } from "@/config/branding";
import { corDaMarcaSobreBranco, razaoDeContraste } from "@/config/cor-da-loja";

const BRANCO = "#ffffff";
const MINIMO_DO_WCAG = 4.5;

// O navegador resolve `hsl(var(--x))` a partir do token "H S% L%" INTEIRO.
// Aqui o token volta para hexadecimal pelo mesmo caminho, para medir o que
// a vitrine realmente pinta (e não o hexadecimal antes do arredondamento).
function tokenParaHex(token: string): string {
  const [h, s, l] = token
    .split(" ")
    .map((parte) => Number.parseFloat(parte.replace("%", "")));
  const sat = s / 100;
  const luz = l / 100;
  const a = sat * Math.min(luz, 1 - luz);
  const canal = (n: number): string => {
    const k = (n + h / 30) % 12;
    const v = luz - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(0)}${canal(8)}${canal(4)}`;
}

const matiz = (hex: string): number =>
  Number.parseInt(hexToTailwindHsl(hex).split(" ")[0], 10);

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("corDaMarcaSobreBranco — a cor da marca legível sobre branco", () => {
  it.each([
    ["branco", "#ffffff"],
    ["amarelo claro", "#ffe066"],
    ["amarelo ouro", "#ffd400"],
    ["rosa claro", "#ffb6c1"],
    ["laranja médio", "#f97316"],
    ["verde médio", "#22c55e"],
    ["azul médio", "#3b82f6"],
    ["preto", "#000000"],
    ["azul escuro", "#1e3a8a"],
  ])("%s (%s): chega a 4,5:1 contra o branco", (_nome, cor) => {
    const legivel = corDaMarcaSobreBranco(cor);
    expect(razaoDeContraste(legivel, BRANCO)).toBeGreaterThanOrEqual(
      MINIMO_DO_WCAG,
    );
  });

  it("cor que já tem contraste suficiente NÃO muda (loja de cor normal)", () => {
    for (const escura of ["#000000", "#1e3a8a", "#18181b", "#7c2d12"]) {
      expect(corDaMarcaSobreBranco(escura)).toBe(escura);
    }
    // Maiúsculas entram, o canônico sai em minúsculas.
    expect(corDaMarcaSobreBranco("#1E3A8A")).toBe("#1e3a8a");
  });

  it("cor clara é escurecida, sem trocar de cor", () => {
    for (const clara of ["#ffd400", "#ffe066", "#f97316", "#22c55e"]) {
      const legivel = corDaMarcaSobreBranco(clara);
      expect(legivel).not.toBe(clara);
      expect(Math.abs(matiz(legivel) - matiz(clara))).toBeLessThanOrEqual(2);
    }
  });

  it("branco vira cinza (não há matiz a preservar)", () => {
    const legivel = corDaMarcaSobreBranco("#ffffff");
    const [r, g, b] = [1, 3, 5].map((i) => legivel.slice(i, i + 2));
    expect(new Set([r, g, b]).size).toBe(1);
  });

  it("valor que não é cor volta como veio (quem consome já trata)", () => {
    expect(corDaMarcaSobreBranco("amarelo")).toBe("amarelo");
  });
});

describe("aplicarCorDaLoja escreve --primary-legivel", () => {
  const legivelAplicado = (cor: string): string => {
    aplicarCorDaLoja(cor);
    return document.documentElement.style.getPropertyValue("--primary-legivel");
  };

  it("cor escura: o mesmo token de --primary, a loja não muda", () => {
    aplicarCorDaLoja("#1e3a8a");
    const raiz = document.documentElement.style;
    expect(raiz.getPropertyValue("--primary-legivel")).toBe(
      raiz.getPropertyValue("--primary"),
    );
  });

  it("cor clara: o token difere de --primary e é mais escuro", () => {
    aplicarCorDaLoja("#ffd400");
    const raiz = document.documentElement.style;
    expect(raiz.getPropertyValue("--primary")).toBe(
      hexToTailwindHsl("#ffd400"),
    );
    expect(raiz.getPropertyValue("--primary-legivel")).not.toBe(
      raiz.getPropertyValue("--primary"),
    );
  });

  it("varredura: o que a vitrine pinta passa de 4,5:1 em TODA a roda de cores", () => {
    const falhas: string[] = [];
    for (let h = 0; h < 360; h += 7) {
      for (const s of [0, 25, 60, 100]) {
        for (const l of [10, 30, 50, 70, 85, 97, 100]) {
          const cor = tokenParaHex(`${h} ${s}% ${l}%`);
          const token = legivelAplicado(cor);
          const pintado = tokenParaHex(token);
          if (razaoDeContraste(pintado, BRANCO) < MINIMO_DO_WCAG) {
            falhas.push(`${cor} -> ${token} (${pintado})`);
          }
        }
      }
    }
    expect(falhas).toEqual([]);
  });
});
