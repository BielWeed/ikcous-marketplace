// @vitest-environment jsdom
//
// P45 (painel em computador): três blocos que ficavam esticados ou empilhados
// em monitor largo.
//
// 1) Editor de banner: coluna única com a largura toda do painel (928 px a
//    1280, 1184 px a 1536+). A prévia 2:1 chegava a 1184x592 e empurrava os
//    campos para baixo. Agora o editor é uma coluna centrada de 42rem
//    (`lg:max-w-2xl`).
// 2) Lista de banners: a busca e o filtro de situação atravessavam ~900-1160 px
//    para digitar uma palavra. Agora `lg:max-w-xl` e `lg:max-w-sm`.
// 3) Canais do CRM: "Cada canal" e "Formas de pagamento" ficavam empilhados em
//    ~928/1184 px. Agora, em `xl:`, ficam lado a lado; resumo e avisos seguem
//    em largura inteira.
//
// Descartado de propósito: `xl:grid-cols-3` na galeria de modelos. A galeria é
// filha do MESMO contêiner do editor, que agora tem 672 px; em 3 colunas o
// cartão cairia para ~212 px (prévia de ~196x98). Em 2 colunas são ~330 px,
// legível. O teste do fim trava essa decisão.
//
// Só se ACRESCENTAM classes `lg:`/`xl:`; o que vale abaixo de 1024 px fica byte
// a byte igual. Literais congelados aqui (o CI clona só o último commit: nada
// de ler histórico do git). O jsdom não calcula CSS: a medida em pixels vem de
// navegador real; aqui a prova é o className do componente REAL, os seletores
// de filho aplicados ao DOM renderizado e mutantes em cópia.
import { readFileSync } from "node:fs";
import { CanaisDoCrm } from "@/components/admin/crm/CanaisDoCrm";
import type { KpisDoCrm, VisaoDoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Leitura da fonte (AST): acha o elemento pelo atributo, não por posição.
// ---------------------------------------------------------------------------

type Abertura = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function lerFonte(caminho: string) {
  // Caminhos vêm só dos literais abaixo, nunca de entrada externa.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const texto = readFileSync(caminho, "utf8");
  return ts.createSourceFile(
    caminho,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function atributo(no: Abertura, nome: string) {
  return no.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === nome,
  );
}

function textoDoAtributo(no: Abertura, nome: string) {
  const item = atributo(no, nome);
  return item?.initializer && ts.isStringLiteral(item.initializer)
    ? item.initializer.text
    : undefined;
}

function acharAbertura(fonte: ts.SourceFile, serve: (no: Abertura) => boolean) {
  const achados: Abertura[] = [];
  function visitar(no: ts.Node) {
    if (
      (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no)) &&
      serve(no)
    ) {
      achados.push(no);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  expect(achados, "elemento procurado, exatamente um").toHaveLength(1);
  return achados[0];
}

/** `no` é descendente do elemento JSX cuja abertura é `conteiner`? */
function estaDentroDe(no: Abertura, conteiner: Abertura) {
  for (let pai: ts.Node | undefined = no.parent; pai; pai = pai.parent) {
    if (ts.isJsxElement(pai) && pai.openingElement === conteiner) return true;
  }
  return false;
}

const BANNERS = "src/views/admin/AdminBannersView.tsx";
const GALERIA = "src/components/admin/banners/GaleriaDeBanners.tsx";

// Como cada elemento era no celular (o que vale abaixo de 1024 px).
const CELULAR_EDITOR = "space-y-6";
const CELULAR_BUSCA =
  "mt-3 min-h-11 border-admin-border bg-admin-bg text-white";
const CELULAR_FILTRO =
  "mt-1 min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white";

const TOKENS_DO_EDITOR = ["lg:mx-auto", "lg:w-full", "lg:max-w-2xl"];

/** O que falta para o elemento ficar como a peça manda. */
function problemasDoElemento(
  className: string,
  celularEsperado: string,
  tokensDeComputador: readonly string[],
) {
  const problemas: string[] = [];
  if (classesDoCelular(className) !== celularEsperado) {
    problemas.push("a classe do celular mudou");
  }
  const tokens = className.split(/\s+/);
  for (const token of tokensDeComputador) {
    if (!tokens.includes(token)) problemas.push(`falta ${token}`);
  }
  return problemas;
}

describe("P45 — editor e lista de banners no computador", () => {
  const fonte = lerFonte(BANNERS);

  it("editor: celular intacto e coluna centrada de 42rem no computador", () => {
    const editor = acharAbertura(
      fonte,
      (no) => atributo(no, "onInputCapture") !== undefined,
    );
    const classe = textoDoAtributo(editor, "className") ?? "";
    expect(classesDoCelular(classe)).toBe(CELULAR_EDITOR);
    expect(
      problemasDoElemento(classe, CELULAR_EDITOR, TOKENS_DO_EDITOR),
    ).toEqual([]);
  });

  it("busca da lista: celular intacto e `lg:max-w-xl`", () => {
    const busca = acharAbertura(
      fonte,
      (no) => textoDoAtributo(no, "id") === "banner-search-input",
    );
    const classe = textoDoAtributo(busca, "className") ?? "";
    expect(classesDoCelular(classe)).toBe(CELULAR_BUSCA);
    expect(problemasDoElemento(classe, CELULAR_BUSCA, ["lg:max-w-xl"])).toEqual(
      [],
    );
  });

  it("filtro de situação: celular intacto e `lg:max-w-sm`", () => {
    const filtro = acharAbertura(
      fonte,
      (no) => textoDoAtributo(no, "id") === "banner-status-filter",
    );
    const classe = textoDoAtributo(filtro, "className") ?? "";
    expect(classesDoCelular(classe)).toBe(CELULAR_FILTRO);
    expect(
      problemasDoElemento(classe, CELULAR_FILTRO, ["lg:max-w-sm"]),
    ).toEqual([]);
  });

  describe("a trava reprova mutantes em cópia", () => {
    const boa = `${CELULAR_EDITOR} ${TOKENS_DO_EDITOR.join(" ")}`;

    it("cópia boa passa", () => {
      expect(
        problemasDoElemento(boa, CELULAR_EDITOR, TOKENS_DO_EDITOR),
      ).toEqual([]);
    });

    it("sem a largura máxima: reprova", () => {
      const mutante = boa.replace(" lg:max-w-2xl", "");
      expect(
        problemasDoElemento(mutante, CELULAR_EDITOR, TOKENS_DO_EDITOR),
      ).not.toEqual([]);
    });

    it("espaçamento do celular alterado: reprova", () => {
      const mutante = boa.replace("space-y-6", "space-y-4");
      expect(
        problemasDoElemento(mutante, CELULAR_EDITOR, TOKENS_DO_EDITOR),
      ).not.toEqual([]);
    });

    it("computador editado DENTRO do literal do celular: reprova", () => {
      const mutante = boa.replace("space-y-6", "lg:space-y-6");
      expect(
        problemasDoElemento(mutante, CELULAR_EDITOR, TOKENS_DO_EDITOR),
      ).not.toEqual([]);
    });
  });
});

describe("P45 — galeria de modelos continua em 2 colunas", () => {
  it("a galeria vive dentro do contêiner de 42rem: 3 colunas deixariam o cartão com ~212 px", () => {
    const galeria = lerFonte(GALERIA);
    const grade = acharAbertura(
      galeria,
      (no) =>
        (textoDoAtributo(no, "className") ?? "")
          .split(/\s+/)
          .includes("grid") &&
        (textoDoAtributo(no, "className") ?? "").includes("grid-cols-2"),
    );
    const classe = textoDoAtributo(grade, "className") ?? "";
    expect(classe).toBe("grid grid-cols-2 gap-3");
    expect(classe).not.toMatch(/(?:lg|xl|2xl):grid-cols-/);
    // A galeria é desenhada DENTRO do contêiner do editor (`lg:max-w-2xl`):
    // relação de ancestral na AST, não só "os dois existem no arquivo".
    const fonteDosBanners = lerFonte(BANNERS);
    const editor = acharAbertura(
      fonteDosBanners,
      (no) => atributo(no, "onInputCapture") !== undefined,
    );
    expect(textoDoAtributo(editor, "className")).toBe(
      "space-y-6 lg:mx-auto lg:w-full lg:max-w-2xl",
    );
    const usoDaGaleria = acharAbertura(
      fonteDosBanners,
      (no) => no.tagName.getText() === "GaleriaDeBanners",
    );
    expect(estaDentroDe(usoDaGaleria, editor)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Canais do CRM: seletores de filho aplicados ao DOM RENDERIZADO.
// ---------------------------------------------------------------------------

const CELULAR_DO_PAI = "space-y-4";

// Lição do P29: `[&>section]` casa TODA <section> filha direta, e o resumo
// (MetricasDoPainel) também é <section>; ele ficaria pela metade. Por isso os
// seletores de filho abaixo apontam para o `aria-label`/`aria-labelledby` dos
// dois blocos que ficam lado a lado.
const TOKENS_DA_GRADE = [
  "xl:grid",
  "xl:grid-cols-2",
  "xl:items-start",
  "xl:gap-6",
  "xl:space-y-0",
  "xl:[&>*]:min-w-0",
  "xl:[&>*]:col-span-2",
  "xl:[&>section[aria-label^=Cada]]:col-span-1",
  "xl:[&>section[aria-labelledby=crm-formas-titulo]]:col-span-1",
];

const KPIS: KpisDoCrm = {
  receita: 0,
  receitaAnterior: null,
  pedidos: 0,
  pedidosAnterior: null,
  ticketMedio: 0,
  ticketMedioAnterior: null,
  clientesCompradores: null,
  clientesNovos: null,
  taxaRecompra: null,
  receitaRecorrentePct: null,
  ltvMedio: null,
  receitaEmRisco: null,
  taxaDevolucao: null,
};

function visaoCom(vendas: boolean): VisaoDoCrm {
  return {
    kpis: { ...KPIS, receita: vendas ? 500 : 0, pedidos: vendas ? 5 : 0 },
    canais: vendas
      ? [
          { canal: "online", receita: 300, pedidos: 3, ticketMedio: 100 },
          { canal: "presencial", receita: 200, pedidos: 2, ticketMedio: 100 },
        ]
      : [],
    formas: vendas ? [{ forma: "pix", receita: 500, pedidos: 5 }] : [],
    funil: {
      visitas: null,
      produtosVistos: null,
      carrinhos: null,
      pedidosCriados: null,
      pedidosPagos: null,
    },
    pipeline: [],
    segmentos: [],
  };
}

/** Especificidade aproximada de um seletor: id > atributo > etiqueta. */
function especificidade(seletor: string) {
  const ids = (seletor.match(/#[\w-]+/g) ?? []).length;
  const atributos = (seletor.match(/\[[^\]]+\]/g) ?? []).length;
  const etiquetas = (
    seletor.replace(/\[[^\]]*\]/g, "").match(/\b[a-z]+\b/g) ?? []
  ).length;
  return ids * 100 + atributos * 10 + etiquetas;
}

/**
 * Quantas colunas cada filho direto do pai ocupa em 1280 px+, lendo as classes
 * `xl:[&>SELETOR]:col-span-N` do `className` dado contra o DOM de verdade.
 * Devolve `null` quando o pai não vira grade de 2 colunas (fica empilhado).
 */
function colunasDosFilhos(pai: Element, className: string) {
  const tokens = className.split(/\s+/).filter((t) => t.startsWith("xl:"));
  if (!tokens.includes("xl:grid") || !tokens.includes("xl:grid-cols-2")) {
    return null;
  }
  const colunas = new Map<Element, { peso: number; vao: number }>();
  for (const filho of Array.from(pai.children)) {
    colunas.set(filho, { peso: -1, vao: 1 });
  }
  for (const token of tokens) {
    const regra = /^xl:\[&>(.+)\]:col-span-(\d)$/.exec(token);
    if (!regra) continue;
    const seletor = regra[1];
    const peso = especificidade(seletor);
    for (const filho of Array.from(
      pai.querySelectorAll(`:scope > ${seletor}`),
    )) {
      const atual = colunas.get(filho);
      // Mais específico vence; empate, a regra declarada depois.
      if (atual && peso >= atual.peso) {
        colunas.set(filho, { peso, vao: Number(regra[2]) });
      }
    }
  }
  return Array.from(pai.children).map((f) => colunas.get(f)?.vao ?? 1);
}

/** Células vazias que sobram na grade de 2 colunas (colocação em ordem). */
function buracosNaGrade(vaos: readonly number[]) {
  let buracos = 0;
  let usado = 0;
  for (const vao of vaos) {
    if (usado + vao > 2) {
      buracos += 2 - usado;
      usado = 0;
    }
    usado += vao;
    if (usado === 2) usado = 0;
  }
  return buracos + (usado === 1 ? 1 : 0);
}

describe("P45 — Canais do CRM no computador (DOM real)", () => {
  let raiz: Root;
  let tela: HTMLDivElement;

  beforeEach(() => {
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    tela.remove();
  });

  async function montar(props: {
    visao: VisaoDoCrm | null;
    carregando?: boolean;
    erro?: string | null;
    offline?: boolean;
  }) {
    await act(async () => {
      raiz.render(
        <CanaisDoCrm
          visao={props.visao}
          carregando={props.carregando ?? false}
          erro={props.erro}
          offline={props.offline}
          onNavigate={() => {}}
        />,
      );
    });
    const pai = tela.firstElementChild as HTMLElement;
    expect(pai, "contêiner do aba").toBeTruthy();
    return pai;
  }

  const resumo = (pai: Element) =>
    pai.querySelector(':scope > section[aria-label^="Vendas que ficaram"]');
  const cadaCanal = (pai: Element) =>
    pai.querySelector(':scope > section[aria-label="Cada canal"]');
  const formas = (pai: Element) =>
    pai.querySelector(':scope > section[aria-labelledby="crm-formas-titulo"]');

  /** O que falta para a aba ficar certa no computador. */
  function problemasDaGrade(pai: HTMLElement, className: string) {
    const problemas: string[] = [];
    if (classesDoCelular(className) !== CELULAR_DO_PAI) {
      problemas.push("a classe do celular mudou");
    }
    const vaos = colunasDosFilhos(pai, className);
    if (!vaos) return [...problemas, "não vira grade de 2 colunas"];
    const filhos = Array.from(pai.children);
    const vao = (el: Element | null) => (el ? vaos[filhos.indexOf(el)] : 0);
    if (vao(resumo(pai)) !== 2) problemas.push("resumo não ocupa a linha toda");
    if (vao(cadaCanal(pai)) !== 1)
      problemas.push("'Cada canal' não é meia linha");
    if (vao(formas(pai)) !== 1) problemas.push("'Formas' não é meia linha");
    for (const filho of filhos) {
      if (filho.getAttribute("role") === "alert" && vao(filho) !== 2) {
        problemas.push("aviso não ocupa a linha toda");
      }
    }
    if (buracosNaGrade(vaos) > 0) problemas.push("sobra buraco na grade");
    return problemas;
  }

  it("o DOM tem o que o seletor precisa: resumo, 'Cada canal' e 'Formas' são <section> filhas diretas", async () => {
    const pai = await montar({ visao: visaoCom(true) });
    expect(resumo(pai)).toBeTruthy();
    expect(cadaCanal(pai)).toBeTruthy();
    expect(formas(pai)).toBeTruthy();
    // O resumo TAMBÉM é <section>: `[&>section]` solto o deixaria pela metade.
    expect(resumo(pai)?.tagName).toBe("SECTION");
  });

  it("com vendas: celular intacto, os dois blocos lado a lado, resumo em largura inteira, sem buraco", async () => {
    const pai = await montar({ visao: visaoCom(true) });
    const classe = pai.className;
    expect(problemasDaGrade(pai, classe)).toEqual([]);
    expect(colunasDosFilhos(pai, classe)).toEqual([2, 1, 1]);
    for (const token of TOKENS_DA_GRADE)
      expect(classe.split(/\s+/)).toContain(token);
  });

  it("com aviso de falha ao atualizar: o aviso ocupa a linha toda e a grade segue sem buraco", async () => {
    const pai = await montar({ visao: visaoCom(true), erro: "falhou" });
    expect(pai.querySelector(':scope > [role="alert"]')).toBeTruthy();
    expect(colunasDosFilhos(pai, pai.className)).toEqual([2, 2, 1, 1]);
    expect(problemasDaGrade(pai, pai.className)).toEqual([]);
  });

  it("carregando: o esqueleto também fica em duas colunas, sem buraco", async () => {
    const pai = await montar({ visao: null, carregando: true });
    expect(problemasDaGrade(pai, pai.className)).toEqual([]);
  });

  it("sem nenhuma venda (estado vazio no meio): fica empilhado, sem meia linha sozinha", async () => {
    const pai = await montar({ visao: visaoCom(false) });
    expect(pai.textContent).toContain("Nenhuma venda paga neste período");
    expect(pai.className).toBe(CELULAR_DO_PAI);
    expect(colunasDosFilhos(pai, pai.className)).toBeNull();
  });

  it("sem internet e sem dados: os números não carregaram, fica empilhado", async () => {
    const pai = await montar({ visao: null, offline: true });
    expect(pai.className).toBe(CELULAR_DO_PAI);
  });

  describe("a trava reprova mutantes em cópia", () => {
    const boa = `${CELULAR_DO_PAI} ${TOKENS_DA_GRADE.join(" ")}`;

    it("cópia boa passa", async () => {
      const pai = await montar({ visao: visaoCom(true) });
      expect(problemasDaGrade(pai, boa)).toEqual([]);
    });

    it("sem o `col-span-2` geral: o resumo vira meia linha e reprova", async () => {
      const pai = await montar({ visao: visaoCom(true) });
      const mutante = boa.replace(" xl:[&>*]:col-span-2", "");
      expect(problemasDaGrade(pai, mutante)).not.toEqual([]);
    });

    it("sem o seletor de 'Cada canal': ele ocupa a linha toda e reprova", async () => {
      const pai = await montar({ visao: visaoCom(true) });
      const mutante = boa.replace(
        " xl:[&>section[aria-label^=Cada]]:col-span-1",
        "",
      );
      expect(problemasDaGrade(pai, mutante)).not.toEqual([]);
    });

    it("`[&>section]` solto (a primeira proposta): o resumo fica pela metade e reprova", async () => {
      const pai = await montar({ visao: visaoCom(true) });
      const mutante = boa
        .replace(" xl:[&>section[aria-label^=Cada]]:col-span-1", "")
        .replace(
          " xl:[&>section[aria-labelledby=crm-formas-titulo]]:col-span-1",
          " xl:[&>section]:col-span-1",
        );
      expect(problemasDaGrade(pai, mutante)).toContain(
        "resumo não ocupa a linha toda",
      );
    });

    it("sem o `xl:grid-cols-2`: não vira grade e reprova", async () => {
      const pai = await montar({ visao: visaoCom(true) });
      const mutante = boa.replace(" xl:grid-cols-2", "");
      expect(problemasDaGrade(pai, mutante)).not.toEqual([]);
    });

    it("espaçamento do celular alterado: reprova", async () => {
      const pai = await montar({ visao: visaoCom(true) });
      const mutante = boa.replace("space-y-4", "space-y-3");
      expect(problemasDaGrade(pai, mutante)).not.toEqual([]);
    });

    it("grade ligada com estado vazio no meio deixaria buraco: o contador de buracos acusa", () => {
      // [resumo, 'Cada canal', aviso de vazio, 'Formas'] = 2,1,2,1
      expect(buracosNaGrade([2, 1, 2, 1])).toBeGreaterThan(0);
      expect(buracosNaGrade([2, 1, 1])).toBe(0);
      expect(buracosNaGrade([2, 2, 1, 1])).toBe(0);
    });
  });
});
