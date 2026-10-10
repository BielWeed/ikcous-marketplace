// Onda K · frente "ajuda-e-inicio" — prova ESTÁTICA (lê o fonte; o jsdom não
// aplica CSS, então a medida de 44px de verdade é a do render).
//
//  (a) Botão de ajuda "?" (Padrão A3): em cada `<HelpCircle` cujo elemento
//      envolvente é um `<button`, o botão é o envoltório transparente de 44px
//      (`min-h-11 min-w-11`) e o círculo visível mora num `<span>` interno.
//      Fora disto fica o `HelpCircle` dentro de um `<label>` (não é botão).
//  (b) O Início e a tela de Vitrines não têm texto abaixo de 11px (a régua do
//      painel: `text-[6px]` … `text-[10.5px]`), fora de comentário.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

const TELAS_COM_AJUDA = [
  "src/views/admin/AdminDashboardView.tsx",
  "src/views/admin/AdminQAView.tsx",
  "src/views/admin/AdminPushView.tsx",
  "src/views/admin/AdminBannersView.tsx",
  "src/views/admin/AdminCouponsView.tsx",
  "src/views/admin/AdminCarouselsView.tsx",
  "src/views/admin/AdminReviewsView.tsx",
  "src/views/admin/AdminCrmView.tsx",
] as const;

const SEM_TEXTO_PEQUENO = [
  "src/components/admin/inicio/SerieDe14Dias.tsx",
  "src/components/admin/inicio/PerfilDaLoja.tsx",
  "src/views/admin/AdminDashboardView.tsx",
  "src/views/admin/AdminCarouselsView.tsx",
] as const;

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

/** Tag de abertura que começa em `inicio`, respeitando `{…}` (um `=>` dentro
 *  de `onClick={() => …}` não fecha a tag). */
function tagDeAbertura(fonte: string, inicio: number): string {
  let profundidade = 0;
  for (let i = inicio; i < fonte.length; i++) {
    const c = fonte[i];
    if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error("tag de abertura sem fechamento");
}

type BotaoDeAjuda = { abertura: string; entreBotaoEIcone: string };

/** Para cada `<HelpCircle`, o `<button` que o envolve (se houver). */
function botoesDeAjuda(fonte: string): BotaoDeAjuda[] {
  const achados: BotaoDeAjuda[] = [];
  for (const m of fonte.matchAll(/<HelpCircle\b/g)) {
    const antes = fonte.slice(0, m.index);
    const abre = antes.lastIndexOf("<button");
    const fecha = antes.lastIndexOf("</button>");
    if (abre === -1 || fecha > abre) continue; // não está dentro de botão
    const abertura = tagDeAbertura(fonte, abre);
    achados.push({
      abertura,
      entreBotaoEIcone: fonte.slice(abre + abertura.length, m.index),
    });
  }
  return achados;
}

/** O que falta num botão de ajuda para cumprir o Padrão A3 (vazio = ok). */
function problemasDoBotao({ abertura, entreBotaoEIcone }: BotaoDeAjuda) {
  const problemas: string[] = [];
  if (!/\bmin-h-11\b/.test(abertura)) problemas.push("sem min-h-11");
  if (!/\bmin-w-11\b/.test(abertura)) problemas.push("sem min-w-11");
  // Nome acessível: o texto do botão é só o ícone, então title ou aria-label.
  if (!/\s(?:title|aria-label)=/.test(abertura))
    problemas.push("sem title nem aria-label");
  const posicaoDoSpan = entreBotaoEIcone.lastIndexOf("<span");
  if (posicaoDoSpan === -1) problemas.push("sem <span> interno");
  else if (
    !/aria-hidden="true"/.test(tagDeAbertura(entreBotaoEIcone, posicaoDoSpan))
  )
    problemas.push("span interno sem aria-hidden");
  return problemas;
}

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

describe("botão de ajuda com 44px de toque (Padrão A3)", () => {
  it("o auxiliar acha o botão certo (e ignora o ícone dentro de <label>)", () => {
    const fonte = `<label><HelpCircle /></label><button type="button" onClick={() => f()} title="Ajuda" className="a"><span aria-hidden="true"><HelpCircle /></span></button>`;
    const achados = botoesDeAjuda(fonte);
    expect(achados).toHaveLength(1);
    expect(achados[0].abertura).toContain("onClick={() => f()}");
    expect(achados[0].entreBotaoEIcone).toContain("<span");
  });

  const CLASSE = 'className="min-h-11 min-w-11"';
  const botaoSintetico = (tag: string, span: string) =>
    botoesDeAjuda(`<button ${tag}>${span}<HelpCircle /></span></button>`)[0];

  it("o auxiliar aceita botão com title (ou aria-label) e span aria-hidden", () => {
    const comTitle = botaoSintetico(
      `type="button" title="Ajuda" ${CLASSE}`,
      '<span aria-hidden="true">',
    );
    expect(problemasDoBotao(comTitle)).toEqual([]);
    const comAria = botaoSintetico(
      `type="button" aria-label="Ajuda" ${CLASSE}`,
      '<span aria-hidden="true">',
    );
    expect(problemasDoBotao(comAria)).toEqual([]);
  });

  it("o auxiliar reprova botão sem title nem aria-label (sem nome acessível)", () => {
    const semNome = botaoSintetico(
      `type="button" ${CLASSE}`,
      '<span aria-hidden="true">',
    );
    expect(problemasDoBotao(semNome)).toContain("sem title nem aria-label");
  });

  it("o auxiliar reprova span interno sem aria-hidden, ausência de span e falta dos 44px", () => {
    const spanAberto = botaoSintetico(
      `type="button" title="Ajuda" ${CLASSE}`,
      "<span>",
    );
    expect(problemasDoBotao(spanAberto)).toContain(
      "span interno sem aria-hidden",
    );
    const semSpan = botoesDeAjuda(
      `<button type="button" title="Ajuda" ${CLASSE}><HelpCircle /></button>`,
    )[0];
    expect(problemasDoBotao(semSpan)).toContain("sem <span> interno");
    const pequeno = botaoSintetico(
      'type="button" title="Ajuda" className="size-8"',
      '<span aria-hidden="true">',
    );
    expect(problemasDoBotao(pequeno)).toEqual(
      expect.arrayContaining(["sem min-h-11", "sem min-w-11"]),
    );
  });

  for (const tela of TELAS_COM_AJUDA) {
    it(`${tela}: todo botão de ajuda tem 44px, nome acessível e o círculo num <span aria-hidden>`, () => {
      const botoes = botoesDeAjuda(ler(tela));
      expect(botoes.length).toBeGreaterThan(0);
      for (const botao of botoes) {
        expect(problemasDoBotao(botao)).toEqual([]);
      }
    });
  }
});

describe("Início e Vitrines sem texto abaixo de 11px", () => {
  for (const arquivo of SEM_TEXTO_PEQUENO) {
    it(`${arquivo}: nenhum text-[6px … 10.5px] fora de comentário`, () => {
      const pequenos = semComentarios(ler(arquivo)).match(
        /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g,
      );
      expect(pequenos ?? []).toEqual([]);
    });
  }
});
