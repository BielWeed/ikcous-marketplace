// @vitest-environment jsdom
//
// O gesto compartilhado de arrastar a alça de uma folha inferior
// (src/hooks/useArrastarParaFechar.ts). Defeito medido no Chromium (toque real,
// 24/11/2026): soltar além do limite zerava o transform ANTES de fechar e a
// folha PULAVA de volta ao repouso (660 -> 510 px) antes de descer. O jsdom não
// desenha, então o teste prova a ORDEM e a POSIÇÃO com um `animate` de mentira:
// a descida parte de onde o dedo largou, o `aoFechar` só roda no fim dela, e
// folha que o dono recusa fechar volta ao lugar em vez de sumir da tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useArrastarParaFechar } from "@/hooks/useArrastarParaFechar";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renders = 0;
function Folha({ aoFechar }: { aoFechar: () => void }) {
  renders++;
  const arrasto = useArrastarParaFechar(aoFechar);
  return (
    <>
      <div data-testid="veu" data-state="open" />
      <div role="dialog" data-state="open" data-testid="folha">
        <button
          type="button"
          data-testid="alca"
          onPointerDown={arrasto.aoApertar}
          onClick={() => {
            if (arrasto.engoliuClique()) return;
            aoFechar();
          }}
        />
      </div>
    </>
  );
}

type Chamada = { quadros: Keyframe[]; opcoes: KeyframeAnimationOptions };
let chamadas: Chamada[];
let terminar: (() => void)[];
let cancelados: number;

function instalarAnimateFalso() {
  chamadas = [];
  terminar = [];
  cancelados = 0;
  HTMLElement.prototype.animate = ((
    quadros: Keyframe[] | PropertyIndexedKeyframes | null,
    opcoes?: number | KeyframeAnimationOptions,
  ) => {
    chamadas.push({
      quadros: quadros as Keyframe[],
      opcoes: opcoes as KeyframeAnimationOptions,
    });
    const a = {
      onfinish: null as null | (() => void),
      oncancel: null as null | (() => void),
      cancel() {
        cancelados++;
        a.oncancel?.();
      },
    };
    terminar.push(() => a.onfinish?.());
    return a as unknown as Animation;
  }) as typeof HTMLElement.prototype.animate;
}

let hospedeiro: HTMLElement;
let raiz: Root;
let aoFechar: ReturnType<typeof vi.fn>;

const alca = () => document.querySelector<HTMLElement>('[data-testid="alca"]')!;
const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha"]')!;
const evento = (tipo: string, y: number) =>
  new MouseEvent(tipo, { bubbles: true, clientY: y });
const proximoQuadro = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });

async function montar() {
  aoFechar = vi.fn();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Folha aoFechar={aoFechar} />);
  });
}

beforeEach(() => {
  renders = 0;
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  // biome-ignore lint/performance/noDelete: restaura o protótipo do jsdom
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  vi.useRealTimers();
});

describe("useArrastarParaFechar — sem animação disponível (jsdom)", () => {
  it("além de 64px fecha na hora e não deixa resíduo de estilo", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 200));
      window.dispatchEvent(evento("pointerup", 190));
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("exatamente 64px NÃO fecha, e o estilo volta ao vazio", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 164));
      window.dispatchEvent(evento("pointerup", 164));
    });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(folha().style.transform).toBe("");
    expect(folha().style.transitionProperty).toBe("");
    expect(folha().style.willChange).toBe("");
  });

  it("pointercancel nunca fecha, mesmo com o dedo longe", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 400));
      window.dispatchEvent(evento("pointercancel", 400));
    });
    expect(aoFechar).not.toHaveBeenCalled();
    expect(folha().style.transform).toBe("");
  });

  it("o clique sintético pós-arrasto é engolido uma vez só; o teclado seguinte fecha", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 130));
      window.dispatchEvent(evento("pointerup", 130));
    });
    await act(async () => alca().click());
    expect(aoFechar).not.toHaveBeenCalled();
    await act(async () => alca().click());
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("mover o dedo NÃO re-renderiza o componente (nenhum setState no move)", async () => {
    await montar();
    const antes = renders;
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      for (let y = 101; y < 180; y += 3) {
        window.dispatchEvent(evento("pointermove", y));
      }
    });
    await proximoQuadro();
    expect(renders).toBe(antes);
    await act(async () => window.dispatchEvent(evento("pointerup", 120)));
  });

  it("vários moves no mesmo quadro viram UMA escrita de estilo, com o último valor", async () => {
    await montar();
    const escritas: string[] = [];
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
    });
    const el = folha();
    const mo = new MutationObserver(() => {
      escritas.push(el.style.transform);
    });
    mo.observe(el, { attributes: true, attributeFilter: ["style"] });
    await act(async () => {
      for (const y of [110, 120, 130, 140]) {
        window.dispatchEvent(evento("pointermove", y));
      }
    });
    await proximoQuadro();
    await Promise.resolve();
    mo.disconnect();
    expect(escritas.filter((t) => t.startsWith("translate3d"))).toEqual([
      "translate3d(0,40px,0)",
    ]);
    await act(async () => window.dispatchEvent(evento("pointerup", 100)));
  });

  it("alça de folha já fechada (data-state=closed) não inicia gesto", async () => {
    await montar();
    folha().dataset.state = "closed";
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 300));
    });
    await proximoQuadro();
    expect(folha().style.willChange).toBe("");
    expect(folha().style.transform).toBe("");
  });
});

describe("useArrastarParaFechar — com animação (navegador de verdade)", () => {
  beforeEach(() => {
    instalarAnimateFalso();
  });

  it("soltar além do limite DESCE da posição do dedo (nunca do repouso) e só fecha no fim da descida", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 250));
    });
    expect(folha().style.willChange).toBe("transform");
    await act(async () => window.dispatchEvent(evento("pointerup", 250)));

    const descida = chamadas.find((c) =>
      JSON.stringify(c.quadros).includes("100%"),
    );
    expect(descida).toBeDefined();
    // parte de 150px, não de 0 — o pulo de volta ao repouso era o defeito.
    expect(descida!.quadros[0]).toEqual({
      transform: "translate3d(0,150px,0)",
    });
    expect(descida!.opcoes.fill).toBe("forwards");
    // o véu some junto
    expect(
      chamadas.some((c) => JSON.stringify(c.quadros).includes('"opacity":0')),
    ).toBe(true);
    // ainda descendo: não fechou
    expect(aoFechar).not.toHaveBeenCalled();
    await act(async () => terminar[0]());
    expect(aoFechar).toHaveBeenCalledTimes(1);
    // e a saída do Radix, invisível, é cortada para a página destravar já
    expect(folha().style.animationName).toBe("none");
  });

  it("não fecha duas vezes se a animação termina E o relógio de segurança dispara", async () => {
    vi.useFakeTimers();
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 250));
      window.dispatchEvent(evento("pointerup", 250));
    });
    await act(async () => terminar[0]());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("aba escondida (a animação nunca termina): o relógio de segurança fecha", async () => {
    vi.useFakeTimers();
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 250));
      window.dispatchEvent(evento("pointerup", 250));
    });
    expect(aoFechar).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("quem abriu RECUSA fechar: a folha volta ao lugar, não fica presa fora da tela", async () => {
    vi.useFakeTimers();
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 250));
      window.dispatchEvent(evento("pointerup", 250));
    });
    await act(async () => terminar[0]());
    expect(aoFechar).toHaveBeenCalledTimes(1);
    // a folha continua no DOM, aberta (a pergunta de descarte, p.ex.)
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(cancelados).toBeGreaterThanOrEqual(1);
    expect(folha().style.animationName).toBe("");
    const volta = chamadas[chamadas.length - 1];
    expect(volta.quadros).toEqual([
      { transform: "translate3d(0,100%,0)" },
      { transform: "translate3d(0,0,0)" },
    ]);
    expect(volta.opcoes.fill).toBe("none");
  });

  it("soltar antes do limite devolve da posição atual, sem fill (não trava a saída futura) e mantém a transição CSS desligada até acabar", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 140));
      window.dispatchEvent(evento("pointerup", 140));
    });
    expect(aoFechar).not.toHaveBeenCalled();
    const volta = chamadas[chamadas.length - 1];
    expect(volta.quadros[0]).toEqual({ transform: "translate3d(0,40px,0)" });
    expect(volta.opcoes.fill).toBe("none");
    expect(folha().style.transitionProperty).toBe("none");
    await act(async () => terminar[0]());
    expect(folha().style.transitionProperty).toBe("");
    expect(folha().style.willChange).toBe("");
  });
});
