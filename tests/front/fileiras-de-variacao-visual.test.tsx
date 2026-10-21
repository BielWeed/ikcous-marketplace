import { readFileSync } from "node:fs";
// @vitest-environment jsdom
import { FileirasDeVariacao } from "@/components/ui/custom/FileirasDeVariacao";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

function montar(valores: string[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <FileirasDeVariacao
      fileiras={[
        {
          nome: "Cor",
          valores: valores.map((valor) => ({
            valor,
            disponivel: valor !== "Branco",
            estoque: valor === "Branco" ? 0 : 2,
          })),
        },
      ]}
      escolha={{ Cor: "Azul" }}
      onEscolher={() => {}}
    />,
  );
  return host;
}

// Mesma conversão HSL e luminância WCAG de tema-do-painel.test.tsx.
function hslParaRgb(canais: string): number[] {
  const [h, s, l] = canais.trim().split(/\s+/).map(Number.parseFloat);
  const sf = s / 100;
  const lf = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) =>
    lf - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}

function contraste(a: number[], b: number[]): number {
  const luminancia = ([r, g, b]: number[]) => {
    const linear = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [x, y] = [luminancia(a), luminancia(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}

describe("apresentação acessível das fileiras", () => {
  for (const tema of [":root", ".dark"]) {
    for (const cor of ["Branco", "Creme"]) {
      it(`contorno de ${cor} não selecionado tem pelo menos 3:1 em ${tema}`, () => {
        expect(contraste([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
        const inicio = css.indexOf(`${tema} {`);
        expect(inicio).toBeGreaterThanOrEqual(0);
        const bloco = css.slice(inicio, css.indexOf("}", inicio));
        const fundo = hslParaRgb(bloco.match(/--background:\s*([^;]+);/)![1]);
        const frente = hslParaRgb(bloco.match(/--foreground:\s*([^;]+);/)![1]);
        const host = montar(["Azul", cor]);
        const botao = host.querySelector<HTMLButtonElement>(
          `button[aria-label="${cor}"]`,
        )!;
        expect(botao.getAttribute("aria-pressed")).toBe("false");
        const bolinha = botao.querySelector<HTMLElement>("[style]")!;
        const borda = bolinha.className
          .split(" ")
          .find((classe) => classe.startsWith("border-foreground"));
        expect(borda).toBeDefined();
        const opacidade = botao.disabled
          ? Number(
              botao.className.match(/disabled:opacity-(\d+)/)?.[1] ?? 100,
            ) / 100
          : 1;
        const alfa = (Number(borda?.split("/").at(1) ?? 100) / 100) * opacidade;
        const contorno = frente.map(
          (canal, i) => canal * alfa + fundo.at(i)! * (1 - alfa),
        );
        expect(
          contraste(contorno, fundo),
          `${cor} em ${tema}`,
        ).toBeGreaterThanOrEqual(3);
        expect(bolinha.classList.contains("border-foreground")).toBe(true);
      });
    }
  }
  it("cores conhecidas usam bolinhas de 36px dentro de alvos de 44px com nome e seleção", () => {
    const host = montar(["Azul", "Branco"]);
    const azul = host.querySelector('button[aria-label="Azul"]')!;
    const branco = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Branco"]',
    )!;
    expect(azul.getAttribute("aria-pressed")).toBe("true");
    expect(azul.classList.contains("min-h-11")).toBe(true);
    expect(azul.querySelector(".size-9")?.getAttribute("style")).toContain(
      "background-color",
    );
    expect(branco.disabled).toBe(true);
    expect(branco.querySelector(".size-9")?.classList.contains("border")).toBe(
      true,
    );
  });
  it("uma cor desconhecida faz a fileira inteira usar texto, sem misturar bolinhas", () => {
    const host = montar(["Azul", "Estampado"]);
    expect(host.querySelector("[style]")).toBeNull();
    expect(host.textContent).toContain("Azul");
    expect(host.textContent).toContain("Estampado");
    expect(
      host
        .querySelector('button[aria-label="Azul"]')
        ?.classList.contains("min-w-[72px]"),
    ).toBe(true);
  });
});
