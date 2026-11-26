// A marca do deploy no index.html (ressalva do revisor Opus no PR #1910,
// 26/11/2026): o build grava `VERCEL_DEPLOYMENT_ID` numa <meta>, e o porteiro
// só guarda em memória o HTML cuja marca é a do PRÓPRIO deploy. Aqui: o
// trecho puro (gravar e ler a marca) e o plugin do Vite que o build usa.
import type { Plugin } from "vite";
import { describe, expect, it } from "vitest";

import {
  deployDoHtml,
  idDoDeploy,
  marcarDeployNoHtml,
} from "@/hospedagem/marcaDoDeploy";
import { marcaDoDeployNoHtml } from "../../scripts/marcaDoDeployNoHtml";

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Loja Fixture</title>
</head>
<body><div id="root"></div></body>
</html>`;

const ID = "dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3";

describe("idDoDeploy — só um id de caracteres seguros vale", () => {
  it("aceita o formato da Vercel e tira espaço das pontas", () => {
    expect(idDoDeploy(ID)).toBe(ID);
    expect(idDoDeploy(`  ${ID}\n`)).toBe(ID);
  });

  it("ausente, vazio ou com caractere que quebraria o HTML = sem marca", () => {
    expect(idDoDeploy(undefined)).toBeNull();
    expect(idDoDeploy("")).toBeNull();
    expect(idDoDeploy("   ")).toBeNull();
    expect(idDoDeploy('dpl_"><script>')).toBeNull();
    expect(idDoDeploy("dpl 1")).toBeNull();
    expect(idDoDeploy("x".repeat(129))).toBeNull();
  });
});

describe("marcarDeployNoHtml + deployDoHtml", () => {
  it("grava a <meta> dentro do <head> e a lê de volta", () => {
    const marcado = marcarDeployNoHtml(HTML, ID);
    expect(marcado).toContain(`<meta name="ikcous-deploy" content="${ID}">`);
    expect(marcado.indexOf("ikcous-deploy")).toBeLessThan(
      marcado.indexOf("</head>"),
    );
    expect(deployDoHtml(marcado)).toBe(ID);
  });

  it("sem id válido o HTML sai byte a byte igual (build local, CI)", () => {
    expect(marcarDeployNoHtml(HTML, undefined)).toBe(HTML);
    expect(marcarDeployNoHtml(HTML, "")).toBe(HTML);
    expect(marcarDeployNoHtml(HTML, 'a"b')).toBe(HTML);
  });

  it("HTML sem <meta> não tem marca", () => {
    expect(deployDoHtml(HTML)).toBeNull();
  });

  it("marca duplicada ou com valor inválido não vale (nunca adivinha)", () => {
    const duas = marcarDeployNoHtml(marcarDeployNoHtml(HTML, ID), "dpl_outro");
    expect(deployDoHtml(duas)).toBeNull();
    const torta = HTML.replace(
      "</head>",
      '<meta name="ikcous-deploy" content="dpl outro">\n</head>',
    );
    expect(deployDoHtml(torta)).toBeNull();
  });
});

describe("plugin do Vite: o build grava o VERCEL_DEPLOYMENT_ID", () => {
  function transformar(plugin: Plugin, html: string): string {
    const gancho = plugin.transformIndexHtml as
      | ((html: string) => string)
      | { handler: (html: string) => string };
    return typeof gancho === "function" ? gancho(html) : gancho.handler(html);
  }

  it("com a variável da Vercel, o index.html sai marcado", () => {
    const html = transformar(
      marcaDoDeployNoHtml({ VERCEL_DEPLOYMENT_ID: ID }),
      HTML,
    );
    expect(deployDoHtml(html)).toBe(ID);
  });

  it("sem a variável (build local, CI), o index.html não muda", () => {
    expect(transformar(marcaDoDeployNoHtml({}), HTML)).toBe(HTML);
  });
});
