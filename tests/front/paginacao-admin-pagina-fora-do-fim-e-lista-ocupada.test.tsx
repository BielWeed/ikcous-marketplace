// @vitest-environment jsdom
//
// Paginação do painel (a mesma da lista de Pedidos): as bordas que o teste
// principal (`paginacao-admin.test.tsx`) não cobre — página salva que passou
// do fim, lista "ocupada" (releitura em andamento) e número grande.
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function montar(
  propriedades: Omit<React.ComponentProps<typeof PaginacaoAdmin>, "aoMudar">,
  aoMudar: (novaPagina: number) => void = () => {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<PaginacaoAdmin {...propriedades} aoMudar={aoMudar} />);
  });
  return container;
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão "${texto}" não existe`);
  return achado;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PaginacaoAdmin — bordas", () => {
  it("página salva passou do fim: o contador e o Anterior usam a última página que existe", async () => {
    // Lista encolheu de 5 páginas para 2 enquanto a lojista estava na 5ª
    // (pagina = 4, 0-based). Antes do reset da tela, o 1º quadro mostrava
    // "Exibindo 49 - 19 de 19" e o Anterior voltava para a página 3.
    const aoMudar = vi.fn();
    const tela = montar(
      { pagina: 4, totalPaginas: 2, totalItens: 19, itensPorPagina: 12 },
      aoMudar,
    );

    expect(tela.textContent).toContain("Exibindo 13 - 19 de 19");
    expect(botao("Próximo").disabled).toBe(true);

    await act(async () => {
      botao("Anterior").click();
    });
    expect(aoMudar).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("no meio da lista os dois botões ficam ligados e levam à página vizinha", async () => {
    const aoMudar = vi.fn();
    montar(
      { pagina: 1, totalPaginas: 3, totalItens: 30, itensPorPagina: 12 },
      aoMudar,
    );

    expect(botao("Anterior").disabled).toBe(false);
    expect(botao("Próximo").disabled).toBe(false);

    await act(async () => {
      botao("Anterior").click();
    });
    await act(async () => {
      botao("Próximo").click();
    });
    expect(aoMudar.mock.calls).toEqual([[0], [2]]);
  });

  it("na última página o Próximo está desligado e o clique não faz nada", async () => {
    const aoMudar = vi.fn();
    montar(
      { pagina: 2, totalPaginas: 3, totalItens: 30, itensPorPagina: 12 },
      aoMudar,
    );

    expect(botao("Próximo").disabled).toBe(true);
    await act(async () => {
      botao("Próximo").click();
    });
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("lista ocupada: troca o contador por 'Atualizando a lista…' e IGNORA os cliques", async () => {
    // Durante a releitura, trocar de página dispararia outra consulta por
    // cima da que está no ar.
    const aoMudar = vi.fn();
    const tela = montar(
      {
        pagina: 1,
        totalPaginas: 3,
        totalItens: 30,
        itensPorPagina: 12,
        ocupada: true,
      },
      aoMudar,
    );

    expect(tela.textContent).toContain("Atualizando a lista…");
    expect(tela.textContent).not.toContain("Exibindo");
    expect(tela.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(botao("Anterior").getAttribute("aria-disabled")).toBe("true");
    expect(botao("Próximo").getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      botao("Anterior").click();
    });
    await act(async () => {
      botao("Próximo").click();
    });
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("depois de ocupada, volta a aceitar o clique", async () => {
    const aoMudar = vi.fn();
    montar(
      {
        pagina: 0,
        totalPaginas: 2,
        totalItens: 19,
        itensPorPagina: 12,
        ocupada: false,
      },
      aoMudar,
    );

    await act(async () => {
      botao("Próximo").click();
    });
    expect(aoMudar).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("números grandes saem com ponto de milhar, como a lojista lê", () => {
    const tela = montar({
      pagina: 0,
      totalPaginas: 103,
      totalItens: 1234,
      itensPorPagina: 12,
    });

    expect(tela.textContent).toContain("Exibindo 1 - 12 de 1.234");
  });

  it("a página cheia fecha no limite exato: 24 itens em páginas de 12 não inventam a 3ª", () => {
    const tela = montar({
      pagina: 1,
      totalPaginas: 2,
      totalItens: 24,
      itensPorPagina: 12,
    });

    expect(tela.textContent).toContain("Exibindo 13 - 24 de 24");
    expect(botao("Próximo").disabled).toBe(true);
  });
});
