// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui: o guardião do clique pós-fecho
// da folha (`SheetContent`, src/components/ui/sheet.tsx) ainda tinha sete
// pontos em que plantar o defeito não reprovava teste nenhum. Os testes
// vizinhos (sheet-clique-fora… e sheet-guardiao-do-clique-janela…) cobrem UM
// gesto por vez; os defeitos escondidos estavam em quem vem DEPOIS do primeiro
// gesto:
//   1. A folha fechou e saiu da tela: ninguém mais pode estar escutando o
//      "soltar o dedo" da página. Uma escuta esquecida engolia TODO clique do
//      app dali em diante (cada clique termina num "soltar").
//   2. Dois gestos seguidos fora da folha: os DOIS cliques são engolidos (a
//      escuta velha do primeiro gesto desarmava o guardião do segundo).
//   3. O relógio velho do primeiro guardião não pode matar o guardião novo.
//   4. A janela de 450 ms vale exatamente: 449 ms ainda engole; 450 ms já passa.
//   5. Gesto que termina fora ("soltar") também arma o guardião, mesmo que
//      outro código da página interrompa o evento no caminho.
//   6. Folha que não sabe fechar por fora, no mouse: o clique do fundo é
//      engolido do mesmo jeito.
//   7. Fechar é uma vez só: no mouse quem fecha é a biblioteca (o guardião só
//      engole); no toque quem fecha é o guardião (e a biblioteca não repete).
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Conteudo() {
  return (
    <SheetContent side="bottom">
      <SheetTitle>Folha</SheetTitle>
      <SheetDescription>Prova do guardião.</SheetDescription>
    </SheetContent>
  );
}

// Folha controlada: o fecho por fora DESMONTA a folha.
function FolhaQueFecha() {
  const [aberta, setAberta] = useState(true);
  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <Conteudo />
    </Sheet>
  );
}

describe("Sheet — guardião do clique depois do primeiro gesto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const folha = () => document.querySelector('[data-slot="sheet-content"]');
  const veu = () => document.querySelector('[data-slot="sheet-overlay"]');
  const titulo = () => document.querySelector('[data-slot="sheet-title"]');
  const fundo = () =>
    hospedeiro.querySelector<HTMLButtonElement>('button[data-testid="fundo"]')!;
  const passar = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });

  async function montar(
    spyFundo: () => void,
    folhaDeProva: React.ReactElement,
  ) {
    await act(async () => {
      raiz.render(
        <>
          <button type="button" data-testid="fundo" onClick={spyFundo}>
            Fundo
          </button>
          {folhaDeProva}
        </>,
      );
    });
    // O Radix instala o pointerdown dentro de um setTimeout(0).
    await passar(10);
  }

  function evento(
    tipo: "pointerdown" | "pointerup",
    alvo: () => Element | null,
    ponteiro: "touch" | "mouse",
  ) {
    return act(async () => {
      const e = new MouseEvent(tipo, { bubbles: true });
      Object.defineProperty(e, "pointerType", { value: ponteiro });
      alvo()?.dispatchEvent(e);
    });
  }
  const gesto = (alvo: () => Element | null, ponteiro: "touch" | "mouse") =>
    evento("pointerdown", alvo, ponteiro);
  const soltar = (alvo: () => Element | null, ponteiro: "touch" | "mouse") =>
    evento("pointerup", alvo, ponteiro);
  const clicar = (alvo: () => Element | null) =>
    act(async () => {
      alvo()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  it("folha fechada e fora da tela: gestos e cliques seguintes do app passam normalmente", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(spyFundo, <FolhaQueFecha />);

    await gesto(veu, "mouse");
    expect(folha()).toBeNull();
    await passar(600); // o guardião do fecho já expirou
    // Um clique inteiro no app, com o "soltar" no meio, como o navegador faz.
    await gesto(fundo, "mouse");
    await soltar(fundo, "mouse");
    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
  });

  it("dois gestos seguidos fora da folha: os DOIS cliques são engolidos", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(
      spyFundo,
      <Sheet open>
        <Conteudo />
      </Sheet>,
    );

    await gesto(veu, "mouse");
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();

    await gesto(veu, "mouse");
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
    expect(folha()).not.toBeNull();
  });

  it("o relógio do guardião antigo não desarma o guardião do gesto novo", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(
      spyFundo,
      <Sheet open>
        <Conteudo />
      </Sheet>,
    );

    // t=0 arma o primeiro guardião (relógio até 450 ms); t=100 o clique o gasta.
    await gesto(veu, "mouse");
    await passar(100);
    await clicar(fundo);
    // t=300 arma o segundo (relógio até 750 ms).
    await passar(200);
    await gesto(veu, "mouse");
    // t=460: o relógio do PRIMEIRO já passou de 450 e não pode ter levado o segundo.
    await passar(160);
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
  });

  it("a janela é de 450 ms: aos 449 ms o clique ainda é engolido", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(spyFundo, <FolhaQueFecha />);

    await gesto(veu, "mouse");
    expect(folha()).toBeNull();
    await passar(449);
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
  });

  it("a janela é de 450 ms: aos 450 ms o guardião já expirou e o clique passa", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(spyFundo, <FolhaQueFecha />);

    await gesto(veu, "mouse");
    expect(folha()).toBeNull();
    await passar(450);
    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
  });

  it("gesto que começou DENTRO e termina fora arma o guardião no 'soltar', mesmo com a página interrompendo o evento", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(
      spyFundo,
      <Sheet open>
        <Conteudo />
      </Sheet>,
    );
    // Código da página que interrompe o "soltar" no próprio botão de fundo.
    const interromper = (e: Event) => e.stopPropagation();
    fundo().addEventListener("pointerup", interromper);

    await gesto(titulo, "mouse"); // nasceu dentro: não arma
    await soltar(fundo, "mouse"); // terminou fora: arma (captura vem antes)
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
    fundo().removeEventListener("pointerup", interromper);
  });

  it("folha SEM onOpenChange, no mouse: o clique do fundo é engolido e a folha fica", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(
      spyFundo,
      <Sheet open>
        <Conteudo />
      </Sheet>,
    );

    await gesto(veu, "mouse");
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
    expect(folha()).not.toBeNull();
  });

  it("mouse: a folha é fechada UMA vez só (a biblioteca fecha, o guardião só engole)", async () => {
    const spyFundo = vi.fn<() => void>();
    const aoMudar = vi.fn<(aberta: boolean) => void>();
    await montar(
      spyFundo,
      // Controlada e travada aberta: conta quantas vezes pediram para fechar.
      <Sheet open onOpenChange={aoMudar}>
        <Conteudo />
      </Sheet>,
    );

    await gesto(veu, "mouse");
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledWith(false);
  });

  it("toque: a folha é fechada UMA vez só (o guardião fecha e engole o clique)", async () => {
    const spyFundo = vi.fn<() => void>();
    const aoMudar = vi.fn<(aberta: boolean) => void>();
    await montar(
      spyFundo,
      <Sheet open onOpenChange={aoMudar}>
        <Conteudo />
      </Sheet>,
    );

    await gesto(veu, "touch");
    await clicar(fundo);
    expect(spyFundo).not.toHaveBeenCalled();
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledWith(false);
  });
});
