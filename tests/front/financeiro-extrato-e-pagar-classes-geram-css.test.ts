// Financeiro — Extrato e Pagar e receber (23/10/2026): toda classe das duas
// abas novas tem de gerar CSS de verdade.
//
// O jsdom não vê CSS: uma classe inventada some em silêncio (valor sem
// tamanho, pílula sem borda, quadro sem fundo). Aqui o Tailwind do projeto é
// COMPILADO com as classes dessas abas e cada uma tem de aparecer como regra.
// Mesma técnica de `financeiro-classes-geram-css-e-sem-dourado.test.ts`.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  CLASSE_CARTAO_DA_LISTA,
  CLASSE_CARTAO_DO_TOPO,
  CLASSE_PILULA_PRIMARIA,
  CLASSE_PILULA_SECUNDARIA,
  CLASSE_QUADRO_INTERNO,
  CLASSE_QUADRO_VENCIDO,
  CLASSE_ROTULO_CAIXA_ALTA,
  classeDoValorDaLinha,
  classeDoValorDoTopo,
  classeDoValorNoQuadro,
  tituloDoDia,
} from "@/components/admin/financeiro/partesDoExtrato";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

const PASTA = "src/components/admin/financeiro";
const ARQUIVOS = [
  `${PASTA}/AbaExtrato.tsx`,
  `${PASTA}/AbaPrevistos.tsx`,
  `${PASTA}/partesDoExtrato.tsx`,
];

const BARRA = String.fromCharCode(92);
const escapar = (classe: string) =>
  classe.replace(/[^a-zA-Z0-9_-]/g, (c) =>
    c === "," ? `${BARRA}2c ` : `${BARRA}${c}`,
  );

const PARECE_CLASSE = /^[!a-z0-9[\]:/%.,()&>_#*+-]+$/;

/** Classes de uma fonte: `className="…"` e todo literal com 2+ fichas. */
function classesDe(fonte: string): string[] {
  const achadas = new Set<string>();
  const literais = [
    ...[...fonte.matchAll(/className="([^"]+)"/g)].map((m) => m[1] ?? ""),
    ...[...fonte.matchAll(/"([^"\n]+)"/g)].map((m) => m[1] ?? ""),
  ];
  for (const literal of literais) {
    const fichas = literal.split(/\s+/).filter(Boolean);
    if (fichas.length < 2) continue;
    if (!fichas.every((t) => PARECE_CLASSE.test(t))) continue;
    if (!fichas.some((t) => /[-:[]/.test(t))) continue;
    for (const t of fichas) achadas.add(t);
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

describe("Financeiro — Extrato e Pagar e receber: toda classe gera CSS", () => {
  const constantes = [
    CLASSE_CARTAO_DA_LISTA,
    CLASSE_CARTAO_DO_TOPO,
    CLASSE_PILULA_PRIMARIA,
    CLASSE_PILULA_SECUNDARIA,
    CLASSE_QUADRO_INTERNO,
    CLASSE_QUADRO_VENCIDO,
    CLASSE_ROTULO_CAIXA_ALTA,
  ];
  // Tamanhos que o código escolhe por número de caracteres (nunca quebra).
  const dinamicas = [
    ...[0, 5, 99, 1234.56, 12345.67, 1234567.89].flatMap((v) => [
      classeDoValorDaLinha(v, true),
      classeDoValorDoTopo(v, true),
      classeDoValorNoQuadro(v, false),
    ]),
    classeDoValorNoQuadro(123456789012.34, false),
  ];

  const usadas = (() => {
    const todas = new Set<string>([
      // Classes de ficha única (`cn(…)`) que a varredura de 2+ fichas não pega.
      "text-white",
      "text-zinc-300",
      "text-zinc-400",
      "text-red-400",
      "text-amber-400",
      "text-emerald-400",
      "whitespace-nowrap",
      "shrink-0",
      "truncate",
      "opacity-0",
      "size-full",
      "line-through",
    ]);
    for (const texto of [...constantes, ...dinamicas]) {
      for (const t of texto.split(/\s+/).filter(Boolean)) todas.add(t);
    }
    for (const arquivo of ARQUIVOS) {
      for (const classe of classesDe(ler(arquivo))) todas.add(classe);
    }
    return [...todas];
  })();

  it("a varredura achou as classes (controle de que ela não ficou cega)", () => {
    expect(usadas.length).toBeGreaterThan(60);
    for (const esperada of [
      "rounded-full",
      "border-solid",
      "bg-foreground",
      "text-background",
      "border-t",
      "first:border-t-0",
      "text-[clamp(2rem,10vw,2.75rem)]",
      "text-[clamp(1.5rem,7vw,2rem)]",
      "text-[22px]",
      "text-[18px]",
      "text-[13px]",
      "focus-within:ring-2",
      "bg-red-400/10",
      "border-red-400/25",
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
    const css = await compilar(["bg-admin-text", "rounded-full"]);
    expect(css).not.toContain(".bg-admin-text");
    expect(css).toContain(".rounded-full");
  });

  it("valor em dinheiro nunca quebra: toda faixa de tamanho traz `whitespace-nowrap`", () => {
    for (const v of [
      0, 5, 99, 1234.56, 12345.67, 1234567.89, 123456789012.34,
    ]) {
      expect(classeDoValorDaLinha(v, true)).toContain("whitespace-nowrap");
      expect(classeDoValorDoTopo(v, true)).toContain("whitespace-nowrap");
      expect(classeDoValorNoQuadro(v, true)).toContain("whitespace-nowrap");
    }
  });

  it("o tamanho encolhe com o comprimento: 22px normal, 20/18px quando passa de ~9 caracteres, nunca maior que antes", () => {
    // "R$ 5,00" (7) · "R$ 100,00" (9) · "R$ 1.250,00" (11) · "R$ 12.345,67" (12).
    expect(classeDoValorNoQuadro(5, false)).toContain("text-[22px]");
    expect(classeDoValorNoQuadro(100, false)).toContain("text-[20px]");
    expect(classeDoValorNoQuadro(1250, false)).toContain("text-[15px]");
    expect(classeDoValorNoQuadro(12345.67, false)).toContain("text-[15px]");
    // Com sinal o texto ganha um caractere: "+R$ 100,00" (10) → 18px.
    expect(classeDoValorNoQuadro(100, true)).toContain("text-[18px]");
    // Linha da lista: 18px até 9 caracteres, depois 16px, depois 14px.
    expect(classeDoValorDaLinha(100, false)).toContain("text-[18px]");
    expect(classeDoValorDaLinha(100, true)).toContain("text-base");
    expect(classeDoValorDaLinha(1234567.89, true)).toContain("text-sm");
  });

  it("o título do dia: Hoje e Ontem sem o dia da semana; os outros ficam por extenso", () => {
    expect(
      tituloDoDia("2026-10-23", "2026-10-23", "Sexta-feira, 23 de outubro"),
    ).toBe("Hoje · 23 de outubro");
    expect(
      tituloDoDia("2026-10-22", "2026-10-23", "Quinta-feira, 22 de outubro"),
    ).toBe("Ontem · 22 de outubro");
    // Virada de mês: ontem de 1º de novembro é 31 de outubro.
    expect(
      tituloDoDia("2026-10-31", "2026-11-01", "Sábado, 31 de outubro"),
    ).toBe("Ontem · 31 de outubro");
    expect(
      tituloDoDia("2026-10-20", "2026-10-23", "Terça-feira, 20 de outubro"),
    ).toBe("Terça-feira, 20 de outubro");
    // Dia futuro (previsto) nunca vira "Hoje".
    expect(
      tituloDoDia("2026-10-24", "2026-10-23", "Sábado, 24 de outubro"),
    ).toBe("Sábado, 24 de outubro");
  });

  it("sem dourado nem degradê nas peças novas", () => {
    const PROIBIDOS =
      /admin-gold|#F9D65B|#F9D65C|#EABD28|#E4AF16|#F4C43F|#FFBF00|#e3c25e|#e2c04a|yellow-|gradient/i;
    for (const arquivo of ARQUIVOS) {
      expect(ler(arquivo), arquivo).not.toMatch(PROIBIDOS);
    }
    expect(CLASSE_PILULA_PRIMARIA).toContain("bg-foreground");
    expect(CLASSE_PILULA_PRIMARIA).toContain("text-background");
  });
});
