// @vitest-environment jsdom
//
// P57 (uso de PC com mouse): faixas horizontais com `overflow-x-auto` deixavam
// itens fora de alcance. A barra de rolagem é ESCONDIDA no projeto inteiro
// (`src/index.css`, `display:none !important`), e quem usa mouse não tem o
// dedo para arrastar a faixa: o que passa da borda some. Conta feita pela
// leitura do código:
//   A) sugestões do frete grátis (carrinho): até 10 cartões de 148 px = 1620 px
//      numa coluna de ~802 px;
//   B) fotos da variação (modal do produto): até 10 fotos de 64 px num modal de
//      ~436 px;
//   C) público do push: 4 cartões de 220 px = 932 px numa faixa de ~712 px;
//   D) categorias do cabeçalho: a faixa tem `h-12` e `overflow-x-auto`, que
//      vira `overflow-y: auto` também e CORTA o anel de foco (2 px + 2 px de
//      afastamento = 56 px de altura precisados) 4 px acima e abaixo.
// A correção é só de computador (`lg:`): A, B e C quebram em linhas em vez de
// rolar; D passa o anel de foco para DENTRO do botão. Abaixo de 1024 px o
// className de cada peça fica byte a byte o de antes.
//
// Congelado como literal (o CI clona só o último commit: nada de ler
// histórico). O jsdom não calcula CSS: o que só o Chromium prova (a quebra de
// linha de fato, o anel inteiro à vista) está no relatório da peça. Aqui a
// prova é o className do código REAL (o componente montado, no caso do A; o
// código-fonte lido por AST em todos, porque os outros são telas pesadas demais
// para montar só por causa de um token) e mutantes em CÓPIA desse código-fonte,
// para a trava não ser decorativa.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FONTE_FRETE = readFileSync(
  "src/components/ui/custom/ShippingProgress.tsx",
  "utf8",
);
const FONTE_PRODUTO = readFileSync(
  "src/views/admin/AdminProductFormView.tsx",
  "utf8",
);
const FONTE_PUSH = readFileSync("src/views/admin/AdminPushView.tsx", "utf8");
const FONTE_CABECALHO = readFileSync(
  "src/components/desktop/CabecalhoDoComputador.tsx",
  "utf8",
);

// Como cada peça era no celular (o que vale abaixo de 1024 px).
const CELULAR_SUGESTOES_DO_FRETE =
  "no-scrollbar -mx-4 flex gap-3 overflow-x-auto scroll-smooth px-4 pb-1";
const CELULAR_FOTOS_DA_VARIACAO =
  "custom-scrollbar-hidden flex w-full snap-x gap-3 overflow-x-auto p-1";
const CELULAR_PUBLICO_DO_PUSH =
  "relative -m-1 flex snap-x snap-mandatory scroll-pl-1 gap-2 overflow-x-auto p-1 pb-2 pr-6";
const CELULAR_GRADIENTE_DO_PUSH =
  "pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-admin-bg to-transparent";
const CELULAR_CATEGORIA_DO_CABECALHO =
  "min-h-11 shrink-0 border-b-2 px-1 text-sm hover:text-foreground border-foreground font-bold border-transparent text-muted-foreground";

// O que o computador ganha. Sem `overflow-x-visible` a faixa continuaria
// cortando; sem `flex-wrap` o que passa da borda continuaria inalcançável.
const FAIXA_QUEBRA_LINHA = ["lg:flex-wrap", "lg:overflow-x-visible"];

type Peca = {
  nome: string;
  fonte: string;
  /** Classe de celular do elemento procurado. */
  celular: string;
  /** Se existir, o alvo é o IRMÃO que vem logo depois do elemento com esta classe de celular. */
  ancora?: string;
  novas: string[];
};

const PECAS: Peca[] = [
  {
    nome: "A sugestões do frete",
    fonte: FONTE_FRETE,
    celular: CELULAR_SUGESTOES_DO_FRETE,
    novas: FAIXA_QUEBRA_LINHA,
  },
  {
    nome: "B fotos da variação",
    fonte: FONTE_PRODUTO,
    celular: CELULAR_FOTOS_DA_VARIACAO,
    novas: [...FAIXA_QUEBRA_LINHA, "lg:snap-none"],
  },
  {
    nome: "C público do push",
    fonte: FONTE_PUSH,
    celular: CELULAR_PUBLICO_DO_PUSH,
    novas: [...FAIXA_QUEBRA_LINHA, "lg:snap-none", "lg:pr-1"],
  },
  {
    // O degradê da direita só insinua "tem mais"; sem rolagem não há mais para
    // a direita. Há outro degradê idêntico, de outra faixa, no mesmo arquivo:
    // por isso o achado é pelo vizinho (o que vem logo depois do público).
    nome: "C degradê do público do push",
    fonte: FONTE_PUSH,
    celular: CELULAR_GRADIENTE_DO_PUSH,
    ancora: CELULAR_PUBLICO_DO_PUSH,
    novas: ["lg:hidden"],
  },
  {
    nome: "D categoria do cabeçalho",
    fonte: FONTE_CABECALHO,
    celular: CELULAR_CATEGORIA_DO_CABECALHO,
    novas: ["lg:focus-visible:ring-inset", "lg:focus-visible:ring-offset-0"],
  },
];

type Literal = { inicio: number; fim: number; texto: string };
type Elemento = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type Filho = ts.JsxElement | ts.JsxSelfClosingElement;

function analisar(texto: string) {
  return ts.createSourceFile(
    "fonte.tsx",
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Os literais de texto do `className` de um elemento JSX, com a posição. */
function literaisDoClassName(elemento: Elemento, fonte: ts.SourceFile) {
  const literais: Literal[] = [];
  for (const prop of elemento.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.getText(fonte) !== "className") {
      continue;
    }
    const coletar = (no: ts.Node) => {
      // Literal de comparação (`currentView === "home"`) não é classe.
      if (ts.isStringLiteral(no) && ts.isBinaryExpression(no.parent)) return;
      if (ts.isStringLiteral(no)) {
        // Sem aspas; nenhum destes literais tem escape.
        literais.push({
          inicio: no.getStart(fonte) + 1,
          fim: no.getEnd() - 1,
          texto: no.text,
        });
      } else ts.forEachChild(no, coletar);
    };
    if (prop.initializer) coletar(prop.initializer);
  }
  return literais;
}

const juntar = (literais: Literal[]) =>
  literais.map((literal) => literal.texto).join(" ");

const abertura = (filho: Filho): Elemento =>
  ts.isJsxElement(filho) ? filho.openingElement : filho;

/**
 * Os literais de `className` do ÚNICO elemento cuja parte de celular é
 * exatamente `celular` (ou do irmão que vem logo depois do elemento `ancora`).
 * Achar por aí já é a prova de que o celular não mudou: se mudasse, nenhum
 * elemento casaria.
 */
function achar(texto: string, celular: string, ancora?: string) {
  const fonte = analisar(texto);
  const procurado = ancora ?? celular;
  const achados: Literal[][] = [];
  const casa = (elemento: Elemento) => {
    const literais = literaisDoClassName(elemento, fonte);
    return (
      literais.length > 0 && classesDoCelular(juntar(literais)) === procurado
    );
  };
  const visitar = (no: ts.Node) => {
    if (
      !ancora &&
      (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no)) &&
      casa(no)
    ) {
      achados.push(literaisDoClassName(no, fonte));
    }
    if (ancora && ts.isJsxElement(no)) {
      const filhos = no.children.filter(
        (filho): filho is Filho =>
          ts.isJsxElement(filho) || ts.isJsxSelfClosingElement(filho),
      );
      filhos.forEach((filho, i) => {
        const proximo = filhos.at(i + 1);
        if (proximo && casa(abertura(filho))) {
          achados.push(literaisDoClassName(abertura(proximo), fonte));
        }
      });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  expect(
    achados,
    `deve haver exatamente um elemento com o celular "${procurado}"`,
  ).toHaveLength(1);
  return achados.at(0) as Literal[];
}

function problemasDaClasse(className: string, peca: Peca) {
  const achados: string[] = [];
  if (classesDoCelular(className) !== peca.celular) {
    achados.push("a classe do celular mudou");
  }
  const tokens = className.split(/\s+/);
  for (const token of peca.novas) {
    if (!tokens.includes(token)) achados.push(`falta ${token}`);
  }
  return achados;
}

/** O que falta numa peça: o celular mudou ou falta classe de computador. */
function problemas(peca: Peca, fonte: string) {
  let literais: Literal[];
  try {
    literais = achar(fonte, peca.celular, peca.ancora);
  } catch {
    return ["o elemento com a classe de celular não foi achado"];
  }
  // O alvo achado já tem o celular certo; sobra conferir as classes novas.
  return problemasDaClasse(juntar(literais), peca);
}

/** Cópia do código-fonte com um literal do className trocado (mutante). */
function mutar(
  peca: Peca,
  transformar: (literal: string) => string,
  qual: (literal: string) => boolean,
) {
  const literais = achar(peca.fonte, peca.celular, peca.ancora);
  const alvo = literais.find((literal) => qual(literal.texto));
  expect(alvo, "literal a mutar").toBeTruthy();
  const { inicio, fim, texto } = alvo as Literal;
  const novo = transformar(texto);
  expect(novo).not.toBe(texto);
  return peca.fonte.slice(0, inicio) + novo + peca.fonte.slice(fim);
}

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

async function montarSugestoesDoFrete() {
  const { ShippingProgress } = await import(
    "@/components/ui/custom/ShippingProgress"
  );
  const produtos = [1, 2, 3].map((n) => ({
    id: `prod-${n}`,
    name: `Produto ${n}`,
    description: "",
    price: 10 * n,
    images: [],
    category: "geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  }));
  await act(async () => {
    raiz.render(
      <ShippingProgress
        estado="meta"
        savings={0}
        progressPercent={50}
        amountToFree={10}
        isNearlyThere={false}
        freeShippingProducts={produtos as never}
        onAddToCart={vi.fn()}
      />,
    );
  });
}

describe("P57 — faixas que quebram em linhas no computador", () => {
  describe("A) sugestões do frete grátis, no carrinho (componente montado)", () => {
    it("celular intacto e quebra de linha no computador", async () => {
      await montarSugestoesDoFrete();
      const faixa = host.querySelector<HTMLElement>(".overflow-x-auto");
      expect(faixa, "faixa das sugestões").toBeTruthy();
      expect(faixa?.children).toHaveLength(3);
      const peca = PECAS.find((p) => p.nome.startsWith("A")) as Peca;
      expect(problemasDaClasse(faixa?.className ?? "", peca)).toEqual([]);
    });

    it("cada cartão segue com largura fixa de 148 px (a quebra conta com isso)", async () => {
      await montarSugestoesDoFrete();
      const faixa = host.querySelector<HTMLElement>(".overflow-x-auto");
      for (const cartao of Array.from(faixa?.children ?? [])) {
        expect(cartao.className).toContain("w-[148px]");
        expect(cartao.className).toContain("flex-shrink-0");
      }
    });
  });

  describe("celular intacto e classes de computador no código-fonte real", () => {
    it.each(PECAS.map((peca) => [peca.nome, peca] as const))(
      "%s",
      (_nome, peca) => {
        expect(problemas(peca, peca.fonte)).toEqual([]);
      },
    );

    it("a faixa de categorias continua com h-12 e overflow-x-auto (o anel é que vai para dentro)", () => {
      expect(FONTE_CABECALHO).toContain(
        '"no-scrollbar flex h-12 items-stretch gap-6 overflow-x-auto"',
      );
    });
  });

  // Mutantes em CÓPIA do código-fonte real: a trava precisa reprovar, senão é
  // decorativa.
  describe("a trava reprova mutantes", () => {
    const porClasse = PECAS.flatMap((peca) =>
      peca.novas.map((token) => [peca.nome, token, peca] as const),
    );

    it.each(porClasse)("%s: sem %s reprova", (_nome, token, peca) => {
      const mutante = mutar(
        peca,
        (literal) =>
          literal
            .split(" ")
            .filter((t) => t !== token)
            .join(" "),
        (literal) => literal.split(" ").includes(token),
      );
      expect(problemas(peca, mutante)).not.toEqual([]);
    });

    it.each(porClasse)(
      "%s: %s sem o prefixo lg: reprova (vazaria para o celular)",
      (_nome, token, peca) => {
        const mutante = mutar(
          peca,
          (literal) =>
            literal
              .split(" ")
              .map((t) => (t === token ? t.replace(/^lg:/, "") : t))
              .join(" "),
          (literal) => literal.split(" ").includes(token),
        );
        expect(problemas(peca, mutante)).not.toEqual([]);
      },
    );

    it.each(PECAS.map((peca) => [peca.nome, peca] as const))(
      "%s: classe do celular alterada reprova",
      (_nome, peca) => {
        const mutante = mutar(
          peca,
          (literal) => `${literal} z-50`,
          () => true,
        );
        expect(problemas(peca, mutante)).not.toEqual([]);
      },
    );
  });
});
