// @vitest-environment jsdom
//
// Folhas e diálogos EMPILHADOS (caçada por mutação, 24/11/2026): o travamento
// da rolagem do corpo é um contador -- abrir duas folhas e fechar uma mantém a
// página travada; só fechar a ÚLTIMA libera; tela que some com a folha aberta
// também libera (senão a loja inteira fica sem rolar). E o Esc, num empilhado,
// fecha só a do topo. `useHaCamadaAberta` lê esse mesmo sinal para o convite de
// notificações sair do caminho: aqui ele é provado nas bordas que a loja real
// só mostra por acaso (diálogo próprio no <body>, aninhado, sem aria-modal).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useHaCamadaAberta } from "@/hooks/useHaCamadaAberta";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda() {
  return <output data-testid="sonda">{String(useHaCamadaAberta())}</output>;
}

interface Abertas {
  readonly a?: boolean;
  readonly b?: boolean;
  readonly dialogo?: boolean;
  readonly alerta?: boolean;
}

function Tela({
  a = false,
  b = false,
  dialogo = false,
  alerta = false,
}: Abertas) {
  return (
    <>
      <Sonda />
      <Sheet open={a}>
        <SheetContent side="bottom" showCloseButton={false}>
          <SheetTitle>Folha A</SheetTitle>
          <SheetDescription>Descrição A</SheetDescription>
        </SheetContent>
      </Sheet>
      <Sheet open={b}>
        <SheetContent side="bottom" showCloseButton={false}>
          <SheetTitle>Folha B</SheetTitle>
          <SheetDescription>Descrição B</SheetDescription>
        </SheetContent>
      </Sheet>
      <Dialog open={dialogo}>
        <DialogContent>
          <DialogTitle>Diálogo</DialogTitle>
          <DialogDescription>Descrição do diálogo</DialogDescription>
        </DialogContent>
      </Dialog>
      <AlertDialog open={alerta}>
        <AlertDialogContent>
          <AlertDialogTitle>Alerta</AlertDialogTitle>
          <AlertDialogDescription>Descrição do alerta</AlertDialogDescription>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

describe("camadas empilhadas — rolagem do corpo e sinal de camada aberta", () => {
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
    // O que a desmontagem não limpou não pode vazar para o próximo teste.
    for (const no of document.body.querySelectorAll("[data-teste-camada]")) {
      no.remove();
    }
    document.body.removeAttribute("data-scroll-locked");
    document.body.style.pointerEvents = "";
  });

  const montar = (abertas: Abertas) =>
    act(async () => {
      raiz.render(<Tela {...abertas} />);
    });

  const travado = () => document.body.hasAttribute("data-scroll-locked");
  const contador = () => document.body.getAttribute("data-scroll-locked");
  const sonda = () =>
    document.body.querySelector('[data-testid="sonda"]')?.textContent;
  const esperarObservador = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  const esc = () =>
    act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  describe("contador de travamento", () => {
    it("controle: nenhuma camada aberta, corpo livre e sinal desligado", async () => {
      await montar({});
      expect(travado()).toBe(false);
      expect(sonda()).toBe("false");
    });

    it("uma folha trava a rolagem e o sinal liga; ao fechar, tudo volta", async () => {
      await montar({ a: true });
      expect(travado()).toBe(true);
      expect(sonda()).toBe("true");

      await montar({});
      expect(travado()).toBe(false);
      expect(sonda()).toBe("false");
      expect(document.body.style.pointerEvents).toBe("");
    });

    it.each([
      ["o diálogo", { dialogo: true }],
      ["o alerta", { alerta: true }],
    ] as const)(
      "%s, sozinho, também trava a rolagem e libera ao fechar",
      async (_nome, abertas) => {
        await montar(abertas);
        expect(travado()).toBe(true);
        expect(sonda()).toBe("true");
        expect(document.body.style.pointerEvents).toBe("none");

        await montar({});
        expect(travado()).toBe(false);
        expect(sonda()).toBe("false");
        expect(document.body.style.pointerEvents).toBe("");
      },
    );

    it("duas folhas: fechar UMA mantém a rolagem travada; só a última libera", async () => {
      await montar({ a: true });
      const comUma = contador();
      await montar({ a: true, b: true });
      expect(contador()).not.toBe(comUma);
      expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(2);

      await montar({ a: true });
      expect(travado()).toBe(true);
      expect(contador()).toBe(comUma);
      expect(sonda()).toBe("true");
      expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);

      await montar({});
      expect(travado()).toBe(false);
      expect(sonda()).toBe("false");
    });

    it("fecha a de BAIXO primeiro: a de cima segue travando a página", async () => {
      await montar({ a: true, b: true });
      await montar({ b: true });
      expect(travado()).toBe(true);
      expect(sonda()).toBe("true");
      await montar({});
      expect(travado()).toBe(false);
    });

    it("folha + diálogo + alerta, fechando em ordem qualquer: libera só no fim", async () => {
      await montar({ a: true, dialogo: true, alerta: true });
      expect(travado()).toBe(true);

      await montar({ a: true, alerta: true });
      expect(travado()).toBe(true);
      await montar({ alerta: true });
      expect(travado()).toBe(true);
      expect(sonda()).toBe("true");
      await montar({});
      expect(travado()).toBe(false);
      expect(sonda()).toBe("false");
    });

    it("abrir e fechar várias vezes não vaza contagem: depois do último fecho a página está livre", async () => {
      for (let i = 0; i < 3; i += 1) {
        await montar({ a: true, b: true });
        await montar({ b: true });
        await montar({});
      }
      expect(travado()).toBe(false);
      expect(document.body.style.pointerEvents).toBe("");
      expect(sonda()).toBe("false");
    });

    it("a tela some com duas folhas abertas: a rolagem é liberada", async () => {
      await montar({ a: true, b: true });
      expect(travado()).toBe(true);

      act(() => raiz.unmount());
      expect(travado()).toBe(false);
      expect(document.body.style.pointerEvents).toBe("");
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      // O afterEach desmonta de novo: a raiz já foi, então recria uma vazia.
      raiz = createRoot(hospedeiro);
    });
  });

  describe("Esc em camadas empilhadas", () => {
    it("fecha só a do topo; o segundo Esc fecha a de baixo", async () => {
      let fechadas: string[] = [];
      function Pilha({ a, b }: { a: boolean; b: boolean }) {
        return (
          <>
            <Sheet
              open={a}
              onOpenChange={(o) => {
                if (!o) fechadas = [...fechadas, "A"];
              }}
            >
              <SheetContent side="bottom" showCloseButton={false}>
                <SheetTitle>Folha A</SheetTitle>
                <SheetDescription>Descrição A</SheetDescription>
              </SheetContent>
            </Sheet>
            <Sheet
              open={b}
              onOpenChange={(o) => {
                if (!o) fechadas = [...fechadas, "B"];
              }}
            >
              <SheetContent side="bottom" showCloseButton={false}>
                <SheetTitle>Folha B</SheetTitle>
                <SheetDescription>Descrição B</SheetDescription>
              </SheetContent>
            </Sheet>
          </>
        );
      }

      await act(async () => {
        raiz.render(<Pilha a b />);
      });
      await esc();
      expect(fechadas).toEqual(["B"]);

      await act(async () => {
        raiz.render(<Pilha a b={false} />);
      });
      await esc();
      expect(fechadas).toEqual(["B", "A"]);
    });
  });

  describe("useHaCamadaAberta — o que conta como camada", () => {
    const anexarAoCorpo = (
      atributos: Record<string, string>,
      aninhar = false,
    ) => {
      const no = document.createElement("div");
      no.setAttribute("data-teste-camada", "");
      for (const [nome, valor] of Object.entries(atributos)) {
        no.setAttribute(nome, valor);
      }
      if (aninhar) {
        const casca = document.createElement("div");
        casca.setAttribute("data-teste-camada", "");
        casca.appendChild(no);
        document.body.appendChild(casca);
        return casca;
      }
      document.body.appendChild(no);
      return no;
    };

    it("diálogo próprio com aria-modal=true direto no corpo liga o sinal, e some quando sai", async () => {
      await montar({});
      expect(sonda()).toBe("false");

      let no!: HTMLElement;
      act(() => {
        no = anexarAoCorpo({ role: "dialog", "aria-modal": "true" });
      });
      await esperarObservador();
      expect(sonda()).toBe("true");

      act(() => no.remove());
      await esperarObservador();
      expect(sonda()).toBe("false");
    });

    it("ao desmontar a tela, o observador do corpo é desligado (sem vazar)", async () => {
      const desligar = vi.spyOn(MutationObserver.prototype, "disconnect");
      try {
        await montar({});
        const antes = desligar.mock.calls.length;
        act(() => raiz.unmount());
        expect(desligar.mock.calls.length).toBeGreaterThan(antes);
      } finally {
        desligar.mockRestore();
        // O afterEach desmonta de novo: a raiz já foi, então recria uma vazia.
        raiz = createRoot(hospedeiro);
      }
    });

    it("aria-modal=false, sem role=dialog ou aninhado dentro de outro elemento NÃO conta", async () => {
      await montar({});
      act(() => {
        anexarAoCorpo({ role: "dialog", "aria-modal": "false" });
        anexarAoCorpo({ "aria-modal": "true" });
        anexarAoCorpo({ role: "dialog" });
        anexarAoCorpo({ role: "dialog", "aria-modal": "true" }, true);
      });
      await esperarObservador();
      expect(sonda()).toBe("false");
    });

    it("o atributo data-scroll-locked sozinho (sem nenhum nó novo) liga e desliga o sinal", async () => {
      await montar({});
      act(() => document.body.setAttribute("data-scroll-locked", "1"));
      await esperarObservador();
      expect(sonda()).toBe("true");

      act(() => document.body.removeAttribute("data-scroll-locked"));
      await esperarObservador();
      expect(sonda()).toBe("false");
    });
  });
});
