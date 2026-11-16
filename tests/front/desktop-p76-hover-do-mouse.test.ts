// P76 (loja no computador, com mouse): três lugares não reagiam ao passar o
// mouse -- o coração (BotaoDeFavorito), o botão Compartilhar do produto e as
// setas do carrossel --, e os três botões do cabeçalho de PC (voltar,
// notificações, carrinho) tinham nome para leitor de tela mas não o balão do
// mouse (`title`).
//
// O que esta trava garante, por AST sobre o fonte REAL (o jsdom não calcula
// CSS nem hover, então o que se prova é ONDE a classe está):
//   - o literal de celular de cada botão é, byte a byte e na ordem, o de antes
//     da peça (congelado abaixo, escrito à mão, nunca lido do git): nenhuma
//     classe sem prefixo muda e nada de `dark:`/`hover:` do celular entra;
//   - os tokens de computador (`lg:`/`xl:`/`2xl:`) de cada botão são
//     exatamente os esperados, e cada classe nova de hover só está nos botões
//     certos (não no ícone, não em outro botão do arquivo);
//   - no cabeçalho de PC, o `title` de cada um dos três botões é a MESMA
//     expressão do `aria-label` (resolvida, se for uma constante) e nenhum
//     outro elemento do cabeçalho ganhou `title`.
// Cor: o coração e o Compartilhar são `bg-white dark:bg-zinc-900`; o token
// `bg-muted` do tema é zinc-100 no claro e zinc-800 no escuro, então o hover
// acompanha o fundo nos dois temas. As setas do carrossel têm fundo e texto
// FIXOS (`bg-white text-zinc-900`, sem variante escura): ali o hover também é
// fixo (`zinc-100`), porque um token escuro deixaria o texto escuro ilegível.
// Os mutantes rodam em CÓPIA do fonte (texto em memória).
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const FAVORITO = readFileSync(
  "src/components/ui/custom/BotaoDeFavorito.tsx",
  "utf8",
);
const PRODUTO = readFileSync("src/views/customer/ProductView.tsx", "utf8");
const CARROSSEL = readFileSync(
  "src/components/ui/custom/ProductCarousel.tsx",
  "utf8",
);
const CABECALHO = readFileSync(
  "src/components/desktop/CabecalhoDoComputador.tsx",
  "utf8",
);

// ── Como cada botão era ANTES da P76 (celular, na ordem) ───────────────────
const CORACAO_CELULAR = [
  "grid size-11 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white shadow-sm outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:ring-white",
  "text-zinc-950 dark:text-white",
];
const COMPARTILHAR_CELULAR = [
  "grid size-11 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-950 shadow-sm outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus-visible:ring-white",
];
const SETA_ESQUERDA_CELULAR = [
  "absolute left-2 top-[170px] z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
];
const SETA_DIREITA_CELULAR = [
  "absolute right-2 top-[170px] z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2",
];

// ── O que a P76 acrescenta no computador (e o que já existia lá) ───────────
const HOVER_REDONDO = ["lg:hover:bg-muted"];
// `lg:flex` já existia nas setas antes da P76.
const HOVER_SETA = ["lg:hover:bg-zinc-100", "lg:hover:border-zinc-300"];
const SETA_COMPUTADOR = ["lg:flex", ...HOVER_SETA];

// ── Como cada botão do cabeçalho era ANTES da P76 (classes não mudam) ──────
const CABECALHO_VOLTAR_CLASSES = [
  "flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted",
];
const CABECALHO_ICONE_CLASSES = [
  "relative flex size-11 items-center justify-center rounded-full hover:bg-muted",
];
// A expressão do nome (sem espaços): `title` tem de ser exatamente esta também.
const ROTULO_NOTIFICACOES =
  'unreadCount>0?`Notificações,${unreadCount}não${unreadCount===1?"lida":"lidas"}`:"Notificações"';
const ROTULO_CARRINHO =
  'cartCount>0?`Carrinho,${cartCount}${cartCount===1?"item":"itens"}`:"Carrinho"';

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
  /** Cada pedaço de texto do className (o `cn(...)` tem vários). */
  const pedacos = (e: Elemento): string[] => {
    const inicio = atributo(e, "className")?.initializer;
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
  const todosOsTokens = (e: Elemento) => pedacos(e).flatMap(tokens);
  /** Elementos do arquivo que carregam `token` em algum pedaço do className. */
  const quemTem = (token: string) =>
    elementos.filter((e) => todosOsTokens(e).includes(token));
  /** Elementos com o atributo (qualquer valor). */
  const comAtributo = (nome: string) =>
    elementos.filter((e) => atributo(e, nome) !== undefined);
  /**
   * O texto (sem espaços) do valor de um atributo. `{nome}` que aponta para uma
   * `const nome = expressão` do arquivo vira a expressão; literal vira `"..."`.
   */
  const valorSemEspacos = (e: Elemento, nome: string): string | undefined => {
    const inicial = atributo(e, nome)?.initializer;
    if (!inicial) return undefined;
    let expr: ts.Node = inicial;
    if (ts.isJsxExpression(inicial) && inicial.expression)
      expr = inicial.expression;
    if (ts.isIdentifier(expr)) {
      let achado: ts.Expression | undefined;
      const procurar = (no: ts.Node) => {
        if (
          ts.isVariableDeclaration(no) &&
          ts.isIdentifier(no.name) &&
          no.name.text === (expr as ts.Identifier).text
        )
          achado = no.initializer;
        ts.forEachChild(no, procurar);
      };
      procurar(arquivo);
      if (achado) expr = achado;
    }
    return expr.getText(arquivo).replace(/\s+/g, "");
  };

  return {
    elementos,
    tag,
    literal,
    pedacos,
    tokens,
    quemTem,
    comAtributo,
    valorSemEspacos,
  };
}

const igual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Confere um botão já achado: o celular (por pedaço, na ordem) é o congelado,
 * os tokens de computador são exatamente `computador` (qualquer ordem), e cada
 * classe de `novas` está só nos elementos de `donos` (e em mais nenhum).
 */
function confere(
  nome: string,
  leitor: ReturnType<typeof ler>,
  elemento: Elemento,
  celularEsperado: string[],
  computador: string[],
  novas: string[],
  donos: Elemento[] = [elemento],
): string[] {
  const erros: string[] = [];
  const pedacos = leitor.pedacos(elemento);
  const celular = pedacos
    .map((p) =>
      leitor
        .tokens(p)
        .filter((t) => !ehDeComputador(t))
        .join(" "),
    )
    .filter(Boolean);
  if (!igual(celular, celularEsperado))
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
    const quem = leitor.quemTem(nova);
    const certo =
      quem.length === donos.length &&
      donos.every((d) => quem.some((q) => q.no === d.no));
    if (!certo)
      erros.push(
        `${nome}: ${nova} está em ${quem.length} elemento(s), esperado ${donos.length} só nos certos`,
      );
  }
  return erros;
}

function problemasDoCoracao(fonte: string): string[] {
  const l = ler(fonte);
  const botoes = l.elementos.filter(
    (e) =>
      l.tag(e) === "button" && l.comAtributo("data-botao-favorito").includes(e),
  );
  if (botoes.length !== 1) return [`achou ${botoes.length} botões de favorito`];
  return confere(
    "coração",
    l,
    botoes[0],
    CORACAO_CELULAR,
    HOVER_REDONDO,
    HOVER_REDONDO,
  );
}

function problemasDoCompartilhar(fonte: string): string[] {
  const l = ler(fonte);
  const botoes = l.elementos.filter(
    (e) =>
      l.tag(e) === "button" && l.literal(e, "aria-label") === "Compartilhar",
  );
  if (botoes.length !== 1)
    return [`achou ${botoes.length} botões Compartilhar`];
  return confere(
    "compartilhar",
    l,
    botoes[0],
    COMPARTILHAR_CELULAR,
    HOVER_REDONDO,
    HOVER_REDONDO,
  );
}

function problemasDasSetas(fonte: string): string[] {
  const l = ler(fonte);
  const achar = (rotulo: string) =>
    l.elementos.filter(
      (e) => l.tag(e) === "button" && l.literal(e, "aria-label") === rotulo,
    );
  const esquerdas = achar("Ver produtos anteriores");
  const direitas = achar("Ver próximos produtos");
  if (esquerdas.length !== 1 || direitas.length !== 1)
    return [
      `achou ${esquerdas.length} setas esquerdas, ${direitas.length} direitas`,
    ];
  const donos = [esquerdas[0], direitas[0]];
  return [
    ...confere(
      "seta esquerda",
      l,
      esquerdas[0],
      SETA_ESQUERDA_CELULAR,
      SETA_COMPUTADOR,
      HOVER_SETA,
      donos,
    ),
    ...confere(
      "seta direita",
      l,
      direitas[0],
      SETA_DIREITA_CELULAR,
      SETA_COMPUTADOR,
      HOVER_SETA,
      donos,
    ),
  ];
}

function problemasDoCabecalho(fonte: string): string[] {
  const l = ler(fonte);
  const erros: string[] = [];
  const doAria = (valor: string) =>
    l.elementos.filter(
      (e) =>
        l.tag(e) === "button" && l.valorSemEspacos(e, "aria-label") === valor,
    );
  // [nome, valor esperado do aria-label e do title, classes de celular]
  const botoes: [string, string, string[], Elemento[]][] = [
    ["voltar", '"Voltar"', CABECALHO_VOLTAR_CLASSES, doAria('"Voltar"')],
    [
      "notificações",
      ROTULO_NOTIFICACOES,
      CABECALHO_ICONE_CLASSES,
      l.elementos.filter(
        (e) =>
          l.tag(e) === "button" &&
          l.valorSemEspacos(e, "aria-label") === ROTULO_NOTIFICACOES,
      ),
    ],
    [
      "carrinho",
      ROTULO_CARRINHO,
      CABECALHO_ICONE_CLASSES,
      l.elementos.filter(
        (e) => l.tag(e) === "button" && l.literal(e, "id") === "header-cart",
      ),
    ],
  ];
  const comTitle: Elemento[] = [];
  for (const [nome, valor, classes, achados] of botoes) {
    if (achados.length !== 1) {
      erros.push(`${nome}: achou ${achados.length} botões`);
      continue;
    }
    const [botao] = achados;
    comTitle.push(botao);
    if (l.valorSemEspacos(botao, "aria-label") !== valor)
      erros.push(`${nome}: aria-label mudou`);
    if (l.valorSemEspacos(botao, "title") !== valor)
      erros.push(
        `${nome}: title é ${l.valorSemEspacos(botao, "title")}, não a mesma expressão do aria-label`,
      );
    const celular = l
      .pedacos(botao)
      .map((p) => l.tokens(p).join(" "))
      .filter(Boolean);
    if (!igual(celular, classes))
      erros.push(`${nome}: classes mudaram: ${JSON.stringify(celular)}`);
  }
  const comTitleNoArquivo = l.comAtributo("title");
  if (comTitleNoArquivo.length !== comTitle.length)
    erros.push(
      `${comTitleNoArquivo.length} elementos com title no cabeçalho, esperado ${comTitle.length}`,
    );
  return erros;
}

describe("P76 — o mouse reage ao passar por cima, no elemento certo", () => {
  it("coração: o botão de favorito ganha lg:hover:bg-muted e mais nada", () => {
    expect(problemasDoCoracao(FAVORITO)).toEqual([]);
  });

  it("compartilhar: o botão do produto ganha lg:hover:bg-muted e mais nada", () => {
    expect(problemasDoCompartilhar(PRODUTO)).toEqual([]);
  });

  it("setas do carrossel: as duas ganham hover de fundo e borda", () => {
    expect(problemasDasSetas(CARROSSEL)).toEqual([]);
  });

  it("cabeçalho de PC: voltar, notificações e carrinho têm title igual ao aria-label", () => {
    expect(problemasDoCabecalho(CABECALHO)).toEqual([]);
  });

  // ── mutantes em cópia: cada um tem de deixar a trava certa vermelha ──────
  it("mutante: o coração perde o hover", () => {
    const mutante = FAVORITO.replace(" lg:hover:bg-muted", "");
    expect(mutante).not.toBe(FAVORITO);
    expect(problemasDoCoracao(mutante).join("\n")).toMatch(
      /classes de computador são \[\]/,
    );
  });

  it("mutante: o hover do coração vai para o ícone em vez do botão", () => {
    const mutante = FAVORITO.replace(" lg:hover:bg-muted", "").replace(
      '"size-5 block",',
      '"size-5 block lg:hover:bg-muted",',
    );
    expect(mutante).not.toBe(FAVORITO);
    const erros = problemasDoCoracao(mutante).join("\n");
    expect(erros).toMatch(/classes de computador são \[\]/);
    expect(erros).toMatch(/lg:hover:bg-muted está em 1 elemento/);
  });

  it("mutante: o coração mexe numa classe de celular (some o retorno ao pressionar)", () => {
    const mutante = FAVORITO.replace(" active:scale-90", "");
    expect(mutante).not.toBe(FAVORITO);
    expect(problemasDoCoracao(mutante).join("\n")).toMatch(
      /coração: celular mudou/,
    );
  });

  it("mutante: o coração ganha hover escuro do celular (dark:)", () => {
    const mutante = FAVORITO.replace(
      " lg:hover:bg-muted",
      " lg:hover:bg-muted dark:hover:bg-zinc-800",
    );
    expect(mutante).not.toBe(FAVORITO);
    expect(problemasDoCoracao(mutante).join("\n")).toMatch(
      /coração: celular mudou/,
    );
  });

  it("mutante: o Compartilhar perde o hover", () => {
    const mutante = PRODUTO.replace(" lg:hover:bg-muted", "");
    expect(mutante).not.toBe(PRODUTO);
    expect(problemasDoCompartilhar(mutante).join("\n")).toMatch(
      /compartilhar: classes de computador são \[\]/,
    );
  });

  it("mutante: o hover do Compartilhar passa para o ícone", () => {
    const mutante = PRODUTO.replace(" lg:hover:bg-muted", "").replace(
      '<Share2 aria-hidden="true" className="block size-5" />',
      '<Share2 aria-hidden="true" className="block size-5 lg:hover:bg-muted" />',
    );
    expect(mutante).not.toBe(PRODUTO);
    expect(problemasDoCompartilhar(mutante).join("\n")).toMatch(
      /lg:hover:bg-muted está em 1 elemento/,
    );
  });

  it("mutante: o Compartilhar mexe numa classe de celular (sai o anel de foco)", () => {
    const mutante = PRODUTO.replace(
      "outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white",
      "outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white",
    );
    expect(mutante).not.toBe(PRODUTO);
    expect(problemasDoCompartilhar(mutante).join("\n")).toMatch(
      /compartilhar: celular mudou/,
    );
  });

  it("mutante: uma seta do carrossel perde o hover", () => {
    const mutante = CARROSSEL.replace(
      "focus-visible:ring-offset-2 lg:flex lg:hover:border-zinc-300 lg:hover:bg-zinc-100",
      "focus-visible:ring-offset-2 lg:flex",
    );
    expect(mutante).not.toBe(CARROSSEL);
    expect(problemasDasSetas(mutante).join("\n")).toMatch(
      /classes de computador são/,
    );
  });

  it("mutante: o hover da seta esquerda vai para o contêiner (relative -mx-6)", () => {
    const mutante = CARROSSEL.replace(
      '<div className="relative -mx-6">',
      '<div className="relative -mx-6 lg:hover:bg-zinc-100">',
    );
    expect(mutante).not.toBe(CARROSSEL);
    expect(problemasDasSetas(mutante).join("\n")).toMatch(
      /lg:hover:bg-zinc-100 está em 3 elemento/,
    );
  });

  it("mutante: a seta direita mexe numa classe de celular (volta a ser visível sempre)", () => {
    const mutante = CARROSSEL.replace(
      "absolute right-2 top-[170px] z-20 hidden",
      "absolute right-2 top-[170px] z-20",
    );
    expect(mutante).not.toBe(CARROSSEL);
    expect(problemasDasSetas(mutante).join("\n")).toMatch(
      /seta direita: celular mudou/,
    );
  });

  it("mutante: o title do carrinho vira outro texto", () => {
    const mutante = CABECALHO.replace(
      /title=\{rotuloDoCarrinho\}/,
      'title="Cesta"',
    );
    expect(mutante).not.toBe(CABECALHO);
    expect(problemasDoCabecalho(mutante).join("\n")).toMatch(
      /carrinho: title é "Cesta"/,
    );
  });

  it("mutante: o title do Voltar some", () => {
    const mutante = CABECALHO.replace(/\n\s*title="Voltar"/, "");
    expect(mutante).not.toBe(CABECALHO);
    expect(problemasDoCabecalho(mutante).join("\n")).toMatch(
      /voltar: title é undefined/,
    );
  });

  it("mutante: o aria-label das notificações muda e o title não acompanha", () => {
    const mutante = CABECALHO.replace(': "Notificações"', ': "Avisos"');
    expect(mutante).not.toBe(CABECALHO);
    expect(problemasDoCabecalho(mutante).join("\n")).toMatch(/notificações/);
  });

  it("mutante: outro elemento do cabeçalho ganha title", () => {
    const mutante = CABECALHO.replace(
      'aria-label="Ir para o Início"',
      'aria-label="Ir para o Início"\n          title="Ir para o Início"',
    );
    expect(mutante).not.toBe(CABECALHO);
    expect(problemasDoCabecalho(mutante).join("\n")).toMatch(
      /elementos com title no cabeçalho/,
    );
  });

  it("mutante: as classes do botão de voltar mudam", () => {
    const mutante = CABECALHO.replace(
      "rounded-full hover:bg-muted",
      "rounded-full hover:bg-zinc-100",
    );
    expect(mutante).not.toBe(CABECALHO);
    expect(problemasDoCabecalho(mutante).join("\n")).toMatch(/classes mudaram/);
  });
});
