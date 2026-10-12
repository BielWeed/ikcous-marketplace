// @vitest-environment jsdom
//
// ONDA K, frente K-A — casca do painel: letra, cabeçalho e toque.
//
// O render da onda J2 (Chromium simulado, 360–1280px; não é aparelho real)
// mediu: texto de 9–10px no topo e no menu do painel, o cabeçalho móvel
// translúcido (95% + blur: a lista rolando por baixo aparecia atrás dos
// títulos), pontos do carrossel de métricas com 24x44 de toque e o
// "Exibindo 1 - 24 de 1289" sem milhar, em 10px, com botões de 40px.
//
//   a. `AdminLayout.tsx` não tem texto de 6 a 10,5px fora de comentário
//      (o arquivo fica fora da régua visual: este teste é a única guarda);
//   b. a tag `<header` móvel é sólida: `bg-zinc-950` sem `/95` e sem blur
//      (é `sticky`, a lista rola por baixo — mesmo caso da barra inferior);
//   c. os pontos do carrossel têm alvo de 44x44 (`size-11`, que o eslint prefere a `h-11 w-11`); o ponto
//      visível por dentro não muda;
//   d. a paginação mostra o milhar em pt-BR, em 11px, com botões de 44px.
//
// O jsdom não aplica CSS: onde a prova é de toque/layout, a asserção é sobre
// classe. A medida real é do render do integrador.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê o código-fonte do próprio repositório (caminho constante, não entrada de usuário); só leitura */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { BarChart3 } from "lucide-react";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const emblaFalso = vi.hoisted(() => {
  const grupos = [0, 1, 2];
  const api = {
    on: () => api,
    off: () => api,
    reInit: () => {},
    selectedScrollSnap: () => 0,
    scrollSnapList: () => grupos,
    canScrollPrev: () => false,
    canScrollNext: () => true,
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
    scrollTo: vi.fn(),
  };
  return { api, ref: () => {} };
});

vi.mock("embla-carousel-react", () => ({
  default: () => [emblaFalso.ref, emblaFalso.api],
}));

const lerFonte = (caminho: string) =>
  readFileSync(resolve(process.cwd(), caminho), "utf8");

const LETRA_MIUDA = /text-\[(?:6|7|8|9|10)(?:\.5)?px\]/;

describe("AdminLayout — topo e menu sem letra miúda", () => {
  it("nenhuma linha de código tem texto de 6 a 10,5px", () => {
    const linhas = lerFonte("src/components/layouts/AdminLayout.tsx").split(
      "\n",
    );
    const achadas = linhas
      .map((texto, i) => ({ n: i + 1, texto }))
      .filter(
        ({ texto }) =>
          !/^\s*(\/\/|\/\*|\*)/.test(texto) && LETRA_MIUDA.test(texto),
      )
      .map(({ n }) => n);
    expect(achadas).toEqual([]);
  });
});

describe("AdminLayout — cabeçalho móvel sólido", () => {
  it("a tag <header> usa bg-zinc-950 sem /95 e sem backdrop-blur", () => {
    const fonte = lerFonte("src/components/layouts/AdminLayout.tsx");
    const inicio = fonte.indexOf("<header");
    expect(inicio).toBeGreaterThan(-1);
    const tag = fonte.slice(inicio, fonte.indexOf(">", inicio));
    const classes = /className="([^"]*)"/.exec(tag)?.[1] ?? "";
    expect(classes).toMatch(/(^|\s)bg-zinc-950(\s|$)/);
    expect(classes).not.toContain("bg-zinc-950/");
    expect(classes).not.toContain("#09090b");
    expect(classes).not.toContain("backdrop-blur");
    expect(classes).toContain("border-b border-white/5");
    expect(classes).toContain("shadow-md");
  });
});

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("AdminKpiCarousel — pontos com alvo de 44x44", () => {
  it("cada ponto tem size-11 (44x44), e a bolinha visível por dentro não muda", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    const cards: readonly KpiCardConfig[] = [
      { id: "a", label: "Pedidos hoje", value: 3, icon: BarChart3 },
      { id: "b", label: "Produtos", value: 19, icon: BarChart3 },
      { id: "c", label: "Clientes", value: 7, icon: BarChart3 },
    ];
    await act(async () => {
      raiz.render(<AdminKpiCarousel cards={cards} title="Métricas" />);
    });
    const pontos = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Mostrar o grupo"]',
      ),
    );
    expect(pontos).toHaveLength(3);
    for (const ponto of pontos) {
      expect(ponto.className).toContain("size-11");
    }
    // O desenho visível continua pequeno: ativo w-4, os demais w-1, altura h-1.
    const visiveis = pontos.map(
      (p) => p.querySelector("span")?.className ?? "",
    );
    expect(visiveis[0]).toContain("w-4");
    expect(visiveis[1]).toContain("w-1");
    for (const v of visiveis) expect(v).toContain("h-1");
  });
});

describe("PaginacaoAdmin — milhar pt-BR, 11px e botões de 44px", () => {
  it("1289 itens viram 'Exibindo 1 - 24 de 1.289', em 11px, com botões h-11", () => {
    act(() => {
      raiz.render(
        <PaginacaoAdmin
          pagina={0}
          totalPaginas={54}
          totalItens={1289}
          itensPorPagina={24}
          aoMudar={() => {}}
        />,
      );
    });
    const p = hospedeiro.querySelector("p");
    expect(p?.textContent).toBe("Exibindo 1 - 24 de 1.289");
    expect(p?.className).toContain("text-[11px]");
    expect(p?.className).not.toContain("text-[10px]");
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    expect(botoes).toHaveLength(2);
    for (const b of botoes) {
      expect(b.className).toMatch(/(^|\s)h-11(\s|$)/);
      expect(b.className).not.toMatch(/(^|\s)h-10(\s|$)/);
    }
  });

  it("a janela da última página também usa o milhar", () => {
    act(() => {
      raiz.render(
        <PaginacaoAdmin
          pagina={53}
          totalPaginas={54}
          totalItens={1289}
          itensPorPagina={24}
          aoMudar={() => {}}
        />,
      );
    });
    expect(hospedeiro.querySelector("p")?.textContent).toBe(
      "Exibindo 1.273 - 1.289 de 1.289",
    );
  });
});
