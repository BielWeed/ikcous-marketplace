// @vitest-environment jsdom
//
// Caça de provas fracas por mutação, território "lista de produtos do painel":
// a paginação única (`PaginacaoAdmin`) tinha prova só do caminho feliz (primeira
// e última página de 2). Estes testes fixam os limites que nenhum outro vigiava:
//
//   - a página salva no aparelho passou do fim da lista (o contador não pode
//     pintar "Exibindo 61 - 12 de 12");
//   - páginas do MEIO: Anterior e Próximo andam exatamente uma página;
//   - lista "ocupada": o contador some atrás de "Atualizando a lista…" e o
//     toque nos botões não muda de página;
//   - milhar com ponto ("1.234") e a última página exata (24 itens, 2 páginas).
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
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

function botaoPeloTexto(tela: HTMLDivElement, texto: string) {
  return [...tela.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PaginacaoAdmin — limites da lista de produtos", () => {
  it("página salva além do fim da lista é puxada para a última, no contador e nos botões", () => {
    const aoMudar = vi.fn();
    const tela = montar({
      pagina: 5,
      totalPaginas: 2,
      totalItens: 19,
      itensPorPagina: 12,
      aoMudar,
    });
    expect(tela.textContent).toContain("Exibindo 13 - 19 de 19");
    expect(tela.textContent).not.toContain("Exibindo 61");
    expect(botaoPeloTexto(tela, "Próximo")?.disabled).toBe(true);
    expect(botaoPeloTexto(tela, "Anterior")?.disabled).toBe(false);
  });

  it("página salva além do fim de uma lista de página única mostra 1 até o total", () => {
    const tela = montar({
      pagina: 3,
      totalPaginas: 1,
      totalItens: 12,
      itensPorPagina: 12,
    });
    expect(tela.textContent).toContain("Exibindo 1 - 12 de 12");
  });

  it("no meio da lista, Anterior volta uma página e Próximo avança uma", async () => {
    const aoMudar = vi.fn();
    const tela = montar({
      pagina: 2,
      totalPaginas: 4,
      totalItens: 40,
      itensPorPagina: 12,
      aoMudar,
    });
    expect(tela.textContent).toContain("Exibindo 25 - 36 de 40");
    expect(botaoPeloTexto(tela, "Anterior")?.disabled).toBe(false);
    expect(botaoPeloTexto(tela, "Próximo")?.disabled).toBe(false);

    await act(async () => botaoPeloTexto(tela, "Anterior")!.click());
    expect(aoMudar).toHaveBeenLastCalledWith(1);
    await act(async () => botaoPeloTexto(tela, "Próximo")!.click());
    expect(aoMudar).toHaveBeenLastCalledWith(3);
    expect(aoMudar).toHaveBeenCalledTimes(2);
  });

  it("na penúltima página o Próximo ainda está ligado e leva à última", async () => {
    const aoMudar = vi.fn();
    const tela = montar({
      pagina: 1,
      totalPaginas: 3,
      totalItens: 30,
      itensPorPagina: 12,
      aoMudar,
    });
    expect(botaoPeloTexto(tela, "Próximo")?.disabled).toBe(false);
    await act(async () => botaoPeloTexto(tela, "Próximo")!.click());
    expect(aoMudar).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("ocupada: troca o contador por 'Atualizando a lista…' e o toque não muda de página", async () => {
    const aoMudar = vi.fn();
    const tela = montar({
      pagina: 1,
      totalPaginas: 3,
      totalItens: 30,
      itensPorPagina: 12,
      aoMudar,
      ocupada: true,
    });
    expect(tela.textContent).toContain("Atualizando a lista…");
    expect(tela.textContent).not.toContain("Exibindo");
    expect(
      tela
        .querySelector('[data-testid="paginacao-admin"]')
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    const anterior = botaoPeloTexto(tela, "Anterior")!;
    const proximo = botaoPeloTexto(tela, "Próximo")!;
    expect(anterior.getAttribute("aria-disabled")).toBe("true");
    expect(proximo.getAttribute("aria-disabled")).toBe("true");
    await act(async () => anterior.click());
    await act(async () => proximo.click());
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("ocupada na primeira página: os botões ficam só aria-disabled (nenhum vira 'disabled' e perde o foco)", () => {
    const primeira = montar({
      pagina: 0,
      totalPaginas: 3,
      totalItens: 30,
      itensPorPagina: 12,
      ocupada: true,
    });
    expect(botaoPeloTexto(primeira, "Anterior")?.disabled).toBe(false);
    expect(botaoPeloTexto(primeira, "Próximo")?.disabled).toBe(false);
    act(() => root.unmount());
    container.remove();

    const ultima = montar({
      pagina: 2,
      totalPaginas: 3,
      totalItens: 30,
      itensPorPagina: 12,
      ocupada: true,
    });
    expect(botaoPeloTexto(ultima, "Próximo")?.disabled).toBe(false);
  });

  it("fora de 'ocupada' não promete ocupação (sem aria-busy nem aria-disabled)", () => {
    const tela = montar({
      pagina: 1,
      totalPaginas: 3,
      totalItens: 30,
      itensPorPagina: 12,
    });
    expect(
      tela
        .querySelector('[data-testid="paginacao-admin"]')
        ?.hasAttribute("aria-busy"),
    ).toBe(false);
    expect(
      botaoPeloTexto(tela, "Anterior")?.hasAttribute("aria-disabled"),
    ).toBe(false);
  });

  it("milhar sai com ponto e a última página exata fecha no total", () => {
    const grande = montar({
      pagina: 0,
      totalPaginas: 103,
      totalItens: 1234,
      itensPorPagina: 12,
    });
    expect(grande.textContent).toContain("Exibindo 1 - 12 de 1.234");
    act(() => root.unmount());
    container.remove();

    const exata = montar({
      pagina: 1,
      totalPaginas: 2,
      totalItens: 24,
      itensPorPagina: 12,
    });
    expect(exata.textContent).toContain("Exibindo 13 - 24 de 24");
  });
});
