// Onda L · frente "inicio-e-pecas-comuns" — prova ESTÁTICA (lê o fonte; o jsdom
// não aplica CSS, então a medida de 44px e a letra de verdade são do render).
//
//  (a) Compartilhar do Início: o botão tem `min-h-11 min-w-11` (a 360px o texto
//      some e o botão media 40x44); o <span aria-hidden> "Compartilhar" fica.
//  (b) O Início usa o token `bg-admin-bg`, não a cor literal `#09090b`.
//  (c) A mensagem de erro do campo comum (LocalBufferedInput) e o botão do
//      estado de erro (AdminErrorState) não têm texto abaixo de 11px, e o botão
//      do AdminErrorState é de `min-h-11` (sem `h-10`).
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

/** Mesma regex da régua do painel: `text-[6px]` … `text-[10.5px]`. */
const TEXTO_PEQUENO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

/** Tag de abertura que começa em `inicio`, respeitando `{…}`. */
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

describe("Onda L · início e peças comuns", () => {
  it("(a) Compartilhar do Início é alvo de 44x44 e mantém o nome acessível", () => {
    const fonte = ler("src/components/admin/inicio/PerfilDaLoja.tsx");
    const marca = fonte.indexOf('aria-label="Compartilhar o link da loja"');
    expect(marca).toBeGreaterThan(-1);
    const abre = fonte.lastIndexOf("<button", marca);
    const abertura = tagDeAbertura(fonte, abre);
    expect(abertura).toMatch(/\bmin-h-11\b/);
    expect(abertura).toMatch(/\bmin-w-11\b/);
    // o texto visível continua escondido do leitor de tela (o nome é o aria-label)
    expect(fonte).toMatch(
      /<span[^>]*aria-hidden="true"[^>]*>\s*Compartilhar\s*<\/span>/,
    );
  });

  it("(b) o Início usa o token bg-admin-bg em vez de #09090b", () => {
    const fonte = ler("src/views/admin/AdminDashboardView.tsx");
    expect(fonte).not.toMatch(/#09090b/i);
    expect(fonte).toMatch(/\bbg-admin-bg\b/);
  });

  it("(c) LocalBufferedInput e AdminErrorState não têm texto abaixo de 11px", () => {
    for (const arquivo of [
      "src/components/admin/LocalBufferedInput.tsx",
      "src/components/admin/AdminErrorState.tsx",
    ]) {
      expect(ler(arquivo).match(TEXTO_PEQUENO) ?? [], arquivo).toEqual([]);
    }
  });

  it("(c) a mensagem de erro do campo comum é de 11px nos dois campos", () => {
    const fonte = ler("src/components/admin/LocalBufferedInput.tsx");
    const mensagens = fonte.match(
      /className="ml-1 flex items-center gap-1 text-\[11px\] font-bold text-red-400/g,
    );
    expect(mensagens).toHaveLength(2);
  });

  it("(c) o botão do estado de erro é de min-h-11 (sem h-10)", () => {
    const fonte = ler("src/components/admin/AdminErrorState.tsx");
    const abre = fonte.indexOf("<Button");
    expect(abre).toBeGreaterThan(-1);
    const abertura = tagDeAbertura(fonte, abre);
    expect(abertura).toMatch(/\bmin-h-11\b/);
    expect(abertura).not.toMatch(/\bh-10\b/);
  });
});
