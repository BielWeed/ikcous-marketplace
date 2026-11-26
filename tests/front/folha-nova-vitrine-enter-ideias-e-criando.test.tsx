// @vitest-environment jsdom
//
// "Nova vitrine": o que o teclado e os atalhos fazem, e o que "criando" trava.
// - Enter no campo cria; qualquer outra tecla (letra, Tab, Escape) não;
// - cada "ideia rápida" põe o texto dela no campo (e só ele);
// - Cancelar só fecha (não cria); "Criar vitrine" só cria;
// - com a criação em andamento o botão "Criar vitrine" fica apagado, e o de
//   Cancelar não.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaNovaVitrine } = await import(
  "@/components/admin/vitrines/FolhaNovaVitrine"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const aoMudarTitulo = vi.fn();
const aoCriar = vi.fn();
const aoFechar = vi.fn();

async function abrir(criando = false) {
  aoMudarTitulo.mockReset();
  aoCriar.mockReset();
  aoFechar.mockReset();
  await act(async () => {
    raiz.render(
      createElement(FolhaNovaVitrine, {
        titulo: "Meu nome",
        aoMudarTitulo,
        aoCriar,
        aoFechar,
        criando,
      }),
    );
  });
}

const campo = () =>
  document.querySelector<HTMLInputElement>(
    "#titulo-da-nova-vitrine",
  ) as HTMLInputElement;
const botao = (nome: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === nome,
  ) as HTMLButtonElement;
const tecla = (key: string) =>
  act(async () => {
    campo().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

describe("Nova vitrine", () => {
  it("Enter no campo cria a vitrine, uma vez", async () => {
    await abrir();
    await tecla("Enter");
    expect(aoCriar).toHaveBeenCalledTimes(1);
  });

  it("outras teclas não criam nada", async () => {
    await abrir();
    for (const k of ["a", "Tab", "Escape", " ", "ArrowDown"]) await tecla(k);
    expect(aoCriar).not.toHaveBeenCalled();
  });

  it("digitar chama aoMudarTitulo com o texto novo", async () => {
    await abrir();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo(), "Outro");
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(aoMudarTitulo).toHaveBeenCalledWith("Outro");
  });

  it("cada ideia rápida troca o nome pelo texto dela", async () => {
    await abrir();
    const ideias = [
      "Kits de Presente",
      "Mais Vendidos da Semana",
      "Linha Skincare",
      "Coleção Verão",
      "Recomendados para Você",
    ];
    for (const ideia of ideias) {
      await act(async () => {
        botao(ideia).click();
      });
    }
    expect(aoMudarTitulo.mock.calls.map(([t]) => t)).toEqual(ideias);
    expect(aoCriar).not.toHaveBeenCalled();
  });

  it("Cancelar só fecha; Criar vitrine só cria", async () => {
    await abrir();
    await act(async () => {
      botao("Cancelar").click();
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(aoCriar).not.toHaveBeenCalled();
    await act(async () => {
      botao("Criar vitrine").click();
    });
    expect(aoCriar).toHaveBeenCalledTimes(1);
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("criando: 'Criar vitrine' fica apagado e 'Cancelar' continua livre", async () => {
    await abrir(true);
    expect(botao("Criar vitrine").disabled).toBe(true);
    expect(botao("Cancelar").disabled).toBe(false);
    await act(async () => {
      botao("Criar vitrine").click();
    });
    expect(aoCriar).not.toHaveBeenCalled();
  });

  it("fora de 'criando' o botão está livre", async () => {
    await abrir(false);
    expect(botao("Criar vitrine").disabled).toBe(false);
  });
});
