// @vitest-environment jsdom
//
// P43 — alvo de toque pequeno no tablet (768 a 1023 px), medido em Chromium:
// Painel > Vitrines: o interruptor "Exibir na loja" tinha 44x26 px sem área
// extra; 1 px fora da borda vertical o toque caía no botão "Editar vitrine"
// (que fica atrás) e abria a edição em vez de ligar/desligar.
//
// (O X de "Limpar busca" também media 28x36 px no tablet, mas ampliá-lo na
// horizontal repete a regressão do laudo M1 de 07/09: o toque no fim do campo
// apagaria o texto. Fica como está de propósito.)
//
// A correção só ACRESCENTA classes com prefixo `md:` (tablet e acima), e só na
// VERTICAL. O celular (abaixo de 768 px) fica com as mesmas classes de antes:
// elas estão congeladas aqui como literal. O jsdom não calcula layout, então a
// medida em pixels foi conferida no Chromium (relato do lote); o que se prova
// aqui é a classe que GERA a medida, no componente de verdade, e que o
// Tailwind do projeto transforma essas classes em CSS na largura certa.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss, { type AtRule, type Declaration } from "postcss";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import tailwindcss from "tailwindcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O Reorder do framer-motion precisa de um grupo e de ponteiro de verdade.
vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    Reorder: {
      Group: (props: { children: React.ReactNode }) =>
        createElement("div", null, props.children),
      Item: (props: { children: React.ReactNode }) =>
        createElement("div", null, props.children),
    },
  };
});

const { CartaoDaVitrine } = await import(
  "@/components/admin/vitrines/CartaoDaVitrine"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;

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

const fichas = (el: Element | null) =>
  (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

// Tudo que NÃO tem prefixo de largura: é o que o celular enxerga (e o desktop
// também). Se alguém mexer num token sem prefixo, o congelamento abaixo cai.
const semPrefixoDeLargura = (lista: string[]) =>
  lista.filter((t) => !/^(?:sm|md|lg|xl|2xl|max-[a-z0-9]+):/.test(t));
const comPrefixoMd = (lista: string[]) =>
  lista.filter((t) => t.startsWith("md:"));

const SECAO = {
  id: "custom_1",
  title: "Kits de presente",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: true,
};

describe("P43 — interruptor de exibir/ocultar a vitrine", () => {
  async function interruptor() {
    await act(async () => {
      raiz.render(
        <CartaoDaVitrine
          secao={SECAO}
          indice={1}
          total={3}
          produtosEmExibicao={[]}
          aoAbrir={() => {}}
          aoAlternarAtiva={() => {}}
          aoMover={() => {}}
          aoSoltar={() => {}}
          aoAlterarLayout={() => {}}
          travado={false}
        />,
      );
    });
    const el = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Exibir na loja:"]',
    );
    expect(el).toBeTruthy();
    return el as HTMLButtonElement;
  }

  it("celular: as classes sem prefixo continuam exatamente as de antes", async () => {
    const lista = fichas(await interruptor());
    // As do componente base do Switch + as que o cartão passa.
    expect(semPrefixoDeLargura(lista)).toEqual([
      "peer",
      "focus-visible:border-ring",
      "focus-visible:ring-ring/50",
      "dark:data-[state=unchecked]:bg-input/80",
      "inline-flex",
      "shrink-0",
      "items-center",
      "rounded-full",
      "border",
      "border-transparent",
      "shadow-xs",
      "transition-all",
      "outline-none",
      "focus-visible:ring-[3px]",
      "disabled:cursor-not-allowed",
      "disabled:opacity-50",
      "pointer-events-auto",
      "h-[26px]",
      "w-11",
      "data-[state=checked]:bg-foreground",
      "data-[state=unchecked]:bg-zinc-700",
      "[&>span]:ml-0.5",
      "[&>span]:size-5",
      "[&>span]:data-[state=checked]:translate-x-[18px]",
    ]);
  });

  it("tablet: ganha área de toque de 42 px na VERTICAL, sem mexer no tamanho nem na largura", async () => {
    const lista = fichas(await interruptor());
    expect(comPrefixoMd(lista).sort()).toEqual(
      [
        "md:relative",
        "md:after:absolute",
        "md:after:-inset-y-2",
        "md:after:inset-x-0",
        "md:after:content-['']",
      ].sort(),
    );
    // 26 + 2 x 8 = 42 px (>= 40). Largura segue 44 (w-11): o botão "Editar
    // vitrine" fica clicável em todo o resto do cartão.
    expect(lista.some((t) => /^md:(?:h|w|size|min-h)-/.test(t))).toBe(false);
  });
});

describe("P43 — o Tailwind do projeto gera o CSS nas larguras certas", () => {
  const requisitar = createRequire(import.meta.url);
  // Devolve, por seletor de classe, as condições de @media que o envolvem
  // (de fora para dentro) e as declarações.
  async function compilar(candidatas: string[]) {
    const carregar = requisitar("tailwindcss/loadConfig") as (
      caminho: string,
    ) => Record<string, unknown>;
    const config = carregar(resolve("tailwind.config.js"));
    const css = readFileSync("src/index.css", "utf8");
    const resultado = await postcss([
      tailwindcss({
        ...config,
        content: [{ raw: candidatas.join(" "), extension: "html" }],
      }),
    ]).process(css, { from: "src/index.css" });
    const regras = new Map<string, { medias: string[]; decl: string }>();
    resultado.root.walkRules((regra) => {
      const medias: string[] = [];
      let no = regra.parent;
      while (no && no.type !== "root") {
        if (no.type === "atrule") medias.unshift((no as AtRule).params);
        no = no.parent;
      }
      regras.set(regra.selector, {
        medias,
        decl: (regra.nodes ?? [])
          .map((d) => `${(d as Declaration).prop}:${(d as Declaration).value}`)
          .join(";"),
      });
    });
    return regras;
  }

  it("controle: classe inventada não gera CSS", async () => {
    const regras = await compilar([
      "md:after:-inset-x-9999",
      "md:after:-inset-y-2",
    ]);
    expect([...regras.keys()].some((s) => s.includes("9999"))).toBe(false);
    expect(regras.has(".md\\:after\\:-inset-y-2::after")).toBe(true);
  }, 60_000);

  it("o interruptor vale de 768 px para cima", async () => {
    const regras = await compilar([
      "md:after:-inset-y-2",
      "md:after:inset-x-0",
    ]);
    const chave = regras.get(".md\\:after\\:-inset-y-2::after");
    expect(chave?.medias).toEqual(["(min-width: 768px)"]);
    expect(chave?.decl).toContain("top:-0.5rem");
    expect(chave?.decl).toContain("bottom:-0.5rem");
  }, 60_000);
});
