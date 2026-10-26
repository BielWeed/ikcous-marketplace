// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 10: o X de fechar das caixas e folhas tinha 16 px
// de toque, e o da caixa (Dialog) se anunciava "Close" em inglês. Agora o alvo
// é de 44 px (padding + margem negativa: o desenho do X não anda) e o nome é
// "Fechar" nos dois.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("X de fechar — Dialog e Sheet", () => {
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

  const fechar = () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]');

  it("Dialog: nome em português e alvo de 44 px", async () => {
    const { Dialog, DialogContent, DialogDescription, DialogTitle } =
      await import("@/components/ui/dialog");
    await act(async () => {
      raiz.render(
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>Título</DialogTitle>
            <DialogDescription>Descrição</DialogDescription>
          </DialogContent>
        </Dialog>,
      );
    });
    const x = fechar();
    expect(x).not.toBeNull();
    expect(x!.className).toContain("p-3.5");
    expect(x!.className).toContain("-m-3.5");
  });

  it("Sheet: alvo de 44 px", async () => {
    const { Sheet, SheetContent, SheetDescription, SheetTitle } = await import(
      "@/components/ui/sheet"
    );
    await act(async () => {
      raiz.render(
        <Sheet open onOpenChange={() => {}}>
          <SheetContent>
            <SheetTitle>Título</SheetTitle>
            <SheetDescription>Descrição</SheetDescription>
          </SheetContent>
        </Sheet>,
      );
    });
    const x = fechar();
    expect(x).not.toBeNull();
    expect(x!.className).toContain("p-3.5");
    expect(x!.className).toContain("-m-3.5");
  });
});
