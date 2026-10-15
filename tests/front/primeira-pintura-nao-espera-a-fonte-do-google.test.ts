/* eslint-disable security/detect-non-literal-fs-filename -- Os caminhos lidos aqui saem de literais deste arquivo ou do href/url() do index.html e do index.css do próprio repositório, resolvidos dentro da raiz do projeto. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Medido em 14/10/2026 (Chromium real, build de produção servido com brotli):
// a folha de estilo da Inter vinha do Google (`<link rel="stylesheet">` no
// <head>), e folha de estilo no <head> TRAVA a primeira pintura. Com o Google
// 3 s mais lento a primeira pintura saía em ~3,2 s (contra ~0,24 s); com o
// Google pendurado a tela não pintava nada em 15 s. A fonte agora mora na
// própria loja. Estes testes leem os arquivos do repositório (de propósito,
// sem subir navegador) e prendem que a dependência externa não volta.

const raiz = path.resolve(import.meta.dirname, "../..");
const ler = (relativo: string) =>
  readFileSync(path.resolve(raiz, relativo), "utf8");

// Comentário do HTML pode citar o domínio para explicar; só vale o que é tag.
const html = ler("index.html").replace(/<!--[\s\S]*?-->/g, "");
const css = ler("src/index.css");
const links = html.match(/<link\b[^>]*>/gi) ?? [];
const relDe = (tag: string) => /\brel\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
const hrefDe = (tag: string) => /\bhref\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
const ehDeOutroSite = (endereco: string) =>
  endereco.startsWith("http") || endereco.startsWith("//");

// Cada @font-face do CSS, sem o que vem depois do primeiro "}".
const blocosDeFonte = css
  .split("@font-face")
  .slice(1)
  .map((trecho) => trecho.slice(0, trecho.indexOf("}")));
const blocoDaInter = blocosDeFonte.find((bloco) =>
  /font-family:\s*["']?Inter["']?\s*;/i.test(bloco),
);

describe("primeira pintura não espera a fonte do Google", () => {
  it("o HTML não aponta para fonte nem folha de estilo do Google", () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });

  it("nenhuma folha de estilo do <head> vem de outro site (travaria a pintura)", () => {
    const externas = links.filter(
      (tag) => /stylesheet/i.test(relDe(tag)) && ehDeOutroSite(hrefDe(tag)),
    );
    expect(externas).toEqual([]);
  });

  it("a Inter é declarada em @font-face com swap, família 'Inter' e peso variável", () => {
    const bloco = blocoDaInter;
    expect(bloco, "falta o @font-face da Inter em src/index.css").toBeDefined();
    expect(bloco).toMatch(/font-display:\s*swap/);
    expect(bloco).toMatch(/font-weight:\s*100\s+900/);
    expect(bloco).toMatch(/format\(\s*["']woff2["']\s*\)/);
  });

  it("o arquivo da fonte existe no repositório e é um woff2 de verdade", () => {
    const url = /url\(([^)]+)\)/i
      .exec(blocoDaInter ?? "")?.[1]
      ?.replace(/["']/g, "")
      .trim();
    expect(
      url,
      "o @font-face da Inter precisa de um url() local",
    ).toBeDefined();
    expect(ehDeOutroSite(url ?? "")).toBe(false);
    const arquivo = path.resolve(raiz, "src", url ?? "");
    expect(existsSync(arquivo)).toBe(true);
    const cabecalho = readFileSync(arquivo).subarray(0, 4).toString("latin1");
    expect(cabecalho).toBe("wOF2");
  });

  it("o HTML NÃO pré-carrega a fonte: em 3G o preload atrasou a primeira pintura", () => {
    // Medido (Chromium, 3G rápida 1,6 Mbps e 3G lenta 400 kbps, CPU 4x, 7
    // rodadas): com preload a primeira pintura saiu ~0,35 s (3G rápida) e
    // ~0,6 s (3G lenta) depois; sem ele ficou igual ao que era com o Google.
    // O que o preload comprava (zerar o salto de layout da troca de fonte,
    // 0,0124 → 0) não paga isso. Quem medir diferente muda este teste.
    const preloads = links.filter((tag) => /preload/i.test(relDe(tag)));
    expect(preloads).toEqual([]);
  });

  it("a licença OFL da Inter acompanha o arquivo da fonte", () => {
    const licenca = ler("src/assets/fonts/OFL.txt");
    expect(licenca).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    expect(licenca).toMatch(/The Inter Project Authors/);
  });

  it("a splash (loading.css) continua chamando a fonte pelo mesmo nome, com fallback do sistema", () => {
    const loading = ler("public/loading.css");
    const familias = loading.match(/font-family:[^;]+;/g) ?? [];
    expect(familias.length).toBeGreaterThan(0);
    for (const familia of familias)
      expect(familia).toMatch(/"Inter",\s*-apple-system,\s*sans-serif/);
  });

  it("a política de segurança e o service worker aceitam a fonte própria", () => {
    const vercel = JSON.parse(ler("vercel.json")) as {
      headers: { headers: { key: string; value: string }[] }[];
    };
    const csp = vercel.headers
      .flatMap((grupo) => grupo.headers)
      .find((cabecalho) => cabecalho.key === "Content-Security-Policy")?.value;
    expect(csp).toMatch(/font-src[^;]*'self'/);
    // O precache do service worker guarda .woff2 (a fonte abre offline) e a
    // exclusão do admin não pega o arquivo da fonte (assets/inter-*.woff2).
    const vite = ler("vite.config.ts");
    expect(vite).toMatch(/globPatterns:\s*\[[^\]]*woff2/);
    const ignores = /globIgnores:\s*\[([^\]]*)\]/.exec(vite)?.[1] ?? "";
    expect(ignores).not.toMatch(/woff|inter/i);
  });
});
