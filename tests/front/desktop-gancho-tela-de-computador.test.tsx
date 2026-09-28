// @vitest-environment jsdom
//
// Onda 0 do plano app-cliente-desktop (F1.1, contrato C1): o gancho ÚNICO de
// largura que decide se a casca deve olhar como "computador" (>=1024px). É
// dele que TODA a Onda 1 depende -- nenhuma outra frente pode ler
// `matchMedia`/`useMediaQuery` com min-width/max-width (guarda em
// desktop-um-so-leitor-de-largura.test.ts).
//
// POR QUE `useSyncExternalStore` E NÃO `useState` + `useEffect`: o valor
// certo tem de chegar já no PRIMEIRO render. Se ficasse atrás de um efeito
// (como o `useMediaQuery` legado, de propósito, R8 da spec), a casca
// nasceria "de celular" e pularia para desktop um instante depois -- o
// próprio defeito que este contrato existe para evitar.
//
// `createRoot` + `act` do React puro, sem `@testing-library/react` (não
// instalado neste projeto) -- mesmo padrão de use-online-status-*.test.tsx.
import {
  CONSULTA_TELA_DE_COMPUTADOR,
  ehTelaDeComputador,
  useTelaDeComputador,
} from "@/hooks/useTelaDeComputador";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de hook deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda({ valores }: { valores?: boolean[] } = {}) {
  const computador = useTelaDeComputador();
  // Empilha o valor de CADA execução do corpo do componente -- inclusive as
  // que rodam antes de qualquer efeito ser flushado. É o que permite
  // distinguir "o valor certo já nasceu no 1º render" de "o valor nasceu
  // errado e um efeito corrigiu depois" (ver o teste que usa isto abaixo).
  valores?.push(computador);
  return <span data-testid="computador">{String(computador)}</span>;
}

describe("useTelaDeComputador — gancho único de largura (C1)", () => {
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
    vi.unstubAllGlobals();
  });

  function lido(): string {
    return (document.querySelector('[data-testid="computador"]') as HTMLElement)
      .textContent as string;
  }

  it("a consulta exportada é exatamente '(min-width: 1024px)'", () => {
    expect(CONSULTA_TELA_DE_COMPUTADOR).toBe("(min-width: 1024px)");
  });

  it("sem matchMedia: false, e nem o gancho nem a função pura lançam", () => {
    expect(() => ehTelaDeComputador()).not.toThrow();
    expect(ehTelaDeComputador()).toBe(false);

    expect(() =>
      act(() => {
        raiz.render(<Sonda />);
      }),
    ).not.toThrow();
    expect(lido()).toBe("false");
  });

  it("com stub matches:true, o valor certo já chega no PRIMEIRO render — nem por uma execução passa por false (revisão: o act() abaixo flusharia um efeito corretor antes de qualquer leitura do DOM, então só um array preenchido DURANTE o render, não o DOM final, prova a ordem)", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: true,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const valores: boolean[] = [];
    act(() => {
      raiz.render(<Sonda valores={valores} />);
    });

    // valores[0] é o resultado da 1ª execução do corpo do componente. Um
    // `useState(false)` + `useEffect(() => setState(mq.matches))` (o padrão
    // do `useMediaQuery` legado que este contrato proíbe) empilharia `false`
    // aqui e só chegaria a `true` numa 2ª execução, disparada pelo efeito --
    // o `act()` já teria flushado esse efeito antes deste `expect` rodar,
    // então `valores` viraria `[false, true]` e `lido()` mentiria "true" de
    // qualquer jeito. `useSyncExternalStore` lê a `getSnapshot` já na 1ª
    // execução: `valores` fica `[true]`.
    expect(valores[0]).toBe(true);
    expect(lido()).toBe("true");
  });

  it("chama matchMedia com a consulta exata do contrato", () => {
    const matchMediaMock = vi.fn((consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);

    act(() => {
      raiz.render(<Sonda />);
    });

    expect(matchMediaMock).toHaveBeenCalledWith("(min-width: 1024px)");
  });

  it("disparar 'change' no matchMedia re-renderiza com o valor novo", () => {
    let ouvinte: ((evento: MediaQueryListEvent) => void) | null = null;
    const consultaFalsa = { matches: false };
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      get matches() {
        return consultaFalsa.matches;
      },
      media: consulta,
      addEventListener: (
        _tipo: string,
        cb: (e: MediaQueryListEvent) => void,
      ) => {
        ouvinte = cb;
      },
      removeEventListener: () => {},
    }));

    act(() => {
      raiz.render(<Sonda />);
    });
    expect(lido()).toBe("false");

    consultaFalsa.matches = true;
    act(() => {
      ouvinte?.({ matches: true } as MediaQueryListEvent);
    });

    expect(lido()).toBe("true");
  });

  it("ehTelaDeComputador() concorda com o gancho, sob o mesmo stub", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: true,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    act(() => {
      raiz.render(<Sonda />);
    });

    expect(lido()).toBe(String(ehTelaDeComputador()));
    expect(ehTelaDeComputador()).toBe(true);
  });

  it("stub sem addEventListener não quebra a montagem nem a desmontagem", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: true,
      media: consulta,
    }));

    expect(() =>
      act(() => {
        raiz.render(<Sonda />);
      }),
    ).not.toThrow();
    expect(lido()).toBe("true");
  });
});
