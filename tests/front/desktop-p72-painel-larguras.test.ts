// P72 (painel da lojista no computador): sete defeitos de LARGURA medidos em
// navegador real -- botão ou campo que esticava a tela inteira, coluna que
// deixava centenas de pixels vazios nas laterais, conteúdo encostado no menu.
// A correção é só de computador: classes `lg:`/`xl:`/`2xl:` ACRESCENTADAS. O
// celular fica byte a byte igual, e nenhum elemento nem texto novo entra.
//
// O elemento é achado pela ESTRUTURA do JSX (por AST, sobre o fonte REAL, pesado
// demais para montar só por causa de tokens de largura):
//   1a. Salvar Cupom   = o `<Button>` dentro do `<AcaoDaBarra>` do formulário;
//   1b. Quem pode usar = o `<GrupoDeOpcoes>` dentro do `<fieldset>` da tela;
//   2.  Devolução      = o `<fieldset data-testid="politica-devolucao">`;
//   3.  Avançar        = o `<Button onAdvance>` com o texto "Avançar →", filho de um
//                        contêiner `flex` (senão `ml-auto` não empurra);
//   4.  Ficha cliente  = o `<div>` RAIZ (sem ancestral JSX) com `pb-admin`;
//   5.  Frete grátis   = idem, em AdminFreeShippingCardView;
//   6.  Cor do app     = idem, em AdminAppColorView;
//   7.  Devoluções     = o `<div inert>` que envolve o campo de busca;
//   8.  Salvar do frete grátis = o `<Button>` com `void salvar()`, filho direto da
//                        raiz (bloco, não flex: `2xl:flex` faz o `ml-auto` valer);
//   9.  Salvar cor     = o `<Button>` com `savePrimaryColor()`, item da grade da
//                        raiz (`xl:col-span-2`), que em 2xl:+ perde a faixa inteira.
// Para cada um: (a) o className de CELULAR (tudo que não começa por
// lg/xl/2xl, na ordem) é, byte a byte, o de antes da P72 (congelado abaixo a
// partir de f9611bb9c, escrito à mão); (b) os tokens de computador são
// exatamente os esperados; (c) cada token novo está SÓ nesse elemento.
// Os mutantes rodam em CÓPIA do fonte (texto em memória), para a trava não ser
// decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const FONTES = new Map([
  ["cupom", readFileSync("src/views/admin/AdminCouponFormView.tsx", "utf8")],
  [
    "quem",
    readFileSync("src/components/admin/coupons/QuemPodeUsarOCupom.tsx", "utf8"),
  ],
  [
    "devolucao",
    readFileSync(
      "src/components/admin/settings/PoliticaDeDevolucaoSection.tsx",
      "utf8",
    ),
  ],
  [
    "pedido",
    readFileSync("src/components/admin/orders/OrderDetail.tsx", "utf8"),
  ],
  ["cliente", readFileSync("src/views/admin/AdminUserDetailView.tsx", "utf8")],
  [
    "frete",
    readFileSync("src/views/admin/AdminFreeShippingCardView.tsx", "utf8"),
  ],
  ["cor", readFileSync("src/views/admin/AdminAppColorView.tsx", "utf8")],
  ["lista", readFileSync("src/views/admin/AdminDevolucoesView.tsx", "utf8")],
] as const);
type Chave =
  | "cupom"
  | "quem"
  | "devolucao"
  | "pedido"
  | "cliente"
  | "frete"
  | "cor"
  | "lista";

/** O fonte REAL do arquivo da peça. */
const fonteDe = (chave: Chave) => FONTES.get(chave) ?? "";

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
    );
  const literal = (e: Elemento, nome: string) => {
    const valor = atributo(e, nome)?.initializer;
    return valor && ts.isStringLiteral(valor) ? valor.text : undefined;
  };
  const tokens = (texto: string) => texto.split(/\s+/).filter(Boolean);
  /**
   * O className como lista de pedaços na ordem: texto puro (já em tokens) ou
   * a expressão `${...}` que o template carrega, como texto do fonte.
   */
  const pedacos = (e: Elemento): string[] => {
    const inicio = atributo(e, "className")?.initializer;
    const saida: string[] = [];
    const entrar = (no: ts.Node) => {
      if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no))
        saida.push(...tokens(no.text));
      else if (ts.isTemplateExpression(no)) {
        saida.push(...tokens(no.head.text));
        for (const parte of no.templateSpans) {
          saida.push(`\${${parte.expression.getText(arquivo)}}`);
          saida.push(...tokens(parte.literal.text));
        }
      } else ts.forEachChild(no, entrar);
    };
    if (inicio) entrar(inicio);
    return saida;
  };
  const quemTem = (token: string) =>
    elementos.filter((e) => pedacos(e).includes(token));
  const ancestrais = (e: Elemento): Elemento[] => {
    const lista: Elemento[] = [];
    for (let p: ts.Node | undefined = e.no.parent; p; p = p.parent) {
      if (ts.isJsxElement(p)) lista.push({ no: p, abertura: p.openingElement });
    }
    return lista;
  };
  const texto = (e: Elemento) => e.no.getText(arquivo);
  return {
    elementos,
    tag,
    literal,
    atributo,
    pedacos,
    quemTem,
    ancestrais,
    texto,
  };
}

type Leitor = ReturnType<typeof ler>;

const celularDe = (l: Leitor, e: Elemento) =>
  l
    .pedacos(e)
    .filter((t) => !ehDeComputador(t))
    .join(" ");
const computadorDe = (l: Leitor, e: Elemento) =>
  l.pedacos(e).filter(ehDeComputador).sort();

/** Confere celular (byte a byte), computador (exato) e o dono único de cada token novo. */
function confere(
  nome: string,
  l: Leitor,
  e: Elemento,
  celular: string,
  computador: string[],
  novas: string[],
): string[] {
  const erros: string[] = [];
  if (celularDe(l, e) !== celular)
    erros.push(`${nome}: celular mudou: ${celularDe(l, e)}`);
  if (
    JSON.stringify(computadorDe(l, e)) !==
    JSON.stringify([...computador].sort())
  )
    erros.push(
      `${nome}: classes de computador são ${JSON.stringify(computadorDe(l, e))}`,
    );
  for (const nova of novas) {
    const donos = l.quemTem(nova);
    if (donos.length !== 1 || donos[0].no !== e.no)
      erros.push(
        `${nome}: ${nova} está em ${donos.length} elemento(s), não só no certo`,
      );
  }
  return erros;
}

// ── Como cada elemento era ANTES da P72 (celular) e o que ela acrescenta ───
const SALVAR_CUPOM = {
  celular: "${PRIMARIO} admin-barra-principal h-auto w-full",
  novas: ["lg:ml-auto", "lg:w-72"],
};
const QUEM_PODE_USAR = {
  celular: "space-y-3",
  novas: ["xl:grid", "xl:grid-cols-3", "xl:gap-3", "xl:space-y-0"],
};
const DEVOLUCAO = {
  celular: "min-w-0 space-y-7",
  novas: ["lg:max-w-3xl"],
};
const AVANCAR = {
  celular:
    "flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-normal rounded-xl bg-foreground px-2.5 text-sm font-semibold leading-tight text-background transition-colors hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40",
  novas: ["lg:ml-auto", "lg:min-w-72", "lg:flex-none", "lg:px-8"],
};
const CLIENTE = {
  celular:
    "pb-admin mx-auto max-w-7xl space-y-6 px-4 duration-200 animate-in fade-in md:px-0",
  novas: ["lg:px-6"],
  // `lg:pb-12` já existia antes da P72.
  computador: ["lg:pb-12", "lg:px-6"],
};
const FRETE = {
  celular: "pb-admin mx-auto max-w-lg space-y-4 px-4 pt-4 text-zinc-50",
  novas: ["2xl:max-w-6xl"],
  // `xl:max-w-4xl` já existia antes da P72.
  computador: ["xl:max-w-4xl", "2xl:max-w-6xl"],
};
const COR = {
  celular: "pb-admin mx-auto max-w-lg space-y-3 px-4 pt-4 text-zinc-50",
  novas: ["2xl:max-w-7xl"],
  // O resto já existia antes da P72.
  computador: [
    "xl:grid",
    "xl:max-w-5xl",
    "xl:grid-cols-2",
    "xl:items-start",
    "xl:gap-5",
    "xl:space-y-0",
    "2xl:max-w-7xl",
  ],
};
const BUSCA = {
  celular: "group relative",
  novas: ["lg:max-w-xl"],
};
// Os dois Salvar da P72b: em 1536 px+ a faixa de 1120/1248 px vira 288 px à direita.
const SALVAR_FRETE = {
  celular:
    "h-[52px] w-full rounded-full bg-zinc-50 font-bold text-zinc-950 hover:bg-zinc-200",
  novas: ["2xl:flex", "2xl:ml-auto", "2xl:w-72"],
};
const SALVAR_COR = {
  celular:
    "h-12 w-full rounded-2xl bg-foreground font-bold text-background hover:opacity-90",
  novas: ["2xl:ml-auto", "2xl:w-72"],
  // `xl:col-span-2` já existia antes da P72.
  computador: ["xl:col-span-2", "2xl:ml-auto", "2xl:w-72"],
};

// ── achar cada elemento pela estrutura ─────────────────────────────────────
function salvarCupom(fonte: string): string[] {
  const l = ler(fonte);
  const barras = l.elementos.filter((e) => l.tag(e) === "AcaoDaBarra");
  if (barras.length !== 1) return [`achou ${barras.length} AcaoDaBarra`];
  const botoes = l.elementos.filter(
    (e) =>
      l.tag(e) === "Button" &&
      l.ancestrais(e).some((a) => a.no === barras[0].no),
  );
  if (botoes.length !== 1) return [`achou ${botoes.length} botões na barra`];
  const erros: string[] = [];
  if (!l.texto(botoes[0]).includes("Salvar Cupom"))
    erros.push("o botão da barra não é o Salvar Cupom");
  erros.push(
    ...confere(
      "salvar cupom",
      l,
      botoes[0],
      SALVAR_CUPOM.celular,
      SALVAR_CUPOM.novas,
      SALVAR_CUPOM.novas,
    ),
  );
  return erros;
}

function quemPodeUsar(fonte: string): string[] {
  const l = ler(fonte);
  const grupos = l.elementos.filter(
    (e) =>
      l.tag(e) === "GrupoDeOpcoes" &&
      l.literal(e, "aria-label") === "Quem pode usar",
  );
  if (grupos.length !== 1) return [`achou ${grupos.length} grupos`];
  const erros: string[] = [];
  const pai = l.ancestrais(grupos[0])[0];
  if (!pai || l.tag(pai) !== "fieldset")
    erros.push("o grupo não está direto no fieldset");
  // As opções (os três botões radio) continuam filhas do grupo.
  const radios = l.elementos.filter(
    (e) =>
      l.tag(e) === "button" &&
      l.ancestrais(e).some((a) => a.no === grupos[0].no),
  );
  if (radios.length !== 1) erros.push(`achou ${radios.length} botões radio`);
  erros.push(
    ...confere(
      "quem pode usar",
      l,
      grupos[0],
      QUEM_PODE_USAR.celular,
      QUEM_PODE_USAR.novas,
      QUEM_PODE_USAR.novas,
    ),
  );
  return erros;
}

function devolucao(fonte: string): string[] {
  const l = ler(fonte);
  const alvo = l.elementos.filter(
    (e) =>
      l.tag(e) === "fieldset" &&
      l.literal(e, "data-testid") === "politica-devolucao",
  );
  if (alvo.length !== 1) return [`achou ${alvo.length} fieldset`];
  return confere(
    "devolução",
    l,
    alvo[0],
    DEVOLUCAO.celular,
    DEVOLUCAO.novas,
    DEVOLUCAO.novas,
  );
}

function avancar(fonte: string): string[] {
  const l = ler(fonte);
  const botoes = l.elementos.filter(
    (e) =>
      l.tag(e) === "Button" &&
      l.texto(e).includes("onAdvance(orderId, nextStatus)") &&
      l.texto(e).includes("`Avançar →"),
  );
  if (botoes.length !== 1) return [`achou ${botoes.length} botões Avançar`];
  const erros: string[] = [];
  const pai = l.ancestrais(botoes[0])[0];
  // `ml-auto` só empurra dentro de contêiner flex.
  if (!pai || !l.pedacos(pai).includes("flex"))
    erros.push("o botão Avançar não está num contêiner flex");
  erros.push(
    ...confere(
      "avançar",
      l,
      botoes[0],
      AVANCAR.celular,
      AVANCAR.novas,
      AVANCAR.novas,
    ),
  );
  return erros;
}

/** A raiz da tela: o único `<div>` sem ancestral JSX que carrega `pb-admin`. */
function raizDaTela(
  nome: string,
  fonte: string,
  esperado: { celular: string; novas: string[]; computador?: string[] },
): string[] {
  const l = ler(fonte);
  const alvo = l.elementos.filter((e) => l.pedacos(e).includes("pb-admin"));
  if (alvo.length !== 1) return [`achou ${alvo.length} elementos com pb-admin`];
  const erros: string[] = [];
  if (l.tag(alvo[0]) !== "div") erros.push(`a raiz é <${l.tag(alvo[0])}>`);
  if (l.ancestrais(alvo[0]).length !== 0)
    erros.push("pb-admin não está na raiz da tela");
  erros.push(
    ...confere(
      nome,
      l,
      alvo[0],
      esperado.celular,
      esperado.computador ?? esperado.novas,
      esperado.novas,
    ),
  );
  return erros;
}

function busca(fonte: string): string[] {
  const l = ler(fonte);
  const alvo = l.elementos.filter(
    (e) =>
      l.tag(e) === "div" &&
      l.atributo(e, "inert") &&
      l.pedacos(e).includes("group"),
  );
  if (alvo.length !== 1) return [`achou ${alvo.length} div inert com group`];
  const erros: string[] = [];
  // É o envoltório do campo de busca: carrega o <input> de pesquisa.
  const campo = l.elementos.filter(
    (e) =>
      l.tag(e) === "DebouncedSearchInput" &&
      l.ancestrais(e).some((a) => a.no === alvo[0].no),
  );
  if (campo.length !== 1)
    erros.push(`achou ${campo.length} campos de busca dentro`);
  erros.push(
    ...confere("busca", l, alvo[0], BUSCA.celular, BUSCA.novas, BUSCA.novas),
  );
  return erros;
}

function salvarFrete(fonte: string): string[] {
  const l = ler(fonte);
  const botoes = l.elementos.filter(
    (e) =>
      l.tag(e) === "Button" &&
      l.texto(e).includes("void salvar()") &&
      l.texto(e).includes('"Salvando…" : "Salvar"'),
  );
  if (botoes.length !== 1) return [`achou ${botoes.length} botões Salvar`];
  const erros: string[] = [];
  // Filho direto da raiz, que é um bloco (não flex): `ml-auto` só vale com `2xl:flex`.
  const pai = l.ancestrais(botoes[0])[0];
  if (!pai || !l.pedacos(pai).includes("pb-admin"))
    erros.push("o Salvar não é filho direto da raiz da tela");
  erros.push(
    ...confere(
      "salvar frete",
      l,
      botoes[0],
      SALVAR_FRETE.celular,
      SALVAR_FRETE.novas,
      SALVAR_FRETE.novas,
    ),
  );
  return erros;
}

function salvarCor(fonte: string): string[] {
  const l = ler(fonte);
  const botoes = l.elementos.filter(
    (e) =>
      l.tag(e) === "Button" &&
      l.texto(e).includes("editor.savePrimaryColor()") &&
      l.texto(e).includes('"Salvar cor"'),
  );
  if (botoes.length !== 1) return [`achou ${botoes.length} botões Salvar cor`];
  const erros: string[] = [];
  // O botão mora em EscolhaDaCor, que a raiz (a GRADE) renderiza como filho direto:
  // sem isso, `ml-auto` não teria grade nenhuma para empurrar.
  const escolhas = l.elementos.filter((e) => l.tag(e) === "EscolhaDaCor");
  if (escolhas.length !== 1)
    erros.push(`achou ${escolhas.length} EscolhaDaCor`);
  else {
    const raiz = l.ancestrais(escolhas[0])[0];
    if (!raiz || !l.pedacos(raiz).includes("pb-admin"))
      erros.push("EscolhaDaCor não é filha direta da raiz da tela");
    else if (!l.pedacos(raiz).includes("xl:grid"))
      erros.push("a raiz da tela não é uma grade em xl");
  }
  erros.push(
    ...confere(
      "salvar cor",
      l,
      botoes[0],
      SALVAR_COR.celular,
      SALVAR_COR.computador,
      SALVAR_COR.novas,
    ),
  );
  return erros;
}

const PROVAS: [string, Chave, (f: string) => string[]][] = [
  ["1a. Salvar Cupom", "cupom", salvarCupom],
  ["1b. Quem pode usar", "quem", quemPodeUsar],
  ["2. Regras de troca e devolução", "devolucao", devolucao],
  ["3. Avançar → próxima etapa", "pedido", avancar],
  [
    "4. Ficha do cliente",
    "cliente",
    (f) => raizDaTela("ficha do cliente", f, CLIENTE),
  ],
  [
    "5. Card de frete grátis",
    "frete",
    (f) => raizDaTela("frete grátis", f, FRETE),
  ],
  ["6. Cor do app", "cor", (f) => raizDaTela("cor do app", f, COR)],
  ["7. Campo de busca das devoluções", "lista", busca],
  ["8. Salvar do card de frete grátis", "frete", salvarFrete],
  ["9. Salvar cor", "cor", salvarCor],
];

describe("P72 — cada classe de largura está no elemento certo, com o celular intacto", () => {
  for (const [nome, chave, prova] of PROVAS) {
    it(`${nome}: elemento certo, celular byte a byte, computador exato`, () => {
      expect(prova(fonteDe(chave))).toEqual([]);
    });
  }

  // ── mutantes em cópia: cada um tem de deixar a trava certa vermelha ──────
  const mutar = (chave: Chave, de: string, para: string) => {
    const mutante = fonteDe(chave).replace(de, para);
    expect(mutante).not.toBe(fonteDe(chave));
    return mutante;
  };

  it("mutante: a classe nova some (cada item)", () => {
    const casos: [Chave, string, string, (f: string) => string[]][] = [
      ["cupom", " lg:ml-auto lg:w-72`", "`", salvarCupom],
      [
        "quem",
        ' xl:grid xl:grid-cols-3 xl:gap-3 xl:space-y-0"',
        '"',
        quemPodeUsar,
      ],
      ["devolucao", ' lg:max-w-3xl"', '"', devolucao],
      ["pedido", ' lg:ml-auto lg:min-w-72 lg:flex-none lg:px-8"', '"', avancar],
      ["cliente", " lg:px-6", "", (f) => raizDaTela("c", f, CLIENTE)],
      ["frete", " 2xl:max-w-6xl", "", (f) => raizDaTela("f", f, FRETE)],
      ["cor", " 2xl:max-w-7xl", "", (f) => raizDaTela("r", f, COR)],
      ["lista", " lg:max-w-xl", "", busca],
    ];
    for (const [chave, de, para, fn] of casos) {
      expect(fn(mutar(chave, de, para)).join("\n")).toMatch(
        /classes de computador são/,
      );
    }
  });

  it("mutante: a classe nova vai para OUTRO elemento (cada item)", () => {
    // Tira do elemento certo e põe num vizinho: o dono único tem de falhar.
    const m1 = mutar("cupom", " lg:ml-auto lg:w-72`", "`").replace(
      '<AcaoDaBarra aria-label="Ações do cupom">',
      '<AcaoDaBarra aria-label="Ações do cupom" className="lg:w-72">',
    );
    expect(salvarCupom(m1).join("\n")).toMatch(/lg:w-72 está em/);

    const m2 = mutar("devolucao", ' lg:max-w-3xl"', '"').replace(
      '<p className="text-[11px] leading-relaxed text-zinc-400">',
      '<p className="text-[11px] leading-relaxed text-zinc-400 lg:max-w-3xl">',
    );
    expect(devolucao(m2).join("\n")).toMatch(/lg:max-w-3xl está em/);

    const m3 = mutar(
      "lista",
      "group relative lg:max-w-xl",
      "group relative",
    ).replace(
      '<div className="pointer-events-none absolute inset-y-0 left-0',
      '<div className="lg:max-w-xl pointer-events-none absolute inset-y-0 left-0',
    );
    expect(busca(m3).join("\n")).toMatch(
      /lg:max-w-xl está em|classes de computador/,
    );

    const m4 = mutar("cliente", " lg:px-6", "").replace(
      '<div className="mt-6 flex min-w-0 items-center gap-4">',
      '<div className="mt-6 flex min-w-0 items-center gap-4 lg:px-6">',
    );
    expect(raizDaTela("c", m4, CLIENTE).join("\n")).toMatch(/lg:px-6 está em/);

    const m5 = mutar(
      "pedido",
      ' lg:ml-auto lg:min-w-72 lg:flex-none lg:px-8"',
      '"',
    ).replace(
      'className="flex h-11 shrink-0 items-center gap-1 rounded-xl px-2',
      'className="lg:ml-auto lg:min-w-72 lg:flex-none lg:px-8 flex h-11 shrink-0 items-center gap-1 rounded-xl px-2',
    );
    expect(avancar(m5).join("\n")).toMatch(
      /está em 2 elemento|classes de computador/,
    );

    const m6 = mutar(
      "quem",
      ' xl:grid xl:grid-cols-3 xl:gap-3 xl:space-y-0"',
      '"',
    ).replace(
      'className="min-w-0 space-y-3 outline-none"',
      'className="min-w-0 space-y-3 outline-none xl:grid xl:grid-cols-3 xl:gap-3 xl:space-y-0"',
    );
    expect(quemPodeUsar(m6).join("\n")).toMatch(/está em/);

    const m7 = mutar("frete", " 2xl:max-w-6xl", "").replace(
      "<header>",
      '<header className="2xl:max-w-6xl">',
    );
    expect(raizDaTela("f", m7, FRETE).join("\n")).toMatch(
      /2xl:max-w-6xl está em/,
    );

    const m8 = mutar("cor", " 2xl:max-w-7xl", "").replace(
      '<header className="xl:col-span-2">',
      '<header className="xl:col-span-2 2xl:max-w-7xl">',
    );
    expect(raizDaTela("r", m8, COR).join("\n")).toMatch(
      /2xl:max-w-7xl está em/,
    );
  });

  it("mutante: uma classe de celular muda em cada item", () => {
    const casos: [Chave, string, string, (f: string) => string[]][] = [
      ["cupom", "h-auto w-full", "h-auto w-1/2", salvarCupom],
      [
        "quem",
        'className="space-y-3 xl:grid',
        'className="space-y-4 xl:grid',
        quemPodeUsar,
      ],
      ["devolucao", "min-w-0 space-y-7", "min-w-0 space-y-6", devolucao],
      [
        "pedido",
        "min-w-0 flex-1 items-center justify-center gap-1.5",
        "min-w-0 flex-1 items-center justify-start gap-1.5",
        avancar,
      ],
      [
        "cliente",
        "px-4 duration-200",
        "px-5 duration-200",
        (f) => raizDaTela("c", f, CLIENTE),
      ],
      [
        "frete",
        "space-y-4 px-4 pt-4",
        "space-y-4 px-4 pt-6",
        (f) => raizDaTela("f", f, FRETE),
      ],
      [
        "cor",
        "space-y-3 px-4 pt-4",
        "space-y-3 px-4 pt-6",
        (f) => raizDaTela("r", f, COR),
      ],
      ["lista", "group relative", "group relative block", busca],
    ];
    for (const [chave, de, para, fn] of casos) {
      expect(fn(mutar(chave, de, para)).join("\n")).toMatch(/celular mudou/);
    }
  });

  it("mutante: os dois Salvar (P72b) — classe some, vai para outro elemento, celular muda", () => {
    const FRETE_NOVAS = " 2xl:ml-auto 2xl:flex 2xl:w-72";
    const COR_NOVAS = " 2xl:ml-auto 2xl:w-72";

    // a classe nova some (só um token, e todas)
    expect(salvarFrete(mutar("frete", " 2xl:flex", "")).join("\n")).toMatch(
      /classes de computador são/,
    );
    expect(salvarFrete(mutar("frete", FRETE_NOVAS, "")).join("\n")).toMatch(
      /classes de computador são/,
    );
    expect(salvarCor(mutar("cor", " 2xl:ml-auto", "")).join("\n")).toMatch(
      /classes de computador são/,
    );
    expect(salvarCor(mutar("cor", COR_NOVAS, "")).join("\n")).toMatch(
      /classes de computador são/,
    );

    // a classe nova vai para OUTRO elemento
    const f1 = mutar("frete", FRETE_NOVAS, "").replace(
      '<p role="status" className="text-center text-xs text-zinc-400">',
      '<p role="status" className="text-center text-xs text-zinc-400 2xl:flex 2xl:ml-auto 2xl:w-72">',
    );
    expect(salvarFrete(f1).join("\n")).toMatch(/2xl:w-72 está em/);
    const c1 = mutar("cor", COR_NOVAS, "").replace(
      "bg-admin-bg text-zinc-50 xl:col-span-2`}",
      "bg-admin-bg text-zinc-50 xl:col-span-2 2xl:ml-auto 2xl:w-72`}",
    );
    expect(salvarCor(c1).join("\n")).toMatch(/2xl:w-72 está em/);

    // uma classe de celular muda
    expect(
      salvarFrete(mutar("frete", "h-[52px] w-full", "h-[52px] w-1/2")).join(
        "\n",
      ),
    ).toMatch(/celular mudou/);
    expect(
      salvarCor(
        mutar(
          "cor",
          "h-12 w-full rounded-2xl bg-foreground font-bold",
          "h-12 w-1/2 rounded-2xl bg-foreground font-bold",
        ),
      ).join("\n"),
    ).toMatch(/celular mudou/);

    // o Salvar cor deixa de estar dentro da grade
    expect(
      salvarCor(mutar("cor", " xl:grid xl:max-w-5xl", " xl:max-w-5xl")).join(
        "\n",
      ),
    ).toMatch(/não é uma grade em xl/);
  });

  it("mutante: o botão Avançar sai do contêiner flex", () => {
    const m = mutar(
      "pedido",
      '<div className="mx-auto flex w-full max-w-[600px] items-center gap-2 px-4 py-3 xl:max-w-none xl:px-6">',
      '<div className="mx-auto w-full max-w-[600px] items-center gap-2 px-4 py-3 xl:max-w-none xl:px-6">',
    );
    expect(avancar(m).join("\n")).toMatch(/não está num contêiner flex/);
  });
});
