// @vitest-environment jsdom
//
// "Editar vitrine" (escolha manual dos produtos): a BUSCA e a lista LONGA.
// Os testes vizinhos montam a folha com poucos produtos e sem digitar na
// busca; aqui se prova o que só aparece com catálogo grande e busca de verdade:
//
// - a busca acha por nome E por categoria, sem acento nem caixa;
// - busca só de espaços não esconde a lista (não é busca);
// - a lista mostra 60 por vez e "Mostrar mais" soma mais 60;
// - o limite volta a 60 quando a busca muda ou é limpa;
// - o contador "Mostrando N de M" só aparece quando falta produto na tela;
// - "oculta da loja" e a posição aparecem no cabeçalho da folha;
// - o nome do produto sem categoria não ganha " · " solto.
import type { Product } from "@/types";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaEditarVitrine } = await import(
  "@/components/admin/vitrines/FolhaEditarVitrine"
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

const produto = (id: string, name: string, category = "") =>
  ({
    id,
    name,
    price: 10,
    category,
    images: [],
    isActive: true,
  }) as unknown as Product;

type Extra = {
  produtos: Product[];
  idsEmExibicao?: string[];
  secao?: Record<string, unknown>;
  posicao?: number;
};

async function abrir({
  produtos,
  idsEmExibicao = [],
  secao = {},
  posicao = 1,
}: Extra) {
  await act(async () => {
    raiz.render(
      createElement(FolhaEditarVitrine, {
        secao: { id: "x", title: "X", active: true, ...secao },
        posicao,
        produtos,
        idsEmExibicao,
        aoFechar: () => {},
        aoRenomear: async () => true,
        aoMudarQuantidade: () => {},
        aoAlternarProduto: () => {},
        aoVoltarAoAutomatico: () => {},
        aoEscolherManualmente: () => {},
      } as never),
    );
  });
}

const buscar = (texto: string) =>
  act(async () => {
    const campo = document.querySelector<HTMLInputElement>(
      'input[aria-label="Buscar produto"]',
    ) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });

const ids = () =>
  [...document.querySelectorAll("[data-produto-id]")].map((el) =>
    el.getAttribute("data-produto-id"),
  );

const muitos = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    produto(`p${i + 1}`, `Camiseta ${i + 1}`, "Roupas"),
  );

describe("Editar vitrine — busca", () => {
  const catalogo = [
    produto("a", "Aliança de ouro", "Joias"),
    produto("b", "Colar de prata", "Bijuteria"),
    produto("c", "Brinco", "Joias"),
  ];

  it("acha pelo nome sem acento nem caixa", async () => {
    await abrir({ produtos: catalogo });
    await buscar("ALIANCA");
    expect(ids()).toEqual(["a"]);
  });

  it("acha pela CATEGORIA, mesmo quando o nome não tem a palavra", async () => {
    await abrir({ produtos: catalogo });
    await buscar("joias");
    expect(ids()).toEqual(["a", "c"]);
  });

  it("busca só de espaços não é busca: a lista inteira continua na tela", async () => {
    await abrir({ produtos: catalogo });
    await buscar("   ");
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(document.body.textContent).not.toContain(
      "Nenhum produto encontrado na busca",
    );
  });

  it("sem resultado diz que a busca não achou (e o X limpa)", async () => {
    await abrir({ produtos: catalogo });
    await buscar("zzz");
    expect(ids()).toEqual([]);
    expect(document.body.textContent).toContain(
      "Nenhum produto encontrado na busca",
    );
    await act(async () => {
      (
        document.querySelector(
          'button[aria-label="Limpar busca"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("os escolhidos sobem para o topo, na ordem da vitrine, mesmo na busca", async () => {
    await abrir({
      produtos: catalogo,
      idsEmExibicao: ["c", "a"],
      secao: { productIds: ["c", "a"] },
    });
    expect(ids()).toEqual(["c", "a", "b"]);
    await buscar("joias");
    expect(ids()).toEqual(["c", "a"]);
  });

  it("produto sem categoria não ganha ' · ' solto depois do preço", async () => {
    await abrir({
      produtos: [produto("s", "Sem categoria", ""), produto("t", "Com", "X")],
    });
    const linhaSem = document.querySelector('[data-produto-id="s"]');
    const linhaCom = document.querySelector('[data-produto-id="t"]');
    expect(linhaSem?.textContent).not.toContain("·");
    expect(linhaCom?.textContent).toContain("· X");
  });
});

describe("Editar vitrine — lista longa", () => {
  const mostrandoDe = () =>
    [...document.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Mostrando"),
    )?.textContent ?? null;
  const mostrarMais = () =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Mostrar mais",
    ) ?? null;

  it("exatamente 60 produtos: cabem todos e não há 'Mostrar mais'", async () => {
    await abrir({ produtos: muitos(60) });
    expect(ids()).toHaveLength(60);
    expect(mostrandoDe()).toBeNull();
    expect(mostrarMais()).toBeNull();
  });

  it("61 produtos: mostra 60, avisa 'Mostrando 60 de 61' e o botão traz o resto", async () => {
    await abrir({ produtos: muitos(61) });
    expect(ids()).toHaveLength(60);
    expect(mostrandoDe()).toContain("Mostrando 60 de 61");
    await act(async () => {
      mostrarMais()?.click();
    });
    expect(ids()).toHaveLength(61);
    expect(mostrandoDe()).toBeNull();
  });

  it("'Mostrar mais' soma 60 a cada toque (130 produtos: 60, 120, 130)", async () => {
    await abrir({ produtos: muitos(130) });
    expect(ids()).toHaveLength(60);
    await act(async () => {
      mostrarMais()?.click();
    });
    expect(ids()).toHaveLength(120);
    expect(mostrandoDe()).toContain("Mostrando 120 de 130");
    await act(async () => {
      mostrarMais()?.click();
    });
    expect(ids()).toHaveLength(130);
  });

  it("mudar a busca volta o limite a 60", async () => {
    await abrir({ produtos: muitos(130) });
    await act(async () => {
      mostrarMais()?.click();
    });
    expect(ids()).toHaveLength(120);
    // "camiseta" acha os 130 de novo, mas a lista recomeça em 60.
    await buscar("camiseta");
    expect(ids()).toHaveLength(60);
    expect(mostrandoDe()).toContain("Mostrando 60 de 130");
  });

  it("limpar a busca (X) volta o limite a 60", async () => {
    await abrir({ produtos: muitos(130) });
    await buscar("camiseta");
    await act(async () => {
      mostrarMais()?.click();
    });
    expect(ids()).toHaveLength(120);
    await act(async () => {
      (
        document.querySelector(
          'button[aria-label="Limpar busca"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(ids()).toHaveLength(60);
  });
});

describe("Editar vitrine — a frase que explica o modo", () => {
  const frase = () =>
    [...document.querySelectorAll("p")]
      .map((p) => p.textContent ?? "")
      .find(
        (t) =>
          t.includes("Sua loja ainda") ||
          t.includes("Hoje a loja") ||
          t.includes("Nenhum produto aparece") ||
          t.includes("Aparecem na ordem"),
      );

  it("loja sem produto nenhum", async () => {
    await abrir({ produtos: [] });
    expect(frase()).toBe(
      "Sua loja ainda não tem produtos. Quando cadastrar, esta vitrine passa a escolher sozinha.",
    );
  });

  it("automática, com produtos na loja mas nenhum em exibição", async () => {
    await abrir({ produtos: [produto("a", "A")], idsEmExibicao: [] });
    expect(frase()).toBe(
      "Nenhum produto aparece nesta vitrine agora. Toque em um produto da lista para escolher.",
    );
  });

  it("automática, com produtos em exibição", async () => {
    await abrir({ produtos: [produto("a", "A")], idsEmExibicao: ["a"] });
    expect(frase()).toBe(
      "Hoje a loja escolhe sozinha. Toque em um produto para passar a escolher você.",
    );
  });

  it("manual", async () => {
    await abrir({
      produtos: [produto("a", "A")],
      idsEmExibicao: ["a"],
      secao: { productIds: ["a"] },
    });
    expect(frase()).toBe(
      'Aparecem na ordem em que você marcar. "Automático" descarta esta lista e volta a loja a escolher sozinha.',
    );
  });
});

describe("Editar vitrine — cabeçalho", () => {
  it("vitrine ligada mostra a posição; oculta mostra 'oculta da loja'", async () => {
    await abrir({ produtos: [], posicao: 3 });
    expect(document.body.textContent).toContain("Personalizada · 3ª da lista");
    await abrir({ produtos: [], posicao: 3, secao: { active: false } });
    expect(document.body.textContent).toContain(
      "Personalizada · oculta da loja",
    );
    expect(document.body.textContent).not.toContain("3ª da lista");
  });
});
