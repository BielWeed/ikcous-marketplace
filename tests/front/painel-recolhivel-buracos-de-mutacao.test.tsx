// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em PainelRecolhivel (os testes antigos
// só o exercitam dentro da tela de Frete inteira):
//  - com erro de validação aberto o painel NÃO fecha (o aviso não pode ser
//    escondido), mas painel FECHADO com pendência ainda abre;
//  - o aviso "Resolva o erro para fechar" só aparece com o painel aberto;
//  - fechar não desmonta o conteúdo (o que foi digitado sobrevive);
//  - o botão aponta para a região que ele abre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelRecolhivel } from "@/components/admin/shipping/PainelRecolhivel";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function montar(p: {
  aberta: boolean;
  comPendencia?: boolean;
  resumo?: string | null;
  onToggle?: () => void;
}) {
  act(() =>
    raiz.render(
      <PainelRecolhivel
        id="painel-de-teste"
        titulo="Fora da cidade"
        resumo={p.resumo}
        aberta={p.aberta}
        comPendencia={p.comPendencia}
        onToggle={p.onToggle ?? (() => {})}
      >
        <input id="campo-dentro" defaultValue="rascunho" />
      </PainelRecolhivel>,
    ),
  );
}

const botao = () => host.querySelector<HTMLButtonElement>("button");
const AVISO = "Resolva o erro para fechar";

describe("PainelRecolhivel (buracos de mutação)", () => {
  it("fechado: aria-expanded=false, região escondida mas o conteúdo continua montado", () => {
    montar({ aberta: false });
    expect(botao()?.getAttribute("aria-expanded")).toBe("false");
    const regiao = host.querySelector<HTMLElement>("#painel-de-teste-conteudo");
    expect(regiao?.hidden).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#campo-dentro")?.value).toBe(
      "rascunho",
    );
  });

  it("aberto: aria-expanded=true e a região aparece", () => {
    montar({ aberta: true });
    expect(botao()?.getAttribute("aria-expanded")).toBe("true");
    expect(
      host.querySelector<HTMLElement>("#painel-de-teste-conteudo")?.hidden,
    ).toBe(false);
  });

  it("o botão aponta (aria-controls) para a região que ele abre", () => {
    montar({ aberta: false });
    const alvo = botao()?.getAttribute("aria-controls");
    expect(alvo).toBe("painel-de-teste-conteudo");
    expect(host.querySelector(`#${alvo}`)).not.toBeNull();
  });

  it.each([
    ["fechado sem pendência", false, false, 1],
    ["aberto sem pendência", true, false, 1],
    ["fechado COM pendência (pode abrir)", false, true, 1],
    ["aberto COM pendência (não pode fechar)", true, true, 0],
  ])(
    "clicar em %s chama onToggle conforme a regra",
    (_nome, aberta, pend, vezes) => {
      const onToggle = vi.fn();
      montar({ aberta, comPendencia: pend, onToggle });
      act(() => botao()?.click());
      expect(onToggle).toHaveBeenCalledTimes(vezes);
    },
  );

  it.each([
    ["aberto com pendência mostra o aviso", true, true, true],
    ["fechado com pendência não mostra o aviso", false, true, false],
    ["aberto sem pendência não mostra o aviso", true, false, false],
  ])("%s", (_nome, aberta, pend, aparece) => {
    montar({ aberta, comPendencia: pend });
    expect((host.textContent ?? "").includes(AVISO)).toBe(aparece);
  });

  it("o resumo aparece quando existe e some quando é nulo", () => {
    montar({ aberta: false, resumo: "Entrega por transportadora" });
    expect(host.textContent).toContain("Entrega por transportadora");
    montar({ aberta: false, resumo: null });
    expect(host.textContent).not.toContain("Entrega por transportadora");
  });
});
