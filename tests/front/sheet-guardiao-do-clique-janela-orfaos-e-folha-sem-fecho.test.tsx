// @vitest-environment jsdom
//
// O guardião do clique pós-fecho do `SheetContent` (src/components/ui/sheet.tsx),
// nas bordas que sheet-clique-fora-nao-atravessa-o-fundo.test.tsx não via --
// cada uma sobrevivia à remoção do ramo (caçada por mutação, 24/11/2026):
//   1. Folha que NÃO sabe fechar por fora (`<Sheet open>` sem onOpenChange):
//      no toque o clique passa como sempre passou (o guardião não o engole).
//   2. A janela de vida: passados ~450 ms do fecho, um clique no fundo é
//      legítimo e passa (o guardião expirou sozinho, sem listener órfão).
//   3. O próximo gesto (pointerdown) desarma o guardião ANTES do clique dele:
//      um clique legítimo logo depois do fecho não é engolido.
//   4. Um gesto que COMEÇA dentro da folha não arma o guardião.
//   5. Uma folha NOVA que monta mata os guardiões órfãos dos fechos anteriores.
// O contrato "clicar fora só fecha" em si fica no teste vizinho.
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

// Folha controlada: o fecho por fora DESMONTA (a janela do atravessamento).
function FolhaControlada({
  registrarAbrir,
}: {
  registrarAbrir: (abrir: () => void) => void;
}) {
  const [aberta, setAberta] = useState(true);
  registrarAbrir(() => setAberta(true));
  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <Conteudo />
    </Sheet>
  );
}

describe("Sheet — guardião do clique: janela, órfãos e folha sem fecho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
  });

  const folha = () => document.querySelector('[data-slot="sheet-content"]');
  const veu = () => document.querySelector('[data-slot="sheet-overlay"]');
  const fundo = () =>
    hospedeiro.querySelector<HTMLButtonElement>('button[data-testid="fundo"]')!;
  const espera = (ms: number) =>
    new Promise((resolver) => setTimeout(resolver, ms));

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
    await espera(10);
  }

  const gesto = (alvo: () => Element | null, tipo: "touch" | "mouse") =>
    act(async () => {
      const baixou = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(baixou, "pointerType", { value: tipo });
      alvo()?.dispatchEvent(baixou);
    });
  const clicar = (alvo: () => Element | null) =>
    act(async () => {
      alvo()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  it("folha SEM onOpenChange, no toque: o clique fora passa (não é engolido)", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(
      spyFundo,
      <Sheet open>
        <Conteudo />
      </Sheet>,
    );
    expect(folha()).not.toBeNull();

    await gesto(veu, "touch");
    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
    // E a folha, que não sabe fechar por fora, continua lá.
    expect(folha()).not.toBeNull();
  });

  it("gesto que COMEÇA dentro da folha não arma o guardião: o clique que termina fora passa", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(
      spyFundo,
      <Sheet open>
        <Conteudo />
      </Sheet>,
    );

    // Selecionar texto dentro da folha e soltar fora: o gesto nasceu dentro.
    await gesto(
      () => document.querySelector('[data-slot="sheet-title"]'),
      "mouse",
    );
    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
  });

  it("passada a janela do guardião, um clique no fundo é legítimo e passa", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(spyFundo, <FolhaControlada registrarAbrir={() => {}} />);

    await gesto(veu, "mouse");
    expect(folha()).toBeNull();
    // Dentro da janela o click atravessado morre (contrato do teste vizinho);
    // depois dela, o guardião já se desarmou sozinho.
    await act(async () => {
      await espera(600);
    });
    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
  });

  it("o gesto SEGUINTE desarma o guardião antes do clique dele", async () => {
    const spyFundo = vi.fn<() => void>();
    await montar(spyFundo, <FolhaControlada registrarAbrir={() => {}} />);

    await gesto(veu, "mouse");
    expect(folha()).toBeNull();
    // Novo gesto físico logo depois do fecho: pointerdown + click no fundo.
    await gesto(fundo, "mouse");
    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
  });

  it("uma folha NOVA que monta mata o guardião órfão do fecho anterior", async () => {
    const spyFundo = vi.fn<() => void>();
    const primeira = <FolhaControlada registrarAbrir={() => {}} />;
    await montar(spyFundo, primeira);

    await gesto(veu, "mouse");
    expect(folha()).toBeNull();
    // Outra folha monta NA janela (outro Sheet, outro SheetContent): o gesto
    // que a montou já é gesto novo e o órfão do fecho anterior morre.
    await montar(
      spyFundo,
      <>
        {primeira}
        <Sheet open>
          <Conteudo />
        </Sheet>
      </>,
    );
    expect(folha()).not.toBeNull();

    await clicar(fundo);
    expect(spyFundo).toHaveBeenCalledTimes(1);
  });
});
