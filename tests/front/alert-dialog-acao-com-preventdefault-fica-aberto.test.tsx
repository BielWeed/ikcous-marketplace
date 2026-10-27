// @vitest-environment jsdom
//
// Caça 9, item 15: a tela de Produtos mantém o diálogo "Confirmar Duplicação"
// aberto, com "Duplicando…", até a cópia terminar. Isso depende de o botão de
// ação do Radix NÃO fechar o diálogo quando o clique chama `preventDefault()`
// — com o componente REAL do projeto (a suíte da tela o dubla). Se uma
// atualização do Radix mudar isso, este teste avisa antes da lojista.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Exemplo({ segurar, ocupado }: { segurar: boolean; ocupado: boolean }) {
  const [aberto, setAberto] = useState(true);
  const [cliques, setCliques] = useState(0);
  return (
    <>
      <output data-testid="cliques">{cliques}</output>
      <AlertDialog
        open={aberto}
        onOpenChange={(abrir) => !abrir && !ocupado && setAberto(false)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Título</AlertDialogTitle>
          <AlertDialogDescription>Texto</AlertDialogDescription>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(evento) => {
              if (segurar) evento.preventDefault();
              setCliques((n) => n + 1);
            }}
          >
            Confirmar
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

describe("AlertDialogAction do projeto (Radix real)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  const confirmar = () =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Confirmar",
    ) as HTMLButtonElement | undefined;
  const cancelar = () =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancelar",
    ) as HTMLButtonElement | undefined;

  it("com preventDefault no clique, o diálogo continua aberto", async () => {
    await act(async () => raiz.render(<Exemplo segurar ocupado={false} />));
    expect(confirmar()).toBeDefined();
    await act(async () => confirmar()!.click());
    expect(document.body.textContent).toContain("Texto");
    expect(document.querySelector('[data-testid="cliques"]')?.textContent).toBe(
      "1",
    );
  });

  it("controle: sem preventDefault o clique fecha o diálogo (é por isso que a tela segura)", async () => {
    await act(async () =>
      raiz.render(<Exemplo segurar={false} ocupado={false} />),
    );
    await act(async () => confirmar()!.click());
    expect(document.body.textContent).not.toContain("Texto");
  });

  it("ocupado, o Cancelar (e a saída pelo onOpenChange) não fecha o diálogo", async () => {
    await act(async () => raiz.render(<Exemplo segurar ocupado />));
    await act(async () => cancelar()!.click());
    expect(document.body.textContent).toContain("Texto");
  });
});
