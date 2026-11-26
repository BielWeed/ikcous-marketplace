// @vitest-environment jsdom
//
// O cartão de UMA vitrine, nas bordas que a tela inteira não exercita:
//
// - miniaturas: cabem 5 na linha; o resto vira "+N" (e com 5 exatos não há "+0");
// - setas: a primeira não sobe, a última não desce, uma só não anda, e com a
//   gravação da ordem em andamento nenhuma anda (o toque não chega à tela);
// - o foco volta à seta que a lojista usou (só se ela estava com o foco) quando
//   a gravação termina e o cartão muda de lugar;
// - o desenho do layout "Padrão" é o de Ofertas só na vitrine de Ofertas;
// - sem produtos escolhidos o cartão diz "automático".
import type { Product } from "@/types";
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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const produto = (n: number) =>
  ({
    id: `p${n}`,
    name: `Produto ${n}`,
    price: 10,
    category: "",
    images: [],
    isActive: true,
  }) as unknown as Product;

const aoMover = vi.fn();

interface Opcoes {
  indice?: number;
  total?: number;
  travado?: boolean;
  produtos?: number;
  catalogoFora?: boolean;
  secao?: Record<string, unknown>;
  escolhidos?: number;
}

function cartao(o: Opcoes = {}) {
  return (
    <CartaoDaVitrine
      secao={
        {
          id: "custom_1",
          title: "Kits de presente",
          active: true,
          maxItems: 6,
          productIds: [],
          isCustom: true,
          ...o.secao,
        } as never
      }
      indice={o.indice ?? 0}
      total={o.total ?? 1}
      produtosEmExibicao={Array.from({ length: o.produtos ?? 0 }, (_, i) =>
        produto(i + 1),
      )}
      escolhidos={o.escolhidos}
      aoAbrir={() => {}}
      aoAlternarAtiva={() => {}}
      aoMover={aoMover}
      aoSoltar={() => {}}
      aoAlterarLayout={() => {}}
      travado={o.travado ?? false}
      catalogoFora={o.catalogoFora}
    />
  );
}

async function mostrar(o: Opcoes = {}) {
  aoMover.mockReset();
  await act(async () => {
    raiz.render(cartao(o));
  });
}

const porRotulo = (rotulo: string) =>
  hospedeiro.querySelector(`[aria-label="${rotulo}"]`) as HTMLButtonElement;
const subir = () => porRotulo("Subir vitrine Kits de presente");
const descer = () => porRotulo("Descer vitrine Kits de presente");
const miniaturas = () =>
  hospedeiro.querySelectorAll("[data-miniaturas] [title]");
const textoDoMais = () =>
  [...hospedeiro.querySelectorAll("[data-miniaturas] span")]
    .map((s) => s.textContent?.trim() ?? "")
    .filter((t) => t.startsWith("+"));

describe("CartaoDaVitrine — miniaturas", () => {
  it("5 produtos: as 5 aparecem e não existe '+0'", async () => {
    await mostrar({ produtos: 5 });
    expect(miniaturas()).toHaveLength(5);
    expect(textoDoMais()).toEqual([]);
  });

  it("6 produtos: 5 miniaturas e '+1'", async () => {
    await mostrar({ produtos: 6 });
    expect(miniaturas()).toHaveLength(5);
    expect(textoDoMais()).toEqual(["+1"]);
  });

  it("8 produtos: 5 miniaturas e '+3'", async () => {
    await mostrar({ produtos: 8 });
    expect(miniaturas()).toHaveLength(5);
    expect(textoDoMais()).toEqual(["+3"]);
  });

  it("nenhum produto: 'Sem produtos'; com o catálogo ainda sem ler, só um traço", async () => {
    await mostrar({ produtos: 0 });
    expect(hospedeiro.querySelector("[data-miniaturas]")?.textContent).toBe(
      "Sem produtos",
    );
    await mostrar({ produtos: 0, catalogoFora: true });
    expect(hospedeiro.querySelector("[data-miniaturas]")?.textContent).toBe(
      "—",
    );
  });
});

describe("CartaoDaVitrine — setas de ordem", () => {
  it("a primeira não sobe (e avisa), mas desce", async () => {
    await mostrar({ indice: 0, total: 3 });
    expect(subir().getAttribute("aria-disabled")).toBe("true");
    expect(descer().getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => subir().click());
    expect(aoMover).not.toHaveBeenCalled();
    await act(async () => descer().click());
    expect(aoMover).toHaveBeenCalledExactlyOnceWith(0, "down");
  });

  it("a do meio sobe e desce", async () => {
    await mostrar({ indice: 1, total: 3 });
    expect(subir().getAttribute("aria-disabled")).not.toBe("true");
    expect(descer().getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => subir().click());
    await act(async () => descer().click());
    expect(aoMover.mock.calls).toEqual([
      [1, "up"],
      [1, "down"],
    ]);
  });

  it("a última sobe, mas não desce (e avisa)", async () => {
    await mostrar({ indice: 2, total: 3 });
    expect(descer().getAttribute("aria-disabled")).toBe("true");
    expect(subir().getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => descer().click());
    expect(aoMover).not.toHaveBeenCalled();
    await act(async () => subir().click());
    expect(aoMover).toHaveBeenCalledExactlyOnceWith(2, "up");
  });

  it("vitrine única não anda para lado nenhum", async () => {
    await mostrar({ indice: 0, total: 1 });
    expect(subir().getAttribute("aria-disabled")).toBe("true");
    expect(descer().getAttribute("aria-disabled")).toBe("true");
    await act(async () => subir().click());
    await act(async () => descer().click());
    expect(aoMover).not.toHaveBeenCalled();
  });

  it("gravando a ordem: nenhuma seta anda, nem no meio da lista", async () => {
    await mostrar({ indice: 1, total: 3, travado: true });
    expect(subir().getAttribute("aria-disabled")).toBe("true");
    expect(descer().getAttribute("aria-disabled")).toBe("true");
    await act(async () => subir().click());
    await act(async () => descer().click());
    expect(aoMover).not.toHaveBeenCalled();
  });
});

describe("CartaoDaVitrine — foco depois de mover", () => {
  async function moverEEsperarAGravacao(
    estavaComFoco: boolean,
    seta: "Subir" | "Descer",
  ) {
    await mostrar({ indice: 1, total: 3 });
    const botao = porRotulo(`${seta} vitrine Kits de presente`);
    if (estavaComFoco) botao.focus();
    await act(async () => botao.click());
    // A ordem está sendo gravada e o foco se perde na troca de lugar.
    await act(async () => {
      raiz.render(cartao({ indice: 1, total: 3, travado: true }));
    });
    (document.activeElement as HTMLElement | null)?.blur();
    // Gravou: o cartão mudou de posição e destrava.
    await act(async () => {
      raiz.render(
        cartao({ indice: seta === "Subir" ? 0 : 2, total: 3, travado: false }),
      );
    });
    return porRotulo(`${seta} vitrine Kits de presente`);
  }

  it("seta Subir que tinha o foco: o foco volta a ela", async () => {
    const botao = await moverEEsperarAGravacao(true, "Subir");
    expect(document.activeElement).toBe(botao);
  });

  it("seta Descer que tinha o foco: o foco volta a ela", async () => {
    const botao = await moverEEsperarAGravacao(true, "Descer");
    expect(document.activeElement).toBe(botao);
  });

  it("seta tocada SEM ter o foco (outro lugar tinha): o foco não é puxado", async () => {
    for (const seta of ["Subir", "Descer"] as const) {
      const botao = await moverEEsperarAGravacao(false, seta);
      expect(document.activeElement).not.toBe(botao);
    }
  });
});

describe("CartaoDaVitrine — desenho do layout Padrão e texto do modo", () => {
  const caminhoDoPadrao = () =>
    porRotulo("Layout Padrão").querySelector("path")?.getAttribute("d");

  it("vitrine de Ofertas usa o desenho do Padrão de Ofertas", async () => {
    await mostrar({ secao: { id: "offers", isCustom: false } });
    expect(caminhoDoPadrao()).toBe("M2 1h26v18H2zM5 4h20v9H5zM5 16h12m3 0h5");
  });

  it("vitrine que não é de Ofertas usa o desenho do carrossel", async () => {
    await mostrar({ secao: { id: "custom_1" } });
    expect(caminhoDoPadrao()).toBe(
      "M0 1h6v18H0M9 1h12v18H9zM24 1h6M24 1v18h6M0 4h3v8H0M12 4h6v8h-6zM27 4h3v8h-3zM0 15h3m9 0h6m9 0h3",
    );
  });

  it("sem produto escolhido: 'automático' e o botão 'Escolher produtos'", async () => {
    await mostrar({ secao: { productIds: [] } });
    expect(hospedeiro.textContent).toContain("automático");
    expect(hospedeiro.textContent).toContain("Escolher produtos");
    expect(hospedeiro.textContent).not.toContain("Escolhidos (");
  });

  it("com produtos escolhidos: conta os que existem e mostra 'Escolhidos (N)'", async () => {
    await mostrar({ secao: { productIds: ["a", "b", "c"] }, escolhidos: 2 });
    expect(hospedeiro.textContent).toContain("2 escolhidos");
    expect(hospedeiro.textContent).toContain("Escolhidos (2)");
    expect(hospedeiro.textContent).not.toContain("automático");
  });
});
