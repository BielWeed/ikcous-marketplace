// P74: no computador, "Meus pedidos" (abas + painel, em CartView) e o detalhe do
// pedido (OrderDetailsView) ficavam MAIS ESTREITOS que o cabeçalho da loja.
//
// A) Abas e painel de pedidos tinham `lg:max-w-[1216px]`. O Tailwind mede a
//    caixa inteira (border-box): 1216 de caixa com `lg:px-8` dá 1152 de
//    conteúdo, 32 px mais para dentro de cada lado que o cabeçalho (caixa de
//    1280, conteúdo de 1216). Entre 1217 e 1535 px o desalinhamento aparecia
//    (a 1280: cabeçalho de 32 a 1248, cartões de 64 a 1216).
//    Correção: UMA classe por elemento, `lg:min-w-[min(100%,1280px)]`. O
//    `min-width` vence o `max-width` quando os dois brigam (regra do CSS, não
//    ordem de cascata), então a caixa sobe até min(largura da tela, 1280) sem
//    tocar nas classes de hoje -- e a partir de 1536 o `2xl:max-w-[1440px]` do
//    P64 continua mandando (1440 > 1280, o piso não aperta).
// B) O detalhe do pedido vive DENTRO do contêiner da casca (PaginaDoComputador:
//    32 px de recuo) e ainda tinha `px-6` (24 px) no título e na grade. Correção:
//    `lg:px-0` nos dois.
//
// jsdom não calcula layout. A prova de largura compila o Tailwind REAL do
// projeto e resolve a cascata por largura de tela (mesmo método do P64).
// Os literais de celular abaixo são CONGELADOS à mão a partir da base a3ae70250.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CONTAINER_DO_COMPUTADOR } from "@/components/desktop/medidas";
import { classesDoCelular } from "./classes-do-celular";

// Fonte lida uma vez, com caminho literal (a regra de segurança do eslint não
// aceita caminho em variável).
const CART = readFileSync("src/views/customer/CartView.tsx", "utf8");
const DETALHE = readFileSync("src/views/customer/OrderDetailsView.tsx", "utf8");

// --- Literais da base a3ae70250 (celular + tokens de computador de ANTES) ---
const ABAS = {
  prefixo: "sticky top-[-2px] z-50 bg-background/95",
  celular:
    "sticky top-[-2px] z-50 bg-background/95 px-4 py-3 backdrop-blur-md min-[380px]:px-5",
  computador: [
    "lg:mx-auto",
    "lg:w-full",
    "lg:px-8",
    "lg:has-[#tab-cart[aria-selected=true]]:max-w-7xl",
    "lg:has-[#tab-orders[aria-selected=true]]:max-w-[1216px]",
    "2xl:has-[#tab-cart[aria-selected=true]]:max-w-[1440px]",
    "2xl:has-[#tab-orders[aria-selected=true]]:max-w-[1440px]",
  ],
  acrescentado: [
    "lg:has-[#tab-orders[aria-selected=true]]:min-w-[min(100%,1280px)]",
  ],
};
const PAINEL = {
  prefixo: "flex w-full flex-1 flex-col px-4 pb-6 pt-0",
  celular:
    "flex w-full flex-1 flex-col px-4 pb-6 pt-0 focus:outline-none min-[380px]:px-5",
  computador: [
    "lg:mx-auto",
    "lg:max-w-[1216px]",
    "lg:px-8",
    "lg:pt-6",
    "2xl:max-w-[1440px]",
  ],
  acrescentado: ["lg:min-w-[min(100%,1280px)]"],
};
const TITULO_DO_DETALHE = {
  prefixo: "px-6 pb-2 pt-6",
  celular: "px-6 pb-2 pt-6",
  computador: [] as string[],
  acrescentado: ["lg:px-0"],
};
const GRADE_DO_DETALHE = {
  prefixo: "mx-auto max-w-2xl space-y-4 px-6 py-4",
  celular: "mx-auto max-w-2xl space-y-4 px-6 py-4",
  computador: [
    "lg:grid",
    "lg:max-w-none",
    "lg:grid-cols-2",
    "lg:items-start",
    "lg:gap-6",
    "lg:space-y-0",
  ],
  acrescentado: ["lg:px-0"],
};

/** Todo literal de `className` do arquivo (também dentro de cn(...) e ternários). */
function literaisDeClasse(fonte: string): string[] {
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
      const coletar = (filho: ts.Node) => {
        if (
          ts.isStringLiteral(filho) ||
          ts.isNoSubstitutionTemplateLiteral(filho)
        ) {
          achados.push(filho.text);
        }
        ts.forEachChild(filho, coletar);
      };
      if (no.initializer) coletar(no.initializer);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  return achados;
}

function literalDe(fonte: string, prefixo: string): string {
  const achados = literaisDeClasse(fonte).filter((l) => l.startsWith(prefixo));
  expect(achados, `literal que começa por "${prefixo}"`).toHaveLength(1);
  return achados[0];
}

const PREFIXOS = new Set(["lg", "xl", "2xl"]);
const dosComputador = (literal: string) =>
  literal
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => PREFIXOS.has(t.split(":")[0]));

const PEDACOS = [
  [CART, ABAS, "as abas de Meus pedidos"],
  [CART, PAINEL, "o painel de Meus pedidos"],
  [DETALHE, TITULO_DO_DETALHE, "o título do detalhe do pedido"],
  [DETALHE, GRADE_DO_DETALHE, "a grade do detalhe do pedido"],
] as const;

describe("P74 -- só classes de computador acrescentadas, no elemento certo", () => {
  for (const [caminho, pedaco, nome] of PEDACOS) {
    it(`${nome}: celular byte a byte igual`, () => {
      const literal = literalDe(caminho, pedaco.prefixo);
      expect(classesDoCelular(literal)).toBe(pedaco.celular);
      // O literal começa pelo celular: nenhum token novo foi plantado na frente.
      expect(literal.startsWith(pedaco.celular)).toBe(true);
    });

    it(`${nome}: os tokens de computador de hoje seguem iguais, na mesma ordem, e só os novos entram`, () => {
      const literal = literalDe(caminho, pedaco.prefixo);
      const todos = dosComputador(literal);
      // O eslint (tailwindcss/classnames-order) decide ONDE cada token novo
      // cai; o que importa é que os de antes não mudaram nem de valor nem de
      // ordem e que entrou exatamente o que foi planejado.
      expect(todos.filter((t) => !pedaco.acrescentado.includes(t))).toEqual(
        pedaco.computador,
      );
      expect(todos.filter((t) => pedaco.acrescentado.includes(t))).toEqual(
        pedaco.acrescentado,
      );
    });
  }

  it("cada classe nova está só no elemento a que pertence (nem nas abas e no painel trocados, nem em outro lugar)", () => {
    const noCart = literaisDeClasse(CART);
    const noDetalhe = literaisDeClasse(DETALHE);
    const conta = (lista: string[], token: string) =>
      lista.filter((l) => l.split(/\s+/).includes(token)).length;

    expect(
      conta(
        noCart,
        "lg:has-[#tab-orders[aria-selected=true]]:min-w-[min(100%,1280px)]",
      ),
    ).toBe(1);
    expect(conta(noCart, "lg:min-w-[min(100%,1280px)]")).toBe(1);
    expect(conta(noCart, "lg:px-0")).toBe(0);
    expect(conta(noDetalhe, "lg:px-0")).toBe(2);
    expect(conta(noDetalhe, "lg:min-w-[min(100%,1280px)]")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A conta por largura de tela, com o Tailwind real.
// ---------------------------------------------------------------------------
type Regra = { minLargura: number; seletor: string; decl: [string, string][] };

async function compilar(tokens: string[]): Promise<Regra[]> {
  const requisitar = createRequire(import.meta.url);
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: tokens.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
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
    const decl: [string, string][] = [];
    regra.walkDecls((d) => {
      decl.push([d.prop, d.value.replace(/\s+/g, "")]);
    });
    regras.push({ minLargura, seletor: regra.selector, decl });
  });
  return regras;
}

/** O seletor chega escapado (`\32xl\:has-\[...`, a vírgula como `\2c `); desfaz para comparar com o token. */
const semEscape = (s: string) =>
  s
    .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\/g, "");

/** Regras de utilitário dos tokens dados, na ordem da folha de estilo. */
function dosTokens(
  regras: Regra[],
  tokens: string[],
  filtro: (s: string) => boolean,
) {
  // Token que o Tailwind não compilou (ou que o escape não reconheceu) não pode
  // sumir em silêncio: a conta de largura ficaria sem a regra dele.
  for (const t of tokens) {
    expect(
      regras.some((r) => semEscape(r.seletor).startsWith(`.${t}`)),
      `o Tailwind gerou regra para ${t}`,
    ).toBe(true);
  }
  return regras.filter((r) => {
    const s = semEscape(r.seletor);
    return tokens.some((t) => s.startsWith(`.${t}`)) && filtro(s);
  });
}

function medida(
  valor: string | undefined,
  tela: number,
  padrao: number,
): number {
  if (valor === undefined) return padrao;
  if (valor === "none") return Number.POSITIVE_INFINITY;
  const min = /^min\((.+)\)$/.exec(valor);
  if (min) {
    return Math.min(...min[1].split(",").map((p) => medida(p, tela, padrao)));
  }
  if (valor.endsWith("%")) return (tela * Number.parseFloat(valor)) / 100;
  if (valor.endsWith("rem")) return Number.parseFloat(valor) * 16;
  if (valor.endsWith("px")) return Number.parseFloat(valor);
  if (valor === "0") return 0;
  throw new Error(`valor não previsto: ${valor}`);
}

/** Resolve a cascata (a regra posterior ganha) das regras que valem naquela largura. */
function resolver(regras: Regra[], tela: number): Map<string, string> {
  const final = new Map<string, string>();
  for (const r of regras) {
    if (r.minLargura > tela) continue;
    for (const [prop, valor] of r.decl) final.set(prop, valor);
  }
  return final;
}

/** Borda esquerda do CONTEÚDO de um bloco `mx-auto w-full` dentro de uma tela. */
function bordaEsquerda(estilo: Map<string, string>, tela: number): number {
  const larguraDaCaixa = medida(estilo.get("width"), tela, tela);
  const teto = medida(estilo.get("max-width"), tela, Number.POSITIVE_INFINITY);
  const piso = medida(estilo.get("min-width"), tela, 0);
  // CSS: min-width vence max-width quando brigam.
  const caixa = Math.max(Math.min(larguraDaCaixa, teto), piso);
  const recuo = medida(estilo.get("padding-left"), tela, 0);
  return (tela - caixa) / 2 + recuo;
}

const TELAS = [
  1024, 1100, 1216, 1217, 1250, 1279, 1280, 1366, 1440, 1535, 1536, 1920,
];
const tokensDoCabecalho = CONTAINER_DO_COMPUTADOR.split(/\s+/);

async function bordaDoCabecalho() {
  const regras = await compilar(tokensDoCabecalho);
  const proprias = dosTokens(regras, tokensDoCabecalho, () => true);
  return (tela: number) => bordaEsquerda(resolver(proprias, tela), tela);
}

describe("P74 -- A: abas e painel de Meus pedidos alinham com o cabeçalho (1024 a 1920)", () => {
  it("a borda do conteúdo é a mesma do cabeçalho em todas as larguras", async () => {
    const cabecalho = await bordaDoCabecalho();
    for (const [caminho, pedaco, nome] of [
      [CART, ABAS, "abas"],
      [CART, PAINEL, "painel"],
    ] as const) {
      const literal = literalDe(caminho, pedaco.prefixo);
      const todos = literal.split(/\s+/).filter(Boolean);
      const regras = await compilar(todos);
      // Aba Pedidos selecionada: vale o que é de `#tab-orders` ou não condicional.
      const proprias = dosTokens(regras, todos, (s) => !s.includes("tab-cart"));
      for (const tela of TELAS) {
        expect(
          bordaEsquerda(resolver(proprias, tela), tela),
          `${nome} em ${tela}px`,
        ).toBeCloseTo(cabecalho(tela), 5);
      }
    }
  }, 60_000);

  it("o 2xl do P64 segue mandando: a 1536 e 1920 as duas caixas têm 1440 (borda 32 e 240+32 = 272 em 1920)", async () => {
    const cabecalho = await bordaDoCabecalho();
    expect(cabecalho(1536)).toBe(32 + 48);
    expect(cabecalho(1920)).toBe(240 + 32);
    const painel = literalDe(CART, PAINEL.prefixo).split(/\s+/).filter(Boolean);
    const proprias = dosTokens(await compilar(painel), painel, () => true);
    expect(bordaEsquerda(resolver(proprias, 1536), 1536)).toBe(48 + 32);
    expect(bordaEsquerda(resolver(proprias, 1920), 1920)).toBe(240 + 32);
  }, 60_000);
});

describe("P74 -- B: o detalhe do pedido alinha com o cabeçalho (1024 a 1920)", () => {
  it("a casca da página recua com o MESMO contêiner do cabeçalho; o título e a grade não somam recuo próprio no computador", async () => {
    // A casca (PaginaDoComputador) usa CONTAINER_DO_COMPUTADOR, o mesmo do
    // cabeçalho: a borda dela é a do cabeçalho em toda largura. O que o
    // elemento soma por dentro é o que desalinhava (px-6 = 24 px).
    expect(
      readFileSync("src/components/desktop/PaginaDoComputador.tsx", "utf8"),
    ).toContain("${CONTAINER_DO_COMPUTADOR}");
    for (const [pedaco, nome] of [
      [TITULO_DO_DETALHE, "título"],
      [GRADE_DO_DETALHE, "grade"],
    ] as const) {
      const literal = literalDe(DETALHE, pedaco.prefixo);
      const todos = literal.split(/\s+/).filter(Boolean);
      const proprias = dosTokens(await compilar(todos), todos, () => true);
      for (const tela of TELAS) {
        const recuoProprio = medida(
          resolver(proprias, tela).get("padding-left"),
          tela,
          0,
        );
        expect(recuoProprio, `${nome} em ${tela}px`).toBe(0);
      }
      // Abaixo do computador o recuo de 24 px continua valendo (celular intacto).
      expect(
        medida(resolver(proprias, 700).get("padding-left"), 700, 0),
        `${nome} em 700px`,
      ).toBe(24);
    }
  }, 60_000);
});
