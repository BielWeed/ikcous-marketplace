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
// `className="..."` e de chamadas `cn(...)` do arquivo, MAIS as strings
// guardadas em variáveis/constantes (`const x = "classe-falsa"`) — classe
// escondida numa variável também não pode passar sem CSS.
//
// SEGUNDA TRAVA (botão com borda): `src/index.css` zera a borda de TODO
// `<button>` (`@layer base { button { border: none } }`) e o `border-2` /
// `border-<cor>` do Tailwind só define largura e cor, não o estilo. Sem
// `border-solid` a borda NÃO aparece no celular (medido: `none 0px`). Todo
// `<button>` com classe de borda precisa de `border-solid`.
//
// `JA_NAO_GERAVAM` é o retrato das classes que JÁ não geravam regra ANTES do
// redesenho (dívida anterior, fora do escopo): o teste só impede que apareça
// uma NOVA. Tirar um item da lista é sempre bem-vindo; pôr, nunca.
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

/**
 * Strings guardadas em variáveis/constantes (inclusive dentro de objetos,
 * arrays, ternários e templates do inicializador) que PARECEM classe de
 * Tailwind: só letras minúsculas, dígitos e `- : / . [ ] % # _ !`, e com hífen
 * ou dois-pontos (palavra solta como "online" é valor de enum, não classe).
 */
function classesEmVariaveis(fonte: string): string[] {
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achadas = new Set<string>();
  const PARECE_CLASSE = /^!?[a-z0-9][a-z0-9:/.[\]%#_!-]*$/;
  const colher = (no: ts.Node) => {
    if (
      ts.isStringLiteral(no) ||
      ts.isNoSubstitutionTemplateLiteral(no) ||
      ts.isTemplateHead(no) ||
      ts.isTemplateMiddle(no) ||
      ts.isTemplateTail(no)
    )
      for (const t of no.text.split(/\s+/))
        if (
          PARECE_CLASSE.test(t) &&
          /[-:]/.test(t) &&
          // "criado:" (chave de evento) e "https://..." (endereço) não são classe.
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
  visitar(arvore);
  return [...achadas];
}

/**
 * Strings entre aspas que têm cara de classe mas são identificadores
 * (`data-testid`, `id`, motivo de erro, nome de rota). Lista FECHADA: o que
 * entrar aqui precisa ser, de fato, um identificador, nunca uma classe.
 */
const NAO_E_CLASSE = new Set([
  "fora-do-prazo",
  "nao-concluido",
  "preco-mudou",
  "conecte-se",
  "selo-de-escolhida",
  "bolinha-vazia",
  "checkout-name",
  "checkout-tel",
  "checkout-cpf",
  // ids dos campos do endereco do convidado (CAMPO_DO_INPUT), nao classes
  "guest-cep",
  "guest-number",
  "guest-street",
  "guest-neighborhood",
  "guest-city",
  "guest-state",
  "calculate-shipping",
  "sem-destino",
  "cupom-aplicado",
  "coupon-code-input",
  "campo-de-cupom",
  "titulo-cupons",
  "erro-cupom",
  "no-referrer-when-downgrade",
]);

/**
 * `<button>` ANTERIORES ao redesenho que já tinham borda sem `border-solid`
 * (dívida antiga, fora do escopo — pôr `border-solid` neles faria aparecer
 * uma moldura que o desenho original não tem). Retrato congelado: só
 * impede que apareça um botão NOVO assim. Tirar item é bem-vindo; pôr, nunca.
 */
const BOTOES_ANTIGOS_SEM_BORDA_SOLIDA: Record<string, readonly string[]> = {
  "src/views/customer/CheckoutView.tsx": [
    "flex min-h-11 w-full items-center justify-between gap-2 border-b border-zinc-100/55 bg-zinc-50/40 px-4 py-3 text-left transition-colors hover:bg-zinc-50",
    "rounded-lg border border-zinc-900 px-3 py-1.5 text-xs font-bold normal-case tracking-normal text-zinc-900 active:scale-[0.98]",
    "flex min-h-[44px] items-center rounded-lg border border-primary/40 bg-primary/10 px-4 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20",
    "flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95",
  ],
};

/** Classe que define LARGURA ou COR de borda (`border`, `border-2`, `border-t`, `border-zinc-900`...) — as que dependem do estilo `solid`. */
function ehLarguraOuCorDeBorda(classe: string): boolean {
  if (classe === "border") return true;
  if (!classe.startsWith("border-")) return false;
  let resto = classe.slice("border-".length);
  // Lado sozinho (`border-t`) é largura; lado + valor (`border-t-2`) segue.
  if (/^[trblxyse]$/.test(resto)) return true;
  if (/^[trblxyse]-/.test(resto)) resto = resto.slice(2);
  // Estilo, tabela e opacidade não são largura nem cor; `0` não desenha borda.
  const naoDesenha = [
    "solid",
    "dashed",
    "dotted",
    "double",
    "hidden",
    "none",
    "collapse",
    "separate",
    "0",
  ];
  return (
    !naoDesenha.includes(resto) &&
    !resto.startsWith("spacing") &&
    !resto.startsWith("opacity")
  );
}

/**
 * Descrições (linha + classes) dos `<button>` que têm classe de borda SEM
 * `border-solid`. Resolve `className={nome}` até o inicializador da variável
 * `nome` no mesmo arquivo.
 */
function botoesComBordaInvisivel(fonte: string): string[] {
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const variaveis = new Map<string, ts.Node>();
  const mapear = (no: ts.Node) => {
    if (
      ts.isVariableDeclaration(no) &&
      ts.isIdentifier(no.name) &&
      no.initializer
    )
      variaveis.set(no.name.text, no.initializer);
    ts.forEachChild(no, mapear);
  };
  mapear(arvore);

  const classesDe = (no: ts.Node, vistos = new Set<string>()): string[] => {
    const lista: string[] = [];
    const colher = (n: ts.Node) => {
      if (
        ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n)
      )
        lista.push(...n.text.split(/\s+/).filter(Boolean));
      else if (
        ts.isIdentifier(n) &&
        variaveis.has(n.text) &&
        !vistos.has(n.text)
      ) {
        vistos.add(n.text);
        lista.push(...classesDe(variaveis.get(n.text) as ts.Node, vistos));
      }
      ts.forEachChild(n, colher);
    };
    colher(no);
    return lista;
  };

  const problemas: string[] = [];
  const visitar = (no: ts.Node) => {
    const abertura = ts.isJsxElement(no)
      ? no.openingElement
      : ts.isJsxSelfClosingElement(no)
        ? no
        : null;
    if (abertura && /(^|\.)button$/.test(abertura.tagName.getText(arvore))) {
      for (const atributo of abertura.attributes.properties) {
        if (
          ts.isJsxAttribute(atributo) &&
          atributo.name.getText(arvore) === "className" &&
          atributo.initializer
        ) {
          const classes = classesDe(atributo.initializer);
          const temBorda = classes.some((c) => ehLarguraOuCorDeBorda(c));
          if (temBorda && !classes.includes("border-solid")) {
            const { line } = arvore.getLineAndCharacterOfPosition(
              abertura.getStart(arvore),
            );
            problemas.push(`linha ${line + 1}: ${classes.join(" ")}`);
          }
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arvore);
  return problemas;
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

  it("o leitor acha também as strings guardadas em variáveis e constantes", async () => {
    const fonte = `
      const x = "classe-falsa-um";
      const y = { a: "bg-zinc-100 text-zinc-700", b: ok ? "classe-falsa-dois" : "p-2" };
      const ID = "online";
      const z = \`border-2 \${c ? "classe-falsa-tres" : "p-4"}\`;
    `;
    const achadas = classesEmVariaveis(fonte);
    for (const esperada of [
      "classe-falsa-um",
      "bg-zinc-100",
      "text-zinc-700",
      "classe-falsa-dois",
      "classe-falsa-tres",
      "border-2",
      "p-4",
    ])
      expect(achadas).toContain(esperada);
    // Palavra solta (valor de enum) não é classe.
    expect(achadas).not.toContain("online");
    // Ponta a ponta: a classe falsa escondida na variável NÃO vira CSS e é pega.
    const geradas = await classesGeradas(achadas);
    expect(achadas.filter((c) => !geradas.has(c))).toEqual([
      "classe-falsa-um",
      "classe-falsa-dois",
      "classe-falsa-tres",
    ]);
  }, 60_000);

  it("controle da trava de borda: pega botão com border sem border-solid e deixa passar o que está certo", () => {
    const fonte = `
      const base = "rounded-2xl border-2";
      const a = <button className="border-2 border-zinc-900 p-3" />;
      const b = <button className="border-2 border-zinc-900 border-solid p-3" />;
      const c = <button className={cn("rounded-xl", ok ? "border border-zinc-200" : "border-transparent")} />;
      const d = <button className={base} />;
      const e = <div className="border-2 border-zinc-900" />;
      const f = <button className="border-0 p-2" />;
      const g = <button className="min-h-11 bg-zinc-100 hover:border-zinc-900" />;
    `;
    expect(botoesComBordaInvisivel(fonte).map((p) => p.split(":")[0])).toEqual([
      "linha 3",
      "linha 5",
      "linha 6",
    ]);
  });

  const jaNaoGeravam = new Map(Object.entries(JA_NAO_GERAVAM));
  const antigosPorArquivo = new Map(
    Object.entries(BOTOES_ANTIGOS_SEM_BORDA_SOLIDA),
  );
  for (const arquivo of ARQUIVOS) {
    const fonte = readFileSync(arquivo, "utf8");
    it(`${arquivo}: nenhuma classe nova deixa de gerar CSS`, async () => {
      const classes = [
        ...new Set([
          ...classesDoArquivo(fonte),
          ...classesEmVariaveis(fonte).filter((c) => !NAO_E_CLASSE.has(c)),
        ]),
      ];
      expect(classes.length).toBeGreaterThan(0);
      const geradas = await classesGeradas(classes);
      const permitidas = new Set(jaNaoGeravam.get(arquivo) ?? []);
      const faltando = classes.filter(
        (c) => !geradas.has(c) && !permitidas.has(c),
      );
      expect(faltando).toEqual([]);
    }, 60_000);

    it(`${arquivo}: todo <button> com borda leva border-solid (o reset do index.css apaga a borda)`, () => {
      const antigos = new Set(antigosPorArquivo.get(arquivo) ?? []);
      const novos = botoesComBordaInvisivel(fonte)
        .map((p) => p.replace(/^linha \d+: /, ""))
        .filter((classes) => !antigos.has(classes));
      expect(novos).toEqual([]);
    });
  }
});
