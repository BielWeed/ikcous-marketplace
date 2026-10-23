// Financeiro redesenhado (22/10/2026): duas guardas que o jsdom não dá.
//
// 1) Classe que não gera CSS some em silêncio no jsdom (ele não vê CSS): botão
//    redondo sem posição, aba sem traço, valor sem tamanho. Aqui o Tailwind do
//    projeto é COMPILADO com as classes da casca e da Visão novas, e cada
//    classe tem de aparecer como regra — inclusive os valores arbitrários com
//    `calc()` do botão redondo e do respiro do conteúdo.
// 2) Dourado: o Financeiro não usa dourado em botão, aba ou seleção (ordem do
//    dono, 22/10/2026). O primário é neutro de alto contraste.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  CLASSE_ABA_DO_FINANCEIRO,
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_REDONDO_DO_FINANCEIRO,
  CLASSE_CHIP,
  CLASSE_CHIP_COMUM,
  CLASSE_CHIP_SELECIONADO,
} from "@/components/admin/financeiro/partes";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
// O `tailwind.config.js` é CommonJS num pacote ESM: o carregador do próprio
// Tailwind (jiti) sabe lê-lo, o `require` direto não.
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

const PASTA = "src/components/admin/financeiro";
const VIEW = "src/views/admin/AdminFinanceiroView.tsx";
const ARQUIVOS_DA_CASCA = [
  `${PASTA}/AbaVisao.tsx`,
  `${PASTA}/FluxoDeCaixaGrafico.tsx`,
  `${PASTA}/SeletorDePeriodo.tsx`,
  VIEW,
];

/** Classes da casa (CSS próprio, não são utilitários do Tailwind). */
const CLASSES_DA_CASA = new Set(["pb-admin", "no-scrollbar", "group"]);

// Como o Tailwind escreve o seletor: barra invertida antes do símbolo; a
// vírgula vira o código hexadecimal 2c, com espaço no fim.
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
    // Frase de tela ("Saldo ao fim do dia") tem palavra sem hífen, sem `:` e
    // sem `[`; classe de verdade tem ao menos uma ficha assim, e todas as
    // fichas só usam o alfabeto do Tailwind.
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
      // Uma entrada por classe: o extrator confunde `>` de `[&>svg]:…` com fim
      // de tag e engoliria as classes seguintes.
      content: classes.map((classe) => ({
        raw: `<div class="${classe}"></div>`,
        extension: "html",
      })),
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return resultado.css;
}

describe("Financeiro — toda classe da casca e da Visão novas gera CSS", () => {
  const constantes = [
    CLASSE_ABA_DO_FINANCEIRO,
    CLASSE_BOTAO_PRIMARIO,
    CLASSE_BOTAO_REDONDO_DO_FINANCEIRO,
    CLASSE_CHIP,
    CLASSE_CHIP_COMUM,
    CLASSE_CHIP_SELECIONADO,
  ];
  // Classes escritas em `cn(…)` de ficha única, que a varredura de literais
  // (2+ fichas) não pega.
  const EXTRAS = [
    "bg-emerald-400/10",
    "bg-red-400/10",
    "bg-white/5",
    "text-white",
    "text-emerald-400",
    "text-red-400",
    "text-zinc-400",
    "pb-[calc(var(--admin-tab-pb,6.25rem)_+_4rem)]",
    "lg:pb-28",
  ];

  const usadas = (() => {
    const todas = new Set<string>(EXTRAS);
    for (const texto of constantes) {
      for (const t of texto.split(/\s+/).filter(Boolean)) todas.add(t);
    }
    for (const arquivo of ARQUIVOS_DA_CASCA) {
      for (const classe of classesDe(ler(arquivo))) todas.add(classe);
    }
    return [...todas].filter((c) => !CLASSES_DA_CASA.has(c));
  })();

  it("a varredura achou as classes (controle de que ela não ficou cega)", () => {
    expect(usadas.length).toBeGreaterThan(120);
    for (const esperada of [
      "size-14",
      "border-b-2",
      "data-[state=active]:border-foreground",
      "bg-foreground",
      "text-[clamp(2rem,10vw,2.75rem)]",
      "min-h-[7.5rem]",
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
    const css = await compilar(["bg-admin-text", "size-14"]);
    expect(css).not.toContain(".bg-admin-text");
    expect(css).toContain(".size-14");
  });

  it("o botão redondo sobe da reserva do painel e o conteúdo ganha folga, com os espaços do calc() certos", async () => {
    const css = await compilar([
      "bottom-[calc(var(--admin-tab-pb,6.25rem)_-_0.5rem)]",
      "pb-[calc(var(--admin-tab-pb,6.25rem)_+_4rem)]",
    ]);
    // Sem espaço em volta do `-`/`+` o navegador descarta o `calc()` inteiro e
    // o botão cai para `bottom: auto` (por baixo da barra de baixo).
    expect(css).toContain("calc(var(--admin-tab-pb,6.25rem) - 0.5rem)");
    expect(css).toContain("calc(var(--admin-tab-pb,6.25rem) + 4rem)");
  });

  it("a aba ativa fica só com o traço de baixo: `border-0` vem antes de `border-b-2` na folha", async () => {
    const css = await compilar(["border-0", "border-b-2", "border-solid"]);
    expect(css.indexOf(".border-0")).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(".border-b-2")).toBeGreaterThan(
      css.indexOf(".border-0"),
    );
    // A base do TabsTrigger traz `border`; o `cn()` (tailwind-merge) a descarta
    // por causa do `border-0` que vem depois.
    expect(CLASSE_ABA_DO_FINANCEIRO).toContain("border-0 border-b-2");
  });
});

describe("Financeiro — sem dourado em botão, aba ou seleção", () => {
  const PROIBIDOS =
    /admin-gold|#F9D65B|#F9D65C|#EABD28|#E4AF16|#F4C43F|#FFBF00|#e3c25e|#e2c04a|yellow-/i;

  it("o primário é neutro de alto contraste (bg-foreground / text-background), sem degradê", () => {
    expect(CLASSE_BOTAO_PRIMARIO).toContain("bg-foreground");
    expect(CLASSE_BOTAO_PRIMARIO).toContain("text-background");
    expect(CLASSE_BOTAO_PRIMARIO).not.toMatch(
      /gradient|from-|to-|#[0-9a-f]{6}/i,
    );
    expect(CLASSE_BOTAO_PRIMARIO).not.toMatch(PROIBIDOS);
  });

  it("aba, chip e botão redondo não têm nenhuma ficha dourada", () => {
    for (const texto of [
      CLASSE_ABA_DO_FINANCEIRO,
      CLASSE_CHIP,
      CLASSE_CHIP_COMUM,
      CLASSE_CHIP_SELECIONADO,
      CLASSE_BOTAO_REDONDO_DO_FINANCEIRO,
    ]) {
      expect(texto).not.toMatch(PROIBIDOS);
    }
  });

  it("nenhum arquivo do Financeiro (pasta e tela) usa dourado", () => {
    const arquivos = [
      ...readdirSync(join(raiz, PASTA))
        .filter((nome) => /\.(tsx?|css)$/.test(nome))
        .map((nome) => `${PASTA}/${nome}`),
      VIEW,
    ];
    expect(arquivos.length).toBeGreaterThan(15);
    for (const arquivo of arquivos) {
      expect(ler(arquivo), arquivo).not.toMatch(PROIBIDOS);
    }
  });
});
