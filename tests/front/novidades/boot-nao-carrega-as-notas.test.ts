// As notas das versões são texto da LOJISTA (~52 KB, ~15 kB brotli), lidas só
// na tela de Avisos do painel. Até 28/11/2026 o boot da vitrine as levava no
// JS de abertura: App.tsx -> ao-iniciar-apos-atualizacao -> armazenamento-local
// -> notas -> notas-das-versoes.json. Toda cliente baixava as notas antes da
// vitrine aparecer, e o aparelho dela ainda as gravava sem nunca vê-las.
// Este teste lê o GRAFO REAL de imports ESTÁTICOS (o `import()` dinâmico é um
// pedaço que só carrega quando pedido) a partir do boot e proíbe as notas ali.
// Mesmo molde de tests/front/porteiro-grafo-da-borda-so-modulos-puros.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../../..");
const EXTENSOES = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const NOTAS = "src/novidades/notas-das-versoes.json";

function resolverArquivo(de: string, especificador: string): string | null {
  const semQuery = especificador.split("?")[0];
  let base: string;
  if (semQuery.startsWith("@/")) base = resolve(RAIZ, "src", semQuery.slice(2));
  else if (semQuery.startsWith(".")) base = resolve(dirname(de), semQuery);
  else return null; // pacote de terceiros: fora do código do repositório
  for (const ext of EXTENSOES) {
    const candidato = base + ext;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminhos montados a partir de imports do próprio repositório, nunca entrada externa.
    if (existsSync(candidato) && /\.(ts|tsx|js|mjs|json)$/.test(candidato))
      return candidato;
  }
  // CSS, imagem e afins não importam código.
  return null;
}

function importsEstaticosDe(arquivo: string): string[] {
  if (arquivo.endsWith(".json")) return [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `arquivo` vem do grafo de imports do próprio repositório.
  const fonte = readFileSync(arquivo, "utf8")
    // Comentários não importam nada.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const achados = new Set<string>();
  for (const m of fonte.matchAll(
    /(?:^|\s)((?:import|export)\s[^;]*?\sfrom)\s*["']([^"']+)["']/g,
  )) {
    // `import type` some no build: não carrega nada.
    if (/^(?:import|export)\s+type\s/.test(m[1])) continue;
    achados.add(m[2]);
  }
  for (const m of fonte.matchAll(/(?:^|\s)import\s*["']([^"']+)["']/g))
    achados.add(m[1]);
  return [...achados];
}

function grafoEstatico(entrada: string): string[] {
  const visitados = new Set<string>();
  const fila = [resolve(RAIZ, entrada)];
  while (fila.length > 0) {
    const atual = fila.pop() as string;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    for (const especificador of importsEstaticosDe(atual)) {
      const alvo = resolverArquivo(atual, especificador);
      if (alvo) fila.push(alvo);
    }
  }
  return [...visitados].map((a) => relative(RAIZ, a).replaceAll("\\", "/"));
}

describe("as notas das versões ficam fora do JS de abertura da vitrine", () => {
  it("o leitor do grafo enxerga as notas onde elas estão (controle)", () => {
    expect(grafoEstatico("src/lib/novidades/armazenamento-local.ts")).toContain(
      NOTAS,
    );
  });

  it("o registro do boot não importa as notas, nem por tabela", () => {
    const grafo = grafoEstatico(
      "src/components/pwa/ao-iniciar-apos-atualizacao.ts",
    );
    // Olhando o grafo certo: o boot ainda alcança o registro e a versão.
    expect(grafo).toContain("src/lib/versao-do-servidor.ts");
    expect(grafo).not.toContain(NOTAS);
    expect(grafo).not.toContain("src/lib/novidades/notas.ts");
    expect(grafo).not.toContain("src/lib/novidades/armazenamento-local.ts");
  });

  it("nada do caminho estático a partir de main.tsx alcança as notas", () => {
    const grafo = grafoEstatico("src/main.tsx");
    expect(grafo).toContain("src/App.tsx");
    expect(grafo).toContain(
      "src/components/pwa/ao-iniciar-apos-atualizacao.ts",
    );
    expect(grafo).not.toContain(NOTAS);
  });
});
