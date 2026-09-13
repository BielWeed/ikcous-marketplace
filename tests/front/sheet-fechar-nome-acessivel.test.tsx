// @vitest-environment jsdom
//
// Acessibilidade (13/09): o X embutido do SheetContent
// (src/components/ui/sheet.tsx) se anunciava como "Close" no leitor de
// tela — o nome acessível dele vinha do <span class="sr-only">Close</span>.
// O fix adiciona aria-label="Fechar" ao botão: aria-label tem precedência
// sobre o conteúdo no algoritmo de nome acessível, então o leitor de tela
// passa a anunciar "Fechar". O span NÃO se mexe — dois testes irmãos
// localizam o X varrendo textContent === "Close"
// (product-card-escolhe-opcoes-na-folha.test.tsx,
// product-card-nao-estica-vizinho-ao-expandir.test.tsx).
//
// Por que createRoot/act e não @testing-library/react: a lib não está
// instalada neste projeto (ver tests/front/banner-legivel-e-que-para.test.tsx)
// — o padrão da casa é createRoot/act, com queries DOM nativas. O nome
// acessível é computado aqui na ordem do algoritmo oficial (aria-label
// primeiro, conteúdo do elemento depois) — a mesma regra que o
// getByRole({ name }) da testing-library aplicaria a este botão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function nomeAcessivel(b: HTMLButtonElement) {
  return (b.getAttribute("aria-label") || b.textContent || "").trim();
}

// A folha renderiza em PORTAL (fora do hospedeiro) — as queries saem de
// document, não do hospedeiro. Equivalente local do getByRole("button",
// { name }): só botões, nome acessível na ordem do algoritmo oficial.
function botoes() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
}

describe("SheetContent — o X embutido anuncia Fechar no leitor de tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarFolhaAberta() {
    const { Sheet, SheetContent, SheetDescription, SheetTitle } = await import(
      "@/components/ui/sheet"
    );
    await act(async () => {
      raiz.render(
        <Sheet open onOpenChange={() => {}}>
          <SheetContent data-testid="folha-teste">
            <SheetTitle>Título</SheetTitle>
            {/* Sem Description o Radix emite o warning
                "Missing `Description` or `aria-describedby={undefined}`" —
                os consumidores reais da casa (ProductCard) passam uma
                Description sr-only; o fixture faz o mesmo para não poluir
                a suíte com warning que não é do produto. */}
            <SheetDescription className="sr-only">Descrição</SheetDescription>
            <p>corpo</p>
          </SheetContent>
        </Sheet>,
      );
    });
  }

  it("o botão de fechar tem o nome acessível Fechar", async () => {
    await renderizarFolhaAberta();

    expect(botoes().some((b) => nomeAcessivel(b) === "Fechar")).toBe(true);
  });

  it("nenhum botão se anuncia mais como Close", async () => {
    await renderizarFolhaAberta();

    expect(botoes().some((b) => nomeAcessivel(b) === "Close")).toBe(false);
  });
});
