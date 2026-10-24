// Financeiro — cartão "Caixa de hoje" (24/10/2026): toda classe nova gera CSS.
//
// O jsdom não vê CSS, então classe inventada some em silêncio (botão sem fundo,
// verde que não pinta). Aqui o Tailwind do projeto é COMPILADO com as classes do
// cartão e cada uma tem de aparecer como regra. As variantes por tema
// (`[html[data-admin-tema=claro]_&]:…`) são o ponto delicado: o bloco em tinta
// inverte de um tema para o outro, e o verde/vermelho do estado têm um tom para
// o bloco claro (Escuro e Confortável) e outro para o escuro (Claro).
//
// Mesma técnica de `financeiro-caixa-classes-geram-css` (que cobre a aba Caixa).
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { classeDoValorDoHeroi } from "@/components/admin/financeiro/partesDoCaixa";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

/** Classes da casa (CSS próprio, não são utilitários do Tailwind). */
const CLASSES_DA_CASA = new Set(["pb-admin", "no-scrollbar", "group"]);

const FONTE = "src/components/admin/financeiro/CaixaDeHoje.tsx";
// A tela leva o ponto da aba (com variante por tema) e os chips do topo.
const VIEW = "src/views/admin/AdminFinanceiroView.tsx";

const BARRA = String.fromCharCode(92);
const escapar = (classe: string) =>
  classe.replace(/[^a-zA-Z0-9_-]/g, (c) =>
    c === "," ? `${BARRA}2c ` : `${BARRA}${c}`,
  );

const PARECE_CLASSE = /^[!a-z0-9[\]:/%.,()&>_#*+=-]+$/;

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

const usadas = (() => {
  const todas = new Set<string>([
    // Escritas sozinhas em `cn(…)`/tabelas, que a varredura de literais não pega.
    "size-2",
    "shrink-0",
    "rounded-full",
    "bg-background/60",
    "text-background/70",
    "break-words",
    "whitespace-nowrap",
  ]);
  for (const t of classeDoValorDoHeroi(480.5, false).split(/\s+/)) todas.add(t);
  for (const t of classeDoValorDoHeroi(1234567.89, false).split(/\s+/))
    todas.add(t);
  for (const arquivo of [FONTE, VIEW]) {
    for (const classe of classesDe(ler(arquivo))) {
      if (!CLASSES_DA_CASA.has(classe)) todas.add(classe);
    }
  }
  return [...todas];
})();

describe("Financeiro — toda classe do cartão Caixa de hoje gera CSS", () => {
  it("a varredura achou as classes (controle de que ela não ficou cega)", () => {
    expect(usadas.length).toBeGreaterThan(30);
    for (const esperada of [
      "bg-foreground",
      "text-background",
      "rounded-[20px]",
      "h-[52px]",
      "border-solid",
      "bg-background",
      "text-foreground",
      "border-background/40",
      "[html[data-admin-tema=claro]_&]:text-emerald-400",
      "[html[data-admin-tema=claro]_&]:bg-emerald-400",
      "[html[data-admin-tema=claro]_&]:text-red-400",
      "focus-visible:ring-offset-foreground",
      // Da tela: ponto da aba (verde escuro só no Claro) e chips do topo.
      "[html[data-admin-tema=claro]_&]:bg-emerald-700",
      "before:-inset-y-1",
      "h-9",
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

  it("o verde do estado muda só no tema Claro (bloco escuro): a regra mira html[data-admin-tema=claro]", async () => {
    const css = await compilar([
      "text-emerald-800 [html[data-admin-tema=claro]_&]:text-emerald-400",
    ]);
    // Base: tom escuro, para o bloco claro dos temas Escuro e Confortável.
    expect(css).toContain(".text-emerald-800");
    // Só no Claro o verde é o claro. O seletor leva o html com o atributo.
    expect(css).toMatch(
      /html\[data-admin-tema=claro\] \.\\\[html\\\[data-admin-tema\\=claro\\\]_\\&\\\]\\:text-emerald-400/,
    );
  });

  it("o controle do teste: uma classe inventada É pega", async () => {
    const css = await compilar(["bg-caixa-de-hoje", "h-[52px]"]);
    expect(css).not.toContain(".bg-caixa-de-hoje");
    expect(css).toContain(".h-\\[52px\\]");
  });

  it("os botões do cartão têm borda sólida explícita e 52px (o index.css zera a borda de todo <button>)", () => {
    const fonte = ler(FONTE);
    expect(fonte).toContain("border border-solid border-background/40");
    expect(fonte.match(/h-\[52px\]/g)?.length).toBe(2);
    // Nunca o primário da marca (às vezes amarelo) nem cor fixa de tema.
    expect(fonte).not.toMatch(/bg-primary|#0B0B0C|zinc-950|amber|yellow/);
  });

  it("o valor em dinheiro do cartão nunca quebra no meio", () => {
    for (const v of [0, 480.5, 123456.78, 99999999.99]) {
      expect(classeDoValorDoHeroi(v, false)).toContain("whitespace-nowrap");
      expect(classeDoValorDoHeroi(v, true)).toContain("whitespace-nowrap");
    }
  });
});
