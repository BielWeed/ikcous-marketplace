// @vitest-environment jsdom
//
// Vitrines no celular: tudo que se toca tem 44 px de altura (ou uma área de
// toque de 44 px) e o texto de ajuda e os ícones têm contraste legível.
// O jsdom não calcula layout, então a prova aqui é a classe que GERA a medida
// (`min-h-11`, `size-11`, a área extra do `before:`); a medida em pixels foi
// conferida no navegador real (relato do lote).
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
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
const { FolhaEditarVitrine } = await import(
  "@/components/admin/vitrines/FolhaEditarVitrine"
);
const { FolhaNovaVitrine } = await import(
  "@/components/admin/vitrines/FolhaNovaVitrine"
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

const botoes = () => [
  ...document.querySelectorAll<HTMLButtonElement>("button"),
];
const botao = (texto: string) => {
  const achado = botoes().find((b) => b.textContent?.trim() === texto);
  if (!achado) throw new Error(`sem botão "${texto}"`);
  return achado;
};

const SECAO = {
  id: "custom_1",
  title: "Kits de presente",
  active: false,
  maxItems: 6,
  productIds: [],
  isCustom: true,
};

describe("Vitrines: alvos de toque de 44 px", () => {
  it("as ideias de nome da nova vitrine têm 44 px de altura", async () => {
    await act(async () => {
      raiz.render(
        <FolhaNovaVitrine
          titulo=""
          aoMudarTitulo={() => {}}
          aoCriar={() => {}}
          aoFechar={() => {}}
          criando={false}
        />,
      );
    });
    const ideias = botoes().filter((b) =>
      ["Kits de Presente", "Linha Skincare"].includes(b.textContent ?? ""),
    );
    expect(ideias).toHaveLength(2);
    for (const ideia of ideias) {
      expect(ideia.className).toContain("min-h-11");
      expect(ideia.className).not.toMatch(/(^|\s)h-8(\s|$)/);
    }
  });

  it("'Quantos produtos' e 'Automático / Escolher' têm 44 px de altura", async () => {
    await act(async () => {
      raiz.render(
        <FolhaEditarVitrine
          secao={SECAO}
          posicao={1}
          produtos={[]}
          idsEmExibicao={[]}
          aoFechar={() => {}}
          aoRenomear={async () => true}
          aoMudarQuantidade={() => {}}
          aoAlternarProduto={() => {}}
          aoVoltarAoAutomatico={() => {}}
          aoEscolherManualmente={() => {}}
        />,
      );
    });
    const quantidades = botoes().filter((b) =>
      ["4", "6", "8", "10", "12"].includes(b.textContent?.trim() ?? ""),
    );
    expect(quantidades.length).toBeGreaterThan(1);
    for (const b of [...quantidades, botao("Automático"), botao("Escolher")]) {
      expect(b.className).toContain("min-h-11");
      expect(b.className).not.toMatch(/(^|\s)h-9(\s|$)/);
    }
  });

  it("o texto de ajuda do painel usa um cinza de contraste legível (>= 4,5:1)", async () => {
    await act(async () => {
      raiz.render(
        <FolhaEditarVitrine
          secao={SECAO}
          posicao={1}
          produtos={[]}
          idsEmExibicao={[]}
          aoFechar={() => {}}
          aoRenomear={async () => true}
          aoMudarQuantidade={() => {}}
          aoAlternarProduto={() => {}}
          aoVoltarAoAutomatico={() => {}}
          aoEscolherManualmente={() => {}}
        />,
      );
    });
    const ajuda = [...document.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Hoje a loja escolhe sozinha"),
    );
    expect(ajuda).toBeTruthy();
    // zinc-500 sobre o fundo do painel (zinc-950) mede 4,12:1; zinc-400, 7,6:1.
    expect(ajuda?.className).toContain("text-zinc-400");
    expect(ajuda?.className).not.toContain("text-zinc-500");
  });

  it("no cartão, a alça tem área de toque de 44 px e ícone legível; as setas têm 44 px", async () => {
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
    const alca = document.querySelector<HTMLButtonElement>(
      '[aria-label^="Arrastar vitrine"]',
    );
    expect(alca).toBeTruthy();
    // Área extra por um pseudo-elemento: 24x36 do desenho + 10 px de cada lado
    // e 4 px em cima e embaixo = 44x44 de toque, sem empurrar o título.
    expect(alca?.className).toContain("before:-inset-x-2.5");
    expect(alca?.className).toContain("before:-inset-y-1");
    expect(alca?.className).toMatch(/(^|\s)relative(\s|$)/);
    expect(alca?.className).toContain("text-zinc-400");
    expect(alca?.className).not.toContain("text-zinc-600");
    for (const rotulo of [/^Subir vitrine/, /^Descer vitrine/]) {
      const seta = [...document.querySelectorAll("button")].find((b) =>
        rotulo.test(b.getAttribute("aria-label") ?? ""),
      );
      expect(seta?.className).toContain("size-11");
    }
    // "oculta da loja" (vitrine desligada) também era cinza demais.
    const oculta = [...document.querySelectorAll("span")].find((s) =>
      s.textContent?.includes("oculta da loja"),
    );
    expect(oculta?.className).toContain("text-zinc-400");
  });
});
