// O rodapé da vitrine (Home) e os links do checkout, do produto e do cadastro
// só precisam do NOME de cada política. O texto jurídico inteiro
// (`textos-das-politicas.ts`, ~2,9 kB comprimido) tem de ficar no pedaço
// baixado sob demanda — senão toda abertura da Home paga por um texto que quase
// ninguém lê. Este teste anda pelos imports ESTÁTICOS de cada ponto de entrada
// e prova que o arquivo grande não está no caminho. (Import dinâmico e
// `import type` não contam: não entram no pedaço inicial.)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");
const GRANDE = "src/lib/textos-das-politicas.ts";

function caminhoDoImport(origem: string, alvo: string): string | null {
  if (!alvo.startsWith("@/") && !alvo.startsWith(".")) return null;
  const base = alvo.startsWith("@/")
    ? resolve(RAIZ, "src", alvo.slice(2))
    : resolve(dirname(resolve(RAIZ, origem)), alvo);
  for (const ext of [".ts", ".tsx"]) {
    const candidato = `${base}${ext}`;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho dentro do proprio repositorio
      readFileSync(candidato, "utf8");
      return candidato.slice(RAIZ.length + 1).replace(/\\/g, "/");
    } catch {
      // tenta a próxima extensão
    }
  }
  return null;
}

/** Imports estáticos de valor: `import x from "..."` (sem `import type`). */
function importsEstaticos(arquivo: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho dentro do proprio repositorio
  const fonte = readFileSync(resolve(RAIZ, arquivo), "utf8");
  const achados: string[] = [];
  // eslint-disable-next-line security/detect-unsafe-regex -- le o fonte do proprio repositorio, com quantificador preguicoso e ancora `;`: sem entrada hostil
  const regex = /^import\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)";/gms;
  for (const m of fonte.matchAll(regex)) {
    if (m[1]) continue; // import type
    const especificadores = m[2];
    // `import { type A, type B }` também some na compilação.
    const soTipos =
      /^\{[^}]*\}$/.test(especificadores.trim()) &&
      especificadores
        .replace(/[{}]/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith("type "));
    if (soTipos) continue;
    achados.push(m[3]);
  }
  return achados;
}

function fechamentoEstatico(entrada: string): Set<string> {
  const visto = new Set<string>();
  const fila = [entrada];
  while (fila.length > 0) {
    const atual = fila.pop() as string;
    if (visto.has(atual)) continue;
    visto.add(atual);
    for (const alvo of importsEstaticos(atual)) {
      const caminho = caminhoDoImport(atual, alvo);
      // Só seguimos dentro de politicas/ e dos dois arquivos de lib: o resto
      // do app (hooks, contexto, ícones) não pode arrastar o texto grande.
      if (
        caminho &&
        (caminho.startsWith("src/components/politicas/") ||
          caminho.startsWith("src/lib/") ||
          caminho.startsWith("src/hooks/") ||
          caminho.startsWith("src/utils/"))
      ) {
        fila.push(caminho);
      }
    }
  }
  return visto;
}

describe("peso da Home: o texto jurídico não vem junto do rodapé", () => {
  it.each([
    "src/components/politicas/RodapeDasPoliticas.tsx",
    "src/components/politicas/LinksDasPoliticas.tsx",
    "src/components/politicas/PoliticaEmFolhaSobDemanda.tsx",
  ])("%s não importa o arquivo grande, nem de forma indireta", (entrada) => {
    const fecho = fechamentoEstatico(entrada);
    expect([...fecho]).not.toContain(GRANDE);
    expect([...fecho]).not.toContain(
      "src/components/politicas/PoliticaEmFolha.tsx",
    );
    expect([...fecho]).not.toContain(
      "src/components/politicas/ConteudoDaPolitica.tsx",
    );
  });

  it("controle: a folha de leitura, essa sim, traz o arquivo grande", () => {
    const fecho = fechamentoEstatico(
      "src/components/politicas/ConteudoDaPolitica.tsx",
    );
    expect([...fecho]).toContain(GRANDE);
  });
});
