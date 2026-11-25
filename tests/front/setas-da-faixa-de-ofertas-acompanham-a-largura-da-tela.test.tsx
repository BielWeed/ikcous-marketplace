// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), SetasDaFaixaDeOfertas. O teste vizinho (desktop-p50) monta a
// tela já no tamanho de computador. Aqui, o que acontece quando a LARGURA MUDA com a faixa
// montada (girar o aparelho, abrir a janela do navegador):
//  - celular: nenhuma seta e nenhum ouvinte no Embla;
//  - virou computador: as setas aparecem, lendo o Embla NA HORA (sem esperar um toque);
//  - voltou a ser celular: as setas somem e os ouvintes do Embla são retirados.
//
// Mutante equivalente anotado: `window.matchMedia?.(reduzir).matches ?? false` -> `?? true` só
// diverge se `matchMedia` existir mas devolver um objeto sem `matches`; sem `matchMedia` o gancho
// de largura já entrega "celular" e a seta nem é desenhada, então o `?? false` nunca decide.
import { SetasDaFaixaDeOfertas } from "@/components/ui/custom/SetasDaFaixaDeOfertas";
import type { ApiDaFaixa } from "@/components/ui/custom/SetasDaFaixaDeOfertas";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tela = { computador: false, reduzirMovimento: false };
const ouvintesDaLargura = new Set<() => void>();

function falsoMatchMedia(consulta: string) {
  return {
    media: consulta,
    get matches() {
      return consulta.includes("min-width")
        ? tela.computador
        : tela.reduzirMovimento;
    },
    addEventListener: (_: string, f: () => void) => ouvintesDaLargura.add(f),
    removeEventListener: (_: string, f: () => void) =>
      ouvintesDaLargura.delete(f),
  };
}

function falsoEmbla(pode: { voltar: boolean; avancar: boolean }) {
  return {
    canScrollPrev: vi.fn(() => pode.voltar),
    canScrollNext: vi.fn(() => pode.avancar),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe("SetasDaFaixaDeOfertas: acompanha a largura da tela", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    tela.computador = false;
    tela.reduzirMovimento = false;
    ouvintesDaLargura.clear();
    vi.stubGlobal("matchMedia", falsoMatchMedia);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  const botoes = () =>
    [...host.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );
  async function mudarLargura(computador: boolean) {
    tela.computador = computador;
    await act(async () => {
      for (const f of ouvintesDaLargura) f();
    });
  }

  it("celular: sem seta e sem ouvinte; vira computador: as setas aparecem lendo o Embla na hora", async () => {
    const api = falsoEmbla({ voltar: true, avancar: true });
    await act(async () => {
      raiz.render(<SetasDaFaixaDeOfertas api={api as unknown as ApiDaFaixa} />);
    });
    expect(botoes()).toEqual([]);
    expect(api.on).not.toHaveBeenCalled();
    expect(api.canScrollNext).not.toHaveBeenCalled();

    await mudarLargura(true);
    expect(botoes()).toEqual([
      "Ver ofertas anteriores",
      "Ver ofertas seguintes",
    ]);
    expect(api.on).toHaveBeenCalledWith("select", expect.any(Function));
    expect(api.on).toHaveBeenCalledWith("reInit", expect.any(Function));
  });

  it("voltou a ser celular: as setas somem e os ouvintes do Embla são retirados", async () => {
    tela.computador = true;
    const api = falsoEmbla({ voltar: false, avancar: true });
    await act(async () => {
      raiz.render(<SetasDaFaixaDeOfertas api={api as unknown as ApiDaFaixa} />);
    });
    expect(botoes()).toEqual(["Ver ofertas seguintes"]);
    await mudarLargura(false);
    expect(botoes()).toEqual([]);
    expect(api.off).toHaveBeenCalledWith("select", expect.any(Function));
    expect(api.off).toHaveBeenCalledWith("reInit", expect.any(Function));
  });

  it("quem pede menos movimento recebe o salto direto; os demais, a rolagem suave", async () => {
    tela.computador = true;
    const api = falsoEmbla({ voltar: true, avancar: true });
    await act(async () => {
      raiz.render(
        <SetasDaFaixaDeOfertas
          api={api as unknown as ApiDaFaixa}
          itens="produtos"
        />,
      );
    });
    expect(botoes()).toEqual([
      "Ver produtos anteriores",
      "Ver produtos seguintes",
    ]);
    await act(async () => {
      host.querySelectorAll("button")[1]?.click();
    });
    expect(api.scrollNext).toHaveBeenLastCalledWith(false);
    tela.reduzirMovimento = true;
    await act(async () => {
      host.querySelectorAll("button")[0]?.click();
    });
    expect(api.scrollPrev).toHaveBeenLastCalledWith(true);
  });
});
