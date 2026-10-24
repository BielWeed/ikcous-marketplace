// Redesenho do Perfil (23/10/2026): toda classe do Tailwind usada nos arquivos
// da tela precisa virar CSS de verdade.
//
// POR QUE ESTE TESTE EXISTE: o jsdom não calcula CSS. Classe inventada (nome
// que o Tailwind do projeto não tem) passa em todo teste de componente e não
// pinta nada no celular. Aqui o Tailwind REAL do projeto (tailwind.config.js +
// src/index.css) compila as classes de cada arquivo e o teste reprova se
// alguma não virar regra. Molde: checkout-classes-do-redesenho-geram-css.test.ts.
//
// SEGUNDA TRAVA: `src/index.css` zera a borda de TODO `<button>`; `border` /
// `border-<cor>` só definem largura e cor, então botão com borda precisa de
// `border-solid` (medido: sem ele a borda NÃO aparece no celular).
//
// `JA_NAO_GERAVAM` e `BOTOES_ANTIGOS_SEM_BORDA_SOLIDA` ficam vazios: nada é
// tolerado. A versão Tinta da tela tem teste próprio de classes novas.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const ARQUIVOS = [
  "src/views/customer/ProfileView.tsx",
  "src/components/ui/custom/AddressList.tsx",
  "src/components/ui/custom/OrderTimeline.tsx",
  "src/components/ui/custom/CustomerPaymentBadge.tsx",
] as const;

// Redesenho Tinta do Perfil (24/10/2026): os diálogos de avatar e de capa foram
// refeitos e as classes que já não geravam CSS saíram; a lista ficou vazia.
const JA_NAO_GERAVAM: Record<string, readonly string[]> = {};

/** Textos que têm cara de classe mas são valor de variante, id de teste ou política de referrer. */
const NAO_E_CLASSE = new Set([
  "lista",
  "perfil",
  "avatars",
  "upload",
  "presets",
  "foto-de-perfil",
  "customer-payment-badge",
  "no-referrer-when-downgrade",
]);

const BOTOES_ANTIGOS_SEM_BORDA_SOLIDA = new Set<string>();

function arvoreDe(fonte: string) {
  return ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

const ehTexto = (no: ts.Node) =>
  ts.isStringLiteral(no) ||
  ts.isNoSubstitutionTemplateLiteral(no) ||
  ts.isTemplateHead(no) ||
  ts.isTemplateMiddle(no) ||
  ts.isTemplateTail(no);

/** Classes de todo `className=...` e de chamadas `cn(...)` (inclui ternários e templates). */
function classesDoArquivo(fonte: string): string[] {
  const classes = new Set<string>();
  const colher = (no: ts.Node) => {
    if (ehTexto(no))
      for (const t of (no as ts.StringLiteral).text.split(/\s+/))
        if (t) classes.add(t);
    ts.forEachChild(no, colher);
  };
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText() === "className" &&
      no.initializer
    )
      colher(no.initializer);
    else if (
      ts.isCallExpression(no) &&
      ts.isIdentifier(no.expression) &&
      no.expression.text === "cn"
    )
      for (const argumento of no.arguments) colher(argumento);
    ts.forEachChild(no, visitar);
  };
  visitar(arvoreDe(fonte));
  return [...classes];
}

/** Constantes de classe (`const CARTAO = "rounded-3xl ..."`): só as que têm cara de classe. */
function classesEmVariaveis(fonte: string): string[] {
  const achadas = new Set<string>();
  const PARECE_CLASSE = /^!?[a-z0-9][a-z0-9:/.[\]%#_!-]*$/;
  const colher = (no: ts.Node) => {
    if (ehTexto(no))
      for (const t of (no as ts.StringLiteral).text.split(/\s+/))
        if (
          PARECE_CLASSE.test(t) &&
          /[-:]/.test(t) &&
          !t.endsWith(":") &&
          !t.includes("://")
        )
          achadas.add(t);
    ts.forEachChild(no, colher);
  };
  const visitar = (no: ts.Node) => {
    if (ts.isVariableDeclaration(no) && no.initializer) colher(no.initializer);
    ts.forEachChild(no, visitar);
  };
  visitar(arvoreDe(fonte));
  return [...achadas];
}

function ehLarguraOuCorDeBorda(classe: string): boolean {
  if (classe === "border") return true;
  if (!classe.startsWith("border-")) return false;
  let resto = classe.slice("border-".length);
  if (/^[trblxyse]$/.test(resto)) return true;
  if (/^[trblxyse]-/.test(resto)) resto = resto.slice(2);
  const naoDesenha = [
    "solid",
    "dashed",
    "dotted",
    "double",
    "hidden",
    "none",
    "0",
  ];
  return (
    !naoDesenha.includes(resto) &&
    !resto.startsWith("spacing") &&
    !resto.startsWith("opacity")
  );
}

/** `<button>` e `<Button>` com classe de borda e SEM `border-solid`. */
function botoesComBordaInvisivel(fonte: string): string[] {
  const problemas: string[] = [];
  const arvore = arvoreDe(fonte);
  const visitar = (no: ts.Node) => {
    const abertura = ts.isJsxElement(no)
      ? no.openingElement
      : ts.isJsxSelfClosingElement(no)
        ? no
        : null;
    if (abertura && /^(button|Button)$/.test(abertura.tagName.getText())) {
      for (const atributo of abertura.attributes.properties) {
        if (
          ts.isJsxAttribute(atributo) &&
          atributo.name.getText() === "className" &&
          atributo.initializer
        ) {
          const classes: string[] = [];
          const colher = (n: ts.Node) => {
            if (ehTexto(n))
              classes.push(...(n as ts.StringLiteral).text.split(/\s+/));
            ts.forEachChild(n, colher);
          };
          colher(atributo.initializer);
          if (
            classes.some(ehLarguraOuCorDeBorda) &&
            !classes.includes("border-solid")
          )
            problemas.push(classes.filter(Boolean).join(" "));
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arvore);
  return problemas;
}

async function classesGeradas(candidatas: string[]): Promise<Set<string>> {
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: candidatas.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
  const geradas = new Set<string>();
  resultado.root.walkRules((regra) => {
    selectorParser((seletores) => {
      seletores.walkClasses((c) => {
        geradas.add(c.value);
      });
    }).processSync(regra.selector);
  });
  return geradas;
}

const jaNaoGeravam = new Map(Object.entries(JA_NAO_GERAVAM));

describe("Perfil — todas as classes viram regra no Tailwind do projeto", () => {
  it("controle: uma classe inventada NÃO vira regra e as do redesenho viram", async () => {
    const geradas = await classesGeradas([
      "bg-marca-inventada-900",
      "rounded-3xl",
      "min-h-16",
      "size-11",
      "divide-zinc-100",
      "-rotate-90",
    ]);
    expect(geradas.has("bg-marca-inventada-900")).toBe(false);
    for (const c of [
      "rounded-3xl",
      "min-h-16",
      "size-11",
      "divide-zinc-100",
      "-rotate-90",
    ])
      expect(geradas.has(c), c).toBe(true);
  }, 60_000);

  it("controle da trava de borda: pega botão com borda sem border-solid e deixa passar o certo", () => {
    const fonte = `
      const a = <button className="border-2 border-zinc-900 p-3" />;
      const b = <Button className="border-2 border-solid border-zinc-900" />;
      const c = <button className="h-11 bg-zinc-100 hover:border-zinc-900" />;
      const d = <div className="border border-zinc-200" />;
    `;
    expect(botoesComBordaInvisivel(fonte)).toEqual([
      "border-2 border-zinc-900 p-3",
    ]);
  });

  for (const arquivo of ARQUIVOS) {
    const fonte = readFileSync(arquivo, "utf8");
    it(`${arquivo}: nenhuma classe deixa de gerar CSS`, async () => {
      const classes = [
        ...new Set([...classesDoArquivo(fonte), ...classesEmVariaveis(fonte)]),
      ];
      expect(classes.length).toBeGreaterThan(0);
      const geradas = await classesGeradas(classes);
      const permitidas = new Set(jaNaoGeravam.get(arquivo) ?? []);
      expect(
        classes.filter(
          (c) => !geradas.has(c) && !permitidas.has(c) && !NAO_E_CLASSE.has(c),
        ),
      ).toEqual([]);
    }, 60_000);

    it(`${arquivo}: todo botão com borda leva border-solid`, () => {
      expect(
        botoesComBordaInvisivel(fonte).filter(
          (classes) => !BOTOES_ANTIGOS_SEM_BORDA_SOLIDA.has(classes),
        ),
      ).toEqual([]);
    });
  }
});
