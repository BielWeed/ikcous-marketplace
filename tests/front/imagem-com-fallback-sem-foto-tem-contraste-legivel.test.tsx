// @vitest-environment jsdom
//
// O "Sem foto" tem 10 px: por ser texto pequeno, o WCAG pede contraste de 4,5:1.
// `text-muted-foreground` sobre `bg-muted` dava 4,39:1 no tema claro. O jsdom não
// calcula CSS, então o contraste sai das variáveis REAIS de `src/index.css`
// (--foreground, --muted) e da classe que o componente de fato desenha.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ImagemComFallback } from "@/components/ui/custom/ImagemComFallback";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Rgb = [number, number, number];

// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de um arquivo do próprio repositório
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

function bloco(abertura: string): string {
  const inicio = css.indexOf(abertura);
  if (inicio < 0) throw new Error(`bloco ${abertura} não achado`);
  return css.slice(inicio, css.indexOf("}", inicio));
}

function token(corpo: string, nome: string): Rgb {
  // eslint-disable-next-line security/detect-non-literal-regexp -- `nome` é literal fixo do teste (muted, foreground)
  const m = new RegExp(
    `--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`,
  ).exec(corpo);
  if (!m) throw new Error(`token --${nome} não achado`);
  return hslParaRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
}

function hslParaRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

const luminancia = (rgb: Rgb): number => {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contraste = (a: Rgb, b: Rgb): number => {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Cor do texto com `alpha` sobre o fundo (mistura em sRGB, como o navegador). */
const sobre = (t: Rgb, alpha: number, f: Rgb): Rgb => [
  t[0] * alpha + f[0] * (1 - alpha),
  t[1] * alpha + f[1] * (1 - alpha),
  t[2] * alpha + f[2] * (1 - alpha),
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("'Sem foto' legível (WCAG 1.4.3, texto pequeno: 4,5:1)", () => {
  it("o texto usa uma cor que passa nos dois temas, sobre o fundo bg-muted", () => {
    act(() => root.render(<ImagemComFallback src="" alt="Produto" />));
    const span = host.querySelector("span")!;
    expect(span.textContent).toBe("Sem foto");
    expect(span.className).toContain("bg-muted");

    const m = /(?:^|\s)text-foreground\/(\d+)(?:\s|$)/.exec(span.className);
    expect(m, `classe de cor do texto: ${span.className}`).not.toBeNull();
    const alpha = Number(m![1]) / 100;

    for (const [tema, abertura] of [
      ["claro", ":root {"],
      ["escuro", ".dark {"],
    ] as const) {
      const corpo = bloco(abertura);
      const fundo = token(corpo, "muted");
      const texto = sobre(token(corpo, "foreground"), alpha, fundo);
      expect(
        contraste(texto, fundo),
        `contraste no tema ${tema}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("a cor antiga (muted-foreground) realmente ficava abaixo de 4,5:1 no claro", () => {
    // Controle: prova que a conta acima distingue o defeito do conserto.
    const corpo = bloco(":root {");
    expect(
      contraste(token(corpo, "muted-foreground"), token(corpo, "muted")),
    ).toBeLessThan(4.5);
  });
});
