// Financeiro — aba Caixa redesenhada (22/10/2026): toda classe nova gera CSS.
//
// O jsdom não vê CSS, então classe inventada some em silêncio (pílula sem fundo,
// valor sem tamanho, botão sem borda). Aqui o Tailwind do projeto é COMPILADO
// com as classes da aba Caixa e de `partesDoCaixa`, e cada uma tem de aparecer
// como regra. Mesma técnica de `financeiro-classes-geram-css-e-sem-dourado`
// (arquivo do outro lote; este é o do Caixa).
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  CLASSE_BOTAO_DA_GAVETA,
  CLASSE_BOTAO_PRINCIPAL_DA_GAVETA,
  CLASSE_CARTAO_DO_CAIXA,
  CLASSE_ROTULO_CAIXA_ALTA,
  classeDoValorDaLinha,
  classeDoValorDoHeroi,
  classeDoValorNaColuna,
} from "@/components/admin/financeiro/partesDoCaixa";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

const PASTA = "src/components/admin/financeiro";
const ARQUIVOS_DO_CAIXA = [
  `${PASTA}/AbaCaixa.tsx`,
  `${PASTA}/partesDoCaixa.tsx`,
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

/** Classes escritas sozinhas em `cn(…)`/tabelas, que a varredura de literais não pega. */
const EXTRAS = [
  "bg-emerald-400/10",
  "bg-red-400/10",
  "bg-amber-400/10",
  "bg-sky-400/10",
  "bg-white/5",
  "text-white",
  "text-emerald-400",
  "text-red-400",
  "text-amber-400",
  "text-zinc-400",
  "text-base",
  "text-sm",
  "text-xs",
  "text-[15px]",
  "text-[13px]",
  "text-[11px]",
  "text-[clamp(2rem,10vw,2.75rem)]",
  "text-[clamp(1.5rem,7vw,2rem)]",
  "whitespace-nowrap",
  "shrink-0",
  "col-span-2",
  "border-solid",
  "min-h-12",
  "grid-cols-3",
  "-mt-2",
  "first:border-t-0",
  "first:pt-0",
  "last:pb-0",
];

const usadas = (() => {
  const todas = new Set<string>(EXTRAS);
  for (const texto of [
    CLASSE_BOTAO_DA_GAVETA,
    CLASSE_BOTAO_PRINCIPAL_DA_GAVETA,
    CLASSE_CARTAO_DO_CAIXA,
    CLASSE_ROTULO_CAIXA_ALTA,
    // Tudo que as medidas podem devolver, de valores pequenos a gigantes.
    ...[
      0, 5, 412.5, 1412.5, 12412.5, 123456.78, 1234567.89, 99999999.99,
    ].flatMap((v) => [
      classeDoValorNaColuna(v, false, false),
      classeDoValorNaColuna(v, true, false),
      classeDoValorDaLinha(v, false, false),
      classeDoValorDaLinha(v, true, false),
      classeDoValorDoHeroi(v, false),
      // Com Ocultar ligado o tamanho é o da máscara.
      classeDoValorNaColuna(v, true, true),
      classeDoValorDaLinha(v, true, true),
      classeDoValorDoHeroi(v, true),
    ]),
  ]) {
    for (const t of texto.split(/\s+/).filter(Boolean)) todas.add(t);
  }
  for (const arquivo of ARQUIVOS_DO_CAIXA) {
    for (const classe of classesDe(ler(arquivo))) todas.add(classe);
  }
  return [...todas];
})();

describe("Financeiro — toda classe da aba Caixa nova gera CSS", () => {
  it("a varredura achou as classes (controle de que ela não ficou cega)", () => {
    expect(usadas.length).toBeGreaterThan(60);
    for (const esperada of [
      "rounded-full",
      "rounded-3xl",
      "border-solid",
      "min-h-12",
      "bg-amber-400/10",
      "grid-cols-3",
      "text-[11px]",
      "bg-foreground",
      "text-[clamp(2rem,10vw,2.75rem)]",
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
    const css = await compilar(["bg-admin-pilula", "min-h-12"]);
    expect(css).not.toContain(".bg-admin-pilula");
    expect(css).toContain(".min-h-12");
  });

  it("o botão secundário tem borda sólida explícita e alvo de 48px (o index.css zera a borda de todo <button>)", () => {
    expect(CLASSE_BOTAO_DA_GAVETA).toContain("border border-solid");
    expect(CLASSE_BOTAO_DA_GAVETA).toContain("min-h-12");
    expect(CLASSE_BOTAO_PRINCIPAL_DA_GAVETA).toContain("min-h-12");
    expect(CLASSE_BOTAO_PRINCIPAL_DA_GAVETA).not.toContain("min-h-14");
    expect(CLASSE_BOTAO_PRINCIPAL_DA_GAVETA).toContain("bg-foreground");
  });

  it("nenhum valor de dinheiro devolve classe sem nowrap", () => {
    for (const v of [0, 412.5, 123456.78, 99999999.99]) {
      for (const c of [
        classeDoValorNaColuna(v, false, false),
        classeDoValorDaLinha(v, true, false),
        classeDoValorDoHeroi(v, false),
      ]) {
        expect(c).toContain("whitespace-nowrap");
      }
    }
  });
});
