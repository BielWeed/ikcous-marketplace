// Financeiro redesenhado (23/10/2026) — aba Resultado: toda classe nova gera CSS.
//
// O jsdom não vê CSS: classe que o Tailwind do projeto não conhece some em
// silêncio (borda sem cor, canto sem arredondar, valor sem tamanho). Aqui o
// Tailwind é COMPILADO com as classes da aba e cada uma tem de virar regra.
// Segue o molde de `financeiro-classes-geram-css-e-sem-dourado.test.ts`.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  classeDoValorDoQuadro,
  classeDoValorNaTabela,
} from "@/components/admin/financeiro/partesDoResultado";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

const PASTA = "src/components/admin/financeiro";
const ARQUIVOS = [
  `${PASTA}/AbaDre.tsx`,
  `${PASTA}/partesDoResultado.tsx`,
  `${PASTA}/tamanhoDoValor.ts`,
];

const BARRA = String.fromCharCode(92);
const escapar = (classe: string) =>
  classe.replace(/[^a-zA-Z0-9_-]/g, (c) =>
    c === "," ? `${BARRA}2c ` : `${BARRA}${c}`,
  );

const PARECE_CLASSE = /^[!a-z0-9[\]:/%.,()&>_#*+-]+$/;

/** Classes de uma fonte: `className="…"` e todo literal com 2+ classes. */
function classesDe(fonte: string): string[] {
  const achadas = new Set<string>();
  const literais = [
    ...[...fonte.matchAll(/className="([^"]+)"/g)].map((m) => m[1] ?? ""),
    ...[...fonte.matchAll(/"([^"\n]+)"/g)].map((m) => m[1] ?? ""),
  ];
  for (const literal of literais) {
    const tokens = literal.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    if (!tokens.every((t) => PARECE_CLASSE.test(t))) continue;
    if (!tokens.some((t) => /[-:[]/.test(t))) continue;
    for (const t of tokens) achadas.add(t);
  }
  return [...achadas];
}

async function compilar(classes: readonly string[]): Promise<string> {
  const tailwind = exigir("tailwindcss");
  const config = carregarConfig(join(raiz, "tailwind.config.js"));
  const resultado = await postcss([
    tailwind({
      ...config,
      content: classes.map((classe) => ({
        raw: `<div class="${classe}"></div>`,
        extension: "html",
      })),
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return resultado.css;
}

/** Fichas únicas de `cn(…)` e as faixas de tamanho do valor (saem de funções). */
const EXTRAS = [
  "rounded-l-2xl",
  "rounded-r-2xl",
  "border-l",
  "border-r",
  "border-y",
  "border-t",
  "border-b",
  "border-solid",
  "border-separate",
  "border-spacing-0",
  "border-admin-border",
  "border-admin-border-strong",
  "bg-admin-raised",
  "bg-amber-400/10",
  "text-amber-400",
  "text-emerald-400",
  "text-red-400",
  "text-zinc-400",
  "text-white",
  "whitespace-nowrap",
  "tabular-nums",
  "text-[22px]",
  "text-[20px]",
  "text-[18px]",
  "text-[15px]",
  "text-[13px]",
  "text-[11px]",
  "text-xs",
  "text-sm",
  "text-base",
  "w-14",
  "pl-7",
  "pl-6",
  "pl-4",
  "pr-4",
  "py-2.5",
  "h-3",
  "p-3.5",
  "grid-cols-2",
  "lg:grid-cols-4",
  "h-[7.5rem]",
  "h-[34rem]",
];

describe("Financeiro — toda classe da aba Resultado gera CSS", () => {
  const usadas = (() => {
    const todas = new Set<string>(EXTRAS);
    for (const arquivo of ARQUIVOS) {
      for (const classe of classesDe(ler(arquivo))) todas.add(classe);
    }
    // As classes que as funções de tamanho de verdade devolvem.
    for (const valor of [0, 5, 99, 1234.5, -1234.5, 123456.78, 1234567.89]) {
      for (const texto of [
        classeDoValorDoQuadro(valor, false),
        classeDoValorNaTabela(valor, false, false),
        classeDoValorNaTabela(valor, true, false),
        classeDoValorDoQuadro(valor, true),
        classeDoValorNaTabela(valor, false, true),
        classeDoValorNaTabela(valor, true, true),
      ]) {
        for (const t of texto.split(/\s+/).filter(Boolean)) todas.add(t);
      }
    }
    return [...todas];
  })();

  it("a varredura achou as classes (controle de que ela não ficou cega)", () => {
    expect(usadas.length).toBeGreaterThan(60);
    for (const esperada of [
      "border-separate",
      "rounded-l-2xl",
      "text-[22px]",
      "text-[13px]",
      "whitespace-nowrap",
      "bg-amber-400/10",
    ]) {
      expect(usadas, esperada).toContain(esperada);
    }
  });

  it("cada classe aparece como regra no Tailwind compilado", async () => {
    const css = await compilar(usadas);
    const semRegra = usadas.filter((c) => !css.includes(`.${escapar(c)}`));
    expect(
      semRegra,
      "classe sem regra no Tailwind (ela não existe no tema do projeto)",
    ).toEqual([]);
  });

  it("o controle do teste: uma classe inventada É pega", async () => {
    const css = await compilar(["bg-admin-text", "rounded-l-2xl"]);
    expect(css).not.toContain(".bg-admin-text");
    expect(css).toContain(".rounded-l-2xl");
  });

  it("valor nunca quebra de linha e encolhe pelo tamanho do texto", () => {
    const tamanho = (texto: string) =>
      texto.split(" ").find((c) => /^text-(\[\d+px\]|xs|sm|base)$/.test(c));
    for (const valor of [0, 99, 1234.5, 123456.78, 1234567.89]) {
      expect(classeDoValorDoQuadro(valor, false)).toContain(
        "whitespace-nowrap",
      );
      expect(classeDoValorNaTabela(valor, false, false)).toContain(
        "whitespace-nowrap",
      );
      expect(classeDoValorNaTabela(valor, true, false)).toContain(
        "whitespace-nowrap",
      );
    }
    // "R$ 99,00" = 8 caracteres: 22px. "R$ 1.234.567,89" = 15: o menor.
    expect(tamanho(classeDoValorDoQuadro(99, false))).toBe("text-[22px]");
    expect(tamanho(classeDoValorDoQuadro(123.4, false))).toBe("text-[20px]");
    expect(tamanho(classeDoValorDoQuadro(1234.5, false))).toBe("text-[15px]");
    expect(tamanho(classeDoValorDoQuadro(123456.78, false))).toBe(
      "text-[13px]",
    );
    expect(tamanho(classeDoValorDoQuadro(1234567.89, false))).toBe("text-xs");
    // Negativo ganha o caractere do sinal e desce uma faixa mais cedo.
    expect(tamanho(classeDoValorDoQuadro(-99, false))).toBe("text-[20px]");
    // Tabela: 14px normal, 13px com 12–13 caracteres, 12px acima disso.
    expect(tamanho(classeDoValorNaTabela(99, false, false))).toBe("text-sm");
    expect(tamanho(classeDoValorNaTabela(-12345.67, false, false))).toBe(
      "text-[13px]",
    );
    expect(tamanho(classeDoValorNaTabela(1234567.89, false, false))).toBe(
      "text-xs",
    );
    expect(tamanho(classeDoValorNaTabela(99, true, false))).toBe("text-base");
  });
});
