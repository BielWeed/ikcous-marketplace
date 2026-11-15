// P66 (conta no computador): as três classes novas -- `lg:flex-none` nas abas,
// `lg:max-w-lg` no `#form-perfil` e `lg:border-0` na barra Salvar -- têm de
// estar no ELEMENTO CERTO, e cada um dos três elementos tem de ter a lista
// COMPLETA de classes esperada. Os testes irmãos (`desktop-p66-abas-da-conta`,
// `...-formulario-do-perfil`, `...-barra-salvar-da-conta`) achavam o elemento
// pelo texto do próprio className (uma "âncora") e só olhavam o literal de
// celular; não pegavam a mesma classe aparecendo TAMBÉM em outro elemento, nem
// uma classe de computador a mais ou a menos em lugar nenhum.
//
// Aqui o elemento é achado pela ESTRUTURA do JSX (por AST, sobre o fonte REAL,
// porque a conta é pesada demais para montar só por causa de três tokens):
//   - aba      = o `<button role="tab">` que está DENTRO do `role="tablist"`;
//   - formulário = o `<form id="form-perfil">`;
//   - barra    = o `<div>` que contém o botão `type="submit" form="form-perfil"`.
// Para cada um: (1) o literal de celular é, byte a byte e na mesma ordem, o de
// antes da peça (congelado abaixo a partir de d8e77eed8, antes da P66);
// (2) os tokens de computador (`lg:`/`xl:`/`2xl:`) são exatamente os esperados;
// (3) a classe nova não aparece em nenhum outro elemento do arquivo.
// Os mutantes rodam em CÓPIA do fonte (texto em memória), para a trava não ser
// decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const FONTE = readFileSync(
  "src/views/customer/AccountSettingsView.tsx",
  "utf8",
);

// ── Como cada elemento era ANTES da P66 (celular, na ordem) ────────────────
const ABA_CELULAR =
  "flex h-11 flex-1 items-center justify-center rounded-[10px] text-[15px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900/50";
const ABA_ATIVA = "bg-foreground text-background";
const ABA_INATIVA = "text-foreground/70 hover:text-foreground";
const FORM_CELULAR = "space-y-4";
const BARRA_CELULAR =
  "bottom-docked-navigation sticky z-20 -mx-4 border-t border-border bg-background/95 px-4 pb-2.5 pt-3 backdrop-blur sm:-mx-6 sm:px-6 md:bottom-[104px]";

// ── O que a P66 acrescenta no computador (e o que já existia lá) ───────────
const ABA_COMPUTADOR = ["lg:flex-none"];
const FORM_COMPUTADOR = ["lg:max-w-lg"];
// `lg:bottom-0 lg:col-start-2 lg:mx-0 lg:rounded-3xl` já existiam antes da P66.
const BARRA_COMPUTADOR = [
  "lg:border-0",
  "lg:bottom-0",
  "lg:col-start-2",
  "lg:mx-0",
  "lg:rounded-3xl",
];

const PREFIXOS_DE_COMPUTADOR = new Set(["lg", "xl", "2xl"]);
const ehDeComputador = (token: string) =>
  PREFIXOS_DE_COMPUTADOR.has(token.split(":")[0]);

type Elemento = {
  no: ts.JsxElement | ts.JsxSelfClosingElement;
  abertura: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
};

function ler(fonte: string) {
  const arquivo = ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elementos: Elemento[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isJsxElement(no))
      elementos.push({ no, abertura: no.openingElement });
    else if (ts.isJsxSelfClosingElement(no))
      elementos.push({ no, abertura: no });
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);

  const tag = (e: Elemento) => e.abertura.tagName.getText(arquivo);
  const atributo = (e: Elemento, nome: string) =>
    e.abertura.attributes.properties.find(
      (a): a is ts.JsxAttribute =>
        ts.isJsxAttribute(a) && a.name.getText(arquivo) === nome,
    )?.initializer;
  const literal = (e: Elemento, nome: string) => {
    const valor = atributo(e, nome);
    return valor && ts.isStringLiteral(valor) ? valor.text : undefined;
  };
  /** Cada pedaço de texto do className (o `className={`..${x}..`}` tem vários). */
  const pedacos = (e: Elemento): string[] => {
    const inicio = atributo(e, "className");
    const achados: string[] = [];
    const coletar = (no: ts.Node) => {
      if (
        ts.isStringLiteral(no) ||
        ts.isNoSubstitutionTemplateLiteral(no) ||
        ts.isTemplateHead(no) ||
        ts.isTemplateMiddle(no) ||
        ts.isTemplateTail(no)
      )
        achados.push(no.text);
      else ts.forEachChild(no, coletar);
    };
    if (inicio) coletar(inicio);
    return achados;
  };
  const tokens = (texto: string) => texto.split(/\s+/).filter(Boolean);
  /** Todos os tokens de todos os pedaços do className do elemento. */
  const todosOsTokens = (e: Elemento) => pedacos(e).flatMap(tokens);
  /** Elementos do arquivo que carregam `token` em algum pedaço do className. */
  const quemTem = (token: string) =>
    elementos.filter((e) => todosOsTokens(e).includes(token));
  /** Ancestrais JSX do elemento, do mais perto para o mais longe. */
  const ancestrais = (e: Elemento): Elemento[] => {
    const lista: Elemento[] = [];
    for (let p: ts.Node | undefined = e.no.parent; p; p = p.parent) {
      if (ts.isJsxElement(p)) lista.push({ no: p, abertura: p.openingElement });
    }
    return lista;
  };

  return { elementos, tag, literal, pedacos, tokens, quemTem, ancestrais };
}

/** Dá `true` na comparação de lista de tokens só se for igual, na ordem. */
const igual = (a: string[], b: string[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Confere um elemento já achado: o celular (na ordem) é o congelado, os tokens
 * de computador são exatamente `computador` (qualquer ordem) e a classe nova
 * não está em nenhum outro elemento do arquivo.
 */
function confere(
  nome: string,
  leitor: ReturnType<typeof ler>,
  elemento: Elemento,
  pedacosCelular: string[],
  computador: string[],
  novas: string[],
): string[] {
  const erros: string[] = [];
  const pedacos = leitor.pedacos(elemento);
  const celular = pedacos.map((p) =>
    leitor
      .tokens(p)
      .filter((t) => !ehDeComputador(t))
      .join(" "),
  );
  if (!igual(celular.filter(Boolean), pedacosCelular))
    erros.push(`${nome}: celular mudou: ${JSON.stringify(celular)}`);
  const doComputador = pedacos
    .flatMap((p) => leitor.tokens(p))
    .filter(ehDeComputador)
    .sort();
  if (!igual(doComputador, [...computador].sort()))
    erros.push(
      `${nome}: classes de computador são ${JSON.stringify(doComputador)}`,
    );
  for (const nova of novas) {
    const donos = leitor.quemTem(nova);
    if (donos.length !== 1 || donos[0].no !== elemento.no)
      erros.push(
        `${nome}: ${nova} está em ${donos.length} elemento(s), não só no certo`,
      );
  }
  return erros;
}

function problemasDasAbas(fonte: string): string[] {
  const l = ler(fonte);
  const tablists = l.elementos.filter(
    (e) => l.literal(e, "role") === "tablist",
  );
  const abas = l.elementos.filter((e) => l.literal(e, "role") === "tab");
  if (tablists.length !== 1) return [`achou ${tablists.length} tablist`];
  if (abas.length !== 1) return [`achou ${abas.length} abas`];
  const [aba] = abas;
  const erros: string[] = [];
  if (l.tag(aba) !== "button")
    erros.push(`aba é <${l.tag(aba)}>, não <button>`);
  if (!l.ancestrais(aba).some((a) => a.no === tablists[0].no))
    erros.push("a aba não está dentro do tablist");
  erros.push(
    ...confere(
      "aba",
      l,
      aba,
      [ABA_CELULAR, ABA_ATIVA, ABA_INATIVA],
      ABA_COMPUTADOR,
      ABA_COMPUTADOR,
    ),
  );
  return erros;
}

function problemasDoFormulario(fonte: string): string[] {
  const l = ler(fonte);
  const forms = l.elementos.filter(
    (e) => l.tag(e) === "form" && l.literal(e, "id") === "form-perfil",
  );
  if (forms.length !== 1) return [`achou ${forms.length} form-perfil`];
  return confere(
    "formulário",
    l,
    forms[0],
    [FORM_CELULAR],
    FORM_COMPUTADOR,
    FORM_COMPUTADOR,
  );
}

function problemasDaBarra(fonte: string): string[] {
  const l = ler(fonte);
  const botoes = l.elementos.filter(
    (e) =>
      l.literal(e, "type") === "submit" &&
      l.literal(e, "form") === "form-perfil",
  );
  if (botoes.length !== 1) return [`achou ${botoes.length} botões salvar`];
  // A barra é o primeiro elemento JSX que envolve o botão.
  const barra = l.ancestrais(botoes[0])[0];
  if (!barra) return ["o botão salvar não está dentro de elemento nenhum"];
  const erros: string[] = [];
  if (l.tag(barra) !== "div")
    erros.push(`a barra é <${l.tag(barra)}>, não <div>`);
  erros.push(
    ...confere("barra", l, barra, [BARRA_CELULAR], BARRA_COMPUTADOR, [
      "lg:border-0",
    ]),
  );
  return erros;
}

describe("P66 — cada classe nova está no elemento certo, com a lista completa", () => {
  it("abas: só o button role=tab dentro do tablist ganha lg:flex-none", () => {
    expect(problemasDasAbas(FONTE)).toEqual([]);
  });

  it("formulário: só o form#form-perfil ganha lg:max-w-lg", () => {
    expect(problemasDoFormulario(FONTE)).toEqual([]);
  });

  it("barra: só o contêiner do botão Salvar do perfil ganha lg:border-0", () => {
    expect(problemasDaBarra(FONTE)).toEqual([]);
  });

  // ── mutantes em cópia: cada um tem de deixar a trava certa vermelha ──────
  it("mutante: lg:flex-none sai da aba e vai para o tablist", () => {
    const mutante = FONTE.replace(" lg:flex-none ${", " ${").replace(
      "lg:row-start-2 lg:flex-col lg:self-start",
      "lg:row-start-2 lg:flex-col lg:flex-none lg:self-start",
    );
    expect(mutante).not.toBe(FONTE);
    const erros = problemasDasAbas(mutante).join("\n");
    expect(erros).toMatch(/classes de computador são \[\]/);
    expect(erros).toMatch(/lg:flex-none está em 1 elemento/);
  });

  it("mutante: lg:flex-none fica na aba e aparece também no tablist", () => {
    const mutante = FONTE.replace(
      "lg:row-start-2 lg:flex-col lg:self-start",
      "lg:row-start-2 lg:flex-col lg:flex-none lg:self-start",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDasAbas(mutante).join("\n")).toMatch(
      /lg:flex-none está em 2 elemento/,
    );
  });

  it("mutante: classe de computador a mais na aba (lg:h-12)", () => {
    const mutante = FONTE.replace(
      " lg:flex-none ${",
      " lg:flex-none lg:h-12 ${",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDasAbas(mutante).join("\n")).toMatch(
      /aba: classes de computador são/,
    );
  });

  it("mutante: o role=tab passa para um <div> (aba deixa de ser button)", () => {
    const mutante = FONTE.replace(
      '<button\n                  key={aba}\n                  type="button"\n                  role="tab"',
      '<div\n                  key={aba}\n                  role="tab"',
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDasAbas(mutante).join("\n")).toMatch(/não <button>|achou/);
  });

  it("mutante: classe sem prefixo some do literal de celular da aba", () => {
    const mutante = FONTE.replace(
      "outline-none transition-colors focus-visible:ring-2",
      "outline-none focus-visible:ring-2",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDasAbas(mutante).join("\n")).toMatch(/aba: celular mudou/);
  });

  it("mutante: lg:max-w-lg sai do #form-perfil e vai para outro form", () => {
    const mutante = FONTE.replace("space-y-4 lg:max-w-lg", "space-y-4").replace(
      'action="#"\n                  className="space-y-4"',
      'action="#"\n                  className="space-y-4 lg:max-w-lg"',
    );
    expect(mutante).not.toBe(FONTE);
    const erros = problemasDoFormulario(mutante).join("\n");
    expect(erros).toMatch(/classes de computador são \[\]/);
    expect(erros).toMatch(/lg:max-w-lg está em 1 elemento/);
  });

  it("mutante: lg:max-w-lg fica no #form-perfil e aparece em outro elemento", () => {
    const mutante = FONTE.replace(
      'className="space-y-5 lg:col-start-2',
      'className="space-y-5 lg:max-w-lg lg:col-start-2',
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDoFormulario(mutante).join("\n")).toMatch(
      /lg:max-w-lg está em 2 elemento/,
    );
  });

  it("mutante: o form-perfil ganha um token de computador a mais", () => {
    const mutante = FONTE.replace(
      "space-y-4 lg:max-w-lg",
      "space-y-4 lg:max-w-lg xl:max-w-xl",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDoFormulario(mutante).join("\n")).toMatch(
      /formulário: classes de computador são/,
    );
  });

  it("mutante: lg:border-0 sai da barra e vai para o botão Salvar", () => {
    const mutante = FONTE.replace(' lg:border-0">', '">').replace(
      'form="form-perfil"\n                  disabled',
      'form="form-perfil"\n                  className="lg:border-0"\n                  disabled',
    );
    expect(mutante).not.toBe(FONTE);
    const erros = problemasDaBarra(mutante).join("\n");
    expect(erros).toMatch(/barra: classes de computador são/);
    expect(erros).toMatch(/lg:border-0 está em 1 elemento/);
  });

  it("mutante: lg:border-0 fica na barra e aparece também na seção do perfil", () => {
    const mutante = FONTE.replace(
      "lg:rounded-3xl lg:border lg:border-border lg:p-6",
      "lg:rounded-3xl lg:border lg:border-0 lg:border-border lg:p-6",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDaBarra(mutante).join("\n")).toMatch(
      /lg:border-0 está em 2 elemento/,
    );
  });

  it("mutante: classe sem prefixo entra na barra (lg: intocado)", () => {
    const mutante = FONTE.replace(
      "z-20 -mx-4 border-t",
      "z-20 -mx-4 border-t shadow",
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDaBarra(mutante).join("\n")).toMatch(
      /barra: celular mudou/,
    );
  });

  it("mutante: a barra deixa de envolver o botão (sobra um wrapper)", () => {
    const mutante = FONTE.replace(
      '<Button\n                  type="submit"\n                  form="form-perfil"',
      '<span><Button\n                  type="submit"\n                  form="form-perfil"',
    ).replace(
      'Salvar alterações"\n                  )}\n                </Button>',
      'Salvar alterações"\n                  )}\n                </Button></span>',
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDaBarra(mutante).join("\n")).toMatch(/a barra é <span>/);
  });
});
