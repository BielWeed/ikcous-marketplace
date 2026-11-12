// @vitest-environment jsdom
//
// O checkout da vitrine é de tema CLARO (fundo branco). O painel de recusa
// nasceu com cores de tema ESCURO (`text-amber-200` sobre `bg-amber-500/10`),
// que sobre branco dão ~1,1:1: a pessoa com o pedido recusado não conseguia LER
// por que — e a frase do banco é a única coisa na tela que explica o que houve.
//
// Em vez de prender uma lista de classes (que concordaria com qualquer escolha),
// o teste calcula a razão de contraste WCAG real a partir das classes que o
// componente renderiza, contra o fundo claro em que ele de fato aparece.
import { SaidaDaRecusa } from "@/components/ui/custom/SaidaDaRecusa";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros arquivos de `tests/front/` que montam com `createRoot`.
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

// Paleta `amber` do Tailwind (hex). Escrita à mão: derivá-la do build faria o
// teste concordar consigo mesmo.
const AMBER: Record<string, string> = {
  "50": "#fffbeb",
  "100": "#fef3c7",
  "200": "#fde68a",
  "300": "#fcd34d",
  "400": "#fbbf24",
  "500": "#f59e0b",
  "600": "#d97706",
  "700": "#b45309",
  "800": "#92400e",
  "900": "#78350f",
};
const BRANCO: Rgb = [255, 255, 255];

type Rgb = [number, number, number];

const hexParaRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

// Cor com opacidade (`/10`, `/90`) composta sobre o que está atrás dela.
const compor = (frente: Rgb, alfa: number, atras: Rgb): Rgb => [
  Math.round(frente[0] * alfa + atras[0] * (1 - alfa)),
  Math.round(frente[1] * alfa + atras[1] * (1 - alfa)),
  Math.round(frente[2] * alfa + atras[2] * (1 - alfa)),
];

// Luminância relativa e razão de contraste, como na WCAG 2.x.
const luminancia = ([r, g, b]: Rgb): number => {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
};
const razao = (a: Rgb, b: Rgb): number => {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return ((claro ?? 0) + 0.05) / ((escuro ?? 0) + 0.05);
};

// Lê `prefixo-amber-NNN` (com `/NN` opcional) das classes e devolve a cor já
// composta sobre `atras`. Sem a classe, o teste falha em vez de supor uma cor.
const corDaClasse = (
  classes: string,
  prefixo: "text" | "bg",
  atras: Rgb,
): Rgb => {
  const inicio = `${prefixo}-amber-`;
  const token = classes.split(/\s+/).find((c) => c.startsWith(inicio));
  expect(token, `sem ${inicio}* em "${classes}"`).toBeDefined();
  const [tom, opacidade] = (token as string).slice(inicio.length).split("/");
  const hex = AMBER[tom ?? ""];
  expect(hex, `tom amber-${tom} fora da tabela do teste`).toBeDefined();
  const alfa = opacidade ? Number(opacidade) / 100 : 1;
  return compor(hexParaRgb(hex as string), alfa, atras);
};

const montar = () => {
  act(() => {
    root.render(
      <SaidaDaRecusa
        recusa={{
          acao: "ajustar_estoque",
          mensagem: 'Só restam 2 unidades de "Camiseta Exemplo".',
          produto: "Camiseta Exemplo",
          disponivel: 2,
        }}
        onAgir={() => {}}
        onFechar={() => {}}
      />,
    );
  });
  const painel = container.querySelector('[role="alert"]') as HTMLElement;
  const texto = (trecho: string) =>
    Array.from(painel.querySelectorAll("p")).find((p) =>
      p.textContent?.includes(trecho),
    ) as HTMLElement;
  return {
    painel,
    titulo: texto("Não deu para fechar o pedido"),
    frase: texto("Só restam 2 unidades"),
    detalhe: texto("Ainda há 2"),
    icone: painel.querySelector("svg") as SVGElement,
    fechar: painel.querySelector(
      'button[aria-label="Fechar o aviso"]',
    ) as HTMLElement,
  };
};

describe("SaidaDaRecusa — contraste no checkout de fundo claro", () => {
  it("título, frase do banco e detalhe do estoque passam de 4,5:1", () => {
    const { painel, titulo, frase, detalhe } = montar();
    expect(titulo && frase && detalhe).toBeTruthy();

    // O painel aparece sobre o branco do checkout (ou o cinza claro das seções
    // vizinhas): a cor dele é composta sobre a base e o texto, sobre o painel.
    for (const base of [BRANCO, hexParaRgb("#f9fafb")]) {
      const fundo = corDaClasse(painel.className, "bg", base);
      for (const [nome, el] of [
        ["título", titulo],
        ["frase do banco", frase],
        ["detalhe do estoque", detalhe],
      ] as const) {
        const texto = corDaClasse(el.className, "text", fundo);
        expect(
          razao(texto, fundo),
          `${nome} sobre o painel (${el.className})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("ícone e botão de fechar passam de 3:1 (elemento gráfico)", () => {
    const { painel, icone, fechar } = montar();
    const fundo = corDaClasse(painel.className, "bg", BRANCO);

    const classeDoIcone = icone.getAttribute("class") ?? "";
    expect(
      razao(corDaClasse(classeDoIcone, "text", fundo), fundo),
      `ícone (${classeDoIcone})`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      razao(corDaClasse(fechar.className, "text", fundo), fundo),
      `botão de fechar (${fechar.className})`,
    ).toBeGreaterThanOrEqual(3);
  });
});
