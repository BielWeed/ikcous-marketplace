// @vitest-environment jsdom
//
// "CLICAR FORA TEM QUE SÓ FECHAR" (14/09 — relato do dono ao vivo no app):
// o clique que fecha a folha de opções não pode ATINGIR o conteúdo de fundo.
// Mecanismo medido (ao vivo, com espião de captura no document): o Radix
// (@radix-ui/react-dialog 1.1.15 → dismissable-layer 1.1.11) dispara o
// dismiss no POINTERDOWN (para toque, adia para o próprio click); na janela
// do fecho o véu/folha saem do DOM, o body é destravado, e o CLICK
// sintetizado do mesmo gesto cai no elemento que ficou por baixo — o dono
// viu o card de fundo abrir o produto (pushState 1 ms depois do click).
//
// O conserto (guardião do clique pós-fecho, genérico no SheetContent) mora
// no sheet.tsx; este arquivo prova o CONTRATO no Sheet GENÉRICO:
//   1. mouse: clique fora fecha E o fundo NÃO recebe o click que atravessa;
//   2. toque: o fecho por toque continua fechando (o guardião não pode
//      engolir o click de que o Radix precisa para fechar no toque);
//   3. clique dentro de folha viva nunca é engolido;
//   4. folha reaberta: clique dentro funciona de primeira.
// Os cenários ponta a ponta com o CARD (clique fora e pós-arrasto da alça)
// estão em product-card-escolhe-opcoes-na-folha.test.tsx — o arrasto que
// fecha é lógica da folha do card, não do base.
// jsdom não anima: o fecho é instantâneo — exatamente a janela do
// atravessamento (reduced-motion/fecho sem animação é onde o dono viu).
import { act } from "react";
import { useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Folha controlada de verdade (open + onOpenChange mudando estado): o fecho
// precisa DESMONTAR a folha — `<Sheet open onOpenChange={() => {}}>` ignora
// o dismiss e nunca reproduziria a janela do atravessamento. Os controles
// são registrados no teste para reabrir por gesto de prova.
function PainelDeProva({
  spyDentro,
  registrarControles,
}: {
  spyDentro: () => void;
  registrarControles: (controles: { abrir: () => void }) => void;
}) {
  const [aberta, setAberta] = useState(true);
  registrarControles({ abrir: () => setAberta(true) });
  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <SheetContent side="bottom" data-testid="folha-de-prova">
        <SheetTitle>Folha</SheetTitle>
        <SheetDescription>Prova do fecho puro.</SheetDescription>
        <button onClick={spyDentro}>Botão dentro</button>
      </SheetContent>
    </Sheet>
  );
}

describe("Sheet — clique fora tem que SÓ fechar (nada atravessa o véu)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  // O fundo espiado é irmão do painel no hospedeiro (a folha é portal no
  // body). Um click que "atravessa" chega a ele — o mesmo caminho do wrapper
  // clicável do ProductCard na tela real.
  async function montarCena(spyFundo: () => void, spyDentro: () => void) {
    let abrir: (() => void) | null = null;
    await act(async () => {
      raiz.render(
        <>
          <button data-testid="fundo" onClick={spyFundo}>
            Fundo
          </button>
          <PainelDeProva
            spyDentro={spyDentro}
            registrarControles={(controles) => {
              abrir = controles.abrir;
            }}
          />
        </>,
      );
    });
    // A atribuição acontece no render (dentro do act acima): ao sair daqui,
    // o controle já existe.
    return abrir as unknown as () => void;
  }

  const folha = () => document.querySelector('[data-slot="sheet-content"]');
  const veu = () => document.querySelector('[data-slot="sheet-overlay"]');
  const fundo = () =>
    hospedeiro.querySelector<HTMLButtonElement>('button[data-testid="fundo"]')!;
  const botaoDentro = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Botão dentro",
    )!;

  // O Radix instala o listener de pointerdown dentro de um setTimeout(0)
  // (medido no dist do dismissable-layer): sem deixar o loop de eventos
  // girar, o gesto de prova acontece antes de o Radix estar escutando.
  const espera = (ms: number) =>
    new Promise((resolver) => setTimeout(resolver, ms));

  // Primeiro evento do gesto de mouse FORA: pointerdown no véu — é aqui que
  // o Radix dispara o dismiss (e no jsdom, sem animação, a folha desmonta no
  // mesmo tick: a janela exata do atravessamento).
  async function pointerdownFora() {
    await act(async () => {
      veu()!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
  }

  it("mouse: clique fora SÓ fecha — o click que atravessa não ativa o fundo", async () => {
    const spyFundo = vi.fn();
    const spyDentro = vi.fn();
    await montarCena(spyFundo, spyDentro);
    await espera(10);
    expect(folha()).not.toBeNull();

    await pointerdownFora();
    // O fecho em si continua valendo...
    expect(folha()).toBeNull();
    // ...e o click sintetizado do mesmo gesto cai no FUNDO (foi o que ficou
    // por baixo do véu): o fundo NÃO pode recebê-lo.
    await act(async () => {
      fundo().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(spyFundo).not.toHaveBeenCalled();
  });

  it("toque: o fecho por TOQUE fora continua fechando — o guardião fecha por conta e engole o click", async () => {
    const spyFundo = vi.fn();
    const spyDentro = vi.fn();
    await montarCena(spyFundo, spyDentro);
    await espera(10);

    // No toque o Radix ADIA o dismiss para o próximo click (listener once no
    // document): o pointerdown com pointerType touch NÃO fecha ainda.
    await act(async () => {
      const baixou = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(baixou, "pointerType", { value: "touch" });
      veu()!.dispatchEvent(baixou);
    });
    expect(folha()).not.toBeNull();

    // O browser sintetiza o click no véu (ele ainda está vivo no hit-test):
    // é este click que PRECISA passar para o Radix fechar.
    await act(async () => {
      veu()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(folha()).toBeNull();
    expect(spyFundo).not.toHaveBeenCalled();
  });

  it("clique DENTRO da folha viva nunca é engolido (botão interno funciona)", async () => {
    const spyFundo = vi.fn();
    const spyDentro = vi.fn();
    await montarCena(spyFundo, spyDentro);
    await espera(10);

    // Gesto de toque fora arma o guardião (folha continua viva no toque)...
    await act(async () => {
      const baixou = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(baixou, "pointerType", { value: "touch" });
      veu()!.dispatchEvent(baixou);
    });
    // ...e o click cai DENTRO da folha: handler interno roda, ponto final.
    await act(async () => {
      botaoDentro().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(spyDentro).toHaveBeenCalledTimes(1);
  });

  it("toque: o fecho por TOQUE fora continua fechando — e o ANCESTRAL da folha não recebe o click (bug do dono, pós-1.33.1)", async () => {
    // CENÁRIO REAL do app: a folha nasce DENTRO do wrapper clicável do card
    // (ancestral dela na árvore React — o portal borbulha até ele). O dono
    // tocou fora da folha no celular e o app NAVEGOU para a tela do produto:
    // o ramo de toque do guardião fechava a folha mas deixava o click
    // atravessar até esse ancestral. Este teste monta o ANCESTRAL espiado
    // envolvendo a folha — exatamente a anatomia do ProductCard.
    const spyAncestral = vi.fn();
    const spyDentro = vi.fn();
    await act(async () => {
      raiz.render(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- mesmo padrão do wrapper do ProductCard: div clicável intencional (é o "fundo" que não pode receber o click)
        <div onClick={spyAncestral} data-testid="ancestral-clicavel">
          <PainelDeProva spyDentro={spyDentro} registrarControles={() => {}} />
        </div>,
      );
    });
    await espera(10);
    expect(folha()).not.toBeNull();

    // Toque fora: pointerdown (pointerType touch) arma o guardião e o Radix
    // ADIA o fecho para o click; o click do gesto cai no véu vivo.
    await act(async () => {
      const baixou = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(baixou, "pointerType", { value: "touch" });
      veu()!.dispatchEvent(baixou);
    });
    await act(async () => {
      veu()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // A folha fechou E o ancestral clicável NÃO recebeu o click (sem
    // navegação para a tela do produto).
    expect(folha()).toBeNull();
    expect(spyAncestral).not.toHaveBeenCalled();
  });

  it("folha reaberta: clique dentro funciona de primeira (guardião da janela anterior já morreu)", async () => {
    const spyFundo = vi.fn();
    const spyDentro = vi.fn();
    const abrir = await montarCena(spyFundo, spyDentro);
    await espera(10);

    // Fecha por fora (mouse) e reabre.
    await pointerdownFora();
    expect(folha()).toBeNull();
    await act(async () => {
      abrir();
    });
    expect(folha()).not.toBeNull();

    await act(async () => {
      botaoDentro().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(spyDentro).toHaveBeenCalledTimes(1);
  });
});
