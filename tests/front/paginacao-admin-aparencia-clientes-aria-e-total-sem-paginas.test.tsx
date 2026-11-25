// @vitest-environment jsdom
//
// Paginação do painel (PaginacaoAdmin): o que os três testes que já existem
// não olhavam. Caça por mutação (25/11/2026) — sobreviveram:
//  - o `aria-disabled` do botão Próximo (os testes só conferiam o do Anterior:
//    o Próximo podia anunciar "desabilitado" o tempo todo);
//  - o desenho "clientes" (coluna centralizada) e as frases "Primeira página ·
//    Anterior indisponível" / "Última página · Próximo indisponível" por
//    inteiro (os testes só procuravam "Primeira página");
//  - o limite inferior da página efetiva quando `totalPaginas` chega 0 com
//    itens (leitura inconsistente): o contador nunca pode virar "Exibindo -11".
//
// Mutantes EQUIVALENTES anotados (o botão desabilitado nunca dispara o clique):
//  - `aoMudar(Math.max(0, paginaEfetiva - 1))` -> `aoMudar(paginaEfetiva - 1)`:
//    o Anterior só está habilitado quando paginaEfetiva >= 1.
//  - `aoMudar(Math.min(totalPaginas - 1, paginaEfetiva + 1))` ->
//    `aoMudar(paginaEfetiva + 1)`: o Próximo só está habilitado quando
//    paginaEfetiva < totalPaginas - 1.
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

type Props = Omit<React.ComponentProps<typeof PaginacaoAdmin>, "aoMudar">;

function montar(props: Props, aoMudar: (n: number) => void = () => {}) {
  act(() => {
    raiz.render(<PaginacaoAdmin {...props} aoMudar={aoMudar} />);
  });
}

const raizDoBloco = () =>
  host.querySelector('[data-testid="paginacao-admin"]') as HTMLElement;

function botao(texto: string): HTMLButtonElement {
  const achado = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão "${texto}" não existe`);
  return achado;
}

const NO_MEIO: Props = {
  pagina: 1,
  totalPaginas: 3,
  totalItens: 30,
  itensPorPagina: 12,
};

describe("PaginacaoAdmin: aria-disabled e aria-busy", () => {
  it("parada, no meio da lista: nenhum dos dois botões diz aria-disabled e o bloco não diz aria-busy", () => {
    montar(NO_MEIO);
    expect(botao("Anterior").hasAttribute("aria-disabled")).toBe(false);
    expect(botao("Próximo").hasAttribute("aria-disabled")).toBe(false);
    expect(raizDoBloco().hasAttribute("aria-busy")).toBe(false);
  });

  it("ocupada: os dois botões dizem aria-disabled=true, o bloco diz aria-busy=true e os cliques não andam", () => {
    const aoMudar = vi.fn();
    montar({ ...NO_MEIO, ocupada: true }, aoMudar);
    expect(botao("Anterior").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Próximo").getAttribute("aria-disabled")).toBe("true");
    expect(raizDoBloco().getAttribute("aria-busy")).toBe("true");
    act(() => botao("Anterior").click());
    act(() => botao("Próximo").click());
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("ocupada NÃO usa o atributo disabled (o foco não se perde no botão)", () => {
    montar({ ...NO_MEIO, ocupada: true });
    expect(botao("Anterior").disabled).toBe(false);
    expect(botao("Próximo").disabled).toBe(false);
  });

  it("ocupada troca o contador pela frase de atualização", () => {
    montar({ ...NO_MEIO, ocupada: true });
    expect(raizDoBloco().textContent).toContain("Atualizando a lista…");
    expect(raizDoBloco().textContent).not.toContain("Exibindo");
  });
});

describe("PaginacaoAdmin: o desenho 'clientes'", () => {
  it("sem 'aparencia', o bloco NÃO é coluna centralizada e não mostra 'N de M' nem frase de ponta", () => {
    montar({ ...NO_MEIO, pagina: 0 });
    expect(raizDoBloco().className).not.toContain("flex-col");
    expect(raizDoBloco().className).not.toContain("text-center");
    expect(raizDoBloco().textContent).not.toContain("1 de 3");
    expect(raizDoBloco().textContent).not.toContain("indisponível");
  });

  it("com 'clientes', o bloco vira coluna centralizada e mostra a página 'N de M'", () => {
    montar({ ...NO_MEIO, aparencia: "clientes" });
    expect(raizDoBloco().className).toContain("flex-col");
    expect(raizDoBloco().className).toContain("text-center");
    expect(raizDoBloco().textContent).toContain("2 de 3");
  });

  it("primeira página: frase completa dizendo que o Anterior está indisponível", () => {
    montar({ ...NO_MEIO, pagina: 0, aparencia: "clientes" });
    const frases = [...host.querySelectorAll("p")].map((p) => p.textContent);
    expect(frases).toContain("Primeira página · Anterior indisponível");
    expect(frases).not.toContain("Última página · Próximo indisponível");
  });

  it("última página: frase completa dizendo que o Próximo está indisponível", () => {
    montar({ ...NO_MEIO, pagina: 2, aparencia: "clientes" });
    const frases = [...host.querySelectorAll("p")].map((p) => p.textContent);
    expect(frases).toContain("Última página · Próximo indisponível");
    expect(frases).not.toContain("Primeira página · Anterior indisponível");
  });

  it("no meio da lista não há frase de ponta", () => {
    montar({ ...NO_MEIO, aparencia: "clientes" });
    expect(raizDoBloco().textContent).not.toContain("indisponível");
  });

  it("lista de uma página só: sem botões, sem 'N de M' e sem frase de ponta", () => {
    montar({
      pagina: 0,
      totalPaginas: 1,
      totalItens: 5,
      itensPorPagina: 12,
      aparencia: "clientes",
    });
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(raizDoBloco().textContent).toBe("Exibindo 1 - 5 de 5");
  });
});

describe("PaginacaoAdmin: totalPaginas incoerente", () => {
  it("itens existem mas totalPaginas chegou 0: o contador cai na primeira página, nunca em número negativo", () => {
    montar({ pagina: 0, totalPaginas: 0, totalItens: 5, itensPorPagina: 12 });
    // Sem o piso em 0, a página efetiva seria -1 e sairia "Exibindo -11 - 5 de 5".
    expect(raizDoBloco().textContent).toBe("Exibindo 1 - 5 de 5");
  });

  it("o mesmo com página salva alta: continua 'Exibindo 1 - 5 de 5'", () => {
    montar({ pagina: 7, totalPaginas: 0, totalItens: 5, itensPorPagina: 12 });
    expect(raizDoBloco().textContent).toBe("Exibindo 1 - 5 de 5");
  });
});
