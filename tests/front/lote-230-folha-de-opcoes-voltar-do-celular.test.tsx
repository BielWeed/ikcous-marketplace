// @vitest-environment jsdom
//
// Lote 230: o Voltar do celular fecha a folha de opções (tamanho/cor) em vez
// de tirar a cliente da tela do produto. Mesmo contrato das outras folhas
// (`useVoltarFechaAFolha`): a folha abre empurrando UMA entrada no histórico;
// o Voltar consome essa entrada e fecha SÓ a folha; fechar pelo X devolve a
// entrada. Histórico REAL do jsdom e um "App" simulado que só navega quando a
// tela do histórico muda.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolhaDeOpcoes } from "@/components/ui/custom/FolhaDeOpcoes";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
let fechamentos: boolean[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

function Pagina({ comecaAberta = false }: { comecaAberta?: boolean }) {
  const [aberta, setAberta] = useState(comecaAberta);
  return (
    <div>
      <button
        type="button"
        data-testid="abrir"
        onClick={() => setAberta(true)}
      />
      <FolhaDeOpcoes
        aberta={aberta}
        onMudar={(v) => {
          fechamentos.push(v);
          setAberta(v);
        }}
      >
        <SheetTitle>Opções</SheetTitle>
        <SheetDescription>Escolha as opções.</SheetDescription>
        <div data-testid="corpo-da-folha">opções</div>
      </FolhaDeOpcoes>
    </div>
  );
}

beforeEach(() => {
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState({ view: "product-detail" }, "", "/produto?id=1");
  navegacoesDoApp = [];
  fechamentos = [];
  let mostrada = tela();
  const ouvinte = () => {
    const alvo = tela();
    if (alvo === mostrada) return;
    mostrada = alvo;
    navegacoesDoApp.push(alvo);
  };
  ouvintes.push(ouvinte);
  globalThis.addEventListener("popstate", ouvinte);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
});

const corpo = () => document.querySelector('[data-testid="corpo-da-folha"]');

async function abrir() {
  await act(async () => {
    raiz.render(<Pagina />);
    await esperar(0);
  });
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>('[data-testid="abrir"]')
      ?.click();
    await esperar(0);
  });
}

describe("lote 230 — FolhaDeOpcoes e o Voltar do celular", () => {
  it("aberta, a folha ganha UMA entrada no histórico, na mesma tela", async () => {
    await abrir();
    expect(corpo()).not.toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    expect(globalThis.location.pathname).toBe("/produto");
  });

  it("o Voltar fecha SÓ a folha: a tela não troca", async () => {
    await abrir();

    await act(async () => {
      globalThis.history.back();
      await esperar();
    });

    expect(corpo()).toBeNull();
    expect(fechamentos).toEqual([false]);
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.location.pathname).toBe("/produto");
  });

  it("fechar pela própria folha (Esc) devolve a entrada: o Voltar seguinte não fica sem efeito", async () => {
    await abrir();
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);

    await act(async () => {
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      await esperar();
    });

    expect(corpo()).toBeNull();
    // a entrada da folha foi devolvida; o topo do histórico é de novo a tela
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);
  });

  it("fechada, a folha não mexe no histórico", async () => {
    const antes = globalThis.history.length;
    await act(async () => {
      raiz.render(<Pagina />);
      await esperar(0);
    });
    expect(globalThis.history.length).toBe(antes);
  });
});
