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

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

describe("botão de ajuda com 44px de toque (Padrão A3)", () => {
  it("o auxiliar acha o botão certo (e ignora o ícone dentro de <label>)", () => {
    const fonte = `<label><HelpCircle /></label><button type="button" onClick={() => f()} className="a"><span><HelpCircle /></span></button>`;
    const achados = botoesDeAjuda(fonte);
    expect(achados).toHaveLength(1);
    expect(achados[0].abertura).toContain("onClick={() => f()}");
    expect(achados[0].entreBotaoEIcone).toContain("<span");
  });

  for (const tela of TELAS_COM_AJUDA) {
    it(`${tela}: todo botão de ajuda tem min-h-11 min-w-11 e o círculo num <span>`, () => {
      const botoes = botoesDeAjuda(ler(tela));
      expect(botoes.length).toBeGreaterThan(0);
      for (const { abertura, entreBotaoEIcone } of botoes) {
        expect(abertura).toMatch(/\bmin-h-11\b/);
        expect(abertura).toMatch(/\bmin-w-11\b/);
        expect(entreBotaoEIcone).toContain("<span");
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
