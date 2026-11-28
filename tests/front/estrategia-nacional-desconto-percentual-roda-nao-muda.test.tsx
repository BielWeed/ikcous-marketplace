// @vitest-environment jsdom
//
// "Desconto no frete" em porcentagem é um <input type="number">: com o foco
// nele, a roda do mouse sobe ou desce o número (15 vira 14 ou 16) enquanto a
// lojista só queria rolar a página, e ela salva sem notar. A trava é a mesma
// do `LocalBufferedInput`: ao rolar com o foco no campo numérico, o foco sai
// e a roda volta a rolar a página. jsdom não muda o número com a roda, então
// a prova é o foco: sem a trava, o campo continua focado (e no navegador o
// número mudaria). O caminho em reais é texto e não muda com a roda: lá o
// foco fica.
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof EstrategiaNacionalBloco>[0];

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(p: Partial<Props>) {
  act(() =>
    raiz.render(
      <EstrategiaNacionalBloco
        estrategia="desconto_na_mais_barata"
        minimo={0}
        tipoDesconto="percentual"
        valorDesconto={15}
        alcance="mais_barata"
        onEscolherEstrategia={vi.fn()}
        onMinimo={vi.fn()}
        onTipoDesconto={vi.fn()}
        onValorDesconto={vi.fn()}
        onAlcance={vi.fn()}
        {...p}
      />,
    ),
  );
}

const campoDoDesconto = () =>
  host.querySelector<HTMLInputElement>("#frete-nacional-valor-desconto");

function rolar(el: HTMLInputElement) {
  act(() => {
    el.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }),
    );
  });
}

describe("desconto do frete nacional — a roda do mouse não mexe no número", () => {
  it("porcentagem 15 com foco: rolar tira o foco e o valor segue 15", () => {
    const onValorDesconto = vi.fn();
    montar({ onValorDesconto });
    const campo = campoDoDesconto() as HTMLInputElement;
    expect(campo.type).toBe("number");
    act(() => campo.focus());
    expect(document.activeElement).toBe(campo);

    rolar(campo);

    expect(document.activeElement).not.toBe(campo);
    expect(campo.value).toBe("15");
    expect(onValorDesconto).not.toHaveBeenCalled();
  });

  it("rolar sobre o campo SEM foco não rouba nem dá foco (a página só rola)", () => {
    const onValorDesconto = vi.fn();
    montar({ onValorDesconto });
    const campo = campoDoDesconto() as HTMLInputElement;
    const outro = document.createElement("button");
    host.appendChild(outro);
    act(() => outro.focus());

    rolar(campo);

    expect(document.activeElement).toBe(outro);
    expect(campo.value).toBe("15");
    expect(onValorDesconto).not.toHaveBeenCalled();
  });

  it("em reais (texto) o caminho é o de antes: rolar mantém o foco e o texto", () => {
    const onValorDesconto = vi.fn();
    montar({ tipoDesconto: "fixo", valorDesconto: 12.5, onValorDesconto });
    const campo = campoDoDesconto() as HTMLInputElement;
    expect(campo.type).toBe("text");
    act(() => campo.focus());

    rolar(campo);

    expect(document.activeElement).toBe(campo);
    expect(campo.value).toBe("12,50");
    expect(onValorDesconto).not.toHaveBeenCalled();
  });
});
