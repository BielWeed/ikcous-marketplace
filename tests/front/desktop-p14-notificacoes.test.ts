// @vitest-environment jsdom
/* eslint-disable security/detect-non-literal-fs-filename -- Fontes e configuração locais fixas, sem entrada externa. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Aviso } from "@/utils/avisos-do-lojista";
import { AdminNotificationsView } from "@/views/admin/AdminNotificationsView";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import tailwindcss from "tailwindcss";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

let avisos: Aviso[] = [];
let falha = true;
vi.mock("@/hooks/useAvisosDoLojista", () => ({
  useAvisosDoLojista: () => ({
    avisos,
    carregando: false,
    fontesComFalha: falha ? ["pedido"] : [],
    listasCortadas: ["estoque"],
    recarregar: vi.fn(),
  }),
}));
vi.mock("@/lib/novidades/armazenamento-local", () => ({
  useNovidadesDoAparelho: () => ({
    novidades: [
      {
        versao: "0.0.1",
        titulo: "Novidade fictícia",
        registradaEm: "2026-11-15T00:00:00Z",
        novidades: ["Exemplo de teste"],
        correcoes: [],
        melhorias: [],
        lida: false,
      },
    ],
    naoLidas: 1,
  }),
  marcarNovidadeComoLida: vi.fn(),
  marcarTodasComoLidas: vi.fn(),
}));

function ler(caminho: string) {
  return readFileSync(caminho, "utf8");
}
const fonte = ler("src/views/admin/AdminNotificationsView.tsx");
const conteudo =
  fonte.match(/className="(mx-auto max-w-3xl space-y-7[^"]*)"/)?.[1] ?? "";
let regras: Array<{ seletor: string; coluna: string }> = [];
const aliases = new Map<string, string>();

beforeAll(async () => {
  const requisitar = createRequire(import.meta.url);
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: fonte, extension: "tsx" }],
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  regras = [];
  css.root.walkRules((regra) => {
    if (
      regra.parent?.type !== "atrule" ||
      regra.parent.name !== "media" ||
      regra.parent.params !== "(min-width: 1280px)"
    )
      return;
    regra.walkDecls("grid-column", (declaracao) => {
      // O seletor do jsdom não reconhece classes escapadas com ">".
      // Só renomeamos classes, preservando os combinadores do CSS real.
      const seletor = selectorParser((seletores) => {
        seletores.walkClasses((classe) => {
          const original = classe.value;
          const alias = aliases.get(original) ?? `p14-css-${aliases.size}`;
          aliases.set(original, alias);
          classe.value = alias;
        });
      }).processSync(regra.selector);
      regras.push({ seletor, coluna: declaracao.value });
    });
  });
});

function valor(regra: RegExp, janela: number, inicial: number) {
  const breakpoints = new Map([
    ["lg", 1024],
    ["xl", 1280],
    ["2xl", 1536],
  ]);
  let resultado = inicial;
  for (const token of conteudo.split(" ")) {
    const partes = token.split(":");
    if (
      partes.length > 1 &&
      janela < (breakpoints.get(partes[0]) ?? Number.POSITIVE_INFINITY)
    ) {
      continue;
    }
    const encontrado = partes.at(-1)?.match(regra);
    if (encontrado) resultado = Number(encontrado[1]);
  }
  return resultado;
}

describe("P14 — Notificações no computador", () => {
  it("preserva classes de celular/tablet e alinha o cabeçalho ao corpo só no computador", () => {
    expect(classesDoCelular(conteudo)).toBe(
      "mx-auto max-w-3xl space-y-7 px-5 pb-6 pt-2",
    );
    // Celular: o cabeçalho é o mesmo de antes (px-5 fora, max-w-3xl dentro).
    expect(fonte).toContain(
      '<div className="sticky top-0 z-20 bg-background/95 px-5 pb-3 pt-4 backdrop-blur-xl lg:px-0">',
    );
    // PC: o cabeçalho usa a mesma caixa do corpo (max-w-7xl + px-6), para o
    // título começar no mesmo x do conteúdo.
    expect(fonte).toContain(
      '<div className="mx-auto max-w-3xl lg:max-w-7xl lg:px-6">',
    );
  });

  it("alarga a área útil e só divide a linha em xl, sem margens verticais da pilha", () => {
    expect(conteudo.split(" ")).toEqual(
      expect.arrayContaining([
        "lg:max-w-7xl",
        "lg:px-6",
        "xl:grid",
        "xl:grid-cols-2",
        "xl:items-start",
        "xl:gap-6",
        "xl:space-y-0",
      ]),
    );
    expect(conteudo).not.toMatch(/(?:^|\s)lg:grid(?:\s|-)/);
  });

  it.each([
    [1024, 1, 720],
    [1280, 2, 476],
    [1536, 2, 604],
    [1920, 2, 604],
  ])("em %i px usa %i coluna(s) de %i px", (janela, esperado, largura) => {
    const casca = ler("src/components/layouts/AdminLayout.tsx");
    expect(casca).toContain("hidden w-64 shrink-0");
    expect(casca).toContain(
      "relative mx-auto flex size-full max-w-7xl flex-col",
    );
    expect(conteudo).toContain("lg:max-w-7xl");
    const colunas = valor(/^grid-cols-(\d+)$/, janela, 1);
    const padding = valor(/^px-(\d+)$/, janela, 5) * 4;
    const gap = valor(/^gap-(\d+)$/, janela, 0) * 4;
    const cartao =
      (Math.min(janela - 256, 1280) - 2 * padding - (colunas - 1) * gap) /
      colunas;
    expect(colunas).toBe(esperado);
    expect(cartao).toBe(largura);
    expect(cartao).toBeGreaterThanOrEqual(420);
  });

  it.each([
    [true, true, 1, true],
    [true, false, 2, true],
    [false, true, 2, true],
    [false, false, 2, true],
    [false, false, 2, false],
  ])(
    "precisa=%s, olho=%s, span=%i, falha=%s: não deixa meia linha",
    (precisa, olho, span, comFalha) => {
      falha = comFalha;
      avisos = [
        ...(precisa
          ? [
              {
                id: "pedido-teste",
                tipo: "pedido" as const,
                titulo: "Pedido fictício",
                detalhe: "",
                quando: "",
                destino: { view: "admin-orders" as const },
                contaNoCracha: true,
              },
            ]
          : []),
        ...(olho
          ? [
              {
                id: "estoque-teste",
                tipo: "estoque" as const,
                titulo: "Estoque fictício",
                detalhe: "",
                quando: "",
                destino: { view: "admin-products" as const },
                contaNoCracha: false,
              },
            ]
          : []),
      ];
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        createElement(AdminNotificationsView, { onNavigate: vi.fn() }),
      );
      try {
        const grade = [...container.querySelectorAll("div")].find(
          (el) =>
            classesDoCelular(el.className) ===
            "mx-auto max-w-3xl space-y-7 px-5 pb-6 pt-2",
        );
        expect(grade).toBeDefined();
        expect(grade?.textContent?.includes("Tudo em dia")).toBe(
          !precisa && !olho && !comFalha,
        );
        for (const [original, alias] of aliases) {
          if (grade?.classList.contains(original)) grade.classList.add(alias);
        }
        const blocos = grade?.querySelectorAll("[data-bloco]") ?? [];
        expect(blocos).toHaveLength(Number(precisa) + Number(olho));
        for (const filho of grade?.children ?? []) {
          const aplicadas = regras.filter(({ seletor }) =>
            filho.matches(seletor),
          );
          expect(
            aplicadas.length,
            JSON.stringify({ regras, filho: filho.outerHTML.slice(0, 120) }),
          ).toBeGreaterThan(0);
          // A regra do par é mais específica que a regra universal de largura inteira.
          const umaColuna = aplicadas.some(
            ({ coluna }) => coluna === "span 1 / span 1",
          );
          expect(umaColuna ? 1 : 2).toBe(
            filho.hasAttribute("data-bloco") ? span : 2,
          );
        }
      } finally {
        container.replaceChildren();
      }
    },
  );
});
