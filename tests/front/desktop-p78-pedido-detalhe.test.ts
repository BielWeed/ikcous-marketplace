// P78 (detalhe do pedido no painel, computador): dois defeitos medidos em
// Chromium real, so em tela de computador.
//
// A) O botao "Avancar -> proxima etapa" da barra do topo esticava ate 819 px
//    (1280) e 1075 px (1536 e 1920). A correcao ja esta no codigo desde o P72
//    (`lg:ml-auto lg:min-w-72 lg:flex-none lg:px-8`: largura do proprio texto,
//    piso de 288 px, colado a direita). Aqui so se TRAVA para ninguem desfazer.
// B) Na venda de balcao o cartao "Cliente" (nome + WhatsApp, 122 px) dividia a
//    fileira com o cartao "Pagamento" (271 px) e o `xl:items-start` da grade
//    deixava um buraco de ~150 px logo abaixo dele. Correcao: `xl:self-stretch`
//    SO no cartao de entrega/cliente (data-testid="bloco-entrega"): os dois
//    cartoes da fileira passam a ter a mesma altura. Vai DENTRO do literal que
//    ja existe (nao num literal novo): o P28 congela a CONTAGEM de literais e,
//    como `classesDoCelular` apaga o token, o celular continua byte a byte.
//
// jsdom nao calcula layout: as alturas em px estao no relatorio da peca,
// medidas em Chromium. Aqui a prova e o fonte REAL lido por AST, o CSS que o
// Tailwind REAL emite para o token e mutantes em COPIA do fonte.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const CAMINHO = "src/components/admin/orders/OrderDetail.tsx";
const FONTE = readFileSync(CAMINHO, "utf8");

const CELULAR_DO_CARTAO_DE_ENTREGA = "space-y-4 p-5";
const TOKEN_NOVO = "xl:self-stretch";
const BOTAO_AVANCAR_CELULAR =
  "flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-normal rounded-xl bg-foreground px-2.5 text-sm font-semibold leading-tight text-background transition-colors hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40";

type Aberto = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function aberturas(fonte: string): Aberto[] {
  const arquivo = ts.createSourceFile(
    CAMINHO,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const lista: Aberto[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no))
      lista.push(no);
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return lista;
}

const atributo = (abertura: Aberto, nome: string) =>
  abertura.attributes.properties.find(
    (a): a is ts.JsxAttribute =>
      ts.isJsxAttribute(a) && a.name.getText() === nome,
  );

/** Todos os literais de texto dentro do className (inclui os de `cn(...)`). */
function literaisDeClasse(abertura: Aberto): string[] {
  const inicio = atributo(abertura, "className")?.initializer;
  const lista: string[] = [];
  const entrar = (no: ts.Node) => {
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no))
      lista.push(no.text);
    ts.forEachChild(no, entrar);
  };
  if (inicio) entrar(inicio);
  return lista;
}

const testId = (abertura: Aberto) => {
  const valor = atributo(abertura, "data-testid")?.initializer;
  return valor && ts.isStringLiteral(valor) ? valor.text : undefined;
};

function tokensDoCartaoDeEntrega(fonte: string): string[] {
  const achados = aberturas(fonte).filter((a) => testId(a) === "bloco-entrega");
  if (achados.length !== 1) throw new Error(`achou ${achados.length} cartoes`);
  // O cartao usa `cn(blocoDaFicha, "<literal>")`: o literal e o unico texto.
  return literaisDeClasse(achados[0]).flatMap((l) =>
    l.split(/\s+/).filter(Boolean),
  );
}

function problemasDoCartao(fonte: string): string[] {
  const tokens = tokensDoCartaoDeEntrega(fonte);
  const erros: string[] = [];
  if (classesDoCelular(tokens.join(" ")) !== CELULAR_DO_CARTAO_DE_ENTREGA)
    erros.push("celular do cartao mudou");
  if (!tokens.includes(TOKEN_NOVO)) erros.push(`falta ${TOKEN_NOVO}`);
  // So `xl:`: entre 1024 e 1279 a ficha e coluna unica, nao ha fileira.
  if (tokens.some((t) => /^(lg|2xl):/.test(t)))
    erros.push("lg:/2xl: no cartao de entrega");
  return erros;
}

function problemasDoBotao(fonte: string): string[] {
  const achados = aberturas(fonte).filter((a) =>
    literaisDeClasse(a).some(
      (l) => classesDoCelular(l) === BOTAO_AVANCAR_CELULAR,
    ),
  );
  if (achados.length !== 1) return [`achou ${achados.length} botoes`];
  const classe = literaisDeClasse(achados[0])[0];
  const tokens = classe.split(/\s+/);
  const erros: string[] = [];
  for (const exigido of ["lg:flex-none", "lg:ml-auto", "lg:min-w-72"])
    if (!tokens.includes(exigido)) erros.push(`falta ${exigido}`);
  if (tokens.some((t) => /^(lg|xl|2xl):(w-full|flex-1|grow)$/.test(t)))
    erros.push("botao volta a esticar");
  return erros;
}

describe("P78 — ficha do pedido no computador", () => {
  it("o cartao Cliente/Entrega ganha xl:self-stretch e o celular fica igual", () => {
    expect(problemasDoCartao(FONTE)).toEqual([]);
  });

  it("xl:self-stretch aparece UMA vez so no arquivo (nenhum outro cartao muda)", () => {
    expect(FONTE.split(TOKEN_NOVO)).toHaveLength(2);
  });

  it("mutante: tirar o token deixa o teste vermelho", () => {
    const mutante = FONTE.replace(` ${TOKEN_NOVO}`, "");
    expect(mutante).not.toBe(FONTE);
    expect(problemasDoCartao(mutante)).toEqual([`falta ${TOKEN_NOVO}`]);
  });

  it("mutante: mexer no celular do cartao fica vermelho", () => {
    const mutante = FONTE.replace(
      `"${CELULAR_DO_CARTAO_DE_ENTREGA} ${TOKEN_NOVO}"`,
      `"space-y-5 p-5 ${TOKEN_NOVO}"`,
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemasDoCartao(mutante)).toEqual(["celular do cartao mudou"]);
  });

  it("mutante: lg:self-stretch no lugar do xl: fica vermelho", () => {
    const mutante = FONTE.replace(TOKEN_NOVO, "lg:self-stretch");
    expect(mutante).not.toBe(FONTE);
    expect(problemasDoCartao(mutante)).toEqual([
      `falta ${TOKEN_NOVO}`,
      "lg:/2xl: no cartao de entrega",
    ]);
  });

  it("o Tailwind real emite align-self: stretch so a partir de 1280 px", async () => {
    const exigir = createRequire(import.meta.url);
    const tailwind = exigir("tailwindcss");
    const resultado = await postcss([
      tailwind({
        content: [
          { raw: `<div class="${TOKEN_NOVO}"></div>`, extension: "html" },
        ],
        corePlugins: { preflight: false },
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const medias: string[] = [];
    const declaracoes: string[] = [];
    resultado.root.walkAtRules("media", (media) => {
      medias.push(media.params);
      media.walkDecls((d) => {
        declaracoes.push(`${d.prop}: ${d.value}`);
      });
    });
    expect(medias).toEqual(["(min-width: 1280px)"]);
    expect(declaracoes).toEqual(["align-self: stretch"]);
  });

  it("o botao Avancar segue com largura propria (nao estica a linha toda)", () => {
    expect(problemasDoBotao(FONTE)).toEqual([]);
    const mutante = FONTE.replace(" lg:flex-none", " lg:flex-1");
    expect(mutante).not.toBe(FONTE);
    expect(problemasDoBotao(mutante)).toEqual([
      "falta lg:flex-none",
      "botao volta a esticar",
    ]);
  });
});
