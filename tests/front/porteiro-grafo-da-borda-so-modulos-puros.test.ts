// O porteiro roda no middleware, na BORDA da Vercel, para TODAS as lojas, e nao
// existe previa que o exercite (vercel.json desliga as previas; jsdom e o
// ensaio T6 nao rodam na borda). Um import errado -- `@/lib/supabase` (cria
// cliente no load e valida o ambiente), DataVault/IndexedDB, o modulo de banners
// do app -- quebraria TODAS as lojas so em producao. Este teste le o GRAFO
// REAL de imports de `middleware.ts` e proibe o que nao pode estar la.
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");
const ENTRADA = resolve(RAIZ, "middleware.ts");
const EXTENSOES = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts"];

function resolverRelativo(de: string, especificador: string): string {
  const base = resolve(dirname(de), especificador);
  for (const ext of EXTENSOES) {
    const candidato = base + ext;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminhos montados a partir do `middleware.ts` do proprio repositorio, nunca entrada externa.
    if (existsSync(candidato) && /\.(ts|tsx|js|mjs)$/.test(candidato))
      return candidato;
  }
  throw new Error(`import relativo nao resolvido: ${especificador} (em ${de})`);
}

function especificadoresDe(arquivo: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `arquivo` vem do grafo de imports do proprio repositorio.
  const fonte = readFileSync(arquivo, "utf8")
    // Comentarios nao importam nada.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const achados = new Set<string>();
  for (const m of fonte.matchAll(
    /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g,
  ))
    achados.add(m[1]);
  for (const m of fonte.matchAll(/(?:^|\s)import\s*["']([^"']+)["']/g))
    achados.add(m[1]);
  for (const m of fonte.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g))
    achados.add(m[1]);
  return [...achados];
}

function grafo(): { arquivos: string[]; externos: Map<string, string[]> } {
  const visitados = new Set<string>();
  const externos = new Map<string, string[]>();
  const fila = [ENTRADA];
  while (fila.length > 0) {
    const atual = fila.pop() as string;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    for (const esp of especificadoresDe(atual)) {
      if (esp.startsWith(".")) fila.push(resolverRelativo(atual, esp));
      else
        externos.set(esp, [
          ...(externos.get(esp) ?? []),
          relative(RAIZ, atual).replaceAll("\\", "/"),
        ]);
    }
  }
  return {
    arquivos: [...visitados].map((a) =>
      relative(RAIZ, a).replaceAll("\\", "/"),
    ),
    externos,
  };
}

describe("grafo de imports de middleware.ts (a borda)", () => {
  const { arquivos, externos } = grafo();

  it("alcanca o porteiro e o cartaz (o teste esta olhando o grafo certo)", () => {
    expect(arquivos).toContain("src/hospedagem/porteiro.ts");
    expect(arquivos).toContain("src/hospedagem/cartaz.ts");
    expect(arquivos).toContain("src/lib/imageUrl.ts");
    expect(arquivos).toContain("src/lib/imagem-do-banner.ts");
  });

  it("nenhum import com alias `@/` (o bundler da borda nao o resolve)", () => {
    const comAlias = [...externos.keys()].filter((e) => e.startsWith("@/"));
    expect(comAlias).toEqual([]);
  });

  it("nenhum pacote de terceiros NOVO na borda (so os que ja estavam: leitura da identidade e tipos)", () => {
    // Base de 31/10/2026: `publicStoreIdentity` (createClient + zod, ja roda na
    // borda) e o TIPO de `vite-plugin-pwa` em `manifestoBase`. Pacote novo aqui
    // e decisao consciente, nao efeito colateral.
    expect([...externos.keys()].sort()).toEqual(
      ["@supabase/supabase-js", "vite-plugin-pwa", "zod"].sort(),
    );
  });

  it("o cartaz so importa modulos puros por caminho relativo", () => {
    const cartaz = especificadoresDe(resolve(RAIZ, "src/hospedagem/cartaz.ts"));
    expect(cartaz.sort()).toEqual(
      [
        "../config/identidadeNoHtml",
        "../lib/imageUrl",
        "../lib/imagem-do-banner",
        "../lib/prefixo-do-banner",
      ].sort(),
    );
  });

  it("nenhum modulo de navegador ou do app no grafo", () => {
    const proibidos = [
      /(^|\/)supabase\.ts$/,
      /(^|\/)dataVault\.ts$/,
      /banners-da-vitrine/,
      /(^|\/)useBanners/,
      /\.tsx$/,
      /^src\/(components|views|hooks|contexts)\//,
    ];
    const achados = arquivos.filter((a) => proibidos.some((p) => p.test(a)));
    expect(achados).toEqual([]);
  });

  it("nenhum arquivo do grafo toca API de navegador (window, document, indexedDB, localStorage)", () => {
    const usos: string[] = [];
    for (const a of arquivos) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- `a` vem do grafo de imports do proprio repositorio.
      const fonte = readFileSync(resolve(RAIZ, a), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
      if (
        /\b(window|document|indexedDB|localStorage|sessionStorage|navigator)\./.test(
          fonte,
        )
      )
        usos.push(a);
    }
    expect(usos).toEqual([]);
  });
});
