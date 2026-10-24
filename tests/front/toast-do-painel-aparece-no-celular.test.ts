// @vitest-environment jsdom
//
// Os avisos (toast) do painel precisam aparecer no celular.
//
// O QUE QUEBROU: `src/index.css` esconde o toast do Sonner em telas <= 640 px
// SÓ na vitrine (ela tem o aviso no cabeçalho, a "Dynamic Island"). A regra
// dizia `body:not(.admin-mode)`, mas `admin-mode` mora na <html>
// (`useTemaDoPainelNaRaiz`), nunca no <body>. Resultado: `body:not(.admin-mode)`
// era SEMPRE verdadeiro, o toast ficava `display: none` no painel inteiro e o
// lojista não via "Acesso negado" nem nenhum outro aviso no celular.
//
// O QUE ESTE TESTE PROVA E O QUE NÃO PROVA:
//   a. o seletor da regra de esconder o toast usa `html:not(.admin-mode)`;
//   b. nenhum código põe `admin-mode` no <body> (se puser, a regra volta a
//      precisar do body);
//   c. com o seletor REAL do CSS e a classe posta pelo código REAL do painel, o
//      toast do painel NÃO casa com a regra e o da vitrine casa.
// NÃO prova: a media query (<= 640 px) nem a cascata (jsdom não avalia nenhuma
// das duas). Que o aviso aparece na tela do celular só o navegador prova.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê o código-fonte do próprio repositório (caminhos fixos); só leitura */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "postcss";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useTemaDoPainelNaRaiz } from "@/components/admin/temaDoPainel";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos outros testes de componente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = process.cwd();
const CSS = readFileSync(resolve(RAIZ, "src/index.css"), "utf8");

/** Seletores das regras que escondem o toast do Sonner dentro de media query de celular. */
function seletoresQueEscondemOToast(css: string): string[] {
  const achados: string[] = [];
  parse(css).walkAtRules("media", (media) => {
    if (!/max-width:\s*640px/.test(media.params)) return;
    media.walkRules((regra) => {
      if (!regra.selector.includes("data-sonner-toaster")) return;
      let esconde = false;
      regra.walkDecls("display", (d) => {
        if (d.value === "none") esconde = true;
      });
      if (esconde) achados.push(regra.selector);
    });
  });
  return achados;
}

/** Todo .ts/.tsx de src (sem node_modules; só leitura). */
function arquivosDeSrc(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) return arquivosDeSrc(caminho);
    return /\.(ts|tsx)$/.test(e.name) ? [caminho] : [];
  });
}

/** Linhas que põem `admin-mode` no <body> em vez da <html>. */
function poeAdminModeNoBody(fonte: string): string[] {
  return fonte
    .split("\n")
    .filter(
      (linha) =>
        /\bbody\b[^;\n]*\.(classList\.(add|toggle|replace)|className)[^;\n]*admin-mode/.test(
          linha,
        ) ||
        /\bbody\b[^\n]*setAttribute\(\s*["']class["'][^\n]*admin-mode/.test(
          linha,
        ),
    );
}

describe("toast do painel no celular — regra de esconder no CSS", () => {
  it("existe a regra que esconde o toast na vitrine (<= 640 px)", () => {
    expect(seletoresQueEscondemOToast(CSS).length).toBeGreaterThan(0);
  });

  it("nenhuma regra de esconder o toast usa body:not(.admin-mode)", () => {
    const ruins = seletoresQueEscondemOToast(CSS).filter((s) =>
      /body\s*:not\(\s*\.admin-mode\s*\)/.test(s),
    );
    expect(ruins).toEqual([]);
  });

  it("a regra usa html:not(.admin-mode) (onde a classe de fato mora)", () => {
    const seletores = seletoresQueEscondemOToast(CSS);
    expect(
      seletores.some((s) => /^html\s*:not\(\s*\.admin-mode\s*\)\s/.test(s)),
    ).toBe(true);
  });
});

describe("admin-mode mora na <html>, nunca no <body>", () => {
  it("controle: o detector pega as formas de pôr a classe no body e deixa a html passar", () => {
    expect(
      poeAdminModeNoBody('document.body.classList.add("admin-mode");'),
    ).toHaveLength(1);
    expect(
      poeAdminModeNoBody("document.body.classList.toggle('admin-mode', on);"),
    ).toHaveLength(1);
    expect(
      poeAdminModeNoBody('document.body.className = "x admin-mode";'),
    ).toHaveLength(1);
    expect(
      poeAdminModeNoBody('raiz.classList.add("admin-mode");'),
    ).toHaveLength(0);
    expect(
      poeAdminModeNoBody(
        'document.documentElement.classList.add("admin-mode");',
      ),
    ).toHaveLength(0);
  });

  it("nenhum arquivo de src põe admin-mode no body", () => {
    const culpados: string[] = [];
    for (const arquivo of arquivosDeSrc(resolve(RAIZ, "src"))) {
      const linhas = poeAdminModeNoBody(readFileSync(arquivo, "utf8"));
      if (linhas.length) culpados.push(`${arquivo}: ${linhas.join(" | ")}`);
    }
    expect(culpados).toEqual([]);
  });
});

describe("toast do painel no celular — o seletor REAL contra a <html> REAL", () => {
  afterEach(() => {
    document.documentElement.classList.remove("admin-mode");
    document.body.innerHTML = "";
  });

  it("controle: com a classe na <html> (o painel), o seletor antigo errava e o novo acerta", () => {
    document.documentElement.classList.add("admin-mode");
    const toast = document.createElement("section");
    toast.setAttribute("data-sonner-toaster", "");
    document.body.append(toast);

    // O seletor ANTIGO casava mesmo no painel (era o defeito): o body nunca
    // tem a classe, então `:not(.admin-mode)` sempre vale.
    expect(toast.matches("body:not(.admin-mode) [data-sonner-toaster]")).toBe(
      true,
    );
    // O seletor NOVO respeita a classe da <html>.
    expect(toast.matches("html:not(.admin-mode) [data-sonner-toaster]")).toBe(
      false,
    );
    document.documentElement.classList.remove("admin-mode");
    expect(toast.matches("html:not(.admin-mode) [data-sonner-toaster]")).toBe(
      true,
    );
  });

  it("com o CSS do projeto: o toast da vitrine casa com a regra e o do painel (classe posta pelo código real) não", () => {
    const seletores = seletoresQueEscondemOToast(CSS);
    expect(seletores.length).toBeGreaterThan(0);

    const toast = document.createElement("section");
    toast.setAttribute("data-sonner-toaster", "");
    document.body.append(toast);

    // Vitrine: sem admin-mode em lugar nenhum -> a regra deve esconder.
    expect(seletores.some((s) => toast.matches(s))).toBe(true);

    // Painel: o hook real do AdminLayout liga a classe na <html>.
    const hospedeiro = document.createElement("div");
    document.body.append(hospedeiro);
    const raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(
        createElement(() => {
          useTemaDoPainelNaRaiz();
          return null;
        }),
      );
    });
    expect(document.documentElement.classList.contains("admin-mode")).toBe(
      true,
    );
    expect(document.body.classList.contains("admin-mode")).toBe(false);
    expect(seletores.some((s) => toast.matches(s))).toBe(false);

    // Saiu do painel: a classe sai e o toast da vitrine volta a ser escondido.
    act(() => raiz.unmount());
    expect(seletores.some((s) => toast.matches(s))).toBe(true);
  });
});
