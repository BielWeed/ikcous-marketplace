// @vitest-environment jsdom
//
// O topo do formulário de produto encolhe quando a lojista rola
// (`src/components/admin/products/useTopoCompacto.ts`). O que importa: a
// histerese (entra acima de 24 px, só sai em 8 px ou menos — sem isso o topo
// piscaria na fronteira), uma medição por quadro (não uma por evento de
// rolagem), a captura da rolagem de qualquer contêiner (o evento `scroll` não
// borbulha) e a limpeza ao desmontar (nada de ouvinte nem quadro pendurado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENTRA_PX,
  SAI_PX,
  useTopoCompacto,
} from "@/components/admin/products/useTopoCompacto";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let rolado = 0;

function Sonda({ ligarTopo = true }: { ligarTopo?: boolean }) {
  const { marca, topo, compacto } = useTopoCompacto();
  return (
    <div id="pagina">
      <div id="marca" ref={marca} />
      <header
        id="topo"
        ref={ligarTopo ? topo : undefined}
        data-compacto={String(compacto)}
      />
      <section id="conteudo" />
    </div>
  );
}

let host: HTMLElement;
let raiz: Root;
let quadros: Map<number, FrameRequestCallback>;
let proximoId: number;
let pedidos: number;
let cancelados: number[];

function topoCompacto(): string | undefined {
  return document.getElementById("topo")?.dataset.compacto;
}

function montar(props: { ligarTopo?: boolean } = {}) {
  act(() => {
    raiz.render(<Sonda {...props} />);
  });
}

/** Roda os quadros pendentes (o navegador chamando o requestAnimationFrame). */
function rodarQuadros() {
  const pendentes = [...quadros.entries()];
  quadros.clear();
  act(() => {
    for (const [, cb] of pendentes) cb(0);
  });
}

function rolarPara(px: number) {
  rolado = px;
  act(() => {
    document.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
  rodarQuadros();
}

beforeEach(() => {
  rolado = 0;
  quadros = new Map();
  proximoId = 1;
  pedidos = 0;
  cancelados = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = proximoId++;
    pedidos += 1;
    quadros.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelados.push(id);
    quadros.delete(id);
  });
  // A "marca" fica parada em 100 px da janela; o topo fica `rolado` px abaixo
  // dela. O que o gancho mede é a DIFERENÇA, não a posição de cada um.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        top: this.id === "topo" ? 100 + rolado : 100,
      } as unknown as DOMRect;
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useTopoCompacto — histerese", () => {
  it("os limites são 24 px para entrar e 8 px para sair", () => {
    expect(ENTRA_PX).toBe(24);
    expect(SAI_PX).toBe(8);
  });

  it("com a página no alto o topo nasce inteiro", () => {
    montar();
    expect(topoCompacto()).toBe("false");
  });

  it("só encolhe ACIMA de 24 px: 24 ainda é inteiro, 25 encolhe", () => {
    montar();
    rolarPara(24);
    expect(topoCompacto()).toBe("false");
    rolarPara(25);
    expect(topoCompacto()).toBe("true");
  });

  it("encolhido, só volta a ficar inteiro em 8 px ou menos (9 ainda fica encolhido)", () => {
    montar();
    rolarPara(40);
    expect(topoCompacto()).toBe("true");
    rolarPara(24);
    expect(topoCompacto()).toBe("true");
    rolarPara(9);
    expect(topoCompacto()).toBe("true");
    rolarPara(8);
    expect(topoCompacto()).toBe("false");
    // inteiro de novo: para encolher volta a valer o limite de 24
    rolarPara(24);
    expect(topoCompacto()).toBe("false");
    rolarPara(25);
    expect(topoCompacto()).toBe("true");
  });

  it("rolagem negativa (puxão além do topo) deixa o topo inteiro", () => {
    montar();
    rolarPara(60);
    expect(topoCompacto()).toBe("true");
    rolarPara(-30);
    expect(topoCompacto()).toBe("false");
  });
});

describe("useTopoCompacto — medida na montagem", () => {
  it("se a página já abre rolada além do limite, mede de saída (sem esperar rolagem)", () => {
    rolado = 30;
    montar();
    expect(topoCompacto()).toBe("true");
  });

  it("abrindo exatamente no limite de entrada, o topo nasce inteiro", () => {
    rolado = 24;
    montar();
    expect(topoCompacto()).toBe("false");
  });

  it("sem o elemento do topo ligado, não quebra e não encolhe", () => {
    montar({ ligarTopo: false });
    expect(() => rolarPara(500)).not.toThrow();
    expect(topoCompacto()).toBe("false");
  });
});

describe("useTopoCompacto — uma medição por quadro", () => {
  it("vários eventos de rolagem antes do quadro pedem UM quadro só", () => {
    montar();
    pedidos = 0;
    act(() => {
      for (let i = 0; i < 5; i++) {
        document.dispatchEvent(new Event("scroll"));
      }
    });
    expect(pedidos).toBe(1);
    expect(quadros.size).toBe(1);
  });

  it("depois que o quadro roda, a próxima rolagem pede outro", () => {
    montar();
    pedidos = 0;
    rolarPara(30);
    expect(pedidos).toBe(1);
    rolarPara(10);
    expect(pedidos).toBe(2);
  });

  it("rolagem de um contêiner interno (o evento não borbulha) também mede", () => {
    montar();
    rolado = 50;
    act(() => {
      document
        .getElementById("conteudo")
        ?.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    rodarQuadros();
    expect(topoCompacto()).toBe("true");
  });

  it("redimensionar a janela também mede", () => {
    montar();
    rolado = 50;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    rodarQuadros();
    expect(topoCompacto()).toBe("true");
  });
});

describe("useTopoCompacto — como ouve a página", () => {
  it("rolagem com captura e passiva (nunca segura a rolagem); resize passivo", () => {
    const noDocumento = vi.spyOn(document, "addEventListener");
    const naJanela = vi.spyOn(window, "addEventListener");
    montar();
    const scroll = noDocumento.mock.calls.filter(([tipo]) => tipo === "scroll");
    expect(scroll).toHaveLength(1);
    expect(scroll[0]?.[2]).toEqual({ capture: true, passive: true });
    const resize = naJanela.mock.calls.filter(([tipo]) => tipo === "resize");
    expect(resize).toHaveLength(1);
    expect(resize[0]?.[2]).toEqual({ passive: true });
  });

  it("ao desmontar, tira o ouvinte de rolagem COM a captura e o de resize", () => {
    const noDocumento = vi.spyOn(document, "removeEventListener");
    const naJanela = vi.spyOn(window, "removeEventListener");
    montar();
    act(() => raiz.unmount());
    const scroll = noDocumento.mock.calls.filter(([tipo]) => tipo === "scroll");
    expect(scroll).toHaveLength(1);
    expect(scroll[0]?.[2]).toEqual({ capture: true });
    expect(
      naJanela.mock.calls.filter(([tipo]) => tipo === "resize"),
    ).toHaveLength(1);
    raiz = createRoot(host);
  });
});

describe("useTopoCompacto — limpeza ao desmontar", () => {
  it("depois de desmontar, rolagem e resize não pedem mais quadro", () => {
    montar();
    act(() => raiz.unmount());
    pedidos = 0;
    document.dispatchEvent(new Event("scroll"));
    document
      .getElementById("conteudo")
      ?.dispatchEvent(new Event("scroll", { bubbles: false }));
    window.dispatchEvent(new Event("resize"));
    expect(pedidos).toBe(0);
    // reabre a raiz para o afterEach poder desmontar sem erro
    raiz = createRoot(host);
  });

  it("um quadro pendente é cancelado ao desmontar", () => {
    montar();
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    const pendente = [...quadros.keys()];
    expect(pendente).toHaveLength(1);
    act(() => raiz.unmount());
    expect(cancelados).toEqual(pendente);
    raiz = createRoot(host);
  });

  it("sem quadro pendente, desmontar não cancela nada", () => {
    montar();
    rolarPara(30);
    act(() => raiz.unmount());
    expect(cancelados).toEqual([]);
    raiz = createRoot(host);
  });
});

describe("useTopoCompacto — sem requestAnimationFrame", () => {
  it("cai no setTimeout de 16 ms, mede uma vez por espera e limpa ao desmontar", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    montar();

    rolado = 40;
    act(() => {
      document.dispatchEvent(new Event("scroll"));
      document.dispatchEvent(new Event("scroll"));
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(15);
    });
    expect(topoCompacto()).toBe("false");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(topoCompacto()).toBe("true");
    expect(vi.getTimerCount()).toBe(0);

    // um pedido pendente some ao desmontar
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => raiz.unmount());
    expect(vi.getTimerCount()).toBe(0);
    raiz = createRoot(host);
  });
});
