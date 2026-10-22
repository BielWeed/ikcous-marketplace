// Redesenho da tela "Finalizar pedido" (22/10/2026, passos A1-A5).
//
// POR QUE ESTE TESTE EXISTE: o jsdom não calcula CSS. Uma classe que o
// Tailwind deste projeto NÃO gera (nome inventado, escala que a configuração
// não tem) passa em todo teste de componente e simplesmente não pinta nada na
// tela do celular. Aqui o Tailwind REAL do projeto (tailwind.config.js +
// src/index.css) compila as classes de cada componente do checkout e o teste
// reprova se alguma não virar regra.
//
// COMO LÊ AS CLASSES: toda string literal dentro de `className={...}`,
// `className="..."` e de chamadas `cn(...)` do arquivo.
//
// `JA_NAO_GERAVAM` é o retrato das classes que JÁ não geravam regra ANTES do
// redesenho (dívida anterior, fora do escopo): o teste só impede que apareça
// uma NOVA. Tirar um item da lista é sempre bem-vindo; pôr, nunca.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

/** Arquivos do checkout cujo markup o redesenho mexe. */
const ARQUIVOS = [
  "src/views/customer/CheckoutView.tsx",
  "src/components/ui/custom/ShippingCalculator.tsx",
  "src/components/ui/custom/CouponInput.tsx",
  "src/components/ui/custom/AddressList.tsx",
  "src/components/checkout/CuponsDoCheckout.tsx",
  "src/components/checkout/CartoesDeResumo.tsx",
] as const;

const JA_NAO_GERAVAM: Record<string, readonly string[]> = {
  "src/views/customer/CheckoutView.tsx": ["terminal", "border-3", "shadow-3xl"],
  "src/components/ui/custom/AddressList.tsx": ["animate-all"],
};

/**
 * Classes que o arquivo usa: toda string literal (inclusive os pedaços de
 * template e os ramos de ternário) dentro de um atributo `className` ou de
 * uma chamada `cn(...)`. Lê o código com o parser do TypeScript — aspas em
 * comentário ou em texto de JSX não enganam a leitura.
 */
function classesDoArquivo(fonte: string): string[] {
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const classes = new Set<string>();
  const adicionar = (texto: string) => {
    for (const t of texto.split(/\s+/)) if (t) classes.add(t);
  };
  const colher = (no: ts.Node) => {
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no))
      adicionar(no.text);
    else if (
      ts.isTemplateHead(no) ||
      ts.isTemplateMiddle(no) ||
      ts.isTemplateTail(no)
    )
      adicionar(no.text);
    ts.forEachChild(no, colher);
  };
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText(arvore) === "className" &&
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
  visitar(arvore);
  return [...classes];
}

async function classesGeradas(candidatas: string[]): Promise<Set<string>> {
  // O pacote é ESM e o tailwind.config.js usa `require`: quem sabe ler esse
  // arquivo é o carregador do próprio Tailwind (jiti), o mesmo do build.
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

describe("redesenho do Finalizar — todas as classes viram regra no Tailwind do projeto", () => {
  it("o leitor acha as classes de className, de ternário e de cn(...)", () => {
    const achadas = classesDoArquivo(`
      <div className="flex gap-2 md:p-4" />
      <div className={\`a-um \${x ? "b-dois" : "c-tres"}\`} />
      <div className={cn("d-quatro", ok && "e-cinco")} />
      const f = cn("g-seis");
    `);
    for (const esperada of [
      "flex",
      "md:p-4",
      "a-um",
      "b-dois",
      "c-tres",
      "d-quatro",
      "e-cinco",
      "g-seis",
    ])
      expect(achadas).toContain(esperada);
  });

  it("controle: uma classe inventada NÃO vira regra e uma de verdade vira", async () => {
    const geradas = await classesGeradas([
      "bg-marca-inventada-900",
      "bg-zinc-100",
      "min-h-11",
      "line-clamp-2",
    ]);
    expect(geradas.has("bg-marca-inventada-900")).toBe(false);
    expect(geradas.has("bg-zinc-100")).toBe(true);
    expect(geradas.has("min-h-11")).toBe(true);
    expect(geradas.has("line-clamp-2")).toBe(true);
  }, 60_000);

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo}: nenhuma classe nova deixa de gerar CSS`, async () => {
      const classes = classesDoArquivo(readFileSync(arquivo, "utf8"));
      expect(classes.length).toBeGreaterThan(0);
      const geradas = await classesGeradas(classes);
      const permitidas = new Set(JA_NAO_GERAVAM[arquivo] ?? []);
      const faltando = classes.filter(
        (c) => !geradas.has(c) && !permitidas.has(c),
      );
      expect(faltando).toEqual([]);
    }, 60_000);
  }
});
