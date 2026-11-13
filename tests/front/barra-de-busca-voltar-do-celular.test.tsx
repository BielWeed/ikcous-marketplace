// @vitest-environment jsdom
//
// No painel, Produtos e Clientes abrem os filtros num Dialog da própria
// `BarraDeBusca`. Esse Dialog não tinha entrada no histórico: o Voltar do
// celular saía da tela e a janela de filtros podia ficar aberta por cima (a
// tela de Produtos continua montada, inativa, atrás das outras abas). Agora a
// janela usa `useVoltarFechaAFolha`: o Voltar fecha SÓ a janela e a tela fica.
// Histórico REAL do jsdom e um "App" simulado que só navega quando a tela do
// histórico muda. Molde: lote-230-folha-de-opcoes-voltar-do-celular.test.tsx.
import { BarraDeBusca } from "@/components/admin/BarraDeBusca";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];
const aoGerenciarCategorias = vi.fn();

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

function Pagina() {
  return (
    <BarraDeBusca
      id="busca-teste"
      rotulo="Buscar produtos"
      placeholder="Buscar produto, código…"
      value=""
      onChange={() => undefined}
      modo="compact"
      onMudarModo={() => undefined}
      produtos
      grupo="Categorias dos produtos"
      tituloFiltro="Categoria"
      opcoes={[
        {
          valor: "all",
          rotulo: "Todas as categorias",
          selecionada: true,
          onClick: () => undefined,
        },
      ]}
      onGerenciarCategorias={aoGerenciarCategorias}
    />
  );
}

beforeEach(() => {
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState({ view: "admin-products" }, "", "/produtos");
  navegacoesDoApp = [];
  aoGerenciarCategorias.mockClear();
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

const janela = () => document.querySelector('[role="dialog"]');

async function abrirFiltros() {
  await act(async () => {
    raiz.render(<Pagina />);
    await esperar(0);
  });
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>('button[aria-label="Filtros"]')
      ?.click();
    await esperar(0);
  });
}

async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar();
  });
}

describe("BarraDeBusca — a janela de filtros e o Voltar do celular", () => {
  it("aberta, a janela ganha UMA entrada no histórico, na mesma tela", async () => {
    await abrirFiltros();
    expect(janela()).not.toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    expect(globalThis.location.pathname).toBe("/produtos");
  });

  it("o Voltar fecha SÓ a janela de filtros: a tela não troca", async () => {
    await abrirFiltros();
    await apertarVoltar();

    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.location.pathname).toBe("/produtos");
    expect(globalThis.history.state?.view).toBe("admin-products");
  });

  it("fechar pelo X devolve a entrada: o Voltar seguinte é do roteador", async () => {
    await abrirFiltros();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Fechar filtros"]')
        ?.click();
      await esperar(200);
    });

    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);

    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("Gerenciar categorias fecha a janela, abre o gerenciador e a tela não troca", async () => {
    await abrirFiltros();
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "Gerenciar categorias")
        ?.click();
      await esperar(200);
    });

    expect(aoGerenciarCategorias).toHaveBeenCalledTimes(1);
    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);
  });
});
