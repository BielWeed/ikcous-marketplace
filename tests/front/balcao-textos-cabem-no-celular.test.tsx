// @vitest-environment jsdom
//
// Balcão no celular estreito com a fonte do sistema em 130% (caça de 27/11/2026,
// 3 achados BAIXA). jsdom não mede layout: a prova de verdade, com Chromium e
// getBoundingClientRect, é a jornada `tests/e2e/jornada-balcao-textos-no-celular.spec.ts`.
// Aqui fica a guarda barata das REGRAS que aquela jornada mostrou serem as
// que resolvem, para um merge de classe ou uma edição do pdv.css não as
// apagar em silêncio:
// 1. o total do rodapé não encolhe abaixo do próprio número (entrava 19 px
//    por baixo do "Fechar venda" em 320 px);
// 2. os botões da janela "tem certeza?" quebram linha (o "Apagar e começar
//    outra" sem quebra fazia a janela rolar de lado, 40 px em 320 px);
// 3. a pergunta "Limpar a tela da venda?" sobe em tela baixa e os botões
//    ficam presos embaixo do aviso: o foco no "Voltar" não rola mais o título
//    e a pergunta para fora.
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
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
  // Caminho fixo do próprio projeto, não vem de fora.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  modulo._compile(readFileSync(caminho, "utf-8"), caminho);
  return modulo.exports;
}

const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

/** Declarações do pdv.css (sem comentários) de toda regra com exatamente
 * `seletor`, dentro do `@media` dado (ou fora de qualquer um). */
function declaracoes(seletor: string, media: string | null): string {
  const css = readFileSync("src/components/admin/pdv/pdv.css", "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const raiz = postcss.parse(css);
  const achadas: string[] = [];
  raiz.walkRules((regra) => {
    const pai = regra.parent;
    const mediaDoPai =
      pai?.type === "atrule" ? (pai as postcss.AtRule).params : null;
    if (regra.selector.replace(/\s+/g, " ").trim() !== seletor) return;
    if (mediaDoPai !== media) return;
    regra.walkDecls((d) => {
      achadas.push(`${d.prop}: ${d.value}`);
    });
  });
  return achadas.join("; ");
}

describe("Balcão no celular — o total, a janela e o aviso cabem", () => {
  describe("janela de confirmação (useConfirmarAcao)", () => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let confirmarDoGancho: ReturnType<typeof useConfirmarAcao>["confirmar"];

    beforeEach(() => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      act(() => raiz.unmount());
      hospedeiro.remove();
      vi.unstubAllGlobals();
    });

    async function botoesDaJanela() {
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
          titulo: "Apagar a venda em andamento?",
          texto: "Isso apaga a venda em andamento: 1 item, R$ 12.345,67.",
          verbo: "Apagar e começar outra",
          voltar: "Cancelar",
        });
      });
      const caixa = document.querySelector<HTMLElement>(
        '[data-testid="confirmar-acao"]',
      );
      if (!caixa) throw new Error("janela não abriu");
      return [...caixa.querySelectorAll("button")];
    }

    it("os dois botões quebram linha e crescem na altura, sem a trava de uma linha do Button", async () => {
      const botoes = await botoesDaJanela();
      expect(botoes.map((b) => b.textContent)).toEqual([
        "Cancelar",
        "Apagar e começar outra",
      ]);
      for (const botao of botoes) {
        const classes = botao.className.split(/\s+/);
        expect(classes, botao.textContent ?? "").toContain("whitespace-normal");
        expect(classes, botao.textContent ?? "").toContain("h-auto");
        // O tailwind-merge tira as classes do Button que travavam a linha.
        expect(classes, botao.textContent ?? "").not.toContain(
          "whitespace-nowrap",
        );
        expect(classes, botao.textContent ?? "").not.toContain("h-9");
      }
    });

    it("cada classe nova gera regra de CSS no Tailwind do projeto", async () => {
      const classes = [
        "whitespace-normal",
        "h-auto",
        "text-center",
        "[overflow-wrap:anywhere]",
      ];
      const resultado = await postcss([
        tailwindcss({
          ...carregarConfigDoProjeto(),
          content: [{ raw: classes.join(" "), extension: "html" }],
        }),
      ]).process("@tailwind utilities;", { from: undefined });
      expect(
        classes.filter((c) => !resultado.css.includes(`.${escapar(c)}`)),
      ).toEqual([]);
      expect(resultado.css).toContain("white-space: normal");
      expect(resultado.css).toContain("overflow-wrap: anywhere");
    });
  });

  it("o total do rodapé não encolhe abaixo da largura do próprio número", () => {
    expect(declaracoes(".pdv-footer", null)).toContain(
      "grid-template-columns: minmax(min-content, 1fr) minmax(0, 1.4fr)",
    );
  });

  it('os botões de "Limpar a tela da venda?" ficam presos embaixo do aviso', () => {
    const botoes = declaracoes(
      ".pdv-flow > .pdv-notice > .pdv-annul-actions",
      null,
    );
    expect(botoes).toContain("position: sticky");
    expect(botoes).toContain("bottom: 0");
    // Fundo do próprio aviso: o texto que rola passa POR TRÁS dos botões.
    expect(botoes).toContain("background: inherit");
  });

  it("em tela baixa o aviso sobe para perto do topo e ganha a altura que sobra", () => {
    const aviso = declaracoes(
      ".pdv-flow > .pdv-notice",
      "(max-height: 680px) and (max-width: 1023px)",
    );
    expect(aviso).toContain("top: 8px");
    expect(aviso).toContain(
      "max-height: calc(100% - var(--admin-tab-pb, 6.25rem) - 8px)",
    );
  });
});
