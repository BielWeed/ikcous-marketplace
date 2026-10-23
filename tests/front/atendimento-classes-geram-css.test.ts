// Redesenho das telas Perguntas e Avaliações do painel (22/10/2026).
//
// POR QUE ESTE TESTE EXISTE: o jsdom não calcula CSS. Uma classe que o
// Tailwind deste projeto NÃO gera (nome inventado, escala que a configuração
// não tem) passa em todo teste de componente e simplesmente não pinta nada na
// tela do celular. Aqui o Tailwind REAL do projeto (tailwind.config.js +
// src/index.css) compila as classes de cada arquivo das duas telas e o teste
// reprova se alguma não virar regra. Lê toda string literal de `className`,
// de `cn(...)` e de variáveis/constantes do arquivo (classe escondida numa
// variável também não pode passar sem CSS).
//
// SEGUNDA TRAVA (botão com borda): `src/index.css` zera a borda de TODO
// `<button>` e o `border`/`border-<cor>` do Tailwind só define largura e cor,
// não o estilo. Sem `border-solid` a borda NÃO aparece no celular. Todo
// `<button>` com classe de borda precisa de `border-solid`.
//
// TERCEIRA TRAVA (regra do dono): estas telas são NEUTRAS — nenhuma cor de
// marca (`admin-gold`, nem `amber`/`yellow` como preenchimento), nenhum degradê.
// Cor só quando significa algo (verde, vermelho, âmbar, azul), em texto, ponto
// ou glifo. Tema Claro/Confortável: só tokens `admin-*` e classes que o gerador
// de temas conhece, nunca cor fixa (`#...`).
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

/** Arquivos que o redesenho mexe. */
const ARQUIVOS = [
  "src/views/admin/AdminQAView.tsx",
  "src/components/admin/atendimento/controles.tsx",
  "src/components/admin/atendimento/FolhaDeResposta.tsx",
  "src/components/admin/primitivos/AlternadorDeTelas.tsx",
] as const;

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
 * Strings entre aspas que têm cara de classe mas são identificadores (chave de
 * rolagem, id de campo). Lista FECHADA: o que entrar aqui precisa ser, de
 * fato, um identificador, nunca uma classe.
 */
const NAO_E_CLASSE = new Set([
  "admin-qa",
  "admin-reviews",
  "qa-search",
  "reviews-search",
]);

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

describe("telas Perguntas e Avaliações — classes viram regra, sem dourado e sem borda invisível", () => {
  it("controle: uma classe inventada NÃO vira regra e uma de verdade vira", async () => {
    const geradas = await classesGeradas([
      "bg-marca-inventada-900",
      "bg-admin-raised",
      "min-h-11",
      "line-clamp-2",
      "border-l-[3px]",
    ]);
    expect(geradas.has("bg-marca-inventada-900")).toBe(false);
    expect(geradas.has("bg-admin-raised")).toBe(true);
    expect(geradas.has("min-h-11")).toBe(true);
    expect(geradas.has("line-clamp-2")).toBe(true);
    expect(geradas.has("border-l-[3px]")).toBe(true);
  }, 60_000);

  it("controle da trava de borda: pega botão com border sem border-solid e deixa passar o que está certo", () => {
    const fonte = `
      const a = <button className="border border-zinc-900 p-3" />;
      const b = <button className="border border-zinc-900 border-solid p-3" />;
      const c = <div className="border border-zinc-900" />;
    `;
    expect(botoesComBordaInvisivel(fonte).map((p) => p.split(":")[0])).toEqual([
      "linha 2",
    ]);
  });

  for (const arquivo of ARQUIVOS) {
    const fonte = readFileSync(arquivo, "utf8");

    it(`${arquivo}: toda classe gera CSS`, async () => {
      const classes = [
        ...new Set([
          ...classesDoArquivo(fonte),
          ...classesEmVariaveis(fonte).filter((c) => !NAO_E_CLASSE.has(c)),
        ]),
      ];
      expect(classes.length).toBeGreaterThan(0);
      const geradas = await classesGeradas(classes);
      expect(classes.filter((c) => !geradas.has(c))).toEqual([]);
    }, 60_000);

    it(`${arquivo}: todo <button> com borda leva border-solid`, () => {
      expect(botoesComBordaInvisivel(fonte)).toEqual([]);
    });

    it(`${arquivo}: sem cor de marca, sem degradê e sem cor fixa`, () => {
      const classes = [
        ...classesDoArquivo(fonte),
        ...classesEmVariaveis(fonte),
      ];
      expect(classes.filter((c) => /admin-gold/.test(c))).toEqual([]);
      expect(
        classes.filter((c) => /(^|:)(bg-gradient|from-|via-|to-)/.test(c)),
      ).toEqual([]);
      // Preenchimento amarelo/âmbar/laranja é cor de marca disfarçada: o âmbar
      // do estado "pendente" é só texto e ponto.
      expect(
        classes.filter((c) => /(^|:)bg-(amber|yellow|orange)-/.test(c)),
      ).toEqual([]);
      expect(classes.filter((c) => /#[0-9a-fA-F]{3,8}/.test(c))).toEqual([]);
    });
  }
});
