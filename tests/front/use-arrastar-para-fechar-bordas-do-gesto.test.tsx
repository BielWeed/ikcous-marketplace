// @vitest-environment jsdom
//
// As BORDAS do gesto de arrastar a alça (src/hooks/useArrastarParaFechar.ts)
// que o teste principal (use-arrastar-para-fechar.test.tsx) não via: cada uma
// sobrevivia à remoção da guarda (caçada por mutação, 24/11/2026).
//   - botão direito/auxiliar não inicia gesto; outro dedo (outro pointerId) não
//     move nem solta o gesto de quem apertou;
//   - 8 px exatos ainda é toque (o clique seguinte fecha); 9 px já é arrasto
//     (o clique sintético é engolido);
//   - arrastar para CIMA não levanta a folha (deslocamento nunca negativo);
//   - gaveta lateral colada no topo e navegador sem `translate` não iniciam
//     gesto; a entrada (animate-in) em curso é concluída ao apertar;
//   - o véu sem `data-state` não é animado; o véu sai da cena junto com a
//     folha e volta quando a folha recusa fechar;
//   - folha que o dono fechou/desmontou de verdade não ganha "volta" depois;
//   - depois de soltar, o gesto acabou: mover, soltar ou cancelar de novo não
//     reescreve a folha, e um quadro pendente não escreve depois do fim;
//   - `zerarGuarda` solta o clique que seria engolido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useArrastarParaFechar } from "@/hooks/useArrastarParaFechar";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Folha({
  aoFechar,
  veuComEstado = true,
}: {
  aoFechar: () => void;
  veuComEstado?: boolean;
}) {
  const arrasto = useArrastarParaFechar(aoFechar);
  return (
    <>
      <div data-testid="veu" data-state={veuComEstado ? "open" : undefined} />
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
        <button
          type="button"
          data-testid="zerar"
          onClick={() => arrasto.zerarGuarda()}
        />
      </div>
    </>
  );
}

type Chamada = { alvo: HTMLElement; quadros: Keyframe[] };
let chamadas: Chamada[];
let terminar: (() => void)[];
let cancelados: number;

function instalarAnimateFalso() {
  chamadas = [];
  terminar = [];
  cancelados = 0;
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    quadros: Keyframe[] | PropertyIndexedKeyframes | null,
  ) {
    chamadas.push({ alvo: this, quadros: quadros as Keyframe[] });
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
  } as typeof HTMLElement.prototype.animate;
}

let hospedeiro: HTMLElement;
let raiz: Root;
let aoFechar: Mock<() => void>;

const q = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const alca = () => q("alca");
const folha = () => q("folha");
const veu = () => q("veu");

function evento(
  tipo: string,
  y: number,
  extra: { button?: number; pointerId?: number } = {},
) {
  const e = new MouseEvent(tipo, {
    bubbles: true,
    clientY: y,
    button: extra.button ?? 0,
  });
  if (extra.pointerId !== undefined) {
    Object.defineProperty(e, "pointerId", { value: extra.pointerId });
  }
  return e;
}

const proximoQuadro = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });

async function montar(props: { veuComEstado?: boolean } = {}) {
  aoFechar = vi.fn<() => void>();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Folha aoFechar={aoFechar} {...props} />);
  });
}

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  // biome-ignore lint/performance/noDelete: restaura o protótipo do jsdom
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useArrastarParaFechar — quem pode iniciar e conduzir o gesto", () => {
  it("botão direito (button=2) na alça não inicia gesto", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100, { button: 2 }));
      window.dispatchEvent(evento("pointermove", 300));
    });
    await proximoQuadro();
    expect(folha().style.willChange).toBe("");
    expect(folha().style.translate).toBe("");
    await act(async () => window.dispatchEvent(evento("pointerup", 300)));
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("outro dedo (outro pointerId) não move a folha de quem apertou", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100, { pointerId: 1 }));
      window.dispatchEvent(evento("pointermove", 300, { pointerId: 2 }));
    });
    await proximoQuadro();
    expect(folha().style.translate).toBe("");

    await act(async () => {
      window.dispatchEvent(evento("pointermove", 130, { pointerId: 1 }));
    });
    await proximoQuadro();
    expect(folha().style.translate).toBe("0 30px");
    await act(async () =>
      window.dispatchEvent(evento("pointerup", 130, { pointerId: 1 })),
    );
  });

  it("outro dedo soltando longe NÃO fecha a folha; só o dedo que apertou decide", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100, { pointerId: 1 }));
      window.dispatchEvent(evento("pointermove", 120, { pointerId: 1 }));
    });
    await act(async () =>
      window.dispatchEvent(evento("pointerup", 400, { pointerId: 2 })),
    );
    expect(aoFechar).not.toHaveBeenCalled();
    // O gesto de quem apertou continua vivo: ele solta perto e a folha volta.
    expect(folha().style.willChange).toBe("translate");
    await act(async () =>
      window.dispatchEvent(evento("pointerup", 120, { pointerId: 1 })),
    );
    expect(aoFechar).not.toHaveBeenCalled();
    expect(folha().style.willChange).toBe("");
  });
});

describe("useArrastarParaFechar — o que conta como arrasto", () => {
  async function arrastarEClicar(ate: number) {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", ate));
      window.dispatchEvent(evento("pointerup", ate));
    });
    await act(async () => alca().click());
  }

  it("8 px exatos ainda é toque: o clique seguinte fecha a folha", async () => {
    await arrastarEClicar(108);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("9 px já é arrasto: o clique sintético que vem depois é engolido", async () => {
    await arrastarEClicar(109);
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("zerarGuarda solta o clique que seria engolido", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 130));
      window.dispatchEvent(evento("pointerup", 130));
    });
    await act(async () => q("zerar").click());
    await act(async () => alca().click());
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});

describe("useArrastarParaFechar — arrastar para cima", () => {
  it("o deslocamento nunca fica negativo: a folha não sobe além do repouso", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 60));
    });
    await proximoQuadro();
    expect(folha().style.translate).toBe("0 0px");
    await act(async () => window.dispatchEvent(evento("pointerup", 60)));
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("soltar acima de onde apertou devolve a partir do repouso (0), não de um valor negativo", async () => {
    instalarAnimateFalso();
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 60));
      window.dispatchEvent(evento("pointerup", 20));
    });
    expect(aoFechar).not.toHaveBeenCalled();
    const volta = chamadas.at(-1);
    expect(volta?.quadros[0]).toEqual({ translate: "0 0px" });
  });
});

describe("useArrastarParaFechar — onde o gesto NÃO começa", () => {
  it("gaveta lateral colada no topo (top: 0): puxar para baixo não faz nada", async () => {
    await montar();
    folha().style.top = "0px";
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 300));
    });
    await proximoQuadro();
    expect(folha().style.willChange).toBe("");
    expect(folha().style.translate).toBe("");
    await act(async () => window.dispatchEvent(evento("pointerup", 300)));
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("navegador sem a propriedade `translate`: só o toque fecha, o arrasto é ignorado", async () => {
    vi.stubGlobal("CSS", { supports: () => false });
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 300));
    });
    await proximoQuadro();
    expect(folha().style.translate).toBe("");
    expect(folha().style.willChange).toBe("");
    await act(async () => window.dispatchEvent(evento("pointerup", 300)));
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("ao apertar, a animação de entrada ainda em curso é concluída (ganharia do deslocamento)", async () => {
    await montar();
    const terminar = vi.fn<() => void>();
    Object.defineProperty(folha(), "getAnimations", {
      value: () => [{ finish: terminar }, { finish: terminar }],
      configurable: true,
    });
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
    });
    expect(terminar).toHaveBeenCalledTimes(2);
    await act(async () => window.dispatchEvent(evento("pointerup", 100)));
  });
});

describe("useArrastarParaFechar — o véu e a folha que não fecha", () => {
  beforeEach(() => {
    instalarAnimateFalso();
    vi.useFakeTimers();
  });

  const soltarLonge = () =>
    act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 250));
      window.dispatchEvent(evento("pointerup", 250));
    });

  it("véu sem data-state não é animado, e a folha desce do mesmo jeito", async () => {
    await montar({ veuComEstado: false });
    await soltarLonge();
    expect(chamadas.some((c) => c.alvo === veu())).toBe(false);
    expect(chamadas.some((c) => c.alvo === folha())).toBe(true);
    await act(async () => terminar[0]());
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(veu().style.animationName).toBe("none");
  });

  it("véu com data-state some junto e tem a saída do Radix cortada no fecho", async () => {
    await montar();
    await soltarLonge();
    const nele = chamadas.filter((c) => c.alvo === veu());
    expect(nele).toHaveLength(1);
    expect(nele[0].quadros).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    await act(async () => terminar[0]());
    expect(veu().style.animationName).toBe("none");
  });

  it("quem abriu recusa fechar: o véu também volta (animação do véu cancelada, saída do Radix religada)", async () => {
    await montar();
    await soltarLonge();
    await act(async () => terminar[0]());
    expect(veu().style.animationName).toBe("none");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Duas animações seguradas (folha e véu) foram canceladas.
    expect(cancelados).toBe(2);
    expect(veu().style.animationName).toBe("");
    expect(folha().style.animationName).toBe("");
  });

  it("o dono fechou de verdade (data-state=closed): nenhuma 'volta' é inventada depois", async () => {
    await montar();
    aoFechar.mockImplementation(() => {
      folha().dataset.state = "closed";
    });
    await soltarLonge();
    const antes = chamadas.length;
    await act(async () => terminar[0]());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(cancelados).toBe(0);
    expect(chamadas.length).toBe(antes);
  });

  it("a folha saiu do DOM ao fechar: nenhuma 'volta' é inventada depois", async () => {
    await montar();
    const noDaFolha = folha();
    aoFechar.mockImplementation(() => {
      noDaFolha.remove();
    });
    await soltarLonge();
    const antes = chamadas.length;
    await act(async () => terminar[0]());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(cancelados).toBe(0);
    expect(chamadas.length).toBe(antes);
    hospedeiro.appendChild(noDaFolha);
  });
});

describe("useArrastarParaFechar — depois de soltar, o gesto acabou", () => {
  it("mover o dedo depois de soltar não reescreve a folha", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 130));
    });
    // O quadro da escrita já passou: nada pendente que segure o ouvinte inerte.
    await proximoQuadro();
    await act(async () => window.dispatchEvent(evento("pointerup", 130)));
    expect(folha().style.translate).toBe("");
    await act(async () => window.dispatchEvent(evento("pointermove", 300)));
    await proximoQuadro();
    expect(folha().style.translate).toBe("");
    expect(folha().style.willChange).toBe("");
  });

  it("um segundo pointerup depois de fechar não fecha de novo", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 250));
      window.dispatchEvent(evento("pointerup", 250));
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(evento("pointerup", 400)));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("um pointercancel depois de soltar não dispara outra 'volta'", async () => {
    instalarAnimateFalso();
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      window.dispatchEvent(evento("pointermove", 130));
      window.dispatchEvent(evento("pointerup", 130));
    });
    const antes = chamadas.length;
    await act(async () => window.dispatchEvent(evento("pointercancel", 130)));
    expect(chamadas.length).toBe(antes);
  });

  it("quadro pendente no instante de soltar não escreve depois do fim do gesto", async () => {
    await montar();
    await act(async () => {
      alca().dispatchEvent(evento("pointerdown", 100));
      // O move agenda a escrita para o próximo quadro; o dedo solta antes dele.
      window.dispatchEvent(evento("pointermove", 140));
      window.dispatchEvent(evento("pointerup", 140));
    });
    await proximoQuadro();
    expect(folha().style.translate).toBe("");
  });
});
