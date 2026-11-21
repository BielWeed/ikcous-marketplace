// P77 (loja no computador, tela de pagamento por Pix): a 1280x720, 1366x768 e
// 1366x650 o QR code ficava CORTADO na primeira tela (de 66 a 184 px). A coluna
// do Pix tinha 420 px de largura no meio de 1366, o QR vinha empilhado por
// último (594 a 834 px a partir do topo, com o cabeçalho fixo de 121 px) e só
// cabia inteiro a partir de 1440x900.
//
// Decisão do sócio: NÃO alargar as telas de pagamento em geral. Só a tela do
// Pix, e só a partir de `lg:` (1024 px), vira duas colunas: valor, prazo,
// botão de copiar e código de um lado; o QR do outro.
//
// O que esta trava garante, por AST sobre o fonte REAL (o jsdom não calcula
// CSS; o que se prova aqui é ONDE cada classe está e que a P77 não
// muda o layout antigo no celular):
//   - o literal de celular da seção do Pix, da figura do QR e da coluna do
//     checkout é, byte a byte, o de antes da peça (congelado à mão), e só
//     entram tokens `lg:` -- nenhum acompanhado de elemento, texto ou atributo
//     novo, nem de ordem nova no DOM da interface original;
//   - "Já paguei — verificar" entrou depois e tem teste de comportamento
//     próprio; só esse componente fica fora das assinaturas congeladas;
//   - o alargamento da coluna do checkout e a grade da seção só valem quando a
//     tela TEM o QR (`has-[figure]`): o Pix sem imagem, o cartão e as telas de
//     erro continuam na coluna estreita de sempre;
//   - o Tailwind REAL compila cada token numa regra que só vale de 1024 px
//     para cima (nada novo abaixo disso);
//   - mutantes (em cópia do fonte, em memória) derrubam cada uma das guardas.
//
// A medição em navegador real (posição do QR e do botão por tamanho de tela)
// está no relatório da peça: o jsdom não sabe quanto cabe numa tela.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { classesDoCelular } from "./classes-do-celular";

const PIX = readFileSync("src/components/checkout/PagamentoOnline.tsx", "utf8");
const CHECKOUT = readFileSync("src/views/customer/CheckoutView.tsx", "utf8");

// --- Como era ANTES da P77 (base fb10cb246), escrito à mão ------------------
const SECAO_CELULAR =
  "mx-auto w-full max-w-md space-y-4 rounded-2xl border border-zinc-100 bg-white p-4 sm:p-6";
const FIGURA_CELULAR = "space-y-2";
const COLUNA_CELULAR =
  "pb-customer mx-auto min-h-dvh w-full max-w-md space-y-4 bg-gray-50/10 px-3.5 pt-4";
// Assinatura de TODOS os literais de className do PagamentoOnline.tsx tirando
// os tokens lg/xl/2xl (mesmo método do P32): 54 literais não vazios.
// 17/11: entrou o sr-only do anúncio de Pix pronto.
// r346: só mudaram as ações e o aviso de Pix encerrado. Os 43 literais fora
// desse aviso, incluindo os do QR, continuam idênticos.
const ASSINATURA_CELULAR_DO_PIX =
  "12f9b7005b6fc0110146872050cd909688a5565b0a7f6fb7cfbe46818f36a4e4";
// Os elementos da seção do Pix, na ordem do DOM (o QR vem DEPOIS do botão de
// copiar e continua vindo; a ordem visual muda só por grade, no computador).
const TAGS_DA_SECAO_DO_PIX = [
  "section",
  "header",
  "h2",
  "p",
  "p",
  "p",
  "Clock",
  "span",
  "strong",
  "span",
  "div",
  "div",
  "AlertCircle",
  "div",
  "p",
  "p",
  "div",
  "button",
  "Check",
  "Copy",
  "span",
  "div",
  "p",
  "p",
  "span",
  "div",
  "p",
  "textarea",
  "figure",
  "figcaption",
  "img",
  "p",
  "ol",
  "li",
  "li",
  "li",
  "a",
];
// Textos (JSX e literais fora de className) e atributos (menos className) da
// seção: nenhum texto, props ou ação mudou.
const HASH_DOS_TEXTOS_DA_SECAO =
  "e43ceac077bae4a80dd1f884d360f56fe3aa98df493ba9fee006e1674e6fe8fc";
const HASH_DOS_ATRIBUTOS_DA_SECAO =
  "f5826cf625c7bd775d36da896a8237134a05a122ae3bcdd63dca6e2645a7848e";

// --- O que a P77 acrescenta (só computador) ---------------------------------
const SECAO_COMPUTADOR = [
  "lg:max-w-3xl",
  "lg:has-[figure]:grid",
  "lg:has-[figure]:grid-cols-[minmax(0,1fr)_15rem]",
  "lg:has-[figure]:items-start",
  "lg:has-[figure]:gap-x-8",
];
const FIGURA_COMPUTADOR = [
  "lg:col-start-2",
  "lg:row-start-1",
  "lg:row-span-6",
  "lg:!mt-0",
];
const COLUNA_COMPUTADOR = ["lg:min-h-0", "lg:has-[figure]:max-w-3xl"];

const PREFIXOS = new Set(["lg", "xl", "2xl"]);
const tokensDeComputador = (literal: string) =>
  literal
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => PREFIXOS.has(t.split(":")[0]));
const mesmoConjunto = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

type Achado = {
  classe: string;
  texto: string;
  tags: string[];
  textos: string[];
  atributos: string[];
};

/** Todo elemento JSX com a tag dada: classe (todos os literais do className), texto e subárvore. */
function elementos(fonte: string, tag: string): Achado[] {
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: Achado[] = [];
  const nomeDaTag = (no: ts.Node) =>
    ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no)
      ? no.tagName.getText(arvore)
      : null;
  const classeDe = (abertura: ts.JsxOpeningLikeElement) => {
    const atributo = abertura.attributes.properties.find(
      (a): a is ts.JsxAttribute =>
        ts.isJsxAttribute(a) && a.name.getText(arvore) === "className",
    );
    const partes: string[] = [];
    const coletar = (no: ts.Node) => {
      if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no))
        partes.push(no.text);
      ts.forEachChild(no, coletar);
    };
    if (atributo?.initializer) coletar(atributo.initializer);
    return partes.join(" ");
  };
  const subarvore = (raiz: ts.Node) => {
    const tags: string[] = [];
    const textos: string[] = [];
    const atributos: string[] = [];
    const percorrer = (no: ts.Node) => {
      const nome = nomeDaTag(no);
      if (nome === "VerificarPix") return;
      if (nome) tags.push(nome);
      if (ts.isJsxText(no)) {
        const t = no.text.replace(/\s+/g, " ").trim();
        if (t) textos.push(t);
      }
      if (
        (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) &&
        !(
          no.parent &&
          ts.isJsxAttribute(no.parent) &&
          no.parent.name.getText(arvore) === "className"
        )
      ) {
        textos.push(`lit:${no.text}`);
      }
      if (ts.isJsxAttribute(no) && no.name.getText(arvore) !== "className") {
        atributos.push(no.getText(arvore).replace(/\s+/g, " "));
      }
      ts.forEachChild(no, percorrer);
    };
    percorrer(raiz);
    return { tags, textos, atributos };
  };
  const visitar = (no: ts.Node) => {
    if (ts.isJsxElement(no) && nomeDaTag(no.openingElement) === tag) {
      achados.push({
        classe: classeDe(no.openingElement),
        texto: no.getText(arvore),
        ...subarvore(no),
      });
    } else if (ts.isJsxSelfClosingElement(no) && nomeDaTag(no) === tag) {
      achados.push({
        classe: classeDe(no),
        texto: no.getText(arvore),
        ...subarvore(no),
      });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arvore);
  return achados;
}

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Assinatura dos literais de className da interface original (método do P32). */
function assinaturaDeCelular(fonte: string): string {
  const arvore = ts.createSourceFile(
    "arquivo.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const valores: string[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isFunctionDeclaration(no) && no.name?.text === "VerificarPix") {
      return;
    }
    if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
      const coletar = (filho: ts.Node) => {
        if (ts.isStringLiteral(filho)) {
          const celular = classesDoCelular(filho.text);
          if (celular) valores.push(celular);
        } else ts.forEachChild(filho, coletar);
      };
      if (no.initializer) coletar(no.initializer);
    } else ts.forEachChild(no, visitar);
  };
  visitar(arvore);
  return hash(valores);
}

/** Tudo que a P77 promete, lido de um par de fontes; devolve a lista de violações. */
function violacoes(pix: string, checkout: string): string[] {
  const v: string[] = [];

  // 1) A seção do Pix.
  // (`AvisoDePixEncerrado` tem outra seção com o MESMO literal e o mesmo
  // título: a do Pix vivo é a que tem o QR (`figure`), e a outra não muda.)
  const todasAsSecoes = elementos(pix, "section").filter((s) =>
    s.texto.includes("Pagamento via Pix"),
  );
  const secoes = todasAsSecoes.filter((s) => s.tags.includes("figure"));
  if (secoes.length !== 1) return [`seções do Pix: ${secoes.length}`];
  const secao = secoes[0];
  for (const outra of todasAsSecoes.filter((s) => s !== secao)) {
    if (outra.classe !== SECAO_CELULAR)
      v.push("a seção do aviso de Pix encerrado ganhou classe");
  }
  if (classesDoCelular(secao.classe) !== SECAO_CELULAR)
    v.push("celular da seção mudou");
  if (!secao.classe.startsWith(SECAO_CELULAR))
    v.push("token novo na frente do celular da seção");
  if (!mesmoConjunto(tokensDeComputador(secao.classe), SECAO_COMPUTADOR))
    v.push("tokens de computador da seção diferem do plano");
  if (JSON.stringify(secao.tags) !== JSON.stringify(TAGS_DA_SECAO_DO_PIX))
    v.push("elementos/ordem do DOM da seção mudaram");
  if (hash(secao.textos) !== HASH_DOS_TEXTOS_DA_SECAO)
    v.push("texto da seção mudou");
  if (hash(secao.atributos) !== HASH_DOS_ATRIBUTOS_DA_SECAO)
    v.push("atributo/ação da seção mudou");

  // 2) A figura do QR (única do arquivo).
  const figuras = elementos(pix, "figure");
  if (figuras.length !== 1) return [...v, `figuras: ${figuras.length}`];
  if (classesDoCelular(figuras[0].classe) !== FIGURA_CELULAR)
    v.push("celular da figura mudou");
  if (!figuras[0].classe.startsWith(FIGURA_CELULAR))
    v.push("token novo na frente do celular da figura");
  if (!mesmoConjunto(tokensDeComputador(figuras[0].classe), FIGURA_COMPUTADOR))
    v.push("tokens de computador da figura diferem do plano");

  // 3) O PagamentoOnline inteiro: nenhuma classe de celular mudou em lugar nenhum.
  if (assinaturaDeCelular(pix) !== ASSINATURA_CELULAR_DO_PIX)
    v.push("assinatura de celular do PagamentoOnline mudou");

  // 4) A coluna do checkout: só a que carrega o PagamentoOnline é alargada.
  const colunas = elementos(checkout, "div").filter((d) =>
    d.classe.startsWith(COLUNA_CELULAR),
  );
  const comPix = colunas.filter((c) => c.tags.includes("PagamentoOnline"));
  const semPix = colunas.filter((c) => !c.tags.includes("PagamentoOnline"));
  if (comPix.length !== 1)
    v.push(`colunas do checkout com o Pix: ${comPix.length}`);
  else {
    if (classesDoCelular(comPix[0].classe) !== COLUNA_CELULAR)
      v.push("celular da coluna do Pix mudou");
    if (!mesmoConjunto(tokensDeComputador(comPix[0].classe), COLUNA_COMPUTADOR))
      v.push("tokens de computador da coluna diferem do plano");
  }
  if (semPix.length !== 4)
    v.push(`colunas irmãs sem o Pix: ${semPix.length} (esperava 4)`);
  for (const outra of semPix) {
    if (outra.classe !== `${COLUNA_CELULAR} lg:min-h-0`)
      v.push("uma coluna irmã (cartão, erro, carregando) ganhou classe");
  }

  // 5) `lg:` nunca é o primeiro token de um literal tocado.
  for (const classe of [
    secao.classe,
    figuras[0].classe,
    ...comPix.map((c) => c.classe),
  ]) {
    if (PREFIXOS.has(classe.split(/\s+/)[0].split(":")[0]))
      v.push("um literal começa por token de computador");
  }
  return v;
}

describe("P77 -- Pix em duas colunas no computador: só classes lg:, celular intacto", () => {
  it("o fonte real cumpre tudo (celular byte a byte, DOM e textos iguais, só tokens lg: no lugar certo)", () => {
    expect(violacoes(PIX, CHECKOUT)).toEqual([]);
  });

  it("a coluna do checkout só alarga quando a tela TEM o QR, e a grade da seção também", () => {
    const secao = elementos(PIX, "section").find((s) =>
      s.tags.includes("figure"),
    );
    const classe = secao?.classe ?? "";
    // Sem `has-[figure]` o Pix sem imagem (e os navegadores sem :has) cairiam
    // numa grade de 2 colunas dentro de 420 px.
    for (const t of tokensDeComputador(classe).filter((x) =>
      /^lg:(grid|items-|gap-x|grid-cols)/.test(x),
    )) {
      expect(t, t).toContain("has-[figure]");
    }
    const coluna = elementos(CHECKOUT, "div").find(
      (d) =>
        d.classe.startsWith(COLUNA_CELULAR) &&
        d.tags.includes("PagamentoOnline"),
    );
    expect(tokensDeComputador(coluna?.classe ?? "")).toEqual([
      "lg:min-h-0",
      "lg:has-[figure]:max-w-3xl",
    ]);
  });

  describe("mutantes em cópia do fonte (cada guarda tem de cair)", () => {
    const troca = (fonte: string, de: string, para: string) => {
      expect(fonte.includes(de), `trecho do mutante: ${de}`).toBe(true);
      return fonte.replace(de, para);
    };
    // O literal da seção aparece duas vezes (a do aviso de Pix encerrado vem
    // primeiro); o mutante tem de cair na do Pix vivo, a última.
    const trocaUltima = (fonte: string, de: string, para: string) => {
      const i = fonte.lastIndexOf(de);
      expect(i, `trecho do mutante: ${de}`).toBeGreaterThan(-1);
      return fonte.slice(0, i) + para + fonte.slice(i + de.length);
    };

    it("M1: classe de celular da seção mexida", () => {
      const m = trocaUltima(
        PIX,
        '"mx-auto w-full max-w-md space-y-4',
        '"mx-auto w-full max-w-lg space-y-4',
      );
      expect(violacoes(m, CHECKOUT)).toContain("celular da seção mudou");
    });

    it("M2: alargar a coluna do checkout SEM a condição do QR", () => {
      const m = troca(CHECKOUT, "lg:has-[figure]:max-w-3xl", "lg:max-w-3xl");
      expect(violacoes(PIX, m)).toContain(
        "tokens de computador da coluna diferem do plano",
      );
    });

    it("M3: alargar também as colunas irmãs (cartão, erro, carregando)", () => {
      const m = CHECKOUT.replaceAll(
        'px-3.5 pt-4 lg:min-h-0">',
        'px-3.5 pt-4 lg:min-h-0 lg:has-[figure]:max-w-3xl">',
      );
      expect(violacoes(PIX, m).join(" | ")).toContain("irmã");
    });

    it("M4: o QR some do DOM ou troca de lugar (ordem nova de elementos)", () => {
      const m = troca(PIX, "<figure", "<div><figure").replace(
        "</figure>",
        "</figure></div>",
      );
      expect(violacoes(m, CHECKOUT)).toContain(
        "elementos/ordem do DOM da seção mudaram",
      );
    });

    it("M5: texto da tela mexido", () => {
      const m = troca(PIX, "Copiar código Pix", "Copiar o código Pix");
      expect(violacoes(m, CHECKOUT)).toContain("texto da seção mudou");
    });

    it("M6: a figura perde o prefixo e o token vaza para o celular", () => {
      const m = troca(PIX, "lg:col-start-2", "col-start-2");
      expect(violacoes(m, CHECKOUT)).toContain("celular da figura mudou");
    });

    it("M7: um `lg:` vira o primeiro token do literal da seção", () => {
      const m = trocaUltima(
        PIX,
        '"mx-auto w-full max-w-md space-y-4 rounded-2xl border border-zinc-100 bg-white p-4 sm:p-6',
        '"lg:max-w-3xl mx-auto w-full max-w-md space-y-4 rounded-2xl border border-zinc-100 bg-white p-4 sm:p-6',
      );
      expect(violacoes(m, CHECKOUT)).toContain(
        "token novo na frente do celular da seção",
      );
    });

    it("M8: a props de um botão muda (a lógica de copiar não pode ser tocada)", () => {
      const m = troca(
        PIX,
        'onClick={() => handleCopiarPix(pix.qrCode ?? "")}',
        'onClick={() => handleCopiarPix("")}',
      );
      expect(violacoes(m, CHECKOUT)).toContain("atributo/ação da seção mudou");
    });
  });
});

// ---------------------------------------------------------------------------
// O Tailwind REAL: cada token vira uma regra que só vale de 1024 px para cima.
// ---------------------------------------------------------------------------
type Regra = {
  minLargura: number;
  seletor: string;
  decl: [string, string, boolean][];
};

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
    const decl: [string, string, boolean][] = [];
    regra.walkDecls((d) => {
      decl.push([d.prop, d.value.replace(/\s+/g, ""), d.important === true]);
    });
    regras.push({ minLargura, seletor: regra.selector, decl });
  });
  return regras;
}

const semEscape = (s: string) =>
  s
    .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\/g, "");

/** A regra é DESTE token (e não de outro que só começa igual: `...:grid` x `...:grid-cols-`). */
const ehDoToken = (seletor: string, token: string) => {
  const limpo = semEscape(seletor);
  return (
    limpo === `.${token}` ||
    [":", " ", ">", ","].some((c) => limpo.startsWith(`.${token}${c}`))
  );
};

describe("P77 -- o Tailwind real compila cada token só para 1024 px ou mais", () => {
  const TODOS = [
    ...SECAO_COMPUTADOR,
    ...FIGURA_COMPUTADOR,
    ...COLUNA_COMPUTADOR,
  ];

  it("toda regra gerada pelos tokens novos vale de 1024 px para cima (nada novo abaixo disso)", async () => {
    const regras = await compilar(TODOS);
    for (const t of TODOS) {
      const dele = regras.filter((r) => ehDoToken(r.seletor, t));
      expect(dele.length, `o Tailwind gerou regra para ${t}`).toBeGreaterThan(
        0,
      );
      for (const r of dele) {
        expect(r.minLargura, `${t} vale a partir de ${r.minLargura}px`).toBe(
          1024,
        );
      }
    }
  }, 60_000);

  it("as regras fazem o que o desenho diz (duas colunas 1fr + 15rem, QR à direita no topo, sem margem de cima)", async () => {
    const regras = await compilar(TODOS);
    const de = (t: string) => {
      const achadas = regras.filter((r) => ehDoToken(r.seletor, t));
      expect(achadas, t).toHaveLength(1);
      return achadas[0];
    };
    const grade = de("lg:has-[figure]:grid");
    expect(semEscape(grade.seletor)).toContain(":has(figure)");
    expect(grade.decl).toEqual([["display", "grid", false]]);
    expect(de("lg:has-[figure]:grid-cols-[minmax(0,1fr)_15rem]").decl).toEqual([
      ["grid-template-columns", "minmax(0,1fr)15rem", false],
    ]);
    expect(de("lg:has-[figure]:items-start").decl).toEqual([
      ["align-items", "flex-start", false],
    ]);
    expect(de("lg:has-[figure]:gap-x-8").decl).toEqual([
      ["column-gap", "2rem", false],
    ]);
    expect(de("lg:max-w-3xl").decl).toEqual([["max-width", "48rem", false]]);
    expect(de("lg:has-[figure]:max-w-3xl").decl).toEqual([
      ["max-width", "48rem", false],
    ]);
    expect(de("lg:col-start-2").decl).toEqual([
      ["grid-column-start", "2", false],
    ]);
    expect(de("lg:row-start-1").decl).toEqual([["grid-row-start", "1", false]]);
    expect(de("lg:row-span-6").decl).toEqual([
      ["grid-row", "span6/span6", false],
    ]);
    // O `space-y-4` do celular põe margem de cima em todo filho menos o primeiro;
    // a figura NUNCA é o primeiro filho e precisa subir ao topo da 2ª coluna: `!important`
    // porque a regra do `space-y` pesa mais (3 seletores) que um utilitário.
    expect(de("lg:!mt-0").decl).toEqual([["margin-top", "0px", true]]);
  }, 60_000);
});
