/* eslint-disable security/detect-non-literal-fs-filename -- Só lê public/ do repositório e o staging que o próprio prepareIdentityBuild cria e descarta. */
// A página "Sem internet" (public/offline.html) é cópia crua de public/ — e o
// build da identidade APOSENTA alguns arquivos de public/ (retiredPaths em
// scripts/prepareIdentity.ts: logo.svg, branding/logo.svg, ...). Uma imagem
// da página que aponte para um deles vira <img> quebrada: online o rewrite da
// SPA responde HTML no lugar da imagem, offline o precache não a tem.
//
// O confronto roda o preparo REAL da identidade sobre o public/ real e confere
// o que sobrou no diretório que o Vite publica — sem repetir a lista de
// aposentados aqui, que envelheceria calada.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";
import { prepareIdentityBuild } from "../../scripts/prepareIdentity";
import type { PreparedIdentityBuild } from "../../scripts/prepareIdentity";

const projeto = path.resolve(import.meta.dirname, "../..");
let preparado: PreparedIdentityBuild | undefined;

afterEach(async () => {
  await preparado?.dispose();
  preparado = undefined;
});

// Caminhos absolutos do próprio site que a página pede (src, href ou url()),
// sem query.
function arquivosPedidosPelaPagina(html: string): string[] {
  const achados = [
    ...html.matchAll(/\b(?:src|href)="(\/[^"?#]+)"/g),
    ...html.matchAll(/url\(\s*["']?(\/[^)"'?#]+)/g),
  ].map((m) => m[1]);
  return [...new Set(achados)];
}

// Os pedidos da página que NÃO existem no diretório que o Vite publica.
async function pedidosAusentesDoPublicado(html: string): Promise<string[]> {
  preparado ??= await prepareIdentityBuild({
    downloaded: await createIdentityBuildFixture("aurora"),
    commonPublicDir: path.join(projeto, "public"),
    code: { version: "1.0.0", sha: "a".repeat(40) },
  });
  const publicado = preparado.publicDir;
  const faltando: string[] = [];
  for (const pedido of arquivosPedidosPelaPagina(html)) {
    const existe = await fs
      .stat(path.join(publicado, pedido.slice(1)))
      .then((s) => s.isFile())
      .catch(() => false);
    if (!existe) faltando.push(pedido);
  }
  return faltando;
}

describe("public/offline.html só pede arquivo que o build publica", () => {
  it("cada arquivo que a página pede existe no diretório publicado (hoje ela não pede nenhum: passa vazio)", async () => {
    const html = await fs.readFile(
      path.join(projeto, "public/offline.html"),
      "utf8",
    );
    expect(await pedidosAusentesDoPublicado(html)).toEqual([]);
  });

  it("a página é neutra: sem logo, sem favicon e sem nada de /branding/ (é a mesma para toda a frota)", async () => {
    const html = await fs.readFile(
      path.join(projeto, "public/offline.html"),
      "utf8",
    );
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toContain("favicon");
    expect(html).not.toContain("/branding/");
  });

  // Controle: o defeito original, reintroduzido num texto, TEM de ser pego —
  // senão "passa vazio" acima provaria nada.
  it("controle: reintroduzir /branding/logo.svg é pego pelo confronto com o publicado", async () => {
    const html = '<img src="/branding/logo.svg" alt="">';
    expect(await pedidosAusentesDoPublicado(html)).toEqual([
      "/branding/logo.svg",
    ]);
  });

  it("controle: url() em CSS também é lido", async () => {
    const html = "<style>.x{background:url(/branding/logo.png)}</style>";
    expect(await pedidosAusentesDoPublicado(html)).toEqual([
      "/branding/logo.png",
    ]);
  });
});
