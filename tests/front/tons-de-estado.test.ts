// Fundação das cores de estado: verde = positivo, vermelho = negativo,
// âmbar = atenção, azul = informação, cinza = neutro. Contraste WCAG AA
// (>= 4.5:1) medido com os hex reais do Tailwind v3 sobre o fundo de cada
// superfície (painel #0B0B0D, loja #FFFFFF).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type Superficie,
  type TomDeEstado,
  classeDoIcone,
  classeDoPonto,
  classeDoTexto,
  tomDoValor,
} from "@/lib/tons-de-estado";

const TONS: TomDeEstado[] = [
  "positivo",
  "negativo",
  "atencao",
  "info",
  "neutro",
];

describe("tomDoValor", () => {
  it("separa positivo, negativo e neutro", () => {
    expect(tomDoValor(10)).toBe("positivo");
    expect(tomDoValor(-0.01)).toBe("negativo");
    expect(tomDoValor(0)).toBe("neutro");
    expect(tomDoValor(null)).toBe("neutro");
    expect(tomDoValor(undefined)).toBe("neutro");
    expect(tomDoValor(Number.NaN)).toBe("neutro");
  });
  it("invertido troca positivo e negativo, mantém neutro", () => {
    expect(tomDoValor(5, { invertido: true })).toBe("negativo");
    expect(tomDoValor(-5, { invertido: true })).toBe("positivo");
    expect(tomDoValor(0, { invertido: true })).toBe("neutro");
  });
});

describe("classes por tom", () => {
  it("painel usa -400 e loja usa -700/-600, literais e distintas", () => {
    expect(TONS.map((t) => classeDoTexto(t))).toEqual([
      "text-emerald-400",
      "text-red-400",
      "text-amber-400",
      "text-sky-400",
      "text-zinc-400",
    ]);
    expect(TONS.map((t) => classeDoTexto(t, "loja"))).toEqual([
      "text-emerald-700",
      "text-red-700",
      "text-amber-700",
      "text-sky-700",
      "text-zinc-600",
    ]);
    expect(TONS.map((t) => classeDoPonto(t))).toEqual([
      "bg-emerald-400",
      "bg-red-400",
      "bg-amber-400",
      "bg-sky-400",
      "bg-zinc-400",
    ]);
    expect(TONS.map((t) => classeDoPonto(t, "loja"))).toEqual([
      "bg-emerald-600",
      "bg-red-600",
      "bg-amber-600",
      "bg-sky-600",
      "bg-zinc-600",
    ]);
    for (const s of ["painel", "loja"] as Superficie[]) {
      expect(new Set(TONS.map((t) => classeDoIcone(t, s))).size).toBe(5);
    }
    expect(classeDoIcone("positivo")).toBe(classeDoTexto("positivo"));
  });
});

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("contraste WCAG AA (>= 4.5:1)", () => {
  const painel: Record<string, string> = {
    "text-emerald-400": "#34d399",
    "text-red-400": "#f87171",
    "text-amber-400": "#fbbf24",
    "text-sky-400": "#38bdf8",
    "text-zinc-400": "#a1a1aa",
  };
  const loja: Record<string, string> = {
    "text-emerald-700": "#047857",
    "text-red-700": "#b91c1c",
    "text-amber-700": "#b45309",
    "text-sky-700": "#0369a1",
    "text-zinc-600": "#52525b",
  };
  it("vermelho do Confortável tem contraste nas superfícies reais sem mudar os outros temas", () => {
    const css = readFileSync(
      "src/components/layouts/temas-do-painel.css",
      "utf8",
    );
    const regra = css.match(
      /:where\(html\.admin-mode\[data-admin-tema="confortavel"\]\)\s+\.text-red-400:where\([^{}]+\)\s*\{\s*color:\s*(#[a-f0-9]{6})/,
    );
    expect(regra).not.toBeNull();
    const vermelho = regra?.[1] ?? "#f87171";
    for (const fundo of [
      "#24211c",
      "#2f2b25",
      "#3a352e",
      "#433c34",
      "#36363d",
    ]) {
      expect(contraste(vermelho, fundo), fundo).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).not.toMatch(/data-admin-tema="claro"[^{}]+\.text-red-400/);
    expect(contraste("#b91c1c", "#e9e9ee")).toBeGreaterThanOrEqual(4.5);
  });

  it("painel sobre #0B0B0D", () => {
    for (const t of TONS) {
      const hex = painel[classeDoTexto(t, "painel")];
      expect(contraste(hex, "#0B0B0D")).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("loja sobre #FFFFFF", () => {
    for (const t of TONS) {
      const hex = loja[classeDoTexto(t, "loja")];
      expect(contraste(hex, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    }
  });
});
