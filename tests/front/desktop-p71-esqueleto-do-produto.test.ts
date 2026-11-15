// P71 (produto no computador): o esqueleto "Carregando produto…" do App.tsx
// (link direto/compartilhado/recarregar, quando o produto não está na lista do
// catálogo) não tinha moldura nem classe de computador: ficava com a largura
// inteira, uma coluna e o quadrado cinza sem altura máxima (~1248 px a 1280x720,
// maior que a janela), com as barras de texto fora da tela. A página carregada
// (ProductView) tem container de 1280/1440 px, grade de 2 colunas e galeria com
// altura máxima; ao carregar, tudo pulava de lugar.
//
// A correção é só de computador: o esqueleto espelha a grade da página
// carregada. Só tokens `lg:`/`xl:`/`2xl:` entram; abaixo de 1024 px o className
// de cada elemento fica byte a byte o de antes (o snapshot do P1 também guarda
// isso). O jsdom não calcula CSS, então a prova é o código-fonte REAL lido por
// AST (o App é pesado demais para montar só por causa de um token) e mutantes em
// CÓPIA do fonte, para a trava não ser decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CONTAINER_DO_COMPUTADOR } from "../../src/components/desktop/medidas";
import { classesDoCelular } from "./classes-do-celular";

const FONTE = readFileSync("src/App.tsx", "utf8");
const PRODUTO = readFileSync("src/views/customer/ProductView.tsx", "utf8");
const GALERIA = readFileSync(
  "src/components/ui/custom/GaleriaDoProduto.tsx",
  "utf8",
);

const CONTAINER = CONTAINER_DO_COMPUTADOR.split(/\s+/);

const ELEMENTOS = [
  {
    nome: "raiz do esqueleto",
    celular: "flex min-h-[60vh] flex-col gap-4 px-4 pt-4",
    // O container vem de CONTAINER_DO_COMPUTADOR (mesma constante da página carregada).
    usaContainer: true,
    exige: [
      "lg:grid",
      "lg:grid-cols-[minmax(0,1fr)_420px]",
      "xl:grid-cols-[minmax(0,1fr)_440px]",
      "lg:grid-rows-[auto_auto_1fr]",
      "lg:gap-x-12",
      "lg:gap-y-4",
      "lg:pt-8",
    ],
  },
  {
    nome: "quadrado da foto",
    celular: "aspect-square w-full animate-pulse rounded-2xl bg-zinc-100",
    usaContainer: false,
    exige: [
      "lg:col-start-1",
      "lg:row-start-1",
      "lg:row-span-3",
      "lg:self-start",
      "lg:max-h-[calc(100dvh-var(--header-height)-220px)]",
      "lg:rounded-3xl",
    ],
  },
  {
    nome: "barra do título",
    celular: "h-6 w-2/3 animate-pulse rounded bg-zinc-100",
    usaContainer: false,
    exige: ["lg:col-start-2", "lg:row-start-1"],
  },
  {
    nome: "barra do preço",
    celular: "h-4 w-1/3 animate-pulse rounded bg-zinc-100",
    usaContainer: false,
    exige: ["lg:col-start-2", "lg:row-start-2"],
  },
] as const;

type Elemento = (typeof ELEMENTOS)[number];

function arquivoDe(fonte: string) {
  return ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Acha os elementos JSX cujo className tem o literal de celular `celular`:
 * string solta ou `cn("<celular>", <identificadores>, "lg:…")`. */
function achar(fonte: string, celular: string) {
  const arquivo = arquivoDe(fonte);
  const achados: {
    celularCompleto: string;
    tokensDeComputador: string[];
    identificadores: string[];
  }[] = [];
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText(arquivo) === "className" &&
      no.initializer &&
      ts.isStringLiteral(no.initializer)
    ) {
      const texto = no.initializer.text;
      if (classesDoCelular(texto) === celular)
        achados.push({
          celularCompleto: classesDoCelular(texto),
          tokensDeComputador: texto.split(/\s+/).filter((t) => t.includes(":")),
          identificadores: [],
        });
    } else if (
      ts.isJsxAttribute(no) &&
      no.name.getText(arquivo) === "className" &&
      no.initializer &&
      ts.isJsxExpression(no.initializer) &&
      no.initializer.expression &&
      ts.isCallExpression(no.initializer.expression) &&
      no.initializer.expression.expression.getText(arquivo) === "cn"
    ) {
      const argumentos = no.initializer.expression.arguments;
      const literais = argumentos.filter(ts.isStringLiteral).map((a) => a.text);
      const identificadores = argumentos
        .filter(ts.isIdentifier)
        .map((a) => a.text);
      const [primeiro] = argumentos;
      if (
        primeiro &&
        ts.isStringLiteral(primeiro) &&
        primeiro.text === celular
      ) {
        achados.push({
          // O que vale abaixo de 1024 px: tudo que não é token de computador.
          celularCompleto: literais.map(classesDoCelular).join(" ").trim(),
          tokensDeComputador: literais
            .slice(1)
            .flatMap((l) => l.split(/\s+/))
            .filter(Boolean),
          identificadores,
        });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados;
}

function importaContainer(fonte: string): boolean {
  const arquivo = arquivoDe(fonte);
  return arquivo.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === "@/components/desktop/medidas" &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some(
        (e) => e.name.text === "CONTAINER_DO_COMPUTADOR",
      ),
  );
}

function problemas(fonte: string, el: Elemento): string[] {
  const achados = achar(fonte, el.celular);
  if (achados.length !== 1) return [`achou ${achados.length} elementos`];
  const [{ celularCompleto, tokensDeComputador, identificadores }] = achados;
  const erros: string[] = [];
  if (celularCompleto !== el.celular)
    erros.push(`celular mudou: ${celularCompleto}`);
  const efetivos = new Set(tokensDeComputador);
  if (el.usaContainer) {
    if (!identificadores.includes("CONTAINER_DO_COMPUTADOR"))
      erros.push("falta CONTAINER_DO_COMPUTADOR");
    if (!importaContainer(fonte)) erros.push("falta importar o container");
    for (const t of CONTAINER) efetivos.add(t);
  }
  for (const t of el.exige) if (!efetivos.has(t)) erros.push(`falta ${t}`);
  for (const t of efetivos)
    if (!/^(lg|xl|2xl):/.test(t)) erros.push(`token sem prefixo de PC: ${t}`);
  return erros;
}

describe("P71 — esqueleto do produto espelha a grade da página carregada no computador", () => {
  for (const el of ELEMENTOS) {
    it(`${el.nome}: ganha as classes de computador e o celular fica como estava`, () => {
      expect(problemas(FONTE, el)).toEqual([]);
    });
  }

  it("o container do esqueleto é o mesmo da página carregada (valor da constante)", () => {
    expect(CONTAINER).toEqual([
      "lg:mx-auto",
      "lg:w-full",
      "lg:max-w-[1280px]",
      "lg:px-8",
      "2xl:max-w-[1440px]",
    ]);
    expect(PRODUTO).toContain("CONTAINER_DO_COMPUTADOR");
    expect(PRODUTO).toContain(
      "lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-x-12 lg:gap-y-8 lg:pt-8 xl:grid-cols-[minmax(0,1fr)_440px]",
    );
  });

  it("a altura máxima do quadrado é a mesma da galeria da página carregada", () => {
    expect(GALERIA).toContain(
      "lg:max-h-[calc(100dvh-var(--header-height)-220px)]",
    );
  });

  it("mutante: tirar lg:grid da raiz fica vermelho", () => {
    const mutante = FONTE.replace(
      "lg:grid lg:grid-cols-[minmax(0,1fr)_420px]",
      "lg:grid-cols-[minmax(0,1fr)_420px]",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante, ELEMENTOS[0])).toContain("falta lg:grid");
    expect(problemas(mutante, ELEMENTOS[1])).toEqual([]);
  });

  it("mutante: tirar o max-h do quadrado fica vermelho", () => {
    const mutante = FONTE.replace(
      "lg:max-h-[calc(100dvh-var(--header-height)-220px)]",
      "",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante, ELEMENTOS[1])).toContain(
      "falta lg:max-h-[calc(100dvh-var(--header-height)-220px)]",
    );
  });

  it("mutante: classe sem prefixo no quadrado fica vermelho", () => {
    const mutante = FONTE.replace(
      "aspect-square w-full animate-pulse rounded-2xl bg-zinc-100",
      "aspect-square w-full max-h-96 animate-pulse rounded-2xl bg-zinc-100",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante, ELEMENTOS[1])).toEqual(["achou 0 elementos"]);
  });
});
