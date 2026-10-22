// @vitest-environment jsdom
//
// O coração dos cards aparecia torto (descentralizado no círculo, borda
// estranha sobre foto clara). jsdom não mede layout; este teste trava a
// ESTRUTURA que garante o centro: grade com place-items-center, tamanho
// fixo de 44px, sem deslocamento no botão nem no ícone, fundo opaco.
// A medida em pixels foi feita em navegador real (ver o commit).
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotaoDeFavorito } from "@/components/ui/custom/BotaoDeFavorito";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function montar(favorito: boolean, onClick = vi.fn()) {
  act(() => {
    root.render(
      <BotaoDeFavorito nome="Camiseta" favorito={favorito} onClick={onClick} />,
    );
  });
  return container.querySelector("button") as HTMLButtonElement;
}

describe("BotaoDeFavorito — estrutura que mantém o coração no centro", () => {
  it("é uma grade centralizada de 44px, redonda e sem deslocamento", () => {
    const botao = montar(false);
    const classes = botao.className.split(/\s+/);
    expect(classes).toContain("grid");
    expect(classes).toContain("place-items-center");
    expect(classes).toContain("size-11");
    expect(classes).toContain("rounded-full");
    expect(classes).toContain("shrink-0");
    // Nada que empurre o conteúdo: padding, margem ou translate no botão.
    for (const c of classes) {
      expect(c).not.toMatch(/^(p|px|py|pl|pr|pt|pb|m|ml|mr|mt|mb)-/);
      expect(c).not.toMatch(/translate/);
    }
  });

  it("fundo opaco: sem transparência nem desfoque que mudem com a foto", () => {
    const botao = montar(false);
    expect(botao.className).not.toMatch(
      /glass|backdrop|bg-white\/|bg-background\//,
    );
    expect(botao.className).toContain("bg-white");
  });

  it("o ícone é o único filho, escondido do leitor de tela e sem deslocamento", () => {
    const botao = montar(false);
    expect(botao.children).toHaveLength(1);
    const icone = botao.firstElementChild as SVGElement;
    expect(icone.tagName.toLowerCase()).toBe("svg");
    expect(icone.getAttribute("aria-hidden")).toBe("true");
    expect(icone.getAttribute("class")).not.toMatch(
      /translate|(^|\s)-?m[lrtb]?-/,
    );
  });

  it("nome acessível e estado marcado/desmarcado", () => {
    expect(montar(false).getAttribute("aria-label")).toBe(
      "Adicionar Camiseta aos favoritos",
    );
    const marcado = montar(true);
    expect(marcado.getAttribute("aria-label")).toBe(
      "Remover Camiseta dos favoritos",
    );
    expect(marcado.firstElementChild?.getAttribute("class")).toContain(
      "fill-current",
    );
    expect(
      montar(false).firstElementChild?.getAttribute("class"),
    ).not.toContain("fill-current");
  });

  it("tem foco visível e dispara o clique sem propagar para o card", () => {
    const onClick = vi.fn();
    const pai = vi.fn();
    document.body.addEventListener("click", pai);
    const botao = montar(false, onClick);
    expect(botao.className).toContain("focus-visible:ring-2");
    act(() => botao.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", pai);
    expect(pai).not.toHaveBeenCalled();
  });
});

describe("BotaoDeFavorito — marca neutra, sem vermelho", () => {
  it("preto nos dois estados; só o preenchimento diferencia", () => {
    for (const marcado of [true, false]) {
      const botao = montar(marcado);
      expect(botao.className).toContain("text-zinc-950");
      expect(botao.className).not.toMatch(/red|rose/);
      expect(botao.firstElementChild?.getAttribute("class")).not.toMatch(
        /red|rose/,
      );
    }
  });
});

describe("Favoritos: a folha de estilo da tela não mexe no botão do coração", () => {
  it("as regras de botão genérico excluem o coração", () => {
    const css = readFileSync("src/views/customer/FavoritesView.css", "utf8");
    expect(css).toMatch(
      /\.favorites-product-card button:not\(\[data-botao-favorito\]\)\s*\{/,
    );
    expect(css).toMatch(
      /\.favorites-product-card button\[title\]:not\(\[data-botao-favorito\]\)\s*\{/,
    );
  });
});
