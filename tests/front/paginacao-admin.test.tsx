import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
// @vitest-environment jsdom
//
// Missão 06 (C2) — a paginação única do painel. Um componente só substitui os
// três desenhos inline (Pedidos "Perfil do Setor", Produtos "Exibindo...",
// Clientes "Segmento X de Y") e devolve o retorno que faltava: quantos itens
// existem. Mesmo padrão dos testes de componente da casa: jsdom + createRoot
// + act, sem testing-library.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

type Propriedades = Omit<
  React.ComponentProps<typeof PaginacaoAdmin>,
  "aoMudar"
> & { aoMudar?: (novaPagina: number) => void };

function montar(propriedades: Propriedades) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <PaginacaoAdmin
        {...propriedades}
        aoMudar={propriedades.aoMudar ?? (() => {})}
      />,
    );
  });
  return container;
}

function botaoPeloTexto(container: HTMLDivElement, texto: string) {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PaginacaoAdmin", () => {
  it("mostra a janela exibida e o total — o retorno que faltava", () => {
    const tela = montar({
      pagina: 1,
      totalPaginas: 2,
      totalItens: 19,
      itensPorPagina: 12,
    });
    expect(tela.textContent).toContain("Exibindo 13 - 19 de 19");
  });

  it("sem segunda página mostra só o contador, sem botões", () => {
    const tela = montar({
      pagina: 0,
      totalPaginas: 1,
      totalItens: 8,
      itensPorPagina: 12,
    });
    expect(tela.textContent).toContain("Exibindo 1 - 8 de 8");
    expect(botaoPeloTexto(tela, "Anterior")).toBeUndefined();
    expect(botaoPeloTexto(tela, "Próximo")).toBeUndefined();
  });

  it("Anterior desabilita na primeira página; Próximo repassa a página nova", async () => {
    const aoMudar = vi.fn();
    const tela = montar({
      pagina: 0,
      totalPaginas: 2,
      totalItens: 19,
      itensPorPagina: 12,
      aoMudar,
    });
    const anterior = botaoPeloTexto(tela, "Anterior")! as HTMLButtonElement;
    expect(anterior.disabled).toBe(true);
    const proximo = botaoPeloTexto(tela, "Próximo")! as HTMLButtonElement;
    await act(async () => {
      proximo.click();
    });
    expect(aoMudar).toHaveBeenCalledWith(1);
  });

  it("lista vazia não renderiza nada", () => {
    const tela = montar({
      pagina: 0,
      totalPaginas: 0,
      totalItens: 0,
      itensPorPagina: 12,
    });
    expect(tela.firstChild).toBeNull();
  });
});
