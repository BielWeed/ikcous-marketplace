// @vitest-environment jsdom
//
// Caça 11-A, achado 1: a janela "tem certeza?" do painel (useConfirmarAcao)
// encostava nas bordas do celular e, com texto longo, o título saía da tela
// sem como rolar. Causa: o `max-w-md` do gancho apagava (tailwind-merge) o
// `max-w-[calc(100%-2rem)]` da base — a margem lateral sumia — e não havia
// altura máxima. jsdom não vê layout: o teste prova (1) as classes que chegam
// ao elemento depois do merge e (2) que cada uma gera regra de CSS no Tailwind
// do projeto (classe inventada não dá erro, só não faz nada).
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmarAcao } from "@/hooks/useConfirmarAcao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const tailwindcss = require("tailwindcss");

function carregarConfigDoProjeto() {
  const caminho = resolve(__dirname, "../../tailwind.config.js");
  const modulo = new (Module as any)(caminho);
  modulo.filename = caminho;
  modulo.paths = (Module as any)._nodeModulePaths(dirname(caminho));
  modulo._compile(readFileSync(caminho, "utf-8"), caminho);
  return modulo.exports;
}

const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

describe("Janela de confirmação do painel — margem lateral e rolagem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmarDoGancho: ReturnType<typeof useConfirmarAcao>["confirmar"];

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function abrir() {
    function Tela() {
      const { confirmar, dialogo } = useConfirmarAcao();
      useEffect(() => {
        confirmarDoGancho = confirmar;
      });
      return dialogo;
    }
    await act(async () => raiz.render(createElement(Tela)));
    await act(async () => {
      void confirmarDoGancho({
        titulo: "Você já devolveu o dinheiro por fora?",
        texto: "Texto longo. ".repeat(60),
        verbo: "Já estornei",
      });
    });
    const caixa = document.querySelector<HTMLElement>(
      '[data-testid="confirmar-acao"]',
    );
    if (!caixa) throw new Error("janela não abriu");
    return caixa;
  }

  it("depois do merge, a caixa tem margem de 1rem de cada lado, largura máxima e rola", async () => {
    const classes = (await abrir()).className.split(/\s+/);
    expect(classes).toContain("w-[calc(100%-2rem)]");
    expect(classes).toContain("max-w-md");
    expect(classes).toContain("max-h-[calc(100dvh-2rem)]");
    expect(classes).toContain("overflow-y-auto");
    // A largura total (sem margem) é a que encostava nas bordas.
    expect(classes).not.toContain("w-full");
  });

  it("a descrição e os dois botões continuam dentro da caixa que rola", async () => {
    const caixa = await abrir();
    expect(caixa.textContent).toContain("Já estornei");
    expect(caixa.textContent).toContain("Voltar");
    expect(caixa.textContent).toContain("Você já devolveu");
  });

  it("cada classe nova gera regra de CSS no Tailwind do projeto", async () => {
    const classes = [
      "w-[calc(100%-2rem)]",
      "max-w-md",
      "max-h-[calc(100dvh-2rem)]",
      "overflow-y-auto",
    ];
    const resultado = await postcss([
      tailwindcss({
        ...carregarConfigDoProjeto(),
        content: [{ raw: classes.join(" "), extension: "html" }],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    expect(classes.filter((c) => !resultado.css.includes(`.${escapar(c)}`))).toEqual([]);
    expect(resultado.css).toContain("max-height: calc(100dvh - 2rem)");
    expect(resultado.css).toContain("width: calc(100% - 2rem)");
  });
});
