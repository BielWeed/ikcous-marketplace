// @vitest-environment jsdom
//
// P79: no computador, a Visão do Financeiro (AbaVisao + CaixaDeHoje) tinha três
// defeitos MEDIDOS de layout (nenhum de lógica, valor ou cálculo):
//  1) o cartão "Saldo total" ocupava a linha inteira (984 px a 1280, 1240 a
//     1920) com 69-76% de vazio à direita;
//  2) o botão "Fechar caixa" esticava para 842 px (1280) e 1098 px (1920);
//  3) "Entradas" e "Saídas" eram cartões de 74 px com ~500 px de vazio.
//
// Correção (só classes `lg:`/`xl:` ACRESCENTADAS; celular byte a byte igual):
//  - A raiz da Visão vira uma grade de 2 colunas em `xl` (mesma técnica do P23,
//    da aba Caixa): todo bloco continua na linha inteira (`[&>*]:col-span-2`) e
//    só "Saldo total" e "Movimentos do período" dividem a linha. A ordem do DOM
//    (foco e leitor de tela) não muda.
//  - "Entradas" e "Saídas" ficam empilhadas ao lado do saldo (`xl:grid-cols-1`)
//    e preenchem a altura dele (`xl:h-full`).
//  - O botão "Fechar caixa" deixa de crescer (`lg:flex-none`) e ganha piso de
//    16rem. (`lg:w-auto` sozinho não bastaria: `flex-1` manda no tamanho de um
//    item de flex, não a largura.)
//
// jsdom não calcula layout. As provas: (a) o celular congelado à mão a partir
// da base 1555c0d30 (tudo que não é lg/xl/2xl); (b) os tokens novos são
// exatamente os planejados e estão no elemento certo; (c) o Tailwind REAL do
// projeto gera as regras; (d) o seletor de cada regra de coluna acerta UM só
// filho da raiz no DOM de verdade (nem "Saldo por conta", nem outro bloco).
// A conta de largura em navegador real foi feita à parte (relatório do P79).
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { parseResumo } from "@/lib/financeiro";
import { classesDoCelular } from "./classes-do-celular";
import { CAIXA_FECHADO_DA_VISAO } from "./helpers/caixa-da-visao";

const raiz = join(__dirname, "..", "..");
const ABA_VISAO = "src/components/admin/financeiro/AbaVisao.tsx";
const CAIXA_DE_HOJE = "src/components/admin/financeiro/CaixaDeHoje.tsx";
const lerFonte = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");
const FONTE_VISAO = lerFonte(ABA_VISAO);
const FONTE_CAIXA = lerFonte(CAIXA_DE_HOJE);

// --- O que a base 1555c0d30 tinha, sem nenhum token lg/xl/2xl (celular) ------
// Gerado da base com a mesma função `celularDoArquivo` abaixo.
const CELULAR_ABA_VISAO = [
  "min-w-0 rounded-3xl border border-admin-border bg-admin-surface p-3",
  "text-xs font-semibold uppercase tracking-wide text-zinc-400",
  "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
  "positivo",
  "bg-emerald-400/10",
  "negativo",
  "bg-red-400/10",
  "neutro",
  "bg-white/5",
  "size-3.5 shrink-0",
  "min-w-0",
  "whitespace-nowrap",
  "h-full",
  "flex h-full min-h-[7.5rem] w-full flex-col gap-1.5 text-left transition-colors hover:bg-admin-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
  "flex items-center gap-0.5",
  "size-3.5 shrink-0",
  "saida",
  "flex min-w-0 flex-col gap-1 text-xs",
  "inline-flex w-fit max-w-full flex-wrap items-baseline gap-x-1 rounded-full bg-red-400/10 px-2 py-0.5 font-semibold",
  "negativo",
  "whitespace-nowrap",
  "text-zinc-400",
  "flex flex-wrap items-baseline gap-x-1 text-zinc-400",
  "whitespace-nowrap",
  "sr-only",
  "text-xs text-zinc-400",
  "flex flex-col gap-3.5",
  "flex flex-col gap-1.5",
  "flex items-baseline justify-between gap-3 text-sm",
  "break-words font-semibold text-zinc-200",
  "mr-1.5",
  "shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-400",
  "whitespace-nowrap text-sm font-bold text-white",
  "h-1.5 w-full overflow-hidden rounded-full bg-white/5",
  "h-full rounded-full",
  "min-w-0",
  "flex items-center gap-1.5 text-xs font-semibold text-zinc-300",
  "size-2 shrink-0 rounded-full",
  "min-w-0 break-words",
  "mt-1 text-sm font-bold tabular-nums text-white",
  "whitespace-nowrap",
  "whitespace-nowrap font-normal text-zinc-400",
  "text-xs text-zinc-400",
  "flex flex-col gap-3.5",
  "flex h-3 w-full gap-0.5 overflow-hidden rounded-full",
  "h-full rounded-l-full",
  "h-full rounded-r-full",
  "grid grid-cols-2 gap-3",
  "flex flex-col gap-4",
  "sr-only",
  "h-[12.8rem] rounded-[20px] bg-white/5",
  "h-[11.5rem] rounded-3xl bg-white/5",
  "grid grid-cols-2 gap-3",
  "h-[5.5rem] rounded-3xl bg-white/5",
  "h-[5.5rem] rounded-3xl bg-white/5",
  "grid grid-cols-2 gap-3",
  "h-[7.5rem] rounded-3xl bg-white/5",
  "h-[7.5rem] rounded-3xl bg-white/5",
  "h-16 rounded-full bg-white/5",
  "h-52 rounded-3xl bg-white/5",
  "flex flex-col gap-4",
  "flex flex-col items-start gap-3 rounded-3xl border border-admin-border bg-admin-surface p-5",
  "negativo",
  "text-white",
  "text-xs text-zinc-400",
  "grid grid-cols-2 gap-3",
  "mt-2",
  "mt-2",
  "grid grid-cols-2 gap-3",
  "size-4",
  "flex flex-col",
  "flex min-h-12 min-w-0 items-center justify-between gap-3 border-t border-admin-border py-2 first:border-t-0",
  "flex min-w-0 items-center gap-2.5 text-sm text-zinc-200",
  "size-4 shrink-0 text-zinc-400",
  "break-words",
  "shrink-0 whitespace-nowrap text-sm font-bold",
  "sr-only",
  "grid grid-cols-1 gap-4",
  "text-xs text-zinc-400",
];
const CELULAR_CAIXA_DE_HOJE = [
  "text-emerald-800 [html[data-admin-tema=claro]_&]:text-emerald-400",
  "bg-emerald-700 [html[data-admin-tema=claro]_&]:bg-emerald-400",
  "text-red-700 [html[data-admin-tema=claro]_&]:text-red-400",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground active:scale-[0.98]",
  "inline-flex h-[52px] min-w-0 flex-1 items-center justify-center rounded-2xl bg-background px-4 text-[15px] font-semibold text-foreground transition-opacity hover:opacity-90",
  "inline-flex h-[52px] shrink-0 items-center justify-center rounded-2xl border border-solid border-background/40 px-4 text-[15px] font-semibold text-background transition-colors hover:bg-background/10",
  "sr-only",
  "h-[12.8rem] rounded-[20px] bg-white/5",
  "flex min-w-0 flex-col gap-4 rounded-[20px] bg-foreground p-5 text-background",
  "flex items-center justify-between gap-3",
  "font-mono text-[11px] uppercase tracking-[0.12em] text-background/70",
  "inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold",
  "text-background/70",
  "size-2 shrink-0 rounded-full",
  "bg-background/60",
  "flex min-w-0 flex-col gap-1.5",
  "text-sm text-background/70",
  "text-sm font-semibold text-background/70",
  "break-words text-sm text-background/70",
  "whitespace-nowrap",
  "whitespace-nowrap",
  "text-[28px] font-bold leading-tight tracking-tight",
  "text-sm text-background/70",
  "flex gap-2",
  "flex min-w-0 flex-col gap-4",
];

// --- Tags e textos fixos do JSX na base (nada de elemento ou frase novos) -----
const ESTRUTURA_ABA_VISAO = {
  tags: {
    AppVersusLoja: 1,
    CaixaDeHoje: 1,
    CartaoDePrevistos: 2,
    CartaoSecao: 4,
    ChevronRight: 1,
    Dinheiro: 10,
    EsqueletoDaVisao: 1,
    EstadoDeErro: 3,
    EstadoVazio: 1,
    EtiquetaDoResultado: 1,
    FluxoDeCaixaGrafico: 1,
    Icone: 1,
    IconeDaForma: 1,
    IconeDoTipoDeConta: 1,
    ItemDaLegendaDoCanal: 2,
    RecebimentosPorForma: 1,
    Receipt: 1,
    Skeleton: 8,
    button: 2,
    dd: 3,
    div: 17,
    dl: 2,
    dt: 3,
    h2: 1,
    li: 2,
    p: 8,
    section: 3,
    span: 12,
    ul: 2,
  },
  textos: [
    "Entrou menos saiu no período:",
    "Vencido",
    "Nada vencido",
    "Próximos 7 dias",
    "Ver contas",
    "Nenhum recebimento no período.",
    "·",
    "·",
    "Nenhuma venda recebida no período.",
    "Carregando…",
    "Saldo total · hoje",
    "Soma das contas ativas, hoje",
    "Entradas",
    "Saídas",
    "Contas e categorias",
    "Vendas entram no dia em que o pagamento foi recebido (horário de Brasília).",
  ],
};
const ESTRUTURA_CAIXA_DE_HOJE = {
  tags: {
    Dinheiro: 2,
    EstadoDeErro: 2,
    Skeleton: 1,
    button: 2,
    div: 5,
    h2: 1,
    p: 5,
    section: 1,
    span: 4,
  },
  textos: [
    "Carregando…",
    "Caixa de hoje",
    "esperado na gaveta agora",
    "Valor de antes: pode estar desatualizado, não deu para atualizar.",
    "desde",
    "·",
    "troco",
    "Caixa fechado",
    "Abra contando o troco da gaveta.",
    "Ver caixa",
  ],
};

/** Contagem de cada tag do JSX (ordem alfabética) e os textos fixos, na ordem do arquivo. */
function estruturaDoJsx(fonte: string) {
  const arvore = arvoreDe(fonte);
  const tags = new Map<string, number>();
  const textos: string[] = [];
  (function visitar(no: ts.Node) {
    if (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no)) {
      const nome = no.tagName.getText(arvore);
      tags.set(nome, (tags.get(nome) ?? 0) + 1);
    }
    if (ts.isJsxText(no) && no.text.trim()) {
      textos.push(no.text.replace(/\s+/g, " ").trim());
    }
    ts.forEachChild(no, visitar);
  })(arvore);
  return {
    tags: Object.fromEntries(
      [...tags.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    textos,
  };
}

// --- Os tokens de computador: os de ANTES e os ACRESCENTADOS pelo P79 ---------
const TOKEN_DE_ANTES_NA_VISAO = ["lg:grid-cols-2"];
const SALDO = "xl:[&>section[aria-label='Saldo_total']]:col-span-1";
const MOVIMENTOS = "xl:[&>section[aria-label^=Movimentos]]:col-span-1";
const TODOS_FILHOS = "xl:[&>*]:col-span-2";
const COLUNAS = "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]";
const NA_RAIZ = ["xl:grid", COLUNAS, TODOS_FILHOS, SALDO, MOVIMENTOS];
const NA_LISTA_DE_MOVIMENTOS = ["xl:h-full", "xl:grid-cols-1"];
const NO_BOTAO_FECHAR = ["lg:flex-none", "lg:min-w-[16rem]"];

const PREFIXOS = new Set(["lg", "xl", "2xl"]);
const dosTokensDeComputador = (texto: string) =>
  texto
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => PREFIXOS.has(t.split(":")[0]));

function arvoreDe(fonte: string) {
  return ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Dentro de `className="…"`/`cn(…)` ou de uma constante CLASSE_/TEXTO_/PONTO_. */
function literaisDeClasse(fonte: string): string[] {
  const arvore = arvoreDe(fonte);
  const achados: string[] = [];
  const dentro = (no: ts.Node) => {
    for (let pai = no.parent; pai; pai = pai.parent) {
      if (ts.isJsxAttribute(pai) && pai.name.getText(arvore) === "className") {
        return true;
      }
      if (
        ts.isVariableDeclaration(pai) &&
        /^(CLASSE|TEXTO|PONTO)_/.test(pai.name.getText(arvore))
      ) {
        return true;
      }
    }
    return false;
  };
  (function visitar(no: ts.Node) {
    if (
      (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) &&
      dentro(no)
    ) {
      achados.push(no.text);
    }
    ts.forEachChild(no, visitar);
  })(arvore);
  return achados;
}

/** O celular de um arquivo: cada literal sem lg/xl/2xl; literal que só tinha isso some. */
function celularDoArquivo(fonte: string): string[] {
  return literaisDeClasse(fonte)
    .map(classesDoCelular)
    .filter((literal) => literal !== "");
}

/** Os literais (inteiros) em que o token aparece, na ordem do arquivo. */
const literaisComToken = (fonte: string, token: string) =>
  literaisDeClasse(fonte).filter((l) => l.split(/\s+/).includes(token));

describe("P79 -- celular byte a byte igual, só tokens de computador acrescentados", () => {
  it("AbaVisao: tudo que vale abaixo de 1024 px é o da base 1555c0d30", () => {
    expect(celularDoArquivo(FONTE_VISAO)).toEqual(CELULAR_ABA_VISAO);
  });

  it("CaixaDeHoje: tudo que vale abaixo de 1024 px é o da base 1555c0d30", () => {
    expect(celularDoArquivo(FONTE_CAIXA)).toEqual(CELULAR_CAIXA_DE_HOJE);
  });

  it("controle: mudar UMA classe de celular derruba a prova (a prova não está cega)", () => {
    const mutante = FONTE_VISAO.replace(
      '"flex flex-col gap-4 xl:grid ',
      '"flex flex-col gap-5 xl:grid ',
    );
    expect(mutante).not.toBe(FONTE_VISAO);
    expect(celularDoArquivo(mutante)).not.toEqual(CELULAR_ABA_VISAO);
    const semAEscolha = FONTE_CAIXA.replace("min-w-0 flex-1", "min-w-0");
    expect(celularDoArquivo(semAEscolha)).not.toEqual(CELULAR_CAIXA_DE_HOJE);
  });

  it("os tokens de computador do arquivo são exatamente os de antes + os planejados (nenhum a mais, nenhum a menos)", () => {
    const naVisao = literaisDeClasse(FONTE_VISAO).flatMap(
      dosTokensDeComputador,
    );
    expect([...naVisao].sort()).toEqual(
      [
        ...TOKEN_DE_ANTES_NA_VISAO,
        ...NA_RAIZ,
        ...NA_LISTA_DE_MOVIMENTOS,
      ].sort(),
    );
    const noCaixa = literaisDeClasse(FONTE_CAIXA).flatMap(
      dosTokensDeComputador,
    );
    expect([...noCaixa].sort()).toEqual([...NO_BOTAO_FECHAR].sort());
  });

  it("nenhum elemento e nenhuma frase nova: as tags e os textos fixos do JSX são os da base", () => {
    expect(estruturaDoJsx(FONTE_VISAO)).toEqual(ESTRUTURA_ABA_VISAO);
    expect(estruturaDoJsx(FONTE_CAIXA)).toEqual(ESTRUTURA_CAIXA_DE_HOJE);
    // controle: um elemento a mais derruba a prova.
    expect(estruturaDoJsx(FONTE_VISAO.replace("<h2 ", "<h3 <h2 "))).not.toEqual(
      ESTRUTURA_ABA_VISAO,
    );
  });
});

describe("P79 -- cada token novo está no elemento certo", () => {
  it("a raiz da Visão (e só ela) leva a grade; o esqueleto de carregamento segue igual", () => {
    for (const token of NA_RAIZ) {
      const literais = literaisComToken(FONTE_VISAO, token);
      expect(literais, token).toHaveLength(1);
      expect(classesDoCelular(literais[0]), token).toBe("flex flex-col gap-4");
    }
    // Os cinco tokens estão no MESMO literal.
    const doGrid = literaisComToken(FONTE_VISAO, "xl:grid");
    for (const token of NA_RAIZ) {
      expect(doGrid[0].split(/\s+/)).toContain(token);
    }
    // O esqueleto (`aria-busy`) tem outro literal `flex flex-col gap-4`, sem token.
    const iguaisAoEsqueleto = literaisDeClasse(FONTE_VISAO).filter(
      (l) => l === "flex flex-col gap-4",
    );
    expect(iguaisAoEsqueleto).toHaveLength(1);
  });

  it("a lista de Entradas/Saídas (a grade dentro de 'Movimentos do período') leva a coluna única; a grade de canais e as demais não", () => {
    const arvore = arvoreDe(FONTE_VISAO);
    const achados: { dl: string; classe: string }[] = [];
    (function visitar(no: ts.Node) {
      if (ts.isJsxElement(no) && no.openingElement.tagName.getText() === "dl") {
        const atributo = no.openingElement.attributes.properties.find(
          (p) => ts.isJsxAttribute(p) && p.name.getText() === "className",
        );
        const canais = no.openingElement.attributes.properties.some(
          (p) =>
            ts.isJsxAttribute(p) &&
            p.name.getText() === "data-canais-lado-a-lado",
        );
        if (atributo && ts.isJsxAttribute(atributo) && atributo.initializer) {
          const texto = atributo.initializer.getText().replace(/^"|"$/g, "");
          achados.push({ dl: canais ? "canais" : "movimentos", classe: texto });
        }
      }
      ts.forEachChild(no, visitar);
    })(arvore);
    const movimentos = achados.find((a) => a.dl === "movimentos");
    const canais = achados.find((a) => a.dl === "canais");
    expect(achados).toHaveLength(2);
    expect(classesDoCelular(movimentos?.classe ?? "")).toBe(
      "grid grid-cols-2 gap-3",
    );
    expect(dosTokensDeComputador(movimentos?.classe ?? "").sort()).toEqual(
      [...NA_LISTA_DE_MOVIMENTOS].sort(),
    );
    expect(dosTokensDeComputador(canais?.classe ?? "")).toEqual([]);
  });

  it("o botão do 'Fechar caixa' (principal) leva o fim do esticão; 'Ver caixa' (secundário) não", () => {
    for (const token of NO_BOTAO_FECHAR) {
      const literais = literaisComToken(FONTE_CAIXA, token);
      expect(literais, token).toHaveLength(1);
    }
    const principal = literaisDeClasse(FONTE_CAIXA).filter((l) =>
      l.startsWith("inline-flex h-[52px] min-w-0 flex-1"),
    );
    const secundario = literaisDeClasse(FONTE_CAIXA).filter((l) =>
      l.startsWith("inline-flex h-[52px] shrink-0"),
    );
    expect(principal).toHaveLength(1);
    expect(secundario).toHaveLength(1);
    // Os tokens ficam no principal (no literal dele ou num literal irmão dentro
    // do mesmo `cn(...)` da constante), nunca no secundário.
    expect(dosTokensDeComputador(secundario[0])).toEqual([]);
    expect(FONTE_CAIXA).toMatch(
      /CLASSE_BOTAO_PRINCIPAL\s*=\s*cn\([\s\S]*?lg:flex-none[\s\S]*?\);/,
    );
    expect(FONTE_CAIXA).not.toMatch(
      /CLASSE_BOTAO_SECUNDARIO\s*=\s*cn\([\s\S]*?lg:flex-none[\s\S]*?\);/,
    );
  });
});

// ---------------------------------------------------------------------------
// O Tailwind real do projeto, compilado SOBRE O FONTE (o extrator lê o arquivo
// como ele é: prova que o `'` do seletor do saldo é entendido).
// ---------------------------------------------------------------------------
type Regra = { minLargura: number; seletor: string; decl: string[] };

async function compilarFonte(fonte: string): Promise<Regra[]> {
  const exigir = createRequire(join(raiz, "package.json"));
  const carregar = exigir("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const tailwind = exigir("tailwindcss");
  const config = carregar(join(raiz, "tailwind.config.js"));
  const resultado = await postcss([
    tailwind({
      ...config,
      content: [{ raw: fonte, extension: "tsx" }],
      corePlugins: { preflight: false },
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  const regras: Regra[] = [];
  resultado.root.walkRules((regra) => {
    let minLargura = 0;
    let pai = regra.parent;
    while (pai && pai.type !== "root") {
      if (pai.type === "atrule" && (pai as postcss.AtRule).name === "media") {
        const m = /min-width:\s*(\d+)px/.exec((pai as postcss.AtRule).params);
        if (m) minLargura = Math.max(minLargura, Number(m[1]));
      }
      pai = pai.parent;
    }
    const decl: string[] = [];
    regra.walkDecls((d) => {
      decl.push(`${d.prop}: ${d.value.replace(/\s+/g, " ")}`);
    });
    regras.push({ minLargura, seletor: regra.selector, decl });
  });
  return regras;
}

/** O seletor chega escapado (`\32xl\:…`, espaço como `\20`); desfaz para ler. */
const semEscape = (s: string) =>
  s
    .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\/g, "");

describe("P79 -- o Tailwind real gera cada regra, na largura certa", () => {
  it("a raiz da Visão: grade de duas colunas em xl; todo filho na linha inteira; só saldo e movimentos dividem", async () => {
    const regras = await compilarFonte(FONTE_VISAO);
    const doToken = (trecho: string) =>
      regras.filter((r) => semEscape(r.seletor).startsWith(`.${trecho}`));

    const grade = doToken("xl:grid");
    // `.xl:grid` e `.xl:grid-cols-[…]` começam igual; escolhe pelo valor.
    const display = grade.filter((r) => r.decl.includes("display: grid"));
    expect(display).toHaveLength(1);
    expect(display[0].minLargura).toBe(1280);

    const colunas = doToken(COLUNAS);
    expect(colunas).toHaveLength(1);
    expect(colunas[0].minLargura).toBe(1280);
    expect(colunas[0].decl).toEqual([
      "grid-template-columns: minmax(0,1.4fr) minmax(0,1fr)",
    ]);

    const todos = doToken(TODOS_FILHOS);
    expect(todos).toHaveLength(1);
    expect(todos[0].minLargura).toBe(1280);
    expect(todos[0].decl).toEqual(["grid-column: span 2 / span 2"]);
    expect(semEscape(todos[0].seletor)).toMatch(/>\*$/);

    const saldo = doToken(SALDO);
    expect(saldo).toHaveLength(1);
    expect(saldo[0].minLargura).toBe(1280);
    expect(saldo[0].decl).toEqual(["grid-column: span 1 / span 1"]);
    expect(semEscape(saldo[0].seletor)).toMatch(
      /> ?section\[aria-label='Saldo total'\]$/,
    );

    const movimentos = doToken(MOVIMENTOS);
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0].minLargura).toBe(1280);
    expect(movimentos[0].decl).toEqual(["grid-column: span 1 / span 1"]);
    expect(semEscape(movimentos[0].seletor)).toMatch(
      /> ?section\[aria-label\^=Movimentos\]$/,
    );

    // A regra "todo filho ocupa 2" empata em classe com a dos dois blocos; quem
    // desempata é o ATRIBUTO no seletor deles (especificidade maior), não a
    // ordem na folha. Por isso os dois precisam ter `[aria-label` no seletor.
    for (const regra of [saldo[0], movimentos[0]]) {
      expect(semEscape(regra.seletor)).toContain("[aria-label");
    }
    expect(semEscape(todos[0].seletor)).not.toContain("[aria-label");
  }, 60_000);

  it("a lista de Entradas/Saídas: coluna única e altura cheia em xl", async () => {
    const regras = await compilarFonte(FONTE_VISAO);
    for (const [token, decl] of [
      ["xl:h-full", "height: 100%"],
      ["xl:grid-cols-1", "grid-template-columns: repeat(1, minmax(0, 1fr))"],
    ] as const) {
      const achadas = regras.filter(
        (r) => semEscape(r.seletor) === `.${token}`,
      );
      expect(achadas, token).toHaveLength(1);
      expect(achadas[0].minLargura).toBe(1280);
      expect(achadas[0].decl).toEqual([decl]);
    }
  }, 60_000);

  it("o 'Fechar caixa' deixa de crescer em lg (1024 px) e ganha piso de 16rem", async () => {
    const regras = await compilarFonte(FONTE_CAIXA);
    const flex = regras.filter((r) => semEscape(r.seletor) === ".lg:flex-none");
    expect(flex).toHaveLength(1);
    expect(flex[0].minLargura).toBe(1024);
    expect(flex[0].decl).toEqual(["flex: none"]);
    const piso = regras.filter(
      (r) => semEscape(r.seletor) === ".lg:min-w-[16rem]",
    );
    expect(piso).toHaveLength(1);
    expect(piso[0].minLargura).toBe(1024);
    expect(piso[0].decl).toEqual(["min-width: 16rem"]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// O DOM de verdade: os seletores dos dois blocos acertam UM filho da raiz cada.
// ---------------------------------------------------------------------------
const cenarioDoResumo = vi.hoisted(() => ({
  semDados: false,
  semContas: false,
  erro: null as string | null,
}));
vi.mock("@/hooks/useFinanceiro", () => ({
  useResumoFinanceiro: () => ({
    dados: cenarioDoResumo.semDados
      ? null
      : parseResumo({
          saldo_total: 5230.4,
          entradas: 18450.9,
          saidas: 9120.5,
          resultado: 9330.4,
          contas: cenarioDoResumo.semContas
            ? []
            : [
                { id: "c1", nome: "Caixa da loja", tipo: "caixa", saldo: 600 },
                { id: "c2", nome: "Banco", tipo: "banco", saldo: 4630.4 },
              ],
          por_canal: { online: 100, presencial: 50 },
        }),
    erro: cenarioDoResumo.erro,
    carregando: cenarioDoResumo.semDados && !cenarioDoResumo.erro,
    recarregar: vi.fn(),
  }),
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  cenarioDoResumo.semDados = false;
  cenarioDoResumo.semContas = false;
  cenarioDoResumo.erro = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar(caixa: Parameters<typeof AbaVisao>[0]["caixa"]) {
  await act(async () =>
    root.render(
      <AbaVisao
        ativo
        intervalo={null}
        hoje="2026-11-15"
        versao={0}
        contas={[]}
        caixa={caixa}
        abrirFolha={vi.fn()}
        irParaAba={vi.fn()}
        verPrevistos={vi.fn()}
      />,
    ),
  );
  return host.firstElementChild as HTMLElement;
}

/** `xl:[&>seletor]:col-span-1` -> `:scope > seletor` (o `_` do Tailwind vira espaço). */
function seletorDoToken(token: string): string {
  const m = /^xl:\[&>(.+)\]:col-span-1$/.exec(token);
  if (!m) throw new Error(`token fora do formato: ${token}`);
  return `:scope > ${m[1].replace(/_/g, " ")}`;
}

describe("P79 -- os seletores de coluna acertam o filho certo da raiz", () => {
  it("'Saldo total' e 'Movimentos do período' são, cada um, UM filho direto da raiz; 'Saldo por conta' e os outros blocos não casam", async () => {
    const raizDaVisao = await montar(CAIXA_FECHADO_DA_VISAO);
    const saldo = raizDaVisao.querySelectorAll(seletorDoToken(SALDO));
    expect(saldo).toHaveLength(1);
    expect(saldo[0].getAttribute("aria-label")).toBe("Saldo total");
    const movimentos = raizDaVisao.querySelectorAll(seletorDoToken(MOVIMENTOS));
    expect(movimentos).toHaveLength(1);
    expect(movimentos[0].getAttribute("aria-label")).toBe(
      "Movimentos do período",
    );
    // Os dois são irmãos vizinhos e nessa ordem: saldo primeiro (DOM inalterado).
    expect(saldo[0].nextElementSibling).toBe(movimentos[0]);
    // O outro bloco "Saldo ..." (por conta) existe e NÃO é pego pelo seletor.
    const porConta = raizDaVisao.querySelector(
      ":scope > section[aria-label='Saldo por conta']",
    );
    expect(porConta).not.toBeNull();
    expect(porConta).not.toBe(saldo[0]);
    // A lista de Entradas/Saídas é filha de 'Movimentos do período'.
    const lista = movimentos[0].querySelector("dl");
    expect(lista).not.toBeNull();
    expect(lista?.className).toContain("xl:h-full");
    expect(lista?.className).toContain("xl:grid-cols-1");
    expect(lista?.children).toHaveLength(2);
  });

  it("o texto e a ordem dos blocos da Visão seguem os de sempre (nenhum bloco novo, nenhum movido)", async () => {
    const raizDaVisao = await montar(CAIXA_FECHADO_DA_VISAO);
    const rotulos = [...raizDaVisao.children].map(
      (f) => f.getAttribute("aria-label") ?? f.tagName.toLowerCase(),
    );
    expect(rotulos).toEqual([
      "Caixa",
      "Saldo total",
      "Movimentos do período",
      "div", // A pagar / A receber
      "Saldo por conta",
      "Fluxo de caixa · últimos 30 dias",
      "div", // Recebimentos por forma / App x loja
      "p",
    ]);
  });
});

const CAIXA_ABERTO_DA_VISAO: Parameters<typeof AbaVisao>[0]["caixa"] = {
  ...CAIXA_FECHADO_DA_VISAO,
  dados: {
    sessao: {
      id: "caixa-ficticio",
      contaId: "c1",
      contaNome: "Caixa de teste",
      abertoEm: "2026-11-15T12:00:00Z",
      valorAbertura: 80,
      vendasDinheiro: 0,
      devolucoesDinheiro: 0,
      estornosExternosDinheiro: 0,
      entradasManuais: 0,
      saidasManuais: 0,
      esperado: 80,
      movimentos: [],
    },
  },
};

/**
 * Liga as provas de CSS acima à raiz REAL, não a um literal parecido.
 * Retirar a grade desta raiz ou transferi-la ao esqueleto deve falhar aqui.
 * Isto verifica classes e parentesco; jsdom não mede largura nem altura.
 */
function conferirGradeCarregada(raizDaVisao: HTMLElement) {
  expect(raizDaVisao.parentElement).toBe(host);
  expect(raizDaVisao.hasAttribute("aria-busy")).toBe(false);
  for (const token of NA_RAIZ) {
    expect(raizDaVisao.classList.contains(token), token).toBe(true);
  }
  // Localiza os blocos sem depender do seletor que está sob teste.
  const saldo = raizDaVisao.querySelector("section[aria-label='Saldo total']");
  const movimentos = raizDaVisao.querySelector(
    "section[aria-label='Movimentos do período']",
  );
  expect(saldo).not.toBeNull();
  expect(movimentos).not.toBeNull();
  expect(saldo?.parentElement).toBe(raizDaVisao);
  expect(movimentos?.parentElement).toBe(raizDaVisao);
  expect([...raizDaVisao.querySelectorAll(seletorDoToken(SALDO))]).toEqual([
    saldo,
  ]);
  expect([...raizDaVisao.querySelectorAll(seletorDoToken(MOVIMENTOS))]).toEqual(
    [movimentos],
  );
  expect(saldo?.nextElementSibling).toBe(movimentos);
  const lista = movimentos?.querySelector("dl");
  for (const token of NA_LISTA_DE_MOVIMENTOS) {
    expect(lista?.classList.contains(token), token).toBe(true);
  }
  expect(lista?.children).toHaveLength(2);
  return [...raizDaVisao.children].map(
    (filho) => filho.getAttribute("aria-label") ?? filho.tagName.toLowerCase(),
  );
}

const BLOCOS_CARREGADOS = [
  "Caixa",
  "Saldo total",
  "Movimentos do período",
  "div",
  "Saldo por conta",
  "Fluxo de caixa · últimos 30 dias",
  "div",
  "p",
];

describe("P79 -- a grade pertence à raiz carregada, em cada estado", () => {
  it.each([
    ["aberto", CAIXA_ABERTO_DA_VISAO, "Fechar caixa"],
    ["fechado", CAIXA_FECHADO_DA_VISAO, "Abrir caixa"],
  ] as const)(
    "caixa %s: raiz, filhos e botão reais mantêm os tokens",
    async (estado, caixa, textoDoBotao) => {
      const raizDaVisao = await montar(caixa);
      expect(conferirGradeCarregada(raizDaVisao)).toEqual(BLOCOS_CARREGADOS);
      const cartao = raizDaVisao.querySelector(
        `:scope > section[data-faixa-do-caixa='${estado}']`,
      );
      expect(cartao).not.toBeNull();
      const botao = [...(cartao?.querySelectorAll("button") ?? [])].find(
        (elemento) => elemento.textContent === textoDoBotao,
      );
      expect(botao).toBeDefined();
      for (const token of NO_BOTAO_FECHAR) {
        expect(botao?.classList.contains(token), token).toBe(true);
      }
    },
  );

  it("sem resumo: mostra o esqueleto sem atribuir a ele a grade carregada", async () => {
    cenarioDoResumo.semDados = true;
    const esqueleto = await montar(CAIXA_FECHADO_DA_VISAO);
    expect(esqueleto.getAttribute("aria-busy")).toBe("true");
    expect(esqueleto.textContent).toContain("Carregando");
    for (const token of NA_RAIZ) {
      expect(esqueleto.classList.contains(token), token).toBe(false);
    }
    expect(
      esqueleto.querySelector("section[aria-label='Saldo total']"),
    ).toBeNull();
  });

  it("erro sem resumo: mostra o erro, sem montar grade nem saldo", async () => {
    cenarioDoResumo.semDados = true;
    cenarioDoResumo.erro = "Falha fictícia ao ler resumo";
    const erro = await montar(CAIXA_FECHADO_DA_VISAO);
    expect(erro.textContent).toContain(cenarioDoResumo.erro);
    for (const token of NA_RAIZ) {
      expect(erro.classList.contains(token), token).toBe(false);
    }
    expect(host.querySelector("section[aria-label='Saldo total']")).toBeNull();
  });

  it("erro com resumo anterior: o aviso é filho direto e não desloca os dois blocos de meia linha", async () => {
    cenarioDoResumo.erro = "Falha fictícia ao atualizar resumo";
    const raizDaVisao = await montar(CAIXA_ABERTO_DA_VISAO);
    expect(conferirGradeCarregada(raizDaVisao)).toEqual([
      "div",
      ...BLOCOS_CARREGADOS,
    ]);
    expect(raizDaVisao.firstElementChild?.textContent).toContain(
      cenarioDoResumo.erro,
    );
  });

  it("caixa com dados antigos e erro: o invólucro do aviso continua filho direto de largura inteira", async () => {
    const raizDaVisao = await montar({
      ...CAIXA_ABERTO_DA_VISAO,
      erro: "Falha fictícia ao atualizar caixa",
    });
    expect(conferirGradeCarregada(raizDaVisao)).toEqual([
      "div",
      ...BLOCOS_CARREGADOS.slice(1),
    ]);
    const avisoECaixa = raizDaVisao.firstElementChild;
    expect(avisoECaixa?.textContent).toContain(
      "Falha fictícia ao atualizar caixa",
    );
    expect(
      avisoECaixa?.querySelector("section[data-faixa-do-caixa='aberto']"),
    ).not.toBeNull();
  });

  it("sem contas: o estado vazio substitui só o bloco de contas, não a raiz da grade", async () => {
    cenarioDoResumo.semContas = true;
    const raizDaVisao = await montar(CAIXA_FECHADO_DA_VISAO);
    const blocos = conferirGradeCarregada(raizDaVisao);
    expect(blocos).toHaveLength(BLOCOS_CARREGADOS.length);
    expect(blocos.slice(0, 4)).toEqual(BLOCOS_CARREGADOS.slice(0, 4));
    expect(blocos.slice(5)).toEqual(BLOCOS_CARREGADOS.slice(5));
    expect(raizDaVisao.children[4].textContent).toContain(
      "Nenhuma conta ainda",
    );
    expect(
      raizDaVisao.querySelector("[aria-label='Saldo por conta']"),
    ).toBeNull();
  });
});
